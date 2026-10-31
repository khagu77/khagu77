// LX3 팰리세이드 전동 시트 관련 - 동호회(네이버 카페)에서 검색어('시트')로 찾은 글 중
// 정한 시간(기본: 직전 근무일 오전 11:30 ~ 당일 오전 11:30, 설정에서 저장한 시각)에 올라온 관련 글을 추려 '채널별 버즈량 현황' 엑셀로 받고,
// 그 글들(과 저장해 둔 유튜브 영상)의 댓글 수집으로 바로 넘긴다.
// 네이버는 API 를 부르지 않고 검색 화면·게시글을 탭으로 열어 화면에 보이는 내용만 읽는다(cafe-common.js).

const DEFAULT_CAFES = [
  16624720, 10050004, 19934815, 10633813, 20179506, 21771803, 16598058, 31522344, 23756663, 22267088, 12025661, 25538910,
].map((id) => `https://cafe.naver.com/f-e/cafes/${id}/menus/0`);
const DEFAULT_QUERY = "시트";
// 기본 유튜브 영상 목록 (화면에서 추가·삭제하면 그 목록이 저장되어 계속 쓰임)
const DEFAULT_YOUTUBE = [
  "qCzKGyMaDq4",
  "XBMdMt_QCCc",
  "4RBKMiM7U2U",
  "vUDDF-qIHc8",
  "8nD5NuYU78Q",
  "e0HLk5TohDc",
  "zHKmLScJwmQ",
  "1ZTBkyUWVsk",
  "c0BjmtN0U4g",
  "_JCP2fRFMDA",
  "Ul8LAQ6SL5o",
  "SUcSFeNftzg",
  "vYGVhHMIiwM",
  "Gw8QlbmzHY8",
  "LlVeeM8i9r8",
  "Oxhnyr4nchQ",
  "Ya7tNSCWHKQ",
  "JQ0328NfbWc",
  "Z_IMxiszGII",
  "GtWQuSuVazI",
  "ceSOHGdclns",
  "fxKieGRWEd8",
  "Ee0tytsS_Ks",
].map((id) => `https://www.youtube.com/watch?v=${id}`);
const DEFAULT_INCLUDE =
  "전동시트, 전동 시트, 끼임, 끼여, 끼었, 끼인, 끼이, 폴딩, 접이, 접힘, 접히, 사망, 리콜, 원터치, 업데이트, 업뎃, 판매 중단, 결함, 간담회, 2열, 3열";
const DEFAULT_EXCLUDE = "카시트, 시트커버, 시트지, 열선, 통풍, 썬팅, 틴팅";
const DEFAULT_SEARCH_URL = "https://cafe.naver.com/f-e/cafes/{cafeId}/menus/0?viewType=L&ta=ARTICLE_COMMENT&page={page}&q={q}";
const DEFAULT_MAX_PAGES = 5;
const SHEET_NAME = "채널별 버즈량 현황";
const HEADER_ROW = 3; // 양식: 3행 머리글(B 순번 · C 채널 · D 매체명 · E 게시일 · F 제목 · G URL)
const DEFAULT_LIST_NAME = "팰리세이드 전동시트 관련 채널별 버즈량 현황.xlsx";

let items = []; // { key, cafeId, cafeIndex, articleId, slug, title, text, date, hasTime, ambiguous, checked, note, dup }
let stopRequested = false;
let running = false;
let listFile = null; // 직접 고른 파일 { name, bytes, urls:Set, info }
let dbBase = null; // 최종 DB 의 게시물 리스트 (기본: 가장 최근, '이어서 작성'에서 고른 날짜) { name, bytes, urls, info, date, rangeEnd }
let accum = null; // 아직 최종 저장('엑셀 받기') 안 한 찾기 결과의 기간 { from, to } (ms) — 휴일 등에 미리 찾아 둔 것
let baseChoice = ""; // '이어서 작성' 선택: "" = 최종 DB 가장 최근 · "db:<key>" = 그 날짜 · "file" = 직접 고른 엑셀

// 이어 쓸 파일: 직접 고른 파일 > 최종 DB 파일 ('별도 파일로 작성'이면 없음 → 새 파일)
function separateFile() {
  return !!$("#separate")?.checked;
}

function baseFile() {
  if (separateFile()) return null;
  return baseChoice === "file" && listFile ? listFile : dbBase;
}

// 최종 DB 의 게시물 리스트 불러오기 (key 없으면 가장 최근)
async function loadDbBase(key = null) {
  dbBase = null;
  try {
    const rec = key ? (await dbList("buzz")).find((r) => r.key === key) : await dbLatest("buzz");
    if (rec) {
      const info = await analyzeList(await XlsxTemplate.Workbook.open(rec.bytes));
      dbBase = { name: rec.name, bytes: rec.bytes, info, urls: info.urls, date: rec.date, key: rec.key, rangeEnd: rec.rangeEnd || null };
    }
  } catch {
    dbBase = null;
  }
}

// '이어서 작성' 목록 다시 채우기
async function refreshBaseSelect() {
  const v = await fillBaseSelect($("#baseSelect"), "buzz", baseChoice === "" && dbBase ? `db:${dbBase.key}` : baseChoice, listFile?.name);
  baseChoice = v === "file" ? "file" : baseChoice === "" ? "" : v;
  $("#clearListFile").hidden = !listFile;
}

// '이어서 작성'에서 고름: 그 엑셀 뒤에 이어 쓰고, 최종 DB 기록이면 찾기 시작을 그 기록이 끝난 시각으로
async function onBaseSelect() {
  const v = $("#baseSelect").value;
  baseChoice = v;
  if (v.startsWith("db:")) await loadDbBase(v.slice(3));
  if (v.startsWith("db:") && dbBase?.rangeEnd && !running) {
    const start = new Date(dbBase.rangeEnd);
    if (start < new Date($("#to").value)) {
      $("#from").value = toLocalInput(start);
      $("#rangeInfo").textContent = `이어서 작성: 찾기 시작을 그 파일의 수집 끝 ${formatDateTime(start)}로 맞췄습니다.`;
    }
  }
  showBaseInfo();
  markDuplicates();
  renderResults();
}

// 기존 파일 칸 아래 안내: 무엇에 이어 쓰는지
function showBaseInfo() {
  const box = $("#listFileInfo");
  const base = baseFile();
  if (separateFile()) {
    box.className = "hint";
    box.textContent = `'별도 파일로 작성': 이번에 고른 글만 담은 새 파일(순번 1부터)로 받고, 최종 DB에는 넣지 않습니다 (${datedFileName(rememberedListName())}).`;
  } else if (base) {
    box.className = "hint ok";
    box.textContent =
      `✔ ${base === dbBase ? `최종 DB 파일(${prettyDate(base.date)} · ${base.name})` : base.name}의 '${base.info.sheet}' 시트 ` +
      `${base.info.count.toLocaleString()}행(마지막 순번 ${base.info.lastSerial.toLocaleString()}) 다음부터 이어 씁니다. ` +
      `이미 있는 글은 체크를 풀어 둡니다. 받을 파일: ${datedFileName(base.name)}` +
      (base === dbBase ? " (엑셀에서 고친 파일이 있으면 '최종 DB' 메뉴에서 그 날짜에 수정본을 올리세요)" : "");
  } else {
    box.className = "hint";
    box.textContent = `최종 DB에 파일이 없습니다. 지금까지의 최종 파일을 고르면 이어 쓰고(최종 DB에도 저장), 고르지 않으면 새 파일로 받습니다 (${datedFileName(rememberedListName())}).`;
  }
}
let cafeSlugs = {};
let cafeNames = {};
let lastSaved = null;
let lastFailed = { ids: [], queries: [], boards: [] }; // 지난 찾기에서 못 읽은 동호회·언론 검색어·커뮤니티 게시판 (다시 찾기용)
let lastKw = {}; // 지난 찾기의 언론·커뮤니티 키워드
let lastSearchAt = 0;
let lastRange = {};
let diagnostics = []; // 글을 못 읽은 화면의 구조 (진단 파일)

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["lx3Holidays", "saveFolder", "saveAsk", "lx3TabFallback", "lx3Cafes", "lx3Query", "lx3Include", "lx3Exclude", "lx3SearchUrl", "lx3MaxPages", "lx3CafeNames", "lx3Youtube",
      "lx3Channels", "lx3MainKw", "lx3SubKw", "lx3Boards", "lx3NewsPages", "lx3BaseTimes"])
    .catch(() => ({}));
  $("#cafeList").value = (s.lx3Cafes || DEFAULT_CAFES).join("\n");
  $("#query").value = s.lx3Query ?? DEFAULT_QUERY;
  $("#include").value = s.lx3Include ?? DEFAULT_INCLUDE;
  $("#exclude").value = s.lx3Exclude ?? DEFAULT_EXCLUDE;
  $("#searchUrl").value = s.lx3SearchUrl || DEFAULT_SEARCH_URL;
  $("#maxPages").value = s.lx3MaxPages || DEFAULT_MAX_PAGES;
  $("#tabFallback").checked = s.lx3TabFallback ?? true;
  $("#saveFolder").value = s.saveFolder || "";
  $("#saveAsk").checked = !!s.saveAsk;
  $("#holidays").value = s.lx3Holidays || "";
  if (s.lx3BaseTimes?.from && s.lx3BaseTimes?.to) baseTimes = { from: s.lx3BaseTimes.from, to: s.lx3BaseTimes.to };
  const ch = s.lx3Channels || {};
  $("#chCafe").checked = ch.cafe ?? true;
  $("#chNews").checked = ch.news ?? true;
  $("#chCommunity").checked = ch.community ?? true;
  $("#mainKw").value = s.lx3MainKw ?? DEFAULT_MAIN_KEYWORDS;
  $("#subKw").value = s.lx3SubKw ?? DEFAULT_SUB_KEYWORDS;
  $("#boards").value = (s.lx3Boards || DEFAULT_BOARDS).join("\n");
  $("#newsPages").value = s.lx3NewsPages || DEFAULT_NEWS_PAGES;
  cafeNames = Object.fromEntries(Object.entries(s.lx3CafeNames || {}).map(([k, v]) => [k, cleanCafeName(v)]));
  cafeSlugs = await loadCafeSlugs();
  youtube = s.lx3Youtube || [...DEFAULT_YOUTUBE];
}

function saveSettings() {
  return chrome.storage.local
    .set({
      lx3Cafes: $("#cafeList").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      lx3Query: $("#query").value.trim(),
      lx3Include: $("#include").value,
      lx3Exclude: $("#exclude").value,
      lx3SearchUrl: normalizeSearchUrl($("#searchUrl").value),
      lx3MaxPages: Math.max(1, Math.min(20, Number($("#maxPages").value) || DEFAULT_MAX_PAGES)),
      lx3TabFallback: $("#tabFallback").checked,
      saveFolder: cleanFolder($("#saveFolder").value),
      saveAsk: $("#saveAsk").checked,
      lx3Holidays: $("#holidays").value,
      lx3Channels: { cafe: $("#chCafe").checked, news: $("#chNews").checked, community: $("#chCommunity").checked },
      lx3MainKw: $("#mainKw").value,
      lx3SubKw: $("#subKw").value,
      lx3Boards: boardList(),
      lx3NewsPages: Math.max(1, Math.min(10, Number($("#newsPages").value) || DEFAULT_NEWS_PAGES)),
    })
    .catch(() => {});
}

// 자동차 커뮤니티 게시판 목록 (보배드림·클리앙·뽐뿌 주소만)
function boardList() {
  const out = [];
  for (const line of $("#boards").value.split(/\r?\n/)) {
    const u = line.trim();
    if (u && communityAdapter(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

// 동호회 목록 한 줄 → 카페 번호
function cafeIdOf(line) {
  const s = String(line).trim();
  const m = s.match(/\/cafes\/(\d+)/) || s.match(/clubid=(\d+)/i) || s.match(/^(\d{4,})$/);
  return m ? m[1] : null;
}

function cafeIds() {
  const ids = [];
  for (const line of $("#cafeList").value.split(/\r?\n/)) {
    const id = cafeIdOf(line);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// 직접 검색한 주소를 붙여 넣어도 되도록: 카페 번호·검색어·페이지 자리를 {cafeId} {q} {page} 로 바꾼다
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

function words(text) {
  return String(text || "")
    .split(/[,\n]/)
    .map((w) => compactText(w))
    .filter(Boolean);
}

function compactText(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

function isRelated(item) {
  const text = compactText(`${item.title} ${item.text}`);
  const inc = words($("#include").value).some((w) => text.includes(w));
  const exc = words($("#exclude").value).some((w) => text.includes(w));
  return inc && !exc;
}

// 카페 화면 제목 → 동호회 명 ('전체글보기,카페이름 : 네이버 카페' 처럼 메뉴 이름이 앞에 붙는 경우도)
function cleanCafeName(title) {
  return cafeNameFromTitle(title).replace(/^\s*(?:전체글보기|전체\s*글|검색\s*결과|인기글)\s*[,:|]\s*/, "").trim();
}

function renderCafeInfo() {
  const tbody = $("#cafeInfo tbody");
  tbody.innerHTML = "";
  cafeIds().forEach((id, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td></td><td></td><td><input type="text" class="slug" spellcheck="false" placeholder="예: allfm01"></td>`;
    tr.children[1].textContent = id;
    tr.children[2].textContent = cafeNames[id] || "(찾기 후 자동)";
    const input = tr.querySelector("input");
    input.value = cafeSlugs[id] || "";
    input.addEventListener("change", async () => {
      const v = input.value.trim();
      if (v && !isSlug(v)) {
        input.value = cafeSlugs[id] || "";
        return;
      }
      if (v) await saveCafeSlug(id, v);
      else {
        delete cafeSlugs[id];
        await chrome.storage.local.set({ cafeSlugs }).catch(() => {});
      }
      cafeSlugs = await loadCafeSlugs();
      renderResults();
    });
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// 시간 범위 (기본: 직전 근무일 오전 11:30 ~ 당일 오전 11:30 — 저장한 기본 시각, 새로고침하면 다시 기본값)
// ---------------------------------------------------------------------------

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function extraHolidays() {
  return parseExtraHolidays($("#holidays")?.value || "");
}

function isOffDay(d, extra = extraHolidays()) {
  return isHoliday(d, extra);
}

// 기본 시각 (시작·끝, "HH:MM"). '이 시각을 기본으로 저장'으로 바꿀 수 있다
const DEFAULT_BASE_TIMES = { from: "11:30", to: "11:30" };
let baseTimes = { ...DEFAULT_BASE_TIMES };

function hm(text) {
  const m = String(text || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? [Number(m[1]), Number(m[2])] : [11, 30];
}

// "오전 11:30" · "오후 12시"
function timeLabel(text) {
  const [h, m] = hm(text);
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}${m ? `:${pad(m)}` : "시"}`;
}

// 기본 시간: 직전 근무일 기본 시각 ~ 오늘 기본 시각 (사이의 주말·공휴일은 건너뜀)
// 예) 월요일 → 금요일 11:30 ~ 월요일 11:30, 추석 연휴 다음 날 → 연휴 전 마지막 근무일 11:30부터
function defaultRange(now = new Date()) {
  const extra = extraHolidays();
  const [th, tm] = hm(baseTimes.to);
  const [fh, fm] = hm(baseTimes.from);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), th, tm);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const skipped = [];
  for (let i = 0; i < 31 && isOffDay(day, extra); i++) {
    skipped.unshift(new Date(day));
    day.setDate(day.getDate() - 1);
  }
  return { from: new Date(day.getFullYear(), day.getMonth(), day.getDate(), fh, fm), to, skipped };
}

const WEEKDAY = "일월화수목금토";
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]})`;

function resetRange(now = new Date()) {
  const { from, to, skipped } = defaultRange(now);
  $("#from").value = toLocalInput(from);
  $("#to").value = toLocalInput(to);
  showBaseTimes();
  $("#rangeInfo").textContent =
    `기본 시간: ${md(from)} ${timeLabel(baseTimes.from)} ~ ${md(to)} ${timeLabel(baseTimes.to)}` + (skipped.length ? ` (휴일 ${skipped.map(md).join(", ")} 포함)` : "");
  // 미리 찾아 둔 결과에 이어서: 찾기 시작을 그 결과의 끝 시각으로
  if (continuing()) {
    const start = new Date(accum.to);
    let end = to;
    // 같은 날 다시 이어 찾으면(기본 끝 시각까지 이미 찾아 둠) 지금까지
    if (accum.to >= to.getTime()) {
      end = new Date(now);
      end.setSeconds(0, 0);
    }
    if (start < end) {
      $("#from").value = toLocalInput(start);
      $("#to").value = toLocalInput(end);
      $("#rangeInfo").textContent += ` → 미리 찾아 둔 결과에 이어서 ${md(start)} ${timeLabel(toLocalInput(start).slice(11))}부터`;
    }
  }
}

// 미리 찾아 둔(아직 최종 저장 안 한) 결과에 이어서 찾는지
function continuing() {
  return !!accum && $("#continueAccum")?.checked !== false && items.some((x) => !x.saved);
}

// 위 안내: 미리 찾아 둔 결과
function updateAccumInfo() {
  const box = $("#accumBox");
  if (!box) return;
  const pending = items.filter((x) => !x.saved).length;
  box.hidden = !accum || !pending;
  if (box.hidden) return;
  const f = new Date(accum.from);
  const t = new Date(accum.to);
  $("#accumInfo").textContent =
    `미리 찾아 둔 글 ${pending}개 (${md(f)} ${timeLabel(toLocalInput(f).slice(11))} ~ ${md(t)} ${timeLabel(toLocalInput(t).slice(11))})가 있습니다. ` +
    `이어서 찾으면 그 뒤부터 찾아 결과 표에 붙고, 근무일에 '엑셀 받기'로 한 파일에 저장한 뒤 '댓글 수집하기'로 전체 댓글을 모읍니다.`;
}

// 안내 문구에 지금 기본 시각
function showBaseTimes() {
  const f = timeLabel(baseTimes.from);
  const t = timeLabel(baseTimes.to);
  $("#baseText").textContent = `직전 근무일 ${f} ~ 오늘 ${t}`;
  $("#baseFrom").textContent = f;
  $("#resetRange").title = `직전 근무일 ${f} ~ 오늘 ${t}`;
}

// 지금 시작·끝 칸의 시각을 기본 시각으로 저장 (날짜는 그대로 '직전 근무일 ~ 오늘')
async function saveBaseTimes() {
  const from = $("#from").value.slice(11, 16);
  const to = $("#to").value.slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    $("#rangeInfo").textContent = "시작·끝 시각을 먼저 넣어 주세요.";
    return;
  }
  baseTimes = { from, to };
  await chrome.storage.local.set({ lx3BaseTimes: baseTimes }).catch(() => {});
  resetRange();
  $("#rangeInfo").textContent = `✔ 기본 시각을 저장했습니다 (시작 ${timeLabel(from)} · 끝 ${timeLabel(to)}). ` + $("#rangeInfo").textContent;
}

function range() {
  const from = new Date($("#from").value);
  const to = new Date($("#to").value);
  if (isNaN(from) || isNaN(to) || from >= to) throw new Error("시작·끝 시간을 확인해 주세요.");
  return { from, to };
}

// 글 날짜가 범위 안인지: "in" / "older"(범위보다 이전) / "newer" / "ambiguous"(날짜만 있어 시간 확인 필요)
function placeInRange(parsed, { from, to }) {
  if (!parsed) return "ambiguous";
  const d = parsed.date;
  if (parsed.hasTime) return d < from ? "older" : d >= to ? "newer" : "in";
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (dayEnd <= from) return "older";
  if (dayStart >= to) return "newer";
  if (dayStart >= from && dayEnd <= to) return "in";
  return "ambiguous";
}

// ---------------------------------------------------------------------------
// 화면에서 읽기 (각 프레임 안에서 실행 - 혼자 동작해야 함)
// ---------------------------------------------------------------------------

// 게시글 화면: 글쓴 날짜·시간
function readArticleInFrame() {
  const re = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2})/;
  for (const el of document.querySelectorAll(".article_info .date, .ArticleWriterProfile .date, .WriterInfo .date, [class*='article'] .date, .date")) {
    const m = (el.innerText || "").match(re);
    if (m) return { found: true, dateText: m[0], href: location.href };
  }
  const box = document.querySelector(".ArticleContentBox, .article_header, #app, body");
  const m = box && (box.innerText || "").match(re);
  return m ? { found: true, dateText: m[0], href: location.href } : { found: false, href: location.href };
}

// ---------------------------------------------------------------------------
// 찾기
// ---------------------------------------------------------------------------

function log(text) {
  const box = $("#log");
  box.hidden = false;
  const line = document.createElement("div");
  line.textContent = text;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

async function scanSearchPage(url) {
  // 창·탭을 띄우지 않고 수집 화면 안의 보이지 않는 틀에서 읽는다
  const res = await scanSearchPageIn(url, "frame").catch(() => ({ items: [], noResult: false, login: false, title: "", hints: [] }));
  // 화면을 아예 못 읽었을 때만(설정 시) 뒤쪽 탭으로 한 번 더. '검색 결과 없음'이 보이면 정말 없는 것이라 탭을 열지 않는다
  if (!res.items.length && !res.noResult && !res.login && $("#tabFallback").checked) {
    log("  ↳ 숨긴 화면에서 글을 못 읽어 뒤쪽 탭으로 다시 확인합니다");
    const again = await scanSearchPageIn(url, "tab");
    again.retried = true;
    return again;
  }
  return res;
}

async function scanSearchPageIn(url, mode) {
  return withTab(url, async (tabId) => {
    let last = { items: [], noResult: false, login: false, title: "", hints: [] };
    let emptyInRow = 0;
    for (let i = 0; i < 14; i++) {
      const frames = await runInFrames(tabId, scanSearchInFrame);
      const items = frames.flatMap((f) => f.items || []);
      last = {
        items,
        noResult: frames.some((f) => f.noResult),
        login: frames.some((f) => /nid\.naver\.com/.test(f.href || "")),
        title: frames.find((f) => f.top)?.title || "",
      };
      if (items.length || last.login) break;
      emptyInRow = last.noResult ? emptyInRow + 1 : 0;
      if (emptyInRow >= 4) break; // '검색 결과 없음'이 6초 넘게 그대로면 정말 없는 것
      await sleep(1500);
    }
    if (!last.items.length && !last.login) last.snapshot = await runInFrames(tabId, snapshotInFrame);
    last.hints = await runInFrames(tabId, cafeSlugHintsInFrame);
    if (!last.title) last.title = last.hints.find((h) => h.top)?.title || "";
    return last;
  }, { mode });
}

// 못 읽은 화면 요약 (로그에 그대로 보이게)
function snapshotSummary(snap) {
  if (!snap?.length) return "";
  const top = snap.find((f) => f.top) || snap[0];
  const textLen = snap.reduce((n, f) => n + (f.text || "").length, 0);
  const links = snap.reduce((n, f) => n + (f.counts?.a || 0), 0);
  return ` [프레임 ${snap.length}개 · 글자 ${textLen}자 · 링크 ${links}개 · 목록 줄 ${snap.reduce((n, f) => n + (f.counts?.rows || 0), 0)}개 · 탭 ${top.visibility}]`;
}

async function readArticleTime(url) {
  const res = await readArticleTimeIn(url, "frame").catch(() => ({ found: false }));
  if (!res.found && !res.login && $("#tabFallback").checked) return readArticleTimeIn(url, "tab");
  return res;
}

async function readArticleTimeIn(url, mode) {
  return withTab(url, async (tabId) => {
    for (let i = 0; i < 8; i++) {
      const frames = await runInFrames(tabId, readArticleInFrame);
      const hit = frames.find((f) => f.found);
      if (hit) return { ...hit, hints: await runInFrames(tabId, cafeSlugHintsInFrame) };
      if (frames.some((f) => /nid\.naver\.com/.test(f.href || ""))) return { found: false, login: true };
      await sleep(1500);
    }
    return { found: false };
  }, { mode });
}

function articleUrl(item) {
  if (!isCafeItem(item)) return item.url;
  const slug = cafeSlugs[item.cafeId] || item.slug;
  return slug ? shortArticleUrl(slug, item.articleId) : `https://cafe.naver.com/f-e/cafes/${item.cafeId}/articles/${item.articleId}`;
}

// 언론·커뮤니티 글인지 (채널 표시가 없으면 예전에 찾은 동호회 글)
function isCafeItem(x) {
  return !x.channel || x.channel === "동호회";
}

function hostName(url) {
  const u = safeUrl(url);
  return u ? u.hostname.replace(/^www\./, "") : "";
}

// 찾기: 언론(네이버 뉴스 검색) → 자동차 커뮤니티(게시판 목록) → 동호회(카페 안 검색) 차례로.
// resume: 중단된 찾기 이어하기 / '못 읽은 곳 다시 찾기' (retry) 상태
async function search(resume = null) {
  if (running) return;
  if (resume) {
    $("#from").value = resume.from;
    $("#to").value = resume.to;
    if (resume.q) $("#query").value = resume.q;
  }
  let win;
  try {
    win = range();
  } catch (e) {
    return setSummary(e.message, "err");
  }
  const on = { cafe: $("#chCafe").checked, news: $("#chNews").checked, community: $("#chCommunity").checked };
  const mainKw = resume ? resume.mainKw ?? $("#mainKw").value : $("#mainKw").value;
  const subKw = resume ? resume.subKw ?? $("#subKw").value : $("#subKw").value;
  const ids = resume ? resume.ids || [] : on.cafe ? cafeIds() : [];
  const queries = resume ? resume.queries || [] : on.news ? keywordQueries(mainKw, subKw) : [];
  const boards = resume ? resume.boards || [] : on.community ? boardList() : [];
  const q = $("#query").value.trim();
  if (!resume?.retry) {
    if (!on.cafe && !on.news && !on.community) return setSummary("찾을 곳(동호회·언론·자동차 커뮤니티)을 하나 이상 고르세요.", "err");
    if (on.cafe && !ids.length && !resume) return setSummary("동호회 목록에 카페 주소를 넣어 주세요.", "err");
    if (on.news && !queries.length && !resume) return setSummary("설정에 언론·자동차 커뮤니티 메인 키워드를 넣어 주세요.", "err");
    if (on.community && !boards.length && !resume) return setSummary("설정에 자동차 커뮤니티 게시판 주소를 넣어 주세요.", "err");
  }
  if (ids.length && !q) return setSummary("동호회 검색어를 넣어 주세요.", "err");
  await saveSettings();
  if (ids.length) await checkLogin();
  running = true;
  markRunning(true);
  stopRequested = false;
  $("#search").disabled = true;
  $("#stop").disabled = false;
  $("#log").innerHTML = "";
  diagnostics = [];
  $("#diag").hidden = true;
  // 새로 찾아도 직접 넣은 유튜브 새 콘텐츠는 남긴다
  // 미리 찾아 둔(최종 저장 안 한) 결과에 이어서면 결과 표를 비우지 않고 이어 붙인다. 아니면 새로 (직접 넣은 유튜브 새 콘텐츠만 남김)
  const cont = !resume && continuing();
  items = resume
    ? resume.items.map((x) => ({ ...x, date: x.date ? new Date(x.date) : null }))
    : cont
      ? items.filter((x) => !x.saved)
      : items.filter((x) => x.channel === "유튜브" && !x.saved);
  if (!cont && !resume) accum = null;
  renderResults();
  const maxPages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  const newsPages = Math.max(1, Number($("#newsPages").value) || DEFAULT_NEWS_PAGES);
  const seen = new Set(items.flatMap((x) => [x.key, x.extUrl ? channelKey(x.extUrl) : ""]).filter(Boolean));
  let loginNeeded = false;
  // 어디까지 했는지 (중단되면 여기부터 이어서)
  const pos = { query: resume?.nextQuery || 0, board: resume?.nextBoard || 0, cafe: resume?.nextCafe || 0 };
  const checkpoint = () =>
    saveResume("lx3", {
      from: $("#from").value, to: $("#to").value, q, ids, nextCafe: pos.cafe, queries, nextQuery: pos.query, boards, nextBoard: pos.board,
      mainKw, subKw, items: items.map(serializeItem),
    });
  const failed = { ids: [], queries: [], boards: [] };
  const total = ids.length + queries.length + boards.length;
  const doneSteps = () => pos.query + pos.board + pos.cafe;
  if (cont) log(`· 미리 찾아 둔 글 ${items.length}개에 이어서 찾습니다 (같은 글은 한 번만)`);
  if (resume?.retry) log(`· 못 읽은 곳을 다시 찾습니다 (${whereText({ ids, queries, boards })} · 이미 찾은 글 ${items.length}개는 그대로)`);
  else if (resume) log(`· 중단된 곳부터 이어서 찾습니다 (이미 찾은 글 ${items.length}개)`);
  $("#retryCafes").hidden = true;
  const addItem = (item) => {
    item.related = isRelated(item);
    item.checked = item.related;
    items.push(item);
  };

  // 1) 언론: 메인 × 서브 키워드 조합마다 네이버 뉴스 검색 (기간 지정 · 최신순)
  for (; pos.query < queries.length && !stopRequested; pos.query++) {
    const nq = queries[pos.query];
    setSummary(`찾는 중… 언론 ${pos.query + 1}/${queries.length} ("${nq}")`);
    showBusy(`게시물 찾는 중 · 언론 검색 ${pos.query + 1}/${queries.length} ("${nq}") — 끝날 때까지 이 탭을 닫지 마세요`, doneSteps(), total, "게시물 찾는 중");
    let prevKeys = "";
    for (let page = 1; page <= newsPages && !stopRequested; page++) {
      let found;
      try {
        found = parseNewsSearch(await fetchText(newsSearchUrl(nq, win, page), { credentials: "include" }));
      } catch (e) {
        log(`✖ 언론 "${nq}" ${page}페이지: 검색 화면을 받지 못함 (${e.message})`);
        failed.queries.push(nq);
        break;
      }
      const keys = found.map((x) => x.aid || x.extUrl).join(",");
      if (!found.length || keys === prevKeys) {
        if (page === 1) log(`· 언론 "${nq}": 검색 결과 없음`);
        break;
      }
      prevKeys = keys;
      let added = 0;
      let older = 0;
      for (const x of found) {
        const parsed = parseKoreanDate(x.dateText);
        const place = placeApprox(parsed, win);
        if (place === "older") older++;
        if (place === "older" || place === "newer") continue;
        const url = x.aid ? newsUrl(x) : x.extUrl;
        const key = channelKey(url);
        const extKey = x.extUrl ? channelKey(x.extUrl) : "";
        if (seen.has(key) || (extKey && seen.has(extKey))) continue;
        seen.add(key);
        if (extKey) seen.add(extKey);
        addItem({
          key, channel: "언론", media: x.press || hostName(x.extUrl), url, naverUrl: x.aid ? url : "", extUrl: x.extUrl || "",
          title: x.title, text: x.snippet || "", date: parsed ? parsed.date : null, hasTime: !!parsed?.hasTime,
          approx: !!parsed?.approxMs, ambiguous: place === "ambiguous", checked: false, note: "", dup: false,
        });
        added++;
      }
      log(`· 언론 "${nq}": ${page}페이지 기사 ${found.length}건 중 기간 안 새 기사 ${added}건`);
      renderResults();
      if (older === found.length || found.length < 10) break; // 최신순이라 모두 기간 이전이면 다음 페이지는 더 이전
      await sleep(randomBetween(NEWS_DELAY));
    }
    if (!stopRequested) {
      await checkpoint();
      await sleep(randomBetween(NEWS_DELAY));
    }
  }

  // 2) 자동차 커뮤니티: 게시판 목록을 최신 글부터 기간 끝까지 넘기며 제목에 메인+서브 키워드가 있는 글.
  //    제목엔 조합이 없어도 키워드·관련 단어(원터치·폴딩·끼임 등)가 하나라도 있으면 글을 열어 본문까지 확인한다
  const clueWords = [...keywordList(mainKw), ...keywordList(subKw), ...keywordList($("#include").value)];
  for (; pos.board < boards.length && !stopRequested; pos.board++) {
    const boardUrl = boards[pos.board];
    const ad = communityAdapter(boardUrl);
    let prevIds = "";
    let scanned = 0;
    let matched = 0;
    let readOk = false;
    const bodyCheck = []; // 본문까지 볼 글 { r, place }
    for (let page = 1; page <= COMMUNITY_MAX_LIST_PAGES && !stopRequested; page++) {
      setSummary(`찾는 중… 자동차 커뮤니티 ${pos.board + 1}/${boards.length} (${ad.site}) · ${page}페이지`);
      showBusy(`게시물 찾는 중 · ${ad.site} 게시판 ${page}페이지 — 끝날 때까지 이 탭을 닫지 마세요`, doneSteps(), total, "게시물 찾는 중");
      let rows;
      try {
        rows = await readBoardPage(ad, page);
      } catch (e) {
        log(`✖ ${ad.site} (${boardUrl}) ${page}페이지: 목록을 받지 못함 (${e.message})`);
        break;
      }
      const rowIds = rows.map((r) => r.id).join(",");
      if (!rows.length || rowIds === prevIds) {
        if (page === 1) log(`✖ ${ad.site} (${boardUrl}): 글 목록을 읽지 못함 (게시판 주소나 화면 구조 확인 필요)`);
        break;
      }
      prevIds = rowIds;
      const dated = rows.filter((r) => r.parsed);
      if (!dated.length) {
        if (page === 1) log(`✖ ${ad.site} (${boardUrl}): 목록에서 글 날짜를 읽지 못함`);
        break;
      }
      readOk = true;
      let older = 0;
      for (const r of dated) {
        const place = placeApprox(r.parsed, win);
        if (place === "older") older++;
        if (place === "older" || place === "newer" || r.notice) continue;
        scanned++;
        if (!matchesCombo(r.title, mainKw, subKw)) {
          if (hasAnyWord(r.title, clueWords) && !seen.has(channelKey(ad.articleUrl(r.id)))) bodyCheck.push({ r, place });
          continue;
        }
        const url = ad.articleUrl(r.id);
        const key = channelKey(url);
        if (seen.has(key)) continue;
        seen.add(key);
        addItem({
          key, channel: "자동차 커뮤니티", media: ad.site, url, boardIndex: pos.board, title: r.title, text: "",
          date: r.parsed.date, hasTime: !!r.parsed.hasTime, approx: !!r.parsed.approxMs, ambiguous: place === "ambiguous",
          checked: false, note: "", dup: false,
        });
        matched++;
      }
      renderResults();
      if (older * 2 >= dated.length) break; // 이 페이지 글 대부분이 기간 이전 → 끝
      await sleep(randomBetween(COMMUNITY_DELAY));
    }
    // 제목에 단서만 있는 글: 열어서 제목+본문에 메인+서브 키워드가 있으면 넣는다
    let bodyMatched = 0;
    for (let i = 0; i < bodyCheck.length && !stopRequested; i++) {
      const { r, place } = bodyCheck[i];
      const url = ad.articleUrl(r.id);
      setSummary(`찾는 중… ${ad.site} 본문 확인 ${i + 1}/${bodyCheck.length}`);
      showBusy(`게시물 찾는 중 · ${ad.site} 본문 확인 ${i + 1}/${bodyCheck.length} — 끝날 때까지 이 탭을 닫지 마세요`, doneSteps(), total, "게시물 찾는 중");
      await sleep(randomBetween(COMMUNITY_DELAY));
      let post;
      try {
        post = await readCommunityPost(url);
      } catch (e) {
        log(`  ↳ ${ad.site} 글을 열지 못함: ${r.title} (${e.message})`);
        continue;
      }
      if (!matchesCombo(`${r.title} ${post.body}`, mainKw, subKw)) continue;
      const key = channelKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const when = post.parsed && placeInRange(post.parsed, win) === "in" ? post.parsed : null;
      if (post.parsed && !when && placeInRange(post.parsed, win) !== "ambiguous") continue; // 글을 열어 보니 기간 밖
      addItem({
        key, channel: "자동차 커뮤니티", media: ad.site, url, boardIndex: pos.board, title: r.title, text: post.body.slice(0, 1000),
        date: (when || r.parsed).date, hasTime: !!(when || r.parsed).hasTime, approx: !when && !!r.parsed.approxMs,
        ambiguous: !when && place === "ambiguous", checked: false, note: "본문에 키워드", dup: false,
      });
      matched++;
      bodyMatched++;
      renderResults();
    }
    if (!readOk) failed.boards.push(boardUrl);
    else
      log(
        `· ${ad.site} (${boardUrl.replace(/^https?:\/\/(www\.)?/, "")}): 기간 안 글 ${scanned}건 중 키워드 맞는 글 ${matched}건` +
          (bodyCheck.length ? ` (제목에 단서만 있어 본문까지 본 글 ${bodyCheck.length}건 중 ${bodyMatched}건)` : ""),
      );
    if (!stopRequested) await checkpoint();
  }

  // 3) 동호회: 카페마다 카페 안 검색
  for (; pos.cafe < ids.length && !stopRequested; pos.cafe++) {
    const ci = pos.cafe;
    const cafeId = ids[ci];
    let prevKeys = "";
    for (let page = 1; page <= maxPages && !stopRequested; page++) {
      setSummary(`찾는 중… 동호회 ${ci + 1}/${ids.length} (${cafeNames[cafeId] || cafeId}) · ${page}페이지`);
      showBusy(`게시물 찾는 중 · 동호회 ${ci + 1}/${ids.length} (${cafeNames[cafeId] || cafeId}) — 끝날 때까지 이 탭을 닫지 마세요`, doneSteps(), total, "게시물 찾는 중");
      const res = await scanSearchPage(searchUrl(cafeId, q, page));
      if (res.login) {
        loginNeeded = true;
        failed.ids.push(cafeId);
        log(`✖ ${cafeId}: 네이버 로그인이 필요합니다`);
        break;
      }
      const name = cleanCafeName(res.title);
      if (name && !/^네이버\s*카페$/.test(name)) cafeNames[cafeId] = name;
      const slugFromItems = res.items.find((x) => x.slug && (!x.cafeId || x.cafeId === cafeId))?.slug;
      const slug = slugFromItems || pickSlug(res.hints);
      if (slug && !cafeSlugs[cafeId]) {
        await saveCafeSlug(cafeId, slug);
        cafeSlugs[cafeId] = slug;
      }
      const pageItems = res.items.filter((x) => !x.cafeId || x.cafeId === cafeId);
      const keys = pageItems.map((x) => x.articleId).join(",");
      if (!pageItems.length || keys === prevKeys) {
        if (!pageItems.length && res.snapshot) diagnostics.push({ cafeId, page, url: searchUrl(cafeId, q, page), frames: res.snapshot });
        if (!pageItems.length && !res.noResult) failed.ids.push(cafeId); // 화면을 못 읽음 → 다시 찾기 대상
        log(`· ${cafeNames[cafeId] || cafeId}: ${page}페이지 ${pageItems.length ? "(앞 페이지와 같음)" : res.noResult ? "검색 결과 없음" : `글 목록을 읽지 못함${snapshotSummary(res.snapshot)}`}`);
        break;
      }
      prevKeys = keys;
      let older = 0;
      let dated = 0;
      let added = 0;
      for (const x of pageItems) {
        const parsed = parseCafeDate(x.dateText);
        const place = placeInRange(parsed, win);
        if (parsed) dated++;
        if (place === "older") older++;
        if (place === "older" || place === "newer") continue;
        const key = `${cafeId}/${x.articleId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        addItem({
          key, cafeId, cafeIndex: ci, articleId: x.articleId, slug: x.slug || "", title: x.title, text: x.text,
          date: parsed ? parsed.date : null, hasTime: !!parsed?.hasTime, ambiguous: place === "ambiguous",
          checked: false, note: "", dup: false,
        });
        added++;
      }
      log(`· ${cafeNames[cafeId] || cafeId}: ${page}페이지 ${pageItems.length}개 중 기간 안 ${added}개`);
      renderResults();
      if (dated && older === dated) break; // 이 페이지가 모두 기간 이전 → 다음 페이지는 더 이전
      if (page < maxPages) await sleep(randomBetween(CAFE_PAGE_DELAY));
    }
    if (!stopRequested) await checkpoint();
    if (ci + 1 < ids.length && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }

  // 목록에 날짜만 보이는 글(예: 어제 글)·'3시간 전'처럼 대략인 네이버 뉴스 기사는 글을 열어 작성 시간을 확인하고, 기간 밖이면 뺀다 (관련 글 먼저)
  const toCheck = items
    .filter((x) => x.ambiguous || (x.approx && x.naverUrl))
    .sort((a, b) => Number(b.related) - Number(a.related));
  if (toCheck.length) log(`· 날짜만 보이는 글 ${toCheck.length}개의 작성 시간을 확인합니다`);
  for (let i = 0; i < toCheck.length && !stopRequested; i++) {
    const item = toCheck[i];
    setSummary(`작성 시간 확인 중… (${i + 1}/${toCheck.length})`);
    showBusy(`작성 시간 확인 중 ${i + 1}/${toCheck.length} — 끝날 때까지 이 탭을 닫지 마세요`, i, toCheck.length, "작성 시간 확인 중");
    let parsed = null;
    let login = false;
    if (isCafeItem(item)) {
      await sleep(randomBetween(CAFE_ARTICLE_DELAY));
      const res = await readArticleTime(`https://cafe.naver.com/f-e/cafes/${item.cafeId}/articles/${item.articleId}`);
      if (res.found) parsed = parseCafeDate(res.dateText);
      login = !!res.login;
      const slug = pickSlug(res.hints || []);
      if (slug && !cafeSlugs[item.cafeId]) {
        await saveCafeSlug(item.cafeId, slug);
        cafeSlugs[item.cafeId] = slug;
      }
    } else if (item.naverUrl) {
      await sleep(randomBetween(NEWS_DELAY));
      const res = await readNewsArticle(item.naverUrl).catch(() => null);
      parsed = res?.parsed?.hasTime ? res.parsed : null;
      if (res?.press && (!item.media || item.media === hostName(item.extUrl))) item.media = res.press;
    } else if (item.channel === "자동차 커뮤니티") {
      await sleep(randomBetween(NEWS_DELAY));
      parsed = await readCommunityTime(item.url).catch(() => null);
    } else {
      // 언론사 자체 사이트 기사: 열어 보지 않고 둔다 (목록의 날짜로 판단)
      if (item.ambiguous) item.note = "시간 미확인 (언론사 사이트에서 확인)";
      continue;
    }
    if (parsed) {
      const place = placeInRange(parsed, win);
      if (place === "older" || place === "newer") {
        items = items.filter((x) => x !== item);
        log(`· 기간 밖이라 뺌: ${item.title} (${formatDateTime(parsed.date)} 작성)`);
      } else {
        item.date = parsed.date;
        item.hasTime = true;
        item.ambiguous = false;
        item.approx = false;
      }
    } else if (item.ambiguous) {
      item.note = login ? "로그인 필요 - 시간 확인 못 함" : "시간 확인 못 함";
    }
    renderResults();
    if (!stopRequested) await checkpoint();
  }

  await clearResume("lx3");
  await chrome.storage.local.set({ lx3CafeNames: cafeNames }).catch(() => {});
  $("#diag").hidden = !diagnostics.length;
  cafeSlugs = await loadCafeSlugs();
  renderCafeInfo();
  markDuplicates();
  renderResults();
  lastSearchAt = Date.now();
  lastRange = { from: $("#from").value, to: $("#to").value };
  lastKw = { mainKw, subKw };
  // 이번에 찾은 기간까지 '미리 찾아 둔 결과'로 (최종 저장 전까지 다음 찾기는 여기에 이어 붙음)
  if (!stopRequested) {
    accum = accum
      ? { from: Math.min(accum.from, win.from.getTime()), to: Math.max(accum.to, win.to.getTime()) }
      : { from: win.from.getTime(), to: win.to.getTime() };
    await chrome.storage.local.set({ lx3Accum: accum }).catch(() => {});
  }
  updateAccumInfo();
  await saveLast();
  const checked = items.filter((x) => x.checked).length;
  const byChannel = ["언론", "유튜브", "자동차 커뮤니티", "동호회"]
    .map((c) => [c, items.filter((x) => (x.channel || "동호회") === c).length])
    .filter(([, n]) => n)
    .map(([c, n]) => `${c} ${n}`);
  setSummary(
    `${stopRequested ? "중지됨 - " : ""}찾은 글 ${items.length}개 (${byChannel.length > 1 ? `${byChannel.join(" · ")} · ` : ""}관련 글로 체크 ${checked}개)` +
      (loginNeeded ? " · 로그인이 필요한 카페가 있습니다" : "") +
      `. 필요 없는 글을 지운 뒤 '엑셀 받기'를 누르세요.`,
    loginNeeded ? "err" : "ok",
  );
  running = false;
  markRunning(false);
  hideBusy();
  // 못 읽은 곳(동호회·언론 검색어·커뮤니티 게시판) · 시간 확인 못 한 글 → 다시 찾기 버튼
  lastFailed = stopRequested ? { ids: [], queries: [], boards: [] } : failed;
  const unchecked = items.filter((x) => x.ambiguous && !(x.channel === "언론" && !x.naverUrl)).length;
  const failCount = lastFailed.ids.length + lastFailed.queries.length + lastFailed.boards.length;
  $("#retryCafes").hidden = !failCount && !unchecked;
  $("#retryCafes").textContent = failCount
    ? `못 읽은 곳 다시 찾기 (${whereText(lastFailed)}${unchecked ? ` · 시간 미확인 글 ${unchecked}개` : ""})`
    : `시간 미확인 글 다시 확인 (${unchecked}개)`;
  $("#search").disabled = false;
  $("#stop").disabled = true;
  updateCounts();
}

// "동호회 2곳 · 언론 검색어 3개 · 커뮤니티 게시판 1곳"
function whereText({ ids = [], queries = [], boards = [] }) {
  return [
    ids.length ? `동호회 ${ids.length}곳` : "",
    queries.length ? `언론 검색어 ${queries.length}개` : "",
    boards.length ? `커뮤니티 게시판 ${boards.length}곳` : "",
  ].filter(Boolean).join(" · ") || "없음";
}

// 결과 표(삭제 반영)를 저장해 두어 화면을 다시 열어도 그대로 보이게
function saveLast() {
  return chrome.storage.local
    .set({ lx3Last: { at: lastSearchAt || Date.now(), from: lastRange.from || $("#from").value, to: lastRange.to || $("#to").value, items: items.map(serializeItem) } })
    .catch(() => {});
}

function serializeItem(x) {
  return { ...x, date: x.date ? x.date.getTime() : null };
}

// ---------------------------------------------------------------------------
// 결과 표
// ---------------------------------------------------------------------------

// 기존 '채널별 버즈량 현황'처럼 채널(언론 → 유튜브 → 동호회 → 자동차 커뮤니티) → 날짜순(일) → 동호회 목록·게시판 순 → 시간순
const CHANNEL_ORDER = { 언론: 0, 유튜브: 1, 동호회: 2, "자동차 커뮤니티": 3 };
function sortedItems() {
  const day = (x) => (x.date ? new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate()).getTime() : Infinity);
  const ch = (x) => CHANNEL_ORDER[x.channel || "동호회"] ?? 9;
  const sub = (x) => (isCafeItem(x) ? x.cafeIndex : x.boardIndex) ?? 0;
  return [...items].sort(
    (a, b) => ch(a) - ch(b) || day(a) - day(b) || sub(a) - sub(b) || (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0),
  );
}

function renderResults() {
  const tbody = $("#results tbody");
  tbody.innerHTML = "";
  $("#resultBox").hidden = !items.length && !running;
  for (const item of sortedItems()) {
    const tr = document.createElement("tr");
    if (!item.checked) tr.className = "off";
    const url = articleUrl(item);
    tr.innerHTML =
      `<td><input type="checkbox"></td><td class="nowrap"></td><td></td><td><a target="_blank" rel="noopener"></a></td>` +
      `<td class="url"></td><td class="note"></td><td><button class="small del">삭제</button></td>`;
    const cb = tr.querySelector("input");
    cb.checked = item.checked;
    cb.addEventListener("change", () => {
      item.checked = cb.checked;
      item.touched = true;
      tr.className = item.checked ? "" : "off";
      updateCounts();
      saveLast(); // 체크만 바꿔도 바로 저장 (다시 열어도 그대로)
    });
    tr.children[1].textContent = item.date ? formatDateTime(item.date, item.hasTime) + (item.approx ? " 무렵" : "") : "날짜 모름";
    tr.children[2].textContent = isCafeItem(item) ? cafeNames[item.cafeId] || item.cafeId : `${item.channel} · ${item.media || hostName(item.url)}`;
    const a = tr.querySelector("a");
    a.href = url;
    a.textContent = item.title;
    tr.children[4].textContent = url;
    const notes = [];
    if (item.dup) notes.push("이미 파일에 있음");
    if (item.ambiguous) notes.push(item.note || "시간 미확인");
    else if (item.note) notes.push(item.note);
    if (!item.related) notes.push("관련 단어 없음");
    if (isCafeItem(item) && !(cafeSlugs[item.cafeId] || item.slug)) notes.push("영문 카페 주소 모름(설정에서 입력)");
    if (item.channel === "언론" && !item.naverUrl) notes.push("언론사 사이트 기사(네이버 댓글 없음)");
    tr.children[5].textContent = notes.join(" · ");
    tr.querySelector(".del").addEventListener("click", () => {
      items = items.filter((x) => x !== item);
      renderResults();
      saveLast();
    });
    tbody.appendChild(tr);
  }
  updateCounts();
}

function updateCounts() {
  const n = items.filter((x) => x.checked).length;
  $("#resultCount").textContent = items.length ? `전체 ${items.length}개 중 ${n}개 체크` : "";
  $("#saveList").disabled = !n || running;
  $("#selDelete").disabled = !n || running;
  $("#selDelete").textContent = n ? `선택 삭제 (${n}개)` : "선택 삭제";
  $("#toComments").disabled = (!n && !($("#withYoutube").checked && youtube.length)) || running;
  $("#checkAll").checked = !!items.length && n === items.length;
}

// 같은 글인지 비교하는 열쇠: 카페(영문 주소, 모르면 카페 번호) + 글번호
// (https://cafe.naver.com/allumpc/1340146 과 …/f-e/cafes/16624720/articles/1340146 은 같은 글)
function normUrl(u) {
  if (!/^https?:\/\/(?:[\w-]+\.)?(?:cafe\.naver\.com|naver\.me)\//i.test(String(u || "").trim())) return channelKey(u);
  const ids = parseArticleUrl(String(u || ""));
  const cafe = ids.cafeUrl || (ids.cafeId && cafeSlugs[ids.cafeId]) || ids.cafeId;
  if (ids.articleId && cafe) return `${cafe}/${ids.articleId}`.toLowerCase();
  return String(u || "")
    .trim()
    .replace(/^http:/, "https:")
    .replace(/[?#].*$/, "")
    .toLowerCase();
}

function markDuplicates() {
  const base = baseFile();
  // 비교 열쇠는 그때그때 만든다 (찾는 중에 알게 된 카페 영문 주소까지 반영)
  const have = new Set((base ? base.urls : []).map(normUrl));
  for (const item of items) {
    const was = item.dup;
    item.dup = [articleUrl(item), item.extUrl, item.naverUrl].some((u) => u && have.has(normUrl(u)));
    // 새로 '이미 파일에 있음'이 된 글은 (먼저 직접 체크했더라도) 체크를 푼다 - 다시 체크하면 넣을 수 있음
    if (item.dup && (!was || !item.touched)) item.checked = false;
    // 이어 쓸 파일이 바뀌어 더는 '이미 있음'이 아니면 원래 판단(관련 글이면 체크)으로
    if (!item.dup && was && !item.touched) item.checked = !!item.related;
  }
}

// ---------------------------------------------------------------------------
// 엑셀 ('채널별 버즈량 현황' 양식에 이어 쓰기 / 새 파일)
// ---------------------------------------------------------------------------

function pickSheet(wb) {
  const names = wb.sheetNames();
  return names.includes(SHEET_NAME) ? SHEET_NAME : names[0];
}

async function analyzeList(wb) {
  const sheet = pickSheet(wb);
  const rows = (await wb.readRows(sheet)).filter(
    (r) => r.r > HEADER_ROW && ["B", "C", "D", "E", "F", "G"].some((c) => r.cells[c] !== undefined && r.cells[c] !== ""),
  );
  let lastRow = HEADER_ROW;
  let lastSerial = 0;
  let styleRow = null;
  const urls = []; // G열 URL 그대로 (비교 열쇠는 markDuplicates 에서)
  for (const r of rows) {
    lastRow = Math.max(lastRow, r.r);
    const n = Number(r.cells.B);
    if (Number.isFinite(n)) lastSerial = Math.max(lastSerial, n);
    if (r.cells.G) urls.push(String(r.cells.G));
  }
  for (const r of rows) if (String(r.cells.C || "").trim() === "동호회" && (!styleRow || r.r > styleRow)) styleRow = r.r;
  return { sheet, lastRow, lastSerial, styleRow: styleRow || (rows.length ? lastRow : HEADER_ROW + 1), count: rows.length, urls };
}

async function loadListFile(file) {
  const box = $("#listFileInfo");
  listFile = null;
  if (!file) {
    if (baseChoice === "file") {
      baseChoice = "";
      await loadDbBase();
    }
    await refreshBaseSelect();
    showBaseInfo();
    markDuplicates();
    renderResults();
    return;
  }
  box.className = "hint";
  box.textContent = "파일 읽는 중…";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = await XlsxTemplate.Workbook.open(bytes);
    const info = await analyzeList(wb);
    listFile = { name: file.name, bytes, info, urls: info.urls };
    baseChoice = "file";
    try {
      localStorage.setItem("lx3FileName", file.name);
    } catch {
      /* 무시 */
    }
    await refreshBaseSelect();
    showBaseInfo();
  } catch (e) {
    box.className = "hint err";
    box.textContent = `파일을 읽지 못했습니다: ${e.message}`;
  }
  markDuplicates();
  renderResults();
}

function rememberedListName() {
  try {
    return localStorage.getItem("lx3FileName") || DEFAULT_LIST_NAME;
  } catch {
    return DEFAULT_LIST_NAME;
  }
}

async function buildList(selected) {
  let wb;
  let info;
  const base = baseFile();
  if (base) {
    wb = await XlsxTemplate.Workbook.open(base.bytes);
    info = await analyzeList(wb);
  } else {
    const resp = await fetch(chrome.runtime.getURL("lx3-template.xlsx"));
    wb = await XlsxTemplate.Workbook.open(new Uint8Array(await resp.arrayBuffer()));
    info = { sheet: pickSheet(wb), lastRow: HEADER_ROW, lastSerial: 0, styleRow: HEADER_ROW + 1 };
  }
  let serial = info.lastSerial;
  const values = selected.map((x) => [
    null, ++serial, x.channel || "동호회", isCafeItem(x) ? cafeNames[x.cafeId] || x.cafeId : x.media || hostName(x.url),
    // 게시일은 기존 파일처럼 날짜만 (작성 시간은 결과 표에서 확인)
    x.date ? excelSerial(new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate())) : "",
    x.title, articleUrl(x),
  ]);
  await wb.replaceRowsAfter(info.sheet, info.lastRow, values, info.styleRow, { focusFirstNew: true });
  const links = {};
  values.forEach((v, i) => (links[`G${info.lastRow + 1 + i}`] = v[6]));
  await wb.addHyperlinks(info.sheet, links);
  return { bytes: await wb.save(), from: info.lastSerial + 1, to: serial };
}

async function saveList({ auto = false } = {}) {
  const selected = sortedItems().filter((x) => x.checked);
  if (!selected.length) return;
  if (!baseFile() && !separateFile() && !auto) {
    const go = confirm(
      "기존 '채널별 버즈량 현황' 엑셀 파일을 첨부하지 않았고 최종 DB에도 파일이 없습니다.\n\n" +
        "· [확인]: 첨부 없이 진행 (이번에 고른 글만 담은 새 파일, 순번 1부터)\n" +
        "· [취소]: 기존 파일을 먼저 첨부하기 (마지막 순번 다음에 이어 쓰기·이미 있는 글 제외)",
    );
    if (!go) {
      $("#listFile").scrollIntoView({ block: "center" });
      $("#listFile").click();
      return;
    }
  }
  $("#saveInfo").className = "hint";
  $("#saveInfo").textContent = "엑셀 만드는 중…";
  $("#diffs").hidden = true;
  try {
    const out = await buildList(selected);
    const base = baseFile();
    const name = datedFileName(base ? base.name : rememberedListName());
    await downloadBytes(out.bytes, name);
    lastSaved = selected;
    if (!separateFile()) {
      // 최종 저장: 쌓아 둔 결과는 저장된 것으로 (다음 찾기는 새로 시작)
      for (const x of items) x.saved = true;
      accum = null;
      await chrome.storage.local.remove("lx3Accum").catch(() => {});
      await saveLast();
      updateAccumInfo();
    }
    let dbNote = "";
    if (!separateFile()) {
      // 오늘의 최종 파일로 최종 DB 에 저장하고, 다음 저장은 이 파일에 이어 쓴다
      // 그 채널을 찾았을 때만 건수 기록 (찾지 않은 채널은 0이 아니라 '기록 없음')
      const count = (c) => (items.some((x) => (x.channel || "동호회") === c) ? selected.filter((x) => (x.channel || "동호회") === c).length : undefined);
      const end = new Date(lastRange.to || $("#to").value).getTime(); // 이 파일의 수집 끝 (이어서 작성·자동 수집이 여기부터)
      await dbSaveDay("buzz", today(), name, out.bytes, "auto", `마지막 순번 ${out.to.toLocaleString()}`, {
        posts: selected.length, news: count("언론"), youtube: count("유튜브"), cafe: count("동호회"), community: count("자동차 커뮤니티"),
      }, { rangeEnd: end && end <= Date.now() ? end : null });
      await showDiffs();
      listFile = null;
      $("#listFile").value = "";
      baseChoice = "";
      await loadDbBase();
      await refreshBaseSelect();
      showBaseInfo();
      dbNote = " · 최종 DB에 오늘 파일로 저장했습니다";
      // 자동 수집은 다음에 이 시각부터 이어서 모은다 (휴일·못 돌린 날 포함)
      const { lx3LastRangeEnd = 0 } = await chrome.storage.local.get("lx3LastRangeEnd").catch(() => ({}));
      if (end && end <= Date.now() && end > lx3LastRangeEnd) await chrome.storage.local.set({ lx3LastRangeEnd: end }).catch(() => {});
      updateAutoInfo();
    }
    $("#saveInfo").className = "hint ok";
    $("#saveInfo").textContent = `✔ ${saveWhereText(await saveOptions())}에 ${name} - ${selected.length}개 추가 (순번 ${out.from}~${out.to})${dbNote}. '체크한 글 댓글 수집하기'로 바로 댓글을 모을 수 있습니다.`;
    const noSlug = selected.filter((x) => isCafeItem(x) && !(cafeSlugs[x.cafeId] || x.slug));
    if (noSlug.length) {
      $("#saveInfo").className = "hint err";
      $("#saveInfo").textContent += ` (영문 카페 주소를 몰라 긴 주소로 쓴 글 ${noSlug.length}개 - 설정의 '영문 카페 주소'를 넣고 다시 받으세요)`;
    }
  } catch (e) {
    $("#saveInfo").className = "hint err";
    $("#saveInfo").textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// 댓글 수집 화면으로 넘기기
// ---------------------------------------------------------------------------

function handOff(urls, message, auto = false) {
  try {
    localStorage.setItem("urls", urls.join("\n"));
    sessionStorage.setItem("handoff", message);
  } catch {
    /* 무시 */
  }
  location.href = auto ? "app.html?auto=1" : "app.html";
}

// 언론은 네이버 뉴스 기사만(댓글은 네이버 뉴스에만 있음), 동호회·커뮤니티 글, 유튜브 목록
function toComments(auto = false) {
  const sel = sortedItems().filter((x) => x.checked);
  const news = sel.filter((x) => x.channel === "언론" && x.naverUrl).map((x) => x.naverUrl);
  const noNaver = sel.filter((x) => x.channel === "언론" && !x.naverUrl).length;
  const cafe = sel.filter(isCafeItem).map(articleUrl);
  const comm = sel.filter((x) => x.channel === "자동차 커뮤니티").map((x) => x.url);
  // 유튜브: 저장해 둔 목록(함께 수집 켰을 때) + 체크한 새 콘텐츠 (같은 영상은 한 번)
  const yt = [...new Set([...($("#withYoutube").checked ? youtube : []), ...sel.filter((x) => x.channel === "유튜브").map((x) => x.url)])];
  const parts = [
    news.length ? `언론 기사 ${news.length}개` : "",
    cafe.length || (!news.length && !comm.length) ? `카페 글 ${cafe.length}개` : "",
    comm.length ? `커뮤니티 글 ${comm.length}개` : "",
    yt.length ? `유튜브 영상 ${yt.length}개` : "",
  ].filter(Boolean);
  handOff(
    [...news, ...cafe, ...comm, ...yt],
    `LX3 메뉴에서 ${parts.join(", ")}를 가져왔습니다` +
      (noNaver ? ` (언론사 자체 사이트 기사 ${noNaver}개는 네이버 뉴스 댓글이 없어 뺐습니다)` : "") +
      (auto ? ". 자동 수집: 이어서 댓글을 수집합니다." : `. 기존 raw data 엑셀 파일을 고른 뒤 '수집 시작'을 누르세요.`),
    auto,
  );
}

// ---------------------------------------------------------------------------
// 유튜브 영상 목록 (저장 · 추가 · 삭제)
// ---------------------------------------------------------------------------

let youtube = [];

// 유튜브 새 콘텐츠: 넣은 링크마다 영상 제목·채널·게시일을 읽어 결과 표에 (체크된 채로) 넣는다 → 게시물 엑셀 '유튜브'
async function addNewYoutube() {
  const info = $("#ytNewInfo");
  const parts = $("#ytNew").value.split(/\s+/).filter(Boolean);
  const bad = [];
  const failed = [];
  let added = 0;
  $("#ytNewAdd").disabled = true;
  for (const part of parts) {
    const id = youtubeVideoId(part);
    if (!id) {
      bad.push(part);
      continue;
    }
    const url = `https://www.youtube.com/watch?v=${id}`;
    if (items.some((x) => x.key === `yt:${id}`)) continue;
    info.className = "hint";
    info.textContent = `영상 정보 읽는 중… (${url})`;
    try {
      const v = await readYoutubeInfo(url);
      items.push({
        key: `yt:${id}`, channel: "유튜브", media: v.channel, url, title: v.title, text: "",
        date: v.date, hasTime: v.hasTime, ambiguous: false, related: true, checked: true, touched: true, note: "직접 넣은 영상", dup: false,
      });
      added++;
      // 댓글 수집 유튜브 목록에도 자동으로 (매일 댓글 수집)
      if (!youtube.includes(url)) {
        youtube.push(url);
        await saveYoutube();
      }
    } catch (e) {
      failed.push(part);
      info.className = "hint err";
      info.textContent = `${url}: ${e.message}`;
    }
  }
  $("#ytNewAdd").disabled = false;
  $("#ytNew").value = [...bad, ...failed].join(" ");
  markDuplicates();
  renderResults();
  await saveLast();
  const dups = items.filter((x) => x.channel === "유튜브" && x.dup).length;
  if (!failed.length) {
    info.className = added ? "hint ok" : "hint";
    info.textContent =
      (added ? `✔ 유튜브 영상 ${added}개를 결과 표에 넣고 댓글 수집 유튜브 목록에도 추가했습니다 (엑셀 받기 때 '유튜브'로 들어감)` : "새로 넣은 영상이 없습니다") +
      (dups ? ` · 이미 파일에 있는 영상 ${dups}개는 체크를 풀었습니다` : "") +
      (bad.length ? ` · 유튜브 주소가 아닌 것 ${bad.length}개는 칸에 남겨 두었습니다` : "");
  }
}

function youtubeIdOf(url) {
  const m = String(url).match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function saveYoutube() {
  await chrome.storage.local.set({ lx3Youtube: youtube }).catch(() => {});
  renderYoutube();
  updateCounts();
}

function renderYoutube() {
  const ol = $("#ytList");
  ol.innerHTML = "";
  youtube.forEach((url, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<a target="_blank" rel="noopener"></a> <button class="small">삭제</button>`;
    li.querySelector("a").href = url;
    li.querySelector("a").textContent = url;
    li.querySelector("button").addEventListener("click", () => {
      youtube.splice(i, 1);
      saveYoutube();
    });
    ol.appendChild(li);
  });
  $("#ytCollect").disabled = !youtube.length;
}

function addYoutube() {
  const bad = [];
  for (const part of $("#ytInput").value.split(/\s+/).filter(Boolean)) {
    const id = youtubeIdOf(part);
    if (!id) {
      bad.push(part);
      continue;
    }
    const url = `https://www.youtube.com/watch?v=${id}`;
    if (!youtube.includes(url)) youtube.push(url);
  }
  $("#ytInput").value = bad.join(" ");
  saveYoutube();
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

async function restoreLast() {
  const { lx3Last, lx3Accum } = await chrome.storage.local.get(["lx3Last", "lx3Accum"]).catch(() => ({}));
  if (!lx3Last?.items?.length) return;
  items = lx3Last.items.map((x) => ({ ...x, date: x.date ? new Date(x.date) : null }));
  lastSearchAt = lx3Last.at;
  lastRange = { from: lx3Last.from, to: lx3Last.to };
  accum = lx3Accum || null;
  if (!accum && !items.some((x) => x.saved)) {
    // 이전 버전에서 찾아 두고 최종 DB 에 저장하지 않은 결과 → 미리 찾아 둔 결과로 (지난 결과보다 나중에 저장한 게시물 리스트가 없으면)
    const latest = await dbLatest("buzz").catch(() => null);
    const from = new Date(lx3Last.from).getTime();
    const to = new Date(lx3Last.to).getTime();
    if ((!latest || latest.savedAt < lx3Last.at) && from && to) {
      accum = { from, to };
      await chrome.storage.local.set({ lx3Accum: accum }).catch(() => {});
    }
  }
  markDuplicates();
  renderResults();
  setSummary(
    `지난번에 찾은 결과입니다 (${lx3Last.from.replace("T", " ")} ~ ${lx3Last.to.replace("T", " ")}, ${new Date(lx3Last.at).toLocaleString()} 찾음). 새로 찾으려면 '게시물 찾기'를 누르세요.`,
  );
}

async function init() {
  await loadSettings();
  resetRange();
  renderCafeInfo();
  renderYoutube();
  await loadDbBase();
  await loadListFile(null);
  $("#baseSelect").addEventListener("change", onBaseSelect);
  $("#clearListFile").addEventListener("click", () => {
    $("#listFile").value = "";
    loadListFile(null);
  });
  $("#separate").addEventListener("change", () => {
    showBaseInfo();
    markDuplicates();
    renderResults();
  });
  for (const id of ["cafeList", "include", "exclude", "searchUrl", "maxPages", "query", "tabFallback", "saveFolder", "saveAsk", "holidays",
    "chCafe", "chNews", "chCommunity", "mainKw", "subKw", "boards", "newsPages"]) {
    $(`#${id}`).addEventListener("change", async () => {
      if (id === "searchUrl") $("#searchUrl").value = normalizeSearchUrl($("#searchUrl").value);
      if (id === "saveFolder") $("#saveFolder").value = cleanFolder($("#saveFolder").value);
      if (id === "holidays") resetRange();
      await saveSettings();
      if (id === "cafeList") renderCafeInfo();
      if (id === "include" || id === "exclude") {
        for (const x of items) {
          if (x.channel === "유튜브") continue; // 직접 넣은 영상은 관련 글로 둠
          x.related = isRelated(x);
          if (!x.touched && !x.dup) x.checked = x.related;
        }
        renderResults();
        saveLast();
      }
    });
  }
  $("#resetSettings").addEventListener("click", async () => {
    $("#cafeList").value = DEFAULT_CAFES.join("\n");
    $("#query").value = DEFAULT_QUERY;
    $("#include").value = DEFAULT_INCLUDE;
    $("#exclude").value = DEFAULT_EXCLUDE;
    $("#searchUrl").value = DEFAULT_SEARCH_URL;
    $("#maxPages").value = DEFAULT_MAX_PAGES;
    $("#mainKw").value = DEFAULT_MAIN_KEYWORDS;
    $("#subKw").value = DEFAULT_SUB_KEYWORDS;
    $("#boards").value = DEFAULT_BOARDS.join("\n");
    $("#newsPages").value = DEFAULT_NEWS_PAGES;
    baseTimes = { ...DEFAULT_BASE_TIMES };
    await chrome.storage.local.set({ lx3BaseTimes: baseTimes }).catch(() => {});
    resetRange();
    await saveSettings();
    renderCafeInfo();
  });
  $("#resetRange").addEventListener("click", () => resetRange());
  $("#continueAccum").addEventListener("change", () => resetRange());
  $("#saveRange").addEventListener("click", saveBaseTimes);
  $("#search").addEventListener("click", () => search());
  // 못 읽은 곳만 다시 찾고(날짜만 보이는 글의 시간 확인도 다시), 이미 찾은 글에 더한다
  $("#retryCafes").addEventListener("click", () =>
    search({
      retry: true, from: lastRange.from || $("#from").value, to: lastRange.to || $("#to").value, q: $("#query").value.trim(),
      ids: lastFailed.ids, queries: lastFailed.queries, boards: lastFailed.boards, mainKw: lastKw.mainKw, subKw: lastKw.subKw,
      items: items.map(serializeItem),
    }),
  );
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 보는 화면까지 마칩니다)");
  });
  const setChecks = (fn) => {
    for (const x of items) {
      x.checked = fn(x);
      x.touched = true;
    }
    renderResults();
    saveLast();
  };
  $("#selAll").addEventListener("click", () => setChecks(() => true));
  $("#selNone").addEventListener("click", () => setChecks(() => false));
  $("#selInvert").addEventListener("click", () => setChecks((x) => !x.checked));
  $("#selDelete").addEventListener("click", async () => {
    const n = items.filter((x) => x.checked).length;
    if (!n || !confirm(`체크한 게시물 ${n}개를 목록에서 삭제할까요?`)) return;
    items = items.filter((x) => !x.checked);
    renderResults();
    await saveLast();
  });
  $("#checkAll").addEventListener("change", () => {
    for (const x of items) {
      x.checked = $("#checkAll").checked;
      x.touched = true;
    }
    renderResults();
    saveLast();
  });
  $("#listFile").addEventListener("change", (e) => loadListFile(e.target.files[0]));
  $("#saveList").addEventListener("click", () => saveList());
  $("#toComments").addEventListener("click", () => toComments()); // 클릭 정보가 '자동 수집' 자리에 들어가지 않게
  $("#withYoutube").addEventListener("change", updateCounts);
  $("#ytAdd").addEventListener("click", addYoutube);
  $("#ytNewAdd").addEventListener("click", addNewYoutube);
  $("#ytNew").addEventListener("keydown", (e) => e.key === "Enter" && addNewYoutube());
  $("#ytReset").addEventListener("click", () => {
    if (!confirm(`유튜브 목록을 기본 ${DEFAULT_YOUTUBE.length}개로 되돌릴까요? (지금 목록은 지워집니다)`)) return;
    youtube = [...DEFAULT_YOUTUBE];
    saveYoutube();
  });
  $("#diag").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, at: new Date().toString(), diagnostics }, null, 1)], { type: "application/json" });
    clickDownload(blob, `${today()}_LX3_진단.json`);
  });
  $("#ytInput").addEventListener("keydown", (e) => e.key === "Enter" && addYoutube());
  $("#ytCollect").addEventListener("click", () =>
    handOff(youtube, `LX3 메뉴에서 유튜브 영상 ${youtube.length}개를 가져왔습니다. 기존 raw data 엑셀 파일을 고른 뒤 '수집 시작'을 누르세요.`),
  );
  window.addEventListener("focus", checkLogin);
  checkLogin();
  await restoreLast();
  updateAccumInfo();
  resetRange(); // 미리 찾아 둔 결과가 있으면 그 끝부터
  updateAutoInfo();
  // 중단된 찾기가 있으면 이어서 할지 묻는다 (자동 수집이면 묻지 않고 자동 수집 흐름으로)
  const r = await loadResume("lx3");
  if (AUTO_MODE) {
    history.replaceState(null, "", "lx3.html"); // 새로고침해도 자동 수집이 다시 시작되지 않게
    runAuto(r);
  } else if (r) {
    const ids = r.ids || [];
    const queries = r.queries || [];
    const boards = r.boards || [];
    const parts = [
      queries.length ? `언론 검색어 ${queries.length}개 중 ${Math.min(r.nextQuery || 0, queries.length)}개` : "",
      boards.length ? `커뮤니티 게시판 ${boards.length}곳 중 ${Math.min(r.nextBoard || 0, boards.length)}곳` : "",
      ids.length ? `동호회 ${ids.length}곳 중 ${Math.min(r.nextCafe || 0, ids.length)}곳` : "",
    ].filter(Boolean);
    const go = confirm(
      `중단된 게시물 찾기가 있습니다 (${parts.join(", ")} 완료, 찾은 글 ${r.items.length}개 · ${new Date(r.at).toLocaleString()}).\n\n` +
        "· [확인]: 이어서 찾기 (남은 곳·시간 확인부터)\n· [취소]: 버리기",
    );
    if (go) search(r);
    else await clearResume("lx3");
  }
}

init();

// 오늘 엑셀에 넣은 게시물 수 · 전일(직전 기록일) 대비 증감
async function showDiffs() {
  const box = $("#diffs");
  const d = await dbStatDiff("buzz", today(), "posts").catch(() => null);
  box.hidden = !d;
  box.replaceChildren();
  if (d) box.append(diffLine("오늘 게시물", d));
  // 채널을 둘 이상 찾았으면 채널별로도 (하나뿐이면 합계와 같으므로 생략)
  const lines = [];
  for (const [field, label] of [["news", "언론"], ["youtube", "유튜브"], ["cafe", "동호회"], ["community", "자동차 커뮤니티"]]) {
    const c = await dbStatDiff("buzz", today(), field).catch(() => null);
    if (c && d) lines.push(diffLine(label, c));
  }
  if (lines.length > 1) box.append(...lines);
}

// 위쪽 '⚙ 설정' 버튼(lx3.html#settings): 설정을 펼치고 그 위치로
function openSettingsFromHash() {
  if (location.hash !== "#settings") return;
  $("#settings").open = true;
  $("#settings").scrollIntoView({ block: "start", behavior: "smooth" });
}
window.addEventListener("hashchange", openSettingsFromHash);
openSettingsFromHash();

// ---------------------------------------------------------------------------
// 자동 수집 ('온라인 오전 일일동향'과 같은 방식, 백그라운드가 평일 정해진 시각에 lx3.html?auto=1 로 연다)
// 게시물 찾기 → 관련 단어로 체크된 글을 게시물 엑셀·최종 DB 에 저장 → 그 글들과 유튜브 목록의 댓글 수집(app.html?auto=1)
// ---------------------------------------------------------------------------

// 자동 수집 기간: 지난번 게시물 리스트를 저장한 끝 시각부터 오늘 기준 시각까지
// (주말·공휴일이 끼었거나 PC 가 꺼져 못 돌린 날도 이어서 모음. 7일 넘게 비었으면 기본 기간 = 직전 근무일부터)
function autoRange(now = new Date(), lastEnd = 0) {
  const def = defaultRange(now);
  const to = def.to.getTime();
  const from = lastEnd && lastEnd < to && to - lastEnd <= 7 * 86400000 ? new Date(lastEnd) : def.from;
  return { from, to: def.to };
}

async function runAuto(resume) {
  const fail = (message) => {
    setSummary(`자동 수집: ${message}`, "err");
    chrome.runtime.sendMessage({ type: "lx3AutoDone", ok: false, message }).catch(() => {});
  };
  try {
    if (resume && Date.now() - resume.at < 12 * 3600000) {
      log("· 지난 자동 수집이 중간에 멈춰서, 끝난 곳은 건너뛰고 남은 곳부터 이어서 찾습니다");
      await search(resume);
    } else {
      if (resume) await clearResume("lx3");
      const { lx3LastRangeEnd = 0 } = await chrome.storage.local.get("lx3LastRangeEnd").catch(() => ({}));
      const r = autoRange(new Date(), lx3LastRangeEnd);
      if (continuing() && accum.to > r.from.getTime() && accum.to < r.to.getTime()) r.from = new Date(accum.to); // 휴일에 미리 찾아 둔 결과 뒤부터
      $("#from").value = toLocalInput(r.from);
      $("#to").value = toLocalInput(r.to);
      log(`· 자동 수집을 시작합니다 (${formatDateTime(r.from)} ~ ${formatDateTime(r.to)}${r.from.getTime() === lx3LastRangeEnd ? " · 지난번 저장 이후 이어서" : ""})`);
      await search();
    }
  } catch (e) {
    return fail(`게시물 찾기 중 오류가 났습니다 (${e.message})`);
  }
  if (stopRequested) return fail("게시물 찾기를 중지했습니다. 결과를 확인해 주세요.");
  const n = items.filter((x) => x.checked && !x.dup).length;
  if (n) await saveList({ auto: true });
  // 찾은 글이 없어도 이 기간은 모은 것으로 (다음 자동 수집은 여기부터)
  const end = new Date($("#to").value).getTime();
  const { lx3LastRangeEnd = 0 } = await chrome.storage.local.get("lx3LastRangeEnd").catch(() => ({}));
  await chrome.storage.local.set({ lx3AutoPosts: n, ...(end > lx3LastRangeEnd ? { lx3LastRangeEnd: end } : {}) }).catch(() => {});
  $("#withYoutube").checked = true;
  toComments(true);
}

// 위쪽 안내: 자동 수집 설정·오늘 근무일 여부·다음 수집이 어디부터인지
async function updateAutoInfo() {
  const box = $("#autoInfo");
  if (!box) return;
  const { lx3Auto, lx3LastRangeEnd = 0 } = await chrome.storage.local.get(["lx3Auto", "lx3LastRangeEnd"]).catch(() => ({}));
  const on = lx3Auto?.on ?? true;
  const time = lx3Auto?.time || "11:30";
  $("#autoOn").checked = on;
  $("#autoTime").value = time;
  if (!on) {
    box.textContent = "⏰ 자동 수집: 꺼짐 (설정에서 켤 수 있음)";
    return;
  }
  const now = new Date();
  const r = autoRange(now, lx3LastRangeEnd);
  box.textContent =
    `⏰ 자동 수집: 평일 ${timeLabel(time)} (주말·공휴일·추가 휴일엔 쉬고 다음 근무일에 이어서) · 오늘은 ${isOffDay(now) ? "휴일" : "근무일"}` +
    ` · 다음 수집 기간: ${md(r.from)} ${timeLabel(toLocalInput(r.from).slice(11))}부터` +
    (lx3LastRangeEnd && r.from.getTime() === lx3LastRangeEnd ? " (지난번 저장 이후 이어서)" : "");
}

async function saveAutoSettings() {
  const time = /^\d{2}:\d{2}$/.test($("#autoTime").value) ? $("#autoTime").value : "11:30";
  await chrome.storage.local.set({ lx3Auto: { on: $("#autoOn").checked, time } }).catch(() => {});
  updateAutoInfo();
}
$("#autoOn").addEventListener("change", saveAutoSettings);
$("#autoTime").addEventListener("change", saveAutoSettings);
