// 1회 작업: 품질 · 응대 · 결품 이슈 그룹 추가, 제외어 합치기 (다시 돌려도 같은 결과)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const J = (a) => [...new Set(a.map((s) => s.trim()).filter(Boolean))].join(" + ");
const QUALITY = J(`고장, 불량, 메시지, 무상 수리, 무상수리, 의심, 유격, 박리, 황변, 풍절음, 부조, 과열, 누출, 간헐적, 재발생, 미작동, 결함, 하자, 소음, 잡음, 이음, 떨림, 진동, 누수, 누유, 경고등, 점등, 오류, 에러, 먹통, 방전, 시동, 꺼짐, 부식, 녹슴, 녹이, 크랙, 균열, 깨짐, 파손, 단차, 도장, 들뜸, 변색, 냄새, 습기, 결로, 김서림, 작동 안, 작동안, 작동 불, 안됨, 안 됨, 불가, 멈춤, 리콜, 업데이트, 증상, 삐걱, 덜컹, 딸깍, 끼익, 찌그덕, 잡소리, 쏠림, 출력, ICCU, 충전 안, 충전안, 재부팅, 벌레소리, 안 움직, 안움직, 작동이 안, 안 켜, 안켜, 안 꺼, 안꺼, 멈춰, 유출, 광고 촬영, 광고촬영, 카탈로그, 렌더링, 화재, 불남, 불났, 불이 나, 불이 붙, 연기 나, 연기가, 전소, 폭발, 돌진, 사망, 부상, 에어백, 브레이크, 제동, 위험, 아찔, 사고 날 뻔, 사고날뻔, 사고 날뻔, 큰일 날 뻔, 큰일날뻔, 죽을 뻔, 죽을뻔, 조심하세요, 주의하세요, 조심하시길, 밀림, 밀려, 급가속, 급발진, 끼임, 미끄러`.split(","));
// 'AS' 단독은 영어 글의 was·has·gas 등에도 걸려서 한국어 표현과 묶음
const SERVICE = J(`블루핸즈, 블핸, 정비 후기, 정비후기, 출고 지연, 출고지연, 카마스터, 파업, 하이테크, 직영, 서비스센터, 서비스 센터, 사업소, 파란손, 멍든손, AS센터, AS 받, AS 맡, AS 기간, AS 문의, AS 요청, A/S, 보증, 정비, 수리, 입고, 응대, 불친절, 재입고, 재수리`.split(","));
const PARTS = J(`결품, 재고, 부품, 수급, 부품 대기, 부품대기, 지연, 대기중, 입고 대기`.split(","));
const EXCL = `출고 후기, 출고기, 시승기, 가입인사, 등업, 이벤트, 공지, 판매합니다, 삽니다, 나눔, 출고 대기, 출고대기, 출고 기다, 검수 업체, 검수업체, 검수 대행, 검수대행, 광고, 홍보, 오일교환, 오일 교환, 출석 도장, 출석도장, 출근 도장, 출근도장, 퇴근 도장, 퇴근도장, 출석체크, 출석 체크, 출첵, 출석부, 위장막, 스파이샷, 시험주행, 테스트카`.split(",");

const ref = db.doc("settings/main");
const groups = (await ref.get()).data().keywordGroups || [];
const add = [
  { id: "q_symptom", name: "품질", role: "issue", collect: false, issue: true, alert: false, requireTarget: true, rules: QUALITY },
  { id: "cs", name: "응대", role: "issue", collect: false, issue: true, alert: false, requireTarget: true, rules: SERVICE },
  { id: "parts", name: "결품", role: "issue", collect: false, issue: true, alert: false, requireTarget: true, rules: PARTS },
];
let out = groups.filter((g) => !add.some((a) => a.id === g.id));
const at = out.findIndex((g) => g.id === "compare");
out.splice(at < 0 ? out.length : at, 0, ...add);
out = out.map((g) => (g.role === "exclude" && g.id === "exclude" ? { ...g, rules: J([...String(g.rules).split(/[+,\n]/), ...EXCL]) } : g));
await ref.update({ keywordGroups: out });
const after = (await ref.get()).data().keywordGroups;
for (const g of after) console.log(g.id, g.name, g.role, "alert:" + g.alert, "규칙 수:", String(g.rules).split("+").length);
console.log("제외어:", after.find((g) => g.id === "exclude").rules);
