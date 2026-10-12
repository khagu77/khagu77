// LX3 팰리세이드 전동 시트 관련 - 동호회(네이버 카페)에서 검색어('시트')로 찾은 글 중
// 정한 시간(기본: 전일 오후 12시 ~ 당일 오후 12시)에 올라온 관련 글을 추려 '채널별 버즈량 현황' 엑셀로 받고,
// 그 글들(과 저장해 둔 유튜브 영상)의 댓글 수집으로 바로 넘긴다.
// 네이버는 API 를 부르지 않고 검색 화면·게시글을 탭으로 열어 화면에 보이는 내용만 읽는다(cafe-common.js).

const DEFAULT_CAFES = [
  16624720, 10050004, 19934815, 10633813, 20179506, 21771803, 16598058, 31522344, 23756663, 22267088, 12025661, 25538910,
].map((id) => `https://cafe.naver.com/f-e/cafes/${id}/menus/0`);
const DEFAULT_QUERY = "시트";
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
let listFile = null; // { name, bytes, urls:Set, info }
let cafeSlugs = {};
let cafeNames = {};
let lastSaved = null;
let diagnostics = []; // 글을 못 읽은 화면의 구조 (진단 파일)

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["lx3Cafes", "lx3Query", "lx3Include", "lx3Exclude", "lx3SearchUrl", "lx3MaxPages", "lx3CafeNames", "lx3Youtube"])
    .catch(() => ({}));
  $("#cafeList").value = (s.lx3Cafes || DEFAULT_CAFES).join("\n");
  $("#query").value = s.lx3Query ?? DEFAULT_QUERY;
  $("#include").value = s.lx3Include ?? DEFAULT_INCLUDE;
  $("#exclude").value = s.lx3Exclude ?? DEFAULT_EXCLUDE;
  $("#searchUrl").value = s.lx3SearchUrl || DEFAULT_SEARCH_URL;
  $("#maxPages").value = s.lx3MaxPages || DEFAULT_MAX_PAGES;
  cafeNames = Object.fromEntries(Object.entries(s.lx3CafeNames || {}).map(([k, v]) => [k, cleanCafeName(v)]));
  cafeSlugs = await loadCafeSlugs();
  youtube = s.lx3Youtube || [];
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
    })
    .catch(() => {});
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
// 시간 범위 (기본: 전일 오후 12시 ~ 당일 오후 12시, 새로고침하면 다시 기본값)
// ---------------------------------------------------------------------------

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resetRange() {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
  const from = new Date(to.getTime() - 24 * 3600e3);
  $("#from").value = toLocalInput(from);
  $("#to").value = toLocalInput(to);
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

// 검색 결과 화면: 게시글 링크마다 제목·날짜·미리보기 글자
function scanSearchInFrame() {
  const body = document.body;
  const top = window === window.top;
  if (!body) return { items: [], noResult: false, href: location.href, top, title: top ? document.title : "" };
  const pageText = body.innerText || "";
  const noResult = /검색\s*결과가\s*없|검색된\s*(?:게시물|게시글|글)이\s*없|등록된\s*(?:게시물|게시글)이\s*없/.test(pageText);
  const idOf = (href) => {
    href = String(href || "");
    let m = href.match(/\/cafes\/(\d+)\/articles\/(\d+)/);
    if (m) return { cafeId: m[1], articleId: m[2], slug: "" };
    m = href.match(/\/cafes\/([A-Za-z][\w-]*)\/articles\/(\d+)/);
    if (m) return { cafeId: "", articleId: m[2], slug: m[1] };
    m = href.match(/[?&]articleid=(\d+)/i);
    if (m) {
      const c = href.match(/[?&]clubid=(\d+)/i);
      return { cafeId: c ? c[1] : "", articleId: m[1], slug: "" };
    }
    m = href.match(/^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9][\w-]*)\/(\d+)(?:[?#/]|$)/);
    if (m && !/^(f-e|ca-fe|cafes)$/.test(m[1])) return { cafeId: "", articleId: m[2], slug: m[1] };
    m = href.match(/(?:^|[/"'=(,\s])articles?\/(\d{3,})/) || href.match(/article[_-]?id["'=:\s]+(\d{3,})/i);
    if (m) return { cafeId: "", articleId: m[1], slug: "" };
    return null;
  };
  // 글 링크: <a href> 뿐 아니라 data-*·onclick 으로 글을 여는 화면도 있다
  const anchors = [];
  const SEL = "a, [href], [data-href], [data-url], [data-link], [data-article-id], [data-articleid], [data-article], [onclick]";
  for (const a of document.querySelectorAll(SEL)) {
    const cands = [a.href, a.getAttribute("href"), a.getAttribute("onclick")];
    for (const at of a.attributes) if (at.name.startsWith("data-")) cands.push(/article.?id$/i.test(at.name) ? `articleid=${at.value}` : at.value);
    for (const c of cands) {
      const id = c && idOf(c);
      if (id) {
        anchors.push({ a, ...id });
        break;
      }
    }
  }
  const idsIn = (el) => {
    const s = new Set();
    for (const x of anchors) if (el.contains(x.a)) s.add(x.articleId);
    return s;
  };
  const groups = new Map();
  for (const x of anchors) {
    let el = x.a;
    while (el.parentElement && el.parentElement !== body && idsIn(el.parentElement).size <= 1) el = el.parentElement;
    if (!groups.has(x.articleId)) groups.set(x.articleId, { ...x, box: el, anchors: [] });
    const g = groups.get(x.articleId);
    if (el.contains(g.box)) g.box = el;
    g.anchors.push(x.a);
    if (!g.cafeId && x.cafeId) g.cafeId = x.cafeId;
    if (!g.slug && x.slug) g.slug = x.slug;
  }
  const clean = (t) => String(t || "").replace(/\s+/g, " ").replace(/\s*\[\d+\]\s*$/, "").replace(/\s*(?:new|N)\s*$/i, "").trim();
  const items = [];
  for (const g of groups.values()) {
    let best = null;
    let bestScore = -1;
    for (const a of g.anchors) {
      // 글 전체가 링크인 모양이면 그 안의 제목 부분만
      const titleEl = a.querySelector("[class*='title'], [class*='tit'], [class*='subject'], strong");
      const t = clean((titleEl || a).innerText);
      if (!t || /^\[?\d+\]?$/.test(t) || /^댓글/.test(t)) continue;
      const cls = `${a.className} ${a.parentElement?.className || ""}`;
      const score = (/title|tit|subject|article/i.test(cls) ? 2 : 0) + (best === null ? 1 : 0) + (t.length <= 120 ? 1 : 0);
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    if (!best) continue;
    const dateEl = g.box.querySelector('[class*="date"], [class*="Date"], time, .td_date');
    items.push({
      cafeId: g.cafeId,
      articleId: g.articleId,
      slug: g.slug,
      title: best,
      dateText: dateEl ? dateEl.innerText : g.box.innerText,
      text: String(g.box.innerText || "").replace(/\s+/g, " ").slice(0, 600),
    });
  }
  // 링크로 못 찾았으면: 글번호(5자리 이상)로 시작하고 날짜·시간이 있는 줄(전체글보기 목록 모양)
  if (!items.length) {
    const dateRe = /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.|(?:^|\s)\d{1,2}:\d{2}(?:\s|$)|\d+\s*(?:분|시간)\s*전/;
    const seen = new Set();
    for (const row of document.querySelectorAll("tr, li, [role='row'], [class*='article'], [class*='Article']")) {
      const t = String(row.innerText || "").trim();
      const m = t.match(/^(\d{5,})\s+([\s\S]+)$/);
      if (!m || seen.has(m[1]) || !dateRe.test(t) || t.length > 1500) continue;
      seen.add(m[1]);
      const titleEl = row.querySelector("[class*='title'], [class*='tit'], [class*='subject'], a");
      const title = clean(titleEl ? titleEl.innerText : m[2].split("\n")[0]);
      const dateEl = row.querySelector('[class*="date"], [class*="Date"], time, .td_date');
      if (title) items.push({ cafeId: "", articleId: m[1], slug: "", title, dateText: dateEl ? dateEl.innerText : t, text: t.replace(/\s+/g, " ").slice(0, 600) });
    }
  }
  return { items, noResult, href: location.href, top, title: top ? document.title : "", anchorCount: anchors.length };
}

// 진단용: 이 화면이 어떻게 생겼는지 (글을 못 찾았을 때 보내 주시면 화면 구조에 맞춰 고칠 수 있음)
function snapshotInFrame() {
  const body = document.body;
  const links = [...document.querySelectorAll("a")].slice(0, 80).map((a) => ({
    href: a.getAttribute("href"), text: String(a.innerText || "").replace(/\s+/g, " ").slice(0, 80),
    cls: String(a.className || "").slice(0, 80), data: [...a.attributes].filter((x) => x.name.startsWith("data-") || x.name === "onclick").map((x) => `${x.name}=${x.value}`.slice(0, 120)),
  }));
  const rows = [...document.querySelectorAll("tr, li, [role='row'], [class*='article'], [class*='Article']")]
    .filter((r) => /\d{1,2}:\d{2}|\d{4}\.\s*\d{1,2}\./.test(r.innerText || ""))
    .slice(0, 5)
    .map((r) => r.outerHTML.slice(0, 3000));
  return {
    href: location.href, top: window === window.top, title: document.title, readyState: document.readyState,
    visibility: document.visibilityState, counts: { a: document.querySelectorAll("a").length, iframes: document.querySelectorAll("iframe").length, rows: rows.length },
    iframes: [...document.querySelectorAll("iframe")].map((f) => f.src).slice(0, 10),
    text: body ? String(body.innerText || "").slice(0, 3000) : "", links, rows,
  };
}

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
  });
}

async function readArticleTime(url) {
  return withTab(url, async (tabId) => {
    for (let i = 0; i < 8; i++) {
      const frames = await runInFrames(tabId, readArticleInFrame);
      const hit = frames.find((f) => f.found);
      if (hit) return { ...hit, hints: await runInFrames(tabId, cafeSlugHintsInFrame) };
      if (frames.some((f) => /nid\.naver\.com/.test(f.href || ""))) return { found: false, login: true };
      await sleep(1500);
    }
    return { found: false };
  });
}

function articleUrl(item) {
  const slug = cafeSlugs[item.cafeId] || item.slug;
  return slug ? shortArticleUrl(slug, item.articleId) : `https://cafe.naver.com/f-e/cafes/${item.cafeId}/articles/${item.articleId}`;
}

async function search() {
  if (running) return;
  let win;
  try {
    win = range();
  } catch (e) {
    return setSummary(e.message, "err");
  }
  const ids = cafeIds();
  const q = $("#query").value.trim();
  if (!ids.length) return setSummary("동호회 목록에 카페 주소를 넣어 주세요.", "err");
  if (!q) return setSummary("검색어를 넣어 주세요.", "err");
  await saveSettings();
  await checkLogin();
  running = true;
  stopRequested = false;
  $("#search").disabled = true;
  $("#stop").disabled = false;
  $("#log").innerHTML = "";
  diagnostics = [];
  $("#diag").hidden = true;
  items = [];
  renderResults();
  const maxPages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  const seen = new Set();
  let loginNeeded = false;

  for (let ci = 0; ci < ids.length && !stopRequested; ci++) {
    const cafeId = ids[ci];
    let prevKeys = "";
    for (let page = 1; page <= maxPages && !stopRequested; page++) {
      setSummary(`찾는 중… 동호회 ${ci + 1}/${ids.length} (${cafeNames[cafeId] || cafeId}) · ${page}페이지`);
      const res = await scanSearchPage(searchUrl(cafeId, q, page));
      if (res.login) {
        loginNeeded = true;
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
        log(`· ${cafeNames[cafeId] || cafeId}: ${page}페이지 ${pageItems.length ? "(앞 페이지와 같음)" : res.noResult ? "검색 결과 없음" : "글 목록을 읽지 못함"}`);
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
        const item = {
          key, cafeId, cafeIndex: ci, articleId: x.articleId, slug: x.slug || "", title: x.title, text: x.text,
          date: parsed ? parsed.date : null, hasTime: !!parsed?.hasTime, ambiguous: place === "ambiguous",
          checked: false, note: "", dup: false,
        };
        item.related = isRelated(item);
        item.checked = item.related;
        items.push(item);
        added++;
      }
      log(`· ${cafeNames[cafeId] || cafeId}: ${page}페이지 ${pageItems.length}개 중 기간 안 ${added}개`);
      renderResults();
      if (dated && older === dated) break; // 이 페이지가 모두 기간 이전 → 다음 페이지는 더 이전
      if (page < maxPages) await sleep(randomBetween(CAFE_PAGE_DELAY));
    }
    if (ci + 1 < ids.length && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }

  // 날짜만 보이는 관련 글(예: 어제 글)은 글을 열어 정확한 시간을 확인한다
  const toCheck = items.filter((x) => x.ambiguous && x.checked);
  for (let i = 0; i < toCheck.length && !stopRequested; i++) {
    const item = toCheck[i];
    setSummary(`날짜만 보이는 글의 시간 확인 중… (${i + 1}/${toCheck.length})`);
    await sleep(randomBetween(CAFE_ARTICLE_DELAY));
    const res = await readArticleTime(`https://cafe.naver.com/f-e/cafes/${item.cafeId}/articles/${item.articleId}`);
    if (res.found) {
      const parsed = parseCafeDate(res.dateText);
      const place = placeInRange(parsed, win);
      if (place === "older" || place === "newer") {
        items = items.filter((x) => x !== item);
        log(`· 기간 밖이라 뺌: ${item.title} (${formatDateTime(parsed.date)})`);
      } else {
        item.date = parsed.date;
        item.hasTime = true;
        item.ambiguous = false;
      }
      const slug = pickSlug(res.hints || []);
      if (slug && !cafeSlugs[item.cafeId]) {
        await saveCafeSlug(item.cafeId, slug);
        cafeSlugs[item.cafeId] = slug;
      }
    } else {
      item.note = res.login ? "로그인 필요 - 시간 확인 못 함" : "시간 확인 못 함";
    }
    renderResults();
  }

  await chrome.storage.local.set({ lx3CafeNames: cafeNames }).catch(() => {});
  $("#diag").hidden = !diagnostics.length;
  cafeSlugs = await loadCafeSlugs();
  renderCafeInfo();
  markDuplicates();
  renderResults();
  await chrome.storage.local
    .set({ lx3Last: { at: Date.now(), from: $("#from").value, to: $("#to").value, items: items.map(serializeItem) } })
    .catch(() => {});
  const checked = items.filter((x) => x.checked).length;
  setSummary(
    `${stopRequested ? "중지됨 - " : ""}찾은 글 ${items.length}개 (관련 글로 체크 ${checked}개)` +
      (loginNeeded ? " · 로그인이 필요한 카페가 있습니다" : "") +
      `. 필요 없는 글을 지운 뒤 '엑셀 받기'를 누르세요.`,
    loginNeeded ? "err" : "ok",
  );
  running = false;
  $("#search").disabled = false;
  $("#stop").disabled = true;
  updateCounts();
}

function serializeItem(x) {
  return { ...x, date: x.date ? x.date.getTime() : null };
}

// ---------------------------------------------------------------------------
// 결과 표
// ---------------------------------------------------------------------------

// 날짜순(일) → 동호회 목록 순 → 시간순
function sortedItems() {
  const day = (x) => (x.date ? new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate()).getTime() : Infinity);
  return [...items].sort(
    (a, b) => day(a) - day(b) || a.cafeIndex - b.cafeIndex || (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0),
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
    });
    tr.children[1].textContent = item.date ? formatDateTime(item.date, item.hasTime) : "날짜 모름";
    tr.children[2].textContent = cafeNames[item.cafeId] || item.cafeId;
    const a = tr.querySelector("a");
    a.href = url;
    a.textContent = item.title;
    tr.children[4].textContent = url;
    const notes = [];
    if (item.dup) notes.push("이미 파일에 있음");
    if (item.ambiguous) notes.push(item.note || "시간 미확인");
    else if (item.note) notes.push(item.note);
    if (!item.related) notes.push("관련 단어 없음");
    if (!(cafeSlugs[item.cafeId] || item.slug)) notes.push("영문 카페 주소 모름(설정에서 입력)");
    tr.children[5].textContent = notes.join(" · ");
    tr.querySelector(".del").addEventListener("click", () => {
      items = items.filter((x) => x !== item);
      renderResults();
    });
    tbody.appendChild(tr);
  }
  updateCounts();
}

function updateCounts() {
  const n = items.filter((x) => x.checked).length;
  $("#resultCount").textContent = items.length ? `전체 ${items.length}개 중 ${n}개 체크` : "";
  $("#saveList").disabled = !n || running;
  $("#toComments").disabled = (!n && !($("#withYoutube").checked && youtube.length)) || running;
  $("#checkAll").checked = !!items.length && n === items.length;
}

function normUrl(u) {
  const ids = parseArticleUrl(String(u || ""));
  if (ids.articleId && ids.cafeUrl) return `${ids.cafeUrl}/${ids.articleId}`.toLowerCase();
  return String(u || "")
    .trim()
    .replace(/^http:/, "https:")
    .replace(/[?#].*$/, "")
    .toLowerCase();
}

function markDuplicates() {
  const have = listFile ? listFile.urls : new Set();
  for (const item of items) {
    item.dup = have.has(normUrl(articleUrl(item)));
    if (item.dup && !item.touched) item.checked = false;
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
  const urls = new Set();
  for (const r of rows) {
    lastRow = Math.max(lastRow, r.r);
    const n = Number(r.cells.B);
    if (Number.isFinite(n)) lastSerial = Math.max(lastSerial, n);
    if (r.cells.G) urls.add(normUrl(r.cells.G));
  }
  for (const r of rows) if (String(r.cells.C || "").trim() === "동호회" && (!styleRow || r.r > styleRow)) styleRow = r.r;
  return { sheet, lastRow, lastSerial, styleRow: styleRow || (rows.length ? lastRow : HEADER_ROW + 1), count: rows.length, urls };
}

async function loadListFile(file) {
  const box = $("#listFileInfo");
  listFile = null;
  if (!file) {
    box.className = "hint";
    box.textContent = `파일을 고르지 않으면 같은 양식의 새 파일로 받습니다 (${datedFileName(rememberedListName())}).`;
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
    try {
      localStorage.setItem("lx3FileName", file.name);
    } catch {
      /* 무시 */
    }
    box.className = "hint ok";
    box.textContent =
      `✔ '${info.sheet}' 시트 ${info.count.toLocaleString()}행(마지막 순번 ${info.lastSerial.toLocaleString()}) 다음부터 이어 씁니다. ` +
      `이미 있는 글은 체크를 풀어 둡니다. 받을 파일: ${datedFileName(file.name)}`;
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
  if (listFile) {
    wb = await XlsxTemplate.Workbook.open(listFile.bytes);
    info = await analyzeList(wb);
  } else {
    const resp = await fetch(chrome.runtime.getURL("lx3-template.xlsx"));
    wb = await XlsxTemplate.Workbook.open(new Uint8Array(await resp.arrayBuffer()));
    info = { sheet: pickSheet(wb), lastRow: HEADER_ROW, lastSerial: 0, styleRow: HEADER_ROW + 1 };
  }
  let serial = info.lastSerial;
  const values = selected.map((x) => [
    null, ++serial, "동호회", cafeNames[x.cafeId] || x.cafeId,
    x.date ? excelSerial(x.hasTime ? x.date : new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate())) : "",
    x.title, articleUrl(x),
  ]);
  await wb.replaceRowsAfter(info.sheet, info.lastRow, values, info.styleRow, { focusFirstNew: true });
  const links = {};
  values.forEach((v, i) => (links[`G${info.lastRow + 1 + i}`] = v[6]));
  await wb.addHyperlinks(info.sheet, links);
  return { bytes: await wb.save(), from: info.lastSerial + 1, to: serial };
}

async function saveList() {
  const selected = sortedItems().filter((x) => x.checked);
  if (!selected.length) return;
  try {
    const out = await buildList(selected);
    const name = datedFileName(listFile ? listFile.name : rememberedListName());
    downloadBytes(out.bytes, name);
    lastSaved = selected;
    $("#saveInfo").className = "hint ok";
    $("#saveInfo").textContent = `✔ ${name} - ${selected.length}개 추가 (순번 ${out.from}~${out.to}). '체크한 글 댓글 수집하기'로 바로 댓글을 모을 수 있습니다.`;
    const noSlug = selected.filter((x) => !(cafeSlugs[x.cafeId] || x.slug));
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

function handOff(urls, message) {
  try {
    localStorage.setItem("urls", urls.join("\n"));
    sessionStorage.setItem("handoff", message);
  } catch {
    /* 무시 */
  }
  location.href = "app.html";
}

function toComments() {
  const cafe = sortedItems().filter((x) => x.checked).map(articleUrl);
  const yt = $("#withYoutube").checked ? youtube : [];
  handOff(
    [...cafe, ...yt],
    `LX3 메뉴에서 카페 글 ${cafe.length}개${yt.length ? `, 유튜브 영상 ${yt.length}개` : ""}를 가져왔습니다. ` +
      `기존 raw data 엑셀 파일을 고른 뒤 '수집 시작'을 누르세요.`,
  );
}

// ---------------------------------------------------------------------------
// 유튜브 영상 목록 (저장 · 추가 · 삭제)
// ---------------------------------------------------------------------------

let youtube = [];

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
  if (ok) box.textContent = "✔ 네이버에 로그인되어 있습니다.";
  else
    box.innerHTML =
      '카페 글을 찾으려면 네이버 로그인이 필요합니다. <a href="https://nid.naver.com/nidlogin.login" target="_blank">여기서 로그인</a>한 뒤 이 화면으로 돌아오세요.';
  return ok;
}

async function restoreLast() {
  const { lx3Last } = await chrome.storage.local.get("lx3Last").catch(() => ({}));
  if (!lx3Last?.items?.length) return;
  items = lx3Last.items.map((x) => ({ ...x, date: x.date ? new Date(x.date) : null }));
  markDuplicates();
  renderResults();
  setSummary(
    `지난번에 찾은 결과입니다 (${lx3Last.from.replace("T", " ")} ~ ${lx3Last.to.replace("T", " ")}, ${new Date(lx3Last.at).toLocaleString()} 찾음). 새로 찾으려면 '게시물 찾기'를 누르세요.`,
  );
}

async function init() {
  resetRange();
  await loadSettings();
  renderCafeInfo();
  renderYoutube();
  loadListFile(null);
  for (const id of ["cafeList", "include", "exclude", "searchUrl", "maxPages", "query"]) {
    $(`#${id}`).addEventListener("change", async () => {
      if (id === "searchUrl") $("#searchUrl").value = normalizeSearchUrl($("#searchUrl").value);
      await saveSettings();
      if (id === "cafeList") renderCafeInfo();
      if (id === "include" || id === "exclude") {
        for (const x of items) {
          x.related = isRelated(x);
          if (!x.touched && !x.dup) x.checked = x.related;
        }
        renderResults();
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
    await saveSettings();
    renderCafeInfo();
  });
  $("#resetRange").addEventListener("click", resetRange);
  $("#search").addEventListener("click", search);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 보는 화면까지 마칩니다)");
  });
  $("#checkAll").addEventListener("change", () => {
    for (const x of items) {
      x.checked = $("#checkAll").checked;
      x.touched = true;
    }
    renderResults();
  });
  $("#listFile").addEventListener("change", (e) => loadListFile(e.target.files[0]));
  $("#saveList").addEventListener("click", saveList);
  $("#toComments").addEventListener("click", toComments);
  $("#withYoutube").addEventListener("change", updateCounts);
  $("#ytAdd").addEventListener("click", addYoutube);
  $("#diag").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, at: new Date().toString(), diagnostics }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${today()}_LX3_진단.json`;
    a.click();
  });
  $("#ytInput").addEventListener("keydown", (e) => e.key === "Enter" && addYoutube());
  $("#ytCollect").addEventListener("click", () =>
    handOff(youtube, `LX3 메뉴에서 유튜브 영상 ${youtube.length}개를 가져왔습니다. 기존 raw data 엑셀 파일을 고른 뒤 '수집 시작'을 누르세요.`),
  );
  window.addEventListener("focus", checkLogin);
  checkLogin();
  await restoreLast();
}

init();
