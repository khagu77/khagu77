// AI 요약 (Claude API) - 게시글 본문·댓글을 읽고 보고서 문구(제목 증상, 내용 요약, 댓글 반응, 불만 단계 등)를 작성한다.
// 공식 Anthropic SDK(lib/anthropic-sdk.min.js, 전역 Anthropic)를 쓴다. API 키는 이 PC 크롬에만 저장된다.

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴)"],
];

// 내용 요약 칸은 반드시 2줄(본문 요약 1줄 + 댓글 반응 1줄)이 되도록 길이를 제한한다
const BODY_MIN = 60; // 한 줄(약 75자)을 꽉 채우도록
const BODY_MAX = 72;
const REACTION_MAX = 60; // "댓글 반응 : " 뒤에 들어가는 글자 수

const AI_SYSTEM = `당신은 현대자동차 온라인 이슈 보고서를 작성하는 모니터링 담당자입니다.
자동차 동호회(네이버 카페) 게시글의 제목·본문·댓글을 읽고, 보고서 칸에 들어갈 문구를 작성합니다.

[표현 기준]
- 게시글에 작성된 현상만 간결한 보고체로 씁니다. 전후 사정보다 증상 전달에 초점을 둡니다.
- 자극적·부정적 표현 대신 사실 중심의 순화된 표현을 씁니다. 표준어의 쉬운 표현으로 씁니다.
- "에러", "결함"은 쓰지 않습니다. "증상", "현상", "오류", "불량", "고장", "문제" 등으로 바꿉니다.
- 작성자가 "내비", "네비"라고 썼어도 보고서에는 반드시 "내비게이션"으로 씁니다.
- "계기판"이라고 쓰지 않고 반드시 "계기반"으로 씁니다. (작성자가 계기판이라고 썼어도)
- "~으나"로 이어지는 문장 뒤에는 반드시 쉼표를 찍습니다. (예: 점등되어 하이테크센터에서 수리받았으나, 안내 미흡 / 발생해 부품 교체했으나, 시트 소음 지속)
- "돼", "됐" 줄임 표현은 쓰지 않고 "되어", "되었"으로 풀어 씁니다. (예: 확인돼 → 확인되어, 점등됐다며 → 점등되었다며)
- 문장 시작 유형: [출고] "최근 출고한 차량에서", "출고 후 3개월 된 차량에서" / [주행 중] "주행 중에", "정차 중에", "주차 중에" / [차량의] "차량의 ○○ 부분에서"
- 문장 끝맺음은 글의 성격에 맞게 아래 유형을 골고루 섞어 씁니다. 모든 글을 "~하는 내용"으로 끝내지 않습니다.
  · 불만을 강하게 표출한 글: "~며 품질 관련 불만글 게재", "~에 대한 불만글 게재", "~며 품질에 대해 불만 토로" (응대 불만이면 "응대 관련")
  · 같은 증상을 겪은 사람이나 해결책을 묻는 글: "~ 동일 증상 여부 및 해결 방안 문의", "~ 원인 및 조치 방법 문의", "~며 증상에 대해 문의하는 내용"
  · 사진·영상을 함께 올린 글(photoCount 가 1 이상): "~ 증상 관련 사진과 함께 글 게재", "~ 영상과 함께 공유"
  · 정비·수리 경과를 알리는 글: "~ 정비 후기 공유", "~ 조치 경과 공유"
  예) 차량의 리어 스텝 부분에서 녹이 발생해 도색 불량을 의심한다며 증상에 대해 문의하는 내용
  예) 출고 4개월 된 차량에서 선루프 오작동, 네트워크 오류, 시트 소음이 발생했다며 품질 관련 불만글 게재
  예) 냉간 시동 시 소음·진동과 함께 엔진 경고등이 점등돼 동일 증상 여부 및 해결 방안 문의
  예) 운전석 뒤 펜더 안쪽에 녹이 올라와 도장이 들뜬 증상 관련 사진과 함께 글 게재
  recentBodies(같은 보고서에서 앞서 쓴 본문 요약)와 끝맺음이 겹치지 않게 다른 유형을 우선 고릅니다.

[작성 항목]
- issue: 슬라이드 제목의 증상 부분. 차명은 빼고 10글자 내외의 명사형. 예) "엔진 경고등 점등", "펜더 부식", "선루프 개폐 오류 및 각종 불량"
- short: 첫 장 요약표의 '내용 요약'. 구구절절한 설명·미사여구 없이 깔끔하게, 필요한 내용만 키워드 중심의 명사형으로 (35자 이내).
  담당자가 직접 다듬은 예) "타이어 공기압 경고등 및 도장·루프 필러 조립 불량" / "라디에이터 캡 냉각수 누수" /
  "HUD 부품 결품으로 2개월 수리 지연" / "테일게이트 부위 부식 발생" / "시동 시 내비게이션 디스플레이 불량 발생"
- body: 상세 슬라이드의 본문 요약 한 문장. 첫 줄 한 줄을 꽉 채우도록 반드시 ${BODY_MIN}~${BODY_MAX}자로 씁니다.
  너무 짧게 쓰지 말고 게시글의 주요 내용을 풍부하게, 포인트를 잘 잡아 담습니다:
  차량 상태(출고 시기·주행거리 등) → 언제·어떤 상황에서 → 어떤 증상이 → 어떤 조치(입고·교체·진단 결과)를 받았고 → 작성자가 무엇을 원하는지/어떤 불만인지.
  위 문장 시작·끝맺음 유형을 따릅니다. ${BODY_MAX}자를 넘으면 덜 중요한 정황부터 뺍니다.
- reaction: 댓글 반응 한 줄. 캡처할 댓글(comment_picks) 2개를 고른 순서대로 요약합니다. 말 그대로 '여론'이므로 댓글의 말투를 따릅니다.
  · 댓글을 그대로 옮기지 말고 오탈자·맞춤법을 고쳐 핵심만 자연스럽게 다듬습니다.
  · 댓글이 존댓말이면 존댓말로, 반말이면 반말로 씁니다. (예: "못 해요"는 "못 해요"로, "안 되네"는 "안 되네"로)
  · 각 댓글 요약은 문장 끝에 반드시 마침표(.)를 찍습니다. 느낌표·물음표로 끝난 댓글이면 그 기호(! ?)를 씁니다.
  · 두 댓글 요약 사이에는 반드시 쉼표(,)를 넣습니다. 마침표 뒤에도 쉼표를 붙입니다.
  · 전체를 ‘ ’(작은따옴표)로 한 번 묶고 " 등의 여론"으로 끝냅니다. 반드시 ${REACTION_MAX}자 이내.
  예) ‘이건 제작이 잘못된 것 같습니다., 블루핸즈 말고 사업소에 가서 강하게 항의하세요!’ 등의 여론
  예) ‘업데이트되면 아무것도 못 해요., 업데이트하면 딱 멈춰 버리네요.’ 등의 여론
  댓글이 없거나 의미 있는 반응이 없으면 빈 문자열.
- spec: 제원. "2.5T", "3.5T", "1.6T", "2.0", "2.5", "HEV", "EV", "LPI", "디젤" 처럼 짧게.
  게시글 본문에서 먼저 찾고, 없으면 authorPosts(작성자의 다른 글 제목)와 authorCertPosts(작성자의 계약인증·출고인증 글 본문)에서 확인하거나 유추합니다.
  하이브리드는 "HEV", 전기차는 "EV". 아무리 봐도 근거가 없으면 "-".
- level: 불만 단계. 대부분은 "주의"입니다.
  주의 = 일반적인 품질 불만·문의 (도장 불량, 단차, 소음, 경고등, 기능 오작동 등 대부분)
  경고 = 악성 민원(강한 항의·집단 행동·언론 제보 예고 등) 또는 주요하고 심각한 이슈 (주행 중 시동 꺼짐, 차가 움직이지 않음 등 운행에 직접 영향)
  심각 = 운행 불가 및 생명의 위협을 느꼈을 이슈 (화재, 급발진, 사고 등)
- duplicate: 아래 두 가지를 러프하게 더한 수.
  ① 댓글 중 "저도 그래요", "나도 그랬다"처럼 같은 증상을 겪었다는 뉘앙스의 댓글 수
  ② boardPosts(이 글이 있는 게시판의 최근 글 목록) 중 게시일(postDate) 기준 최근 3개월 안의 같은 차종·같은 증상 관련 게시글 수 (이 글 자신은 빼고, 날짜가 시간만 있으면 최근 글)
  합이 0이면 "신규", 있으면 "중복 N건". 대부분은 "신규"입니다.
- region: 입고/운행 지역. 먼저 작성자 닉네임(author)에서 지역을 판단합니다(예: "부산ll홍길동" → 부산, "파주II아무개" → 파주).
  닉네임으로 알 수 없으면 authorPosts(작성자의 다른 글 제목)와 본문에서 지역이 분명히 드러나면 씁니다. 시·구까지만(예: "부산", "경기 오산", "서울 강동구").
  알 수 없으면 "-".
- comment_picks: 보고서에 캡처해 넣을 댓글 번호(index) 2개 (reaction 에 쓴 순서대로). 자극적이거나 심각하다고 느껴지는, 길지 않은 댓글을 우선 고릅니다.
  hasSticker 가 true 인(이모티콘이 있는) 댓글은 될 수 있으면 고르지 말고, 그것밖에 없을 때만 고릅니다. 댓글이 2개보다 적으면 있는 만큼.`;

const AI_SCHEMA = {
  type: "object",
  properties: {
    issue: { type: "string" },
    spec: { type: "string" },
    short: { type: "string" },
    body: { type: "string" },
    reaction: { type: "string" },
    level: { type: "string", enum: ["주의", "경고", "심각"] },
    duplicate: { type: "string" },
    region: { type: "string" },
    comment_picks: { type: "array", items: { type: "integer" } },
  },
  required: ["issue", "spec", "short", "body", "reaction", "level", "duplicate", "region", "comment_picks"],
  additionalProperties: false,
};

function aiErrorMessage(e) {
  if (typeof Anthropic === "undefined") return "AI 도구를 불러오지 못했습니다";
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없습니다";
  if (e instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다(잠시 후 다시 시도)";
  if (e instanceof Anthropic.BadRequestError) return `요청 오류: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Claude API 에 연결하지 못했습니다(인터넷 확인)";
  if (e instanceof Anthropic.APIError) return `Claude API 오류: ${e.message}`;
  return e && e.message ? e.message : String(e);
}

// row: 엑셀 행, info: 캡처에서 읽은 글 정보 → AI_SCHEMA 모양의 결과
async function aiSummarize(row, info, { apiKey, model, recentBodies = [] }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const comments = (info.comments || []).map((c) => ({
    index: c.index,
    text: c.text.slice(0, 400),
    length: c.text.length,
    hasSticker: !!c.hasSticker,
  }));
  const input = {
    excel: { 차종: row.car, 구분: row.kind, 카페: row.cafe, 담당자메모: row.main },
    title: info.title || "",
    author: info.author || "",
    postDate: info.postDate || "",
    body: info.bodyText || "",
    photoCount: (info.images || []).length,
    comments,
    recentBodies: recentBodies.slice(-6),
    authorPosts: (info.authorPosts || []).slice(0, 30).map((p) => ({ title: p.title, date: p.date })),
    authorCertPosts: info.authorCertPosts || [],
    boardPosts: (info.boardPosts || []).map((p) => ({ title: p.title, date: p.date })),
  };
  const params = {
    model,
    max_tokens: 4000,
    system: AI_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `아래 게시글로 보고서 문구를 작성해 주세요. excel.담당자메모는 모니터링 담당자가 엑셀에 적은 한 줄 요약이니 증상 파악에 참고하세요.\n\n${JSON.stringify(input)}`,
      },
    ],
  };
  const out = await askJson(client, model, params);
  const valid = new Set(comments.map((c) => c.index));
  out.comment_picks = [...new Set((out.comment_picks || []).filter((i) => valid.has(i)))].slice(0, 2);
  if (!out.comment_picks.length) out.comment_picks = defaultPicks(info);
  for (const k of ["issue", "spec", "short", "body", "reaction", "duplicate", "region"]) out[k] = String(out[k] || "").trim();
  fixWording(out);

  // 내용 요약 2줄 엄수 + 첫 줄 꽉 채우기: 본문 요약이 너무 짧거나 길면, 댓글 반응이 길면 한 번 더 맞춰 달라고 한다
  if (out.body.length > BODY_MAX || out.body.length < BODY_MIN || out.reaction.length > REACTION_MAX) {
    try {
      const short = await askJson(client, model, {
        model,
        max_tokens: 1000,
        system: AI_SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SHORTEN_SCHEMA } },
        messages: [
          {
            role: "user",
            content:
              `아래 body 는 ${BODY_MIN}~${BODY_MAX}자가 되도록 고쳐 주세요. 짧으면 게시글 본문에서 핵심 정황(차량 상태·상황·조치·요구)을 더해 ` +
              `풍부하게, 길면 덜 중요한 말을 빼서 줄입니다. reaction 은 ${REACTION_MAX}자를 넘으면 줄이고 아니면 그대로 둡니다. ` +
              `문장 유형, 댓글 말투(존댓말), 마침표·쉼표·‘ ’ 등의 여론 형식은 그대로 지킵니다.\n\n` +
              JSON.stringify({ body: out.body, reaction: out.reaction, 게시글본문: (info.bodyText || "").slice(0, 3000) }),
          },
        ],
      });
      const nb = (short.body || "").trim();
      const dist = (n) => (n < BODY_MIN ? BODY_MIN - n : n > BODY_MAX ? n - BODY_MAX : 0);
      if (nb && dist(nb.length) <= dist(out.body.length)) out.body = nb;
      if (out.reaction && short.reaction && short.reaction.trim().length <= out.reaction.length) out.reaction = short.reaction.trim();
    } catch {
      /* 줄이지 못하면 원래 문장 (미리보기에서 글자 수가 빨갛게 표시됨) */
    }
  }
  fixWording(out);
  return out;
}

// 보고서 표기 규칙을 한 번 더 확실히: 내비/네비 → 내비게이션, 계기판 → 계기반, 돼/됐 → 되어/되었
// (댓글 반응은 댓글 말투를 따르므로 내비게이션·계기반만)
function fixWording(out) {
  const nav = (t) => String(t || "").replace(/(내비|네비)(게이션)?/g, "내비게이션").replace(/계기판/g, "계기반");
  const doe = (t) => String(t || "").replace(/됐/g, "되었").replace(/돼/g, "되어");
  // "~으나" 뒤 쉼표 ("수리받았으나 안내" → "수리받았으나, 안내")
  const comma = (t) => String(t || "").replace(/으나(?=\s)(?!,)/g, "으나,");
  for (const k of ["issue", "short", "body"]) if (out[k]) out[k] = comma(doe(nav(out[k])));
  if (out.reaction) out.reaction = nav(out.reaction);
  return out;
}

const SHORTEN_SCHEMA = {
  type: "object",
  properties: { body: { type: "string" }, reaction: { type: "string" } },
  required: ["body", "reaction"],
  additionalProperties: false,
};

// 예상 AI 비용: 모델별 100만 토큰당 가격(달러) [입력, 출력, 캐시 읽기] — Anthropic 공개 가격 기준
const AI_PRICES = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};
const USD_KRW = 1400; // 원화 환산용 대략 환율
// 이번 작업에서 쓴 토큰·비용 누계 (작업을 시작할 때 AiCost.reset())
const AiCost = {
  usd: 0,
  input: 0,
  output: 0,
  calls: 0,
  reset() {
    this.usd = 0;
    this.input = 0;
    this.output = 0;
    this.calls = 0;
  },
  add(model, usage) {
    if (!usage) return;
    const [pin, pout, pread] = AI_PRICES[model] || AI_PRICES["claude-opus-5-5"];
    const input = usage.input_tokens || 0;
    const write = usage.cache_creation_input_tokens || 0;
    const read = usage.cache_read_input_tokens || 0;
    const output = usage.output_tokens || 0;
    this.usd += (input * pin + write * pin * 1.25 + read * pread + output * pout) / 1e6;
    this.input += input + write + read;
    this.output += output;
    this.calls++;
  },
  // "약 1,230원 ($0.88)"
  text() {
    const won = Math.round(this.usd * USD_KRW);
    return `약 ${won.toLocaleString("ko-KR")}원 ($${this.usd.toFixed(2)})`;
  },
};

async function askJson(client, model, params) {
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  // 다른 모델로 넘어가 답한 경우(fallback)엔 실제로 답한 모델 가격으로
  AiCost.add(AI_PRICES[msg.model] ? msg.model : model, msg.usage);
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 이 글의 요약을 거절했습니다");
  return JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
}

// 기본 댓글 2개: 이모티콘 없는 짧은 댓글 우선
function defaultPicks(info) {
  return [...(info?.comments || [])]
    .sort((a, b) => (a.hasSticker - b.hasSticker) || (a.text.length - b.text.length))
    .slice(0, 2)
    .map((c) => c.index);
}

// API 키가 없을 때: 엑셀 '주요 내용'으로 초안만 채운다 (나머지는 미리보기에서 직접 입력)
function excelDraft(row, info) {
  const main = fixWording({ short: (row.main || "").trim() }).short;
  return {
    issue: main,
    spec: "",
    short: main,
    body: main,
    reaction: "",
    level: "주의",
    duplicate: "",
    region: "",
    comment_picks: defaultPicks(info),
  };
}
