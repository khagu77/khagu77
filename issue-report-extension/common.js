// 여러 파일이 같이 쓰는 도구들

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad2 = (n) => String(n).padStart(2, "0");
const randomBetween = ([min, max]) => min + Math.floor(Math.random() * (max - min));

// 숨겨진 탭에서는 크롬이 setTimeout 을 크게 늦추므로(최대 1분 단위) 워커의 타이머로 기다린다
const timerWorker = (() => {
  try {
    const w = new Worker("timer-worker.js");
    const waiting = new Map();
    let next = 1;
    w.onmessage = (e) => {
      const r = waiting.get(e.data);
      waiting.delete(e.data);
      if (r) r();
    };
    return (ms) =>
      new Promise((r) => {
        const id = next++;
        waiting.set(id, r);
        w.postMessage({ id, ms: Math.max(0, ms) });
      });
  } catch {
    return null;
  }
})();
const sleep = (ms) => (timerWorker ? timerWorker(ms) : new Promise((r) => setTimeout(r, ms)));

class StopError extends Error {}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "hidden") e.hidden = !!v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function escapeXml(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------------

function fmtDateTime(d) {
  if (!d) return "";
  d = new Date(d);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function ymd(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

// 엑셀 날짜 값(1900 기준 일련번호, 이 PC 시간대 그대로)
function excelSerial(d) {
  d = new Date(d);
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - Date.UTC(1899, 11, 30)) / 86400000;
}

// 화면에 보이는 날짜 글자 → { date, exact(시각까지 앎) } 또는 null
// "2026.10.11. 15:22" / "2026-10-11 15:22:01" / "26.10.11" / "15:22"(오늘) / "3시간 전" / "어제" / "10/11"
function parseKoreanDate(text, now = new Date()) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  let m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]*\))?\s*(?:(오전|오후)\s*)?(?:(\d{1,2}):(\d{2}))?/);
  if (m) {
    let h = m[5] !== undefined ? +m[5] : 0;
    if (m[4] === "오후" && h < 12) h += 12;
    if (m[4] === "오전" && h === 12) h = 0;
    const exact = m[5] !== undefined;
    return { date: new Date(+m[1], +m[2] - 1, +m[3], h, exact ? +m[6] : 0), exact };
  }
  m = s.match(/(?:^|[^\d])(\d{2})[./-](\d{2})[./-](\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const exact = m[4] !== undefined;
    return { date: new Date(2000 + +m[1], +m[2] - 1, +m[3], exact ? +m[4] : 0, exact ? +m[5] : 0), exact };
  }
  m = s.match(/(\d+)\s*(분|시간)\s*전/);
  if (m) return { date: new Date(now.getTime() - +m[1] * (m[2] === "분" ? 60e3 : 3600e3)), exact: true };
  if (/방금|초\s*전/.test(s)) return { date: new Date(now), exact: true };
  m = s.match(/(\d+)\s*일\s*전/);
  if (m) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - +m[1]);
    return { date: d, exact: false };
  }
  if (/어제/.test(s)) return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), exact: false };
  m = s.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d])/);
  if (m) {
    let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
    if (d.getTime() > now.getTime() + 10 * 60000) d = new Date(d.getTime() - 86400000);
    return { date: d, exact: true };
  }
  m = s.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})(?![\d./-])/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
    if (d.getTime() > now.getTime() + 86400000) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2]);
    return { date: d, exact: false };
  }
  return null;
}

// 글 날짜가 기간 안인지: "in" / "older" / "newer" / "ambiguous"(날짜만 알아 걸칠 수 있음)
function placeInRange(parsed, range) {
  if (!parsed) return "ambiguous";
  const t = parsed.date.getTime();
  const from = range.from.getTime();
  const to = range.to.getTime();
  if (parsed.exact) return t < from ? "older" : t >= to ? "newer" : "in";
  const dayEnd = t + 86400000;
  if (dayEnd <= from) return "older";
  if (t >= to) return "newer";
  if (t >= from && dayEnd <= to) return "in";
  return "ambiguous";
}

// ---------------------------------------------------------------------------
// 수집 키워드 (조합 키워드)
//  - 한 줄 = 검색어 하나. 줄과 줄은 '또는'
//  - 한 줄 안의 띄어 쓴 단어들은 '그리고' (모두 들어간 글)
//  - 한 단어 자리에 A|B 처럼 쓰면 'A 또는 B' (검색할 때는 조합을 모두 펼쳐 검색)
//  - '-단어' 는 그 말이 들어간 글을 뺀다 (어느 줄에 써도 전체에 적용)
// 예) CN8|아반떼 가격|가격표   → "CN8 가격" "CN8 가격표" "아반떼 가격" "아반떼 가격표" 로 검색
// ---------------------------------------------------------------------------

function parseKeywords(text) {
  const groups = [];
  const exclude = [];
  for (const raw of String(text || "").split(/\r?\n|,/)) {
    const terms = [];
    for (const tok of raw.trim().split(/\s+/).filter(Boolean)) {
      if (tok.startsWith("-") && tok.length > 1) exclude.push(tok.slice(1));
      else terms.push(tok.split("|").map((x) => x.trim()).filter(Boolean));
    }
    if (terms.length) groups.push(terms);
  }
  return { groups, exclude };
}

// 검색창에 넣을 검색어 상한 (뉴스 검색 시간 때문에)
const QUERY_LIMIT = 100;

// 줄마다 조합을 모두 펼친 검색어
function expandLines(kw) {
  return kw.groups.map((terms) => {
    let combos = [[]];
    for (const alts of terms) {
      const next = [];
      for (const c of combos) for (const a of alts) next.push([...c, a]);
      combos = next.slice(0, 1000);
    }
    return [...new Set(combos.map((c) => c.join(" ")))];
  });
}

// 검색창에 넣을 검색어들 (조합을 펼친 것, 같은 것은 하나만). 상한을 넘으면 줄마다 돌아가며 골고루 담아
// 어느 키워드 줄도 빠지지 않게 한다
function searchQueries(kw, limit = QUERY_LIMIT) {
  const lines = expandLines(kw);
  const out = [];
  for (let i = 0; out.length < limit && lines.some((l) => l.length > i); i++) {
    for (const l of lines) if (l[i] && !out.includes(l[i]) && out.length < limit) out.push(l[i]);
  }
  return out;
}

// 펼친 검색어 전체 수 (상한 넘었는지 알려 주기용)
function totalQueries(kw) {
  return new Set(expandLines(kw).flat()).size;
}

// 동호회(카페 안 검색)용 검색어: 줄마다 첫 단어 자리의 말들만 (예: "아반떼|디올뉴아반떼 투싼 가격" → 아반떼, 디올뉴아반떼)
// 카페 검색은 사람 속도로 화면을 열어 읽어 느리므로, 조합을 모두 펼치지 않고 넓게 찾은 뒤 나머지 조건은 AI 판독(또는 키워드)으로 거른다
function cafeQueries(kw, limit = 6) {
  const out = [];
  for (const terms of kw.groups) for (const a of terms[0] || []) if (!out.includes(a)) out.push(a);
  return out.slice(0, limit);
}

const compactLower = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

// 글자에 키워드 조합이 들어 있는지
function matchesKeywords(text, kw) {
  const t = compactLower(text);
  if (kw.exclude.some((w) => t.includes(compactLower(w)))) return false;
  return kw.groups.some((terms) => terms.every((alts) => alts.some((a) => t.includes(compactLower(a)))));
}

// 영어 오류·상태 문구를 한글로
const KOR_MESSAGES = [
  [/Failed to fetch|NetworkError[^)]*|network error|net::ERR_[A-Z_]+|Connection error\.?/gi, "네트워크 연결 오류"],
  [/Request timed out\.?|\btimed? ?out\b|\bTimeout\b/gi, "응답 시간 초과"],
  [/(?:HTTP\s*)?\b429\b(?:\s*Too Many Requests)?|Too Many Requests|rate[_ ]?limit(?:_error)?/gi, "요청이 많아 잠시 제한됨"],
  [/overloaded_error|\bOverloaded\b|\b529\b/gi, "AI 서버 혼잡"],
  [/invalid x-api-key|authentication_error|\b401\b(?:\s*Unauthorized)?/gi, "API 키 오류"],
  [/credit balance[^.)]*|\bbilling\b[^.)]*/gi, "API 크레딧 부족"],
  [/Internal Server Error|Service Unavailable|Bad Gateway|\bapi_error\b|\bHTTP\s*50[0234]\b/gi, "서버 오류"],
  [/\bAbortError\b|The operation was aborted\.?/gi, "중단됨"],
  [/Unexpected token[^)]*|is not valid JSON|JSON\.parse[^)]*/gi, "응답 해석 오류"],
  [/Cannot read properties of (?:undefined|null)[^)]*|\S+ is not a function|\S+ is not defined/gi, "프로그램 내부 오류"],
  [/^Error:\s*/i, ""],
];
function korMsg(text) {
  let s = String(text ?? "");
  if (!/[A-Za-z]{4,}/.test(s)) return s;
  for (const [re, ko] of KOR_MESSAGES) s = s.replace(re, ko);
  return s;
}

// ---------------------------------------------------------------------------
// 웹 문서 받기 (사이트 글자 인코딩 자동 판별: 뽐뿌 등 EUC-KR)
// ---------------------------------------------------------------------------

async function fetchText(url, opts = {}) {
  const res = await fetch(url, { credentials: opts.credentials || "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} 응답 (${url})`);
  const buf = await res.arrayBuffer();
  const ctype = res.headers.get("content-type") || "";
  let charset = (ctype.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  }
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function fetchDocument(url, opts) {
  return new DOMParser().parseFromString(await fetchText(url, opts), "text/html");
}

function textOf(e) {
  return (e ? e.textContent : "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// 칸마다 글자가 붙지 않도록 글자 조각 사이에 공백을 넣어 읽는다
function spacedText(e) {
  if (!e) return "";
  const parts = [];
  const walker = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 파일 받기 · 진행 막대
// ---------------------------------------------------------------------------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

function cleanFileName(name) {
  return String(name || "파일").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
}

function cleanFolder(f) {
  return String(f || "")
    .split(/[\\/]+/)
    .map((p) => p.trim().replace(/[<>:"|?*\x00-\x1f]/g, "").replace(/^\.+$/, ""))
    .filter(Boolean)
    .join("/");
}

// data: 주소로 받는다 (blob: 으로 받으면 맥 '출처' 정보에 확장 주소가 남음)
async function downloadBytes(bytes, name, folder = "") {
  name = cleanFileName(name);
  const ext = (name.match(/\.(\w+)$/) || [])[1] || "";
  const blob = new Blob([bytes], { type: MIME[ext.toLowerCase()] || "application/octet-stream" });
  const url = await blobToDataUrl(blob);
  folder = cleanFolder(folder);
  if (folder) {
    try {
      await chrome.downloads.download({ url, filename: `${folder}/${name}`, conflictAction: "uniquify" });
      return;
    } catch {
      /* 아래 기본 방식으로 */
    }
  }
  const a = el("a", { href: url, download: name, rel: "noreferrer", style: "display:none" });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 작업 중 표시줄: 맨 위에 고정된 현대차 블루 막대 + 진행률, 탭 제목에도 진행 상황
let workText = "";
let workNote = "";
let workNoteTimer = null;
let workActive = false;

function showWork(text, done = 0, total = 0) {
  workActive = true;
  workText = text;
  const bar = $("#workBar");
  bar.hidden = false;
  document.body.classList.add("working");
  $("#workBarText").textContent = `${text} — ${workNote || "끝날 때까지 이 화면을 닫거나 뒤로 가지 마세요"}`;
  $("#workBarFill").style.width = total ? `${Math.max(4, Math.min(100, Math.round((done / total) * 100)))}%` : "100%";
  document.title = `⏳ ${total ? `${Math.min(done + 1, total)}/${total} ` : ""}이슈 모니터링`;
}

function hideWork() {
  workActive = false;
  $("#workBar").hidden = true;
  document.body.classList.remove("working");
  document.title = "이슈 모니터링 보고서 작성";
}

// 작업 중인지 (app.js 가 수집·분석 중 여부로 바꿔 끼움)
let isWorking = () => workActive;

function noteWork(text) {
  workNote = text;
  clearTimeout(workNoteTimer);
  workNoteTimer = setTimeout(() => {
    workNote = "";
    if (workActive) showWork(workText);
  }, 4000);
  if (workActive) showWork(workText);
}

// 뒤로·앞으로 가기(마우스 제스처·트랙패드 밀기·단축키): 작업 중이면 막고 그대로 머문다
history.pushState({ guard: true }, "");
window.addEventListener("popstate", () => {
  if (isWorking()) {
    history.pushState({ guard: true }, "");
    noteWork("작업 중이라 뒤로·앞으로 가기를 막았습니다");
  } else history.back();
});

// 백스페이스(입력 칸 밖)·Alt+←/→·⌘+[/] 단축키도 작업 중에는 막는다
window.addEventListener(
  "keydown",
  (e) => {
    if (!isWorking()) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const nav =
      (e.key === "Backspace" && !typing) ||
      (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
      (e.metaKey && (e.key === "[" || e.key === "]" || e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
      e.key === "BrowserBack" ||
      e.key === "BrowserForward";
    if (nav) {
      e.preventDefault();
      e.stopPropagation();
      noteWork("작업 중이라 뒤로·앞으로 가기를 막았습니다");
    }
  },
  true,
);

// 마우스 옆 버튼(뒤로·앞으로)
window.addEventListener(
  "mouseup",
  (e) => {
    if (isWorking() && (e.button === 3 || e.button === 4)) {
      e.preventDefault();
      noteWork("작업 중이라 뒤로·앞으로 가기를 막았습니다");
    }
  },
  true,
);

// 창·탭 닫기, 새로고침: 작업 중이면 크롬이 '나가시겠습니까?' 를 묻게 한다
window.addEventListener("beforeunload", (e) => {
  if (!isWorking()) return;
  e.preventDefault();
  e.returnValue = "";
});

// 보고서 인용용: 대댓글 앞의 '@닉네임'(유튜브 @핸들 포함)을 지운다 (메일 주소처럼 글자에 붙은 @ 는 그대로)
function stripMentions(text) {
  return String(text || "")
    .replace(/(^|[\s(\[])@@?[^\s@,.:;!?)\]]{1,40}[,:]?/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
