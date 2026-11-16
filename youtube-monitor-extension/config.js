// 기본 설정: 모니터링 기간 · 대상 채널 · 검색어 · 판단 단어 (화면 '설정'에서 바꾸면 그 값이 저장되어 계속 쓰임)

const DEFAULTS = {
  start: "2026-09-01",
  end: "", // 비우면 오늘
  // 기존 관리 채널: 다른 프로그램(LX3 수집기)에서 관리 중인 유튜브 영상 목록 — 영상 주소를 넣으면 그 영상의 채널로 바꿔 씀
  managed: [
    "qCzKGyMaDq4", "XBMdMt_QCCc", "4RBKMiM7U2U", "vUDDF-qIHc8", "8nD5NuYU78Q", "e0HLk5TohDc", "zHKmLScJwmQ",
    "1ZTBkyUWVsk", "c0BjmtN0U4g", "_JCP2fRFMDA", "Ul8LAQ6SL5o", "SUcSFeNftzg", "vYGVhHMIiwM", "Gw8QlbmzHY8",
    "LlVeeM8i9r8", "Oxhnyr4nchQ", "Ya7tNSCWHKQ", "JQ0328NfbWc", "Z_IMxiszGII", "fxKieGRWEd8", "Ee0tytsS_Ks",
  ]
    .map((id) => `https://www.youtube.com/watch?v=${id}`)
    .join("\n"),
  // 주요 경제 채널 (경제, 금융 유튜브 서칭 자료)
  econ: [
    ["지식인사이드", "https://www.youtube.com/@%EC%A7%80%EC%8B%9D%EC%9D%B8%EC%82%AC%EC%9D%B4%EB%93%9C"],
    ["김작가TV", "https://www.youtube.com/@lucky_tv"],
    ["신사임당", "https://www.youtube.com/@CH%EC%8B%A0%EC%82%AC%EC%9E%84%EB%8B%B9"],
    ["월급쟁이부자들TV", "https://www.youtube.com/@weolbu_official"],
    ["머니인사이드", "https://www.youtube.com/@moneyinside7"],
    ["부읽남TV", "https://www.youtube.com/@buiknam_tv"],
    ["언더스탠딩 : 세상의 모든 지식", "https://www.youtube.com/@understanding."],
    ["머니코믹스", "https://www.youtube.com/@moneymoneycomics"],
    ["전인구 경제연구소", "https://www.youtube.com/@moneydo"],
    ["소수몽키", "https://www.youtube.com/@sosumonkey"],
    ["소비더머니", "https://www.youtube.com/@%EC%86%8C%EB%B9%84%EB%8D%94%EB%A8%B8%EB%8B%88"],
    ["김짠부", "https://www.youtube.com/@zzanboo"],
    ["와이스트릿 - 지식과 자산의 복리효과", "https://www.youtube.com/@Ystreet"],
    ["E트렌드", "https://www.youtube.com/@E_TREND"],
    ["머니그라피", "https://www.youtube.com/@Moneygraphy"],
    ["이효석아카데미", "https://www.youtube.com/@hs_academy"],
    ["경제 읽어주는 남자(김광석TV)", "https://www.youtube.com/@%EA%B2%BD%EC%9D%BD%EB%82%A8_%EA%B9%80%EA%B4%91%EC%84%9DTV"],
    ["선대인", "https://www.youtube.com/@insightsun"],
    ["최배근", "https://www.youtube.com/@TV-ct8uh"],
    ["박정호 교수의 여의도멘션", "https://www.youtube.com/@Prof.Park_Yeouidomention"],
    ["압권", "https://www.youtube.com/@apkwon_"],
    ["장르가 머니", "https://www.youtube.com/@genreismoney"],
  ]
    .map(([n, u]) => `${n} | ${u}`)
    .join("\n"),
  // 관리·경제 채널 안에서 찾을 검색어
  channelQueries: "현대차, 현대자동차, 정의선",
  // 그 외 모든 채널: 유튜브 전체 검색 (업로드 날짜순)
  queries: [
    "현대차 위기", "현대자동차 위기", "현대차 비상", "현대차 몰락", "현대차 추락", "현대차 위기설", "현대차 망", "현대차 충격",
    "현대차 내수 부진", "현대차 판매 부진", "현대차 주가 폭락", "현대차 관세", "현대차 중국차", "현대차 테슬라", "현대차 BYD",
    "현대차 노조 파업", "현대차 옵션", "현대차 가격", "현대기아 위기", "정의선 위기", "현대차 착각", "현대차 끝났다",
  ].join("\n"),
  searchWindow: 7, // 전체 검색: 기간을 며칠씩 잘라 검색할지 (구간마다 검색 화면 1쪽 · 꽉 차면 더 잘게)
  // 현대차 관련인지 (제목·설명)
  topicWords: "현대차, 현대자동차, 현대 자동차, 현대기아, 현대·기아, 현대-기아, 현기차, 정의선, 현대모비스, 현차, HMG, Hyundai",
  // 부정 프레임 단어 (제목에 있으면 2점, 설명 앞부분에 있으면 1점 · 2점 이상이면 '부정')
  negWords: [
    "위기", "비상", "추락", "몰락", "위험", "경고", "충격", "쇼크", "끝났", "끝장", "망한", "망했", "망할", "망하", "망조", "붕괴", "무너",
    "흔들", "침몰", "적자", "손실", "폭락", "급락", "하락", "추풍낙엽", "굴욕", "참패", "착각", "산으로", "오판", "실패", "최악", "큰일",
    "공포", "비명", "역풍", "우려", "적신호", "빨간불", "경고등", "고전", "부진", "밀려", "밀린", "안방", "손절", "외면", "분노", "불만",
    "논란", "결함", "리콜", "파업", "철수", "구조조정", "감원", "관세 폭탄", "옛말", "답이 없", "쩔쩔", "덜 팔", "안 팔", "판매량 역전",
    "역전", "뒤처", "후진", "뼈아픈", "심각", "대위기", "치명", "바꿔라", "늦었", "거품", "옵션 장사", "배신", "실망", "꼼수",
  ].join(", "),
  // 부정 단어가 있어도 반대로 읽히는 말 (있으면 1점 뺌)
  posWords: "위기 극복, 기회, 반등, 역대 최대, 신기록, 호실적, 급등, 상승, 사상 최고",
  ai: { on: true, model: "claude-sonnet-5-5" },
  sound: true,
};

const AI_MODELS = [
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (기본 · 정확·빠름)"],
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 약 2배 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴 · 정확도 낮음)"],
];
const AI_PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] }; // 100만 토큰당 달러 (입력, 출력)
const WON_PER_USD = 1400;

const GROUPS = { managed: "관리 채널", econ: "경제 채널", other: "기타 채널" };
const GROUP_COLOR = { managed: "#2a78d6", econ: "#eb6834", other: "#1baf7a" };

function splitList(s) {
  return String(s || "")
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
