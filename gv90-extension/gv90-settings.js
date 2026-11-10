// GV90 수집기 설정 (수집 화면 · 데일리 DB · 대시보드 · 백그라운드 자동 수집이 함께 씀 · 화면 요소를 쓰지 않음)
//  - 수집 채널(동호회·유튜브 채널·커뮤니티·언론)은 '이슈 모니터링 보고서 작성' 확장과 같은 목록
//  - 수집 기간·자동 수집·근무일/휴일 처리는 '온라인 오전 일일동향' 확장과 같은 규칙
//    · 수집 기간 기본값: 전일 07:30 ~ 금일 07:30 (근무일엔 직전 근무일 07:30부터)
//    · 자동 수집: 매일 06:00 (PC·크롬 켜짐 + 네이버 로그인 필요) · 그 시각에 꺼져 있었으면 그날 정오 전 크롬을 켤 때
//    · 근무일 보고서: 휴일(주말·공휴일·회사 휴무)엔 수집만 해 데일리 DB 에 두고, 다음 근무일 아침 엑셀에 합친다

// 카페에서 바로 열면 안 보이는 글이 많아, 처음부터 네이버 검색(카페 탭)을 거쳐 들어가 읽는 카페 (온라인 오전 일일동향과 같음)
const VIA_SEARCH_CAFES = ["nexocafe", "truckerking"];

// 모니터링 동호회 (온라인 오전 일일동향 · 이슈 모니터링 보고서와 같은 목록 + 일일동향에 새로 넣은 NX5 클럽·제네시스 전기차 포럼·메이드 포 제네시스) [이름, 카페 주소, 차종]
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
  ["클럽 투싼", "musiclord", "NX4 PE / NX5 / NX4"],
  ["올뉴투싼 매니아", "shiftouch", "NX4 PE / NX5 / NX4"],
  ["NX5 클럽", "dfstore", "NX5"],
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
  ["제네시스 전기차 포럼", "supegame", "JG1 / JG"],
  ["메이드 포 제네시스", "ad680801", ""],
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
].map(([name, slug, car]) => ({ name, slug, car, on: true, viaSearch: VIA_SEARCH_CAFES.includes(slug) }));

// 모니터링 유튜브 채널 (이슈 모니터링 보고서와 같은 목록) [채널 이름, 채널 ID]
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
].map(([name, id]) => ({ name, id, on: true }));

// 자동차 커뮤니티 (보배드림·클리앙·뽐뿌) — 게시판 주소
const DEFAULT_COMMUNITIES = [
  { name: "보배드림", url: "https://www.bobaedream.co.kr/list?code=national", on: true },
  { name: "클리앙", url: "https://www.clien.net/service/board/cm_car", on: true },
  { name: "뽐뿌", url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=car", on: true },
];

// 공휴일·회사 휴무일 (온라인 오전 일일동향과 같은 목록): 이 날과 주말(근무 요일이 아닌 날)은 수집만 하고, 다음 근무일 엑셀에 합친다
// 음력 공휴일(설·부처님오신날·추석)과 대체공휴일은 정부 발표로 꼭 확인해서 고쳐 주세요.
const DEFAULT_HOLIDAYS = `# YYYY-MM-DD 이름  (한 줄에 하루, # 은 메모)
2026-12-25 성탄절
2027-01-01 신정
2027-02-05 설날 연휴
2027-02-06 설날
2027-02-07 설날 연휴
2027-02-08 대체공휴일(설날)
2027-03-01 삼일절
2027-05-05 어린이날
2027-05-13 부처님오신날
2027-06-06 현충일
2027-08-15 광복절
2027-08-16 대체공휴일(광복절)
2027-09-14 추석 연휴
2027-09-15 추석
2027-09-16 추석 연휴
2027-10-03 개천절
2027-10-04 대체공휴일(개천절)
2027-10-09 한글날
2027-10-11 대체공휴일(한글날)
2027-12-25 성탄절
2027-12-27 대체공휴일(성탄절)`;

// 속도 설정별 대기 시간(ms) (이슈 모니터링 보고서와 같음)
const DELAYS = {
  normal: { page: [3000, 6000], article: [4000, 8000], cafeGap: [4000, 8000], community: [2500, 5000], news: [800, 1600] },
  slow: { page: [6000, 10000], article: [8000, 14000], cafeGap: [8000, 15000], community: [5000, 9000], news: [1500, 3000] },
};

// 수집 키워드 (이슈 모니터링 보고서와 같은 문법: 한 줄 = 검색어 하나, 띄어 쓴 단어 = 모두 들어간 글, A|B = A 또는 B, -단어 = 빼기)
const DEFAULT_KEYWORDS = `GV90
지브이90|지브이 90
네오룬|NEOLUN
JG1 제네시스|GV|SUV`;
// 동호회(카페 안 검색) 검색어: 카페 검색은 사람 속도로 화면을 열어 읽어 느리므로 적게
const DEFAULT_CAFE_KEYWORDS = "GV90, 네오룬";

const DEFAULT_SETTINGS = {
  // 채널
  cafes: DEFAULT_CAFES,
  youtubeChannels: DEFAULT_YOUTUBE_CHANNELS,
  communities: DEFAULT_COMMUNITIES,
  channels: { news: true, cafe: true, youtube: true, community: true },
  youtubeSearch: true, // 모니터링 채널 밖 영상도 유튜브 검색(최신 업로드)으로 찾기
  keywords: DEFAULT_KEYWORDS,
  cafeKeywords: DEFAULT_CAFE_KEYWORDS,
  newsMaxPages: 3,
  cafeMaxPages: 3,
  speed: "normal",
  // 시간 · 자동 수집 · 휴일 (온라인 오전 일일동향과 같음)
  autoRun: true,
  autoRunTime: "06:00",
  rangeStartTime: "07:30", // 수집 기간 기본값: 전일 이 시각부터
  cutoffTime: "07:30", // 금일 이 시각까지
  workdayReport: true, // 근무일 보고서: 근무일 아침에만 엑셀을 받고, 휴일 수집분은 다음 근무일에 합침
  collectOnHolidays: true, // 휴일에도 미리 수집해 둠 (근무일 아침 수집량이 줄어 빨리 끝남)
  workdays: "1,2,3,4,5", // 0=일 … 6=토
  holidays: DEFAULT_HOLIDAYS,
  // 엑셀 · 저장
  fileName: "{날짜}_GV90 온라인 동향 raw data",
  xlsxScope: "all", // all = 데일리 DB 누적(연번 이어짐) · today = 이번 보고분만
  saveFolder: "", // 다운로드 폴더 안 하위 폴더 (저장 폴더를 고르지 않았을 때)
  macFolderPath: "", // 맥: 고른 저장 폴더의 전체 경로 ('출처' 정보 지우기에 씀)
  saveAsk: false,
  sound: true,
  // 분석
  apiKey: "",
  model: "claude-opus-5-5",
  aiOn: false, // 기본은 무료 분석(키워드·단어 사전). 켜면 수집할 때마다(자동 수집 포함) AI 로도 판독 · 끄면 결과 표의 'AI 로 분석' 버튼으로만
  lexicon: { pos: "", neg: "", blame: "" },
};

// ---------------------------------------------------------------------------
// 근무일 · 수집 기간 (온라인 오전 일일동향 common.js / defaults.js 와 같은 규칙)
// ---------------------------------------------------------------------------

function ymdKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function holidayMap(text) {
  const out = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = line.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*(.*)$/);
    if (m) out.set(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, m[4] || "휴일");
  }
  return out;
}

// 근무일인지: 근무 요일(기본 월~금)이고 휴일 목록에 없는 날
function isWorkday(d, s) {
  const days = String(s.workdays || "1,2,3,4,5").split(",").map((x) => +x);
  return days.includes(d.getDay()) && !holidayMap(s.holidays).has(ymdKey(d));
}

// 그날이 휴일이면 이유("토요일", "한글날" 등), 근무일이면 ""
function dayOffReason(d, s) {
  const name = holidayMap(s.holidays).get(ymdKey(d));
  if (name) return name;
  const days = String(s.workdays || "1,2,3,4,5").split(",").map((x) => +x);
  return days.includes(d.getDay()) ? "" : `${"일월화수목금토"[d.getDay()]}요일`;
}

function cutoffHM(s, which = "end") {
  const v = which === "start" ? (s && (s.rangeStartTime || s.cutoffTime)) : s && s.cutoffTime;
  const m = String(v || "07:30").match(/^(\d{1,2}):(\d{2})/);
  return m ? [+m[1], +m[2]] : [7, 30];
}

// 수집 기간 기본값: 전일 시작 시각 ~ 금일 끝 시각. 근무일 보고서 모드에서 오늘이 근무일이면 직전 근무일부터 (월요일 → 금요일 07:30~)
function defaultRange(now = new Date(), s = null) {
  const [h, mi] = cutoffHM(s, "end");
  const [sh, sm] = cutoffHM(s, "start");
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi, 0);
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, sh, sm, 0);
  if (s && s.workdayReport && isWorkday(now, s)) {
    for (let i = 0; i < 7 && !isWorkday(start, s); i++) start = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, sh, sm, 0);
  }
  return { start, end };
}

// 파일 이름: {날짜} = 보고일 YYMMDD (온라인 오전 일일동향과 같은 모양)
function reportFileName(s, end = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const d = new Date(end);
  const ymd6 = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const name = String(s.fileName || DEFAULT_SETTINGS.fileName).replace(/\{날짜\}/g, ymd6).replace(/[\\/:*?"<>|]/g, "_").replace(/\.xlsx$/i, "").trim();
  return `${name || ymd6}.xlsx`;
}

// ---------------------------------------------------------------------------
// 저장 · 불러오기 (chrome.storage.local 'gvSettings')
// ---------------------------------------------------------------------------

async function loadSettings() {
  const { gvSettings } = await chrome.storage.local.get("gvSettings").catch(() => ({}));
  const s = { ...DEFAULT_SETTINGS, ...(gvSettings || {}) };
  s.channels = { ...DEFAULT_SETTINGS.channels, ...(s.channels || {}) };
  s.lexicon = { ...DEFAULT_SETTINGS.lexicon, ...(s.lexicon || {}) };
  if (!Array.isArray(s.cafes) || !s.cafes.length) s.cafes = DEFAULT_CAFES.map((c) => ({ ...c }));
  if (!Array.isArray(s.youtubeChannels) || !s.youtubeChannels.length) s.youtubeChannels = DEFAULT_YOUTUBE_CHANNELS.map((c) => ({ ...c }));
  if (!Array.isArray(s.communities) || !s.communities.length) s.communities = DEFAULT_COMMUNITIES.map((c) => ({ ...c }));
  for (const c of s.cafes) if (c.viaSearch === undefined) c.viaSearch = VIA_SEARCH_CAFES.includes(c.slug);
  // 기본 목록에 새로 들어간 카페: 저장된 목록에 없고 직접 지운 적도 없으면 기본 목록의 앞 카페 바로 뒤에 넣는다
  const removed = new Set(s.removedCafes || []);
  DEFAULT_CAFES.forEach((d, i) => {
    if (removed.has(d.slug) || s.cafes.some((c) => c.slug === d.slug)) return;
    const prev = i > 0 ? s.cafes.findIndex((c) => c.slug === DEFAULT_CAFES[i - 1].slug) : -1;
    s.cafes.splice(prev + 1, 0, { ...d });
  });
  return s;
}

async function saveSettings(s) {
  await chrome.storage.local.set({ gvSettings: s });
}
