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
].map(([name, id, car]) => ({ name, id, car, on: true }));

const DEFAULT_COMMUNITIES = [
  { name: "보배드림", url: "https://www.bobaedream.co.kr/list?code=national", on: true },
  { name: "클리앙", url: "https://www.clien.net/service/board/cm_car", on: true },
  { name: "뽐뿌", url: "https://www.ppomppu.co.kr/zboard/zboard.php?id=car", on: true },
];

// 차종 코드표 (차종별 코드명 정리 PDF 기준). "코드: 차종명/별칭, ..." 한 줄에 하나.
const DEFAULT_CAR_CODES = `# 현대 승용 (현재)
GN7: 그랜저, 디 올 뉴 그랜저 (HEV 있음)
DN8: 쏘나타, 소나타, 쏘나타 디 엣지 (PE, HEV 있음)
CN7: 아반떼 (N=CN7 N, HEV 있음)
CN8: 차세대 아반떼
SX2: 코나 2세대, 디 올 뉴 코나 (EV=SX2 EV, HEV 있음)
NX4: 투싼 (PE, N=NX4 N, HEV 있음)
MX5: 싼타페, 디 올 뉴 싼타페 (HEV 있음)
LX3: 팰리세이드 신형, 디 올 뉴 팰리세이드 (HEV 있음)
US4: 스타리아 (EV=US4 EV)
EU: 쏠라티
ST1: ST1, ST-1
NE: 아이오닉5, 아이오닉 5 (PE, 아이오닉5 N=NE N)
CE: 아이오닉6, 아이오닉 6 (PE, N=CE N)
ME1: 아이오닉9, 아이오닉 9
NH2: 넥쏘 2세대, 디 올 뉴 넥쏘
AX: 캐스퍼 (PE=AX PE, EV=AX EV 캐스퍼 일렉트릭)
QX: 베뉴
OS: 코나 1세대 (EV=OS EV)
# 제네시스 (현재)
IK: G70 (PE=IK PE, 슈팅브레이크)
RG3: G80 (PE, HEV, EV=RG3 EV 전동화)
RS4: G90 (LWB)
JW: GV60
JK: GV70 (PE, EV=JK EV)
JX: GV80 (PE, 쿠페 포함)
# 현대 상용 (차종을 알 수 없으면 '-')
HR: 포터 (EV=HR EV, 포터2 일렉트릭)
QV: 파비스
VC: (기존 보고서에서 쓰인 트럭 코드)
QT: 올뉴마이티, 마이티
QZ: 엑시언트 (EV, 수소트럭=QZ FCEV)
COUNTY: 카운티 (EV)
HB: 에어로시티, 에어로타운
PV: 유니버스
CY: 일렉시티 (수소=CY FCEV)
# 이전 세대 (단종)
LX2: 팰리세이드 1세대 (PE)
TM: 싼타페 TM (PE, HEV)
DM: 싼타페 DM
CM: 싼타페 CM
TL: 투싼 TL (PE, HEV)
LM: 투싼 ix
IG: 그랜저 IG (PE, HEV)
HG: 그랜저 HG
TG: 그랜저 TG
LF: 쏘나타 LF (PE)
YF: 쏘나타 YF
NF: 쏘나타 NF
AD: 아반떼 AD (PE)
MD: 아반떼 MD
HD: 아반떼 HD
AE: 아이오닉 (HEV, EV)
FE: 넥쏘 1세대, 구형 넥쏘 (PE=FE PE)
TQ: 스타렉스
EN: 베라크루즈
JS: 벨로스터 2세대 (N)
FS: 벨로스터 1세대
VF: i40
PD: i30 3세대
AG: 아슬란
VI: 에쿠스
HI: G90 이전 세대, EQ900
DH: G80 이전 세대, 제네시스 DH`;

// 부정 이슈 키워드: "구분: 단어, 단어" 한 줄에 하나. 제외 = 이 말이 제목에 있으면 키워드 모드에서 뺀다.
const DEFAULT_KEYWORDS = `품질: 고장, 불량, 메시지, 무상 수리, 무상수리, 의심, 유격, 박리, 황변, 풍절음, 부조, 과열, 누출, 간헐적, 재발생, 미작동, 결함, 하자, 소음, 잡음, 이음, 떨림, 진동, 누수, 누유, 경고등, 점등, 오류, 에러, 먹통, 방전, 시동, 꺼짐, 부식, 녹슴, 녹이, 크랙, 균열, 깨짐, 파손, 단차, 도장, 들뜸, 변색, 냄새, 습기, 결로, 김서림, 작동 안, 작동안, 작동 불, 안됨, 안 됨, 불가, 멈춤, 리콜, 무상수리, 업데이트, 증상, 삐걱, 덜컹, 딸깍, 끼익, 찌그덕, 잡소리, 쏠림, 출력, ICCU, 충전 안, 충전안, 재부팅, 벌레소리, 안 움직, 안움직, 작동이 안, 안 켜, 안켜, 안 꺼, 안꺼, 멈춰
응대: 블루핸즈, 블핸, 정비 후기, 정비후기, 출고 지연, 출고지연, 카마스터, 파업, 하이테크, 직영, 서비스센터, 서비스 센터, 사업소, 파란손, 멍든손, AS, A/S, 보증, 정비, 수리, 입고, 응대, 불친절, 재입고, 재수리
결품: 결품, 재고, 부품, 수급, 부품 대기, 부품대기, 지연, 대기중, 입고 대기
제외: 출고 후기, 출고기, 시승기, 가입인사, 등업, 이벤트, 공지, 판매합니다, 삽니다, 나눔`;

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
};

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (가장 정확)", price: [4, 20], fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (중간)", price: [2, 10], fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (가장 저렴)", price: [0.1, 0.5], fallbacks: false },
];

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
