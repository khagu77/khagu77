// LX3 / ME1 / MX5 전동 시트 작동 위험 상황 관련 게시물 수집 - 차종별 네이버 동호회에서 양산 시점부터 지금까지
// 2·3열 시트 조작 중 안전 사고·위험(우려)을 언급한 글을 찾아, 온라인 동향·로데이터에 들어 있었는지(Y/N)와
// 주요내용 요약·누락 사유를 붙여 엑셀(첨부 양식)로 받는다.
// 네이버는 API 를 부르지 않고 검색 화면·게시글을 보이지 않는 틀(필요하면 뒤쪽 탭)로 열어 화면에 보이는 내용만 읽는다(cafe-common.js).

const CARS = [
  { code: "LX3", label: "팰리세이드 (LX3)", start: "2024-12-20" },
  { code: "ME1", label: "아이오닉9 (ME1)", start: "2024-12-16" },
  { code: "MX5", label: "싼타페 (MX5)", start: "2023-08-15" },
];
const DEFAULT_CAFES = [
  "LX3 | 팰리세이드 피플 | allumpc",
  "LX3 | 클럽 팰리세이드 | naworl",
  "LX3 | LX3 클럽 | gamewinds",
  "LX3 | 팰리세이드 오너스 클럽 | tobloomer",
  "LX3 | 더팰리세이드 | hyundaipalisade",
  "ME1 | 전기차 동호회 | allfm01 | 혼합",
  "ME1 | 아이오닉 멤버스 | cafeclip | 혼합",
  "ME1 | 아이오닉9 오너스 | ioniq9owners",
  "ME1 | 아이오닉9 클럽 | optimusex119",
  "MX5 | 싼타페MX5패밀리 | trailer",
  "MX5 | 클럽싼타페 | iroid",
  "MX5 | 싼타페MX5클럽 | choids",
].join("\n");
// 이미 알고 있는 카페 번호 (나머지는 찾을 때 카페 첫 화면을 열어 알아낸다)
const KNOWN_CLUB_IDS = { allumpc: "16624720" };
const DEFAULT_QUERIES = "2열 시트, 3열 시트, 2열 끼임, 3열 끼임, 시트 끼임, 시트 폴딩, 전동시트, 시트 위험, 시트 사고, 시트 다칠";
const DEFAULT_MIXED_QUERIES = "{차종} 2열, {차종} 3열, {차종} 시트 끼임, {차종} 전동시트";
const DEFAULT_CAR_WORDS = ["LX3 | 팰리세이드, 팰리, LX3", "ME1 | 아이오닉9, 아이오닉 9, 아9, ioniq9, ioniq 9, ME1", "MX5 | 싼타페, 싼타, MX5"].join("\n");
const DEFAULT_ROW_WORDS = "2열, 3열, 이열, 삼열, 뒷좌석, 뒷자리, 뒷열, 시트, 좌석, 폴딩, 접이, 원터치, 워크인, 슬라이딩, 리클라이닝";
const DEFAULT_RISK_WORDS =
  "끼임, 끼여, 끼었, 끼인, 끼이, 끼일, 끼어, 낄뻔, 낄 뻔, 다칠, 다쳤, 다침, 부상, 사고, 위험, 아찔, 조심, 주의, 무섭, 무서, 골절, 멍들, 멍이, 피가, 피나, 병원, " +
  "깔려, 깔릴, 압박, 눌려, 짓눌, 손가락, 발가락, 발목, 아이가, 아이들, 아이 손, 애기, 아기, 애들, 강아지, 사망, 리콜, 안전, 센서, 감지, 안 멈, 안멈, 멈추지";
const DEFAULT_EXCLUDE = "시트커버, 시트지, 열선, 통풍, 썬팅, 틴팅, 팝니다, 삽니다, 판매합니다, 공동구매";
const DEFAULT_SEARCH_URL = "https://cafe.naver.com/f-e/cafes/{cafeId}/menus/0?viewType=L&ta=ARTICLE_COMMENT&page={page}&q={q}";
const DEFAULT_MAX_PAGES = 10;
const HEADER_ROW = 3; // 양식: 3행 머리글(B 순번 · C 차종 · D 동호회명 · E 게시일 · F 제목 · G URL · H 요약 · I 포함 여부 · J 누락 사유)
const STYLE_ROW = 4;
const OUT_NAME = "LX3·ME1·MX5 전동 시트 작동 위험 상황 관련 게시물.xlsx";
const BLUE = "FF0070C0"; // 포함 여부 Y
const RED = "FFE00000"; // 포함 여부 N
// 걸리는 시간 어림 (초): 검색 화면 한 페이지 · 글 하나
const SEC_PER_PAGE = 9;
const SEC_PER_ARTICLE = 12;

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본 · 권장)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴 · 정확도 낮음)"],
];
const AI_PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] }; // 100만 토큰당 달러 (입력, 출력)
const WON_PER_USD = 1400;
const AI_BATCH = 6; // 한 번에 보내는 글 수
const AI_PARALLEL = 3;
const AI_BODY_CHARS = 4000; // 글마다 보내는 본문 길이

let items = []; // { key, car, cafeIndex, cafeName, slug, articleId, title, text, date, queries, related, checked, touched, mixedOk, body, bodyRead, bodyNote, summary, reason, by }
let compare = []; // 비교 파일 [{ id, name, kind: "trend"|"raw", keys, slugs, minDate, maxDate, rows }]
let clubIds = {}; // 영문 주소 → 카페 번호
let running = false;
let stopRequested = false;
let diagnostics = [];

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const SETTING_IDS = ["cafeList", "queries", "mixedQueries", "carWords", "rowWords", "riskWords", "exclude", "searchUrl", "maxPages"];
const SETTING_DEFAULTS = {
  cafeList: DEFAULT_CAFES, queries: DEFAULT_QUERIES, mixedQueries: DEFAULT_MIXED_QUERIES, carWords: DEFAULT_CAR_WORDS,
  rowWords: DEFAULT_ROW_WORDS, riskWords: DEFAULT_RISK_WORDS, exclude: DEFAULT_EXCLUDE, searchUrl: DEFAULT_SEARCH_URL, maxPages: DEFAULT_MAX_PAGES,
};

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["seatSettings", "seatCars", "seatClubIds", "saveFolder", "saveAsk", "seatTabFallback", "aiKey", "aiModel", "seatAiOn"])
    .catch(() => ({}));
  const set = s.seatSettings || {};
  for (const id of SETTING_IDS) $(`#${id}`).value = set[id] ?? SETTING_DEFAULTS[id];
  $("#saveFolder").value = s.saveFolder || "";
  $("#saveAsk").checked = !!s.saveAsk;
  $("#tabFallback").checked = s.seatTabFallback ?? true;
  clubIds = { ...KNOWN_CLUB_IDS, ...(s.seatClubIds || {}) };
  // LX3 화면에서 알아 둔 카페 번호 → 영문 주소도 쓴다
  for (const [id, slug] of Object.entries(await loadCafeSlugs())) if (!clubIds[slug.toLowerCase()]) clubIds[slug.toLowerCase()] = id;
  renderCars(s.seatCars || {});
  const sel = $("#aiModel");
  sel.innerHTML = "";
  for (const [id, label] of AI_MODELS) sel.add(new Option(label, id));
  if (s.aiModel && AI_MODELS.some(([id]) => id === s.aiModel)) sel.value = s.aiModel;
  $("#aiKey").value = s.aiKey || "";
  $("#aiOn").checked = !!s.seatAiOn;
  $("#aiOpts").hidden = !$("#aiOn").checked;
}

function saveSettings() {
  const set = {};
  for (const id of SETTING_IDS) set[id] = $(`#${id}`).value;
  set.maxPages = Math.max(1, Math.min(100, Number(set.maxPages) || DEFAULT_MAX_PAGES));
  set.searchUrl = normalizeSearchUrl(set.searchUrl);
  return chrome.storage.local
    .set({
      seatSettings: set,
      seatCars: carSettings(),
      seatTabFallback: $("#tabFallback").checked,
      saveFolder: cleanFolder($("#saveFolder").value),
      saveAsk: $("#saveAsk").checked,
      aiKey: $("#aiKey").value.trim(),
      aiModel: $("#aiModel").value,
      seatAiOn: $("#aiOn").checked,
    })
    .catch(() => {});
}

function saveClubIds() {
  return chrome.storage.local.set({ seatClubIds: clubIds }).catch(() => {});
}

function words(text) {
  return String(text || "")
    .split(/[,\n]/)
    .map((w) => compactText(w))
    .filter(Boolean);
}

function compactText(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

// 동호회 목록 → [{ car, name, slug, mixed }]
function cafes() {
  const out = [];
  for (const line of $("#cafeList").value.split(/\r?\n/)) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) continue;
    const car = parts[0].toUpperCase();
    const slug = (parseArticleUrl(parts[2]).cafeUrl || parts[2].replace(/^https?:\/\/(?:m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, "")).trim();
    if (!CARS.some((c) => c.code === car) || !isSlug(slug)) continue;
    out.push({ car, name: parts[1] || slug, slug, mixed: /혼합/.test(parts[3] || "") });
  }
  return out;
}

// 차종 이름: { ME1: ["아이오닉9", …] }
function carWords() {
  const out = {};
  for (const line of $("#carWords").value.split(/\r?\n/)) {
    const [car, list] = line.split("|").map((p) => p.trim());
    if (car && list) out[car.toUpperCase()] = list.split(",").map((w) => w.trim()).filter(Boolean);
  }
  return out;
}

function renderCars(saved) {
  const tbody = $("#carRows");
  tbody.innerHTML = "";
  for (const car of CARS) {
    const s = saved[car.code] || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="checkbox" class="carOn"></td><td></td><td><input type="date" class="carStart"></td><td class="hint"></td>`;
    tr.dataset.car = car.code;
    tr.querySelector(".carOn").checked = s.on ?? true;
    tr.children[1].textContent = car.label;
    tr.querySelector(".carStart").value = s.start || car.start;
    tbody.appendChild(tr);
    for (const input of tr.querySelectorAll("input")) input.addEventListener("change", () => (saveSettings(), updateJobInfo()));
  }
  renderCafeInfo();
}

function carSettings() {
  const out = {};
  for (const tr of document.querySelectorAll("#carRows tr")) {
    out[tr.dataset.car] = { on: tr.querySelector(".carOn").checked, start: tr.querySelector(".carStart").value };
  }
  return out;
}

function carStart(code) {
  const v = carSettings()[code]?.start || CARS.find((c) => c.code === code).start;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function endDate() {
  const v = $("#endDate").value;
  if (!v) return new Date(8640000000000000);
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d + 1); // 끝 날짜 하루 전체 포함
}

function renderCafeInfo() {
  const list = cafes();
  for (const tr of document.querySelectorAll("#carRows tr")) {
    const names = list.filter((c) => c.car === tr.dataset.car).map((c) => c.name + (c.mixed ? "(혼합)" : ""));
    tr.children[3].textContent = names.length ? `${names.length}곳: ${names.join(", ")}` : "없음 (설정에서 추가)";
  }
  const tbody = $("#cafeInfo tbody");
  tbody.innerHTML = "";
  for (const c of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td></td><td><input type="text" class="slug" spellcheck="false" placeholder="자동"></td>`;
    tr.children[0].textContent = c.car;
    tr.children[1].textContent = c.name + (c.mixed ? " (혼합)" : "");
    tr.children[2].textContent = c.slug;
    const input = tr.querySelector("input");
    input.value = clubIds[c.slug.toLowerCase()] || "";
    input.addEventListener("change", async () => {
      const v = input.value.trim();
      if (v && !/^\d{4,}$/.test(v)) {
        input.value = clubIds[c.slug.toLowerCase()] || "";
        return;
      }
      if (v) clubIds[c.slug.toLowerCase()] = v;
      else delete clubIds[c.slug.toLowerCase()];
      await saveClubIds();
    });
    tbody.appendChild(tr);
  }
  updateJobInfo();
}

// 찾을 일 목록: 고른 차종의 동호회 × 검색어
function jobs() {
  const on = carSettings();
  const names = carWords();
  const plain = String($("#queries").value).split(/[,\n]/).map((q) => q.trim()).filter(Boolean);
  const mixed = String($("#mixedQueries").value).split(/[,\n]/).map((q) => q.trim()).filter(Boolean);
  const out = [];
  cafes().forEach((c, cafeIndex) => {
    if (!on[c.car]?.on) return;
    const carName = (names[c.car] || [c.car])[0];
    const qs = c.mixed ? mixed.map((q) => q.replace(/\{차종\}/g, carName)) : plain;
    for (const q of [...new Set(qs)]) out.push({ ...c, cafeIndex, q });
  });
  return out;
}

function updateJobInfo() {
  const list = jobs();
  const pages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  // 대부분 몇 페이지 안에서 끝나므로 최대치의 1/3 정도로 어림
  const sec = list.length * Math.max(1, Math.ceil(pages / 3)) * SEC_PER_PAGE;
  $("#jobInfo").textContent = list.length
    ? `동호회·검색어 ${list.length}개 · 예상 소요 시간 약 ${formatDuration(sec)} (글 수에 따라 달라짐)`
    : "찾을 차종을 고르세요.";
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}초`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
}

function normalizeSearchUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return DEFAULT_SEARCH_URL;
  if (u.includes("{cafeId}") && u.includes("{q}")) return u;
  u = u.replace(/\/cafes\/\d+\//, "/cafes/{cafeId}/").replace(/([?&](?:search\.)?clubid=)\d+/i, "$1{cafeId}");
  if (/[?&](?:q|query|search\.query)=/i.test(u)) u = u.replace(/([?&](?:q|query|search\.query)=)[^&#]*/i, "$1{q}");
  else u += `${u.includes("?") ? "&" : "?"}q={q}`;
  if (/[?&](?:search\.)?page=/i.test(u)) u = u.replace(/([?&](?:search\.)?page=)\d*/i, "$1{page}");
  else u += "&page={page}";
  return u;
}

function searchUrl(cafeId, q, page) {
  return normalizeSearchUrl($("#searchUrl").value)
    .replace("{cafeId}", cafeId)
    .replace("{q}", encodeURIComponent(q))
    .replace("{page}", String(page));
}

// ---------------------------------------------------------------------------
// 관련 글 판단: 시트 단어 + 위험 단어 (+ 혼합 동호회는 차종 이름), 관련 없는 단어가 있으면 제외
// ---------------------------------------------------------------------------

function judge(item, text) {
  const t = compactText(text);
  const names = (carWords()[item.car] || []).map(compactText);
  // '아이오닉' 의 '아이' 같은 차종 이름이 위험 단어(아이가 …)로 잡히지 않게 차종 이름을 먼저 뺀다
  let plain = t;
  for (const n of names) if (n) plain = plain.split(n).join(" ");
  const row = words($("#rowWords").value).some((w) => plain.includes(w));
  const risk = words($("#riskWords").value).some((w) => plain.includes(w));
  const exc = words($("#exclude").value).some((w) => plain.includes(w));
  const carOk = !item.mixed || names.some((n) => n && t.includes(n));
  return { related: row && risk && !exc && carOk, row, risk, exc, carOk };
}

function judgeNote(j) {
  if (j.related) return "";
  if (!j.carOk) return "차종 이름 없음(혼합 동호회)";
  if (j.exc) return "관련 없는 단어 있음";
  if (!j.row) return "시트 단어 없음";
  return "위험 단어 없음";
}

// ---------------------------------------------------------------------------
// 카페 번호 알아내기: 카페 첫 화면(cafe.naver.com/영문주소)을 열어 화면 속 /cafes/번호/ 단서를 모은다
// ---------------------------------------------------------------------------

function clubIdHintsInFrame() {
  const ids = [];
  const add = (s) => {
    for (const m of String(s || "").matchAll(/\/cafes\/(\d{4,})\b|[?&](?:search\.)?clubid=(\d{4,})|[?&]cafeId=(\d{4,})/gi)) ids.push(m[1] || m[2] || m[3]);
  };
  add(location.href);
  for (const a of document.querySelectorAll("a[href]")) add(a.getAttribute("href"));
  for (const s of document.querySelectorAll("script:not([src])")) {
    for (const m of (s.textContent || "").matchAll(/["']?(?:clubId|cafeId|g_sClubId|clubid)["']?\s*[:=]\s*["']?(\d{4,})/g)) ids.push(m[1]);
  }
  try {
    for (const e of performance.getEntriesByType("resource")) add(e.name);
  } catch {
    /* 무시 */
  }
  return { ids, href: location.href };
}

async function resolveClubId(slug) {
  const known = clubIds[slug.toLowerCase()];
  if (known) return known;
  const res = await withTab(`https://cafe.naver.com/${slug}`, async (where) => {
    for (let i = 0; i < 6; i++) {
      const frames = await runInFrames(where, clubIdHintsInFrame);
      const count = new Map();
      for (const f of frames) for (const id of f.ids) count.set(id, (count.get(id) || 0) + 1);
      const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) return best[0];
      await sleep(1500);
    }
    return null;
  }).catch(() => null);
  if (res) {
    clubIds[slug.toLowerCase()] = res;
    await saveClubIds();
    await saveCafeSlug(res, slug);
  }
  return res;
}

// ---------------------------------------------------------------------------
// 화면 읽기
// ---------------------------------------------------------------------------

function log(text) {
  const box = $("#log");
  box.hidden = false;
  const line = document.createElement("div");
  line.textContent = text;
  box.appendChild(line);
  while (box.childElementCount > 2000) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

async function scanSearchPage(url) {
  const res = await scanSearchPageIn(url, "frame").catch(() => ({ items: [], noResult: false, login: false }));
  if (!res.items.length && !res.noResult && !res.login && $("#tabFallback").checked) {
    log("  ↳ 숨긴 화면에서 글을 못 읽어 뒤쪽 탭으로 다시 확인합니다");
    return scanSearchPageIn(url, "tab").catch(() => ({ items: [], noResult: false, login: false }));
  }
  return res;
}

async function scanSearchPageIn(url, mode) {
  return withTab(url, async (where) => {
    let last = { items: [], noResult: false, login: false };
    let emptyInRow = 0;
    for (let i = 0; i < 14; i++) {
      const frames = await runInFrames(where, scanSearchInFrame);
      last = {
        items: frames.flatMap((f) => f.items || []),
        noResult: frames.some((f) => f.noResult),
        login: frames.some((f) => /nid\.naver\.com/.test(f.href || "")),
      };
      if (last.items.length || last.login) break;
      emptyInRow = last.noResult ? emptyInRow + 1 : 0;
      if (emptyInRow >= 4) break;
      await sleep(1500);
    }
    if (!last.items.length && !last.login && !last.noResult) last.snapshot = await runInFrames(where, snapshotInFrame);
    return last;
  }, { mode });
}

// 게시글 화면: 제목 · 작성 시간 · 본문
function readArticleBodyInFrame() {
  const q = (sel) => document.querySelector(sel);
  const text = String(document.body?.innerText || "");
  if (/카페\s*멤버만|멤버에게만\s*공개|가입\s*후\s*(?:이용|열람)|등급이\s*되어야/.test(text) && !q(".se-main-container, .ContentRenderer, .article_viewer")) {
    return { found: true, locked: true, href: location.href };
  }
  if (/삭제되었거나\s*없는\s*게시글|존재하지\s*않는\s*게시글|삭제된\s*게시글/.test(text)) return { found: true, deleted: true, href: location.href };
  const bodyEl = q(".se-main-container") || q(".ContentRenderer") || q(".article_viewer") || q("#postViewArea") || q("#tbody") || q(".article_container");
  const titleEl = q(".ArticleTitle .title_text") || q("h3.title_text") || q(".title_text") || q(".tit-box .b");
  if (!bodyEl) return { found: false, href: location.href };
  const re = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2})/;
  let dateText = "";
  for (const el of document.querySelectorAll(".article_info .date, .ArticleWriterProfile .date, .WriterInfo .date, [class*='article'] .date, .date")) {
    const m = (el.innerText || "").match(re);
    if (m) {
      dateText = m[0];
      break;
    }
  }
  const body = String(bodyEl.innerText || "")
    .replace(/[​ ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { found: true, title: titleEl ? String(titleEl.innerText || "").trim() : "", body: body.slice(0, 8000), dateText, href: location.href };
}

async function readArticleBody(url) {
  const tryIn = (mode) =>
    withTab(url, async (where) => {
      for (let i = 0; i < 8; i++) {
        const frames = await runInFrames(where, readArticleBodyInFrame);
        const hit = frames.find((f) => f.found);
        if (hit) return hit;
        if (frames.some((f) => /nid\.naver\.com/.test(f.href || ""))) return { found: false, login: true };
        await sleep(1500);
      }
      return { found: false };
    }, { mode }).catch(() => ({ found: false }));
  const res = await tryIn("frame");
  if (!res.found && !res.login && $("#tabFallback").checked) return tryIn("tab");
  return res;
}

function articleUrl(item) {
  return shortArticleUrl(item.slug, item.articleId);
}

// ---------------------------------------------------------------------------
// 1. 게시물 찾기 (동호회 × 검색어, 중단되면 이어서)
// ---------------------------------------------------------------------------

async function search(resume = null) {
  if (running) return;
  const list = resume ? resume.jobs : jobs();
  if (!list.length) return setSummary("찾을 차종을 고르고, 설정에 동호회와 검색어가 있는지 확인해 주세요.", "err");
  await saveSettings();
  await checkLogin();
  startBusy();
  diagnostics = [];
  $("#diag").hidden = true;
  $("#log").innerHTML = "";
  const maxPages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  const end = endDate();
  const t0 = Date.now();
  let pagesDone = 0;
  let found = 0;
  let loginNeeded = false;
  const failed = [];
  const startAt = resume ? resume.next : 0;
  if (resume) log(`· 중단된 곳부터 이어서 찾습니다 (${startAt + 1}/${list.length}번째 동호회·검색어부터)`);

  for (let ji = startAt; ji < list.length && !stopRequested; ji++) {
    const job = list[ji];
    const label = `${job.car} ${job.name} · '${job.q}'`;
    const remain = estimateRemaining(t0, ji - startAt, list.length - startAt, (list.length - ji) * 3 * SEC_PER_PAGE);
    showBusy(`게시물 찾는 중 ${ji + 1}/${list.length} · ${label}${remain} — 끝날 때까지 이 탭을 닫지 마세요`, ji, list.length, "게시물 찾는 중");
    setSummary(`찾는 중… ${ji + 1}/${list.length} · ${label}`);
    const cafeId = await resolveClubId(job.slug);
    if (!cafeId) {
      log(`✖ ${job.name}(${job.slug}): 카페 번호를 알아내지 못했습니다 - 설정의 '카페 번호'에 직접 넣어 주세요`);
      failed.push(label);
      continue;
    }
    renderCafeInfoIds();
    const start = carStart(job.car);
    let prevKeys = "";
    for (let page = 1; page <= maxPages && !stopRequested; page++) {
      const res = await scanSearchPage(searchUrl(cafeId, job.q, page));
      pagesDone++;
      if (res.login) {
        loginNeeded = true;
        log(`✖ ${job.name}: 네이버 로그인이 필요합니다`);
        failed.push(label);
        break;
      }
      const pageItems = res.items.filter((x) => !x.cafeId || x.cafeId === cafeId);
      const keys = pageItems.map((x) => x.articleId).join(",");
      if (!pageItems.length || keys === prevKeys) {
        if (!pageItems.length && res.snapshot) diagnostics.push({ job: label, page, url: searchUrl(cafeId, job.q, page), frames: res.snapshot });
        if (!pageItems.length && !res.noResult && page === 1) failed.push(label);
        log(`· ${label}: ${page}페이지 ${pageItems.length ? "(앞 페이지와 같음 - 끝)" : res.noResult ? "검색 결과 없음" : "글 목록을 읽지 못함"}`);
        break;
      }
      prevKeys = keys;
      let older = 0;
      let dated = 0;
      let added = 0;
      for (const x of pageItems) {
        const parsed = parseCafeDate(x.dateText);
        if (parsed) dated++;
        const day = parsed ? new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate()) : null;
        if (day && day < start) {
          older++;
          continue;
        }
        if (day && day >= end) continue;
        const key = `${job.slug}/${x.articleId}`.toLowerCase();
        const have = items.find((it) => it.key === key);
        if (have) {
          if (!have.queries.includes(job.q)) have.queries.push(job.q);
          continue;
        }
        const item = {
          key, car: job.car, cafeIndex: job.cafeIndex, cafeName: job.name, slug: job.slug, mixed: job.mixed, articleId: x.articleId,
          title: x.title, text: x.text, date: parsed ? parsed.date.getTime() : null, hasTime: !!parsed?.hasTime, queries: [job.q],
          checked: false, touched: false, body: "", bodyRead: false, bodyNote: "", summary: "", reason: "", by: "",
        };
        const j = judge(item, `${item.title} ${item.text}`);
        item.related = j.related;
        item.note = judgeNote(j);
        item.checked = j.related;
        items.push(item);
        added++;
        found++;
      }
      log(`· ${label}: ${page}페이지 ${pageItems.length}개 중 새 글 ${added}개`);
      renderResults();
      if (dated && older === dated) break; // 이 페이지가 모두 시작일 이전 → 다음 페이지는 더 이전
      if (page < maxPages) await sleep(randomBetween(CAFE_PAGE_DELAY));
    }
    await saveItems();
    if (!stopRequested) await saveResume("seat", { jobs: list, next: ji + 1 });
    if (ji + 1 < list.length && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }

  if (!stopRequested) await clearResume("seat");
  $("#diag").hidden = !diagnostics.length;
  renderResults();
  const checked = items.filter((x) => x.checked).length;
  setSummary(
    `${stopRequested ? "중지됨 (다시 '게시물 찾기'를 누르면 이어서) - " : ""}새로 찾은 글 ${found}개 · 전체 ${items.length}개 중 관련 글로 체크 ${checked}개 · ` +
      `${pagesDone}페이지, ${formatDuration((Date.now() - t0) / 1000)} 걸림` +
      (failed.length ? ` · 못 읽은 곳 ${failed.length}개(아래 기록 참고)` : "") +
      (loginNeeded ? " · 로그인이 필요합니다" : ""),
    loginNeeded || failed.length ? "err" : "ok",
  );
  endBusy();
}

function renderCafeInfoIds() {
  const list = cafes();
  document.querySelectorAll("#cafeInfo tbody input").forEach((input, i) => {
    if (!input.value && list[i]) input.value = clubIds[list[i].slug.toLowerCase()] || "";
  });
}

// 지금까지의 속도로 남은 시간 어림 → " · 남은 시간 약 12분"
function estimateRemaining(t0, done, total, fallbackSec) {
  const spent = (Date.now() - t0) / 1000;
  const sec = done > 0 ? (spent / done) * (total - done) : fallbackSec;
  return total - done > 0 ? ` · 남은 시간 약 ${formatDuration(sec)}` : "";
}

// ---------------------------------------------------------------------------
// 2. 비교 파일 (온라인 동향 · 로데이터)
// ---------------------------------------------------------------------------

// 같은 글인지 비교하는 열쇠: 영문 카페 주소 + 글번호 (카페 번호 주소는 아는 경우 영문 주소로)
function postKey(url) {
  const ids = parseArticleUrl(String(url || ""));
  if (!ids.articleId) return null;
  let cafe = ids.cafeUrl;
  if (!cafe && ids.cafeId) cafe = Object.entries(clubIds).find(([, id]) => id === ids.cafeId)?.[0] || `#${ids.cafeId}`;
  return cafe ? `${cafe}/${ids.articleId}`.toLowerCase() : null;
}

async function loadCompare() {
  compare = (await chrome.storage.local.get("seatCompare").catch(() => ({}))).seatCompare || [];
  await loadBuiltinCompare();
  for (const f of compare) f.keySet = new Set(f.keys);
}

// 함께 받은 비교 자료(compare-data.json: 미리 전달받은 온라인 동향·로데이터 파일의 카페 글 주소)를 처음 한 번 등록한다.
// 사내 자료라 공개 저장소에는 올리지 않고 전달용 압축 파일에만 넣는다(없으면 건너뜀).
// 자료 버전이 바뀌면 그 파일들만 새 것으로 바꾸고, 직접 등록한 파일은 그대로 둔다.
async function loadBuiltinCompare() {
  let data;
  try {
    const resp = await fetch(chrome.runtime.getURL("compare-data.json"));
    if (!resp.ok) return;
    data = await resp.json();
  } catch {
    return;
  }
  const { seatBuiltinVersion } = await chrome.storage.local.get("seatBuiltinVersion").catch(() => ({}));
  if (!data?.files?.length || seatBuiltinVersion === data.version) return;
  const names = new Set(data.files.map((f) => f.name));
  compare = compare.filter((f) => !f.builtin && !names.has(f.name)).concat(data.files.map((f) => ({ ...f, builtin: true })));
  compare.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  await saveCompare();
  await chrome.storage.local.set({ seatBuiltinVersion: data.version }).catch(() => {});
}

function saveCompare() {
  return chrome.storage.local.set({ seatCompare: compare.map(({ keySet, ...f }) => f) }).catch(() => {});
}

function excelDate(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).getTime();
  const m = String(v || "").match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

async function readCompareFile(file) {
  const wb = await XlsxTemplate.Workbook.open(new Uint8Array(await file.arrayBuffer()));
  const keys = new Set();
  const slugs = {};
  let trend = 0;
  let raw = 0;
  let minDate = null;
  let maxDate = null;
  let rows = 0;
  for (const sheet of wb.sheetNames()) {
    const data = await wb.readRows(sheet);
    // 머리글: 첫 5행 안에서 '게시일'·'게시글 위치' 같은 글자가 있는 행
    let dateCol = null;
    for (const r of data.slice(0, 5)) {
      const heads = Object.entries(r.cells).map(([c, v]) => [c, String(v).replace(/\s+/g, "")]);
      if (heads.some(([, v]) => /불만구분|^중복$|^재원$/.test(v))) trend++;
      if (heads.some(([, v]) => /^주요내용$|^커뮤니티명$/.test(v))) raw++;
      const d = heads.find(([, v]) => /^게시일/.test(v));
      if (d && !dateCol) dateCol = d[0];
    }
    for (const r of data) {
      let hit = false;
      for (const v of Object.values(r.cells)) {
        if (typeof v !== "string" || !v.includes("cafe.naver.com")) continue;
        const k = postKey(v);
        if (!k) continue;
        keys.add(k);
        const slug = k.split("/")[0];
        slugs[slug] = (slugs[slug] || 0) + 1;
        hit = true;
      }
      if (!hit) continue;
      rows++;
      const d = dateCol ? excelDate(r.cells[dateCol]) : null;
      if (d) {
        minDate = minDate === null ? d : Math.min(minDate, d);
        maxDate = maxDate === null ? d : Math.max(maxDate, d);
      }
    }
  }
  const kind = trend > raw ? "trend" : raw > trend ? "raw" : /raw|로\s*데이터/i.test(file.name) ? "raw" : "trend";
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, kind, keys: [...keys], slugs, minDate, maxDate, rows };
}

async function addCompareFiles(files) {
  const box = $("#compareInfo");
  box.className = "hint";
  let added = 0;
  for (const [i, file] of [...files].entries()) {
    box.textContent = `파일 읽는 중… (${i + 1}/${files.length}) ${file.name} - 큰 파일은 몇십 초 걸립니다`;
    showBusy(`비교 파일 읽는 중 ${i + 1}/${files.length} · ${file.name}`, i, files.length, "비교 파일 읽는 중");
    try {
      const f = await readCompareFile(file);
      f.keySet = new Set(f.keys);
      compare = compare.filter((x) => x.name !== f.name); // 같은 이름은 바꿔 넣기
      compare.push(f);
      added++;
    } catch (e) {
      box.className = "hint err";
      box.textContent = `${file.name} 을(를) 읽지 못했습니다: ${e.message}`;
      hideBusy();
      return;
    }
  }
  hideBusy();
  compare.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  await saveCompare();
  box.className = "hint ok";
  box.textContent = `✔ ${added}개 파일을 등록했습니다.`;
  $("#compareFiles").value = "";
  renderCompare();
  renderResults();
}

function renderCompare() {
  const tbody = $("#compareTable tbody");
  tbody.innerHTML = "";
  $("#compareTable").hidden = !compare.length;
  const day = (t) => (t === null || t === undefined ? "?" : new Date(t).toISOString().slice(0, 10));
  for (const f of compare) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td><select><option value="trend">온라인 동향</option><option value="raw">로데이터</option></select></td><td></td><td class="nowrap"></td><td><button class="small danger">삭제</button></td>`;
    tr.children[0].textContent = f.name + (f.builtin ? " (미리 등록)" : "");
    const sel = tr.querySelector("select");
    sel.value = f.kind;
    sel.addEventListener("change", async () => {
      f.kind = sel.value;
      await saveCompare();
      renderResults();
    });
    tr.children[2].textContent = `${f.keys.length.toLocaleString()}개`;
    tr.children[3].textContent = `${day(f.minDate)} ~ ${day(f.maxDate)}`;
    tr.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`${f.name} 을(를) 비교 파일에서 뺄까요?`)) return;
      compare = compare.filter((x) => x !== f);
      await saveCompare();
      renderCompare();
      renderResults();
    });
    tbody.appendChild(tr);
  }
  if (!compare.length) $("#compareInfo").textContent = "등록된 비교 파일이 없습니다. 비교 파일이 없으면 포함 여부는 N / N 으로 씁니다.";
}

// → { trend: bool, raw: bool, trendCafe: 이 동호회가 온라인 동향 파일에 나온 적 있는지, trendRange: 게시일이 동향 파일 기간 안인지 }
function inclusion(item) {
  const of = (kind) => compare.filter((f) => f.kind === kind);
  const has = (kind) => of(kind).some((f) => f.keySet.has(item.key));
  const trendFiles = of("trend");
  const slug = item.slug.toLowerCase();
  const min = Math.min(...trendFiles.map((f) => f.minDate ?? Infinity));
  const max = Math.max(...trendFiles.map((f) => f.maxDate ?? -Infinity));
  const d = item.date ? Date.UTC(new Date(item.date).getFullYear(), new Date(item.date).getMonth(), new Date(item.date).getDate()) : null;
  return {
    trend: has("trend"),
    raw: has("raw"),
    trendCafe: trendFiles.some((f) => (f.slugs[slug] || 0) > 0),
    trendRange: !trendFiles.length || d === null || (d >= min && d <= max + 86400000 * 3),
  };
}

const yn = (b) => (b ? "Y" : "N");

// ---------------------------------------------------------------------------
// 3. 본문 읽기 · 요약 · 누락 사유
// ---------------------------------------------------------------------------

async function readBodies() {
  if (running) return;
  const todo = sortedItems().filter((x) => x.checked && !x.bodyRead);
  await saveSettings();
  if (todo.length) {
    if (
      todo.length > 40 &&
      !confirm(`본문을 읽을 글이 ${todo.length}개입니다 (예상 소요 시간 약 ${formatDuration(todo.length * SEC_PER_ARTICLE)}).\n` +
        "많은 글을 한 번에 열면 네이버 보호조치가 걸릴 수 있습니다. 중간에 '중지'로 멈췄다가 나중에 이어서 읽어도 됩니다.\n\n계속할까요?")
    ) return;
    await checkLogin();
    startBusy();
    $("#log").hidden = false;
    const t0 = Date.now();
    let ok = 0;
    for (let i = 0; i < todo.length && !stopRequested; i++) {
      const item = todo[i];
      showBusy(
        `본문 읽는 중 ${i + 1}/${todo.length} · ${item.cafeName}${estimateRemaining(t0, i, todo.length, (todo.length - i) * SEC_PER_ARTICLE)} — 끝날 때까지 이 탭을 닫지 마세요`,
        i, todo.length, "본문 읽는 중",
      );
      setSummary(`본문 읽는 중… (${i + 1}/${todo.length}) ${item.title}`);
      if (i) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
      const res = await readArticleBody(`https://cafe.naver.com/${item.slug}/${item.articleId}`);
      if (res.login) {
        log("✖ 네이버 로그인이 필요합니다 - 로그인한 뒤 다시 누르면 이어서 읽습니다");
        break;
      }
      if (!res.found) {
        item.bodyNote = "본문을 읽지 못함";
        log(`· 본문을 읽지 못함: ${item.title}`);
      } else {
        item.bodyRead = true;
        if (res.locked) item.bodyNote = "멤버 공개 글 - 본문 못 봄";
        else if (res.deleted) item.bodyNote = "삭제된 글";
        else {
          ok++;
          item.body = res.body || "";
          if (res.title) item.title = res.title;
          const parsed = parseCafeDate(res.dateText);
          if (parsed) {
            item.date = parsed.date.getTime();
            item.hasTime = parsed.hasTime;
          }
          const j = judge(item, `${item.title}\n${item.body}`);
          item.related = j.related;
          item.note = judgeNote(j);
          if (!j.related && !item.touched) item.checked = false;
          item.bodyNote = j.related ? "" : `본문 확인: ${item.note}`;
        }
      }
      renderRow(item);
      if (i % 5 === 4) await saveItems();
    }
    await saveItems();
    log(`· 본문 ${ok}개를 읽었습니다 (${formatDuration((Date.now() - t0) / 1000)} 걸림)`);
    endBusy();
  }
  if (!stopRequested) await writeSummaries(false);
  stopRequested = false;
}

// 요약·누락 사유 쓰기 (force: 이미 쓴 글도 다시)
async function writeSummaries(force) {
  const targets = sortedItems().filter((x) => x.checked && (force || !x.summary || x.by !== ($("#aiOn").checked ? "ai" : "rule")));
  if (!targets.length) {
    renderResults();
    setSummary("요약할 글이 없습니다 (체크한 글은 모두 요약했습니다).", "ok");
    return;
  }
  if ($("#aiOn").checked) {
    const key = $("#aiKey").value.trim();
    if (!key) {
      setSummary("Claude AI 로 쓰려면 API 키를 넣어 주세요 (또는 'Claude AI' 체크를 풀면 규칙으로 씁니다).", "err");
      $("#aiKey").focus();
      return;
    }
    const model = $("#aiModel").value;
    const chars = targets.reduce((n, x) => n + Math.min(AI_BODY_CHARS, (x.body || x.text || "").length) + x.title.length + 200, 0);
    const est = AI_MODELS.map(([id, label]) => `· ${label.split(" (")[0]}: 약 ${aiCostWon(chars * 1.1 + 1500 * Math.ceil(targets.length / AI_BATCH), targets.length * 160, id).toLocaleString()}원`).join("\n");
    if (!confirm(`글 ${targets.length}개의 요약·누락 사유를 Claude AI 로 씁니다.\n\n예상 비용 (대략):\n${est}\n\n지금 고른 모델: ${AI_MODELS.find(([id]) => id === model)[1]}\n예상 소요 시간 약 ${formatDuration(Math.ceil(targets.length / AI_BATCH / AI_PARALLEL) * 25)}\n\n계속할까요?`)) return;
    await aiWrite(targets, key, model);
  } else {
    for (const x of targets) writeByRule(x);
    renderResults();
    setSummary(`✔ 글 ${targets.length}개의 요약·누락 사유를 규칙으로 썼습니다. 'Claude AI' 를 켜면 더 자연스럽게 쓸 수 있습니다.`, "ok");
  }
  await saveItems();
}

// 규칙으로 요약: 본문에서 시트·위험 단어가 많은 문장 1~2개
function ruleSummary(item) {
  const src = item.body || item.text || "";
  const rowW = words($("#rowWords").value);
  const riskW = words($("#riskWords").value);
  const sentences = src
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  const scored = sentences.map((s, i) => {
    const c = compactText(s);
    return { s, i, score: (rowW.some((w) => c.includes(w)) ? 1 : 0) + (riskW.some((w) => c.includes(w)) ? 2 : 0) };
  });
  const pick = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  let out = pick.map((x) => x.s).join(" ");
  if (!out) out = item.title;
  return out.length > 150 ? `${out.slice(0, 148)}…` : out;
}

const OUT_OF_RANGE = "비교한 온라인 동향 파일의 기간 밖에 게시된 글로, 해당 기간 동향 파일 확인 필요";

// 규칙으로 누락 사유 (온라인 동향에 없을 때만)
function ruleReason(item, inc) {
  if (inc.trend) return "";
  const t = compactText(`${item.title} ${item.body || item.text}`);
  const any = (list) => list.some((w) => t.includes(w));
  if (!inc.trendRange) return OUT_OF_RANGE;
  if (!inc.trendCafe && !inc.raw) return "해당 동호회가 온라인 동향 모니터링 대상 채널에 포함되지 않아 수집되지 않은 것으로 추정";
  let why;
  if (any(["기사", "뉴스", "보도", "리콜", "공지", "업데이트", "무상수리"])) why = "언론 보도·리콜/업데이트 소식을 공유한 글로 고객 실사용 불만에 해당하지 않아";
  else if (any(["다쳤", "부상", "병원", "피가", "피나", "골절", "멍들", "멍이", "응급", "깁스"]))
    why = "실제 부상 언급은 있으나 경미하고 작동 중 신체 접촉 등 사용 부주의 사례로 판단되어";
  else if (any(["끼었", "끼여", "끼임", "끼인", "낄뻔", "끼일뻔", "아찔", "큰일날", "큰일 날"])) why = "끼임 직전·아차 상황 경험담으로 실제 사고(부상)로 이어지지 않아";
  else if (/[?？]|궁금|문의|되나요|있나요|어떻게|인가요|건가요/.test(`${item.title} ${item.body || item.text}`))
    why = "안전장치·작동 방식에 대한 단순 문의성 글로 품질 불만으로 보기 어려워";
  else if (any(["조심", "주의", "위험", "걱정", "무섭", "무서", "다칠"])) why = "실제 사고 발생이 아닌 사용 시 주의 당부·위험 우려 수준의 글로";
  else why = "시트 기능·편의성 위주의 의견으로 안전 사고와의 관련성이 낮다고 판단되어";
  return inc.raw
    ? `로데이터에는 수집되었으나, ${why} 온라인 동향 보고 대상에서 제외된 것으로 추정`
    : `${why} 품질 이슈로 분류되지 않아 수집되지 않은 것으로 추정`;
}

function writeByRule(item) {
  item.summary = ruleSummary(item);
  item.reason = ruleReason(item, inclusion(item));
  item.by = "rule";
}

// ---------------------------------------------------------------------------
// Claude AI 로 요약·누락 사유 (공식 Anthropic SDK, 전역 Anthropic)
// ---------------------------------------------------------------------------

const AI_SITUATIONS = ["실제 사고", "아차 사고", "위험 우려", "문의", "기사·공지 공유", "관련 없음"];

const AI_SYSTEM = `당신은 현대자동차 품질 부문의 온라인 동향 모니터링 보고서를 검수하는 분석가입니다.
조사 주제: 아이오닉9(ME1)·팰리세이드(LX3)·싼타페(MX5)의 2열·3열 시트를 조작할 때(전동 폴딩·원터치 워크인·슬라이딩·리클라이닝·
복귀 등) 안전 사고가 발생했거나, 발생할 뻔했거나, 발생할 우려·가능성을 언급한 네이버 동호회 게시물.
당신이 쓴 결과는 그대로 사내 보고 엑셀에 들어가므로, 정확성과 일관성이 가장 중요합니다.

[입력] 글마다 id, 차종, 동호회, 게시일, 제목, 본문(없으면 목록의 미리보기), 온라인동향포함, 로데이터포함, 동호회모니터링 을 받습니다.

[출력] 받은 글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다.

1. relevant (true/false): 이 글이 조사 주제에 해당하는지.
   - true: 2·3열 시트 조작(또는 시트 작동) 중 사람·반려동물·물건이 끼이거나 눌리거나 부딪힌 사고, 그럴 뻔한 상황,
     그런 위험에 대한 우려·경고·주의 당부, 끼임 방지·안전 센서 작동에 대한 의문, 관련 리콜·업데이트 소식.
   - false: 1열(운전석·조수석) 시트만의 이야기, 카시트 제품 추천·장착 방법, 시트 소음·가죽·열선·통풍·편의성만의 이야기,
     위험과 무관한 시트 기능 질문, 판매·구매 글, 조사 차종과 무관한 글.
   - 판단이 애매하면 true 로 두고 summary 에 그 사정을 드러냅니다(사람이 최종 검토함).
2. situation: 아래 중 하나.
   "실제 사고"(실제로 끼이거나 다침·파손) / "아차 사고"(끼일 뻔·다칠 뻔) / "위험 우려"(우려·경고·주의 당부, 가능성 언급) /
   "문의"(안전장치·작동 방식 질문) / "기사·공지 공유"(언론 기사·리콜·업데이트 공지 공유) / "관련 없음"(relevant=false 일 때만)
3. summary (주요내용 요약): 한 문장, 40~120자. 사내 온라인 동향 보고서 문체로, "~했다며 ~하는 내용" / "~에 대해 문의하는 내용" 처럼
   "내용" 으로 끝냅니다. 누가(본인·아이·가족 등) · 어떤 시트 조작 중 · 무슨 일이(어디가 끼였는지·다쳤는지·뻔했는지) ·
   글쓴이의 요구·반응(불만·우려·문의·당부)을 글에 있는 만큼만 담습니다.
   예) "3열 탑승 중 2열 전동 시트 원터치 복귀 시 아이의 발이 끼여 멍이 들었다며 끼임 방지 기능 미작동에 대해 불만을 제기하는 내용"
   예) "2열 시트 폴딩 시 센서가 없어 아이 손이 끼일 수 있다며 다른 오너들에게 주의를 당부하는 내용"
   예) "2열 전동 시트 끼임 사고 관련 리콜 기사를 공유하며 업데이트 일정에 대해 문의하는 내용"
   relevant=false 이면 글의 실제 주제를 같은 문체로 한 문장 요약합니다.
4. reason (미포함시 누락 사유):
   - 온라인동향포함=true 이거나 relevant=false 이면 반드시 빈 문자열 "".
   - 그 밖에는 이 글이 온라인 동향 보고에서 빠졌을 그럴듯한 이유를 한 문장(30~90자)으로 쓰고 반드시 "~로 추정" 으로 끝냅니다.
   - 글 내용에 근거한 이유를 고릅니다. 예:
     · 실제 사고가 아닌 사용 시 주의 당부·위험 우려 수준의 글이라 품질 이슈로 분류되지 않은 것으로 추정
     · 끼임 직전의 아차 상황으로 실제 부상·파손이 없어 보고 기준에 미달한 것으로 추정
     · 경미한 부상이나 작동 중 신체를 넣은 사용 부주의 사례로 판단되어 품질 이슈에서 제외된 것으로 추정
     · 안전장치 작동 방식에 대한 단순 문의로 불만·결함 글로 분류되지 않은 것으로 추정
     · 언론 기사·리콜 공지 공유 글로 고객 실사용 불만이 아니어서 제외된 것으로 추정
   - 동호회모니터링=false 이고 로데이터포함=false 이면, 해당 동호회가 모니터링 대상 채널이 아니었을 가능성을 사유로 씁니다.
   - 로데이터포함=true 이면 "로데이터에는 수집되었으나, " 로 시작해 온라인 동향 보고 기준에 못 미친 이유를 씁니다.

[반드시 지킬 것]
- 글에 없는 사실(부상 정도·차량 상태·날짜·정비 결과·글쓴이 신원)을 지어내거나 추측해 단정하지 않습니다.
- 댓글 반응, 글쓴이 닉네임, 개인정보는 쓰지 않습니다. 욕설·과장은 중립적인 말로 바꿉니다.
- 2열·3열을 구분해 글에 쓰인 대로 씁니다(글에 없으면 "뒷좌석 시트" 처럼 글의 표현을 따릅니다).
- 모든 글을 같은 기준·같은 문체로 씁니다. 존댓말 어미나 마침표 없이 "내용" / "추정" 으로 끝냅니다.`;

const AI_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          situation: { type: "string", enum: AI_SITUATIONS },
          summary: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "relevant", "situation", "summary", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function aiCostWon(inTokens, outTokens, model) {
  const [inP, outP] = AI_PRICE[model] || AI_PRICE["claude-opus-5-5"];
  return Math.max(10, Math.round((((inTokens * inP + outTokens * outP) / 1e6) * WON_PER_USD) / 10) * 10);
}

function aiErrorMessage(e) {
  if (typeof Anthropic === "undefined") return "AI 도구를 불러오지 못했습니다";
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없습니다";
  if (e instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다(잠시 후 다시 시도)";
  if (e instanceof Anthropic.APIConnectionError) return "Claude API 에 연결하지 못했습니다(인터넷 확인)";
  if (e instanceof Anthropic.APIError) return `Claude API 오류: ${e.message}`;
  return e && e.message ? e.message : String(e);
}

// 결과 한 건 검사: 형식이 어긋나면 null (그 묶음을 다시 요청)
function checkAiResult(r, inc) {
  if (!r || typeof r.summary !== "string" || typeof r.reason !== "string" || !AI_SITUATIONS.includes(r.situation)) return null;
  const summary = r.summary.replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim();
  let reason = r.reason.replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim();
  if (summary.length < 10) return null;
  if (inc.trend || !r.relevant) reason = "";
  else if (!inc.trendRange) reason = OUT_OF_RANGE; // 비교 파일 기간 밖은 추정하지 않고 확인 필요로
  else if (!reason || !/추정$/.test(reason)) return null;
  return { relevant: !!r.relevant, situation: r.situation, summary, reason };
}

async function aiBatch(client, model, batch, usage) {
  const input = batch.map((x) => {
    const inc = inclusion(x);
    return {
      id: x.key,
      차종: x.car,
      동호회: x.cafeName,
      게시일: x.date ? formatDateTime(new Date(x.date), false) : "",
      제목: x.title,
      본문: (x.body || x.text || "").slice(0, AI_BODY_CHARS),
      본문여부: x.body ? "본문" : "목록 미리보기만 있음",
      온라인동향포함: inc.trend,
      로데이터포함: inc.raw,
      동호회모니터링: inc.trendCafe,
    };
  });
  const params = {
    model,
    max_tokens: 16000,
    system: AI_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{ role: "user", content: `아래 글 ${batch.length}개를 규칙대로 판단해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
  };
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 이 글들의 요약을 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  // 한 건이라도 빠지거나 형식이 어긋나면 묶음 전체를 다시 요청 (반쯤 맞은 결과를 섞지 않음)
  const results = batch.map((x) => checkAiResult(byId.get(x.key), inclusion(x)));
  const bad = results.filter((r) => !r).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  batch.forEach((x, i) => {
    const r = results[i];
    x.summary = r.summary;
    x.reason = r.reason;
    x.situation = r.situation;
    x.aiRelevant = r.relevant;
    x.by = "ai";
    // AI 가 주제와 무관하다고 본 글은 체크를 풀어 둔다 (직접 다시 체크하면 엑셀에 들어감)
    if (!r.relevant && !x.touched) x.checked = false;
  });
}

async function aiWrite(targets, apiKey, model) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const batches = [];
  for (let i = 0; i < targets.length; i += AI_BATCH) batches.push(targets.slice(i, i + AI_BATCH));
  const usage = { input: 0, output: 0 };
  let done = 0;
  let failed = 0;
  let fatal = null;
  let lastError = null;
  const t0 = Date.now();
  startBusy();
  const progress = () =>
    showBusy(`Claude AI 로 요약 중 ${done}/${batches.length}묶음${estimateRemaining(t0, done, batches.length, (batches.length - done) * 25)}`, done, batches.length, "AI 요약 중");
  progress();
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !fatal && !stopRequested) {
      const batch = batches[next++];
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok && !fatal; attempt++) {
        try {
          await aiBatch(client, model, batch, usage);
          ok = true;
        } catch (e) {
          lastError = e;
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
        }
      }
      if (!ok) {
        failed += batch.length;
        for (const x of batch) writeByRule(x);
      }
      done++;
      progress();
      for (const x of batch) renderRow(x);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  endBusy();
  renderResults();
  const cost = aiCostWon(usage.input, usage.output, model);
  const spent = formatDuration((Date.now() - t0) / 1000);
  if (fatal) setSummary(`AI 요약을 하지 못했습니다: ${aiErrorMessage(fatal)} (규칙으로 대신 썼습니다)`, "err");
  else
    setSummary(
      `✔ 글 ${targets.length - failed}개를 Claude AI 로 요약했습니다 · ${spent} 걸림 · 사용한 비용 약 ${cost.toLocaleString()}원 ` +
        `(입력 ${usage.input.toLocaleString()} · 출력 ${usage.output.toLocaleString()} 토큰)` +
        (failed ? ` · ${failed}개는 실패해 규칙으로 썼습니다(${aiErrorMessage(lastError)})` : ""),
      failed ? "err" : "ok",
    );
}

// ---------------------------------------------------------------------------
// 결과 표
// ---------------------------------------------------------------------------

const carOrder = (code) => CARS.findIndex((c) => c.code === code);

// 차종 → 게시일 → 동호회 순
function sortedItems() {
  return [...items].sort((a, b) => carOrder(a.car) - carOrder(b.car) || (a.date ?? Infinity) - (b.date ?? Infinity) || a.cafeIndex - b.cafeIndex);
}

function visibleItems() {
  const car = $("#carFilter").value;
  const view = $("#viewFilter").value;
  return sortedItems().filter((x) => {
    if (car && x.car !== car) return false;
    if (view === "checked") return x.checked;
    if (view === "unchecked") return !x.checked;
    if (view === "missing") return x.checked && !inclusion(x).trend;
    return true;
  });
}

const rowEls = new Map();

function renderResults() {
  const tbody = $("#results tbody");
  tbody.innerHTML = "";
  rowEls.clear();
  $("#resultBox").hidden = !items.length && !running;
  const list = visibleItems();
  const frag = document.createDocumentFragment();
  for (const item of list.slice(0, 1500)) frag.appendChild(buildRow(item));
  tbody.appendChild(frag);
  if (list.length > 1500) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="10" class="hint">… 화면에는 1,500개까지만 보입니다 (위 차종·보기로 좁혀 보세요). 엑셀에는 체크한 글이 모두 들어갑니다.</td>`;
    tbody.appendChild(tr);
  }
  updateCounts();
}

function buildRow(item) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td><input type="checkbox"></td><td class="nowrap"></td><td class="nowrap"></td><td></td><td><a target="_blank" rel="noopener"></a></td>` +
    `<td class="sum"></td><td class="nowrap yn"></td><td class="sum"></td><td class="note"></td><td><button class="small del">삭제</button></td>`;
  tr.querySelector("input").addEventListener("change", (e) => {
    item.checked = e.target.checked;
    item.touched = true;
    tr.className = item.checked ? "" : "off";
    updateCounts();
    saveItemsSoon();
  });
  tr.querySelector(".del").addEventListener("click", () => {
    items = items.filter((x) => x !== item);
    tr.remove();
    rowEls.delete(item.key);
    updateCounts();
    saveItemsSoon();
  });
  rowEls.set(item.key, tr);
  fillRow(tr, item);
  return tr;
}

function fillRow(tr, item) {
  tr.className = item.checked ? "" : "off";
  tr.querySelector("input").checked = item.checked;
  tr.children[1].textContent = item.car;
  tr.children[2].textContent = item.date ? formatDateTime(new Date(item.date), false) : "날짜 모름";
  tr.children[3].textContent = item.cafeName;
  const a = tr.querySelector("a");
  a.href = articleUrl(item);
  a.textContent = item.title;
  a.title = articleUrl(item);
  tr.children[5].textContent = item.summary || "";
  const inc = inclusion(item);
  tr.children[6].innerHTML = `<b class="yn-${inc.trend ? "y" : "n"}">${yn(inc.trend)}</b> / <b class="yn-${inc.raw ? "y" : "n"}">${yn(inc.raw)}</b>`;
  tr.children[7].textContent = item.reason || "";
  const notes = [];
  if (item.bodyNote) notes.push(item.bodyNote);
  else if (item.note) notes.push(item.note);
  if (item.bodyRead && !item.bodyNote) notes.push("본문 읽음");
  if (item.by === "ai") notes.push(`AI: ${item.situation || "요약"}${item.aiRelevant === false ? " (주제와 무관하다고 판단 - 체크 해제)" : ""}`);
  else if (item.by) notes.push("규칙 요약");
  notes.push(`검색어: ${item.queries.join(", ")}`);
  tr.children[8].textContent = notes.join(" · ");
}

function renderRow(item) {
  const tr = rowEls.get(item.key);
  if (tr) fillRow(tr, item);
  updateCounts();
}

function updateCounts() {
  const n = items.filter((x) => x.checked).length;
  const read = items.filter((x) => x.checked && x.bodyRead).length;
  const byCar = CARS.map((c) => `${c.code} ${items.filter((x) => x.checked && x.car === c.code).length}`).join(" · ");
  $("#resultCount").textContent = items.length ? `전체 ${items.length}개 중 ${n}개 체크 (${byCar}) · 본문 읽음 ${read}/${n}` : "";
  $("#saveList").disabled = !n || running;
  $("#readBodies").disabled = !n || running;
  $("#rewrite").disabled = !n || running;
  $("#selDelete").disabled = !n || running;
  $("#selDelete").textContent = n ? `선택 삭제 (${n}개)` : "선택 삭제";
  $("#readBodies").textContent = n - read > 0 ? `본문 읽고 요약하기 (${n - read}개 · 약 ${formatDuration((n - read) * SEC_PER_ARTICLE)})` : "요약하기";
  const vis = visibleItems();
  $("#checkAll").checked = !!vis.length && vis.every((x) => x.checked);
}

// 결과는 이 PC 크롬에 저장해 두어 화면을 다시 열어도 그대로
function saveItems() {
  return chrome.storage.local.set({ seatItems: items }).catch(() => {});
}

let saveTimer = null;
function saveItemsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveItems, 500);
}

// ---------------------------------------------------------------------------
// 엑셀 받기 (첨부 양식: B 순번 · C 차종 · D 동호회명 · E 게시일 · F 제목 · G URL · H 주요내용 요약 · I 포함 여부 · J 누락 사유)
// ---------------------------------------------------------------------------

async function buildExcel(selected) {
  const resp = await fetch(chrome.runtime.getURL("seat-template.xlsx"));
  const wb = await XlsxTemplate.Workbook.open(new Uint8Array(await resp.arrayBuffer()));
  const sheet = wb.sheetNames()[0];
  const values = selected.map((x, i) => {
    const inc = inclusion(x);
    const d = x.date ? new Date(x.date) : null;
    return [
      null, i + 1, x.car, x.cafeName,
      d ? excelSerial(new Date(d.getFullYear(), d.getMonth(), d.getDate())) : "",
      x.title, articleUrl(x), x.summary || ruleSummary(x),
      { runs: [{ text: yn(inc.trend), color: inc.trend ? BLUE : RED, bold: true }, { text: " / " }, { text: yn(inc.raw), color: inc.raw ? BLUE : RED, bold: true }] },
      inc.trend ? "" : x.reason || ruleReason(x, inc),
    ];
  });
  await wb.replaceRowsAfter(sheet, HEADER_ROW, values, STYLE_ROW, { focusFirstNew: true });
  const links = {};
  values.forEach((v, i) => (links[`G${HEADER_ROW + 1 + i}`] = v[6]));
  await wb.addHyperlinks(sheet, links);
  return wb.save();
}

async function saveList() {
  const selected = sortedItems().filter((x) => x.checked);
  if (!selected.length) return;
  const noSummary = selected.filter((x) => !x.summary).length;
  if (noSummary && !confirm(`요약을 아직 쓰지 않은 글이 ${noSummary}개 있습니다. 이 글들은 규칙으로 요약해 넣을까요?\n(취소하면 받지 않습니다 - '본문 읽고 요약하기'를 먼저 눌러 주세요)`)) return;
  if (!compare.length && !confirm("비교 파일(온라인 동향·로데이터)이 등록되지 않아 포함 여부가 모두 N / N 으로 들어갑니다. 계속할까요?")) return;
  $("#saveInfo").className = "hint";
  $("#saveInfo").textContent = "엑셀 만드는 중…";
  try {
    const bytes = await buildExcel(selected);
    const name = datedFileName(OUT_NAME);
    await downloadBytes(bytes, name);
    const miss = selected.filter((x) => !inclusion(x).trend).length;
    $("#saveInfo").className = "hint ok";
    $("#saveInfo").textContent = `✔ ${saveWhereText(await saveOptions())}에 ${name} - 글 ${selected.length}개 (온라인 동향 미포함 ${miss}개)`;
  } catch (e) {
    $("#saveInfo").className = "hint err";
    $("#saveInfo").textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// 작업 중 표시 (진행 막대·나가기 막기는 cafe-common.js 의 showBusy/hideBusy)
// ---------------------------------------------------------------------------

function startBusy() {
  running = true;
  stopRequested = false;
  $("#search").disabled = true;
  $("#stop").disabled = false;
  updateCounts();
}

function endBusy() {
  running = false;
  hideBusy();
  $("#search").disabled = false;
  $("#stop").disabled = true;
  updateCounts();
}

// ---------------------------------------------------------------------------
// 로그인 · 시작
// ---------------------------------------------------------------------------

async function checkLogin() {
  const box = $("#login");
  let ok = false;
  try {
    ok = !!(await chrome.cookies.get({ url: "https://www.naver.com/", name: "NID_AUT" }));
  } catch {
    ok = false;
  }
  box.className = ok ? "login ok" : "login bad";
  if (ok) box.textContent = "네이버 로그인됨 ✓";
  else
    box.innerHTML =
      '카페 글을 찾으려면 네이버 로그인이 필요합니다. <a href="https://nid.naver.com/nidlogin.login" target="_blank">여기서 로그인</a>한 뒤 이 화면으로 돌아오세요.';
  return ok;
}

async function init() {
  await loadSettings();
  $("#endDate").value = ymd(new Date());
  await loadCompare();
  renderCompare();
  for (const c of CARS) $("#carFilter").add(new Option(c.label, c.code));
  const saved = (await chrome.storage.local.get("seatItems").catch(() => ({}))).seatItems || [];
  items = saved;
  renderResults();
  if (items.length) setSummary(`지난번까지 찾은 글 ${items.length}개입니다. '게시물 찾기'를 다시 누르면 새로 찾은 글이 더해집니다.`);

  for (const id of [...SETTING_IDS, "tabFallback", "saveFolder", "saveAsk"]) {
    $(`#${id}`).addEventListener("change", async () => {
      if (id === "searchUrl") $("#searchUrl").value = normalizeSearchUrl($("#searchUrl").value);
      if (id === "saveFolder") $("#saveFolder").value = cleanFolder($("#saveFolder").value);
      await saveSettings();
      if (id === "cafeList") renderCafeInfo();
      if (["queries", "mixedQueries", "maxPages", "carWords"].includes(id)) updateJobInfo();
      if (["rowWords", "riskWords", "exclude", "carWords"].includes(id)) {
        for (const x of items) {
          const j = judge(x, `${x.title} ${x.body || x.text}`);
          x.related = j.related;
          x.note = judgeNote(j);
          if (!x.touched) x.checked = j.related;
        }
        renderResults();
        saveItemsSoon();
      }
    });
  }
  for (const id of ["aiKey", "aiModel", "aiOn"]) $(`#${id}`).addEventListener("change", () => ((($("#aiOpts").hidden = !$("#aiOn").checked)), saveSettings()));
  $("#resetSettings").addEventListener("click", async () => {
    if (!confirm("동호회·검색어·관련 단어 설정을 처음 값으로 되돌릴까요?")) return;
    for (const id of SETTING_IDS) $(`#${id}`).value = SETTING_DEFAULTS[id];
    renderCars({});
    await saveSettings();
  });
  $("#search").addEventListener("click", async () => {
    const r = await loadResume("seat");
    search(r && confirm(`중단된 게시물 찾기가 있습니다 (${r.jobs.length}개 중 ${r.next}개 완료).\n\n· [확인]: 이어서 찾기\n· [취소]: 처음부터 다시 찾기`) ? r : null);
  });
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 보는 화면까지 마칩니다)");
  });
  $("#compareFiles").addEventListener("change", (e) => e.target.files.length && addCompareFiles(e.target.files));
  $("#carFilter").addEventListener("change", renderResults);
  $("#viewFilter").addEventListener("change", renderResults);
  const setVisible = (fn) => {
    for (const x of visibleItems()) {
      x.checked = fn(x);
      x.touched = true;
    }
    renderResults();
    saveItemsSoon();
  };
  $("#selAll").addEventListener("click", () => setVisible(() => true));
  $("#selNone").addEventListener("click", () => setVisible(() => false));
  $("#checkAll").addEventListener("change", (e) => setVisible(() => e.target.checked));
  $("#selDelete").addEventListener("click", async () => {
    const n = items.filter((x) => x.checked).length;
    if (!n || !confirm(`체크한 게시물 ${n}개를 목록에서 삭제할까요?`)) return;
    items = items.filter((x) => !x.checked);
    renderResults();
    await saveItems();
  });
  $("#clearAll").addEventListener("click", async () => {
    if (!items.length || !confirm(`찾은 글 ${items.length}개(읽은 본문·요약 포함)를 모두 지울까요?`)) return;
    items = [];
    await clearResume("seat");
    renderResults();
    await saveItems();
  });
  $("#readBodies").addEventListener("click", readBodies);
  $("#rewrite").addEventListener("click", () => !running && writeSummaries(true));
  $("#saveList").addEventListener("click", saveList);
  $("#diag").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, at: new Date().toString(), diagnostics }, null, 1)], { type: "application/json" });
    clickDownload(blob, `${today()}_시트위험_진단.json`);
  });
  window.addEventListener("focus", checkLogin);
  checkLogin();
  // 중단된 찾기가 있으면 이어서 할지 묻는다
  const r = await loadResume("seat");
  if (r && confirm(`중단된 게시물 찾기가 있습니다 (동호회·검색어 ${r.jobs.length}개 중 ${r.next}개 완료 · ${new Date(r.at).toLocaleString()}).\n\n· [확인]: 이어서 찾기\n· [취소]: 나중에 ('게시물 찾기'를 누르면 다시 물어봄)`)) search(r);
}

// 위쪽 '⚙ 설정' 버튼(seat.html#settings): 설정을 펼치고 그 위치로
function openSettingsFromHash() {
  if (location.hash !== "#settings") return;
  $("#settings").open = true;
  $("#settings").scrollIntoView({ block: "start", behavior: "smooth" });
}
window.addEventListener("hashchange", openSettingsFromHash);

init().then(openSettingsFromHash);
