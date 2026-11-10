// GV90 게시물(앞으로는 댓글도) 분석: 차종 · 구분(이슈 분류) · 주요 내용 · 성향(긍정/중립/부정/단순비난)
// - 규칙(단어 사전)으로 먼저 정하고, Claude AI(API 키가 있을 때)로 본문을 읽고 다시 정할 수 있다.
// - 게시물과 댓글이 같은 함수를 쓴다 (kind: "post" | "comment") → 댓글 수집을 붙여도 분석은 그대로.

const CAR_NAME = "GV90";
const SENTIMENTS = ["긍정", "중립", "부정", "단순비난"];
const SENTI_CLASS = { 긍정: "pos", 중립: "neu", 부정: "neg", 단순비난: "blame" };
const CATEGORIES = ["품질", "디자인", "가격", "성능·주행", "편의사양", "판매·출고", "서비스", "일반"];

// 구분이 여러 개: '모두 포함(디자인+가격+판매·출고)' — 글 하나가 여러 이슈를 함께 다룰 때
const MULTI_CAT = "모두 포함";

// 구분 글자 → 분류 목록 ('모두 포함(디자인+가격)' → ['디자인', '가격'])
function catList(c) {
  const s = String(c || "").trim();
  const m = s.match(/^모두\s*포함\s*\((.*)\)$/);
  if (!m) return [CATEGORIES.includes(s) ? s : s || "일반"];
  const list = m[1].split(/\s*\+\s*/).map((x) => x.replace(/^판매출고$/, "판매·출고").replace(/^성능주행$/, "성능·주행")).filter(Boolean);
  return list.length ? list : ["일반"];
}

// 분류 목록 → 구분 글자 (0개 '일반', 1개 그대로, 2개 이상 '모두 포함(…)' · 순서는 CATEGORIES 순)
function catJoin(list) {
  const set = new Set((list || []).filter((c) => CATEGORIES.includes(c) && c !== "일반"));
  const out = CATEGORIES.filter((c) => set.has(c));
  if (!out.length) return "일반";
  if (out.length === 1) return out[0];
  return `${MULTI_CAT}(${out.join("+")})`;
}

// 글에 GV90 이 나오는지 (차종 확인용 · 띄어쓰기·대소문자 무시)
const CAR_WORDS = ["gv90", "지브이90", "지브이구공", "네오룬", "neolun", "jg1", "제네시스대형suv", "제네시스플래그십suv"];

function compact(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

function mentionsCar(text) {
  const t = compact(text);
  return CAR_WORDS.some((w) => t.includes(w));
}

// ---------------------------------------------------------------------------
// 규칙 사전 (설정 화면에서 더할 수 있게 문자열로 둠)
// ---------------------------------------------------------------------------

const DEFAULT_LEXICON = {
  pos: "만족, 좋아요, 좋네, 좋다, 좋습니다, 좋은, 좋았, 멋지, 멋있, 멋져, 예쁘, 이쁘, 이뻐, 최고, 훌륭, 고급스럽, 고급짐, 감동, 추천, 대박, 기대, 기대됩, 웅장, 편안, 조용, 정숙, 부드럽, 든든, 잘 나왔, 잘나왔, 잘 빠졌, 잘빠졌, 존재감, 품격, 럭셔리, 완벽, 가성비 좋, 축하, 부럽, 탐나, 갖고 싶, 사고 싶, 계약했, 출고 완료, 출고했, 무난, 짱",
  neg: "결함, 고장, 불량, 하자, 리콜, 누유, 누수, 소음, 잡소리, 단차, 떨림, 진동, 경고등, 먹통, 오류, 에러, 화재, 사고, 실망, 아쉽, 아쉬움, 별로, 불만, 비싸, 비쌈, 과하, 문제, 지연, 늦어, 취소, 불편, 답답, 후회, 걱정, 우려, 불안, 냄새, 결로, 부식, 꺼짐, 멈춤, 끊김, 짜증, 황당, 어이없, 엉망, 최악, 안 좋, 안좋, 좋지 않, 좋지않, 못하, 떨어지, 부족, 품질 논란, 논란, 하락",
  blame: "쓰레기, 똥차, 흉기차, 현기차, 개차반, 호구, 흉물, 못생, 못난이, 극혐, 망했, 망함, 노답, 병신, ㅂㅅ, 시발, ㅅㅂ, 씨발, 존나, ㅈㄴ, 개못, 거른다, 거르세요, 사기꾼, 양아치, 국뽕, 니들이, 꼴값, 답없, 장사꾼, 등골, 봉이냐, 개돼지, 노예, 정신 나간, 미친",
};

const CATEGORY_WORDS = {
  품질: "결함, 고장, 불량, 하자, 리콜, 누유, 누수, 소음, 잡소리, 단차, 부식, 경고등, 먹통, 오류, 에러, 떨림, 진동, 화재, 품질, 냄새, 결로, 도장, 마감, 꺼짐, 멈춤, 끊김, 무상수리",
  디자인: "디자인, 외관, 외장, 실내, 내장, 인테리어, 그릴, 램프, 헤드램프, 리어램프, 휠, 색상, 컬러, 못생, 예쁘, 이쁘, 멋지, 멋있, 비율, 뒷모습, 앞모습, 측면, 실루엣, 크기, 덩치",
  가격: "가격, 비싸, 비쌈, 견적, 할인, 프로모션, 옵션가, 가성비, 억원, 천만원, 만원, 보조금, 출고가, 트림가, 세금, 리스, 렌트",
  "성능·주행": "주행, 승차감, 전비, 연비, 주행거리, 충전, 배터리, 가속, 출력, 마력, 토크, 서스펜션, 에어서스, 핸들링, 제동, 브레이크, 정숙, 소음 차단, 고속, 오프로드",
  편의사양: "시트, 옵션, 사양, 인포테인먼트, 디스플레이, 화면, 내비, adas, hda, 자율주행, 오디오, 뱅앤올룹슨, 무드, 공조, ota, 업데이트, 냉장고, 마사지, 2열, 3열, 트렁크, 적재, 수납, 소프트웨어",
  "판매·출고": "계약, 사전계약, 출고, 대기, 납기, 출시, 판매, 인도, 시승, 전시, 공개, 런칭, 생산, 양산, 수출, 판매량, 계약 대수",
  서비스: "서비스센터, 블루핸즈, 정비, a/s, 상담, 딜러, 카마스터, 응대, 보증, 고객센터, 제네시스 스튜디오, 전시장",
};

function wordList(text) {
  return [...new Set(String(text || "").split(/[,\n]/).map((w) => compact(w)).filter(Boolean))];
}

// 사전: 기본 + 설정에서 더한 단어 { pos, neg, blame } (문자열)
let lexicon = { pos: wordList(DEFAULT_LEXICON.pos), neg: wordList(DEFAULT_LEXICON.neg), blame: wordList(DEFAULT_LEXICON.blame) };
const categoryLexicon = Object.fromEntries(Object.entries(CATEGORY_WORDS).map(([k, v]) => [k, wordList(v)]));

function setExtraLexicon(extra = {}) {
  for (const k of ["pos", "neg", "blame"]) lexicon[k] = [...new Set([...wordList(DEFAULT_LEXICON[k]), ...wordList(extra[k])])];
}

function countHits(t, words) {
  let n = 0;
  for (const w of words) if (w && t.includes(w)) n++;
  return n;
}

// 성향 (규칙): 비난 단어만 있고 구체적인 불만 내용이 없으면 '단순비난', 부정 > 긍정 이면 '부정', 긍정 > 부정 이면 '긍정', 아니면 '중립'
function ruleSentiment(text) {
  const t = compact(text);
  const pos = countHits(t, lexicon.pos);
  const neg = countHits(t, lexicon.neg);
  const blame = countHits(t, lexicon.blame);
  if (blame && neg <= 1 && pos === 0) return "단순비난";
  if (neg + blame > pos) return "부정";
  if (pos > neg + blame) return "긍정";
  return "중립";
}

// 구분 (규칙): 단어가 가장 많이 걸리는 분류 + 함께 비중 있게 다룬 분류(단어 2개 이상 · 또는 가장 많은 분류와 같은 수)
//  → 여러 개면 '모두 포함(디자인+가격+판매·출고)' · 없으면 '일반'
function ruleCategory(text) {
  const t = compact(text);
  const hits = CATEGORIES.map((c) => [c, countHits(t, categoryLexicon[c] || [])]);
  const bestN = Math.max(0, ...hits.map(([, n]) => n));
  if (!bestN) return "일반";
  return catJoin(hits.filter(([, n]) => n && (n >= 2 || n === bestN)).map(([c]) => c));
}

// 주요 내용 (규칙): 제목을 다듬고, 본문 첫 문장이 있으면 짧게 덧붙임
// 본문에 섞여 들어온 군더더기(스크립트 코드·동영상 대체 문구·링크) 빼기
function cleanBody(s) {
  return String(s || "")
    .replace(/window\.onload[\s\S]*?(?=[가-힣]{2}|$)/g, " ")
    .replace(/\$\(\s*(?:document|window|function)[\s\S]*?(?=[가-힣]{2}|$)/g, " ")
    .replace(/(?:function\s*\([^)]*\)\s*\{|var\s+\w+\s*=|document\.\w+|\}\s*\)\s*;?)/g, " ")
    .replace(/Your browser does not support[^.]*\.?/gi, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ruleSummary({ title = "", body = "" }) {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/^\[[^\]]{1,12}\]\s*/, "").trim();
  const t = clean(title);
  const first = clean(cleanBody(body)).split(/(?<=[.!?。]|다\.|요\.)\s+/)[0] || "";
  const add = first && !t.includes(first.slice(0, 12)) ? ` - ${first.slice(0, 60)}${first.length > 60 ? "…" : ""}` : "";
  return (t + add).slice(0, 120);
}

// 규칙 분석 한 건: x = { title, body|text } → { sentiment, category, summary, car }
function ruleAnalyze(x) {
  const text = `${x.title || ""} ${cleanBody(x.body || x.text || "")}`;
  return {
    sentiment: ruleSentiment(text),
    category: ruleCategory(text),
    summary: ruleSummary({ title: x.title, body: x.body || x.text }),
    car: CAR_NAME,
    by: "rule",
  };
}

// ---------------------------------------------------------------------------
// Claude AI 분석 (공식 Anthropic SDK · 전역 Anthropic)
// ---------------------------------------------------------------------------

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (빠르고 저렴)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴)"],
];
// 백만 토큰당 달러 (입력, 출력)
const AI_PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
const WON_PER_USD = 1400;
const AI_BATCH = 15;
const AI_PARALLEL = 3;

const AI_SYSTEM = `당신은 현대자동차그룹 제네시스 브랜드의 온라인 여론 모니터링 담당자입니다.
언론·동호회(네이버 카페)·유튜브·자동차 커뮤니티에 올라온 GV90(개발명 JG1, 콘셉트카 '네오룬') 관련 게시물이나 댓글을 읽고 일일 동향 로데이터를 작성합니다.

항목마다 다음을 정합니다.
- related: GV90(JG1·네오룬)에 대한 글이면 true. 다른 차 이야기에 GV90 이름만 스치듯 나오거나(예: 차종 나열), 광고·스팸·무관한 글이면 false.
- categories(구분): 글이 실제로 다룬 이슈를 모두 고릅니다(주된 것 먼저, 보통 1~3개). 품질(결함·고장·소음·누수·리콜 등) / 디자인 / 가격 / 성능·주행 / 편의사양 / 판매·출고(계약·출시·대기·시승) / 서비스(정비·딜러 응대) / 일반(소식 공유·잡담 등 위에 없음).
  단어가 스치듯 나온 것은 빼고, 글에서 내용으로 다룬 이슈만 넣습니다. 댓글은 원글이 아니라 그 댓글이 말한 내용만으로 구분합니다(원글과 다른 이야기를 할 수 있음 · 반응만 있는 짧은 댓글은 일반). 여러 개를 고르면 보고서에 '모두 포함(디자인+가격+판매·출고)'으로 표기됩니다.
- sentiment(성향): GV90 과 제네시스에 대한 글쓴이의 태도.
  · 긍정: 호감·만족·기대·칭찬이 중심.
  · 중립: 사실 전달(기사·출시 소식·제원 공유), 단순 질문·정보 요청, 장단점이 비슷하게 섞임.
  · 부정: 구체적인 근거가 있는 불만·우려·비판(품질 문제, 가격 불만, 출고 지연, 디자인에 대한 이유 있는 비판 등).
  · 단순비난: 근거나 구체적 내용 없이 욕설·비하·조롱만 있는 글(예: '현기차 거른다', '흉물').
  언론 기사는 제목·요약의 논조로 판단하며, 단순 출시·판매 보도는 중립입니다.
- summary(주요 내용): 보고서 문체로 한 문장(60자 안팎, '~함', '~언급' 처럼 명사형 끝맺음). 무엇에 대해 어떤 반응인지가 드러나게 씁니다. 글에 없는 내용은 지어내지 않습니다.
입력에 없는 사실을 추측하지 말고, 모든 항목에 대해 빠짐없이 결과를 돌려줍니다.`;

const AI_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          related: { type: "boolean" },
          categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
          sentiment: { type: "string", enum: SENTIMENTS },
          summary: { type: "string" },
        },
        required: ["id", "related", "categories", "sentiment", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function aiCostWon(inputTokens, outputTokens, model) {
  const [pin, pout] = AI_PRICE[model] || AI_PRICE["claude-opus-5-5"];
  return ((inputTokens * pin + outputTokens * pout) / 1e6) * WON_PER_USD;
}

function fmtWon(won) {
  return won < 10 ? "10원 미만" : `약 ${Math.round(won).toLocaleString()}원`;
}

// 예상 비용: 글자 수로 대략 (한글 1자 ≈ 1토큰)
function aiEstimate(list, model) {
  const chars = list.reduce((n, x) => n + (x.title || "").length + Math.min(1200, (x.body || x.text || "").length) + 80, 0);
  const batches = Math.ceil(list.length / AI_BATCH);
  return aiCostWon(chars + 900 * batches, list.length * 120 + 400 * batches, model);
}

function aiErrorText(e) {
  if (typeof Anthropic === "undefined") return "AI 도구를 불러오지 못했습니다";
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없습니다";
  if (e instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다(잠시 후 다시 시도)";
  if (e instanceof Anthropic.APIConnectionError) return "Claude API 에 연결하지 못했습니다(인터넷 확인)";
  if (e instanceof Anthropic.APIError) return `Claude API 오류: ${e.message}`;
  return e?.message || String(e);
}

// 한 묶음 분석 → Map(id → 결과)
async function aiAnalyzeBatch(client, model, batch, kind, usage) {
  const input = batch.map((x) => ({
    id: x.key,
    종류: kind === "comment" ? "댓글" : "게시물",
    채널: x.channel || "",
    매체: x.media || "",
    제목: kind === "comment" ? `(원글) ${x.postTitle || ""}` : x.title || "",
    내용: String(x.body || x.text || "").replace(/\s+/g, " ").slice(0, 1200),
  }));
  const params = {
    model,
    max_tokens: 16000,
    system: AI_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{ role: "user", content: `아래 ${batch.length}건을 분석해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
  };
  // 거절(refusal) 때 다른 모델로 이어 받기 (Haiku 는 서버 쪽 대체 모델이 없음)
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  usage.won += aiCostWon(msg.usage?.input_tokens || 0, msg.usage?.output_tokens || 0, model);
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 분석을 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  const missing = batch.filter((x) => !byId.get(x.key)).length;
  if (missing) throw new Error(`결과 ${missing}건이 빠졌습니다`);
  return byId;
}

// 여러 건 AI 분석: list 의 각 항목에 결과를 적용(onResult(x, r)) · 진행은 onProgress(done, total)
// → { usage, failed, fatal }
async function aiAnalyze(list, { apiKey, model, kind = "post", isStopped = () => false, onResult, onProgress }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const batches = [];
  for (let i = 0; i < list.length; i += AI_BATCH) batches.push(list.slice(i, i + AI_BATCH));
  const usage = { input: 0, output: 0, won: 0 };
  let next = 0;
  let done = 0;
  let failed = 0;
  let fatal = null;
  const worker = async () => {
    while (next < batches.length && !fatal && !isStopped()) {
      const batch = batches[next++];
      let res = null;
      for (let attempt = 1; attempt <= 3 && !res && !fatal; attempt++) {
        try {
          res = await aiAnalyzeBatch(client, model, batch, kind, usage);
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
          else if (attempt === 3) console.warn("AI 분석 실패", e);
        }
      }
      if (res) {
        for (const x of batch) {
          const r = res.get(x.key);
          onResult?.(x, {
            related: !!r.related,
            category: catJoin(r.categories || [r.category]),
            sentiment: SENTIMENTS.includes(r.sentiment) ? r.sentiment : "중립",
            summary: String(r.summary || "").replace(/\s+/g, " ").trim().slice(0, 200),
            car: CAR_NAME,
            by: "ai",
          });
        }
      } else failed += batch.length;
      done++;
      onProgress?.(done, batches.length);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  return { usage, failed, fatal: fatal ? aiErrorText(fatal) : "" };
}

if (typeof module !== "undefined") module.exports = { ruleAnalyze, ruleSentiment, ruleCategory, ruleSummary, mentionsCar, SENTIMENTS, CATEGORIES, catList, catJoin };
