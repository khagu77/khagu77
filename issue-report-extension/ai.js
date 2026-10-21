// Claude API 로 1) 수집 게시물의 이슈 관련성 판독 2) 댓글 성향 4단계 분석 3) 보고서 요약 문장·주요 댓글 선정을 한다.
// 모든 단계에 '보고서 작성 목적'과 '이슈명·키워드'를 함께 보내 그 목적에 초점을 맞춰 판단·작성하게 한다.

const RELEVANCE_BATCH = 30; // 관련성 판독 한 번에 보낼 게시물 수
const SENTIMENT_BATCH = 60; // 성향 분석 한 번에 보낼 댓글 수
const SENTIMENTS = ["긍정", "중립", "부정", "단순비난"];

// 기본 규칙을 마지막으로 고친 때 ('명령 프롬프트' 화면에 표시)
const PROMPT_BUILT_AT = "2026-10-21 (v1.0.24)";

function issueContext(job) {
  const kw = parseKeywords(job.keywords);
  return `[이번 보고서]
- 이슈명: ${job.issueName || "(없음)"}
- 보고서 작성 목적(담당자가 직접 적은 것 — 모든 판단과 작성의 기준): ${job.purpose ? `\n${job.purpose.trim()}` : "(없음)"}
- 수집 키워드(줄마다 하나의 검색어, | 는 '또는', 띄어 쓴 단어는 '그리고'): ${kw.groups.map((g) => g.map((a) => a.join("|")).join(" ")).join(" / ") || "(없음)"}${kw.exclude.length ? `\n- 제외 키워드: ${kw.exclude.join(", ")}` : ""}
- 모니터링 기간: ${fmtDateTime(job.from)} ~ ${fmtDateTime(job.to)}`;
}

// 명령 규칙 메모리(Markdown, 담당자가 쌓아 온 규칙) + 이번 재분석 지시사항. 모든 AI 단계에 붙고 기본 규칙보다 우선
function customInstructions(settings, extra = "") {
  let out = "";
  const md = String(settings?.memoryMd || "").trim();
  if (memoryHasRules(md)) out += `\n\n[명령 규칙 메모리 — 담당자가 쌓아 온 규칙(Markdown). 위 기본 규칙과 충돌하면 이것을 따른다]\n${md}`;
  const old = String(settings?.customPrompt || "").trim();
  if (old) out += `\n\n[추가 지시사항]\n${old}`;
  if (String(extra || "").trim()) out += `\n\n[이번 재분석 지시사항 — 담당자가 방금 준 것, 가장 우선해서 따른다]\n${extra.trim()}`;
  return out;
}

// 담당자가 손으로 고친 성향 판정 사례 (최근 것부터) — 같은 유형은 이렇게 판정하도록
function correctionExamples(settings, limit = 40) {
  const list = (settings?.corrections || []).slice(0, limit);
  if (!list.length) return "";
  return `\n\n[담당자가 직접 고친 성향 판정 사례 — 같은 유형의 댓글은 담당자 판정을 따른다]\n${list
    .map((c) => `- “${String(c.text).replace(/\s+/g, " ").slice(0, 160)}” → ${c.to}${c.ai ? ` (AI 는 ${c.ai} 로 판정했었음)` : ""}`)
    .join("\n")}`;
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
6. reason 에는 판단 근거를 20자 안팎 한국어로 적는다 (예: "CN8 가격 인상 불만 글", "기아 K5 이야기로 무관").
7. s 에는 게시글 자체(제목·내용)가 이번 이슈 대상에 대해 보이는 성향을 긍정/중립/부정/단순비난 중 하나로 적는다. 기준은 댓글 성향과 같다:
   - 긍정: 호의·기대·칭찬·지지·구매(계약) 의사 / 중립: 사실 보도·정보 공유·질문·후기 중 태도가 드러나지 않음
   - 부정: 구체적 이유가 있는 불만·비판·우려 / 단순비난: 근거 없이 회사·브랜드·노조를 비하·조롱·욕함
   - 언론 기사는 기사의 논조(제목·본문이 이슈를 어떻게 다루는가)로 본다. 사실만 전하는 기사는 중립, 비판·우려 중심 기사는 부정, 호평·기대 중심 기사는 긍정.
   - 관련 없는 글(relevant=false)도 s 는 채우되, 판단할 내용이 없으면 중립.`;

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
        properties: { id: { type: "string" }, relevant: { type: "boolean" }, reason: { type: "string" }, s: { type: "string", enum: SENTIMENTS } },
        required: ["id", "relevant", "reason", "s"],
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

function sentimentSystem(job, settings, extra = "") {
  return `너는 현대자동차 온라인 여론 모니터링 담당자다. 이번 이슈에 대한 온라인 댓글의 성향을 4단계(긍정/중립/부정/단순비난)로 정확히 판정한다.

${issueContext(job)}

${SENTIMENT_RULES}${correctionExamples(settings)}${customInstructions(settings, extra)}`;
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
   ★ 길이: PPT 요약 칸에 문장마다 **한 줄**로 들어가야 한다 → 각 문장 공백 포함 55자 이내(최대 60자). 짧고 간결하게, 읽자마자 포인트가 딱 짚히도록 쓴다. 비율 숫자는 핵심 1~2개만 쓰고, 나열을 줄인다.
   ★ 요약 내용: 실제 댓글·게시글에 **가장 많이 등장하고 반응이 센 논점** 2~3개만 많이 나온 순서대로 짚는다 ('성향별 자주 나온 말'의 댓글 수와 후보 댓글을 근거로). 드물게 나온 이야기를 주요 여론처럼 쓰지 않는다.
   ★ 근거 없는 내용 금지: 주어진 통계·게시글 제목·후보 댓글에서 직접 확인되는 사실만 쓴다. '계약 취소 인증 확인', '불매 확산'처럼 실제 인증 글·다수 사례가 자료에 없으면 쓰지 않으며, 몇 건 안 되는 이야기는 '일부 언급' 정도로만 쓴다. 추측·과장·단정 금지.
   ★ 보고서다운 용어: 커뮤니티 은어·속어·조롱 표현(예: 호구론, 장난질, 흑우, 개돼지, 현기, 국뽕)은 요약 문장에 쓰지 않고 보고서 용어로 바꿔 쓴다.
     예) 호구론 → 국내 구매자 차별 인식 / 옵션 장난질 → 옵션 구성·유료화 불만 / 현기 → 현대차·기아 (단, 주요 댓글 샘플은 원문 그대로)
4. title 은 "<이슈명> 관련 여론 동향" 형태로 25자 이내.
5. 주요 댓글은 반드시 주어진 댓글 목록에서 id 로 고른다 (새로 지어내지 않는다). quotes_short·quotes_long 에는 댓글 글이 아니라 id(예: "c12")만 넣는다 — 프로그램이 id 로 원문을 그대로 보고서에 넣는다(맞춤법·욕설·ㅋㅋ 등 고치지 않음).
   ★ 선정 우선순위: 이번 보고서 목적·이슈에 딱 맞으면서 **가장 자극적이고 반응이 센 댓글**(강한 감정, 직설적인 불만·비난·조롱, 거친 표현, 구체적인 금액·비교로 날 선 말, 많은 사람이 공감할 만한 한 줄)을 맨 앞에 둔다. 밋밋한 인사·단순 질문은 뒤로 미루거나 빼되, 긍정·중립도 그 성향 안에서 가장 강하고 분명한 댓글을 고른다.
   - 같은 말을 되풀이하는 댓글은 하나만 고르고, 서로 다른 논점(가격·옵션·경쟁 차종·회사·노조 등)이 고루 보이게 한다.
   - 개인 신상(실명·전화번호·주소 등)이 드러난 댓글은 뺀다. 욕설·비속어가 섞였다는 이유로는 빼지 않는다.
   - 'ㅣㄱㅋㅋㅋㅋㅋㅅㅂ'처럼 자음·모음·ㅋㅋ·욕 줄임말만 있고 무슨 말인지 내용이 없는 댓글은 고르지 않는다 (자극적이어도 내용이 있어야 함).
   - quotes_short (1페이지): 성향마다 4~7개. 이번 여론을 대표하는 **가장 자극적인 댓글** 위주로, 짧고 센 것부터.
   - ★ 단, **중립**은 반대로: 감정·주장·비꼼·욕·조롱이 거의 없는 **정말 별 의미 없는, 최대한 중립스러운 댓글**(단순 사실·정보 전달, 담담한 질문, 관망, 소식 공유 등)로 고른다. 자극적이거나 한쪽으로 기운 댓글은 중립 칸에 넣지 않는다. (후보 목록의 중립 댓글은 밋밋한 것부터 정렬돼 있다)
   - quotes_long (2페이지): 성향마다 10~25개. 1페이지에 쓰지 않은 **나머지 댓글 중 중요하다고 판단되는 댓글**(목적과 직접 관련, 많이 나온 논점을 대표, 구체적인 이유·금액·비교가 담긴 것, 반응이 센 것)을 중요한 것부터. 해당 성향 댓글이 적으면 있는 만큼만.
   - ★ quotes_short(1페이지)에 고른 댓글은 quotes_long(2페이지)에 다시 넣지 않는다. 두 페이지에 같은 댓글이 겹치면 안 된다.`;

function reportSystem(job, settings) {
  return `너는 현대자동차 온라인 여론 모니터링 보고서 작성 담당자다. 수집·분석된 게시글과 댓글로 '여론 동향' PPT 보고서의 문장을 쓰고 대표 댓글을 고른다.

${issueContext(job)}

${REPORT_RULES}${customInstructions(settings)}`;
}

const quoteIds = { type: "object", properties: Object.fromEntries(SENTIMENTS.map((s) => [s, { type: "array", description: "후보 댓글의 id 만 (예: c12). 댓글 글을 쓰지 않는다", items: { type: "string" } }])), required: SENTIMENTS, additionalProperties: false };
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

// 화면 구조로 못 읽은 커뮤니티 댓글: 화면 글자에서 댓글만 골라냄
const EXTRACT_RULES = `★ 댓글 화면 판독 규칙 ★
너는 인터넷 게시판 글 화면을 글자로 옮긴 것에서 '독자 댓글'만 골라내는 도구다.
1. 댓글 본문은 한 글자도 바꾸거나 줄이거나 고치지 말고 화면에 있는 그대로 옮긴다 (맞춤법·비속어·이모티콘도 그대로).
2. 닉네임·아이디·레벨·날짜·추천/반대 수·IP·'답글/신고/추천/삭제' 같은 버튼 글자는 text 에 넣지 않는다.
3. 글 본문, 메뉴, 광고, 공지, 다른 글 목록·인기글, 댓글 쓰는 칸 안내 문구는 댓글이 아니다.
4. '삭제된 댓글입니다' 처럼 내용이 없는 댓글은 뺀다.
5. 댓글 옆에 작성 날짜·시각이 보이면 보이는 그대로 date 에 넣고, 없으면 빈 글자.
6. 다른 댓글에 단 답글(대댓글)이면 reply 를 true 로.
7. 화면 순서대로, 빠짐없이 모두. 댓글이 하나도 없으면 빈 배열.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    comments: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, date: { type: "string" }, reply: { type: "boolean" } },
        required: ["text", "date", "reply"],
        additionalProperties: false,
      },
    },
  },
  required: ["comments"],
  additionalProperties: false,
};

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

  // 커뮤니티 글 화면 글자 → [{ text, dateText, isReply }]
  async extractComments({ title, body, pageText, expected }) {
    let t = String(pageText || "").replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n");
    // 글 본문 앞쪽(메뉴 등)은 잘라 낸다
    const head = String(body || "").slice(0, 40).trim();
    const at = head ? t.indexOf(head) : -1;
    if (at > 0) t = t.slice(at);
    t = t.slice(0, 50000);
    const user = `글 제목: ${title || "(모름)"}\n화면에 보이는 댓글 수: ${expected ? `${expected}개` : "모름"}\n\n아래 화면 글자에서 댓글만 골라 줘.\n<page>\n${t}\n</page>`;
    const res = await this.callJson(EXTRACT_RULES, user, EXTRACT_SCHEMA, "low");
    return (res.comments || []).filter((c) => c && String(c.text || "").trim()).map((c) => ({ text: String(c.text), dateText: String(c.date || ""), isReply: !!c.reply }));
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
        if (p) out.set(p.key, { relevant: !!r.relevant, reason: r.reason || "", s: SENTIMENTS.includes(r.s) ? r.s : "" });
      }
      onBatch?.(Math.min(i + RELEVANCE_BATCH, posts.length), posts.length);
    }
    return out;
  }

  // comments: [{id, postTitle, channelName, text, isReply}] (같은 글의 댓글끼리 이어서) → Map(id → 성향)
  async classifySentiments(job, comments, onBatch, extra = "") {
    const out = new Map();
    const system = sentimentSystem(job, this.settings, extra);
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
          const a = await this.classifySentiments(job, batch.slice(0, half), null, extra);
          const b = await this.classifySentiments(job, batch.slice(half), null, extra);
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
        const again = await this.classifySentiments(job, missing, null, extra).catch(() => new Map());
        for (const [k, v] of again) out.set(k, v);
      }
      onBatch?.(Math.min(i + SENTIMENT_BATCH, comments.length), comments.length);
    }
    return out;
  }

  // stats: 통계 글, pool: {성향: [{id, text, channelName}]} → {title, summary[], quotes_short{}, quotes_long{}}
  // 제목·요약만 (주요 댓글은 고르지 않음)
  async writeSummary(job, stats, pool) {
    const lines = [];
    for (const s of SENTIMENTS) {
      lines.push(`\n## ${s} 댓글 예시`);
      for (const c of pool[s] || []) lines.push(`- (${c.channelName}) ${String(c.text).replace(/\s+/g, " ").slice(0, 200)}`);
    }
    const schema = { type: "object", properties: { title: { type: "string" }, summary: { type: "array", items: { type: "string" } } }, required: ["title", "summary"], additionalProperties: false };
    return this.callJson(reportSystem(job, this.settings), `${stats}\n\n이번에는 주요 댓글은 고르지 말고 title 과 summary 만 규칙대로 다시 써 줘. 아래는 성향별 댓글 예시다.${lines.join("\n")}`, schema, "medium");
  }

  async writeReport(job, stats, pool) {
    const lines = [];
    for (const s of SENTIMENTS) {
      lines.push(`\n## ${s} 댓글 후보`);
      for (const c of pool[s] || []) lines.push(`${c.id}\t(${c.channelName}) ${String(c.text).replace(/\s+/g, " ").slice(0, 300)}`);
    }
    return this.callJson(reportSystem(job, this.settings), `${stats}\n\n아래 후보 댓글(id\t(채널) 내용)에서 골라 줘.${lines.join("\n")}`, REPORT_SCHEMA, "high");
  }
}
