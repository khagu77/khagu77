// 여러 파일이 같이 쓰는 도구들

const timerWorker = (() => {
  try {
    if (typeof Worker === "undefined") return null;
    const w = new Worker("timer-worker.js");
    const waiting = new Map();
    let next = 1;
    w.onmessage = (e) => {
      const r = waiting.get(e.data);
      waiting.delete(e.data);
      if (r) r();
    };
    return {
      sleep: (ms) =>
        new Promise((r) => {
          const id = next++;
          waiting.set(id, r);
          w.postMessage({ id, ms: Math.max(0, ms) });
        }),
    };
  } catch {
    return null;
  }
})();
const sleep = (ms) => (timerWorker ? timerWorker.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
const randomBetween = ([min, max]) => min + Math.floor(Math.random() * (max - min));
const pad2 = (n) => String(n).padStart(2, "0");

class StopError extends Error {}
class BlockedError extends Error {} // 네이버 보호조치·로그인 풀림 등 → 네이버 수집 즉시 중단

// 속도 설정별 대기 시간(ms)
const DELAYS = {
  normal: { listPage: [3000, 6000], article: [5000, 10000], cafeGap: [4000, 8000], restEvery: 8, rest: [20000, 40000], community: [3000, 6000] },
  slow: { listPage: [6000, 10000], article: [9000, 16000], cafeGap: [8000, 15000], restEvery: 5, rest: [40000, 80000], community: [5000, 9000] },
};

// 네이버 카페 한 번 수집할 때 여는 화면 수 상한 (안전장치)
const NAVER_MAX_PAGEVIEWS = 700;
const NAVER_MAX_LIST_PAGES = 30; // 카페 하나당 목록 페이지 상한
const COMMUNITY_MAX_LIST_PAGES = 80;

function fmtDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toLocalInputValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 기본 수집 기간: 전일 08:00 ~ 금일 08:00
function defaultRange(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0);
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  return { start, end };
}

// 화면/목록에 보이는 날짜 글자를 해석한다.
// → { date: Date, exact: 시각까지 알면 true } 또는 null
function parseKoreanDate(text, now = new Date()) {
  if (!text) return null;
  const s = String(text);
  let m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]*\))?\s*(?:(오전|오후)\s*)?(?:(\d{1,2}):(\d{2}))?/);
  if (m) {
    let h = m[5] !== undefined ? +m[5] : 0;
    if (m[4] === "오후" && h < 12) h += 12;
    if (m[4] === "오전" && h === 12) h = 0;
    const exact = m[5] !== undefined;
    return { date: new Date(+m[1], +m[2] - 1, +m[3], h, exact ? +m[6] : 0), exact };
  }
  m = s.match(/(?:^|[^\d])(\d{2})[./-](\d{2})[./-](\d{2})(?:\s+(\d{1,2}):(\d{2}))?/); // 26.10.10 / 26/10/10
  if (m) {
    const exact = m[4] !== undefined;
    return { date: new Date(2000 + +m[1], +m[2] - 1, +m[3], exact ? +m[4] : 0, exact ? +m[5] : 0), exact };
  }
  m = s.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d])/); // 14:23 → 오늘
  if (m) {
    let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
    if (d.getTime() > now.getTime() + 10 * 60000) d = new Date(d.getTime() - 86400000); // 자정 넘긴 경우
    return { date: d, exact: true };
  }
  m = s.match(/(\d+)\s*(분|시간)\s*전/);
  if (m) {
    const mins = m[2] === "분" ? +m[1] : +m[1] * 60;
    return { date: new Date(now.getTime() - mins * 60000), exact: true };
  }
  m = s.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})(?![\d./-])/); // 10/10 → 올해
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
    if (d.getTime() > now.getTime() + 86400000) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2]);
    return { date: d, exact: false };
  }
  return null;
}

// 날짜만 아는 글(시각 모름)이 기간에 걸칠 수 있는지
function mayBeInRange(parsed, range) {
  if (!parsed) return true;
  const t = parsed.date.getTime();
  if (parsed.exact) return t >= range.start.getTime() && t < range.end.getTime();
  const dayEnd = t + 86400000;
  return dayEnd > range.start.getTime() && t < range.end.getTime();
}

// 목록 한 페이지가 기간보다 오래된 글들로 넘어갔는지: 날짜를 아는 일반 글의 절반 이상이 기간 시작보다 오래되면 true
// (공지·옆쪽 인기글처럼 오래된 글이 섞여 있어도 일찍 멈추지 않도록 비율로 본다)
function pageIsPastRange(items, range) {
  let dated = 0;
  let older = 0;
  for (const it of items) {
    if (it.notice || it.ts === null || it.ts === undefined) continue;
    dated++;
    const t = it.ts;
    if (it.exact ? t < range.start.getTime() : t + 86400000 <= range.start.getTime()) older++;
  }
  return dated > 0 && older * 2 >= dated;
}

function inRange(date, range) {
  const t = date.getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

// 부정 이슈 키워드 (설정 화면에서 고칠 수 있음). AI 없이 고를 때, AI 실패 시 대신 고를 때 쓰고 AI 에게도 참고로 알려준다.
let ISSUE_KEYWORDS = { 품질: [], 응대: [], 결품: [] };
let EXCLUDE_KEYWORDS = [];

function parseKeywordText(text) {
  const out = { 품질: [], 응대: [], 결품: [], 제외: [] };
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*(품질|응대|결품|제외)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    out[m[1]].push(...m[2].split(/[,，]/).map((w) => w.trim()).filter(Boolean));
  }
  return out;
}

function setIssueKeywords(text) {
  const k = parseKeywordText(text);
  ISSUE_KEYWORDS = { 품질: k.품질, 응대: k.응대, 결품: k.결품 };
  EXCLUDE_KEYWORDS = k.제외;
}
setIssueKeywords(typeof DEFAULT_KEYWORDS !== "undefined" ? DEFAULT_KEYWORDS : "");

// 자동차 커뮤니티의 단순 뉴스·해외 이슈 공유 글 (키워드 모드에서 뺀다. AI 모드는 AI 가 판단)
const COMMUNITY_NEWS_RE = /뉴스|기사|외신|속보|단독|보도|\[펌\]|해외|미국|북미|유럽|독일|중국|일본|인도|호주|캐나다|NHTSA|IIHS/;

function communityNewsLike(text) {
  return COMMUNITY_NEWS_RE.test(String(text || ""));
}

// 출석·출근·퇴근 도장(출석 체크) 글은 어떤 모드에서든 무조건 뺀다 (여기서 '도장'은 도색이 아님)
const ATTENDANCE_RE = /(출석|출근|퇴근|등교|하교|점심|아침|저녁)\s*도장|출석\s*체크|출첵|출석부/;

function isAttendancePost(text) {
  return ATTENDANCE_RE.test(String(text || ""));
}

// AI 없이 '보고 필요' 고르기: 신차 + 심각한 증상 점수, 단순 정보 공유·문의는 제외 → 행 번호 Set (최대 5개)
const SEVERE_RE = /시동\s?꺼짐|시동 불가|가속 불가|출력 제한|브레이크|제동|조향|화재|연기|과열|ICCU|고전압|배터리 (이상|불량)|연료\s?전지|누수|도어 열림|에어백|안전벨트|급발진|견인|결품|재발/;
function keywordReportPick(rows, priorityCars) {
  const pri = String(priorityCars || "").split(",").map((x) => x.trim()).filter(Boolean);
  const scored = rows
    .map((r, i) => {
      const text = `${r.summary} ${r.title || ""} ${r.excerpt || ""}`;
      if (/정보 공유|정보 문의|공유$|의견$/.test(r.summary)) return null;
      let score = (text.match(new RegExp(SEVERE_RE.source, "g")) || []).length * 2;
      if (pri.some((c) => r.car === c || r.car.startsWith(`${c} `))) score += 3;
      return score >= 4 ? { i, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return new Set(scored.slice(0, 5).map((x) => x.i));
}

// 코드표에서 코드별 출시(적용 시작) 연도: "LX2: … (1세대, 2018~2024)" → { LX2: 2018 }
function codeStartYears(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^([^#:][^:]*):.*\((?:[^)]*?,\s*)?((?:19|20)\d{2})\s*~/);
    if (m) out[m[1].trim()] = +m[2];
  }
  return out;
}

// 2020년 이전 출시 세대에서도 보고에 넣을 매우 심각한 이슈
const VERY_SEVERE_RE = /화재|불이|불남|급발진|시동\s?꺼짐|시동이 꺼|사망|돌진|전소|폭발/;

// 게시판 이름 비교용: 이모지·기호·띄어쓰기를 뺀다 ("아이오닉5️⃣Q&A" → "아이오닉5q&a")
function boardNorm(t) {
  return String(t || "").replace(/[^가-힣A-Za-z0-9&]/g, "").toLowerCase();
}

// '게시판 지정' 글 → { ids: Set(번호), names: [이름], groups: [그룹 이름] }
function parseBoardSpec(text) {
  const spec = { ids: new Set(), names: [], groups: [] };
  for (const raw of String(text || "").split(/[,\n]/)) {
    const t = raw.trim();
    if (!t) continue;
    const url = t.match(/menus\/(\d+)|menuid=(\d+)/i);
    if (url) spec.ids.add(url[1] || url[2]);
    else if (/^\d+$/.test(t)) spec.ids.add(t);
    else if (/^그룹\s*[:：]/.test(t)) spec.groups.push(t.replace(/^그룹\s*[:：]\s*/, ""));
    else if (boardNorm(t)) spec.names.push(boardNorm(t));
  }
  return spec;
}

// 같은 글인지 비교하기 위한 주소 열쇠 (카페 주소 형식이 달라도 같은 글이면 같은 열쇠)
function urlKey(url) {
  const u = String(url || "").trim();
  let m = u.match(/cafe\.naver\.com\/([A-Za-z0-9_\-]+)\/(\d+)/i);
  if (m) return `cafe:${m[1].toLowerCase()}/${m[2]}`;
  m = u.match(/bobaedream\.co\.kr\/view\?.*?code=([^&]+).*?No=(\d+)/i) || u.match(/bobaedream\.co\.kr\/view\?.*?No=(\d+).*?code=([^&]+)/i);
  if (m) return `bobae:${/^\d+$/.test(m[1]) ? `${m[2]}/${m[1]}` : `${m[1]}/${m[2]}`}`;
  m = u.match(/ppomppu\.co\.kr\/zboard\/view\.php\?.*?id=([^&]+).*?no=(\d+)/i);
  if (m) return `ppom:${m[1]}/${m[2]}`;
  m = u.match(/clien\.net\/service\/board\/([^/?#]+)\/(\d+)/i);
  if (m) return `clien:${m[1]}/${m[2]}`;
  return u.replace(/^https?:\/\/(www\.|m\.)?/i, "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
}

function excluded(text) {
  const t = String(text || "");
  return EXCLUDE_KEYWORDS.some((w) => t.includes(w));
}

const BRAND_KEYWORDS = [
  "현대", "제네시스", "그랜저", "쏘나타", "소나타", "아반떼", "코나", "투싼", "싼타페", "산타페", "팰리세이드", "펠리세이드", "팰리",
  "스타리아", "쏠라티", "캐스퍼", "아이오닉", "넥쏘", "베뉴", "포터", "마이티", "G70", "G80", "G90", "GV60", "GV70", "GV80",
  "블루핸즈", "하이테크", "파란손", "멍든손", "현기", "흉기", "ST1", "그렌저", "싼페",
];

function keywordHits(text) {
  const t = String(text || "");
  const hits = [];
  for (const [cat, words] of Object.entries(ISSUE_KEYWORDS)) {
    for (const w of words) if (t.includes(w)) hits.push([cat, w]);
  }
  return hits;
}

function mentionsBrand(text) {
  const t = String(text || "");
  return BRAND_KEYWORDS.some((w) => t.includes(w));
}

// 키워드만으로 구분 정하기 (품질 > 결품 > 응대)
function keywordCategory(text) {
  const cats = new Set(keywordHits(text).map(([c]) => c));
  if (cats.has("품질")) return "품질";
  if (cats.has("결품")) return "결품";
  if (cats.has("응대")) return "응대";
  return "";
}

// 코드표에서 별칭으로 차종 코드 찾기 (AI 없이 쓸 때)
function parseCarCodes(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const m = l.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const names = m[2]
      .replace(/\([^)]*\)/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    out.push({ code: m[1].trim(), names });
  }
  return out;
}

// 글에 나온 차종명 중 가장 긴(구체적인) 것을 고른다 (예: "아이오닉5" 가 "아이오닉" 보다 우선). 같은 이름이면 표에서 위(최신 세대)
function guessCarCode(text, carCodes) {
  const t = String(text || "").replace(/\s+/g, "");
  let best = "";
  let bestLen = 0;
  const variantOk = (code) => {
    if (/ (EV|FC|FCEV)$/.test(code)) return /EV|일렉트릭|전기|수소|FCEV/i.test(t);
    if (/ N$/.test(code)) return /N라인|[^A-Za-z]N(?![A-Za-z])|고성능/.test(` ${t}`);
    return true;
  };
  for (const { code, names } of carCodes) {
    if (!variantOk(code)) continue;
    if (/^[A-Z]{2,3}\d/.test(code) && t.includes(code.replace(/\s+/g, "")) && code.length + 100 > bestLen) {
      best = code;
      bestLen = code.length + 100; // 코드가 직접 적혀 있으면 가장 우선
    }
    for (const n of names) {
      const nn = n.replace(/\s+/g, "");
      if (nn.length > bestLen && t.includes(nn)) {
        best = code;
        bestLen = nn.length;
      }
    }
  }
  return best;
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
  return (doc.body.textContent || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}
