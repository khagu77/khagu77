// 처음 설치했을 때의 기본 설정. 화면의 '채널 설정'·'설정'에서 모두 바꿀 수 있다.

// 카페에서 바로 열면 안 보이는 글이 많아, 처음부터 네이버 검색(카페 탭)을 거쳐 들어가 읽는 카페 (온라인 오전 일일동향과 같음)
const VIA_SEARCH_CAFES = ["nexocafe", "truckerking"];

// 모니터링 동호회 (온라인 오전 일일동향에서 쓰는 동호회 목록) [이름, 카페 주소, 차종]
const DEFAULT_CAFES = [
  ["그랜저 리더스 클럽", "suddenattackskincafe", "GN7 PE / GN7"],
  ["그랜저 GN7 매니아", "bestani", "GN7 / GN7 PE"],
  ["그랜저 GN7 오너스", "allfm03", "GN7 / GN7 PE"],
  ["그랜저 멤버스", "bestcm", "GN7 / GN7 PE"],
  ["그랜저 패밀리", "mp3vilge", "GN7 PE / GN7"],
  ["쏘나타 오너스 클럽", "hyun6587", "DN8 PE / DN8"],
  ["올뉴아반떼 매니아", "blackboxclub", "CN7 / CN8"],
  ["아반떼 클럽", "avantemd", "CN7 / CN8"],
  ["CN8 클럽", "01088157554", "CN8"],
  ["N Club Korea", "nclubkorea", "CN7 N / NE N / CE N / NX4 N"],
  ["N Crew", "reviewnpreview", "CN7 N / NE N / CE N / NX4 N"],
  ["팰리세이드 피플", "allumpc", "LX3"],
  ["클럽 팰리세이드", "naworl", "LX3 / LX2 / LX2 PE"],
  ["LX3 클럽", "gamewinds", "LX3"],
  ["팰리세이드 오너스 클럽", "tobloomer", "LX3"],
  ["더팰리세이드", "hyundaipalisade", "LX3"],
  ["싼타페 MX5 패밀리", "trailer", "MX5"],
  ["클럽 싼타페", "iroid", "MX5"],
  ["싼타페 MX5 클럽", "choids", "MX5"],
  ["클럽 투싼", "musiclord", "NX4 PE / NX4"],
  ["올뉴투싼 매니아", "shiftouch", "NX4 PE / NX4"],
  ["코나 패밀리", "jsmusic", "SX2"],
  ["클럽 베뉴", "krzr", "QX"],
  ["캐스퍼 매니아", "cafe2078", "AX PE / AX"],
  ["캐스퍼 패밀리", "morningk", "AX PE / AX"],
  ["캐스퍼 일렉트릭 클럽", "lastchaos2", "AX EV"],
  ["스타리아 패밀리", "yhrhee9776", "US4 / US4 EV"],
  ["GV80 멤버스", "gruu", "JX PE / JX"],
  ["GV80 클럽", "dsdawdw", "JX PE / JX"],
  ["GV70 포럼", "ohwow", "JK PE / JK"],
  ["GV70 클럽", "rjswmqjrmdkffladl", "JK PE / JK"],
  ["G90 클럽", "corbyphone", "RS4"],
  ["위너클래스 G80", "fam100", "RG3 PE / RG3"],
  ["G80 클럽", "longware", "RG3 PE / RG3"],
  ["G70 클럽", "a60a70", "IK / IK PE"],
  ["제네시스 클럽", "newgenesisdh", "RG3 PE / RS4 / JK PE / JX PE / IK"],
  ["제네시스 전기차 클럽", "lovekorandoc", "JW / JK EV / RG3 EV"],
  ["제전클", "yc001", "JW / JK EV / RG3 EV"],
  ["전기차 동호회", "allfm01", "NE / CE / ME1 / NE PE / OS EV"],
  ["아이오닉 멤버스", "cafeclip", "NE / NE PE / CE / ME1"],
  ["아이오닉9 오너스", "ioniq9owners", "ME1"],
  ["아이오닉9 클럽", "optimusex119", "ME1"],
  ["넥쏘 카페", "nexocafe", "FE / NH2"],
  ["넥쏘 책임보증 카페", "nexoguarantee", "FE"],
  ["넥쏘 오너스", "fmsn98", "NH2 / FE"],
  ["스타리아EV & ST1 클럽", "steamgunz", "US4 EV / ST1"],
  ["현대모터클럽", "hmckorea", ""],
  ["영운모", "truckerking", "QZ / QV / QT"],
  ["자동차 정비 공유 카페", "autowave21", ""],
].map(([name, slug, car]) => ({ name, slug, car, on: false, viaSearch: VIA_SEARCH_CAFES.includes(slug) }));

// 모니터링 유튜브 채널 (담당자가 준 목록) [채널 이름, 채널 ID]
const DEFAULT_YOUTUBE_CHANNELS = [
  ["인싸 케이", "UCjYS1a6ENGSfUfxEJpVCOtQ"],
  ["우파푸른하늘 Woopa TV", "UCFUpTxU3nlGed-suY-FjjxA"],
  ["모트라인", "UCMTZqwCdw9Nynw9BkCgfeRQ"],
  ["없섭UPSub", "UCdpbqw5DPdBfaeByMF2Re0g"],
  ["오토기어", "UCsjzJWuBnPyA8-tj9pEDwXg"],
  ["BPD", "UCrOl7IuctoHW0iW-Gozj4EQ"],
  ["훼사원", "UCF2AFWB3tROplgmkt3nOXIw"],
  ["블라인드 카스토리", "UCFQ8D7RnvA1_1BWtIJXu86w"],
  ["재뻘TV", "UCknfGXdai7ZaDhs3Frhtb6A"],
  ["신사용", "UC6QJowhz8WHwkKr1KeN7FWg"],
  ["카비니", "UCu1zVEpCdQ0_aW0GoJxeb8w"],
  ["신차정보 연못구름", "UC-QNLjGvjEdwqtl3VtcuqgQ"],
  ["윤순의 평범치 않은 생활", "UCjUT74Kh33A-CRJFYGqNCmg"],
  ["멜론머스크", "UC3gZhNlLSVdRQLsItqA4VKA"],
  ["안오준TV", "UCX62PLc24ML_-tQ3fVPa2tQ"],
  ["자동차읽어주는남자", "UC4_AL-HBcYBjCTyNnMw0DOw"],
  ["강병휘의 Station.B", "UCZp9xeMSXrhlxFvOEuBCoAQ"],
  ["홍시CAR", "UCG2PHnetcVllQFPW5BsE_LA"],
  ["차도녀TV", "UCMe445IIQn_f0s7G2wdAOZg"],
  ["차봤서영", "UC5b2_GAScxz4guty7rv4Ulg"],
  ["더베스트랩", "UCV9aJOO9QY057Bo6U1l5yzg"],
  ["앗 차가와!", "UCu8vJYXzPbpG50NTZ6zTEqg"],
  ["주니TV", "UCXiruUThysG7zssj-unDgog"],
  ["Car Scene Korea", "UC0IsFqJzKJLRjHIznNNdhxQ"],
  ["정우성의 THE PARK", "UChO8Bz0JvDfareLOg3w1-jg"],
  ["울트라TV", "UCVdMEXU3GY8jnDdEwu2rOqw"],
  ["윤키라이드", "UC-LZSOdNyYJWfFyH94pJPsg"],
  ["카잼TV", "UCCE4oHV3UzJAEiZWuyqBt7g"],
  ["카티", "UCOGb_1FPYViRDGuw1i4-vdw"],
  ["모크리TV", "UC1cx02FHrEi6N7Q6AlAPicA"],
  ["김한용의 MOCAR", "UCd5CdYxogKBwvv1xyuxhvZA"],
  ["픽플러스", "UCvJnb0ty7RpquJKouRBeEzQ"],
  ["미디어오토", "UCT29dZNPg6exiMyMrVLL0fg"],
  ["금아", "UCYVZ6zFmvUmeBmmFD7CJRqQ"],
  ["남자들의 자동차", "UCCbLQtdzoIJB-Ah6_oWFsoA"],
  ["자동차 미생 Auto Engineer", "UCPv8dcL52lwQD2tbpgC9Kmw"],
  ["차쌈TV", "UCSjpMqEtqlhowucDxAXi4Og"],
  ["모드개러지", "UCIUKfPFV7ji0-tXyrevsjXA"],
  ["김누킴", "UCAnu8zuqomikJ58d6MsW_kw"],
  ["오렌지커스텀 TV", "UCZPybXX8kSB8prRtQQLH4Bg"],
  ["[싼존] 팰리세이드 생활", "UCcVFN2zfq6DWfzik4NLfh3g"],
  ["왜있슈TV", "UCO067SLFx4DEAsrkoY8ETFA"],
  ["한문철TV", "UCH5U89kvHrVxxS80xpoOydw"],
  ["박병일의 명장본색", "UCw0qRuJiJ47bLwUc_YgS3TQ"],
  ["노보스 인더스트리", "UC9Amgn24YSvlyzKWynKZh-w"],
  ["김승현의 스포일러", "UCqU_tyJmNZyCNcpcQubt24w"],
  ["차플레이", "UC3EoxBWACw1aMJca4OKhFUg"],
  ["모터그래프", "UCp0B9n0YYC8E8bJmS5i4oqw"],
].map(([name, id]) => ({ name, id }));

// 자동차 커뮤니티 (보배드림·클리앙·뽐뿌) — 게시판 주소
const DEFAULT_COMMUNITIES = [
  { name: "보배드림", url: "https://www.bobaedream.co.kr/list?code=national", on: true },
  { name: "클리앙", url: "https://www.clien.net/service/board/cm_car", on: true },
  { name: "뽐뿌", url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=car", on: true },
];

const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (정확·적당한 요금, 기본)", price: [2, 10], fallbacks: true },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (가장 정확)", price: [4, 20], fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (가장 저렴)", price: [0.1, 0.5], fallbacks: false },
];

const DEFAULT_SETTINGS = {
  cafes: DEFAULT_CAFES,
  communities: DEFAULT_COMMUNITIES,
  youtubeChannels: DEFAULT_YOUTUBE_CHANNELS, // [{ id: "UC…", name }]
  apiKey: "",
  model: "claude-sonnet-5-5",
  speed: "normal",
  cafeMaxPages: 5, // 카페마다 검색 결과 볼 페이지 수
  newsMaxPages: 10, // 네이버 뉴스 검색어마다 볼 페이지 수 (한 페이지 10건)
  newsReplies: false, // 네이버 뉴스 답글까지 모을지
  usdKrw: 1400,
  customPrompt: "",
  saveFolder: "",
};

// 속도 설정별 대기 시간(ms)
const DELAYS = {
  normal: { page: [3000, 6000], article: [4000, 8000], cafeGap: [4000, 8000], community: [2500, 5000], news: [800, 1600] },
  slow: { page: [6000, 10000], article: [8000, 14000], cafeGap: [8000, 15000], community: [5000, 9000], news: [1500, 3000] },
};

// 명령 규칙 메모리 (Markdown): 담당자가 쌓아 가는 판정·작성 규칙. 모든 AI 단계에 붙는다
const MEMORY_INTRO = "담당자가 쌓아 가는 판정·작성 규칙입니다. 모든 AI 단계에 붙고, 기본 규칙과 다르면 이것을 따릅니다.";
// 담당자가 정한 기본 메모리 규칙 (처음부터 들어 있고, 예전 메모리에도 한 번 보태 준다)
const MEMORY_SEED = [
  ["보고서 작성 규칙", "- 성향별 주요 댓글(샘플)은 이번 보고서와 맞는 **가장 자극적인 댓글 위주**로, 원문 그대로(맞춤법·욕설·ㅋㅋ 그대로) 고른다. 센 댓글부터 앞에 둔다. _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 요약 문장에 '호구론', '장난질' 같은 커뮤니티 은어·속어·조롱 표현을 쓰지 않는다. 보고서다운 용어로 바꿔 쓴다 (예: 호구론 → 국내 구매자 차별 인식, 옵션 장난질 → 옵션 구성·유료화 불만). _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- '계약 취소·인수 거부 인증 확인'처럼 수집 자료에서 실제로 확인되지 않는 내용은 쓰지 않는다. 몇 건 안 되는 이야기는 '일부 언급' 정도로만 쓰고, 추측·과장·단정하지 않는다. _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 'ㅣㄱㅋㅋㅋㅋㅋㅅㅂ'처럼 자음·모음·ㅋㅋ·욕 줄임말만 있고 내용이 없는 댓글은 주요 댓글에서 뺀다. _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 요약은 2문장, 문장마다 PPT 한 줄에 들어가게 공백 포함 55자 이내(최대 60자)로 쓴다. 비율 숫자는 핵심 1~2개만. _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 요약에는 '깡통' 대신 '기본 모델'이라는 표현을 쓴다. _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 요약에는 중립 여론·중립 비율을 언급하지 않는다 (부정·단순비난·긍정 중심). _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 중립 주요 댓글은 자극적인 댓글이 아니라 감정·주장·비꼼이 거의 없는 최대한 중립스러운 댓글로 구성한다. 단, 너무 의미 없는 댓글(한두 마디, 이슈와 무관한 잡담)은 피하고, 특히 1페이지는 이번 이슈와 관계있는 성의 있는 내용(구체적인 사실·정보·비교·담담한 질문) 위주로 고른다. _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- PPT 1페이지는 대표적인 자극적인 댓글 위주로, 2페이지는 1페이지에 쓰지 않은 나머지 댓글 중 중요하다고 판단되는 댓글로 구성한다. 1페이지에 넣은 댓글은 2페이지 주요 댓글에 다시 넣지 않는다(두 페이지 중복 금지). _(2026-10-21, 담당자 요청)_"],
  ["보고서 작성 규칙", "- 요약은 실제로 가장 많이 등장·언급되고 반응이 센 주요 논점 2~3개만 많이 나온 순서대로, 짧고 간결하게 포인트가 딱 짚히도록 쓴다. _(2026-10-21, 담당자 요청)_"],
];
// 고쳐 쓴 기본 규칙의 예전 문장 앞부분 (메모리에 남아 있으면 지움)
const MEMORY_SEED_OLD = ["- 중립 주요 댓글은 자극적인 댓글이 아니라, 감정·주장·비꼼이 거의 없는 정말 별 의미 없는 최대한 중립스러운 댓글"];
const DEFAULT_MEMORY = `# 명령 규칙 메모리\n\n${MEMORY_INTRO}\n\n## 공통 규칙\n\n## 게시물 관련성 규칙\n\n## 성향 분석 규칙\n\n## 보고서 작성 규칙\n${MEMORY_SEED.filter(([sec]) => sec === "보고서 작성 규칙").map(([, l]) => l).join("\n")}\n`;

// 메모리에 실제 규칙(제목·안내 문장 말고)이 있는지
function memoryHasRules(md) {
  return String(md || "")
    .split("\n")
    .some((l) => l.trim() && !l.trim().startsWith("#") && l.trim() !== MEMORY_INTRO);
}

// 메모리의 '## 섹션' 끝에 한 줄 보태기 (섹션이 없으면 맨 끝에 새로)
function appendMemory(md, section, line) {
  const lines = String(md || DEFAULT_MEMORY).replace(/\s+$/, "").split("\n");
  const head = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (head < 0) return `${lines.join("\n")}\n\n## ${section}\n${line}\n`;
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let at = end;
  while (at > head + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, line);
  return `${lines.join("\n")}\n`;
}

async function loadSettings() {
  const { imrSettings } = await chrome.storage.local.get("imrSettings").catch(() => ({}));
  const s = { ...DEFAULT_SETTINGS, ...(imrSettings || {}) };
  if (s.memoryMd === undefined) {
    // 예전 '추가 지시사항'은 메모리의 공통 규칙으로 옮긴다
    s.memoryMd = s.customPrompt ? appendMemory(DEFAULT_MEMORY, "공통 규칙", s.customPrompt) : DEFAULT_MEMORY;
    s.customPrompt = "";
  }
  if (!Array.isArray(s.corrections)) s.corrections = [];
  // 바뀐 기본 규칙의 예전 문장은 지운다
  for (const gone of MEMORY_SEED_OLD) s.memoryMd = String(s.memoryMd).split("\n").filter((l) => !l.startsWith(gone)).join("\n");
  // 기본 메모리 규칙이 없으면 보태 준다 (같은 규칙이 이미 있으면 그대로)
  for (const [sec, line] of MEMORY_SEED) {
    const key = line.replace(/_\(.*\)_$/, "").trim().slice(0, 40);
    if (!String(s.memoryMd).includes(key)) s.memoryMd = appendMemory(s.memoryMd, sec, line);
  }
  for (const c of s.cafes) if (c.viaSearch === undefined) c.viaSearch = VIA_SEARCH_CAFES.includes(c.slug);
  if (!s.youtubeChannels?.length) s.youtubeChannels = DEFAULT_YOUTUBE_CHANNELS.map((c) => ({ ...c }));
  return s;
}

async function saveSettings(s) {
  await chrome.storage.local.set({ imrSettings: s });
}
