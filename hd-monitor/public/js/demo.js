// 예시 데이터 (주소에 ?demo) — Firebase 없이 화면·모션 확인용. 실제 분류 코드(shared)를 그대로 사용
import { DEFAULT_SETTINGS } from "./shared/defaults.js";
import { buildContext, classify } from "./shared/classify.js";

const TITLES = {
  news: [
    "현대차 아이오닉5 ICCU 결함 무상수리 확대…12만대 대상", "[단독] 현대차 아이오닉5 ICCU 결함 무상수리 확대 12만대", "팰리세이드 2열 전동시트 끼임 사고…국토부 조사 착수",
    "현대차 3분기 영업이익 3조원대 회복", "고속도로 터널서 승용차 화재…운전자 대피", "제네시스 GV80 2열 컨트롤러 진동 불만 잇따라",
    "현대차, 신형 넥쏘 사전계약 1만대 돌파", "싼타페 하이브리드 누수 리콜 결정", "정의선 회장 美 조지아 공장 방문", "그랜저 페이스리프트 유출 사진 공개",
    "급발진 의심 사고 차량 블랙박스 공개…제조사 '결함 없다'", "현대차 블루멤버스 포인트 개편 논란",
  ],
  cafe: [
    "팰리세이드 3열 폴딩하다 손 끼일 뻔했어요", "아이오닉5 ICCU 경고등 떴습니다 ㅠㅠ", "그랜저 GN7 엔진오일 감소 저만 그런가요", "싼타페 MX5 하이브리드 출고 후기",
    "코나 EV 충전 중 경고등", "캐스퍼 일렉트릭 겨울 주행거리 실측", "GV70 블루핸즈 예약 너무 어렵네요", "스타리아 슬라이딩 도어 잡소리 해결 방법",
  ],
  blog: ["팰리세이드 LX3 3개월 실사용 후기", "아반떼 CN8 풀체인지 예상도 정리", "넥쏘 수소충전소 고장 또… 답답", "현대차 블루포인트 사용처 총정리"],
  youtube: ["팰리세이드 전동시트 끼임 실험해봤습니다", "현대차가 숨기고 싶은 ICCU 결함의 진실", "신형 그랜저 실내 최초 공개!", "아이오닉9 겨울 장거리 테스트", "오늘의 브이로그 | 공장 견학"],
  bobae: ["싼타페 급발진 의심 사고 블랙박스", "역시 흉기차 ㅉㅉ", "현대차 서비스센터 대응 최악이네요", "그랜저 누수로 3번째 입고"],
  clien: ["아이오닉6 긴급제동 오작동 경험담", "현대차 신차 일정 정리 (2027)", "코나 일렉트릭 화재 기사 보셨나요"],
  ppomppu: ["팰리세이드 하이브리드 계약했습니다 만족", "투싼 NX4 엔진 떨림 무상수리 대상인가요", "현대몰 포인트 이벤트 공유"],
};
const SOURCES = {
  news: ["연합뉴스", "한국경제", "매일경제", "모터그래프", "뉴시스", "조선비즈", "오토헤럴드"],
  cafe: [["LX3 클럽", "gamewinds"], ["팰리세이드 오너스 클럽", "tobloomer"], ["아이오닉 멤버스", "cafeclip"], ["그랜저GN7오너스", "allfm03"], ["자동차 동호회", "carclub"], ["싼타페MX5클럽", "choids"]],
  blog: ["카라이프", "드라이브로그", "모터리뷰"],
  youtube: [["인싸 케이", "UCjYS1a6ENGSfUfxEJpVCOtQ"], ["모트라인", "UCMTZqwCdw9Nynw9BkCgfeRQ"], ["한문철TV", "UCH5U89kvHrVxxS80xpoOydw"], ["오토카", "UCother"]],
  bobae: ["보배드림 국산차"], clien: ["클리앙 자동차당"], ppomppu: ["뽐뿌 자동차포럼"],
};
const WEIGHT = { news: 30, cafe: 26, blog: 14, youtube: 9, bobae: 9, clien: 6, ppomppu: 6 };

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pickCh = () => {
  const tot = Object.values(WEIGHT).reduce((a, b) => a + b, 0);
  let r = rnd() * tot;
  for (const [k, w] of Object.entries(WEIGHT)) { r -= w; if (r <= 0) return k; }
  return "news";
};

const settings = structuredClone(DEFAULT_SETTINGS);
settings.siteUrl = location.origin;
settings.kakaoClientId = "demo";
const ctx = buildContext(settings);
const posts = [];
let n = 0;

function makePost(t) {
  const ch = pickCh();
  const title = pick(TITLES[ch]);
  const src = pick(SOURCES[ch]);
  const [source, sourceId] = Array.isArray(src) ? src : [src, ""];
  const item = { channel: ch, title, desc: `${title} — 관련 내용 요약 미리보기 문장입니다. 실제 화면에서는 검색 결과의 요약이 나옵니다.`, source, sourceId };
  const cls = classify(item, ctx) || classify({ ...item, title: `현대차 ${title}` }, ctx);
  const id = `d${++n}`;
  const url = ch === "youtube" ? `https://www.youtube.com/watch?v=demo${n}` : ch === "cafe" ? `https://cafe.naver.com/${sourceId}/${1000 + n}` : `https://example.com/${ch}/${n}`;
  const alerted = !!(cls.alert && rnd() < 0.35);
  return { id, ...item, url, site: ch === "news" ? pick(["yna.co.kr", "hankyung.com", "mk.co.kr", "motorgraph.com", "newsis.com", "chosun.com"]) : null, alerted, alertedAt: alerted ? t : null, alertedTo: alerted ? ["관리자", "김담당"] : [], ...cls, time: t, collectedAt: t, postedAt: t, dupOf: null, dupCount: ch === "news" && rnd() < 0.2 ? Math.ceil(rnd() * 6) : 0, memo: "", star: rnd() < 0.05, hidden: false,
    thumb: ch === "youtube" ? null : null };
}

const now = Date.now();
for (let i = 0; i < 900; i++) {
  const ageH = Math.pow(rnd(), 1.6) * 24 * 14;
  const d = new Date(now - ageH * 3600e3);
  if (d.getHours() < 6 && rnd() < 0.6) continue;
  posts.push(makePost(d));
}
posts.sort((a, b) => b.time - a.time);

const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function stats() {
  const by = {};
  for (const p of posts) {
    const k = dk(p.collectedAt);
    const s = (by[k] ||= { day: k, total: 0, issue: 0, garbage: 0, ch: {}, cat: {}, sent: {}, hour: {}, kw: {}, grp: {}, favCafe: {}, favYt: {}, chIssue: {}, sentIssue: {} });
    const inc = (o, key) => { o[key] = (o[key] || 0) + 1; };
    s.total++; inc(s.ch, p.channel); inc(s.sent, p.sentiment); inc(s.hour, String(p.collectedAt.getHours()).padStart(2, "0"));
    for (const c of p.cats) inc(s.cat, c);
    if (p.isIssue || p.must) { s.issue++; inc(s.chIssue, p.channel); inc(s.sentIssue, p.sentiment); } else s.garbage++;
    for (const w of p.kw) inc(s.kw, w);
    for (const g of p.kwGroups) inc(s.grp, g);
    if (p.fav && p.channel === "cafe") inc(s.favCafe, p.sourceId);
    if (p.fav && p.channel === "youtube") inc(s.favYt, p.sourceId);
  }
  return by;
}

const live = { items: [], at: new Date() };
const liveSubs = new Set();
const toLive = (p) => ({ id: p.id, title: p.title, channel: p.channel, source: p.source, url: p.url, time: p.time, sentiment: p.sentiment, isIssue: p.isIssue || p.must, kw: p.kw.slice(0, 3) });
live.items = posts.slice(0, 30).map(toLive);
setInterval(() => {
  const p = makePost(new Date());
  posts.unshift(p);
  live.items = [toLive(p), ...live.items].slice(0, 40);
  live.at = new Date();
  liveSubs.forEach((cb) => cb(live));
}, 7000);

const users = [
  { uid: "u1", name: "관리자", email: "admin@example.com", dept: "품질", role: "admin", status: "active", kakaoConnected: true, alertOn: true },
  { uid: "u2", name: "김담당", email: "kim@example.com", dept: "고객", role: "editor", status: "active", kakaoConnected: false, alertOn: false },
  { uid: "u3", name: "이신규", email: "lee@example.com", dept: "홍보", role: "viewer", status: "pending" },
];
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export function createDemoBackend() {
  let authCb = null;
  let signed = true;
  return {
    demo: true,
    onAuth: (cb) => { authCb = cb; setTimeout(() => cb(signed ? { uid: "u1", email: "admin@example.com" } : null), 50); return () => {}; },
    signIn: async () => { signed = true; authCb?.({ uid: "u1", email: "admin@example.com" }); },
    signUp: async () => { signed = true; authCb?.({ uid: "u1", email: "admin@example.com" }); },
    signOut: async () => { signed = false; authCb?.(null); },
    resetPw: async () => {},
    currentEmail: () => "admin@example.com",
    me: async () => ({ uid: "u1", ...users[0] }),
    getSettings: async () => settings,
    watchSettings: (cb) => { cb(settings); return () => {}; },
    saveSettings: async (patch) => { Object.assign(settings, patch); await delay(); },
    resetSettings: async (key) => { settings[key] = structuredClone(DEFAULT_SETTINGS[key]); },
    async listPosts({ cat = "all", from, to, sort = "time", pageSize = 200, cursor = null }) {
      await delay(350);
      let list = posts.filter((p) => p.cats.includes(cat) && (!from || p[sort] >= from) && (!to || p[sort] < to)).sort((a, b) => b[sort] - a[sort]);
      const start = cursor || 0;
      const items = list.slice(start, start + pageSize);
      return { items, cursor: start + pageSize, done: start + pageSize >= list.length };
    },
    updatePost: async (id, patch) => { Object.assign(posts.find((p) => p.id === id) || {}, patch); },
    watchLive: (cb) => { liveSubs.add(cb); cb(live); return () => liveSubs.delete(cb); },
    watchStatus: (cb) => { cb({ lastRun: { at: new Date(Date.now() - 90e3), ms: 21400, fetched: 812, created: 37, log: ["네이버: 검색 83회 (전체 405개 중 83개 차례), 받은 글 690건", "유튜브 관심 채널 48곳 확인, 새 영상 3건", "커뮤니티 게시판 7곳, 새 글 41건", "저장: 후보 455건 중 새 글 37건", "알림: 2건 (메시지 6통)"] }, queries: 135 }); return () => {}; },
    async getStats(fromDay, toDay) { await delay(300); return Object.values(stats()).filter((s) => s.day >= fromDay && s.day <= toDay); },
    getRuns: async () => [],
    async analyze(ids) {
      await delay(1500);
      const res = ids.map((id) => {
        const p = posts.find((x) => x.id === id);
        const s = /흉기차|ㅉㅉ/.test(p.title) ? "abuse" : /결함|누수|화재|끼|오작동|최악|사고|경고등|떨림/.test(p.title) ? "neg" : /만족|후기|공개|돌파|회복/.test(p.title) ? "pos" : "neu";
        Object.assign(p, { sentiment: s, sentimentBy: "gemini", sentimentReason: "예시 분석 결과" });
        return { id, sentiment: s, reason: "예시 분석 결과", by: "gemini" };
      });
      return { results: res, log: [] };
    },
    runNow: async () => { await delay(2000); return { created: 12, fetched: 300, ms: 18000, log: ["(예시) 수집 완료"] }; },
    reclassify: async () => { await delay(1500); return { scanned: posts.length, changed: 42, days: 3 }; },
    listUsers: async () => users,
    updateUser: async (uid, patch) => Object.assign(users.find((u) => u.uid === uid), patch),
    createUser: async (d) => { users.push({ uid: `u${users.length + 1}`, status: "active", ...d }); },
    deleteUser: async (uid) => users.splice(users.findIndex((u) => u.uid === uid), 1),
    updateMe: async (patch) => Object.assign(users[0], patch),
    secretsStatus: async () => ({ naverKeys: 2, youtubeKeys: 1, geminiKey: true, claudeKey: false, kakaoRestKey: true, kakaoSecret: true }),
    saveSecrets: async () => ({ naverKeys: 2, youtubeKeys: 1, geminiKey: true, claudeKey: true, kakaoRestKey: true, kakaoSecret: true }),
    kakaoConnect: async () => {},
    kakaoTest: async () => { await delay(600); },
    makeIngestToken: async () => ({ token: "demo0123456789abcdef0123456789abcdef01234567" }),
    kakaoUnlink: async () => { users[0].kakaoConnected = false; },
  };
}
