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
자동차 동호회(네이버 카페) 게시글의 제목/본문/댓글을 읽고, 보고서 칸에 들어갈 문구를 작성합니다.

[표현 기준]
- 게시글에 작성된 현상만 간결한 보고체로 씁니다. 전후 사정보다 증상 전달에 초점을 둡니다.
- 자극적/부정적 표현 대신 사실 중심의 순화된 표현을 씁니다. 표준어의 쉬운 표현으로 씁니다.
- "에러", "결함"은 쓰지 않습니다. "증상", "현상", "오류", "불량", "고장", "문제" 등으로 바꿉니다.
- 작성자가 "내비", "네비"라고 썼어도 보고서에는 반드시 "내비게이션"으로 씁니다.
- 부위는 게시글에 나온 실제 부위로 정확히 씁니다. 전동 테일게이트·트렁크·도어·선루프·윈도의 작동 불량이나 끼임을 "전동 시트 끼임"으로 바꿔 쓰지 않고, 그 실제 이슈(예: 전동 테일게이트 작동 불량, 전동 테일게이트 끼임 사고)로 씁니다. 사고·부상이 있으면 불만 구분을 경고 이상으로 검토합니다.
- "계기판"이라고 쓰지 않고 반드시 "계기반"으로 씁니다. (작성자가 계기판이라고 썼어도)
- "~으나"로 이어지는 문장 뒤에는 반드시 쉼표를 찍습니다. (예: 점등되어 하이테크센터에서 수리받았으나, 안내 미흡 / 발생해 부품 교체했으나, 시트 소음 지속)
- 나열/구분 기호로 가운뎃점(U+00B7)은 절대 쓰지 않습니다. 쉼표(,) 또는 빗금(/)을 씁니다. (예: "도장/루프 필러", "소음, 진동")
- "경고가 떠", "경고가 떠서" 같은 표현 대신 "경고등 점등으로"라고 씁니다. (예: 수소 누출 경고등 점등으로 입고)
- "돼", "됐" 줄임 표현은 쓰지 않고 "되어", "되었"으로 풀어 씁니다. (예: 확인돼 → 확인되어, 점등됐다며 → 점등되었다며)
- 문장 시작 유형: [출고] "최근 출고한 차량에서", "출고 후 3개월 된 차량에서" / [주행 중] "주행 중에", "정차 중에", "주차 중에" / [차량의] "차량의 ○○ 부분에서"
- 문장 끝맺음은 글의 성격에 맞게 아래 유형을 골고루 섞어 씁니다. 모든 글을 "~하는 내용"으로 끝내지 않습니다.
  - 불만을 강하게 표출한 글: "~며 품질 관련 불만글 게재", "~에 대한 불만글 게재", "~며 품질에 대해 불만 토로" (응대 불만이면 "응대 관련")
    사진·영상과 함께 강한 불만을 올린 글: "~며 증상 관련 사진과 함께 품질 불만 게재" ("품질 불만글 게재"가 아니라 "품질 불만 게재")
  - 같은 증상을 겪은 사람이나 해결책을 묻는 글: "~ 동일 증상 유경험자 여부 및 증상 관련 문의 글 게재", "~ 원인 및 조치 방법 문의", "~며 증상에 대해 문의하는 내용"
    ("동일 증상 여부 및 원인 문의"라고 쓰지 않습니다)
  - 사진을 함께 올린 글(photoCount 1 이상): 사진이 증상을 보여 주면 "~ 증상 관련 사진과 함께 글 게재"
  - 영상을 함께 올린 글(videoCount 1 이상): 영상이 증상을 보여 주면 "~ 증상 관련 영상과 함께 글 게재"
  - 정비/수리 경과를 알리는 글: "~ 정비 후기 공유", "~ 조치 경과 공유"
  예) 차량의 리어 스텝 부분에서 녹이 발생해 도색 불량을 의심한다며 증상에 대해 문의하는 내용
  예) 출고 4개월 된 차량에서 선루프 오작동, 네트워크 오류, 시트 소음이 발생했다며 품질 관련 불만글 게재
  예) 냉간 시동 시 소음, 진동과 함께 엔진 경고등이 점등되어 동일 증상 유경험자 여부 및 증상 관련 문의 글 게재
  예) 출고 후 문 한 쪽이 잘 닫히지 않아 증상 관련 영상과 함께 글 게재
  예) 운전석 뒤 펜더 안쪽에 녹이 올라와 도장이 들뜬 증상 관련 사진과 함께 글 게재
  recentBodies(같은 보고서에서 앞서 쓴 본문 요약)와 끝맺음이 겹치지 않게 다른 유형을 우선 고릅니다.

[작성 항목]
- short: 첫 장 요약표의 '내용 요약'. 구구절절한 설명/미사여구 없이 깔끔하게, 필요한 내용만 키워드 중심의 명사형으로 (35자 이내).
  담당자가 직접 다듬은 예) "타이어 공기압 경고등 및 도장/루프 필러 조립 불량" / "라디에이터 캡 냉각수 누수" /
  "HUD 부품 결품으로 2개월 수리 지연" / "테일게이트 부위 부식 발생" / "시동 시 내비게이션 디스플레이 불량 발생" /
  "충전 후 수소 강제 배출 및 수소 누출 경고등 점등"
  불만을 토로하는 글이면 short 끝을 "불만"으로 맺습니다. 예) "도장 불량 발생" → "도장 불량 발생 불만" (담당자 수정 2026-10-19)
- issue: 슬라이드 제목의 증상 부분(차명은 빼고). 될 수 있으면 short 와 똑같이 씁니다.
  제목은 "titlePrefix issue" 로 한 줄에 들어가야 하므로 issue 는 한글 기준 titleBudget 글자 안으로 씁니다.
  short 가 그보다 길면 뜻이 통하게 융통성 있게 줄입니다. 예) "충전 후 수소 강제 배출 및 누출 경고등 점등"
- body: 상세 슬라이드의 본문 요약 한 문장. 첫 줄 한 줄을 꽉 채우도록 반드시 ${BODY_MIN}~${BODY_MAX}자로 씁니다.
  너무 짧게 쓰지 말고 게시글의 주요 내용을 풍부하게, 포인트를 잘 잡아 담습니다:
  차량 상태(출고 시기/주행거리 등) → 언제/어떤 상황에서 → 어떤 증상이 → 어떤 조치(입고/교체/진단 결과)를 받았고 → 작성자가 무엇을 원하는지/어떤 불만인지.
  위 문장 시작/끝맺음 유형을 따릅니다. ${BODY_MAX}자를 넘으면 덜 중요한 정황부터 뺍니다.
- reaction: 댓글 반응 한 줄. 캡처할 댓글(comment_picks) 2개를 index 가 작은 댓글부터(댓글 캡처에서 위에 놓이는 댓글부터) 차례로 요약합니다. 말 그대로 '여론'이므로 댓글의 말투를 따릅니다.
  / 댓글을 그대로 옮기지 말고 오탈자/맞춤법을 고쳐 핵심만 자연스럽게 다듬습니다.
  / 댓글이 존댓말이면 존댓말로, 반말이면 반말로 씁니다. (예: "못 해요"는 "못 해요"로, "안 되네"는 "안 되네"로)
  / 각 댓글 요약은 문장 끝에 반드시 마침표(.)를 찍습니다. 느낌표/물음표로 끝난 댓글이면 그 기호(! ?)를 씁니다.
  / 두 댓글 요약 사이에는 반드시 쉼표(,)를 넣습니다. 마침표 뒤에도 쉼표를 붙입니다.
  / 전체를 ‘ ’(작은따옴표)로 한 번 묶고 " 등의 여론"으로 끝냅니다. 반드시 ${REACTION_MAX}자 이내.
  예) ‘이건 제작이 잘못된 것 같습니다., 블루핸즈 말고 사업소에 가서 강하게 항의하세요!’ 등의 여론
  예) ‘업데이트되면 아무것도 못 해요., 업데이트하면 딱 멈춰 버리네요.’ 등의 여론
  댓글이 없거나 의미 있는 반응이 없으면 빈 문자열.
- spec: 제원. "2.5T", "3.5T", "1.6T", "2.0", "2.5", "HEV", "EV", "LPI", "디젤" 처럼 짧게.
  게시판명(boardName)·게시글 제목·본문에서 먼저 찾습니다. 게시판명에 제원이 들어 있는 카페가 많습니다
  (2026-10-20 담당자 지적: 게시판명이 "GV70 2.5T 결함/정비" 인 글을 "-" 로 비워 둠 → 이 경우 제원 "2.5T").
  없으면 반드시 작성자 게시물 보기 내용을 끝까지 확인해 채웁니다:
  author(닉네임: 예 "CN8 2.0 인스퍼"), authorPosts(작성자의 다른 글 제목), authorCertPosts(계약·출고 인증 글 본문), authorPostTexts(작성자의 다른 글 본문·댓글).
  specHints 는 이 글들에서 미리 찾아 둔 제원 후보(spec, 어디서 찾았는지, 앞뒤 문장)입니다. 같은 차의 이야기가 맞으면 그 값을 씁니다.
  (2026-10-19 담당자 지적: 아반떼(CN8) 글에서 작성자 게시물 보기로 "2.0" 이 확인되는데 "-" 로 비워 둠 → 확인·유추되는 제원은 반드시 기입.)
  작성자가 차를 여러 대 다룬 경우 이 글의 차종과 같은 차의 제원만 씁니다. 다른 차 제원이면 쓰지 않습니다.
  하이브리드는 "HEV", 전기차는 "EV", 수소전기차(넥쏘)는 반드시 "FCEV"(그냥 EV 아님). 아무리 봐도 근거가 없으면 "-".
- level: 불만 단계. 대부분은 "주의"입니다.
  주의 = 일반적인 품질 불만/문의 (도장 불량, 단차, 소음, 경고등, 기능 오작동 등 대부분)
  경고 = 악성 민원(강한 항의/집단 행동/언론 제보 예고 등) 또는 주요하고 심각한 이슈 (주행 중 시동 꺼짐, 차가 움직이지 않음 등 운행에 직접 영향)
  심각 = 운행 불가 및 생명의 위협을 느꼈을 이슈 (화재, 급발진, 사고 등)
- duplicate: 아래 두 가지를 러프하게 더한 수.
  ① 댓글 중 "저도 그래요", "나도 그랬다"처럼 같은 증상을 겪었다는 뉘앙스의 댓글 수
  ② boardPosts(이 글이 있는 게시판의 최근 글 목록) 중 게시일(postDate) 기준 최근 3개월 안의 같은 차종/같은 증상 관련 게시글 수 (이 글 자신은 빼고, 날짜가 시간만 있으면 최근 글)
  합이 0이면 "신규", 있으면 "중복 N건". 대부분은 "신규"입니다.
- region: 입고/운행 지역. 먼저 작성자 닉네임(author)에서 지역을 판단합니다(예: "부산ll홍길동" → 부산, "파주II아무개" → 파주).
  닉네임으로 알 수 없으면 authorPosts(작성자의 다른 글 제목)와 본문에서 지역이 분명히 드러나면 씁니다. 도(충북, 경기 등)는 빼고 시 이름만 씁니다(예: "충북 청주" → "청주", "경기 오산" → "오산", "부산", "서울 강동구").
  단 이름이 같은 다른 도시와 헷갈리는 곳은 도를 붙입니다(예: "경기 광주"는 광주광역시와 헷갈리므로 "경기 광주").
  시 이름은 모르고 도·광역 단위만 확인되면 그 이름을 짧게 씁니다(예: "강원", "전남"). 닉네임·본문·작성자 글을 끝까지 확인해 최대한 채웁니다(담당자가 "-"를 "전남"으로 고친 사례 있음). 정말 알 수 없을 때만 "-".
- focus: 집중관리고객 여부(true/false). 게시글 본문(제목 포함)에 민원 제기(본사 VOC·고객센터 민원 등), 소송·법적 대응, 한국소비자원(소비자보호원), 자동차리콜센터, 국민청원, 언론·방송 제보,
  집단 행동 등 이슈화하려는 내용이 확인되고 강하게 불만을 드러내는 글이면 true. 그러면 집중관리고객 칸에 작성자 닉네임이 들어갑니다.
  댓글에서 남이 "민원 넣으세요"라고 권한 것만으로는 해당하지 않습니다(작성자 본인이 하겠다·했다는 내용이어야 함). 단순 문의·가벼운 불만은 false. (2026-10-20 담당자 지정 규칙)
- comment_picks: 보고서에 캡처해 넣을 댓글 번호(index) 2개 (index 작은 것부터. reaction 도 이 순서). 자극적이거나 심각하다고 느껴지는, 길지 않은 댓글을 우선 고릅니다.
  hasSticker 가 true 인(이모티콘이 있는) 댓글은 될 수 있으면 고르지 말고, 그것밖에 없을 때만 고릅니다. 댓글이 2개보다 적으면 있는 만큼.`;

// ---------------------------------------------------------------------------
// 자동 학습: 담당자가 미리보기 카드에서 고친 문구·판단을 'AI 가 쓴 값 → 담당자가 고친 값' 으로 모아
// 다음 작성부터 시스템 프롬프트 끝에 '담당자 수정 사례'로 붙인다 (같은 실수 반복 방지)
// ---------------------------------------------------------------------------
const PPT_LEARN_MAX = 150;
const PPT_LEARN_PROMPT_MAX = 40;
const PPT_LEARN_FIELDS = { title: "페이지 제목", code: "차종", spec: "제원", level: "불만 구분", progress: "경과", short: "요약표 내용", body: "본문 요약", reaction: "댓글 반응", duplicate: "신규/중복", region: "입고/운행지역", focus: "집중관리고객" };
let pptLearned = [];

async function loadPptLearned() {
  const { pptLearned: list = [] } = await chrome.storage.local.get("pptLearned").catch(() => ({}));
  pptLearned = Array.isArray(list) ? list : [];
  return pptLearned;
}

async function savePptLearned(list) {
  pptLearned = list.slice(0, PPT_LEARN_MAX);
  await chrome.storage.local.set({ pptLearned, pptLearnedUpdatedAt: Date.now() });
}

function pptLearnLine(x) {
  const parts = Object.entries(x.ch || {}).map(([k, [a, b]]) => `${PPT_LEARN_FIELDS[k] || k} "${a}" → "${b}"`);
  return parts.length ? `- [${x.cafe || ""}] 차종 ${x.car || "-"}: ${parts.join(" / ")}` : "";
}

// 담당자가 최종 확정한 보고서 예시 (수정한 PPT 를 올렸을 때 원본이 없으면 여기 쌓임) + 기본 예시
const PPT_EXAMPLE_MAX = 60;
const PPT_EXAMPLE_PROMPT_MAX = 12;
// 2026-10-19 보고서: 담당자가 고쳐 확정한 문구 (기본 예시)
const PPT_SEED_EXAMPLES = [
  { car: "CN8", title: "아반떼(CN8) 내비게이션 화면 꺼짐 및 카메라 화면 표시 오류", short: "내비게이션 화면 꺼짐 및 카메라 화면 표시 오류", spec: "-", level: "주의", region: "-", body: "차량의 내비게이션(플레오스) 화면이 꺼졌다 켜지는 오류가 반복되어 분해 수리 가능성을 안내받았다며 증상 관련 사진과 함께 글 게재", reaction: "‘카페에서 비슷한 분을 봤는데 케이블이 살짝 뽑혀 있었다고 한 것 같아요.’ 등의 여론" },
  { car: "CN8", title: "아반떼(CN8) 도장 불량 발생 불만", short: "도장 불량 발생 불만", spec: "-", level: "주의", region: "화성", body: "최근 출고한 차량의 여러 부위에서 도장이 흐르는 등 도장 불량이 확인되었다며 증상 관련 사진과 함께 품질 불만 게재", reaction: "‘이건 거의 쓰레기 수준이네요!, 2번째는 칠이 흐른 건가요?’ 등의 여론" },
  { car: "ME1", title: "아이오닉9(ME1) 모터 제어 시스템 경고등 점등", short: "모터 제어 시스템 경고등 점등", spec: "EV", level: "주의", region: "-", body: "차량의 계기반에 모터 제어 시스템 경고등이 빨간색으로 점등되어 원인을 알 수 없다며 증상 원인 및 조치 방법 문의", reaction: "" },
  { car: "ME1", title: "아이오닉9(ME1) 소음 수리 중 센터 내 차량 파손 및 응대 불만", short: "소음 수리 중 센터 내 차량 파손 및 응대 불만", spec: "EV", level: "경고", kind: "응대", region: "의정부", body: "트렁크, B필러 소음으로 하이테크센터에 입고했으나, 미케닉이 이동 중 후면을 긁고 책임자 응대도 미흡했다며 응대 관련 불만글 게재", reaction: "‘사고, 응대 등으로 본사에 VOC 넣어 보시죠., 그냥 넘어가면 안 됩니다.’ 등의 여론" },
  { car: "ME1", title: "아이오닉9(ME1) 주행 중 경고등 재점등 및 반복 고장 불만", short: "주행 중 경고등 재점등 및 반복 고장 불만", spec: "EV", level: "주의", region: "강원", body: "며칠 전 고장 글을 올린 차량에서 주행 중 경고등이 재점등되어 현대 측 입고 요청을 받았다며 품질 관련 불만글 게재", reaction: "‘너무 스트레스 심하실 것 같아요., 추후 내용 알려 주시면 도움 될 듯합니다.’ 등의 여론" },
  { car: "ME1", title: "아이오닉9(ME1) 주행 중 디스플레이 꺼짐 및 윈도 작동 불가", short: "주행 중 디스플레이 꺼짐 및 윈도 작동 불가", spec: "EV", level: "주의", region: "전남", body: "출고 3개월 된 차량에서 주차장 출차 중 디스플레이가 꺼지고 윈도가 작동하지 않는 증상 관련 영상과 함께 글 게재", reaction: "‘차 문은 기계식이라 걱정 안 하셔도 돼요., 이런 경우도 있군요.’ 등의 여론" },
];
let pptExamples = [];

async function loadPptExamples() {
  const { pptExamples: list = [] } = await chrome.storage.local.get("pptExamples").catch(() => ({}));
  pptExamples = Array.isArray(list) ? list : [];
  return pptExamples;
}

async function savePptExamples(list) {
  pptExamples = list.slice(0, PPT_EXAMPLE_MAX);
  await chrome.storage.local.set({ pptExamples, pptLearnedUpdatedAt: Date.now() });
}

function pptExampleLine(x) {
  return `- [${x.car || "-"}] 제목 "${x.title}" / 요약표 "${x.short || ""}"${x.spec && x.spec !== "-" ? ` / 제원 ${x.spec}` : ""} / 불만 구분 ${x.level || "주의"}${x.kind && x.kind !== "품질" ? ` / 유형 ${x.kind}` : ""} / 지역 ${x.region || "-"}\n  본문 요약: ${x.body}\n  댓글 반응: ${x.reaction || "댓글 반응 없음"}`;
}

function aiSystem() {
  const lines = pptLearned.slice(0, PPT_LEARN_PROMPT_MAX).map(pptLearnLine).filter(Boolean);
  const seen = new Set();
  const examples = [...pptExamples, ...PPT_SEED_EXAMPLES]
    .filter((x) => x.title && !seen.has(x.title) && seen.add(x.title))
    .slice(0, PPT_EXAMPLE_PROMPT_MAX)
    .map(pptExampleLine);
  let s = AI_SYSTEM;
  if (examples.length)
    s += `\n\n[담당자가 최종 확정한 보고서 예시 (최근 순)]\n담당자가 PPT 에서 직접 다듬어 확정한 문구입니다. 문장 길이·시작/끝맺음·표현·제목과 요약표 맞춤·불만 구분·지역 표기 방식을 이 예시처럼 맞춥니다.\n${examples.join("\n")}`;
  if (lines.length)
    s += `\n\n[담당자 수정 사례 (자동 학습, 최근 순)]\n담당자가 직접 고친 기록입니다. 같은 표현·판단 실수를 반복하지 말고, 비슷한 글은 담당자가 고친 쪽(표현·끝맺음·불만 구분·제원·지역 등)을 따릅니다.\n${lines.join("\n")}`;
  return s;
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    short: { type: "string" },
    issue: { type: "string" },
    spec: { type: "string" },
    body: { type: "string" },
    comment_picks: { type: "array", items: { type: "integer" } },
    reaction: { type: "string" },
    level: { type: "string", enum: ["주의", "경고", "심각"] },
    duplicate: { type: "string" },
    region: { type: "string" },
    focus: { type: "boolean" },
  },
  required: ["issue", "spec", "short", "body", "reaction", "level", "duplicate", "region", "focus", "comment_picks"],
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
// 제목 한 줄 길이: 한글 1, 영문 대문자·숫자 0.62, 소문자 0.55, 띄어쓰기 0.3, 기호 0.4 로 셈.
// 실제 보고서 제목 한 줄(■ 뒤 ~ No. 앞)에 한글 약 31자가 들어가므로 여유를 두고 30
const TITLE_UNITS = 30;
function titleWidth(t) {
  let w = 0;
  for (const ch of String(t || "")) {
    if (/[\u3131-\uD79D\u4E00-\u9FFF]/.test(ch)) w += 1;
    else if (/\s/.test(ch)) w += 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else if (/[a-z]/.test(ch)) w += 0.55;
    else w += 0.4;
  }
  return w;
}
const fitsTitle = (prefix, issue) => titleWidth(`${prefix} ${issue}`) <= TITLE_UNITS;

// titlePrefix: 제목 앞부분 "차명(코드)" — 제목 한 줄 길이 맞추기용
async function aiSummarize(row, info, { apiKey, model, recentBodies = [], titlePrefix = "" }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const comments = (info.comments || []).map((c) => ({
    index: c.index,
    text: c.text.slice(0, 400),
    length: c.text.length,
    hasSticker: !!c.hasSticker,
  }));
  const titleBudget = Math.max(8, Math.floor(TITLE_UNITS - titleWidth(titlePrefix) - 0.3));
  const input = {
    excel: { 차종: row.car, 구분: row.kind, 카페: row.cafe, 담당자메모: row.main },
    boardName: info.boardName || "",
    title: info.title || "",
    author: info.author || "",
    postDate: info.postDate || "",
    body: info.bodyText || "",
    photoCount: (info.images || []).filter((m) => !m.video).length,
    videoCount: (info.images || []).filter((m) => m.video).length,
    titlePrefix,
    titleBudget,
    comments,
    recentBodies: recentBodies.slice(-6),
    authorPosts: (info.authorPosts || []).slice(0, 30).map((p) => ({ title: p.title, date: p.date })),
    authorCertPosts: info.authorCertPosts || [],
    authorPostTexts: info.authorPostTexts || [],
    specHints: info.specHints || [],
    boardPosts: (info.boardPosts || []).map((p) => ({ title: p.title, date: p.date })),
  };
  const params = {
    model,
    max_tokens: 4000,
    system: aiSystem(),
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
  // 댓글은 캡처에서 위에 놓이는 것(index 작은 것)부터 — 댓글 반응 요약도 이 순서
  out.comment_picks = [...new Set((out.comment_picks || []).filter((i) => valid.has(i)))].slice(0, 2).sort((a, b) => a - b);
  if (!out.comment_picks.length) out.comment_picks = defaultPicks(info);
  for (const k of ["issue", "spec", "short", "body", "reaction", "duplicate", "region"]) out[k] = String(out[k] || "").trim();
  fixWording(out);

  // 내용 요약 2줄 엄수 + 첫 줄 꽉 채우기: 본문 요약이 너무 짧거나 길면, 댓글 반응이 길면 한 번 더 맞춰 달라고 한다
  if (out.body.length > BODY_MAX || out.body.length < BODY_MIN || out.reaction.length > REACTION_MAX) {
    try {
      const short = await askJson(client, model, {
        model,
        max_tokens: 1000,
        system: aiSystem(),
        output_config: { effort: "low", format: { type: "json_schema", schema: SHORTEN_SCHEMA } },
        messages: [
          {
            role: "user",
            content:
              `아래 body 는 ${BODY_MIN}~${BODY_MAX}자가 되도록 고쳐 주세요. 짧으면 게시글 본문에서 핵심 정황(차량 상태, 상황, 조치, 요구)을 더해 ` +
              `풍부하게, 길면 덜 중요한 말을 빼서 줄입니다. reaction 은 ${REACTION_MAX}자를 넘으면 줄이고 아니면 그대로 둡니다. ` +
              `문장 유형, 댓글 말투(존댓말), 마침표, 쉼표, ‘ ’ 등의 여론 형식은 그대로 지킵니다.\n\n` +
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
  await fitIssue(client, model, out, titlePrefix);
  return out;
}

// 페이지 제목은 될 수 있으면 요약표 내용(short)과 똑같이. 제목 한 줄을 넘으면 융통성 있게 줄인 issue 를 쓴다
async function fitIssue(client, model, out, prefix) {
  if (out.short && fitsTitle(prefix, out.short)) {
    out.issue = out.short;
    return;
  }
  if (!out.issue) out.issue = out.short;
  if (fitsTitle(prefix, out.issue)) return;
  const budget = Math.max(8, Math.floor(TITLE_UNITS - titleWidth(prefix) - 0.3));
  try {
    const r = await askJson(client, model, {
      model,
      max_tokens: 500,
      system: aiSystem(),
      output_config: { effort: "low", format: { type: "json_schema", schema: ISSUE_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `슬라이드 제목 "${prefix} ${out.issue}" 이 한 줄을 넘습니다. 증상 부분(issue)을 한글 기준 ${budget}글자 안으로, ` +
            `요약표 내용 "${out.short}" 과 뜻이 같게 융통성 있게 줄여 주세요. 명사형, 가운뎃점 금지.`,
        },
      ],
    });
    const ni = fixWording({ issue: String(r.issue || "").trim() }).issue;
    if (ni && titleWidth(ni) < titleWidth(out.issue)) out.issue = ni;
  } catch {
    /* 그대로 (미리보기에서 고칠 수 있음) */
  }
}

const ISSUE_SCHEMA = {
  type: "object",
  properties: { issue: { type: "string" } },
  required: ["issue"],
  additionalProperties: false,
};

// 보고서 표기 규칙을 한 번 더 확실히: 내비/네비 → 내비게이션, 계기판 → 계기반, 돼/됐 → 되어/되었
// (댓글 반응은 댓글 말투를 따르므로 내비게이션·계기반만)
function fixWording(out) {
  const nav = (t) => String(t || "").replace(/(내비|네비)(게이션)?/g, "내비게이션").replace(/계기판/g, "계기반");
  const doe = (t) => String(t || "").replace(/됐/g, "되었").replace(/돼/g, "되어");
  // "~으나" 뒤 쉼표 ("수리받았으나 안내" → "수리받았으나, 안내")
  const comma = (t) => String(t || "").replace(/으나(?=\s)(?!,)/g, "으나,");
  // 가운뎃점(·) 금지: 붙어 있으면 "/", 띄어 쓴 나열이면 ","
  const dot = (t) => String(t || "").replace(/\s+[·・]\s+/g, ", ").replace(/[·・]/g, "/");
  // "경고가 떠(서)" → "경고등 점등으로"
  const warn = (t) => String(t || "").replace(/경고(?:등)?(?:이|가)\s*(?:떠서|떠)/g, "경고등 점등으로");
  // "동일 증상 여부 및 원인 문의" → "동일 증상 유경험자 여부 및 증상 관련 문의 글 게재"
  const same = (t) => String(t || "").replace(/동일 증상 여부 및 원인 문의(?:\s*글 게재)?/g, "동일 증상 유경험자 여부 및 증상 관련 문의 글 게재");
  for (const k of ["issue", "short", "body"]) if (out[k]) out[k] = same(warn(dot(comma(doe(nav(out[k]))))));
  if (out.reaction) out.reaction = dot(nav(out.reaction));
  if (out.region) out.region = regionName(out.region);
  return out;
}

// 운행 지역: 도 이름은 빼고 시 이름만 ("충북 청주" → "청주", "청주시" → "청주").
// 단 경기 광주는 전라도 광주(광주광역시)와 헷갈리므로 "경기 광주" 그대로
const PROVINCES = /^(?:충청북도|충청남도|충북|충남|경기도|경기|경상북도|경상남도|경북|경남|전라북도|전라남도|전북특별자치도|전북|전남|강원특별자치도|강원도|강원|제주특별자치도|제주도)\s+/;
function regionName(r) {
  let t = String(r || "").trim().replace(/[·・]/g, " ").replace(/\s+/g, " ");
  if (!t || t === "-") return t;
  const m = t.match(PROVINCES);
  if (m) {
    const rest = t.slice(m[0].length);
    if (/^광주(시)?(\s|$)/.test(rest) && /^경기/.test(m[0])) return `경기 ${rest.replace(/^광주시/, "광주")}`;
    t = rest;
  }
  return t.replace(/^([가-힣]{2,})시(?=\s|$)/, "$1");
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
