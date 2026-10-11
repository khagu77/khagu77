// 처음 설치했을 때의 기본 설정. 설정 화면에서 모두 바꿀 수 있다.

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
  ["캐스퍼 매니아", "cafe2078", "AX1"],
  ["캐스퍼 패밀리", "morningk", "AX1"],
  ["캐스퍼 일렉트릭 클럽", "lastchaos2", "AX1 EV"],
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
  ["영운모", "truckerking", "QZ / QV / WQ"],
  ["자동차 정비 공유 카페", "autowave21", ""],
].map(([name, id, car]) => ({ name, id, car, on: true }));

const DEFAULT_COMMUNITIES = [
  { name: "보배드림", url: "https://www.bobaedream.co.kr/list?code=national", on: true },
  { name: "클리앙", url: "https://www.clien.net/service/board/cm_car", on: true },
  { name: "뽐뿌", url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=car", on: true },
];

const DEFAULT_CAR_CODES = `# 차종별 코드명·적용 시기 (현대 제네시스 차종별 코드 정리표 기준). "코드: 차종명, 별칭 (세대, 적용 시기)" 한 줄에 하나, 최신 세대가 위.
# 규칙: 글에 "23년식", "24년형", "2022년 출고" 등 연식이 나오면 적용 시기로 세대를 고른다.
#       F/L(PE) 경계 연도처럼 두 코드에 걸치면 '더 뉴', '페리', 'F/L', 'PE' 언급이 있으면 PE, 없으면 카페 기본 차종을 따른다.
#       '계열', 'LWB 계열' 같은 말은 빼고 코드만 쓴다 (예: QZ 계열 → QZ). 전기차는 " EV", 하이브리드는 " HEV" 를 붙인다.
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
GN7: 그랜저, 그렌저 (7세대, 2022~현재)
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
AX1 EV: 캐스퍼 (전기차, 2024~현재)
AX1: 캐스퍼 (1세대, 2021~현재)
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
AE PHEV: 아이오닉 (플러그인, 2017~2022)
AE HEV: 아이오닉 (하이브리드, 2016~2022)
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
AX1 EV: 캐스퍼 일렉트릭, 캐스퍼EV, 캐스퍼 EV (전기차, 2024~현재)
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
US4 HEV: 스타리아 (하이브리드, 2024~현재)
US4 PE: 스타리아 (F/L, 2025~현재)
US4: 스타리아 (1세대, 2021~2025)
# 현대 쏠라티
EU: 쏠라티 (미니버스, 2015~현재, 시장별 상이)
# 현대 포터Ⅱ
HR EV: 포터, 포터2 (전기 트럭, 2019~현재)
HR: 포터, 포터2 (소형 트럭, 2004~현재)
# 현대 마이티
WQ 계열: 마이티 (준중형 트럭, 2015~현재)
# 현대 파비스
QV 계열: 파비스 (중형 트럭, 2019~현재)
# 현대 엑시언트
QZ FCEV: 엑시언트 (수소전기 트럭, 2020~현재)
QZ 계열: 엑시언트 (대형 트럭, 2013~현재)
# 현대 카운티
CN EV 계열: 카운티 (전기 버스, 2020~현재)
CN 계열: 카운티 (중형 버스, 1998~현재)
# 현대 일렉시티
CY 계열: 일렉시티 (전기 버스, 2017~현재)
# 현대 유니버스
PY FCEV: 유니버스 (수소전기 버스, 2023~현재)
PY 계열: 유니버스 (대형 버스, 2006~현재)
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
GN7 PE: 그랜저, 디 올 뉴 그랜저 F/L (7세대 F/L, 지난 보고서 사용)
CN8: 차세대 아반떼 (8세대)
ST1: ST1, ST-1 (2024~현재)
NX4 N: 투싼 N
CN7 N: 아반떼 N (2021~현재)`;

// 부정 이슈 키워드: "구분: 단어, 단어" 한 줄에 하나. 제외 = 이 말이 제목에 있으면 키워드 모드에서 뺀다.
const DEFAULT_KEYWORDS = `품질: 고장, 불량, 메시지, 무상 수리, 무상수리, 의심, 유격, 박리, 황변, 풍절음, 부조, 과열, 누출, 간헐적, 재발생, 미작동, 결함, 하자, 소음, 잡음, 이음, 떨림, 진동, 누수, 누유, 경고등, 점등, 오류, 에러, 먹통, 방전, 시동, 꺼짐, 부식, 녹슴, 녹이, 크랙, 균열, 깨짐, 파손, 단차, 도장, 들뜸, 변색, 냄새, 습기, 결로, 김서림, 작동 안, 작동안, 작동 불, 안됨, 안 됨, 불가, 멈춤, 리콜, 무상수리, 업데이트, 증상, 삐걱, 덜컹, 딸깍, 끼익, 찌그덕, 잡소리, 쏠림, 출력, ICCU, 충전 안, 충전안, 재부팅, 벌레소리, 안 움직, 안움직, 작동이 안, 안 켜, 안켜, 안 꺼, 안꺼, 멈춰
응대: 블루핸즈, 블핸, 정비 후기, 정비후기, 출고 지연, 출고지연, 카마스터, 파업, 하이테크, 직영, 서비스센터, 서비스 센터, 사업소, 파란손, 멍든손, AS, A/S, 보증, 정비, 수리, 입고, 응대, 불친절, 재입고, 재수리
결품: 결품, 재고, 부품, 수급, 부품 대기, 부품대기, 지연, 대기중, 입고 대기
제외: 출고 후기, 출고기, 시승기, 가입인사, 등업, 이벤트, 공지, 판매합니다, 삽니다, 나눔, 출고 대기, 출고대기, 출고 기다, 검수 업체, 검수업체, 검수 대행, 검수대행, 광고, 홍보, 오일교환, 오일 교환, 출석 도장, 출석도장, 출근 도장, 출근도장, 퇴근 도장, 퇴근도장, 출석체크, 출석 체크, 출첵, 출석부`;

// '주요 내용' 칸을 노란색으로 칠할 집중 관리 항목
const DEFAULT_HIGHLIGHTS = [
  { car: "LX3", topic: "전동 시트(2열·3열 포함) 관련 불만·고장·작동 오류, 시트 관련 업데이트 의견" },
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
  fileName: "{날짜}_현대차 제네시스 커뮤니티 부정이슈",
};

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (가장 정확)", price: [4, 20], fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (중간)", price: [2, 10], fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (가장 저렴)", price: [0.1, 0.5], fallbacks: false },
];

// 예전 버전에서 저장한 설정에 새 기본값을 보태 준다
const SETTINGS_VERSION = 3;
function migrateSettings(s) {
  if ((s.settingsVersion || 1) < 2 && typeof s.keywords === "string") {
    const add = "출고 대기, 출고대기, 출고 기다, 검수 업체, 검수업체, 검수 대행, 검수대행, 광고, 홍보, 오일교환, 오일 교환".split(", ");
    s.keywords = s.keywords.replace(/^(\s*제외\s*[:：].*)$/m, (line) => {
      const missing = add.filter((w) => !line.includes(w));
      return missing.length ? `${line}, ${missing.join(", ")}` : line;
    });
  }
  if ((s.settingsVersion || 1) < 3) {
    // 차종 코드표를 연식 정리표 기준으로 교체, 캐스퍼 코드 AX → AX1, 출석·퇴근 도장 글 제외어 추가
    s.carCodes = DEFAULT_CAR_CODES;
    for (const c of s.cafes || []) {
      if (c.car) c.car = c.car.replace(/\bAX( PE)?\b(?! ?\d)/g, "AX1").replace(/AX1 \/ AX1/g, "AX1");
    }
    if (typeof s.keywords === "string") {
      const add = "출석 도장, 출석도장, 출근 도장, 출근도장, 퇴근 도장, 퇴근도장, 출석체크, 출석 체크, 출첵, 출석부".split(", ");
      s.keywords = s.keywords.replace(/^(\s*제외\s*[:：].*)$/m, (line) => {
        const missing = add.filter((w) => !line.includes(w));
        return missing.length ? `${line}, ${missing.join(", ")}` : line;
      });
    }
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
