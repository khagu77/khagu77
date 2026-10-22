// 네이버 카페 공통 도구 (댓글 수집 화면 · LX3 게시물 찾기 화면이 함께 씀)
// 네이버 API 를 직접 반복 호출하면 계정 보호조치가 걸릴 수 있어, 사람이 보듯 화면(탭)을 열어서만 읽는다.

// 사람처럼 천천히: 글과 글 사이, 페이지 사이를 무작위로 기다린다.
const CAFE_ARTICLE_DELAY = [4000, 8000];
const CAFE_PAGE_DELAY = [2000, 4000];

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomBetween = ([min, max]) => min + Math.floor(Math.random() * (max - min));
const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// URL 해석
// ---------------------------------------------------------------------------

const CAFES_ARTICLES_RE = /\/cafes\/(\d+)\/articles\/(\d+)/;
const CAFES_SLUG_ARTICLES_RE = /\/cafes\/([A-Za-z][A-Za-z0-9_-]*)\/articles\/(\d+)/; // m.cafe …/ca-fe/web/cafes/카페주소/articles/글번호
const CLUBID_RE = /clubid=(\d+)/i;
const ARTICLEID_RE = /articleid=(\d+)/i;
const SHORT_RE = /^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)(?:[/?#]|$)/;
// cafe.naver.com/xxx 에서 카페 주소가 아닌 것
const RESERVED_SLUGS = new Set(["f-e", "ca-fe", "cafes", "ArticleRead.nhn", "ArticleList.nhn", "MyCafeIntro.nhn", "section", "joinAgree"]);

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function isSlug(s) {
  return !!s && /^[A-Za-z0-9][A-Za-z0-9_-]{1,}$/.test(s) && !/^\d+$/.test(s) && !RESERVED_SLUGS.has(s);
}

// → { cafeId, articleId, cafeUrl } (모르는 값은 null)
function parseArticleUrl(url) {
  url = String(url || "").trim();
  let decoded = url;
  for (let i = 0; i < 3; i++) decoded = safeDecode(decoded);

  let m = decoded.match(CAFES_ARTICLES_RE);
  if (m) return { cafeId: m[1], articleId: m[2], cafeUrl: null };
  m = decoded.match(CAFES_SLUG_ARTICLES_RE);
  if (m && isSlug(m[1])) return { cafeId: null, articleId: m[2], cafeUrl: m[1] };

  const club = decoded.match(CLUBID_RE);
  const art = decoded.match(ARTICLEID_RE);
  if (club && art) return { cafeId: club[1], articleId: art[1], cafeUrl: null };

  m = url.match(SHORT_RE);
  if (m && isSlug(m[1])) return { cafeId: null, articleId: m[2], cafeUrl: m[1] };

  return { cafeId: club ? club[1] : null, articleId: art ? art[1] : null, cafeUrl: null };
}

function shortArticleUrl(slug, articleId) {
  return `https://cafe.naver.com/${slug}/${articleId}`;
}

// 카페 이름: <title>현대 아이오닉9 오너스 - 나이너스 : 네이버 카페</title> → 뒤의 ' : 네이버 카페' 를 뗀다
function cafeNameFromTitle(title) {
  return String(title || "")
    .replace(/\s*[:|-]\s*네이버\s*카페\s*$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// 카페 번호 → 영문 카페 주소(예: 16624720 → allfm01) 기억
// ---------------------------------------------------------------------------

async function loadCafeSlugs() {
  try {
    return (await chrome.storage.local.get("cafeSlugs")).cafeSlugs || {};
  } catch {
    return {};
  }
}

async function saveCafeSlug(cafeId, slug) {
  if (!cafeId || !isSlug(slug)) return;
  const map = await loadCafeSlugs();
  if (map[cafeId] === slug) return;
  map[cafeId] = slug;
  await chrome.storage.local.set({ cafeSlugs: map }).catch(() => {});
}

// 각 프레임 안에서 실행: 이 화면이 어느 카페(영문 주소)인지 알려주는 단서를 모은다.
// (확장 바깥 함수는 쓸 수 없으므로 혼자 동작해야 함)
function cafeSlugHintsInFrame() {
  const bad = new Set(["f-e", "ca-fe", "cafes", "section", "joinAgree"]);
  const ok = (s) => !!s && /^[A-Za-z0-9][A-Za-z0-9_-]{1,}$/.test(s) && !/^\d+$/.test(s) && !bad.has(s) && !/\.nhn$/i.test(s);
  const strong = [];
  const weak = [];
  const fromUrl = (u, list) => {
    let m = String(u).match(/^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9_.-]+)(?:\/(\d+))?(?:[/?#]|$)/);
    if (m && ok(m[1])) list.push(m[1]);
    m = String(u).match(/\/cafes\/([A-Za-z][A-Za-z0-9_-]*)\/(?:articles|menus)\b/);
    if (m && ok(m[1])) list.push(m[1]);
    m = String(u).match(/[?&](?:cluburl|cafeUrl|clubUrl)=([A-Za-z0-9_-]+)/i);
    if (m && ok(m[1])) list.push(m[1]);
  };
  fromUrl(location.href, strong);
  for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]']) {
    const el = document.querySelector(sel);
    const v = el && (el.getAttribute("content") || el.getAttribute("href"));
    if (v) fromUrl(v, strong);
  }
  try {
    for (const e of performance.getEntriesByType("resource")) {
      const m = e.name.match(/[?&](?:cluburl|cafeUrl|clubUrl)=([A-Za-z0-9_-]+)/i);
      if (m && ok(m[1])) strong.push(m[1]);
    }
  } catch {
    /* 무시 */
  }
  for (const s of document.querySelectorAll("script:not([src])")) {
    const text = s.textContent || "";
    for (const m of text.matchAll(/["']?(?:cafeUrl|clubUrl|cluburl|g_sCafeUrl)["']?\s*[:=]\s*["']([A-Za-z0-9_-]+)["']/g)) {
      if (ok(m[1])) strong.push(m[1]);
    }
    for (const m of text.matchAll(/g_sCafeHome\s*=\s*["']https?:\/\/cafe\.naver\.com\/([A-Za-z0-9_-]+)/g)) {
      if (ok(m[1])) strong.push(m[1]);
    }
  }
  for (const a of document.querySelectorAll("a[href]")) {
    const label = (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, "");
    const cls = String(a.className || "") + " " + String(a.parentElement?.className || "");
    if (/카페홈|카페메인/.test(label) || /cafe_name|cafe-name|cafeName|CafeName|cafe_info|cafe_link|home/i.test(cls)) fromUrl(a.href, strong);
    else fromUrl(a.href, weak);
  }
  const top = (window === window.top || (window.parent === window.top && (() => { try { return !window.top.location.href; } catch { return true; } })()));
  return { strong, weak, href: location.href, top, title: top ? document.title : "" };
}

// 여러 프레임의 단서 → 가장 그럴듯한 영문 주소 (강한 단서 우선, 약한 단서는 압도적일 때만)
function pickSlug(hintsList) {
  const count = (key) => {
    const c = new Map();
    for (const h of hintsList) for (const s of h?.[key] || []) c.set(s, (c.get(s) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  };
  const strong = count("strong");
  if (strong.length) return strong[0][0];
  const weak = count("weak");
  if (weak.length && weak[0][1] >= 3 && (weak.length === 1 || weak[0][1] >= weak[1][1] * 3)) return weak[0][0];
  return "";
}

// ---------------------------------------------------------------------------
// 화면(탭) 열어서 읽기
// ---------------------------------------------------------------------------

// 이 확장이 연 카페 화면 표시(#lx3bg): bg-render.js 가 이 탭에서만 '보이는 탭'처럼 그리게 한다
function markUrl(url) {
  return /^https?:\/\/(?:[\w-]+\.)?(?:cafe\.naver\.com|naver\.me)\//.test(url) && !url.includes("#") ? `${url}#lx3bg` : url;
}

// 카페 화면 열기. mode:
//  "frame"(기본) - 수집 화면 안의 보이지 않는 틀에서 연다. 새 탭·창이 뜨지 않아 실수로 닫을 일이 없다.
//  "tab"        - 뒤쪽 탭으로 연다 (보이지 않는 틀에서 못 읽었을 때 다시 읽기용)
//  "window"     - 작은 창을 잠깐 띄워서 연다
// fn 에는 읽을 곳(where)을 넘기고, runInFrames(where, …) 로 그 화면(과 그 안의 틀들)에서 함수를 실행한다.
async function withTab(url, fn, { visible = false, mode = visible ? "window" : "frame" } = {}) {
  if (mode === "frame") return withFrame(url, fn);
  let tab;
  let win = null;
  if (mode === "window") {
    win = await chrome.windows.create({ url: markUrl(url), focused: false, type: "popup", width: 1000, height: 760 });
    tab = win.tabs[0];
  } else {
    tab = await chrome.tabs.create({ url: markUrl(url), active: false });
  }
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(done, 30000);
      function done() {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
      function listener(id, info) {
        if (id === tab.id && info.status === "complete") done();
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    await sleep(3000); // 카페 화면(iframe/스크립트)이 그려질 시간
    return await fn({ tabId: tab.id });
  } finally {
    if (win) chrome.windows.remove(win.id).catch(() => {});
    else chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// 이 탭(수집 화면) 안의 틀에 카페 화면을 넣을 수 있게, 이 탭에서 여는 카페 틀에만 '틀 안 표시 금지' 머리글을 뗀다
async function allowCafeFrames(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [10],
    addRules: [{
      id: 10,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition: {
        tabIds: [tabId],
        resourceTypes: ["sub_frame"],
        requestDomains: ["cafe.naver.com", "m.cafe.naver.com", "naver.me", "nid.naver.com"],
      },
    }],
  });
}

async function withFrame(url, fn) {
  const me = await chrome.tabs.getCurrent();
  if (!me) throw new Error("수집 화면 탭을 찾지 못했습니다");
  await allowCafeFrames(me.id);
  const before = new Set(((await chrome.webNavigation.getAllFrames({ tabId: me.id })) || []).map((f) => f.frameId));
  const frame = document.createElement("iframe");
  // 화면 뒤에 투명하게 (화면 밖에 두면 크롬이 그리기를 멈출 수 있음). 크기는 실제 화면처럼 줘야 카페 화면이 목록을 그린다
  frame.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none;z-index:-1";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // 카페 화면이 수집 화면 자체를 다른 주소로 바꾸지 못하게(allow-top-navigation 없음)
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
  frame.src = markUrl(url);
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 30000);
      frame.addEventListener("load", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      document.body.appendChild(frame);
    });
    await sleep(3000); // 카페 화면(스크립트)이 그려질 시간
    const frames = (await chrome.webNavigation.getAllFrames({ tabId: me.id })) || [];
    const root = frames.find((f) => f.parentFrameId === 0 && !before.has(f.frameId));
    if (!root) throw new Error("카페 화면 틀을 찾지 못했습니다");
    return await fn({ tabId: me.id, rootId: root.frameId });
  } finally {
    frame.remove();
  }
}

// 읽을 곳 → scripting 대상 (탭이면 그 탭의 모든 틀, 보이지 않는 틀이면 그 틀과 그 안의 틀들)
async function frameTarget(where) {
  if (typeof where === "number") return { tabId: where, allFrames: true };
  if (where.rootId === undefined) return { tabId: where.tabId, allFrames: true };
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: where.tabId }).catch(() => [])) || [];
  const ids = new Set([where.rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of frames) {
      if (!ids.has(f.frameId) && ids.has(f.parentFrameId)) {
        ids.add(f.frameId);
        grew = true;
      }
    }
  }
  return { tabId: where.tabId, frameIds: [...ids] };
}

async function runInFrames(where, func, args = []) {
  try {
    const res = await chrome.scripting.executeScript({ target: await frameTarget(where), func, args });
    return res.map((r) => r.result).filter(Boolean);
  } catch {
    return [];
  }
}

// 보이지 않는 틀에서 못 읽었을 때 뒤쪽 탭으로 다시 읽을지 (설정, 기본 켜짐)
async function tabFallbackOn() {
  const { lx3TabFallback } = await chrome.storage.local.get("lx3TabFallback").catch(() => ({}));
  return lx3TabFallback ?? true;
}

// ---------------------------------------------------------------------------
// 게시 날짜 읽기: "2026.10.11. 15:22" / "2026.10.11." / "15:22"(오늘) / "3시간 전" / "어제"
// → { date: Date, hasTime } 또는 null
// ---------------------------------------------------------------------------

function parseCafeDate(text, now = new Date()) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  let m = s.match(/(\d{4}|\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?(?:\s*(?:오전|오후)?\s*(\d{1,2}):(\d{2}))?/);
  if (m) {
    let y = Number(m[1]);
    if (y < 100) y += 2000;
    let h = m[4] !== undefined ? Number(m[4]) : 0;
    if (m[4] !== undefined && /오후\s*\d{1,2}:/.test(s) && h < 12) h += 12;
    return { date: new Date(y, Number(m[2]) - 1, Number(m[3]), h, m[5] !== undefined ? Number(m[5]) : 0), hasTime: m[4] !== undefined };
  }
  m = s.match(/(\d+)\s*(분|시간)\s*전/);
  if (m) return { date: new Date(now.getTime() - Number(m[1]) * (m[2] === "분" ? 60e3 : 3600e3)), hasTime: true };
  if (/방금/.test(s)) return { date: new Date(now), hasTime: true };
  if (/어제/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { date: d, hasTime: false };
  }
  m = s.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?(?:\s|$)/);
  if (m) return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2])), hasTime: true };
  return null;
}

function formatDateTime(d, withTime = true) {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

// 엑셀 날짜 값(1900 기준 일련번호, 이 PC 시간대 그대로)
function excelSerial(d) {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - Date.UTC(1899, 11, 30)) / 86400000;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// 파일명 맨 앞 날짜(YYYYMMDD)를 오늘 날짜로 바꾼다.
function datedFileName(baseName) {
  let name = String(baseName).replace(/\s*\(\d+\)(?=\.xlsx$)/i, ""); // "파일 (1).xlsx" 정리
  if (!/\.xlsx$/i.test(name)) name += ".xlsx";
  return /^\d{8}/.test(name) ? today() + name.slice(8) : `${today()}_${name}`;
}

// 저장 위치: 크롬 '다운로드' 폴더 안의 폴더 이름(예: 팰리세이드 모니터링/일일보고) · 받을 때마다 위치 묻기
// (확장프로그램은 다운로드 폴더 밖의 위치를 직접 정할 수 없어, 그 밖은 '매번 묻기'로 고른다)
function cleanFolder(f) {
  return String(f || "")
    .split(/[\\/]+/)
    .map((p) => p.trim().replace(/[<>:"|?*\x00-\x1f]/g, "").replace(/^\.+$/, ""))
    .filter(Boolean)
    .join("/");
}

async function saveOptions() {
  const s = await chrome.storage.local.get(["saveFolder", "saveAsk"]).catch(() => ({}));
  return { folder: cleanFolder(s.saveFolder), ask: !!s.saveAsk };
}

function saveWhereText({ folder, ask }) {
  return ask ? "받을 때마다 위치를 묻습니다" : `다운로드${folder ? ` / ${folder}` : ""} 폴더`;
}

// 파일 받기: blob: 주소 대신 data: 주소로 받는다.
// (blob: 로 받으면 크롬이 맥 파일 정보 '출처'에 chrome-extension://… 주소를 남기는데, data: 주소는 출처를 남기지 않음)
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// 맥: 받은 파일의 '출처' 정보는 백그라운드(meta-clean.js)가 빠른다운로드 도우미로 지운다.
// 받기 전에 파일 이름을 적어 두고, 처리 결과(lastClean)를 화면 아래 알림으로 보여준다.
async function registerClean(name) {
  try {
    const { pendingClean = [] } = await chrome.storage.session.get("pendingClean");
    const now = Date.now();
    await chrome.storage.session.set({ pendingClean: [...pendingClean.filter((p) => p.until > now), { name, until: now + 10 * 60e3 }] });
  } catch {
    /* 무시 */
  }
}

const CLEAN_NOTICE = {
  ok: "✔ 받은 파일의 '출처' 정보를 지웠습니다.",
  old: "⚠ 빠른다운로드 도우미가 예전 버전이라 '출처' 정보를 지우지 못했습니다. 유튜브추출기 압축 안의 '빠른다운로드_도우미설치.app'을 한 번 다시 실행해 주세요.",
  none: "⚠ 빠른다운로드 도우미가 없어 '출처' 정보를 지우지 못했습니다. 유튜브추출기 압축 안의 '빠른다운로드_도우미설치.app'을 실행하면 다음부터 자동으로 지웁니다.",
  refused: "⚠ '출처' 정보를 지우지 못했습니다(내 폴더 밖에 저장된 파일).",
  error: "⚠ '출처' 정보를 지우는 중 오류가 났습니다.",
};

function showCleanNotice(r) {
  let box = document.getElementById("cleanNotice");
  if (!box) {
    box = document.createElement("div");
    box.id = "cleanNotice";
    box.style.cssText =
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:min(720px,92vw);padding:9px 14px;border-radius:8px;" +
      "font-size:13px;line-height:1.45;box-shadow:0 2px 10px rgba(0,0,0,.25);z-index:9999;color:#fff;";
    document.body.appendChild(box);
  }
  box.style.background = r.ok ? "#002c5f" : "#b3261e";
  box.textContent = `${CLEAN_NOTICE[r.ok ? "ok" : r.reason] || CLEAN_NOTICE.error} (${r.name})`;
  clearTimeout(box._t);
  box._t = setTimeout(() => box.remove(), r.ok ? 6000 : 20000);
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.lastClean?.newValue) showCleanNotice(changes.lastClean.newValue);
  });
}

async function clickDownload(blob, name) {
  await registerClean(name);
  const a = document.createElement("a");
  a.href = await blobToDataUrl(blob);
  a.download = name;
  a.rel = "noreferrer";
  a.referrerPolicy = "no-referrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const { folder, ask } = await saveOptions();
  if (folder || ask) {
    try {
      const url = await blobToDataUrl(blob);
      await registerClean(name);
      await chrome.downloads.download({ url, filename: folder ? `${folder}/${name}` : name, saveAs: ask, conflictAction: "uniquify" });
      return;
    } catch {
      /* 아래 기본 방식으로 */
    }
  }
  await clickDownload(blob, name);
}

// ---------------------------------------------------------------------------
// 진행 막대: 수집·찾기 중에 화면 맨 위(스크롤해도 보임)와 탭 제목에 진행 상황을 보여준다
// ---------------------------------------------------------------------------

let busyTitle = "";

function showBusy(label, done, total, short = "작업 중") {
  let bar = document.getElementById("busyBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "busyBar";
    bar.className = "busy";
    bar.innerHTML = '<div class="busy-text"></div><div class="busy-track"><div class="busy-fill"></div></div>';
    (document.querySelector("main") || document.body).prepend(bar);
    busyTitle = document.title;
    window.addEventListener("beforeunload", busyGuard);
    document.body.classList.add("busy-lock"); // 수집 중에는 위쪽 메뉴로 다른 화면에 가지 못하게
  }
  const pct = total ? Math.max(2, Math.min(100, Math.round((done / total) * 100))) : 0;
  bar.querySelector(".busy-text").textContent = `⏳ ${label}${total ? ` · ${pct}%` : ""}`;
  const fill = bar.querySelector(".busy-fill");
  fill.style.width = total ? `${pct}%` : "100%";
  fill.classList.toggle("indeterminate", !total);
  document.title = `⏳ ${total ? `${Math.min(done + 1, total)}/${total} ` : ""}${short}`;
}

function hideBusy() {
  document.getElementById("busyBar")?.remove();
  document.body.classList.remove("busy-lock");
  if (busyTitle) document.title = busyTitle;
  busyTitle = "";
  window.removeEventListener("beforeunload", busyGuard);
}

// 수집 중에 창을 닫거나 새로고침하려 하면 확인 (그대로 나가면 수집이 멈춤)
function busyGuard(e) {
  e.preventDefault();
  e.returnValue = "";
}

// ---------------------------------------------------------------------------
// 이어하기: 수집·찾기 중 진행 상황을 저장해 두고, 실수로 화면을 벗어났다가 다시 열면 이어서 할지 묻는다
// ---------------------------------------------------------------------------

async function saveResume(kind, state) {
  await chrome.storage.local.set({ [`resume_${kind}`]: { ...state, at: Date.now() } }).catch(() => {});
}

async function loadResume(kind) {
  return (await chrome.storage.local.get(`resume_${kind}`).catch(() => ({})))[`resume_${kind}`] || null;
}

async function clearResume(kind) {
  await chrome.storage.local.remove(`resume_${kind}`).catch(() => {});
}

// 위쪽 띠 제목 옆 버전 표시
document.addEventListener("DOMContentLoaded", () => {
  const v = document.getElementById("ver");
  if (v) v.textContent = `v${chrome.runtime.getManifest().version}`;
});
