// Claude API 로 1) 수집 게시물의 이슈 관련성 판독 2) 댓글 성향 4단계 분석 3) 보고서 요약 문장·주요 댓글 선정을 한다.
// 모든 단계에 '보고서 작성 목적'과 '이슈명·키워드'를 함께 보내 그 목적에 초점을 맞춰 판단·작성하게 한다.

const RELEVANCE_BATCH = 30; // 관련성 판독 한 번에 보낼 게시물 수
const SENTIMENT_BATCH = 60; // 성향 분석 한 번에 보낼 댓글 수
const SENTIMENTS = ["긍정", "중립", "부정", "단순비난"];

// 기본 규칙을 마지막으로 고친 때 ('명령 프롬프트' 화면에 표시)
const PROMPT_BUILT_AT = "2026-10-21 (v1.0.1)";

function issueContext(job) {
  const kw = parseKeywords(job.keywords);
  return `[이번 보고서]
- 이슈명: ${job.issueName || "(없음)"}
- 보고서 작성 목적(담당자가 직접 적은 것 — 모든 판단과 작성의 기준): ${job.purpose ? `\n${job.purpose.trim()}` : "(없음)"}
- 수집 키워드(줄마다 하나의 검색어, | 는 '또는', 띄어 쓴 단어는 '그리고'): ${kw.groups.map((g) => g.map((a) => a.join("|")).join(" ")).join(" / ") || "(없음)"}${kw.exclude.length ? `\n- 제외 키워드: ${kw.exclude.join(", ")}` : ""}
- 모니터링 기간: ${fmtDateTime(job.from)} ~ ${fmtDateTime(job.to)}`;
}

// '명령 프롬프트' 화면에서 담당자가 추가한 지시사항 (모든 AI 단계에 붙고, 기본 규칙보다 우선)
function customInstructions(settings) {
  const t = String(settings?.customPrompt || "").trim();
  return t ? `\n\n[추가 지시사항 — 담당자가 수시로 추가한 것, 아래 기본 규칙과 충돌하면 이것을 따른다]\n${t}` : "";
}

// ---------------------------------------------------------------------------
// 1) 게시물 관련성 판독
// ---------------------------------------------------------------------------

const RELEVANCE_RULES = `★★★ 가장 중요한 규칙 — 게시물 관련성 판독 (이 보고서의 정확도가 여기서 결정된다) ★★★
1. 이 판독 결과로 '보고서에 넣을 게시글'과 '댓글을 모을 게시글'이 정해진다. 관련 없는 글이 들어가면 그 글의 댓글까지 성향 통계에 섞여 보고서 전체가 틀어진다. 놓친 글은 보고서에서 빠진다. 두 가지 실수 모두 치명적이므로 한 글 한 글 신중히 판단한다.
2. 기준은 '키워드가 들어 있는가'가 아니라 '보고서 작성 목적과 이슈명에 실제로 해당하는 이야기인가'이다.
   - 키워드가 있어도 다른 이야기(같은 단어의 다른 뜻, 다른 차종·다른 회사·다른 사건, 키워드가 광고·말머리·닉네임·서명에만 있는 글, 단순 출석·인사·장터·광고 글)는 relevant=false.
   - 키워드가 제목에 없어도 내용(미리보기·본문·설명)이 이 이슈를 직접 다루면 relevant=true.
   - 이슈에 대한 사실 보도, 의견, 질문, 후기, 비교, 반응 글은 긍정·부정과 관계없이 모두 relevant=true (성향은 나중 단계에서 본다).
3. 판단 근거가 부족한 짧은 글은 제목·출처(동호회 이름·채널)·작성 시점으로 이 이슈와의 관련 가능성을 따져, 이 이슈에 대한 반응일 가능성이 높으면 true, 낮으면 false 로 정한다.
4. 언론 기사는 이 이슈가 기사의 주제이거나 주요 내용일 때만 true. 여러 소식을 묶은 기사에서 한 줄 언급만 있으면 false.
5. 유튜브 영상은 제목·설명이 이 이슈를 다루는 영상만 true.
6. reason 에는 판단 근거를 20자 안팎 한국어로 적는다 (예: "CN8 가격 인상 불만 글", "기아 K5 이야기로 무관").`;

function relevanceSystem(job, settings) {
  return `너는 현대자동차 온라인 여론 모니터링 담당자다. 수집된 게시물(언론 기사·동호회 글·자동차 커뮤니티 글·유튜브 영상)마다 이번 보고서의 이슈와 관련이 있는지 판독한다.

${issueContext(job)}

${RELEVANCE_RULES}${customInstructions(settings)}`;
}

const RELEVANCE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, relevant: { type: "boolean" }, reason: { type: "string" } },
        required: ["id", "relevant", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// 2) 댓글 성향 분석 (긍정 / 중립 / 부정 / 단순비난)
// ---------------------------------------------------------------------------

const SENTIMENT_RULES = `★★★ 가장 중요한 규칙 — 댓글 성향 분석 (보고서의 성향 비율·결론이 모두 이 판정으로 정해진다) ★★★
1. 성향은 댓글 글쓴이의 기분이 아니라 '이번 이슈(보고서 작성 목적에 적힌 대상: 차량·가격·정책·회사 대응 등)에 대한 태도'로 판정한다. 반드시 그 댓글이 달린 게시글 제목(과 앞뒤 댓글 흐름)을 함께 보고 문맥으로 판단한다.
2. 네 가지 중 하나만 고른다.
   - 긍정: 이슈 대상에 호의·기대·칭찬·지지·응원·구매(계약) 의사를 드러냄.
       예) "플레오스가 너무너무 기대됩니다!!", "디 올 뉴 아반떼 흥행 기원합니다.", "계약 해야겠네요 ~☆", "사전에 미리보았는대 정말 디자인 멋지더라구요"
   - 중립: 정보 공유·사실 전달·질문·답변, 인사·감사·축하, 이슈와 직접 관계없는 잡담(색상 고민·출고 일정 등), 장단점을 고르게 말하거나 태도가 드러나지 않음.
       예) "소식 감사합니다.", "축하드립니다!!!", "고요카퍼펄 실물 보고 결정할듯 해요", "하브는 멀티링크 맞습니다", "8/10 전까지 최종 옵션 결정하시면 현재 순번으로 유지되실거에요"
   - 부정: 이슈 대상에 대해 구체적인 이유·근거가 있는 불만·비판·우려·실망 (가격 인상 폭, 옵션 구성, 성능·품질, 경쟁 차종 대비 불리함, 다른 차를 사기로 했다는 이탈 의사 등).
       예) "이번 아반떼 풀옵 4100은 좀 심했습니다 800올랐으니깐요", "와 4200ㅋㅋㅋ 차라리 투싼 하브 중간등급이나 싼타페 하브 깡통 사겠다..ㅋㅋ", "아반떼 가격을 보니 쏘나타로 가기를 너무 잘한 것 같아요", "너무 비싸다 진짜.."
   - 단순비난: 구체적 근거 없이 회사·브랜드·노조·소비자를 감정적으로 비하·조롱·냉소·욕하는 댓글 (현기·흉기 같은 비하 표현, "노조 월급줘야죠", "국민 호구", "불매", "이번생 마지막 현대차", 회사 전반에 대한 막연한 비난).
       예) "현기 배짱장사는 증말이지 답이없네요", "노조 월급줘야징~", "불매운동해야될정도 국민호구로 보는거죠", "현대 : 이야 이래도 사네;; 담엔 더올려보자"
3. 부정과 단순비난의 구분이 가장 중요하다: 이번 이슈의 구체적 내용(가격·옵션·품질 등)을 근거로 말하면 '부정', 근거 없이 회사·노조·브랜드 전체를 싸잡아 비꼬거나 욕하면 '단순비난'. 둘이 섞여 있으면 중심이 되는 쪽으로 정한다.
4. 반어·비꼼("와 강심장이시네요", "모든 기능 다 때려부은 고급차 아반떼 ㄷㄷ")은 겉말이 아니라 속뜻으로 판정한다. 'ㅋㅋ', 이모티콘, 맞춤법 오류에 휘둘리지 않는다.
5. 다른 댓글에 대한 대답은 그 대답이 이슈에 대해 드러내는 태도로 판정한다 (대화 정정·사실 확인만 하면 중립).
6. 확신이 서지 않으면 억지로 극단으로 보내지 말고 문맥상 가장 그럴듯한 것을 고르되, 태도가 드러나지 않으면 중립으로 둔다.
7. 모든 id 에 대해 빠짐없이 하나씩 답한다.`;

function sentimentSystem(job, settings) {
  return `너는 현대자동차 온라인 여론 모니터링 담당자다. 이번 이슈에 대한 온라인 댓글의 성향을 4단계(긍정/중립/부정/단순비난)로 정확히 판정한다.

${issueContext(job)}

${SENTIMENT_RULES}${customInstructions(settings)}`;
}

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, s: { type: "string", enum: SENTIMENTS } },
        required: ["id", "s"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// 3) 보고서 요약 문장 · 주요 댓글 고르기
// ---------------------------------------------------------------------------

const REPORT_RULES = `★ 보고서 작성 규칙 ★
1. 보고서 작성 목적에 초점을 맞춰, 목적과 관련된 여론의 흐름이 한눈에 보이게 쓴다. 숫자(성향 비율·건수)는 주어진 통계와 반드시 일치시킨다.
2. 문체는 현대자동차 내부 여론 동향 보고서체: 짧은 개조식, '~확인 中', '~다수 확인', '~지배적', '~일부 확인', '比'(대비), '內'(안) 같은 표현을 쓴다. 존댓말·느낌표·이모티콘을 쓰지 않는다.
   예) "8/5, CN8 가격 공개 이후 온라인 전 채널 전반에서 가격 인상 폭에 대한 내용 및 유료 옵션 선택을 꼼수로 보는 부정적 반응 지배적으로 확인 中"
   예) "확인 중인 주요 부정 여론은 옵션 유료화(계기반/통풍시트/HUD 등) 및 동급, 경쟁 차종 대비 높은 가격이며, 채널 특성상 언론과 유튜브 중심으로 노조, 현대차 전반에 대한 단순 비난성 여론 또한 다수 확인. 한편 동호회 內, 실구매자들의 계약 인증 및 축하 여론 일부 확인"
3. summary 는 정확히 2문장(두 줄 글머리표): 첫째 = 이슈 발생 시점·전체 여론 흐름, 둘째 = 주요 부정(또는 우세한) 여론의 구체적 내용과 채널별 특징, 그리고 반대 성향 여론.
   각 문장은 90~150자.
4. title 은 "<이슈명> 관련 여론 동향" 형태로 25자 이내.
5. 주요 댓글은 반드시 주어진 댓글 목록에서 id 로 고른다 (새로 지어내지 않는다). 그 성향을 대표하고, 서로 다른 논점을 보여 주며, 목적과 관련된 댓글을 우선한다. 욕설·개인정보가 심한 댓글은 피한다.
   - quotes_short: 성향마다 4~7개 (1페이지 표, 짧고 핵심적인 것)
   - quotes_long: 성향마다 10~25개 (2페이지 표, 다양하게). 해당 성향 댓글이 적으면 있는 만큼만.`;

function reportSystem(job, settings) {
  return `너는 현대자동차 온라인 여론 모니터링 보고서 작성 담당자다. 수집·분석된 게시글과 댓글로 '여론 동향' PPT 보고서의 문장을 쓰고 대표 댓글을 고른다.

${issueContext(job)}

${REPORT_RULES}${customInstructions(settings)}`;
}

const quoteIds = { type: "object", properties: Object.fromEntries(SENTIMENTS.map((s) => [s, { type: "array", items: { type: "string" } }])), required: SENTIMENTS, additionalProperties: false };
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "array", items: { type: "string" } },
    quotes_short: quoteIds,
    quotes_long: quoteIds,
  },
  required: ["title", "summary", "quotes_short", "quotes_long"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// 0) 보고서 작성 목적 → 수집 키워드 추천
// ---------------------------------------------------------------------------

const KEYWORD_RULES = `★ 수집 키워드 추천 규칙 ★
1. 목적에 맞는 게시글을 빠짐없이, 그러나 엉뚱한 글은 적게 찾을 검색어를 만든다. 검색은 네이버 뉴스·네이버 카페(동호회) 검색창, 자동차 커뮤니티 제목에 그대로 쓰인다.
2. 문법: lines 의 한 줄 = 검색어 하나(줄끼리는 '또는'). 한 줄 안의 띄어 쓴 단어 = 모두 들어간 글('그리고'). 한 단어 자리에 A|B = A 또는 B.
   예) "CN8|아반떼|디올뉴아반떼 가격|가격표|출시가" , "아반떼 옵션 유료"
3. 차종은 코드명(예: CN8, LX3, NX4)·정식 이름·흔한 줄임말·띄어쓰기 변형을 | 로 묶는다 (예: 아반떼|아방|디올뉴아반떼). 이슈를 나타내는 핵심 단어도 같은 뜻의 말과 커뮤니티에서 쓰는 표현을 | 로 묶는다.
4. 한 단어만으로 된 줄(예: "아반떼")처럼 너무 넓은 검색어는 피하고, 차종 + 이슈어 조합을 기본으로 한다. 단, 이슈 자체를 가리키는 고유한 말(예: "전동시트 끼임")은 한 줄로 써도 된다.
5. 줄은 2~6개, 조합을 펼친 검색어는 모두 합쳐 30개 이하가 되게 한다.
6. exclude 에는 검색에 섞여 들어올 엉뚱한 글을 거를 말(다른 뜻의 동음이의어, 렌트·중고 매매·장터 등 목적과 무관한 것)을 0~6개 넣는다. 목적과 관련된 글을 지울 위험이 있는 말은 넣지 않는다.
7. note 에는 왜 이렇게 만들었는지 한두 문장으로 쓴다.`;

function keywordSystem(job, settings) {
  return `너는 현대자동차 온라인 여론 모니터링 담당자다. 담당자가 적은 보고서 작성 목적을 읽고, 관련 게시글을 수집할 키워드를 추천한다.

[이번 보고서]
- 이슈명: ${job.issueName || "(없음)"}
- 보고서 작성 목적: ${job.purpose ? `\n${job.purpose.trim()}` : "(없음)"}
- 지금 적혀 있는 키워드(있으면 참고해 보완): ${String(job.keywords || "").trim() || "(없음)"}

${KEYWORD_RULES}${customInstructions(settings)}`;
}

const KEYWORD_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } }, exclude: { type: "array", items: { type: "string" } }, note: { type: "string" } },
  required: ["lines", "exclude", "note"],
  additionalProperties: false,
};

// 기본 규칙 전체 ('명령 프롬프트' 화면에 그대로 보여 줌)
function promptPreview(job, settings) {
  return [
    ["⓪ 목적으로 수집 키워드 추천", keywordSystem(job, settings)],
    ["① 게시물 관련성 판독", relevanceSystem(job, settings)],
    ["② 댓글 성향 분석", sentimentSystem(job, settings)],
    ["③ 보고서 요약·주요 댓글", reportSystem(job, settings)],
  ];
}

// ---------------------------------------------------------------------------

class AiClient {
  constructor(settings, log) {
    this.settings = settings;
    this.log = log || (() => {});
    this.model = MODELS.find((m) => m.id === settings.model) || MODELS[0];
    this.client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }

  costUsd() {
    const [inP, outP] = this.model.price;
    const u = this.usage;
    return (u.input * inP + u.cacheWrite * inP * 1.25 + u.cacheRead * inP * 0.1 + u.output * outP) / 1e6;
  }

  async callJson(system, user, schema, effort = "medium") {
    const params = {
      model: this.model.id,
      max_tokens: 32000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort, format: { type: "json_schema", schema } },
    };
    const res = this.model.fallbacks
      ? await this.client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage()
      : await this.client.messages.stream(params).finalMessage();
    const u = res.usage || {};
    this.usage.input += u.input_tokens || 0;
    this.usage.output += u.output_tokens || 0;
    this.usage.cacheRead += u.cache_read_input_tokens || 0;
    this.usage.cacheWrite += u.cache_creation_input_tokens || 0;
    if (res.stop_reason === "refusal") throw new Error("AI 가 이 묶음 처리를 거절했습니다");
    if (res.stop_reason === "max_tokens") throw new Error("AI 응답이 길이 제한에 걸렸습니다");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text);
  }

  async ping() {
    await this.client.messages.create({ model: this.model.id, max_tokens: 64, output_config: { effort: "low" }, messages: [{ role: "user", content: "OK 라고만 답해" }] });
  }

  // 보고서 작성 목적 → 키워드 글 (화면의 키워드 칸 형식)
  async suggestKeywords(job) {
    const res = await this.callJson(keywordSystem(job, this.settings), "보고서 작성 목적에 맞는 수집 키워드를 추천해 줘.", KEYWORD_SCHEMA, "medium");
    const lines = (res.lines || []).map((l) => String(l).replace(/\s+/g, " ").trim()).filter(Boolean);
    const ex = (res.exclude || []).map((w) => String(w).replace(/\s+/g, "").replace(/^-/, "")).filter(Boolean);
    return { text: [...lines, ...(ex.length ? [ex.map((w) => `-${w}`).join(" ")] : [])].join("\n"), note: res.note || "" };
  }

  // posts: [{key, channelName, source, title, text}] → Map(key → {relevant, reason})
  async judgeRelevance(job, posts, onBatch) {
    const out = new Map();
    const system = relevanceSystem(job, this.settings);
    for (let i = 0; i < posts.length; i += RELEVANCE_BATCH) {
      const batch = posts.slice(i, i + RELEVANCE_BATCH);
      const text = batch
        .map((p, j) => `<post id="${j + 1}">\n채널: ${p.channelName} / 출처: ${p.source || "-"}\n작성: ${p.date ? fmtDateTime(p.date) : "-"}\n제목: ${p.title}\n내용(일부): ${String(p.text || "").replace(/\s+/g, " ").slice(0, 1200) || "(없음)"}\n</post>`)
        .join("\n\n");
      const res = await this.callJson(system, `다음 게시물 ${batch.length}건을 판독해 id 마다 결과를 돌려줘.\n\n${text}`, RELEVANCE_SCHEMA, "medium");
      for (const r of res.results || []) {
        const p = batch[+String(r.id).replace(/\D/g, "") - 1];
        if (p) out.set(p.key, { relevant: !!r.relevant, reason: r.reason || "" });
      }
      onBatch?.(Math.min(i + RELEVANCE_BATCH, posts.length), posts.length);
    }
    return out;
  }

  // comments: [{id, postTitle, channelName, text, isReply}] (같은 글의 댓글끼리 이어서) → Map(id → 성향)
  async classifySentiments(job, comments, onBatch) {
    const out = new Map();
    const system = sentimentSystem(job, this.settings);
    for (let i = 0; i < comments.length; i += SENTIMENT_BATCH) {
      const batch = comments.slice(i, i + SENTIMENT_BATCH);
      let lastTitle = null;
      const lines = [];
      batch.forEach((c, j) => {
        if (c.postTitle !== lastTitle) {
          lines.push(`\n[게시글] (${c.channelName}) ${c.postTitle || "(제목 없음)"}`);
          lastTitle = c.postTitle;
        }
        lines.push(`${j + 1}\t${c.isReply ? "└답글 " : ""}${String(c.text).replace(/\s+/g, " ").slice(0, 600)}`);
      });
      let res;
      try {
        res = await this.callJson(system, `다음 댓글 ${batch.length}건(번호\t댓글)의 성향을 판정해 id(번호)마다 돌려줘.\n${lines.join("\n")}`, SENTIMENT_SCHEMA, "medium");
      } catch (e) {
        this.log(`  · 성향 분석 묶음 실패(${korMsg(e.message)}) → 반으로 나눠 다시`, "err");
        if (batch.length > 10) {
          const half = Math.ceil(batch.length / 2);
          const a = await this.classifySentiments(job, batch.slice(0, half));
          const b = await this.classifySentiments(job, batch.slice(half));
          for (const [k, v] of [...a, ...b]) out.set(k, v);
          onBatch?.(Math.min(i + SENTIMENT_BATCH, comments.length), comments.length);
          continue;
        }
        throw e;
      }
      for (const r of res.results || []) {
        const c = batch[+String(r.id).replace(/\D/g, "") - 1];
        if (c && SENTIMENTS.includes(r.s)) out.set(c.id, r.s);
      }
      // 빠진 댓글은 한 번 더
      const missing = batch.filter((c) => !out.has(c.id));
      if (missing.length && missing.length < batch.length) {
        const again = await this.classifySentiments(job, missing).catch(() => new Map());
        for (const [k, v] of again) out.set(k, v);
      }
      onBatch?.(Math.min(i + SENTIMENT_BATCH, comments.length), comments.length);
    }
    return out;
  }

  // stats: 통계 글, pool: {성향: [{id, text, channelName}]} → {title, summary[], quotes_short{}, quotes_long{}}
  async writeReport(job, stats, pool) {
    const lines = [];
    for (const s of SENTIMENTS) {
      lines.push(`\n## ${s} 댓글 후보`);
      for (const c of pool[s] || []) lines.push(`${c.id}\t(${c.channelName}) ${String(c.text).replace(/\s+/g, " ").slice(0, 300)}`);
    }
    return this.callJson(reportSystem(job, this.settings), `${stats}\n\n아래 후보 댓글(id\t(채널) 내용)에서 골라 줘.${lines.join("\n")}`, REPORT_SCHEMA, "high");
  }
}
