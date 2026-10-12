// AI 요약 (Claude API) - 게시글 본문·댓글을 읽고 보고서 문구(제목 증상, 내용 요약, 댓글 반응, 불만 단계 등)를 작성한다.
// 공식 Anthropic SDK(lib/anthropic-sdk.min.js, 전역 Anthropic)를 쓴다. API 키는 이 PC 크롬에만 저장된다.

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴)"],
];

// 내용 요약 칸은 반드시 2줄(본문 요약 1줄 + 댓글 반응 1줄)이 되도록 길이를 제한한다
const BODY_MAX = 55;
const REACTION_MAX = 50; // "댓글 반응 : " 뒤에 들어가는 글자 수

const AI_SYSTEM = `당신은 현대자동차 온라인 이슈 보고서를 작성하는 모니터링 담당자입니다.
자동차 동호회(네이버 카페) 게시글의 제목·본문·댓글을 읽고, 보고서 칸에 들어갈 문구를 작성합니다.

[표현 기준]
- 게시글에 작성된 현상만 간결한 보고체로 씁니다. 전후 사정보다 증상 전달에 초점을 둡니다.
- 자극적·부정적 표현 대신 사실 중심의 순화된 표현을 씁니다. 표준어의 쉬운 표현으로 씁니다.
- "에러", "결함"은 쓰지 않습니다. "증상", "현상", "오류", "불량", "고장", "문제" 등으로 바꿉니다.
- 문장 시작 유형: [출고] "최근 출고한 차량에서", "출고 후 3개월 된 차량에서" / [주행 중] "주행 중에", "정차 중에", "주차 중에" / [차량의] "차량의 ○○ 부분에서"
- 문장 끝 유형: 증상을 묻는 글은 "~며 증상에 대해 문의하는 내용", 강하게 항의하는 글은 "~며 품질에 대해 불만 토로하는 내용"(응대 불만이면 "응대에 대해"), 사진·영상으로 상황을 알리는 글은 "~며 공유하는 내용".
  예) 차량의 리어 스텝 부분에서 녹이 발생해 도색 불량을 의심한다며 증상에 대해 문의하는 내용

[작성 항목]
- issue: 슬라이드 제목의 증상 부분. 차명은 빼고 10글자 내외의 명사형. 예) "엔진 경고등 점등", "펜더 부식", "선루프 개폐 오류 및 각종 불량"
- short: 첫 장 요약표의 '내용 요약'. 한 줄(35자 이내) 명사형. 예) "시동 시 엔진 소음 및 진동 발생 후 엔진 경고등 점등"
- body: 상세 슬라이드의 본문 요약. 위 문장 유형을 따른 한 문장. 반드시 ${BODY_MAX}자 이내(한 줄에 들어가야 함). 넘으면 덜 중요한 정황을 빼고 줄입니다.
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
async function aiSummarize(row, info, { apiKey, model }) {
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
    comments,
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
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 이 글의 요약을 거절했습니다");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = JSON.parse(text);
  const valid = new Set(comments.map((c) => c.index));
  out.comment_picks = [...new Set((out.comment_picks || []).filter((i) => valid.has(i)))].slice(0, 2);
  if (!out.comment_picks.length) out.comment_picks = defaultPicks(info);
  for (const k of ["issue", "spec", "short", "body", "reaction", "duplicate", "region"]) out[k] = String(out[k] || "").trim();
  return out;
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
  const main = (row.main || "").trim();
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
