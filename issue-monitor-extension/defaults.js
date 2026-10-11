// 처음 설치했을 때의 기본 설정. 설정 화면에서 모두 바꿀 수 있다.

// 카페에서 바로 열면 안 보이는 글이 많아, 네이버 검색(카페 탭)을 거쳐 들어가 읽는 카페
const VIA_SEARCH_CAFES = ["nexocafe", "truckerking"];

// 카페별 게시판 지정 (숫자 = 게시판 번호, "그룹:이름" = 카페 메뉴의 묶음, 그 밖 = 게시판 이름)
const DEFAULT_BOARDS = {
  truckerking: "그룹:현대/기아 트럭",
  allfm01: "전기차자유게시판, 전기차 Q&A, 그룹:현대차 EV",
  nexocafe: "101, 31, 688",
  cafeclip: "1259, 1258, 78, 아이오닉5Q&A, 아이오닉6Q&A, 아이오닉9Q&A",
};

// 차종이 글에서 분명히 드러나지 않으면 빼는 카페 (자동차 커뮤니티는 모두 해당)
const REQUIRE_CAR_CAFES = ["hmckorea"];

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
].map(([name, id, car]) => ({ name, id, car, on: true, viaSearch: VIA_SEARCH_CAFES.includes(id), boards: DEFAULT_BOARDS[id] || "" }));

const DEFAULT_COMMUNITIES = [
  { name: "보배드림", url: "https://www.bobaedream.co.kr/list?code=national", on: true },
  { name: "클리앙", url: "https://www.clien.net/service/board/cm_car", on: true },
  { name: "뽐뿌", url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=car", on: true },
];

const DEFAULT_CAR_CODES = `# 차종별 코드명·적용 시기 (현대 제네시스 차종별 코드 정리표 기준). "코드: 차종명, 별칭 (세대, 적용 시기)" 한 줄에 하나, 최신 세대가 위.
# 규칙: 글에 "23년식", "24년형", "2022년 출고" 등 연식이 나오면 적용 시기로 세대를 고른다.
#       F/L(PE) 경계 연도처럼 두 코드에 걸치면 '더 뉴', '페리', 'F/L', 'PE' 언급이 있으면 PE, 없으면 카페 기본 차종을 따른다.
#       '계열', 'LWB 계열' 같은 말은 빼고 코드만 쓴다 (예: QZ 계열 → QZ). 전기차는 " EV" 를 붙이고, 하이브리드는 표기하지 않는다 (GN7 PE HEV → GN7 PE).
#       GV60 마그마(Magma) 는 JW 로 쓰고 주요 내용 끝에 "(마그마)" 를 붙인다.
# 현대 아반떼
CN7 PE: 아반떼, 아방 (7세대 F/L, 2023~현재)
CN7: 아반떼, 아방 (7세대, 2020~2023)
AD PE: 아반떼, 아방 (6세대 F/L, 2018~2020)
AD: 아반떼, 아방 (6세대, 2015~2020)
MD: 아반떼, 아방 (5세대, 2010~2015)
HD: 아반떼, 아방 (4세대, 2006~2010)
# 현대 쏘나타
DN8 PE: 쏘나타, 소나타, 쏘나타 디 엣지 (8세대 F/L, 2023~현재)
DN8: 쏘나타, 소나타, 쏘나타 디 엣지 (8세대, 2019~2023)
LF PE: 쏘나타, 소나타, 쏘나타 디 엣지 (7세대 F/L, 2017~2019)
LF: 쏘나타, 소나타, 쏘나타 디 엣지 (7세대, 2014~2019)
YF: 쏘나타, 소나타, 쏘나타 디 엣지 (6세대, 2009~2014)
NF: 쏘나타, 소나타, 쏘나타 디 엣지 (5세대, 2004~2009)
# 현대 그랜저
GN7 PE: 그랜저, 그렌저, 더 뉴 그랜저 (7세대 F/L, 현행)
GN7: 그랜저, 그렌저 (7세대, 2022~)
IG PE: 그랜저, 그렌저 (6세대 F/L, 2019~2022)
IG: 그랜저, 그렌저 (6세대, 2016~2019)
HG: 그랜저, 그렌저 (5세대, 2011~2016)
TG: 그랜저, 그렌저 (4세대, 2005~2011)
# 현대 엑센트
HC / YC: 엑센트 (5세대 해외형, 2017~2023, 시장별 상이)
RB: 엑센트 (4세대, 2010~2019)
# 현대 i30
PD: i30 (3세대, 2016~2020 국내 판매)
GD: i30 (2세대, 2011~2016)
FD: i30 (1세대, 2007~2011)
# 현대 벨로스터
JS: 벨로스터 (2세대, 2018~2022)
FS: 벨로스터 (1세대, 2011~2018)
# 현대 아슬란
AG: 아슬란 (단일 세대, 2014~2018)
# 현대 캐스퍼
AX EV: 캐스퍼 일렉트릭, 캐스퍼EV, 캐스퍼 EV (전기차, 2024~현재)
AX PE: 캐스퍼, 더 뉴 캐스퍼 (1세대 F/L, 현행)
AX: 캐스퍼 (1세대, 2021~)
# 현대 베뉴
QX: 베뉴 (1세대, 2019~현재)
# 현대 코나
SX2 EV: 코나 (2세대 전기차, 2023~현재)
SX2: 코나 (2세대, 2023~현재)
OS PE: 코나 (1세대 F/L, 2020~2023)
OS: 코나 (1세대, 2017~2020)
# 현대 투싼
NX4 PE: 투싼, 투산 (4세대 F/L, 2023~현재)
NX4: 투싼, 투산 (4세대, 2020~2023)
TL PE: 투싼, 투산 (3세대 F/L, 2018~2020)
TL: 투싼, 투산 (3세대, 2015~2018)
LM: 투싼, 투산 (2세대, 2009~2015)
JM: 투싼, 투산 (1세대, 2004~2009)
# 현대 싼타페
MX5: 싼타페, 산타페, 싼페 (5세대, 2023~현재)
TM PE: 싼타페, 산타페, 싼페 (4세대 F/L, 2020~2023)
TM: 싼타페, 산타페, 싼페 (4세대, 2018~2020)
DM: 싼타페, 산타페, 싼페 (3세대, 2012~2018)
CM: 싼타페, 산타페, 싼페 (2세대, 2005~2012)
SM: 싼타페, 산타페, 싼페 (1세대, 2000~2005)
# 현대 맥스크루즈
NC: 맥스크루즈 (1세대, 2013~2018)
# 현대 팰리세이드
LX3: 팰리세이드, 펠리세이드, 팰리 (2세대, 2025~현재)
LX2 PE: 팰리세이드, 펠리세이드, 팰리 (1세대 F/L, 2022~2024)
LX2: 팰리세이드, 펠리세이드, 팰리 (1세대, 2018~2024)
# 현대 베라크루즈
EN: 베라크루즈 (단일 세대, 2006~2015)
# 현대 테라칸
HP: 테라칸 (단일 세대, 2001~2007)
# 현대 아이오닉
AE: 아이오닉, 아이오닉 하이브리드 (하이브리드·플러그인, 2016~2022)
AE EV: 아이오닉 (일렉트릭, 2016~2022)
# 현대 아이오닉 5
NE N: 아이오닉5, 아이오닉 5, 아5 (고성능, 2023~현재)
NE PE: 아이오닉5, 아이오닉 5, 아5 (F/L, 2024~현재)
NE: 아이오닉5, 아이오닉 5, 아5 (초기형, 2021~2024)
# 현대 아이오닉 6
CE N: 아이오닉6, 아이오닉 6, 아6 (고성능, 2025~현재)
CE PE: 아이오닉6, 아이오닉 6, 아6 (F/L, 2025~현재)
CE: 아이오닉6, 아이오닉 6, 아6 (초기형, 2022~2025)
# 현대 아이오닉 9
ME1: 아이오닉9, 아이오닉 9, 아9 (대형 전기 SUV, 2025~현재)
# 현대 코나 일렉트릭
SX2 EV: 코나 일렉트릭, 코나EV, 코나 EV (2세대, 2023~현재)
OS EV: 코나 일렉트릭, 코나EV, 코나 EV (1세대, 2018~2023)
# 현대 캐스퍼 일렉트릭
AX EV: 캐스퍼 일렉트릭, 캐스퍼EV, 캐스퍼 EV (전기차, 2024~현재)
# 현대 넥쏘
NH2: 넥쏘 (2세대, 2025~현재)
FE: 넥쏘 (1세대, 2018~2025)
# 현대 투싼 ix FCEV
LM FC: 투싼 ix FCEV (수소전기차, 2013~2018)
# 현대 스타렉스
TQ: 스타렉스 (그랜드 스타렉스, 2007~2021)
A1: 스타렉스 (초기형, 1997~2007)
# 현대 스타리아
US4 EV: 스타리아 (전기차 파생형, 2026년형 / 판매 시점 별도 확인)
US4 PE: 스타리아 (F/L, 2025~현재)
US4: 스타리아 (1세대, 2021~2025)
# 현대 쏠라티
EU: 쏠라티 (미니버스, 2015~현재, 시장별 상이)
# 현대 포터Ⅱ
HR EV: 포터, 포터2 (전기 트럭, 2019~현재)
HR: 포터, 포터2 (소형 트럭, 2004~현재)
# 현대 마이티
QT: 마이티, 올뉴마이티 (준중형 트럭, 2015~현재)
# 현대 파비스
QV 계열: 파비스 (중형 트럭, 2019~현재)
# 현대 엑시언트
QZ FCEV: 엑시언트 (수소전기 트럭, 2020~현재)
QZ 계열: 엑시언트 (대형 트럭, 2013~현재)
# 현대 카운티
COUNTY EV: 카운티 일렉트릭 (전기 버스, 2020~현재)
COUNTY: 카운티 (중형 버스, 1998~현재)
# 현대 일렉시티
CY 계열: 일렉시티 (전기 버스, 2017~현재)
# 현대 유니버스
PV FCEV: 유니버스 수소 (수소전기 버스, 2023~현재)
PV: 유니버스 (대형 버스, 2006~현재)
# 제네시스 제네시스(현대 브랜드)
DH: 제네시스(현대 브랜드) (2세대, 2013~2016)
BH: 제네시스(현대 브랜드) (1세대, 2008~2013)
# 제네시스 G70
IK 계열: G70 (슈팅 브레이크, 2022~현재, 시장별 상이)
IK PE: G70 (1세대 F/L, 2020~현재)
IK: G70 (1세대, 2017~2020)
# 제네시스 G80
RG3 EV: G80 (전동화 F/L, 2024~현재)
RG3 EV: G80 (전동화, 2021~2024)
RG3 PE: G80 (3세대 F/L, 2023~현재)
RG3: G80 (3세대, 2020~2023)
DH: G80 (초기 G80, 2016~2020)
# 제네시스 EQ900
HI: EQ900 (초기 모델, 2015~2018)
# 제네시스 G90
RS4 LWB 계열: G90 (롱휠베이스, 2021~현재)
RS4: G90 (4세대, 2021~현재)
HI PE: G90 (초기 G90, 2018~2021)
# 제네시스 GV60
JW 계열: GV60 (마그마, 2026년형 계열)
JW PE: GV60 (1세대 F/L, 2025~현재)
JW: GV60 (1세대, 2021~2025)
# 제네시스 GV70
JK EV: GV70 (전동화 F/L, 2025~현재)
JK EV: GV70 (전동화, 2022~2025)
JK PE: GV70 (1세대 F/L, 2024~현재)
JK: GV70 (1세대, 2020~2024)
# 제네시스 GV80
JX: GV80 (쿠페, 2023~현재)
JX PE: GV80 (1세대 F/L, 2023~현재)
JX: GV80 (1세대, 2020~2023)
# 제네시스 GV90
JG: GV90 (대형 전기 SUV, 출시/양산 코드 확인 필요)

# 지난 보고서에서 쓰였지만 정리표에 없는 코드
CN8: 차세대 아반떼, 디 올 뉴 아반떼 (8세대, 신차)
NX5: 차세대 투싼, 신형 투싼, 디 올 뉴 투싼 (5세대, 신차)
ST1: ST1, ST-1 (2024~현재)
NX4 N: 투싼 N
CN7 N: 아반떼 N (2021~현재)`;

// 부정 이슈 키워드: "구분: 단어, 단어" 한 줄에 하나. 제외 = 이 말이 제목에 있으면 키워드 모드에서 뺀다.
const DEFAULT_KEYWORDS = `품질: 고장, 불량, 메시지, 무상 수리, 무상수리, 의심, 유격, 박리, 황변, 풍절음, 부조, 과열, 누출, 간헐적, 재발생, 미작동, 결함, 하자, 소음, 잡음, 이음, 떨림, 진동, 누수, 누유, 경고등, 점등, 오류, 에러, 먹통, 방전, 시동, 꺼짐, 부식, 녹슴, 녹이, 크랙, 균열, 깨짐, 파손, 단차, 도장, 들뜸, 변색, 냄새, 습기, 결로, 김서림, 작동 안, 작동안, 작동 불, 안됨, 안 됨, 불가, 멈춤, 리콜, 무상수리, 업데이트, 증상, 삐걱, 덜컹, 딸깍, 끼익, 찌그덕, 잡소리, 쏠림, 출력, ICCU, 충전 안, 충전안, 재부팅, 벌레소리, 안 움직, 안움직, 작동이 안, 안 켜, 안켜, 안 꺼, 안꺼, 멈춰
응대: 블루핸즈, 블핸, 정비 후기, 정비후기, 출고 지연, 출고지연, 카마스터, 파업, 하이테크, 직영, 서비스센터, 서비스 센터, 사업소, 파란손, 멍든손, AS, A/S, 보증, 정비, 수리, 입고, 응대, 불친절, 재입고, 재수리
결품: 결품, 재고, 부품, 수급, 부품 대기, 부품대기, 지연, 대기중, 입고 대기
제외: 출고 후기, 출고기, 시승기, 가입인사, 등업, 이벤트, 공지, 판매합니다, 삽니다, 나눔, 출고 대기, 출고대기, 출고 기다, 검수 업체, 검수업체, 검수 대행, 검수대행, 광고, 홍보, 오일교환, 오일 교환, 출석 도장, 출석도장, 출근 도장, 출근도장, 퇴근 도장, 퇴근도장, 출석체크, 출석 체크, 출첵, 출석부`;

// 공휴일·회사 휴무일: 이 날과 주말(근무 요일이 아닌 날)은 수집만 하고, 다음 근무일 보고서에 합친다
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

// 주요 내용 용어 통일 ("A > B" = A 대신 B, 그 밖의 줄은 AI 에게 주는 표현 기준)
const DEFAULT_TERMS = `크락션 > 클랙슨
윈도우 > 윈도
승용차는 트렁크, SUV 및 해치백은 테일게이트
본넷 > 보닛
프렁크 > 프론트 트렁크
데루등 > 리어램프
전조등 > 헤드램프
천정 > 천장
누수(물), 누유(오일·기름), 누출(냉매·가스·수소·냉각수 외 기체/액체) 표현을 구분해서 쓴다
와이퍼 잔상 > 와이퍼 잔사
서라운드뷰 > 어라운드뷰
디사미 > 디지털 사이드 미러
디센미 > 디지털 센터 미러
도어 손잡이(외부) > 도어 외캐치
도어 손잡이(내부) > 도어 내캐치
네비게이션 > 내비게이션
내비화면, 네비화면 > AVN 디스플레이
디스플레이가 작동 이외에 화면이 까맣게 되거나 먹통 > 디스플레이 블랙아웃`;

// 1인용 수집: 이 카페(ID)와 자동차 커뮤니티만 고른다 (수집 화면에서 지금 선택으로 바꿀 수 있음)
const DEFAULT_SOLO_CAFES = ["allfm01", "cafeclip", "ioniq9owners", "optimusex119", "nexocafe", "nexoguarantee", "fmsn98", "steamgunz", "hmckorea", "truckerking"];

// '주요 내용' 칸을 노란색으로 칠할 집중 관리 항목
const DEFAULT_HIGHLIGHTS = [
  { car: "LX3", topic: "전동 시트(2열·3열 포함) 관련 불만·고장·작동 오류·끼임 사고, 전동 시트 리콜 불만, 시트 관련 업데이트 의견" },
  { car: "ME1", topic: "2열·3열 전동 시트 끼임, 시트가 멈추지 않음(끼임 방지 미작동), 전동 시트 관련 리콜(해외 리콜 포함) 불만·문의" },
  { car: "MX5", topic: "2열·3열 전동 시트 끼임, 시트가 멈추지 않음(끼임 방지 미작동), 전동 시트 관련 리콜(해외 리콜 포함) 불만·문의" },
  { car: "JX", topic: "2열·3열 전동 시트 끼임, 시트가 멈추지 않음(끼임 방지 미작동), 전동 시트 관련 리콜(해외 리콜 포함) 불만·문의 (JX PE 포함)" },
];

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-opus-5-5",
  autoRun: true,
  autoRunTime: "06:00",
  speed: "normal", // normal | slow
  cafes: DEFAULT_CAFES,
  communities: DEFAULT_COMMUNITIES,
  carCodes: DEFAULT_CAR_CODES,
  highlights: DEFAULT_HIGHLIGHTS,
  keywords: DEFAULT_KEYWORDS,
  fileName: "{날짜}_차종별 온라인 동향_통합",
  priorityCars: "ME1, NH2, CN8, NX5, GN7 PE, US4 EV, JW",
  workdayReport: true, // 근무일 보고서: 근무일 아침에만 엑셀을 받고, 휴일 수집분은 다음 근무일에 합침
  collectOnHolidays: true, // 휴일에도 미리 수집해 둠 (근무일 아침 수집량이 줄어 빨리 끝남)
  workdays: "1,2,3,4,5", // 0=일 … 6=토
  holidays: DEFAULT_HOLIDAYS,
  terms: DEFAULT_TERMS,
  collectMode: "all", // all = 전체, solo = 1인용
  soloCafes: DEFAULT_SOLO_CAFES,
  soloCommunities: "all", // 1인용에서도 자동차 커뮤니티는 모두
  soloPrefix: "",
  customPrompt: "",
  customPromptUpdatedAt: 0,
  promptHistory: [],
};

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (가장 정확)", price: [4, 20], fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (중간)", price: [2, 10], fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (가장 저렴)", price: [0.1, 0.5], fallbacks: false },
];

// 예전 버전에서 저장한 설정에 새 기본값을 보태 준다
const SETTINGS_VERSION = 10;
function migrateSettings(s) {
  if ((s.settingsVersion || 1) < 2 && typeof s.keywords === "string") {
    const add = "출고 대기, 출고대기, 출고 기다, 검수 업체, 검수업체, 검수 대행, 검수대행, 광고, 홍보, 오일교환, 오일 교환".split(", ");
    s.keywords = s.keywords.replace(/^(\s*제외\s*[:：].*)$/m, (line) => {
      const missing = add.filter((w) => !line.includes(w));
      return missing.length ? `${line}, ${missing.join(", ")}` : line;
    });
  }
  if ((s.settingsVersion || 1) < 3) {
    // 차종 코드표를 연식 정리표 기준으로 교체, 출석·퇴근 도장 글 제외어 추가
    s.carCodes = DEFAULT_CAR_CODES;
    for (const c of s.cafes || []) {
    }
    if (typeof s.keywords === "string") {
      const add = "출석 도장, 출석도장, 출근 도장, 출근도장, 퇴근 도장, 퇴근도장, 출석체크, 출석 체크, 출첵, 출석부".split(", ");
      s.keywords = s.keywords.replace(/^(\s*제외\s*[:：].*)$/m, (line) => {
        const missing = add.filter((w) => !line.includes(w));
        return missing.length ? `${line}, ${missing.join(", ")}` : line;
      });
    }
  }
  if ((s.settingsVersion || 1) < 10) {
    if (!s.terms) s.terms = DEFAULT_TERMS;
  }
  if ((s.settingsVersion || 1) < 9) {
    // 노란색: ME1·MX5·JX 전동 시트 끼임·멈춤·리콜 이슈 추가 (이미 같은 차종 항목이 있으면 그대로 둠)
    s.highlights = s.highlights || [];
    const OLD_LX3 = "전동 시트(2열·3열 포함) 관련 불만·고장·작동 오류, 시트 관련 업데이트 의견";
    for (const h of s.highlights) if (h.car === "LX3" && h.topic === OLD_LX3) h.topic = DEFAULT_HIGHLIGHTS[0].topic;
    for (const h of DEFAULT_HIGHLIGHTS) if (!s.highlights.some((x) => x.car === h.car)) s.highlights.push({ ...h });
  }
  if ((s.settingsVersion || 1) < 8) {
    for (const c of s.cafes || []) if (!c.boards && DEFAULT_BOARDS[c.id]) c.boards = DEFAULT_BOARDS[c.id];
  }
  if ((s.settingsVersion || 1) < 7) {
    // 하이브리드(HEV) 표기 안 함
    s.carCodes = DEFAULT_CAR_CODES;
  }
  if ((s.settingsVersion || 1) < 6) {
    // 상용 코드 QT / COUNTY / PV 유지, NX5 추가, 파일 이름 기본값 변경
    s.carCodes = DEFAULT_CAR_CODES;
    for (const c of s.cafes || []) if (c.id === "truckerking") c.car = "QZ / QV / QT";
    if (!s.fileName || s.fileName === "{날짜}_현대차 제네시스 커뮤니티 부정이슈") s.fileName = DEFAULT_SETTINGS.fileName;
  }
  if ((s.settingsVersion || 1) < 5) {
    // 캐스퍼는 AX / AX PE / AX EV, 그랜저 현행은 GN7 PE (1.3.0 의 AX1 표기 되돌림)
    s.carCodes = DEFAULT_CAR_CODES;
    for (const c of s.cafes || []) {
      if (!c.car) continue;
      c.car = c.car.replace(/AX1 EV/g, "AX EV").replace(/^AX1$/, "AX PE / AX").replace(/AX1/g, "AX");
    }
  }
  if ((s.settingsVersion || 1) < 4) {
    for (const c of s.cafes || []) if (VIA_SEARCH_CAFES.includes(c.id)) c.viaSearch = true;
  }
  s.settingsVersion = SETTINGS_VERSION;
  return s;
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return migrateSettings({ ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) });
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
