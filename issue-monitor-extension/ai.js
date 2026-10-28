// Claude API 로 1) 제목 선별 2) 본문을 읽고 부정 이슈 판정·구분·차종·요약을 한다.

const TRIAGE_BATCH = 150; // 제목 선별 한 번에 보낼 글 수
const CLASSIFY_BATCH = 6; // 본문 판정 한 번에 보낼 글 수
const BODY_CHARS = 3000; // 본문은 앞부분만 보낸다 (비용 절약)

const ISSUE_DEFINITION = `부정 이슈는 다음 3가지다. (지난 보고서 기준 품질이 약 93%, 응대 약 6%, 결품 약 1%)
1) 품질: 차량 고장·불량·결함, 소음·진동, 누수·누유, 경고등·점검 메시지, 화면·소프트웨어·인포테인먼트 오류, 부식·도장·단차·마감, 신차 검수 불량 등 품질 불만.
   고장 처리 방법 문의, 같은 증상 유경험자 문의, 증상 공유, 무상수리·리콜 정보 공유/문의, 업데이트 관련 의견(불만·문의·후기)도 포함.
   안전사고 경고성 글도 품질로 포함: 실제 사고는 나지 않았지만 차량 때문에 사고가 날 뻔했다·위험했다·아찔했다, 이런 증상이 있으니 조심하라는
   경고 글 (예: 주행 중 갑자기 밀림·가속·제동 이상을 겪을 뻔함, 문·테일게이트·창문 끼임 위험, 미끄러짐·쏠림 경험 공유 등). (담당자 지정 2026-10-22, gamewinds/4299497)
2) 응대: 블루핸즈, 하이테크 센터, 직영 서비스센터(은어: 파란손, 멍든손 등)의 정비 후기·AS·보증수리 응대 불만, 정비 과정·결과물 불만(재수리, 수리 후 재발, 불친절, 보증 거절 등), 업데이트 후기, 출고 지연·카마스터 응대 불만, 파업 등으로 인한 정비·출고 지연.
3) 결품: 입고했는데 부품 재고 부족·부품 수급 문제로 정비가 지연되는 불만. (고장으로 입고했더라도 불만의 무게가 부품 결품·정비 지연에 있으면 결품)`;

// 기본 프롬프트(아래 규칙)를 마지막으로 고친 때 - '명령 프롬프트' 화면에 표시
const PROMPT_BUILT_AT = "2026-10-28 (v1.10.29)";

// '명령 프롬프트' 화면에서 사용자가 추가한 지시사항 (모든 AI 단계에 붙고, 기본 규칙보다 우선)
function customInstructions(settings) {
  const t = String((settings && settings.customPrompt) || "").trim();
  return t ? `\n\n추가 지시사항 (사용자가 수시로 추가한 것, 위 규칙과 충돌하면 이것을 따른다):\n${t}` : "";
}

function triageSystem(settings) {
  return `${TRIAGE_SYSTEM}\n\n${keywordReference(settings)}${typeof learnedSection === "function" ? learnedSection("triage") : ""}${customInstructions(settings)}`;
}

function keywordReference(settings) {
  return `참고 키워드 (커뮤니티 은어 포함, 이 말이 없어도 부정 이슈일 수 있음):\n${settings.keywords || ""}`;
}

const TRIAGE_SYSTEM = `너는 현대자동차·제네시스 고객 커뮤니티 모니터링 담당자다.
게시물 제목 목록을 보고, 현대차·제네시스 차량의 부정 이슈일 가능성이 있는 글을 고른다.

${ISSUE_DEFINITION}

규칙:
- 놓치면 안 되므로 조금이라도 가능성이 있으면 고른다(재현율 우선). 본문은 다음 단계에서 다시 확인한다.
- 안전사고 경고성 글(사고는 안 났지만 차량 때문에 위험했다·사고 날 뻔했다·조심하라는 글)은 반드시 고른다. 단순 교통사고·블랙박스 영상처럼 차량 결함과 무관한 사고 이야기만 제외.
- 제외: 문제 언급 없는 출고·시승 후기, 칭찬, 튜닝·용품·세차 이야기, 매매·시세, 결함 언급 없는 사고·블랙박스, 보험, 공지·이벤트·가입인사, 현대차·제네시스와 무관한 타 브랜드만의 이야기.
- 제외: 단순 사용 방법 문의(OTA·소프트웨어 업데이트 하는 법, 기능·설정·앱 사용법, 버튼 위치 등). 단, 불편함·번거로움·어려움·안 됨을 토로하면 고른다.
- 제외: 출석 도장·출근 도장·퇴근 도장·출석 체크 글 (여기서 '도장'은 도색이 아님).
- 제외: 신차 출고 대기·출고 기다림 같은 기대·설렘 글(불만 없는 출고 대기 이야기), 신차 검수·PPF·썬팅·광택 등 업체의 홍보·광고 글, 정기 소모품 교환만 다룬 글.
- 2020년 이전에 출시된 세대의 차(코드표 적용 시기 시작이 2020년 전, 예: LX2, TM, IG, AD, OS, FE, DH, HI 등)는 차량 화재, 급발진, 주행 중 시동 꺼짐, 사망사고, 돌진처럼 매우 심각한 이슈만 고른다. 노후화로 인한 고장·불량은 고르지 않는다.
- 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등)의 단순 뉴스·기사 공유, 해외 이슈 공유(해외 리콜·해외 시장·해외 소비자 소식 등)는 제외한다. 다만 국내 차주의 실제 피해 사례를 옮겨 온 글은 고른다.
- 네이버 카페는 대부분 현대차·제네시스 차주 카페다. 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등)는 현대차·제네시스 관련이 드러나거나, 차종이 안 보여도 결함·AS·부품 이슈로 보이면 고른다.
- 결과는 고른 글의 번호(id)만 돌려준다.`;

function classifySystem(settings) {
  const highlights = (settings.highlights || [])
    .filter((h) => h.car || h.topic)
    .map((h, i) => `${i + 1}. 차종 ${h.car || "(전체)"}: ${h.topic}`)
    .join("\n");
  return `너는 현대자동차·제네시스 고객 커뮤니티 모니터링 담당자다.
게시물(제목+본문)을 읽고 일일 부정 이슈 보고서에 넣을지 판정하고, 넣을 글은 구분·차종 코드·주요 내용을 정한다.

${ISSUE_DEFINITION}

판정(relevant):
- 현대차·제네시스 차량의 위 3가지 부정 이슈면 true. 아니면 false.
- false 예: 문제 언급 없는 출고 후기·칭찬, 튜닝·용품, 매매, 결함과 무관한 사고, 타 브랜드만의 이야기, 내용이 없는 글.
- 무상수리·리콜 정보 공유/문의, 업데이트 관련 의견, 정비 후기는 true (지난 보고서에 포함돼 왔음).
- 안전사고 경고성 글은 true, 구분 "품질": 실제 사고는 나지 않았어도 차량의 증상·작동 때문에 위험했다·사고 날 뻔했다·아찔했다·다들 조심하라는 경고 글.
  주요 내용은 무엇이 위험했는지로 쓴다 (예: "주행 중 차량 밀림으로 사고 위험 경고", "전동 테일게이트 끼임 위험 경고"). 보고 필요(심각) 여부는 내용대로 따로 판단한다.
  (담당자 지정 2026-10-22: gamewinds/4299497 같은 글은 RAW data 에 꼭 남도록 수집)
- 2020년 이후 출시 차량 위주로 본다. 2020년 이전에 출시된 세대(코드표 적용 시기 시작이 2020년 전, 예: LX2, TM, IG, AD, OS, OS EV, FE, DH, HI 등)는 차량 화재, 급발진, 주행 중 시동 꺼짐, 사망사고, 돌진처럼 매우 심각한 이슈만 true, 그 밖의 고장·불량(특히 노후화·주행거리·연식 때문인 고장)은 false.
- 단순 사용 방법 문의(OTA·소프트웨어 업데이트 하는 법, 기능·설정·앱 사용법 질문 등)는 false. 단, 업데이트·기능 사용이 불편하다·번거롭다·어렵다·안 된다·오류가 난다는 토로가 있으면 true.
- 출석 도장·출근 도장·퇴근 도장·출석 체크 글은 무조건 false ('도장'이 도색이 아님).
- 불만 없는 신차 출고 대기·출고 기다림 글, 업체의 신차 검수·PPF·썬팅·광택 홍보·광고 글, 문제 없는 정기 소모품 교환(엔진오일 등) 후기는 false. 단, 차주가 신차 검수 중 직접 발견한 불량, 출고 지연 불만은 true.
- 충전 중단·충전 불가 이슈는 충전기(충전소) 불량인 경우가 많다. 본문·댓글에 여러 충전기·충전소에서 해도 같은 증상, 서비스센터에서 차량 문제(ICCU·충전 포트·OBC 등)로 확인 같은 차량 문제 근거가 있을 때만 true. 특정 충전기에서만 안 되거나 원인이 불분명하면 false.
- 단순 펑크·못 박힘·타이어 손상 때문에 공기압 경고등(TPMS)이 켜진 글은 false (센서 고장·오작동은 true).
- 중고차를 사서 생긴 소소한 품질 불량(노후·사용 흔적·소모품·이전 차주 관리 문제 등)은 가급적 false. 단, 화재·시동 꺼짐 같은 심각한 결함이나 무상수리·리콜 대상 결함은 true.
- 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등) 글 중 단순 뉴스·기사 공유, 해외 이슈 공유(해외 리콜·해외 시장·해외 소비자 소식 등)는 false. 국내 차주의 실제 경험·피해 사례(퍼온 글 포함)는 true.

구분(category): "품질", "응대", "결품" 중 하나.
- 결품으로 인한 정비 지연(부품이 없어 수리를 못 하고 기다리는 불만)은 고장이 계기라도 결품에 무게가 실리므로 결품. (예: ICCU 고장으로 입고했는데 부품 결품으로 정비 지연 → 결품)
- 그 밖에 여러 개에 해당하면 품질 > 응대 순서로 고른다.

차종 코드(car_code): 아래 코드표의 코드를 쓴다.
- 파생은 코드 뒤에 붙인다: 부분변경(페이스리프트, '더 뉴', '페리') → " PE", 전기차 → " EV", 고성능 N → " N". 하이브리드(HEV)는 표기하지 않는다 (GN7 PE HEV → GN7 PE). 예: GN7 PE, NE PE, JK EV, RG3 EV, AX EV, US4 EV, CN7 N
- 글에 "23년식", "24년형", "2022년 출고" 같은 연식이 나오면 코드표의 적용 시기로 세대를 정한다 (예: 21년식 팰리세이드 → LX2, 25년식 팰리세이드 → LX3, 20년식 아반떼 → AD PE 또는 CN7 중 글 내용으로). '계열'이라는 말은 빼고 코드만 쓴다.
- GV60 마그마(Magma) 글은 차종 코드 JW (주요 내용 끝의 "(마그마)" 표기는 프로그램이 붙인다).
- 출고 지연·출고 대기 불만, 신차 출고 직후 발견한 불량처럼 신차 관련 이슈는 현재 판매 중인 최신 코드로 적는다. 예: 아이오닉6 출고 지연 → CE PE (CE 아님), 코드표에서 '현재'까지인 세대·부분변경을 고른다.
- 현대모터클럽과 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등) 글은 차종이 글에서 분명히 드러나지 않으면 relevant=false (추측 금지).
- '차종 필수: 예' 표시가 붙은 글(예: 전기차 동호회 자유게시판)은 카페 기본 차종으로 추측하지 않는다. 제목·본문·댓글·닉네임에 근거가 없으면 car_code "-", car_uncertain=true 로 둔다 (프로그램이 작성자의 다른 글을 확인하고, 그래도 모르면 뺀다).
- 본문에 차종·세대가 없으면 댓글에서 유추한다. [작성자] 표시가 붙은 작성자 본인 댓글(예: "저는 24년식 더 뉴예요")을 가장 믿고, 다른 사람 댓글은 "같은 차종 같은데요" 처럼 이 글의 차를 가리킬 때만 참고한다. 다른 사람이 자기 차 이야기를 한 것은 이 글의 차종으로 쓰지 않는다.
- harsh: 글·댓글에 심한 욕설이나 회사·제품에 대한 강한 비판·분노가 있으면 true.
- safety: 시트 오작동·차량 밀림·급가속·끼임 등 차량 때문에 사고가 날 뻔했거나 다칠 수 있다는 안전사고 우려·경고 글이면 true (결과 화면에 연보라색으로 표시), 아니면 false.
- model_year: 글·댓글에 차량 연식이 드러나면 "24년식" 처럼 적는다 (연식 표현이 없고 출고 시기만 있으면 "24년 출고"). 모르면 빈 문자열.
- car_uncertain: 차종을 모르거나("-") PE(부분변경) 여부·세대 구분이 글만으로 분명하지 않으면 true (프로그램이 작성자의 다른 글을 확인해 다시 묻는다), 분명하면 false.
- 차종 코드는 가장 주의해서 정확하게 정한다. 근거 순서: 제목·본문·댓글에 적힌 차명/코드 > 게시판 이름(예: 'ST1 게시판', '스타리아EV 게시판') > 사진 설명·트림·용도(카고·냉동탑차 등) > 작성자 닉네임 > 카페 기본 차종.
- 카페 기본 차종이 여러 개(/로 구분, 예: "US4 EV / ST1")면 그 카페에 여러 차종이 섞여 있다는 뜻이다. 근거 없이 앞쪽 것을 고르지 말고, 근거가 없으면 가장 가능성 높은 것을 쓰되 car_uncertain=true 로 한다.
- ST1(스타리아 기반 상용 전기 밴·카고·냉동탑차)과 US4 EV(스타리아 전기 승합)는 서로 다른 차다. 'ST1', '에스티원', 카고·탑차·적재함 이야기면 ST1.
- 제목·본문의 세대 표시를 꼭 본다: "[디올뉴]", "디 올 뉴", "올뉴" = 새 세대(풀체인지), "[더뉴]", "더 뉴" = 부분변경(PE). 예) 넥쏘 카페 「[디올뉴] …」 → NH2 (FE 아님). (담당자 수정 2026-10-21: "-" 로 두지 말 것)
- 투싼 주의: 4세대(NX4, 2020년 출시)도 '디 올 뉴 투싼'이었고, 5세대(NX5)도 '디 올 뉴 투싼'이다 (2026-10-27 출고 시작, 집중 모니터링 신차). '디올뉴'만 보고 정하지 말고 출고 시기·연식으로 정한다: 최근(2026-10-27 이후) 출고·신차 출고 직후 이야기, 신형·풀체인지·5세대 → NX5. 21~23년식 → NX4, 23~26년식 '더 뉴 투싼' → NX4 PE. (담당자 지정 2026-10-28)
- 글에 차종·세대·연식이 드러나면 그것을 따른다. 안 드러나면 '카페 기본 차종' 중에서 고른다. 그래도 모르면 "-".

용어 통일 (주요 내용에 반드시 이 표현을 쓴다):
${settings.terms || ""}

주요 내용(summary): 보고서에 들어갈 짧은 한국어 명사구(보통 6~20자, 복합 사안만 길게). 존칭·문장부호 없이, 아래 지난 보고서의 표준 표현을 최대한 그대로 쓴다.
- 품질 예: "도장 불량", "시트 불량", "배터리 방전", "엔진 경고등 점등", "카메라 화면 표시 오류", "하이브리드 시스템 점검 메시지 표시", "전기차 시스템 점검 메시지 표시", "하부 소음", "각종 불량", "계기반 화면 표시 불가", "주행 중 소음", "무상 수리 정보 공유", "각종 경고등 점등", "브레이크 소음", "스티어링 휠 소음", "가속 불가", "시트 작동 오류", "AVN 화면 표시 오류", "주행 중 우측 쏠림", "공조기 소음", "엔진 부조", "에어컨 작동 불량", "빌트인캠 작동 오류", "오일 누유", "도어 개폐 오류", "완속 충전 불가", "냉각수 누수", "시동 불가", "고주파음 발생", "업데이트 관련 의견", "무상 수리 정보 문의"
- 응대 예: "블루핸즈 정비 후기", "하이테크 센터 정비 후기", "BMS 업데이트 후기", "출고 지연", "무상 수리 후기", "카마스터 응대 후기", "파업으로 인한 정비 지연 불만", "선루프 누수, 하이테크 센터 응대 불만"
- 결품 예: "고전압 배터리 결품 지연", "ICCU 부품 결품", "빌트인캠 결품 지연", "헤드램프 부품 결품으로 정비 지연", "범퍼 결품 지연"
- 본인 이야기가 아니라 다른 게시물·커뮤니티 글을 퍼온 글('펌', '퍼옴', '출처: …' 등)은 끝에 "관련 내용 공유"를 붙인다. 예: "주행 중 시동 꺼짐 관련 내용 공유", "ICCU 고장 후 결품으로 정비 지연 관련 내용 공유"
- 주요 내용의 부위는 글에 나온 실제 부위로 쓴다. '전동', '끼임', '멈춤' 같은 말만 보고 다른 부위(예: 전동 시트)로 바꿔 쓰지 않는다. (전동 테일게이트 작동 불량 ≠ 전동 시트 끼임)
- 문의 글은 끝에 "문의", 후기는 "후기", 재발은 "재발생"을 붙인다. 예: "전기차 시스템 점검 메시지 점등 문의", "시트 불량 정비 후기"
- 불만·피해를 토로하는 글은 증상만 적고 끝내지 말고 "… 발생 불만", "… 발견 불만" 처럼 끝을 "불만"으로 맺는다. 예: "테일게이트 부식" → "테일게이트 부식 발생 불만", "신차 도장 불량 발견" → "신차 도장 불량 발견 불만", "헤드램프 결품으로 정비 지연" → "헤드램프 결품으로 정비 지연 불만". (문의·후기·공유 글은 위 규칙대로 "문의"·"후기"·"관련 내용 공유")

노란색 표시(highlight): 아래 집중 관리 항목에 해당하면 true, 아니면 false. 차종은 PE 포함 같은 계열이면 해당 (예: JX 항목은 JX PE 도 포함).
- 부위를 정확히 구분한다. 전동 시트 항목(노란색)은 글에 시트·좌석(1열/2열/3열 시트, 릴렉션 시트 등)이 분명히 나올 때만 해당한다.
  전동 테일게이트(파워 테일게이트)·트렁크·슬라이딩/전동 도어·선루프·윈도의 작동 불량이나 끼임(끼임 방지 미작동 포함)을 전동 시트 끼임으로 바꿔 판단·작성하지 않는다.
  이런 글도 부정 이슈이므로 빼지 않고 그대로 수집(relevant=true)하되, 실제 부위·이슈로 구분·주요 내용을 쓰고 highlight 는 false 로 둔다.
  작동 불량으로 실제 끼임 사고·부상·파손이 났다면 심각한 품질 이슈로 본다.
  예) 아이오닉9(ME1) "전동 테일게이트가 닫히다 멈추거나 끼임 방지가 안 됨" → 수집, 주요 내용 "전동 테일게이트 작동 불량" (전동 시트 끼임 아님)
  예) "전동 테일게이트에 아이 손이 끼어 다침" → 수집, 주요 내용 "전동 테일게이트 끼임 사고 발생 불만"
- 대형 SUV(아이오닉9 ME1, 싼타페 MX5·TM, 팰리세이드 LX3·LX2, GV80 JX·JX PE, 출시 예정 GV90 등 테일게이트가 큰 차)는 테일게이트가 열리면서 벽·천장·기둥·주차장 구조물에 닿아 까지거나 찍히는 일이 잦고, 본인 부주의인 경우가 많다. 반드시 원인을 판별한다.
  · 본인 부주의(낮은 천장·벽 앞에서 직접 열었음, 열림 높이 설정을 안 했음, 주변 확인을 안 했음 등)로 닿거나 까진 글 → relevant=false (수집하지 않음)
  · 차량 문제가 의심되는 글 → 수집: 스스로 열림, 설정한 열림 높이 무시, 장애물·끼임 감지(끼임 방지) 미작동, 멈춤 버튼·스위치 무반응, 열림/닫힘 중 멈춤·오작동 등
  · 원인이 분명하지 않으면 본문·댓글에서 작성자가 차량 결함을 주장하는지로 판단하고, 단순 하소연·자책이면 넣지 않는다.
  예) "지하주차장 천장에 테일게이트가 닿아 까졌어요, 높이 설정을 깜빡했네요" → 제외
  예) "열림 높이를 낮게 설정했는데 끝까지 열려 벽에 찍힘" → 수집, 주요 내용 "전동 테일게이트 열림 높이 설정 미작동으로 파손 발생 불만"
${highlights || "(없음)"}

${keywordReference(settings)}

차종 코드표:
${settings.carCodes}${typeof learnedSection === "function" ? learnedSection("classify") : ""}${customInstructions(settings)}`;
}

const TRIAGE_SCHEMA = {
  type: "object",
  properties: { ids: { type: "array", items: { type: "string" } } },
  required: ["ids"],
  additionalProperties: false,
};

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          category: { type: "string", enum: ["품질", "응대", "결품"] },
          car_code: { type: "string" },
          summary: { type: "string" },
          highlight: { type: "boolean" },
          car_uncertain: { type: "boolean" },
          model_year: { type: "string" },
          harsh: { type: "boolean" },
          safety: { type: "boolean" },
        },
        required: ["id", "relevant", "category", "car_code", "summary", "highlight", "car_uncertain", "model_year", "harsh", "safety"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const REPORT_SCHEMA = TRIAGE_SCHEMA;

function reportSystem(priorityCars, settings) {
  return `너는 현대자동차·제네시스 고객 커뮤니티 모니터링 담당자다.
오늘 수집된 네이버 카페 부정 이슈 목록에서, 경영진에게 꼭 보고해야 할 심각한 이슈를 고른다.

규칙:
- 보통 4~6개를 고른다. 정말 심각한 것이 그보다 적으면 적게 고른다. 7개 이상은 고르지 않는다.
- 우선순위 1: 신규 출시 차종(${priorityCars || "(없음)"})의 심각한 결함·안전 이슈.
- 심각함의 기준: 주행 중 시동 꺼짐·출력 제한·가속 불가, 제동·조향 이상, 화재·연기·과열, 고전압 배터리·ICCU·연료전지 이상, 누수(실내 유입), 주행 중 도어 열림, 에어백·안전벨트 등 안전 관련, 여러 차주가 같은 증상을 호소하는 경우, 반복 수리에도 해결 안 됨, 장기 정비 지연(결품 등)으로 큰 불편.
- 같은 정도로 심각하면 다음을 더 우선한다: 심한 욕설·강한 비판이 담긴 글([강한 비판] 표시), 조회수·댓글 수가 많은 글(반응이 큰 글).
- 고르지 않는 것: 단순 정보 공유(무상 수리 정보 공유, 업데이트 내용 공유, 뉴스 공유 등), 단순 문의, 가벼운 소음·마감 불만, 개인 의견. 신차라도 단순 정보 공유면 고르지 않는다.
- 고르지 않는 것: 운전자 보조 시스템(ADAS) 점검·전방 안전 시스템 점검 메시지, 여러 경고등이 한 번에 잠깐 켜졌다 꺼진 일시적 점등 같은 글.
- 전동 테일게이트·전동 도어 등의 작동 불량으로 실제 끼임 사고·부상이 난 글은 전동 시트 이슈가 아니어도 심각한 품질 이슈이므로 우선 후보로 본다. 단, 본인 부주의로 벽·천장에 닿은 사고는 고르지 않는다.
- 결과는 고른 글의 번호(id)만 돌려준다.${typeof learnedSection === "function" ? learnedSection("report") : ""}${customInstructions(settings)}`;
}

class AiClassifier {
  constructor(settings, log) {
    this.settings = settings;
    this.log = log;
    this.model = MODELS.find((m) => m.id === settings.model) || MODELS[0];
    this.client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }

  costUsd() {
    const [inP, outP] = this.model.price;
    const u = this.usage;
    return (u.input * inP + u.cacheWrite * inP * 1.25 + u.cacheRead * inP * 0.1 + u.output * outP) / 1e6;
  }

  async callJson(system, user, schema) {
    const params = {
      model: this.model.id,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    };
    let res;
    if (this.model.fallbacks) {
      res = await this.client.beta.messages.create({
        ...params,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } else {
      res = await this.client.messages.create(params);
    }
    const u = res.usage || {};
    this.usage.input += u.input_tokens || 0;
    this.usage.output += u.output_tokens || 0;
    this.usage.cacheRead += u.cache_read_input_tokens || 0;
    this.usage.cacheWrite += u.cache_creation_input_tokens || 0;
    if (res.stop_reason === "refusal") throw new Error("AI 가 이 묶음 처리를 거절했습니다");
    if (res.stop_reason === "max_tokens") throw new Error("AI 응답이 길이 제한에 걸렸습니다");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return JSON.parse(text);
  }

  // 보고 필요: rows 중 심각한 4~6개 → 고른 행 번호(0부터) Set
  async selectReports(rows, priorityCars) {
    if (!rows.length) return new Set();
    const lines = rows
      .map((r, i) => `${i + 1}\t[${r.community}] 차종 ${r.car} | ${r.category} | ${r.summary}${r.harsh ? " | [강한 비판]" : ""}${r.views != null ? ` | 조회 ${r.views}` : ""}${r.ccount != null ? ` | 댓글 ${r.ccount}` : ""} | 제목: ${r.title || ""} | 본문: ${(r.excerpt || "").replace(/\s+/g, " ").slice(0, 200)}`)
      .join("\n");
    const out = await this.callJson(reportSystem(priorityCars, this.settings), `id\t내용\n${lines}`, REPORT_SCHEMA);
    const picked = new Set();
    for (const id of out.ids || []) {
      const n = +String(id).replace(/\D/g, "") - 1;
      if (n >= 0 && n < rows.length && picked.size < 6) picked.add(n);
    }
    return picked;
  }

  // 차종이 애매한 글: 작성자 닉네임·작성자의 다른 글 제목으로 차종 코드(PE 여부 등)를 다시 정한다
  // items: [{key, title, carNow, carHint, nick, authorTitles}] → Map(key → car_code)
  async refineCars(items) {
    const out = new Map();
    if (!items.length) return out;
    const system = `너는 현대자동차·제네시스 차종 코드 담당자다. 각 글의 차종 코드를, 작성자 닉네임과 작성자가 이 카페에 쓴 다른 글 제목들로 유추해 가장 정확하게 정한다.
- 닉네임, 다른 글 제목, 이 글의 댓글(특히 [작성자] 본인 댓글)에 '더 뉴', '페리', 'PE', 연식(예: 24년식), 트림, 출고 시기가 보이면 그것으로 PE 여부·세대를 정한다.
- 이 글 제목의 세대 표시([디올뉴] 등)와 작성자의 출고인증·계약인증 글(제목·내용)은 차종·세대의 가장 확실한 근거다. 예) 넥쏘 카페에서 출고인증 글이 디 올 뉴 넥쏘면 NH2. (담당자 수정 2026-10-21)
- 반드시 작성자의 다른 글을 끝까지 보고 차종을 채운다. 줄임말도 차명이다: "아5·아오5·아이오5·ioniq5" = 아이오닉5, "아6" = 아이오닉6, "아9" = 아이오닉9, "팰리" = 팰리세이드, "싼페" = 싼타페 등.
  여러 차종이 섞인 카페(예: 아이오닉 멤버스 NE / NE PE / CE / ME1)에서 작성자의 다른 글에 한 차만 나오면 그 차로 정한다. "-" 로 두지 않는다. (담당자 지적 2026-10-22: cafeclip/1323002 작성자 이전 글로 아이오닉5(NE)가 분명한데 "-")
- 지금 추정이 "-"(차종 모름)인 글은 작성자의 다른 글 제목·내용·댓글에 나온 차명(예: "아이오닉5 충전 문의", "EV6 타이어 교체")으로 이 작성자의 차를 찾아 코드표의 코드로 정한다. 같은 차명이 여러 번 나오거나 한 대만 언급되면 그 차로 본다.
- 작성자의 다른 글로 보아 이 사람의 차가 현대차·제네시스가 아닌 타사 차(기아 EV6·EV9·EV3·니로·쏘렌토, 테슬라, BYD, 수입차 등)이고 이 글도 그 차 이야기로 보이면 other_brand=true, car_code 에는 그 차 이름(예: "기아 EV6")을 적는다. 현대차·제네시스 차도 함께 있어 어느 차인지 모르면 other_brand=false.
- 근거가 없으면 지금 추정 코드를 그대로 둔다. 단, '차종 필수: 예' 글은 근거가 없으면 "-" 로 둔다 (카페 기본 차종으로 추측 금지). 하이브리드(HEV)는 표기하지 않는다.

차종 코드표:
${this.settings.carCodes}${customInstructions(this.settings)}`;
    const text = items
      .map((it, j) => `<post id="${j + 1}">\n지금 추정: ${it.carNow}\n카페 기본 차종: ${it.carHint || "(없음)"}${it.needCar ? "\n차종 필수: 예" : ""}\n작성자 닉네임: ${it.nick || "(모름)"}\n이 글 제목: ${it.title}\n작성자의 다른 글 제목:\n${(it.authorTitles || []).map((t) => `- ${t}`).join("\n") || "(없음)"}${(it.authorTexts || []).length ? `\n작성자의 다른 글 내용(일부):\n${it.authorTexts.map((t) => `[${t.title}]\n${t.body}${t.comments ? `\n댓글: ${t.comments}` : ""}`).join("\n---\n")}` : ""}${it.comments ? `\n이 글의 댓글(일부, [작성자]=글쓴이 본인):\n${it.comments}` : ""}\n</post>`)
      .join("\n\n");
    const schema = {
      type: "object",
      properties: { results: { type: "array", items: { type: "object", properties: { id: { type: "string" }, car_code: { type: "string" }, other_brand: { type: "boolean" } }, required: ["id", "car_code", "other_brand"], additionalProperties: false } } },
      required: ["results"],
      additionalProperties: false,
    };
    const res = await this.callJson(system, text, schema);
    for (const r of res.results || []) {
      const it = items[+String(r.id).replace(/\D/g, "") - 1];
      if (it && (r.car_code || r.other_brand)) out.set(it.key, { car_code: r.car_code, other_brand: !!r.other_brand });
    }
    return out;
  }

  // 간단한 요청으로 키·모델이 되는지 확인
  async ping() {
    await this.client.messages.create({
      model: this.model.id,
      max_tokens: 64,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "OK 라고만 답해" }],
    });
  }

  // posts: [{key, source, title}] → 고른 key 의 Set
  async triage(posts) {
    const picked = new Set();
    for (let i = 0; i < posts.length; i += TRIAGE_BATCH) {
      const batch = posts.slice(i, i + TRIAGE_BATCH);
      const lines = batch.map((p, j) => `${j + 1}\t[${p.source}] ${p.title}`).join("\n");
      try {
        const out = await this.callJson(triageSystem(this.settings), `id\t[출처] 제목\n${lines}`, TRIAGE_SCHEMA);
        for (const id of out.ids || []) {
          const p = batch[+String(id).replace(/\D/g, "") - 1];
          if (p) picked.add(p.key);
        }
      } catch (e) {
        // 실패한 묶음은 키워드로 대신 고른다
        this.log(`AI 제목 선별 실패(${e.message}) → 이 묶음은 키워드로 선별`, "err");
        for (const p of batch) if (keywordHits(p.title).length) picked.add(p.key);
      }
    }
    return picked;
  }

  // items: [{key, source, carHint, title, body}] → Map(key → {relevant, category, car_code, summary, highlight})
  async classify(items) {
    const out = new Map();
    const system = classifySystem(this.settings);
    for (let i = 0; i < items.length; i += CLASSIFY_BATCH) {
      const batch = items.slice(i, i + CLASSIFY_BATCH);
      const text = batch
        .map((it, j) => {
          const body = it.body.length > BODY_CHARS ? `${it.body.slice(0, BODY_CHARS)}\n(이하 생략)` : it.body;
          return `<post id="${j + 1}">\n출처: ${it.source}\n카페 기본 차종: ${it.carHint || "(없음)"}${it.menu ? `\n게시판: ${it.menu}` : ""}${it.needCar ? "\n차종 필수: 예" : ""}\n제목: ${it.title}\n본문:\n${body || "(본문 없음)"}${it.comments ? `\n댓글(일부):\n${it.comments}` : ""}\n</post>`;
        })
        .join("\n\n");
      const result = await this.callJson(system, text, CLASSIFY_SCHEMA);
      for (const r of result.results || []) {
        const it = batch[+String(r.id).replace(/\D/g, "") - 1];
        if (it) out.set(it.key, r);
      }
    }
    return out;
  }
}
