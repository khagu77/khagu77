// 앱 뼈대: 로그인 확인 → 사이드바·상단바 → 화면 전환(#/주소)
import { createBackend, IS_DEMO } from "./backend.js";
import { $, $$, h, esc, toast, dayKey, ROLE, setCafeNames, chIcon, CH_IMG } from "./ui.js";
import { renderLogin, renderPending } from "./views/login.js";

const store = { be: null, me: null, settings: null, live: { items: [] }, status: {}, today: null, listeners: new Set() };
store.emit = (ev) => store.listeners.forEach((f) => f(ev));
store.isAdmin = () => store.me?.role === "admin";
store.isEditor = () => ["admin", "editor"].includes(store.me?.role);

const VIEWS = {
  dashboard: () => import("./views/dashboard.js"),
  posts: () => import("./views/posts.js"),
  settings: () => import("./views/settings.js"),
  users: () => import("./views/users.js"),
  me: () => import("./views/me.js"),
};

const theme = (() => { try { return localStorage.getItem("hdmon-theme"); } catch { return null; } })();
if (theme) document.documentElement.dataset.theme = theme;

function bgFx() {
  if (!$(".bg-fx")) document.body.prepend(h(`<div class="bg-fx"><div class="grid"></div><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>`));
}

async function boot() {
  bgFx();
  if (IS_DEMO) document.body.append(h(`<div class="demo-flag">DEMO · 예시 데이터</div>`));
  try {
    store.be = await createBackend();
  } catch (e) {
    document.body.append(h(`<div class="empty"><div class="big">⚙️</div>Firebase 설정을 불러오지 못했습니다.<br>Firebase Hosting 에 배포된 주소로 접속해 주세요.<br><small>${esc(e.message)}</small></div>`));
    return;
  }
  store.be.onAuth(async (user) => {
    cleanupShell();
    if (!user) return renderLogin(document.body, store);
    try {
      store.me = await store.be.me(store.pendingProfile || {});
    } catch (e) {
      toast(e.message, "err");
      return renderLogin(document.body, store);
    }
    if (store.me.status !== "active") return renderPending(document.body, store);
    await startShell();
  });
}

let shellSubs = [];
function cleanupShell() {
  shellSubs.forEach((f) => f && f());
  shellSubs = [];
  $(".app")?.remove();
  $(".auth")?.remove();
}

async function startShell() {
  store.settings = await store.be.getSettings();
  setCafeNames(store.settings.favCafes);
  const app = h(`<div class="app">
    <aside class="sidebar">
      <div class="brand"><img class="brand-logo" src="/img/hyundai-logo-white.png" alt="HYUNDAI"><div class="brand-text"><b>온라인 이슈 모니터링</b><span>HYUNDAI · GENESIS</span></div></div>
      <nav class="nav" id="nav"><span class="nav-indicator"></span></nav>
      <div class="side-foot">
        <div class="live-pill"><span class="dot" id="liveDot"></span><span id="liveText">연결 중…</span></div>
        <button class="btn sm ghost" id="themeBtn" style="justify-content:flex-start">🌓 화면 밝기 바꾸기</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn sm menu-btn" id="menuBtn">☰</button>
        <form class="gsearch" id="gsearch"><input name="q" placeholder="전체 게시물 검색 (제목·내용, 여러 단어 · -제외어)" autocomplete="off"/><kbd>/</kbd></form>
        <div class="top-right">
          <span class="hint" id="whoami"></span>
          <div class="avatar" id="avatar" title="내 정보">${esc((store.me.name || store.me.email || "?").slice(0, 1))}</div>
        </div>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`);
  document.body.append(app);
  $("#whoami").textContent = `${store.me.name || store.me.email} · ${ROLE[store.me.role] || ""}`;
  $("#avatar").onclick = () => (location.hash = "#/me");
  $("#menuBtn").onclick = () => $(".sidebar").classList.toggle("open");
  $("#themeBtn").onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("hdmon-theme", next); } catch {}
    store.emit({ type: "theme" });
  };
  $("#gsearch").onsubmit = (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    location.hash = `#/posts/all?q=${encodeURIComponent(q)}`;
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName)) { e.preventDefault(); $("#gsearch input")?.focus(); }
  });

  shellSubs.push(store.be.watchSettings((s) => { if (s) { store.settings = s; setCafeNames(s.favCafes); buildNav(); store.emit({ type: "settings" }); } }));
  shellSubs.push(store.be.watchLive((l) => {
    const prevTop = store.live.items?.[0]?.id;
    store.live = l;
    if (prevTop && l.items?.[0]?.id !== prevTop) { refreshToday(true); store.emit({ type: "live", live: l }); }
  }));
  shellSubs.push(store.be.watchStatus((s) => { store.status = s; updateLiveDot(); store.emit({ type: "status" }); }));
  const dotTimer = setInterval(updateLiveDot, 30000);
  shellSubs.push(() => clearInterval(dotTimer));
  buildNav();
  await refreshToday();
  window.addEventListener("hashchange", route);
  shellSubs.push(() => window.removeEventListener("hashchange", route));
  route();
}

function updateLiveDot() {
  const at = store.status?.lastRun?.at;
  const d = at ? (at.toDate ? at.toDate() : new Date(at)) : null;
  const min = d ? (Date.now() - d.getTime()) / 60000 : Infinity;
  const dot = $("#liveDot");
  if (!dot) return;
  dot.className = `dot ${min < 12 ? "" : min < 60 ? "warn" : "err"}`;
  $("#liveText").textContent = d ? `실시간 수집 중 · ${Math.max(0, Math.round(min))}분 전 수집` : "수집 기록 없음";
}

async function refreshToday(bump = false) {
  const k = dayKey();
  const [s] = await store.be.getStats(k, k);
  const prev = store.today?.cat || {};
  store.today = s || { cat: {} };
  for (const a of $$("#nav a[data-cat]")) {
    const c = a.querySelector(".cnt");
    const v = store.today.cat?.[a.dataset.cat] || 0;
    if (c.textContent !== String(v)) {
      c.textContent = v;
      if (bump && v > (prev[a.dataset.cat] || 0)) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
    }
  }
}

const CAT_ICO = { all: "🗂", community: "🚗", garbage: "🗑" };
// 사이드바 카테고리 아이콘: 채널 하나짜리 카테고리는 그 채널 아이콘(언론사·카페·블로그·유튜브·인스타그램), 나머지는 기호
function catIcon(c) {
  if (CAT_ICO[c.id]) return CAT_ICO[c.id];
  const chs = (c.channels || []).filter((x) => x !== "*" && x !== "post");
  if (chs.length === 1 && (CH_IMG[chs[0]] || chs[0] === "news")) return chIcon(chs[0], true);
  return "▪";
}
function buildNav() {
  const nav = $("#nav");
  if (!nav) return;
  const cats = store.settings.categories || [];
  const top = cats.filter((c) => !c.parent);
  let html = `<span class="nav-indicator"></span><div class="nav-sec">메뉴</div><a href="#/dashboard" data-route="dashboard"><span class="ico">◎</span>대시보드</a><div class="nav-sec">카테고리 <span style="float:right;text-transform:none;letter-spacing:0">오늘</span></div>`;
  for (const c of top) {
    html += `<a href="#/posts/${esc(c.id)}" data-cat="${esc(c.id)}"><span class="ico">${catIcon(c)}</span>${esc(c.name)}<span class="cnt">${store.today?.cat?.[c.id] || 0}</span></a>`;
    for (const ch of cats.filter((x) => x.parent === c.id)) {
      html += `<a class="child" href="#/posts/${esc(ch.id)}" data-cat="${esc(ch.id)}">${esc(ch.name)}<span class="cnt">${store.today?.cat?.[ch.id] || 0}</span></a>`;
    }
  }
  html += `<div class="nav-sec">관리</div>`;
  if (store.isAdmin()) html += `<a href="#/settings" data-route="settings"><span class="ico">⚙</span>설정</a><a href="#/users" data-route="users"><span class="ico">👥</span>사용자 관리</a>`;
  html += `<a href="#/me" data-route="me"><span class="ico">🔔</span>내 알림 · 정보</a><a href="#" id="logout"><span class="ico">⎋</span>로그아웃</a>`;
  nav.innerHTML = html;
  $("#logout").onclick = (e) => { e.preventDefault(); store.be.signOut(); };
  markNav();
}

function markNav() {
  const [route, arg] = parseHash();
  let on = null;
  for (const a of $$("#nav a")) {
    const hit = (route === "posts" && a.dataset.cat === (arg || "all")) || (route !== "posts" && a.dataset.route === route);
    a.classList.toggle("on", hit);
    if (hit) on = a;
  }
  const ind = $("#nav .nav-indicator");
  if (ind) {
    ind.style.opacity = on ? 1 : 0;
    if (on) { ind.style.transform = `translateY(${on.offsetTop}px)`; ind.style.height = `${on.offsetHeight}px`; }
  }
}

function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const [route = "dashboard", arg = ""] = path.split("/");
  return [route || "dashboard", decodeURIComponent(arg), new URLSearchParams(qs || "")];
}

let current = null;
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const [route, arg, qs] = parseHash();
  markNav();
  $(".sidebar")?.classList.remove("open");
  const load = VIEWS[route] || VIEWS.dashboard;
  if ((route === "settings" || route === "users") && !store.isAdmin()) { location.hash = "#/dashboard"; return; }
  const mod = await load();
  if (seq !== routeSeq) return;
  current?.cleanup?.();
  const content = $("#content");
  content.innerHTML = "";
  const root = h(`<div class="view"></div>`);
  content.append(root);
  window.scrollTo({ top: 0 });
  current = (await mod.render(root, store, { arg, qs })) || null;
}

boot();
