// 처음 설치할 때 넣는 기본 설정 (설정 화면에서 모두 바꿀 수 있음)
// 키워드 문법: '+' 또는 ',' 또는 줄바꿈 = 또는(OR), '*' = 그리고(AND), 띄어쓰기는 무시하고 비교
//   예) "팰리세이드*끼임" → 제목·내용에 '팰리세이드'와 '끼임'이 모두 있으면 걸림

export const CHANNELS = {
  news: { name: "언론", icon: "📰" },
  cafe: { name: "동호회", icon: "☕" },
  blog: { name: "블로그", icon: "✍️" },
  post: { name: "포스트", icon: "📝" },
  youtube: { name: "유튜브", icon: "▶️" },
  bobae: { name: "보배드림", icon: "🚗" },
  clien: { name: "클리앙", icon: "💬" },
  ppomppu: { name: "뽐뿌", icon: "🛒" },
  instagram: { name: "인스타그램", icon: "📷" },
};

const j = (a) => a.join(" + ");

// 현대차 관련 기본어: 이 단어가 들어간 글을 모읍니다 → '전체' 카테고리
const TARGET = j([
  "현대차", "현대자동차", "제네시스", "정의선", "인싸케이",
  "그랜저", "그랜져", "디올뉴그랜저", "gn7", "쏘나타", "dn8", "아반떼", "아반떼N", "아반떼하이브리드", "cn7", "CN8",
  "팰리세이드", "펠리세이드", "더뉴팰리세이드", "LX3", "싼타페", "산타페", "현대*산타페", "MX5", "투싼", "더뉴투싼", "the new tucson", "NX4", "투싼*nx4", "NX5",
  "코나", "코나ev", "베뉴", "캐스퍼", "현대*캐스퍼", "경차*캐스퍼", "캐스퍼*일렉트릭", "AX1", "벨로스터", "스타리아", "현대*스타리아", "스타렉스", "US4",
  "아이오닉", "아이오닉5", "아이오닉6", "아이오닉9", "넥쏘", "현대차*수소", "현대차*전기차", "현대차*하이브리드", "스마트스트림", "싼타크루즈",
  "G70", "G70*제네시스", "G80", "G80e", "G90", "eq900", "GV60", "GV70", "GV80",
  "포터", "현대*포터", "마이티", "현대*마이티", "엑시언트", "현대*엑시언트", "파비스", "카운티", "에어로시티", "현대*상용", "뉴라이즈",
  "블루핸즈", "블루링크", "블루멤버스", "플레오스", "ccNC",
]);

// 일반 차량 사고·화재: 현대차 단어가 없어도 이슈로 봅니다 (기존 시스템과 같게)
const ACCIDENT = j([
  "차량 화재", "불났", "탁송 불", "탁송 화재", "급발진", "급발진*주장", "시동꺼짐", "시동꺼짐*주장", "돌진", "역주행",
  "차량*화재", "차량*불", "차량*급발진", "차량*돌진", "차량*쾅", "차량*배터리*화재", "차량*화재*주장",
  "자동차*화재", "자동차*사망", "자동차*급발진", "자동차*돌진", "자동차*배터리*화재",
  "전기차*화재", "전기차*사망", "전기차*급발진", "전기차*불", "전기차*배터리*화재", "배터리*화재*주장",
  "SUV*급발진", "버스*화재", "버스*급발진", "버스*돌진", "화물차*화재", "화물차*급발진", "트럭*화재", "트럭*급발진", "트럭*돌진",
  "승용차*화재", "승용차*불", "승용차*급발진", "승용차*돌진", "승용차*시동꺼짐",
  "고속도로*화재", "고속도로*불", "고속도로*급발진", "고속도로*돌진", "도로*화재", "도로*불", "도로*급발진", "도로*돌진", "도로*시동꺼짐",
  "터널*화재", "터널*불", "터널*급발진", "터널*돌진", "터널*시동꺼짐", "추돌*화재",
  "보령*차량*화재", "보령*전기차*화재", "세종시*전기차*화재", "세종시*화재",
]);

// 품질·안전 (현대차 단어가 함께 있을 때만)
const QUALITY = j([
  "결함", "리콜", "무상수리", "누수", "불량", "파손", "고장", "사고", "사망", "화재", "에어백", "핸들*잠김", "ICCU", "ptc",
  "세타엔진", "세타2", "소비자리포트*세타", "엔진오일", "오일", "ECU", "레귤레이터", "제동", "긴급제동", "급제동",
  "진동", "햅틱", "2열컨트롤러", "avn", "손가락", "유리", "글라스", "흉기차", "현기차",
  "소송", "가처분", "불매", "청원", "간담회", "제보*결함", "원가절감", "성희롱", "성추행", "확진자", "판매 중단", "북미*결함*리콜",
  "PD수첩*공익*신고자", "수소충전소*고장",
]);

// LX3 전동 시트 (LX3 수집기 키워드)
const LX3 = j([
  "전동시트", "전동 시트", "전동*이슈", "시트*끼임", "끼임", "끼어서 보상", "시트*사망", "시트*사고", "시트*결함", "시트*리콜", "시트리콜",
  "2열*폴딩", "3열*폴딩", "원터치*시트", "등받이", "워크인", "리클라이닝*끼임",
]);

// 서비스·멤버십·정책 (현대차 단어가 함께 있을 때만)
const SERVICE = j([
  "블루핸즈*예약", "하이테크센터*예약", "파란손", "멍든손", "현대*영맨", "현대*카마스터", "현대*AS", "현대*보증", "사업소", "서비스센터",
  "블루멤버스", "블루맴버스", "멤버십", "멤버쉽", "블루포인트", "포인트", "bluemembers", "blue*point", "현대몰", "현대포인트몰", "멤버스카드", "맴버스카드",
  "네비", "내비", "내비게이션", "네비게이션", "과속카메라", "단속구간", "안내음성", "1577*5159", "블루링크", "ccNC", "플레오스",
  "포켓몬", "피카츄", "피카추", "메타몽", "디스플레이 테마", "마그마", "MAGMA", "ㅁㄱㅁ",
  "페달블랙박스", "블박", "패달블박", "중고차", "인증 중고차", "완성차", "개소세", "개별소비세", "탁송", "로드*탁송",
  "노사*합의", "광주형일자리", "수소충전소", "오토웨이타워", "친환경버스", "하이브리드*재계약", "박용진", "임상재*기자", "MBC*임상재", "오토포스트", "르르르",
]);

// 신차·유출 (현대차 단어가 함께 있을 때만)
const NEWCAR = j([
  "풀체인지", "페이스리프트", "유출", "신형", "신차*일정", "가격", "사전계약", "사전*계약", "년식변경", "연식변경", "페리",
  "제네시스*쿠페", "르블랑", "Le Blanc", "슈팅브레이크", "슈팅*브레이크", "왜건", "웨건", "전동화",
]);

// 비교 차종 (기아·타사) — 기본은 모으지 않음
const COMPARE = j(["K8", "K3", "K5", "K9", "EV6", "스포티지", "쏘렌토", "테슬라", "중국*전기차"]);

export const DEFAULT_KEYWORD_GROUPS = [
  { id: "target", name: "현대차 관련 기본어", role: "target", collect: true, issue: false, alert: false, requireTarget: false, rules: TARGET },
  { id: "accident", name: "일반 차량 사고·화재", role: "issue", collect: true, issue: true, alert: true, requireTarget: false, rules: ACCIDENT },
  { id: "quality", name: "품질·안전", role: "issue", collect: false, issue: true, alert: true, requireTarget: true, rules: QUALITY },
  { id: "lx3", name: "LX3 전동 시트", role: "issue", collect: false, issue: true, alert: true, requireTarget: true, rules: LX3 },
  { id: "service", name: "서비스·멤버십·정책", role: "issue", collect: false, issue: true, alert: false, requireTarget: true, rules: SERVICE },
  { id: "newcar", name: "신차·유출", role: "issue", collect: false, issue: true, alert: false, requireTarget: true, rules: NEWCAR },
  { id: "compare", name: "비교 차종(기아·타사)", role: "other", collect: false, issue: false, alert: false, requireTarget: false, rules: COMPARE },
  { id: "exclude", name: "제외어 (걸리면 저장 안 함)", role: "exclude", collect: false, issue: false, alert: false, requireTarget: false,
    rules: j(["팝니다", "삽니다", "판매합니다", "공동구매", "렌트*특가", "장기렌트*견적", "리스*견적", "신차*할인*견적"]) },
];

// 카테고리: filter = all(전체) | issue(이슈 키워드 걸린 글 + 필수 수집) | garbage(이슈 키워드 없는 글)
export const DEFAULT_CATEGORIES = [
  { id: "all", name: "전체", parent: null, channels: ["*"], filter: "all", fav: null },
  { id: "news", name: "언론", parent: null, channels: ["news"], filter: "issue", fav: null },
  { id: "cafe", name: "동호회 (네이버 전체)", parent: null, channels: ["cafe"], filter: "issue", fav: null },
  { id: "cafe_fav", name: "관심 동호회", parent: "cafe", channels: ["cafe"], filter: "issue", fav: "cafe" },
  { id: "blog", name: "블로그·포스트", parent: null, channels: ["blog", "post"], filter: "issue", fav: null },
  { id: "youtube", name: "유튜브 (전체)", parent: null, channels: ["youtube"], filter: "issue", fav: null },
  { id: "youtube_fav", name: "관심 유튜브", parent: "youtube", channels: ["youtube"], filter: "issue", fav: "youtube" },
  { id: "community", name: "자동차 커뮤니티", parent: null, channels: ["bobae", "clien", "ppomppu"], filter: "issue", fav: null },
  { id: "instagram", name: "인스타그램", parent: null, channels: ["instagram"], filter: "issue", fav: null },
  { id: "garbage", name: "가비지", parent: null, channels: ["*"], filter: "garbage", fav: null },
];

const FAV_CAFES = `그랜저리더스클럽:suddenattackskincafe
그랜저GN7매니아:bestani
그랜저GN7오너스:allfm03
그랜저멤버스:bestcm
그랜저패밀리:mp3vilge
쏘나타오너스클럽:hyun6587
올뉴아반떼 매니아:blackboxclub
아반떼 클럽:avantemd
CN8 패밀리:01088157554
N Club Korea:nclubkorea
N Crew:reviewnpreview
팰리세이드 피플:allumpc
클럽 팰리세이드:naworl
LX3 클럽:gamewinds
팰리세이드 오너스 클럽:tobloomer
더팰리세이드:hyundaipalisade
싼타페MX5패밀리:trailer
클럽싼타페:iroid
싼타페MX5클럽:choids
클럽투싼NX4:musiclord
올뉴투싼매니아:shiftouch
NX5 클럽:dfstore
코나패밀리:jsmusic
클럽베뉴:krzr
캐스퍼 매니아:cafe2078
캐스퍼 패밀리:morningk
캐스퍼 일렉트릭 클럽:lastchaos2
스타리아 패밀리:yhrhee9776
GV80 멤버스:gruu
GV80 클럽:dsdawdw
GV70 멤버스:ohwow
GV70 클럽:rjswmqjrmdkffladl
G90 클럽:corbyphone
G80 위너클래스:fam100
G80 클럽:longware
G70 클럽:a60a70
제네시스 클럽:newgenesisdh
제네시스 전기차 클럽:lovekorandoc
제네시스 전기차 포럼:supegame
메이드 포 제네시스:ad680801
제전클:yc001
전기차 동호회:allfm01
아이오닉 멤버스:cafeclip
아이오닉9 오너스:ioniq9owners
아이오닉9 클럽:optimusex119
넥쏘 카페:nexocafe
넥쏘 책임보증 카페:nexoguarantee
넥쏘 오너스:fmsn98
스타리아EV & ST1 클럽:steamgunz
현대모터클럽:hmckorea
영운모:truckerking`;

const FAV_YOUTUBE = `인싸 케이:UCjYS1a6ENGSfUfxEJpVCOtQ
우파푸른하늘 Woopa TV:UCFUpTxU3nlGed-suY-FjjxA
모트라인:UCMTZqwCdw9Nynw9BkCgfeRQ
없섭UPSub:UCdpbqw5DPdBfaeByMF2Re0g
오토기어:UCsjzJWuBnPyA8-tj9pEDwXg
BPD:UCrOl7IuctoHW0iW-Gozj4EQ
훼사원:UCF2AFWB3tROplgmkt3nOXIw
블라인드 카스토리:UCFQ8D7RnvA1_1BWtIJXu86w
재뻘TV:UCknfGXdai7ZaDhs3Frhtb6A
신사용:UC6QJowhz8WHwkKr1KeN7FWg
카비니:UCu1zVEpCdQ0_aW0GoJxeb8w
신차정보 연못구름:UC-QNLjGvjEdwqtl3VtcuqgQ
윤순의 평범치 않은 생활:UCjUT74Kh33A-CRJFYGqNCmg
멜론머스크:UC3gZhNlLSVdRQLsItqA4VKA
안오준TV:UCX62PLc24ML_-tQ3fVPa2tQ
자동차읽어주는남자:UC4_AL-HBcYBjCTyNnMw0DOw
강병휘의 Station.B:UCZp9xeMSXrhlxFvOEuBCoAQ
홍시CAR:UCG2PHnetcVllQFPW5BsE_LA
차도녀TV:UCMe445IIQn_f0s7G2wdAOZg
차봤서영:UC5b2_GAScxz4guty7rv4Ulg
더베스트랩:UCV9aJOO9QY057Bo6U1l5yzg
앗 차가와!:UCu8vJYXzPbpG50NTZ6zTEqg
주니TV:UCXiruUThysG7zssj-unDgog
Car Scene Korea:UC0IsFqJzKJLRjHIznNNdhxQ
정우성의 THE PARK:UChO8Bz0JvDfareLOg3w1-jg
울트라TV:UCVdMEXU3GY8jnDdEwu2rOqw
윤키라이드:UC-LZSOdNyYJWfFyH94pJPsg
카잼TV:UCCE4oHV3UzJAEiZWuyqBt7g
카티:UCOGb_1FPYViRDGuw1i4-vdw
모크리TV:UC1cx02FHrEi6N7Q6AlAPicA
김한용의 MOCAR:UCd5CdYxogKBwvv1xyuxhvZA
픽플러스:UCvJnb0ty7RpquJKouRBeEzQ
미디어오토:UCT29dZNPg6exiMyMrVLL0fg
금아:UCYVZ6zFmvUmeBmmFD7CJRqQ
남자들의 자동차:UCCbLQtdzoIJB-Ah6_oWFsoA
자동차 미생 Auto Engineer:UCPv8dcL52lwQD2tbpgC9Kmw
차쌈TV:UCSjpMqEtqlhowucDxAXi4Og
모드개러지:UCIUKfPFV7ji0-tXyrevsjXA
김누킴:UCAnu8zuqomikJ58d6MsW_kw
오렌지커스텀 TV:UCZPybXX8kSB8prRtQQLH4Bg
[싼존] 팰리세이드 생활:UCcVFN2zfq6DWfzik4NLfh3g
왜있슈TV:UCO067SLFx4DEAsrkoY8ETFA
한문철TV:UCH5U89kvHrVxxS80xpoOydw
박병일의 명장본색:UCw0qRuJiJ47bLwUc_YgS3TQ
노보스 인더스트리:UC9Amgn24YSvlyzKWynKZh-w
김승현의 스포일러:UCqU_tyJmNZyCNcpcQubt24w
차플레이:UC3EoxBWACw1aMJca4OKhFUg
모터그래프:UCp0B9n0YYC8E8bJmS5i4oqw`;

const splitList = (s) => s.split("\n").map((l) => {
  const i = l.lastIndexOf(":");
  return { name: l.slice(0, i).trim(), id: l.slice(i + 1).trim() };
});

export const DEFAULT_FAV_CAFES = splitList(FAV_CAFES).map((c) => ({ ...c, joined: false }));
// must: 키워드와 관계없이 모든 영상을 수집 (인싸케이)
export const DEFAULT_FAV_YOUTUBE = splitList(FAV_YOUTUBE).map((c) => ({ ...c, must: c.id === "UCjYS1a6ENGSfUfxEJpVCOtQ" }));

export const DEFAULT_BOARDS = [
  { url: "https://www.bobaedream.co.kr/list?code=national", name: "보배드림 국산차" },
  { url: "https://www.bobaedream.co.kr/list?code=freeb", name: "보배드림 자유게시판" },
  { url: "https://www.clien.net/service/board/cm_car", name: "클리앙 자동차당" },
  { url: "https://www.clien.net/service/board/news", name: "클리앙 새로운소식" },
  { url: "https://www.clien.net/service/board/park", name: "클리앙 모두의공원" },
  { url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=car", name: "뽐뿌 자동차포럼" },
  { url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=freeboard", name: "뽐뿌 자유게시판" },
];

// 기본 성향 판정 사전 (규칙 기반 · AI 재분석으로 보정)
export const DEFAULT_LEXICON = {
  abuse: j(["흉기차", "현기차", "쓰레기", "똥차", "개차반", "양아치", "호구", "노답", "망했", "극혐", "ㅉㅉ", "병신", "ㅂㅅ", "시발", "씨발", "ㅅㅂ", "개같", "개판", "거지같", "현대가 현대했", "역시 현대", "불매"]),
  negative: j(["결함", "불량", "고장", "화재", "불났", "리콜", "누수", "소음", "떨림", "잡소리", "사고", "사망", "끼임", "급발진", "불만", "최악", "실망", "환불", "소송", "문제", "하자", "먹통", "오류", "부식", "녹슬", "시동꺼짐", "경고등", "짜증", "어이없", "답답", "피해", "위험", "논란", "의혹", "항의", "분통", "울화", "후회", "황당", "무상수리", "파손", "깨짐", "갈라짐", "멈춤", "꺼짐"]),
  positive: j(["만족", "좋아요", "좋네요", "좋습니다", "최고", "추천", "훌륭", "편하", "감사", "칭찬", "잘 샀", "굿", "멋지", "멋있", "예쁘", "이쁘", "완벽", "해결", "개선", "친절", "신속", "든든", "가성비", "호평", "인기", "1위", "출시", "수상", "역대 최대", "흥행"]),
};

// 인스타그램 해시태그 (계정당 7일에 30개까지)
export const DEFAULT_HASHTAGS = ["현대차", "현대자동차", "제네시스", "팰리세이드", "싼타페", "투싼", "아반떼", "쏘나타", "그랜저", "코나", "캐스퍼", "아이오닉5", "아이오닉6", "아이오닉9", "스타리아", "넥쏘", "gv80", "gv70", "g80", "현대차결함", "현대차리콜", "급발진"].join(" ");

export const DEFAULT_SETTINGS = {
  keywordGroups: DEFAULT_KEYWORD_GROUPS,
  categories: DEFAULT_CATEGORIES,
  favCafes: DEFAULT_FAV_CAFES,
  favYoutube: DEFAULT_FAV_YOUTUBE,
  boards: DEFAULT_BOARDS,
  lexicon: DEFAULT_LEXICON,
  collect: {
    enabled: true,
    naver: { news: true, blog: true, cafe: true, post: false },
    naverDailyBudget: 24000,      // 네이버 검색 API 1개 앱당 하루 25,000회 (여유분 제외)
    googleNews: true,              // 언론: Google 뉴스 RSS (서버만으로)
    googleNewsPerTick: 12,         // 하나씩 1.5~3초 간격 (많으면 Google 이 429 로 잠시 거절)
    daumBlog: true,                // 블로그: 다음(카카오) 블로그 검색 API (카카오 REST 키)
    daumBlogPerTick: 20,
    ppomppuRss: true,              // 뽐뿌: 게시판 RSS
    naverServerCafe: true,         // 네이버 카페는 서버도 아주 천천히 검색 (설치 없이)
    naverServerCafePerTick: 6,     // 5분마다 6번, 하나씩 4~7초 간격
    naverByExtension: true,        // 네이버 검색은 크롬 수집 도우미가 (서버는 네이버가 막음)
    extNaverPerRun: 12,            // 수집 도우미가 5분마다 하는 네이버 검색 수 (사람이 검색하는 정도)
    naverWebPerTick: 36,           // (API 키가 없을 때) 5분마다 읽는 네이버 검색 결과 화면 수
    youtubeRss: true,              // 관심 유튜브 새 영상 (무료·무제한)
    youtubeSearch: true,           // 유튜브 전체 검색 (YouTube Data API: 검색 1회 100단위)
    youtubeDailyUnits: 3000,       // 하루 사용 단위 (프로젝트 전체 10,000단위를 기존 유튜브 모니터링 시스템과 나눠 씀 · 검색 1회 100)
    community: true,
    newsDupThreshold: 0.8,         // 언론 제목 유사도 80% 이상 → 중복 묶음
    garbageRetentionDays: 90,      // 가비지 글 보관 기간(일) · 0 이면 지우지 않음 (중요 표시·메모 달린 글은 항상 보관)
  },
  alert: {
    dupThreshold: 0.8,             // 알림 제목 유사도 80% 이상 → 대표 1건만
    dupHours: 24,
    maxAgeHours: 3,                // 작성(또는 수집)된 지 이 시간 안의 글만 알림 (처음 수집 때 하루치가 한꺼번에 가는 것 방지)
    maxPerRun: 15,                 // 한 번 수집에 한 사람에게 보내는 최대 알림 수 (넘으면 요약 1건)
    favOnly: { cafe: true, youtube: true }, // 동호회·유튜브는 관심 동호회·관심 유튜브 글만 알림
    // 제목에 이 단어가 있으면 카톡 알림을 보내지 않음 (글은 목록에 그대로 저장)
    excludeTitle: "가입인사 + 가입 인사 + 가입했습니다 + 가입 했습니다 + 등업 + 등업신청 + 등업 신청 + 출석체크 + 출석 체크 + 자기소개 + 첫인사 + 첫 인사 + 인사드립니다 + 인사 드립니다",
  },
  instagram: { on: true, hashtags: DEFAULT_HASHTAGS, perTick: 4 },
  ai: {
    geminiModel: "gemini-2.5-flash",
    claudeModel: "claude-opus-5-5",
    claudeEffort: "low",
    autoChannels: ["ppomppu"],     // 새 글이 들어오면 바로 AI 성향 분석할 채널 (Gemini 무료 한도로만)
  },
};
