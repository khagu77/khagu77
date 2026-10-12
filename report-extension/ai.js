// AI 요약 (Claude API) - 게시글 본문·댓글을 읽고 보고서 문구(제목 증상, 내용 요약, 댓글 반응, 불만 단계 등)를 작성한다.
// 공식 Anthropic SDK(lib/anthropic-sdk.min.js, 전역 Anthropic)를 쓴다. API 키는 이 PC 크롬에만 저장된다.

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴)"],
];

const AI_SYSTEM = `당신은 현대자동차 온라인 이슈 보고서를 작성하는 모니터링 담당자입니다.
자동차 동호회(네이버 카페) 게시글의 제목·본문·댓글을 읽고, 보고서 칸에 들어갈 문구를 작성합니다.

[표현 기준]
- 게시글에 작성된 현상만 간결한 보고체로 씁니다. 전후 사정보다 증상 전달에 초점을 둡니다.
- 자극적·부정적 표현 대신 사실 중심의 순화된 표현을 씁니다. 표준어의 쉬운 표현으로 씁니다.
- "에러", "결함"은 쓰지 않습니다. "증상", "현상", "오류", "불량", "고장", "문제" 등으로 바꿉니다.
- 문장 시작 유형: [출고] "최근 출고한 차량에서", "출고 후 3개월 된 차량에서" / [주행 중] "주행 중에", "정차 중에", "주차 중에" / [차량의] "차량의 ○○ 부분에서"
- 문장 끝 유형: 증상을 묻는 글은 "~며 증상에 대해 문의하는 내용", 강하게 항의하는 글은 "~며 품질에 대해 불만 토로하는 내용"(응대 불만이면 "응대에 대해"), 사진·영상으로 상황을 알리는 글은 "~며 공유하는 내용".
  예) 차량의 리어 스텝 부분에서 녹이 발생해 도색 불량을 의심한다며 증상에 대해 문의하는 내용
  예) 시동 시 엔진 소음 및 진동 발생 후 엔진 경고등이 점등되어 블루핸즈에서 2번 및 4번 점화 코일 교체 조치를 받았다며 증상에 대해 문의하는 내용

[작성 항목]
- issue: 슬라이드 제목의 증상 부분. 차명은 빼고 10글자 내외의 명사형. 예) "엔진 경고등 점등", "펜더 부식", "선루프 개폐 오류 및 각종 불량"
- short: 첫 장 요약표의 '내용 요약'. 한 줄(35자 이내) 명사형. 예) "시동 시 엔진 소음 및 진동 발생 후 엔진 경고등 점등"
- body: 상세 슬라이드의 본문 요약. 위 문장 유형을 따른 한 문장(90자 이내).
- reaction: 댓글 반응을 한 줄로. 핵심 댓글을 표준어로 다듬어 작은따옴표로 인용하고 "등의 여론"으로 끝냅니다.
  예) '이것은 제작이 잘못된 것 같다, 블루핸즈 말고 사업소에 가서 강하게 항의하라' 등의 여론
  댓글이 없거나 의미 있는 반응이 없으면 빈 문자열.
- level: 불만 단계.
  주의 = 운행에 크게 지장이 없고 중복 이슈가 없거나 공론화되지 않을 수준 (도장 불량, 단차, 소음, 색상 이색 등)
  경고 = 엔진/시동/멈춤 등 차량 운행에 직접 영향을 주는 이슈, 동일 증상을 호소하는 댓글이 보이는 경우 (엔진오일 감소, 충전 멈춤, 차가 움직이지 않음 등)
  심각 = 운행 불가 및 생명의 위협을 느꼈을 이슈 (화재, 급발진 등)
- duplicate: 댓글 중 다른 사용자가 같은 증상을 겪었다고 한 댓글 수. 0이면 "신규", 있으면 "중복 N건".
- region: 작성자가 본문에 입고 지점·운행 지역을 명확히 적은 경우에만 시·구까지만(예: "부산 사상구", "경기 오산"). 없으면 "-".
- comment_picks: 보고서에 캡처해 넣을 댓글 번호(index) 최대 3개. 증상 공감·동일 증상·여론을 잘 보여주는 댓글을 고릅니다. 없으면 빈 배열.`;

const AI_SCHEMA = {
  type: "object",
  properties: {
    issue: { type: "string" },
    short: { type: "string" },
    body: { type: "string" },
    reaction: { type: "string" },
    level: { type: "string", enum: ["주의", "경고", "심각"] },
    duplicate: { type: "string" },
    region: { type: "string" },
    comment_picks: { type: "array", items: { type: "integer" } },
  },
  required: ["issue", "short", "body", "reaction", "level", "duplicate", "region", "comment_picks"],
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
  const comments = (info.comments || []).map((c) => ({ index: c.index, reply: c.isReply, text: c.text.slice(0, 400) }));
  const input = {
    excel: { 차종: row.car, 구분: row.kind, 카페: row.cafe, 담당자메모: row.main },
    title: info.title || "",
    body: info.bodyText || "",
    comments,
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
  out.comment_picks = [...new Set((out.comment_picks || []).filter((i) => valid.has(i)))].slice(0, 3);
  for (const k of ["issue", "short", "body", "reaction", "duplicate", "region"]) out[k] = String(out[k] || "").trim();
  return out;
}

// API 키가 없을 때: 엑셀 '주요 내용'으로 초안만 채운다 (나머지는 미리보기에서 직접 입력)
function excelDraft(row, info) {
  const main = (row.main || "").trim();
  return {
    issue: main,
    short: main,
    body: main,
    reaction: "",
    level: "주의",
    duplicate: "",
    region: "",
    comment_picks: (info?.comments || []).slice(0, 2).map((c) => c.index),
  };
}
