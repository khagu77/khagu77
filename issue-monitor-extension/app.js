// 부정 이슈 모니터링 - 수집/설정 화면

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const AUTO = params.get("auto") === "1";

const state = {
  settings: null,
  running: false,
  stopRequested: false,
  rows: [], // 보고서 행
  range: null,
  costUsd: 0,
};

// ---------------------------------------------------------------------------
// 공통 화면 도구
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function log(msg, cls = "") {
  msg = korMsg(msg);
  const now = new Date();
  const line = `[${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}] ${msg}`;
  const pre = $("#log");
  pre.append(cls === "err" ? el("span", { class: "err", text: line + "\n" }) : line + "\n");
  pre.scrollTop = pre.scrollHeight;
  console.log(line);
  heartbeat(msg);
}

// ---------------------------------------------------------------------------
// 수집 중 안전장치
// - 맥이 잠자기로 들어가지 않게 (화면은 꺼져도 됨)
// - 크롬이 이 탭을 메모리 절약으로 버리지 않게
// - 진행 신호(heartbeat)를 남겨, 백그라운드가 오래 멈춘 걸 보면 이 탭을 앞으로 가져와 깨운다
// ---------------------------------------------------------------------------
let lastBeat = 0;
const RUN_OWNER = `${Date.now()}-${Math.random().toString(36).slice(2)}`; // 이 탭의 수집 표시
function heartbeat(msg) {
  if (!state || !state.running) return;
  const now = Date.now();
  if (now - lastBeat < 15000) return;
  lastBeat = now;
  chrome.storage.local.set({ runHeartbeat: { at: now, owner: RUN_OWNER, msg: String(msg || "").slice(0, 120) } }).catch(() => {});
}

// 다른 탭에서 수집 중인지 (진행 신호가 10분 안에 있었으면 수집 중으로 본다)
async function otherRunActive() {
  const { runHeartbeat: hb } = await chrome.storage.local.get("runHeartbeat");
  return hb && hb.owner && hb.owner !== RUN_OWNER && Date.now() - hb.at < 10 * 60 * 1000 ? hb : null;
}

async function runGuard(on) {
  try {
    if (on) chrome.power && chrome.power.requestKeepAwake("system");
    else chrome.power && chrome.power.releaseKeepAwake();
  } catch {}
  try {
    const me = await chrome.tabs.getCurrent();
    if (me) await chrome.tabs.update(me.id, { autoDiscardable: !on });
  } catch {}
  lastBeat = 0;
  if (on) {
    await chrome.storage.local.set({ runHeartbeat: { at: Date.now(), owner: RUN_OWNER, msg: "수집 시작" } }).catch(() => {});
    chrome.runtime.sendMessage({ type: "runStarted" }).catch(() => {});
  } else {
    const { runHeartbeat: hb } = await chrome.storage.local.get("runHeartbeat").catch(() => ({}));
    if (!hb || !hb.owner || hb.owner === RUN_OWNER) await chrome.storage.local.remove("runHeartbeat").catch(() => {});
    document.title = state.stopRequested ? "⏹ 중지됨 - 부정 이슈 모니터링" : "✅ 수집 완료 - 부정 이슈 모니터링";
    chrome.runtime.sendMessage({ type: "runEnded" }).catch(() => {});
  }
}

function setSummary(text) {
  $("#summary").textContent = korMsg(text);
}

function showTab(name) {
  for (const b of document.querySelectorAll("nav .tab")) b.classList.toggle("active", b.dataset.tab === name);
  for (const t of ["collect", "ppt", "db", "prompt", "settings"]) $(`#tab-${t}`).hidden = t !== name;
  if (name === "ppt") sendPptSource();
  if (name === "db") renderDb();
  if (name === "prompt") renderPrompt();
}

$("#toPpt").addEventListener("click", () => showTab("ppt"));
window.isCollecting = () => !!state.running; // PPT 화면에서 확인 (수집 중엔 캡처를 막음)

// ---------------------------------------------------------------------------
// PPT·RAW 작성 탭: 수집 모드가 '전체'면 지금 결과 표(검토·수정한 그대로)를 엑셀로 만들어 넘기고,
// '1인용'이면 넘기지 않는다 (PPT 화면에서 전체 엑셀을 직접 첨부해야 작성 가능)
// ---------------------------------------------------------------------------
async function sendPptSource() {
  const win = $("#pptFrame").contentWindow;
  if (!win || !win.PptBridge) {
    $("#pptFrame").addEventListener("load", () => sendPptSource(), { once: true });
    return;
  }
  if (win.PptBridge.isBusy()) return; // 캡처·요약 중에는 자료를 바꾸지 않음
  const mode = state.settings.collectMode === "solo" ? "solo" : "all";
  const titles = {};
  for (const r of state.rows) if (r.title) titles[r.url] = r.title;
  let bytes = null;
  if (mode === "all" && state.rows.length) bytes = ReportXlsx.build(state.rows);
  const label = state.range ? `수집 결과 ${fmtDateTime(state.range.start)}~${fmtDateTime(state.range.end)}` : "수집 결과";
  try {
    await win.PptBridge.setSource({ mode, bytes, label, titles });
  } catch (e) {
    log(`PPT 화면에 자료를 넘기지 못했습니다: ${e.message}`, "err");
  }
}

for (const btn of document.querySelectorAll("nav .tab")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll("nav .tab")) b.classList.toggle("active", b === btn);
    showTab(btn.dataset.tab);
  });
}

// ---------------------------------------------------------------------------
// 네이버 로그인 상태
// ---------------------------------------------------------------------------

async function checkLogin() {
  const box = $("#login");
  try {
    const c = await chrome.cookies.get({ url: "https://www.naver.com", name: "NID_AUT" });
    if (c) {
      box.className = "status ok";
      box.textContent = "네이버 로그인됨 ✓";
      return true;
    }
  } catch {
    // 무시
  }
  box.className = "status bad";
  box.textContent = "";
  box.append("네이버에 로그인돼 있지 않습니다. 카페 수집 전에 ", el("a", { href: "https://nid.naver.com/nidlogin.login", target: "_blank", text: "네이버 로그인" }), " 해 주세요. (커뮤니티는 로그인 없이 수집됩니다)");
  return false;
}

// ---------------------------------------------------------------------------
// 수집 기간 / 수집할 곳 고르기
// ---------------------------------------------------------------------------

function setRange(start, end) {
  $("#rangeStart").value = toLocalInputValue(start);
  $("#rangeEnd").value = toLocalInputValue(end);
}

function readRange() {
  const start = new Date($("#rangeStart").value);
  const end = new Date($("#rangeEnd").value);
  if (isNaN(start) || isNaN(end) || start >= end) throw new Error("수집 기간을 확인해 주세요 (시작이 끝보다 앞이어야 합니다)");
  return { start, end };
}

function renderRangeDefaultLabel() {
  const s = state.settings;
  const workday = s.workdayReport && isWorkday(new Date(), s);
  $("#rangeDefault").textContent = `기본값 (${workday ? "직전 근무일" : "전일"} ${s.rangeStartTime || s.cutoffTime || "07:30"} ~ 금일 ${s.cutoffTime || "07:30"})`;
}

// 수집 화면에서 입력한 시작·끝 시각을 기본값으로 저장 (날짜는 매일 자동으로 바뀜)
$("#saveRangeDefault").addEventListener("click", async () => {
  const hm = (v) => (String(v || "").match(/T(\d{2}:\d{2})/) || [])[1];
  const st = hm($("#rangeStart").value);
  const en = hm($("#rangeEnd").value);
  if (!st || !en) return ($("#rangeSaved").textContent = "시작·끝 시각을 먼저 입력해 주세요");
  const s = await loadSettings();
  s.rangeStartTime = st;
  s.cutoffTime = en;
  await saveSettings(s);
  state.settings = s;
  draft.rangeStartTime = st;
  draft.cutoffTime = en;
  $("#rangeStartTime").value = st;
  $("#cutoffTime").value = en;
  renderRangeDefaultLabel();
  $("#rangeSaved").textContent = `저장했습니다: 다음부터 전일 ${st} ~ 금일 ${en}`;
});

// 날짜가 바뀌면(수집 화면을 밤새 열어 둔 경우 등) 수집 기간 기본값을 오늘 기준으로 다시 맞춘다.
// 같은 날 안에서 직접 바꾼 기간은 그대로 둔다. 수집 중이면 건드리지 않는다
let rangeDay = new Date().toDateString();
function refreshRangeIfNewDay() {
  const today = new Date().toDateString();
  if (today === rangeDay || state.running) return;
  rangeDay = today;
  const r = defaultRange(new Date(), state.settings);
  // 이어서 작성할 기록을 골라 두었으면 시작은 그 기록이 끝난 시각
  setRange(state.base && state.base.end && state.base.end < r.end.getTime() ? new Date(state.base.end) : r.start, r.end);
  renderRangeDefaultLabel();
  log(`날짜가 바뀌어 수집 기간을 오늘 기준으로 맞췄습니다 (${fmtDateTime(r.start)} ~ ${fmtDateTime(r.end)})`);
}
setInterval(refreshRangeIfNewDay, 60 * 1000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshRangeIfNewDay());
window.addEventListener("focus", refreshRangeIfNewDay);

$("#rangeDefault").addEventListener("click", () => {
  const r = defaultRange(new Date(), state.settings);
  setRange(r.start, r.end);
});
$("#range3h").addEventListener("click", () => {
  const end = new Date();
  setRange(new Date(end.getTime() - 3 * 3600 * 1000), end);
});

function renderPickList() {
  const box = $("#pickList");
  box.textContent = "";
  const s = state.settings;
  box.append(el("div", { class: "group", text: "네이버 카페" }));
  s.cafes.forEach((c, i) => {
    if (!c.on || !c.id) return;
    const on = s.collectMode !== "solo" || (s.soloCafes || []).includes(c.id);
    box.append(el("label", {}, el("input", { type: "checkbox", "data-kind": "cafe", "data-i": i, checked: on, onchange: updatePickCount }), c.name || c.id));
  });
  box.append(el("div", { class: "group", text: "자동차 커뮤니티" }));
  s.communities.forEach((c, i) => {
    if (!c.on || !c.url) return;
    box.append(el("label", {}, el("input", { type: "checkbox", "data-kind": "community", "data-i": i, checked: true, onchange: updatePickCount }), c.name || c.url));
  });
  updatePickCount();
}

// 수집 모드: 전체 / 1인용
function renderMode() {
  const s = state.settings;
  for (const r of document.querySelectorAll("input[name=collectMode]")) r.checked = r.value === (s.collectMode || "all");
  $("#soloBox").hidden = s.collectMode !== "solo";
  $("#soloPrefix").value = s.soloPrefix || "";
}

async function saveModeSettings(patch) {
  const s = await loadSettings();
  Object.assign(s, patch);
  await saveSettings(s);
  state.settings = s;
  draft = structuredClone(s);
}

for (const r of document.querySelectorAll("input[name=collectMode]")) {
  r.addEventListener("change", async () => {
    await saveModeSettings({ collectMode: r.value });
    renderMode();
    renderPickList();
  });
}
$("#soloPrefix").addEventListener("change", (e) => saveModeSettings({ soloPrefix: e.target.value.trim() }));
$("#saveSolo").addEventListener("click", async () => {
  const ids = pickedSources().cafes.map((c) => c.id);
  await saveModeSettings({ soloCafes: ids });
  $("#soloInfo").textContent = `1인용 카페 ${ids.length}곳을 저장했습니다.`;
});

function pickedSources() {
  const cafes = [];
  const communities = [];
  for (const cb of document.querySelectorAll("#pickList input:checked")) {
    const i = +cb.dataset.i;
    if (cb.dataset.kind === "cafe") cafes.push(state.settings.cafes[i]);
    else communities.push(state.settings.communities[i]);
  }
  return { cafes, communities };
}

function updatePickCount() {
  const { cafes, communities } = pickedSources();
  $("#sourceCount").textContent = `— 카페 ${cafes.length}곳, 커뮤니티 ${communities.length}곳`;
}

function setAllPicks(fn) {
  [...document.querySelectorAll("#pickList input")].forEach((cb, idx) => (cb.checked = fn(cb, idx)));
  updatePickCount();
}
$("#pickAll").addEventListener("click", () => setAllPicks(() => true));
$("#pickNone").addEventListener("click", () => setAllPicks(() => false));
$("#pickTest").addEventListener("click", () => {
  let cafes = 0;
  let comms = 0;
  setAllPicks((cb) => (cb.dataset.kind === "cafe" ? cafes++ < 2 : comms++ < 1));
});

function updateAiInfo() {
  const s = state.settings;
  const m = MODELS.find((x) => x.id === s.model) || MODELS[0];
  if (!s.apiKey) {
    $("#useAi").checked = false;
    $("#aiInfo").textContent = "— API 키가 없어 키워드로만 고릅니다 (무료 시험 모드). 설정에서 키를 넣으면 AI 를 쓸 수 있습니다.";
  } else {
    $("#aiInfo").textContent = `— ${m.label}. 끄면 키워드로만 고르고 '주요 내용'에 제목이 들어갑니다 (무료).`;
  }
  $("#useAi").disabled = !s.apiKey;
}

function updateAutoInfo() {
  const s = state.settings;
  if (!s.autoRun) {
    $("#autoInfo").textContent = "자동 수집: 꺼짐";
    return;
  }
  const off = dayOffReason(new Date(), s);
  const mode = s.workdayReport ? ` · 근무일 보고서 모드${s.collectOnHolidays ? " (휴일엔 수집만, 다음 근무일에 합본)" : " (휴일엔 쉼)"}` : "";
  $("#autoInfo").textContent = `자동 수집: 매일 ${s.autoRunTime}${mode} · 오늘은 ${off ? `휴일(${off})` : "근무일"}`;
}

// ---------------------------------------------------------------------------
// 출처별 진행 표
// ---------------------------------------------------------------------------

const sourceRows = new Map();

function initSourceTable(sources) {
  const tbody = $("#sources tbody");
  tbody.textContent = "";
  sourceRows.clear();
  for (const src of sources) {
    const tr = el("tr", {}, el("td", { text: src.name }), el("td"), el("td"), el("td"), el("td"), el("td", { text: "대기" }));
    tbody.append(tr);
    sourceRows.set(src.key, tr);
  }
  $("#sources").hidden = false;
}

function updateSource(key, { listed, candidates, read, issues, status, error } = {}) {
  heartbeat(status);
  const tr = sourceRows.get(key);
  if (!tr) return;
  const td = tr.children;
  if (listed !== undefined) td[1].textContent = listed;
  if (candidates !== undefined) td[2].textContent = candidates;
  if (read !== undefined) td[3].textContent = read;
  if (issues !== undefined) td[4].textContent = issues;
  if (status !== undefined) {
    status = korMsg(status);
    td[5].textContent = status;
    td[5].className = error ? "err" : "";
  }
  showProgress(tr);
}

// 수집 중 진행 상황: 요약 줄과 탭 제목에 "몇 곳 중 몇 곳 끝" 을 보여 준다 (멈춘 것처럼 보이지 않게)
function showProgress(current) {
  if (!state.running) return;
  const rows = [...sourceRows.values()];
  const done = rows.filter((tr) => /^(완료|실패|건너뜀|중지)/.test(tr.children[5].textContent)).length;
  const name = current ? current.children[0].textContent : "";
  const st = current ? current.children[5].textContent : "";
  setSummary(`수집 진행 중: ${rows.length}곳 중 ${done}곳 끝 · 지금 ${name} ${st} · 지금까지 부정 이슈 ${state.rows.length}건 (결과는 한 곳씩 끝날 때마다 늘어나고, 전체는 보통 20~40분 걸립니다)`);
  document.title = `⏳ ${done}/${rows.length} 수집 중 - 부정 이슈 모니터링`;
}

// ---------------------------------------------------------------------------
// 결과 표 (받기 전에 고치기)
// ---------------------------------------------------------------------------

function fmtMonthDay(d) {
  return d ? `${pad2(d.getMonth() + 1)}월 ${pad2(d.getDate())}일` : "";
}

// 조회수·댓글 수·강한 비판 표시 (URL 칸 앞, 값이 있을 때만)
function countsBadge(r) {
  const parts = [];
  if (r.views != null) parts.push(`👁 ${Number(r.views).toLocaleString()}`);
  if (r.ccount != null) parts.push(`💬 ${Number(r.ccount).toLocaleString()}`);
  if (r.harsh) parts.push("🔥");
  if (!parts.length) return null;
  const hot = r.harsh || r.views >= 1000 || r.ccount >= 20;
  return el("span", { class: `counts${hot ? " hot" : ""}`, title: `조회 ${r.views ?? "-"} · 댓글 ${r.ccount ?? "-"}${r.harsh ? " · 강한 비판·욕설 있음" : ""}`, text: parts.join(" ") });
}

// 결과 표 링크: 바로 열면 안 보이는 글(넥쏘 카페·영운모, 검색 경유로 읽은 글)은 네이버 검색(카페 탭) 결과로.
// 표시 글자와 엑셀·PPT·RAW 에는 원본 주소 그대로
function resultHref(r) {
  const hard = r.viaSearch || VIA_SEARCH_CAFES.some((c) => (r.url || "").includes(`/${c}/`));
  if (!hard || !r.title) return r.url;
  const q = String(r.title).replace(/\s+/g, " ").trim().slice(0, 80);
  return `https://search.naver.com/search.naver?ssc=tab.cafe.all&query=${encodeURIComponent(q)}`;
}

function renderResults() {
  const tbody = $("#results tbody");
  tbody.textContent = "";
  state.rows.forEach((r, i) => {
    // 자동 학습 기준값이 없는 행(예전 버전 결과·불러온 엑셀·데일리 DB): 처음 보여 준 값을 기준으로, 이후 고친 것부터 학습
    if (!r.ai) r.ai = { car: r.car, category: r.category, summary: r.summary, highlight: !!r.highlight };
    if (r.aiReport === undefined) r.aiReport = !!r.report;
    const sum = el("input", { type: "text", value: r.summary, title: r.summary, oninput: (e) => (r.summary = e.target.value, e.target.title = e.target.value, saveLastResult(), learnRow(r)) });
    const tr = el(
      "tr",
      { class: `${r.highlight ? "yellow" : ""} ${r.report ? "report" : ""} ${r.selected ? "selected" : ""}` },
      el(
        "td",
        { class: "sel" },
        el("input", {
          type: "checkbox",
          checked: !!r.selected,
          onchange: (e) => {
            r.selected = e.target.checked;
            tr.classList.toggle("selected", r.selected);
            updateSelection();
          },
        })
      ),
      el("td", { class: "comm", text: r.community, title: r.community }),
      el("td", {}, el("input", { type: "text", value: r.car, size: 7, oninput: (e) => (r.car = e.target.value, saveLastResult(), learnRow(r)) })),
      el("td", {}, el("input", { type: "text", class: "year", value: r.year || "", placeholder: "-", title: "확인 연식 (화면 검토용, 엑셀에는 안 들어감)", oninput: (e) => (r.year = e.target.value, saveLastResult()) })),
      el("td", { text: fmtMonthDay(r.date) }),
      el(
        "td",
        {},
        (() => {
          const sel = el("select", { onchange: (e) => (r.category = e.target.value, saveLastResult(), learnRow(r)) });
          for (const c of ["품질", "응대", "결품"]) sel.append(el("option", { value: c, text: c, selected: r.category === c }));
          return sel;
        })()
      ),
      el("td", { class: "url" }, countsBadge(r), r.viaSearch || (VIA_SEARCH_CAFES.some((c) => (r.url || "").includes(`/${c}/`)) && r.title) ? el("img", { class: "viasearch", src: "icons/naver-cafe.svg", alt: "네이버 검색", title: "바로 열면 안 보이는 글이라 링크를 네이버 검색 결과로 엽니다 (엑셀·PPT·RAW 에는 원본 주소)" }) : null, el("a", { href: resultHref(r), target: "_blank", title: `${r.url}${resultHref(r) !== r.url ? "\n→ 누르면 네이버 검색 결과로 열림 (원본 주소는 엑셀·PPT·RAW 에 들어감)" : ""}${r.views != null ? `\n조회 ${r.views}` : ""}${r.ccount != null ? ` · 댓글 ${r.ccount}` : ""}${r.harsh ? "\n강한 비판·욕설 있음" : ""}`, text: r.url.replace(/^https?:\/\/(www\.)?/, "") })),
      el("td", { class: "sum" }, sum),
      el(
        "td",
        {},
        el("input", {
          type: "checkbox",
          checked: !!r.highlight,
          onchange: (e) => {
            r.highlight = e.target.checked;
            tr.classList.toggle("yellow", r.highlight);
            saveLastResult();
            learnRow(r);
          },
        })
      ),
      (() => {
        const td = el("td", { class: `rep${r.report ? "" : " off"}`, text: r.report ? "✅" : "☐", title: r.kind === "community" ? "자동차 커뮤니티 글 (보고 필요 대상 아님)" : "눌러서 보고 필요 표시/해제" });
        td.addEventListener("click", () => {
          r.report = !r.report;
          learnRow(r);
          td.textContent = r.report ? "✅" : "☐";
          td.classList.toggle("off", !r.report);
          tr.classList.toggle("report", r.report);
          saveLastResult();
        });
        return td;
      })(),
      el(
        "td",
        {},
        el("button", {
          class: "del",
          text: "삭제",
          onclick: () => {
            learnDelete(state.rows.splice(i, 1));
            renderResults();
            saveLastResult();
          },
        })
      )
    );
    tbody.append(tr);
  });
  $("#results").hidden = !state.rows.length;
  $("#resultsTitle").hidden = !state.rows.length;
  $("#resultTools").hidden = !state.rows.length;
  $("#resultCount").textContent = `${state.rows.length}건 · 보고 필요 ${state.rows.filter((r) => r.report).length}건`;
  updateSelection();
  $("#download").disabled = !state.rows.length && !state.range;
  $("#downloadPlain").disabled = $("#download").disabled;
}

const serializeRows = (rows) => rows.map(({ selected, ...r }) => ({ ...r, date: r.date ? r.date.getTime() : null }));

// 선택(왼쪽 체크) 상태 → '선택 삭제' 버튼·전체 선택 체크
function updateSelection() {
  const n = state.rows.filter((r) => r.selected).length;
  $("#deleteSelected").disabled = !n;
  $("#deleteSelected").textContent = n ? `선택 삭제 (${n}건)` : "선택 삭제";
  const all = $("#selectAll");
  all.checked = n > 0 && n === state.rows.length;
  all.indeterminate = n > 0 && n < state.rows.length;
}

$("#selectAll").addEventListener("change", (e) => {
  state.rows.forEach((r) => (r.selected = e.target.checked));
  renderResults();
});

$("#deleteSelected").addEventListener("click", async () => {
  const n = state.rows.filter((r) => r.selected).length;
  if (!n || !confirm(`선택한 ${n}건을 결과에서 지울까요?`)) return;
  learnDelete(state.rows.filter((r) => r.selected));
  state.rows = state.rows.filter((r) => !r.selected);
  renderResults();
  await saveLastResult();
});

$("#clearResults").addEventListener("click", async () => {
  if (state.running || !state.rows.length) return;
  if (!confirm(`결과 표의 ${state.rows.length}건을 모두 비울까요? (데일리 DB 에 저장된 이력은 지워지지 않습니다)`)) return;
  state.rows = [];
  state.dbEntryId = "none"; // 결과 표만 비움 (데일리 DB 이력은 그대로, DB 를 덮어쓰지 않음)
  renderResults();
  await saveLastResult();
  setSummary("결과를 비웠습니다.");
});
const deserializeRows = (rows) => (rows || []).map((r) => ({ ...r, date: r.date ? new Date(r.date) : null }));

// ---------------------------------------------------------------------------
// 데일리 DB: 수집할 때마다 결과를 저장, 엑셀 받기·결과 보기·이어받기 기준
// ---------------------------------------------------------------------------

const DB_MAX = 400;

async function dbList() {
  const { dailyDb = [] } = await chrome.storage.local.get("dailyDb");
  return dailyDb;
}

async function dbSave(entry) {
  const list = await dbList();
  state.dbEntryId = entry.id; // 결과 표에서 고치면 이 DB 항목에도 반영
  list.unshift(entry);
  await chrome.storage.local.set({ dailyDb: list.slice(0, DB_MAX) });
}

function fmtDuration(ms) {
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}시간 ${m}분 ${s}초` : m ? `${m}분 ${s}초` : `${s}초`;
}

function dbLabel(e) {
  return `${fmtDateTime(new Date(e.finishedAt))} 수집 · ${fmtDateTime(new Date(e.range.start))}~${fmtDateTime(new Date(e.range.end))} · ${e.count}건`;
}

// 백업 폴더(크롬 LevelDB 파일)에서 옛 데일리 DB 기록 찾기 → 고른 것을 데일리 DB 에 되살림
let recoverFound = [];
$("#recoverDir").addEventListener("change", async (ev) => {
  const files = [...ev.target.files].filter((f) => /\.(log|ldb|sst)$/i.test(f.name));
  ev.target.value = "";
  $("#recoverList").textContent = "";
  $("#recoverDo").hidden = true;
  if (!files.length) return ($("#recoverInfo").textContent = "이 폴더에는 .ldb / .log 파일이 없습니다. Local Extension Settings 안의 확장 ID 폴더를 복사한 것인지 확인해 주세요.");
  $("#recoverInfo").textContent = `파일 ${files.length}개를 읽는 중…`;
  const loaded = [];
  for (const f of files) loaded.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  const { runs, lastResults } = LevelRecover.findRuns(loaded);
  const current = new Map((await dbList()).map((e) => [e.id, e]));
  recoverFound = [];
  for (const e of runs) {
    const cur = current.get(e.id);
    if (cur && (cur.rows || []).length >= e.rows.length) continue; // 지금 DB 가 같거나 더 많으면 건너뜀
    recoverFound.push({ kind: "run", e, cur });
  }
  for (const v of lastResults) {
    if (!v.range) continue;
    recoverFound.push({ kind: "last", e: { id: `recovered-${v.range.start}-${v.range.end}`, startedAt: v.savedAt || v.range.end, finishedAt: v.savedAt || v.range.end, range: v.range, count: v.rows.length, rows: v.rows, base: "복구(지난 결과 화면)" } });
  }
  recoverFound.sort((a, b) => b.e.finishedAt - a.e.finishedAt);
  if (!recoverFound.length) {
    $("#recoverInfo").textContent = "되살릴 옛 기록을 찾지 못했습니다 (지금 데일리 DB 보다 많은 기록이 없음).";
    return;
  }
  $("#recoverInfo").textContent = `되살릴 수 있는 기록 ${recoverFound.length}개를 찾았습니다. 고른 뒤 [선택한 기록 복구]를 누르세요.`;
  recoverFound.forEach((x, i) => {
    const e = x.e;
    $("#recoverList").append(
      el("label", { class: "check" },
        el("input", { type: "checkbox", value: String(i), checked: x.kind === "run" && !!x.cur }),
        ` ${x.kind === "last" ? "[지난 결과 화면] " : ""}${fmtDateTime(new Date(e.finishedAt))} 수집 · ${fmtDateTime(new Date(e.range.start))}~${fmtDateTime(new Date(e.range.end))} · `,
        el("b", { class: "count-red", text: `${e.rows.length}건` }),
        x.cur ? ` (지금 DB 에는 ${(x.cur.rows || []).length}건)` : " (지금 DB 에 없음)"
      )
    );
  });
  $("#recoverDo").hidden = false;
});

$("#recoverDo").addEventListener("click", async () => {
  const picked = [...document.querySelectorAll("#recoverList input:checked")].map((x) => recoverFound[+x.value]);
  if (!picked.length) return;
  const all = await dbList();
  for (const x of picked) {
    const i = all.findIndex((y) => y.id === x.e.id);
    const entry = { ...x.e, count: x.e.rows.length, recoveredAt: Date.now() };
    if (i >= 0) {
      if (!all[i].origRows) all[i].origRows = all[i].rows; // 복구 전 상태도 보관
      all[i] = { ...all[i], rows: entry.rows, count: entry.count, recoveredAt: entry.recoveredAt };
    } else all.push(entry);
  }
  all.sort((a, b) => b.finishedAt - a.finishedAt);
  await chrome.storage.local.set({ dailyDb: all.slice(0, DB_MAX) });
  $("#recoverInfo").textContent = `${picked.length}개 기록을 데일리 DB 에 되살렸습니다. 아래 목록과 '이어서 작성'·'이전 기록 불러오기'에서 쓸 수 있습니다.`;
  $("#recoverList").textContent = "";
  $("#recoverDo").hidden = true;
  await renderBaseOptions();
  renderDb();
});

// PPT·RAW 작성 화면이 쓰는 저장소(IndexedDB 'report-extension')의 RAW 파일 이력
function pptKv(mode, fn) {
  return new Promise((resolve) => {
    const open = indexedDB.open("report-extension", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction("kv", mode);
        const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}

// 바이트를 엑셀 저장 폴더(없으면 다운로드 폴더)에 저장, 같은 이름이면 (1)
async function saveBytesFile(fileName, bytes, mime) {
  const dir = await withTimeout(getSaveDir(), 5000, "저장 폴더 읽기").catch(() => null);
  if (dir && (await saveDirPermission(dir, true).catch(() => false))) {
    try {
      const name = await uniqueFileName(dir, fileName);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      return `'${dir.name}' 폴더 (${name})`;
    } catch {}
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    await chrome.downloads.download({ url, filename: fileName, conflictAction: "uniquify", saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return "다운로드 폴더";
}

async function renderRawHistory() {
  const hist = (await pptKv("readonly", (st) => st.get("rawHistory"))) || [];
  const latest = await pptKv("readonly", (st) => st.get("rawLatest"));
  const tbody = $("#rawTable tbody");
  tbody.textContent = "";
  $("#rawEmpty").hidden = hist.length > 0;
  $("#rawTable").hidden = !hist.length;
  for (const h of hist) {
    const isBase = latest && latest.name === h.name && latest.bytes && h.bytes && latest.bytes.length === h.bytes.length;
    tbody.append(
      el("tr", {},
        el("td", { text: fmtDateTime(new Date(h.at)) }),
        el("td", { text: `${h.name}${isBase ? "  ← 다음 RAW 이어 쓰기 기준" : ""}` }),
        el("td", {}, el("b", { class: "count-red", text: `${h.rows || 0}건` })),
        el("td", { class: "hint", text: h.detail || "" }),
        el("td", { class: "actions" },
          el("button", { text: "받기", onclick: async () => {
            const where = await saveBytesFile(h.name, h.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            alert(`✅ RAW data 파일 저장 완료\n\n저장 위치: ${where}`);
          } }),
          isBase ? null : el("button", { text: "이어 쓸 기준으로", title: "다음 RAW 를 이 파일 끝에 이어 씁니다", onclick: async () => {
            if (!confirm(`다음 RAW data 를 이 파일 끝에 이어 쓸까요?\n${h.name}`)) return;
            await pptKv("readwrite", (st) => st.put({ name: h.name, bytes: h.bytes, savedAt: fmtDateTime(new Date(h.at)) }, "rawLatest"));
            renderRawHistory();
          } })
        )
      )
    );
  }
}

async function renderDb() {
  renderRawHistory();
  const list = await dbList();
  const tbody = $("#dbTable tbody");
  tbody.textContent = "";
  $("#dbEmpty").hidden = list.length > 0;
  $("#dbTable").hidden = !list.length;
  for (const e of list) {
    const rows = deserializeRows(e.rows);
    tbody.append(
      el(
        "tr",
        {},
        el("td", { text: fmtDateTime(new Date(e.finishedAt)) }),
        el("td", { text: `${fmtDateTime(new Date(e.range.start))} ~ ${fmtDateTime(new Date(e.range.end))}` }),
        el("td", {}, el("b", { class: "count-red", text: `${e.count}건` })),
        el("td", { text: `${rows.filter((r) => r.report).length}건` }),
        el("td", { text: fmtDuration(e.finishedAt - e.startedAt) }),
        el("td", { text: e.costUsd ? `$${e.costUsd.toFixed(2)}` : "-" }),
        el("td", { class: "hint", text: [e.base ? `합본(${e.base})` : "", e.stopped ? "중지됨" : "", e.blocked ? "네이버 중단" : ""].filter(Boolean).join(" · ") }),
        el(
          "td",
          { class: "actions" },
          el("button", { text: "엑셀 받기", onclick: () => downloadReport(rows, { start: new Date(e.range.start), end: new Date(e.range.end) }).catch((err) => alert(err.message)) }),
          el("button", {
            text: "결과 보기",
            onclick: () => {
              state.rows = rows;
              state.range = { start: new Date(e.range.start), end: new Date(e.range.end) };
              state.dbEntryId = e.id; // 여기서 고치면 이 DB 항목에 반영
              renderResults();
              setSummary(`데일리 DB: ${dbLabel(e)}`);
              showTab("collect");
            },
          }),
          el("button", {
            text: "이어받기",
            onclick: async () => {
              await renderBaseOptions();
              $("#baseSelect").value = e.id;
              await onBaseChange();
              showTab("collect");
            },
          }),
          e.origRows
            ? el("button", {
                text: "원본 복구",
                title: `결과 표에서 고치기 전 처음 수집한 그대로(${e.origRows.length}건)로 되돌립니다`,
                onclick: async () => {
                  if (!confirm(`이 기록을 처음 수집한 원본 ${e.origRows.length}건으로 되돌릴까요? (그 뒤에 고친 내용은 사라집니다)`)) return;
                  const all = await dbList();
                  const x = all.find((y) => y.id === e.id);
                  if (x) {
                    x.rows = x.origRows;
                    x.count = x.origRows.length;
                    delete x.origRows;
                    await chrome.storage.local.set({ dailyDb: all });
                  }
                  renderDb();
                },
              })
            : null,
          el("button", {
            class: "del",
            text: "삭제",
            onclick: async () => {
              if (!confirm(`이 수집 이력을 지울까요?\n${dbLabel(e)}`)) return;
              const all = await dbList();
              await chrome.storage.local.set({ dailyDb: all.filter((x) => x.id !== e.id) });
              renderDb();
              renderBaseOptions();
            },
          })
        )
      )
    );
  }
}

// ---------------------------------------------------------------------------
// 이어서 작성할 기존 데이터 (데일리 DB 또는 엑셀 파일)
// ---------------------------------------------------------------------------

state.base = null; // { label, rows }

async function renderBaseOptions() {
  const sel = $("#baseSelect");
  const keep = sel.value;
  sel.textContent = "";
  sel.append(el("option", { value: "", text: "없음 (이번 수집만 새로 작성)" }));
  if (state.baseFile) sel.append(el("option", { value: "file", text: `엑셀 파일: ${state.baseFile.label}` }));
  for (const e of await dbList()) sel.append(el("option", { value: e.id, text: `데일리 DB: ${dbLabel(e)}` }));
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  renderBaseDd();
}

// '이어서 작성' 목록: 기본 드롭다운은 글자 일부에 색을 못 넣어서 직접 그린다 (끝의 'NN건'을 빨간 굵은 글씨로)
function ddLabel(text) {
  const m = String(text).match(/^(.*?)(\d+건)(\s*\))?$/);
  const span = el("span", { class: "dd-text" });
  if (m) span.append(m[1], el("b", { class: "count-red", text: m[2] }), m[3] || "");
  else span.append(text);
  return span;
}

function renderBaseDd() {
  const sel = $("#baseSelect");
  const cur = sel.options[sel.selectedIndex];
  const btn = $("#baseBtn");
  btn.textContent = "";
  btn.append(ddLabel(cur ? cur.textContent : "없음 (이번 수집만 새로 작성)"), el("span", { class: "dd-caret", text: "▾" }));
  const menu = $("#baseMenu");
  menu.textContent = "";
  for (const o of sel.options) {
    menu.append(
      el("div", {
        class: `dd-item${o.value === sel.value ? " on" : ""}`,
        onclick: () => {
          sel.value = o.value;
          sel.dispatchEvent(new Event("change"));
          menu.hidden = true;
          renderBaseDd();
        },
      }, ddLabel(o.textContent))
    );
  }
}

$("#baseBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#baseMenu").hidden = !$("#baseMenu").hidden;
});
document.addEventListener("click", (e) => {
  if (!$("#baseDd").contains(e.target)) $("#baseMenu").hidden = true;
});

// 첨부한 엑셀(이어서 작성용) 해제
$("#clearBase").addEventListener("click", async () => {
  state.baseFile = null;
  $("#baseFile").value = "";
  await renderBaseOptions();
  $("#baseSelect").value = "";
  await onBaseChange();
});

async function onBaseChange() {
  const v = $("#baseSelect").value;
  if (!v) state.base = null;
  else if (v === "file") state.base = state.baseFile;
  else {
    const e = (await dbList()).find((x) => x.id === v);
    state.base = e ? { label: `데일리 DB ${fmtDateTime(new Date(e.finishedAt))}`, rows: deserializeRows(e.rows), end: e.range && e.range.end } : null;
  }
  // 이어서 작성: 수집 시작을 고른 기록이 끝난 시각으로 (그 뒤만 새로 수집). 끝은 그대로(금일 기준 시각)
  if (state.base && state.base.end && !state.running) {
    const startAt = new Date(state.base.end);
    const endAt = new Date($("#rangeEnd").value);
    if (!(endAt > startAt)) {
      const r = defaultRange(new Date(), state.settings);
      setRange(startAt, r.end > startAt ? r.end : new Date());
    } else setRange(startAt, endAt);
  }
  $("#baseInfo").textContent = state.base
    ? `기존 ${state.base.rows.length}건 뒤에 이어서 작성합니다 (같은 게시물은 기존 것만 남김).${state.base.end ? ` 수집 시작을 그 기록이 끝난 ${fmtDateTime(new Date(state.base.end))}로 맞췄습니다.` : ""}${state.base.rows.length ? "" : " ⚠ 이 항목은 0건이라 붙일 것이 없습니다. 건수가 있는 다른 항목이나 엑셀 파일을 고르세요."}`
    : "";
  $("#mergeBase").disabled = !state.base || !state.base.rows.length || state.running;
  renderBaseDd();
  $("#clearBase").hidden = !state.baseFile;
}

$("#baseSelect").addEventListener("change", onBaseChange);

// 이전 기록 불러오기: 데일리 DB 기록 여러 개를 골라 합쳐 결과 표에 (결과 창을 비웠을 때 다시 보기)
$("#loadHistory").addEventListener("click", async () => {
  if (state.running) return setSummary("수집 중에는 이전 기록을 불러올 수 없습니다. 수집이 끝난 뒤 눌러 주세요.");
  const list = (await dbList()).filter((e) => (e.rows || []).length);
  const box = $("#historyList");
  box.textContent = "";
  if (!list.length) box.append(el("p", { class: "hint", text: "불러올 기록이 없습니다 (0건 기록은 목록에서 뺐습니다)." }));
  // 기본 체크: 가장 최근 기록 + '이어서 작성'에서 고른 기록
  const baseId = $("#baseSelect").value;
  list.forEach((e, i) => {
    box.append(
      el("label", { class: "check" },
        el("input", { type: "checkbox", value: e.id, checked: i === 0 || e.id === baseId }),
        ` ${fmtDateTime(new Date(e.finishedAt))} 수집 · ${fmtDateTime(new Date(e.range.start))}~${fmtDateTime(new Date(e.range.end))} · `,
        el("b", { class: "count-red", text: `${(e.rows || []).length}건` }),
        e.base ? ` · 합본(${e.base})` : ""
      )
    );
  });
  $("#historyDialog").showModal();
});

$("#historyDialog").addEventListener("close", async () => {
  if ($("#historyDialog").returnValue !== "ok") return;
  const ids = [...document.querySelectorAll("#historyList input:checked")].map((x) => x.value);
  if (!ids.length) return;
  const all = await dbList();
  const picked = all.filter((e) => ids.includes(e.id)); // 최신순
  state.rows = [];
  state.seenKeys = new Set();
  // 오래된 기록부터 넣어 같은 게시물은 먼저 수집된(이미 고친) 것을 남기되, 최신 기록의 수정이 있으면 그걸 우선
  const byKey = new Map();
  for (const e of [...picked].reverse()) for (const r of deserializeRows(e.rows)) byKey.set(urlKey(r.url), r);
  for (const r of byKey.values()) pushRow(r);
  const starts = picked.map((e) => e.range.start);
  const ends = picked.map((e) => e.range.end);
  state.range = { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
  state.dbEntryId = picked[0].id; // 고친 내용은 가장 최근 기록에 저장 (합친 결과 그대로)
  sortRows();
  renderResults();
  await saveLastResult();
  const msg = `이전 기록 ${picked.length}개를 합쳐 ${state.rows.length}건을 불러왔습니다 (${fmtDateTime(state.range.start)} ~ ${fmtDateTime(state.range.end)}, 동호회별·날짜순)`;
  setSummary(msg);
  log(msg);
});

// 수집 없이, 고른 기존 데이터를 지금 결과 표에 합친다 (수집을 이미 시작했거나 끝난 뒤 어제 결과를 붙일 때)
$("#mergeBase").addEventListener("click", async () => {
  if (state.running || !state.base || !state.base.rows.length) return;
  const before = state.rows.length;
  state.seenKeys = new Set();
  const current = state.rows;
  state.rows = [];
  // 기존(고른 데이터) 먼저, 같은 게시물은 기존 것만 남김 → 지금 결과
  state.base.rows.forEach((r, i) => pushRow({ ...r, fromBase: true, baseIdx: i, kind: r.kind && r.kind !== "base" ? r.kind : /cafe\.naver\.com|naver\.me/.test(r.url || "") ? "cafe" : "community", ts: r.ts || (r.date ? r.date.getTime() : 0) }));
  for (const r of current) pushRow(r);
  if (state.range && state.base.rows.length) {
    const first = Math.min(...state.base.rows.map((r) => (r.date ? r.date.getTime() : Infinity)));
    if (Number.isFinite(first) && first < state.range.start.getTime()) state.range = { start: new Date(first), end: state.range.end };
  }
  sortRows();
  renderResults();
  await saveLastResult();
  const msg = `${state.base.label} ${state.base.rows.length}건을 지금 결과 ${before}건에 합쳤습니다 → ${state.rows.length}건 (같은 게시물은 하나만). 필요하면 '보고 필요 다시 고르기'를 누르세요.`;
  log(msg);
  setSummary(msg);
});
$("#baseFile").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const rows = await ReportXlsx.read(new Uint8Array(await f.arrayBuffer()));
    if (!rows.length) throw new Error("이 파일에서 보고서 행(커뮤니티명·주요 내용 머리글)을 찾지 못했습니다");
    // 파일 이름 앞 날짜(예: 261018 또는 학_261018)가 그 엑셀의 수집 끝 날짜 → 기준 시각으로
    const m = f.name.match(/(?:^|_)(\d{2})(\d{2})(\d{2})_/);
    const [ch, cm] = cutoffHM(state.settings);
    const end = m ? new Date(2000 + +m[1], +m[2] - 1, +m[3], ch, cm).getTime() : null;
    state.baseFile = { label: `${f.name} (${rows.length}건)`, rows, end };
    await renderBaseOptions();
    $("#baseSelect").value = "file";
    await onBaseChange();
  } catch (e) {
    $("#baseInfo").textContent = `파일을 읽지 못했습니다: ${e.message}`;
  }
});

async function saveLastResult() {
  await chrome.storage.local.set({
    lastResult: {
      range: state.range ? { start: state.range.start.getTime(), end: state.range.end.getTime() } : null,
      rows: serializeRows(state.rows),
      dbEntryId: state.dbEntryId || null,
      savedAt: Date.now(),
    },
  });
  scheduleDbSync();
}

// 결과 표에서 고친 내용(차종·구분·주요 내용·노란색·보고 필요·삭제)을 그 수집의 데일리 DB 항목에도 자동 반영
// → 다음 날 '이어서 작성'에서 그 DB 항목을 골라도 고친 그대로 이어짐. 저장 버튼 없이 자동 저장, 표시만 띄움
let dbSyncTimer = null;
function scheduleDbSync() {
  if (state.running) return; // 수집 중엔 끝날 때 한꺼번에 저장
  clearTimeout(dbSyncTimer);
  dbSyncTimer = setTimeout(syncDbEntry, 1000);
}

async function syncDbEntry() {
  if (!state.rows.length) return; // 빈 결과로 DB 항목을 덮어쓰지 않는다 (결과 비우기 등)
  const now = new Date();
  const stamp = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const list = await dbList();
  let e = state.dbEntryId && state.dbEntryId !== "none" ? list.find((x) => x.id === state.dbEntryId) : null;
  // 예전 버전 결과처럼 DB 항목 표시가 아예 없을 때(undefined)만 같은 수집 기간의 가장 최근 항목
  if (!e && state.dbEntryId === undefined && state.range) {
    e = list.find((x) => x.range && x.range.start === state.range.start.getTime() && x.range.end === state.range.end.getTime());
    if (e) state.dbEntryId = e.id;
  }
  if (e) {
    if (!e.origRows) e.origRows = e.rows; // 처음 고치기 전 원본 보관 (데일리 DB 탭에서 '원본 복구')
    e.rows = serializeRows(state.rows);
    e.count = state.rows.length;
    e.editedAt = Date.now();
    await chrome.storage.local.set({ dailyDb: list.slice(0, DB_MAX) });
    $("#autoSaved").textContent = `✓ 자동 저장됨 (데일리 DB 반영) ${stamp}`;
    await renderBaseOptions(); // '이어서 작성' 목록의 건수도 바로 맞춤
    await onBaseChange();
  } else {
    $("#autoSaved").textContent = `✓ 자동 저장됨 ${stamp}`;
  }
}

async function loadLastResult() {
  const { lastResult } = await chrome.storage.local.get("lastResult");
  if (!lastResult) return;
  state.rows = deserializeRows(lastResult.rows);
  state.range = lastResult.range ? { start: new Date(lastResult.range.start), end: new Date(lastResult.range.end) } : null;
  state.dbEntryId = "dbEntryId" in lastResult ? lastResult.dbEntryId || "none" : undefined; // 예전 버전 결과만 undefined
  if (state.rows.length || state.range) {
    renderResults();
    if (state.range) setSummary(`지난 수집 결과 (${fmtDateTime(state.range.start)} ~ ${fmtDateTime(state.range.end)}): ${state.rows.length}건`);
  }
}

// 설정의 파일 이름에서 {날짜} 를 수집 끝 날짜(예: 261011)로 바꾼다
function reportFilename(range, ascii = false) {
  const d = range ? range.end : new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  // 1인용: 파일 이름 앞에 입력한 문구 (예: "김" → 김_261012_…)
  const s = state.settings || {};
  const prefix = s.collectMode === "solo" && s.soloPrefix ? `${String(s.soloPrefix).replace(/[\\/:*?"<>|]/g, "_")}_` : "";
  if (ascii) return `${prefix && /^[\x20-\x7e]+$/.test(prefix) ? prefix : ""}${ymd}_HMG_community_issues.xlsx`;
  const tpl = (state.settings && state.settings.fileName) || DEFAULT_SETTINGS.fileName;
  const name = tpl.replace(/\{날짜\}/g, ymd).replace(/[\\/:*?"<>|]/g, "_").replace(/\.xlsx$/i, "").trim();
  return `${prefix}${name || ymd}.xlsx`;
}

// ---------------------------------------------------------------------------
// 엑셀 저장 폴더: 크롬 다운로드 기능은 다운로드 폴더 안에만 저장할 수 있어서,
// 사용자가 고른 폴더(File System Access)를 IndexedDB 에 기억해 두고 그 폴더에 직접 쓴다.
// ---------------------------------------------------------------------------

function idbHandles(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("issueMonitor", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("handles", mode);
      const req = fn(tx.objectStore("handles"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const getSaveDir = () => idbHandles("readonly", (st) => st.get("saveDir")).catch(() => null);
const setSaveDir = (h) => idbHandles("readwrite", (st) => (h ? st.put(h, "saveDir") : st.delete("saveDir")));

// 맥 권한 창 등에서 멈춰도 엑셀을 못 받는 일이 없게 시간 제한을 둔다
function withTimeout(promise, ms, what) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} 응답 없음 (${ms / 1000}초)`)), ms))]);
}

async function saveDirPermission(dir, ask) {
  const opts = { mode: "readwrite" };
  let p = await withTimeout(dir.queryPermission(opts), 5000, "권한 확인");
  if (p !== "granted" && ask) p = await withTimeout(dir.requestPermission(opts), 30000, "권한 허용").catch(() => "denied");
  return p === "granted";
}

async function uniqueFileName(dir, name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 0; i < 100; i++) {
    const n = i ? `${base} (${i})${ext}` : name;
    try {
      await dir.getFileHandle(n);
    } catch {
      return n; // 없음 → 이 이름 사용
    }
  }
  return `${base} (${Date.now()})${ext}`;
}

async function renderSaveDir() {
  const dir = await getSaveDir();
  $("#downloadPlain").hidden = !dir;
  $("#clearSaveDir").hidden = !dir;
  if (!dir) {
    $("#grantSaveDir").hidden = true;
    $("#saveDirInfo").textContent = "지금: 크롬 다운로드 폴더";
    return;
  }
  const ok = await saveDirPermission(dir, false).catch(() => false);
  $("#grantSaveDir").hidden = ok;
  $("#saveDirInfo").textContent = ok ? `지금: '${dir.name}' 폴더에 저장` : `'${dir.name}' 폴더 저장 권한이 필요합니다 → '저장 권한 다시 허용'을 눌러 주세요 (그 전까지는 다운로드 폴더에 저장)`;
  $("#saveDirInfo").classList.toggle("err", !ok);
}

$("#pickSaveDir").addEventListener("click", async () => {
  if (!window.showDirectoryPicker) return alert("이 크롬 버전은 폴더 지정을 지원하지 않습니다. 크롬을 최신으로 업데이트해 주세요.");
  try {
    const dir = await window.showDirectoryPicker({ id: "reportDir", mode: "readwrite", startIn: "desktop" });
    await saveDirPermission(dir, true);
    await setSaveDir(dir);
  } catch (e) {
    if (e.name !== "AbortError") alert(`폴더를 지정하지 못했습니다: ${e.message}`);
  }
  renderSaveDir();
});
$("#grantSaveDir").addEventListener("click", async () => {
  const dir = await getSaveDir();
  if (dir) await saveDirPermission(dir, true);
  renderSaveDir();
});
$("#clearSaveDir").addEventListener("click", async () => {
  await setSaveDir(null);
  renderSaveDir();
});

// 저장한 곳을 돌려준다 (기록용). interactive=true 면(버튼 클릭) 권한이 없을 때 허용을 묻는다.
async function downloadReport(rows = state.rows, range = state.range, interactive = true, plain = false) {
  const dir = plain ? null : await withTimeout(getSaveDir(), 5000, "저장 폴더 읽기").catch(() => null);
  if (dir) {
    let ok = false;
    try {
      ok = await saveDirPermission(dir, interactive);
    } catch {}
    if (ok) {
      const bytes = ReportXlsx.build(rows);
      let lastErr = null;
      // 한글 파일명을 못 쓰는 환경이면 영문 이름으로
      for (const ascii of [false, true]) {
        try {
          const name = await uniqueFileName(dir, reportFilename(range, ascii));
          await withTimeout(
            (async () => {
              const fh = await dir.getFileHandle(name, { create: true });
              const w = await fh.createWritable();
              await w.write(bytes);
              await w.close();
            })(),
            20000,
            "폴더 저장"
          );
          return `'${dir.name}' 폴더 (${name})`;
        } catch (e) {
          lastErr = e;
        }
      }
      log(`지정한 '${dir.name}' 폴더에 저장하지 못해 다운로드 폴더에 저장합니다: ${lastErr && lastErr.message}`, "err");
    } else {
      log(`'${dir.name}' 폴더 저장 권한이 없어 다운로드 폴더에 저장합니다 (설정 → 엑셀 저장 폴더에서 '저장 권한 다시 허용')`, "err");
    }
  }
  const bytes = ReportXlsx.build(rows);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  try {
    try {
      await chrome.downloads.download({ url, filename: reportFilename(range), conflictAction: "uniquify", saveAs: false });
    } catch {
      // 한글 파일명을 못 쓰는 환경이면 영문 이름으로
      await chrome.downloads.download({ url, filename: reportFilename(range, true), conflictAction: "uniquify", saveAs: false });
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return "다운로드 폴더";
}
// 저장 완료 알림창 (지정 폴더 저장은 크롬 다운로드 표시가 안 떠서 저장 안 된 줄 알기 쉬움)
function savedAlert(where, auto = false) {
  setTimeout(() => {
    alert(`✅ 엑셀 저장 완료${auto ? " (자동 수집)" : ""}\n\n저장 위치: ${where}\n${state.rows.length}건 · 보고 필요 ${state.rows.filter((r) => r.report).length}건\n\n다시 받을 필요 없습니다.`);
  }, 50);
}

function downloadClick(plain) {
  setSummary("엑셀 저장 중…");
  downloadReport(state.rows, state.range, true, plain)
    .then((where) => {
      log(`엑셀을 ${where}에 저장했습니다`);
      setSummary(`엑셀을 ${where}에 저장했습니다 (${state.rows.length}건 · 보고 필요 ${state.rows.filter((r) => r.report).length}건)`);
      savedAlert(where);
    })
    .catch((e) => {
      log(`엑셀 저장 실패: ${e.message}`, "err");
      setSummary(`엑셀 저장 실패: ${e.message} → '다운로드 폴더로 받기'를 눌러 보세요`);
    });
}
$("#download").addEventListener("click", () => downloadClick(false));
$("#downloadPlain").addEventListener("click", () => downloadClick(true));

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "GN7 PE / GN7" 처럼 여러 개면 가장 흔한 앞쪽
function firstHint(hint) {
  return String(hint || "").split("/")[0].trim();
}

// 키워드만으로 노란색 항목 판단 (AI 를 안 쓸 때)
function keywordHighlight(car, text, highlights) {
  const generic = new Set(["관련", "불만", "고장", "의견", "포함", "작동", "오류", "문의", "이상", "전체"]);
  for (const h of highlights || []) {
    if (h.car && !String(car).startsWith(h.car)) continue;
    // 시트 항목은 글에 시트·좌석이 있어야 (전동 테일게이트·도어 끼임 등을 시트로 오인하지 않게)
    if (/시트/.test(h.topic || "") && !/시트|좌석/.test(text)) continue;
    const words = String(h.topic || "")
      .split(/[^가-힣A-Za-z0-9]+/)
      .map((w) => w.replace(/(관련|등|의)$/, ""))
      .filter((w) => w.length >= 2 && !generic.has(w));
    if (words.some((w) => text.includes(w))) return true;
  }
  return false;
}

// 판정이 끝난 행 다듬기 → 행 또는 null(뺌)
// - GV60 마그마: 차종 JW, 주요 내용 끝에 (마그마)
// - 차종이 분명해야 하는 출처(현대모터클럽·자동차 커뮤니티)에서 차종을 모르면 뺀다
function finalizeRow(row, it, src) {
  const text = `${it.title}\n${it.body}`;
  row.car = String(row.car || "").replace(/\s*(HEV|PHEV|하이브리드)$/i, "").trim() || "-"; // 하이브리드는 표기 안 함
  if (/마그마/.test(text) && (/^JW/.test(row.car) || /GV\s?60/i.test(text))) {
    row.car = "JW";
    if (!/\(마그마\)/.test(row.summary)) row.summary = `${row.summary} (마그마)`;
  }
  if ((src.requireCar || it.needCar) && (!row.car || row.car === "-")) {
    if (it.needCar) log(`${src.name}: 「${it.title}」 차종을 알 수 없어 제외 (차종 필수 게시판) ${it.url}`);
    return null;
  }
  // 차종 이중 확인: 여러 차종이 섞인 카페에서 제목에 차명이 하나만 분명히 적혀 있는데 판정 차종과 다르면 제목을 따른다
  // (예: 스타리아EV & ST1 클럽의 "ST1 …" 글을 US4 EV 로 잘못 넣는 것 방지)
  if (/\//.test(src.car || "") && row.car && row.car !== "-") {
    const codes = state.carCodeList || parseCarCodes(state.settings.carCodes);
    const named = titleCarCodes(it.title, codes);
    const base = (c) => String(c).split(" ")[0];
    if (named.length === 1 && base(named[0]) !== base(row.car)) {
      log(`${src.name}: 제목에 '${named[0]}' 차명이 있어 차종을 ${row.car} → ${named[0]} 로 고침 (${it.url})`);
      row.car = named[0];
    }
  }
  // 용어 통일 (크락션 → 클랙슨 등)
  row.summary = applyTerms(row.summary, state.termPairs || parseTermReplacements(state.settings.terms));
  // 퍼온 글: 주요 내용을 "… 관련 내용 공유" 로
  if (isRepost(it.title) && !/공유$/.test(row.summary)) {
    row.summary = `${String(row.summary).replace(/^\s*[\[(（【]?\s*펌\s*[\])）】]?\s*/, "").replace(/\s*(문의|후기|불만)$/, "")} 관련 내용 공유`;
  }
  // 키워드 모드: 2020년 이전 출시 세대는 화재·급발진·시동 꺼짐·사망사고·돌진 같은 매우 심각한 이슈만 (AI 모드는 AI 가 판단)
  if (row.byKeyword) {
    const start = state.codeYears && state.codeYears[String(row.car).replace(/ (EV|HEV|PHEV|N)$/, "")];
    if (start && start < 2020 && !VERY_SEVERE_RE.test(text)) return null;
    delete row.byKeyword;
  }
  const out = {
    community: src.name,
    date: it.ts ? new Date(it.ts) : null,
    url: it.url,
    order: src.order,
    ts: it.ts || 0,
    kind: src.kind,
    title: it.title,
    excerpt: String(it.body || "").slice(0, 400),
    views: it.views ?? null,
    ccount: it.ccount ?? null,
    report: false,
    // 바로 열면 안 보이는 글(넥쏘 카페·영운모 등, 검색 경유로 읽은 글): 결과 표 링크는 네이버 검색으로
    viaSearch: !!((src.cafe && src.cafe.viaSearch) || it.via === "검색"),
    ...row,
  };
  // 자동 학습용: AI(또는 키워드)가 처음 정한 값 (담당자가 고친 것과 비교)
  out.ai = { car: out.car, category: out.category, summary: out.summary, highlight: !!out.highlight };
  return out;
}

// 차종을 모르거나("-") PE 여부 등이 애매한 카페 글: 작성자 닉네임 → '게시글 보기'(작성자의 다른 글)를 열어 차종 코드를 다시 정한다.
// 작성자의 다른 글로 타사 차(예: 기아 EV6)로 확인되면 보고서에서 뺀다.
// (네이버 화면을 더 열게 되므로 한 번 수집에 최대 AUTHOR_LOOKUP_MAX 명까지)
const AUTHOR_LOOKUP_MAX = 60;
const AUTHOR_POST_READS = 3; // 제목에 차명이 없을 때 작성자의 다른 글 본문·댓글을 열어 보는 최대 수 (한 사람당)
const AUTHOR_POST_READS_MAX = 120; // 한 번 수집에 전체 상한 (네이버 화면 수 보호)
async function refineUncertainCars(src, items, judged, ctx) {
  const targets = items.filter((it) => {
    const j = judged.get(it.key);
    if (!j || !j.relevant || !(j.car_uncertain || !j.car_code || j.car_code.trim() === "-")) return false;
    if (it.writer && (it.writer.href || it.writer.memberKey)) return true;
    log(`${src.name}: 「${it.title}」 차종 확인을 위해 작성자 글을 보려 했지만 작성자 정보를 찾지 못함 ${it.url}`, "err");
    return false;
  });
  if (!targets.length) return;
  const asks = [];
  for (const it of targets) {
    if (ctx.authorLookups >= AUTHOR_LOOKUP_MAX || state.stopRequested) break;
    ctx.authorLookups++;
    try {
      const posts = await ctx.naver.authorPosts(it, src.cafe, it.writer);
      const titles = posts.map((p) => p.title);
      // 제목에 차명이 안 보이면 다른 글을 직접 열어 본문·댓글에서 찾는다 (차명이 나오면 그만)
      const texts = [];
      const codes = state.carCodeList || parseCarCodes(state.settings.carCodes);
      if (!mentionsAnyCar(titles.join("\n"), codes)) {
        for (const p of posts) {
          if (texts.length >= AUTHOR_POST_READS || (ctx.authorPostReads || 0) >= AUTHOR_POST_READS_MAX || state.stopRequested) break;
          ctx.authorPostReads = (ctx.authorPostReads || 0) + 1;
          try {
            const t = await ctx.naver.authorPostText(src.cafe, p);
            if (!t) continue;
            texts.push(t);
            if (mentionsAnyCar(`${t.title}\n${t.body}\n${t.comments}`, codes)) break;
          } catch (e) {
            if (e instanceof StopError || e instanceof BlockedError) throw e;
          }
        }
      }
      log(`${src.name}: 「${it.title}」 작성자(${it.writer.nick || "닉네임 모름"})의 다른 글 ${titles.length}개 제목${texts.length ? `, ${texts.length}개 본문·댓글` : ""} 확인`);
      asks.push({ key: it.key, needCar: it.needCar, title: it.title, carNow: judged.get(it.key).car_code, carHint: it.carHint, nick: it.writer.nick, authorTitles: titles, authorTexts: texts, comments: it.comments });
    } catch (e) {
      if (e instanceof StopError || e instanceof BlockedError) throw e;
      log(`${src.name} 작성자 글 확인 실패: ${e.message}`, "err");
    }
  }
  if (!asks.length) return;
  try {
    const fixed = await ctx.ai.refineCars(asks);
    let changed = 0;
    let dropped = 0;
    for (const [key, r] of fixed) {
      const j = judged.get(key);
      if (!j) continue;
      if (r.other_brand) {
        j.relevant = false; // 타사 차 → 보고서에서 뺀다
        dropped++;
        const it = items.find((x) => x.key === key);
        log(`${src.name}: 「${it ? it.title : key}」 작성자의 다른 글로 보아 타사 차(${r.car_code || "현대차·제네시스 아님"}) → 제외`);
        continue;
      }
      if (r.car_code && r.car_code !== j.car_code) {
        j.car_code = r.car_code;
        changed++;
      }
    }
    log(`${src.name}: 차종을 모르거나 애매한 글 ${asks.length}건 작성자 글 확인 → ${changed}건 차종 코드 수정${dropped ? `, ${dropped}건 타사 차로 제외` : ""}`);
  } catch (e) {
    log(`${src.name} 작성자 기반 차종 재판정 실패: ${e.message}`, "err");
  }
}

// 한 출처(카페 하나 또는 커뮤니티 하나)의 글 목록 → 후보 고르기 → 본문 읽기 → 판정 → 보고서 행
async function processSource(src, posts, readBody, ctx) {
  const { ai, range, settings, delays } = ctx;
  updateSource(src.key, { listed: posts.length, status: "후보 고르는 중" });
  if (!posts.length) {
    updateSource(src.key, { candidates: 0, read: 0, issues: 0, status: "완료 (기간 내 글 없음)" });
    return;
  }

  posts = posts.filter((p) => !isAttendancePost(p.title));
  let candidates;
  if (ai) {
    const picked = await ai.triage(posts.map((p) => ({ key: p.articleId, source: src.name, title: p.title })));
    candidates = posts.filter((p) => picked.has(p.articleId));
  } else {
    candidates = posts.filter((p) => !excluded(p.title) && keywordHits(p.title).length && (src.kind === "cafe" || (mentionsBrand(p.title) && !communityNewsLike(p.title))));
  }
  updateSource(src.key, { candidates: candidates.length, status: `본문 확인 중 0/${candidates.length}` });

  const items = [];
  let read = 0;
  let passed = 0;
  for (const post of candidates) {
    if (state.stopRequested) throw new StopError("중지됨");
    try {
      const info = await readBody(post);
      read++;
      const ts = info.ts || (post.exact ? post.ts : null);
      if (ts && !inRange(new Date(ts), range)) continue; // 날짜만 알던 글이 실제로는 기간 밖
      items.push({
        key: post.articleId,
        source: src.name,
        carHint: src.car || "",
        menu: post.menu || "",
        needCar: src.kind === "cafe" && requiresCarBoard(src.cafe && src.cafe.id, post.menuId, post.menu),
        title: info.title || post.title,
        body: info.body || "",
        comments: info.comments || "",
        url: post.url,
        ts: ts || post.ts,
        writer: info.writer || null,
        views: info.views ?? post.views ?? null,
        ccount: info.ccount ?? post.ccount ?? null,
        via: info.via || "",
      });
    } catch (e) {
      if (e instanceof StopError || e instanceof BlockedError) throw e;
      if (e instanceof PassError) {
        passed++;
        log(`${src.name} 「${post.title}」 본문 확인 불가 → 패스 (${e.message}) ${post.url}`);
      } else log(`${src.name} ${post.url} 본문 읽기 실패: ${e.message}`, "err");
    }
    updateSource(src.key, { read, status: `본문 확인 중 ${read}/${candidates.length}${passed ? ` · 패스 ${passed}` : ""}` });
    if (src.kind === "cafe") await ctx.naverWait(delays.article);
    else await ctx.communityWait(delays.community);
  }

  updateSource(src.key, { status: "판정 중" });
  let added = 0;
  if (ai) {
    let judged = new Map();
    try {
      judged = await ai.classify(items);
    } catch (e) {
      log(`${src.name} AI 판정 실패(${e.message}) → 키워드로 대신 판정`, "err");
    }
    if (src.kind === "cafe") await refineUncertainCars(src, items, judged, ctx);
    for (const it of items) {
      const j = judged.get(it.key);
      let row;
      if (j) {
        if (!j.relevant) continue;
        row = { car: j.car_code || (it.needCar ? "" : firstHint(it.carHint)) || "-", category: j.category, summary: j.summary, highlight: !!j.highlight, harsh: !!j.harsh, year: j.model_year || findModelYear(`${it.title}\n${it.body}\n${it.comments || ""}`) };
      } else {
        const text = `${it.title}\n${it.body}`;
        const cat = keywordCategory(text);
        if (!cat) continue;
        const car = guessCarCode(text, parseCarCodes(settings.carCodes)) || (it.needCar ? "" : firstHint(it.carHint)) || "-";
        row = { car, category: cat, summary: it.title, highlight: keywordHighlight(car, text, settings.highlights), byKeyword: true, year: findModelYear(`${text}\n${it.comments || ""}`) };
      }
      const fin = finalizeRow(row, it, src);
      if (!fin || !pushRow(fin)) continue;
      added++;
    }
  } else {
    const codes = parseCarCodes(settings.carCodes);
    for (const it of items) {
      const text = `${it.title}\n${it.body}`;
      const cat = keywordCategory(text);
      if (!cat) continue;
      if (src.kind !== "cafe" && !mentionsBrand(text)) continue;
      const car = guessCarCode(text, codes) || (it.needCar ? "" : firstHint(it.carHint)) || "-";
      const fin = finalizeRow({ car, category: cat, summary: it.title, highlight: keywordHighlight(car, text, settings.highlights), byKeyword: true, year: findModelYear(`${text}\n${it.comments || ""}`) }, it, src);
      if (!fin || !pushRow(fin)) continue;
      added++;
    }
  }
  sortRows();
  renderResults();
  saveLastResult();
  updateSource(src.key, { issues: added, status: passed ? `완료 (본문 확인 불가 패스 ${passed})` : "완료" });
}

// 이어서 작성한 기존 행은 원래 순서 그대로 앞에, 이번 수집 행은 카페·커뮤니티 순서 → 게시 시각 순
// 엑셀은 항상 카페별로: 설정의 카페 순서 → 자동차 커뮤니티 순서 → (설정에 없는 이름은 처음 나온 순서) → 게시일 순
// 이어서 작성한 기존 행도 같은 카페 자리에 끼워 넣는다 (날짜별로 뒤에 붙이지 않음)
const nameKey = (t) => String(t || "").replace(/\s+/g, "").toLowerCase();
function sortRows() {
  const s = state.settings;
  const cafeIdx = new Map(s.cafes.map((c, i) => [nameKey(c.name || c.id), i]));
  const commIdx = new Map(s.communities.map((c, i) => [nameKey(c.name || c.url), 1000 + i]));
  const unknown = new Map();
  const orderOf = (r) => {
    const k = nameKey(r.community);
    if (cafeIdx.has(k)) return cafeIdx.get(k);
    if (commIdx.has(k)) return commIdx.get(k);
    if (!unknown.has(k)) unknown.set(k, 2000 + unknown.size);
    return unknown.get(k);
  };
  const day = (r) => (r.date ? new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()).getTime() : 0);
  const decorated = state.rows.map((r, i) => ({ r, i, o: orderOf(r) }));
  decorated.sort((a, b) => a.o - b.o || day(a.r) - day(b.r) || (a.r.ts || 0) - (b.r.ts || 0) || a.i - b.i);
  state.rows = decorated.map((x) => x.r);
}

// 같은 게시물(주소)이 이미 있으면 넣지 않는다 (처음 것만 남김)
function pushRow(row) {
  const key = urlKey(row.url);
  if (state.seenKeys.has(key)) return false;
  state.seenKeys.add(key);
  state.rows.push(row);
  return true;
}

// 보고 필요 4~6건 고르기 (네이버 카페 글만). AI 가 있으면 AI, 없거나 실패하면 키워드
async function pickReports(cafeRows, ai, settings) {
  if (!cafeRows.length) return 0;
  let picked;
  try {
    picked = ai ? await ai.selectReports(cafeRows, settings.priorityCars) : keywordReportPick(cafeRows, settings.priorityCars);
  } catch (e) {
    log(`AI 보고 필요 선정 실패(${e.message}) → 키워드로 대신 선정`, "err");
    picked = keywordReportPick(cafeRows, settings.priorityCars);
  }
  cafeRows.forEach((r) => (r.report = false));
  picked.forEach((i) => (cafeRows[i].report = true));
  cafeRows.forEach((r) => (r.aiReport = !!r.report)); // 자동 학습용: AI 가 고른 보고 필요
  log(`보고 필요 ${picked.size}건 선정`);
  return picked.size;
}

// 행이 네이버 카페 글인지 (불러온 엑셀처럼 kind 정보가 없으면 주소로 판단)
const isCafeRow = (r) => (r.kind ? r.kind === "cafe" : /cafe\.naver\.com|naver\.me/.test(r.url || ""));

// 지금 결과 표(또는 불러온 엑셀)에서 보고 필요 다시 고르기
$("#pickReports").addEventListener("click", async () => {
  if (state.running) return;
  const settings = state.settings;
  const rows = state.rows.filter(isCafeRow);
  if (!rows.length) {
    setSummary("보고 필요를 고를 네이버 카페 글이 없습니다.");
    return;
  }
  $("#pickReports").disabled = true;
  setSummary(`보고 필요 고르는 중… (네이버 카페 글 ${rows.length}건)`);
  try {
    const ai = settings.apiKey ? new AiClassifier(settings, log) : null;
    const n = await pickReports(rows, ai, settings);
    renderResults();
    await saveLastResult();
    setSummary(`보고 필요 ${n}건을 골랐습니다${ai ? ` (AI 비용 약 $${ai.costUsd().toFixed(3)})` : " (키워드 기준)"}. '엑셀 받기'로 G열 + 가 들어간 파일을 받으세요.`);
  } finally {
    $("#pickReports").disabled = false;
  }
});

// 엑셀 파일을 불러와 결과 표로 보기 (파일 이름 앞 날짜를 그대로 씀)
$("#viewFile").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f || state.running) return;
  try {
    const rows = await ReportXlsx.read(new Uint8Array(await f.arrayBuffer()));
    if (!rows.length) throw new Error("이 파일에서 보고서 행을 찾지 못했습니다");
    state.rows = rows.map((r, i) => ({ ...r, ts: r.date ? r.date.getTime() : 0, kind: /cafe\.naver\.com|naver\.me/.test(r.url) ? "cafe" : "community", fromBase: true, baseIdx: i }));
    sortRows();
    const m = f.name.match(/^(\d{2})(\d{2})(\d{2})/);
    const [ch, cm] = cutoffHM(state.settings);
    const end = m ? new Date(2000 + +m[1], +m[2] - 1, +m[3], ch, cm) : new Date();
    state.range = { start: new Date(end.getTime() - 86400000), end };
    state.dbEntryId = "none"; // 불러온 엑셀은 데일리 DB 항목이 아님 (DB 를 덮어쓰지 않음)
    renderResults();
    await saveLastResult();
    setSummary(`불러온 엑셀: ${f.name} · ${rows.length}건 (노란색 ${rows.filter((r) => r.highlight).length}, 보고 필요 ${rows.filter((r) => r.report).length})`);
  } catch (e) {
    setSummary(`엑셀을 불러오지 못했습니다: ${e.message}`);
  }
});

// 근무일 보고서: 지난 보고서 이후 자동 수집한 회차(휴일 수집분 포함)를 하나로 합친다
// (같은 게시물은 처음 것만, 보고 필요는 합친 전체에서 다시 4~6건)
async function buildWorkdayReport(ai, settings) {
  const { lastReportAt = 0 } = await chrome.storage.local.get("lastReportAt");
  const since = Math.max(lastReportAt, Date.now() - 10 * 86400000); // 처음이거나 오래 비었으면 최근 10일까지만
  const runs = (await dbList()).filter((e) => e.auto && !e.workdayReport && e.finishedAt > since).sort((a, b) => a.finishedAt - b.finishedAt);
  if (runs.length <= 1) return; // 이번 회차뿐이면 그대로
  state.rows = [];
  state.seenKeys = new Set();
  let idx = 0;
  for (const e of runs) for (const r of deserializeRows(e.rows)) pushRow({ ...r, fromBase: true, baseIdx: idx++ });
  state.range = { start: new Date(runs[0].range.start), end: new Date(runs[runs.length - 1].range.end) };
  log(`근무일 보고서: 자동 수집 ${runs.length}회 합본 (${fmtDateTime(state.range.start)} ~ ${fmtDateTime(state.range.end)}, ${state.rows.length}건)`);
  await pickReports(state.rows.filter(isCafeRow), ai, settings);
  sortRows();
  renderResults();
  await saveLastResult();
  await dbSave({
    id: `report-${Date.now()}`,
    startedAt: runs[0].startedAt,
    finishedAt: Date.now(),
    range: { start: state.range.start.getTime(), end: state.range.end.getTime() },
    count: state.rows.length,
    costUsd: runs.reduce((s, e) => s + (e.costUsd || 0), 0),
    model: settings.model,
    base: `근무일 합본 ${runs.length}회`,
    workdayReport: true,
    rows: serializeRows(state.rows),
  });
}

async function runCollection() {
  if (state.running) return;
  const settings = state.settings;
  let range;
  try {
    range = readRange();
  } catch (e) {
    setSummary(e.message);
    return;
  }
  const { cafes, communities } = pickedSources();
  if (!cafes.length && !communities.length) {
    setSummary("수집할 곳을 하나 이상 골라 주세요.");
    return;
  }
  const useAi = $("#useAi").checked && !!settings.apiKey;
  // 두 탭에서 동시에 수집하면 네이버에 두 배로 접속하고 서로 방해하므로 막는다
  const other = await otherRunActive();
  if (other) {
    const msg = `다른 탭에서 이미 수집 중입니다 (마지막 진행: ${fmtDateTime(new Date(other.at))} ${other.msg || ""}). 그 탭이 끝난 뒤 다시 시작해 주세요. 확장 아이콘을 누르면 수집 중인 탭으로 이동합니다.`;
    setSummary(msg);
    log(msg, "err");
    return;
  }

  state.running = true;
  state.stopRequested = false;
  state.dbEntryId = "none"; // 이번 수집은 끝날 때 새 DB 항목으로 저장 (그 전엔 DB 를 건드리지 않음)
  await runGuard(true);
  await loadLearned(); // 담당자 수정 사례를 최신으로
  // 이어서 작성: 기존 행을 먼저 넣고(중복은 처음 것만), 이번 수집 결과를 뒤에 붙인다
  state.rows = [];
  state.seenKeys = new Set();
  if (state.base) {
    state.base.rows.forEach((r, i) => pushRow({ ...r, fromBase: true, baseIdx: i, kind: r.kind && r.kind !== "base" ? r.kind : /cafe\.naver\.com|naver\.me/.test(r.url || "") ? "cafe" : "community", ts: r.ts || (r.date ? r.date.getTime() : 0) }));
  }
  const baseMsg = state.base ? `이어서 작성: ${state.base.label} ${state.base.rows.length}건 → 중복 뺀 ${state.rows.length}건 뒤에 붙입니다` : "";
  state.range = range;
  state.codeYears = codeStartYears(settings.carCodes);
  state.termPairs = parseTermReplacements(settings.terms);
  state.carCodeList = parseCarCodes(settings.carCodes);
  renderResults();
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#download").disabled = true;
  $("#log").textContent = "";
  const startedAt = Date.now();
  $("#runTimes").hidden = false;
  $("#runTimes").textContent = `수집 시작 ${fmtDateTime(new Date(startedAt))}:${pad2(new Date(startedAt).getSeconds())} · 수집 중…`;
  log(`v${chrome.runtime.getManifest().version} 수집 시작: ${fmtDateTime(range.start)} ~ ${fmtDateTime(range.end)}, 카페 ${cafes.length}곳, 커뮤니티 ${communities.length}곳, ${useAi ? `AI(${settings.model})` : "키워드 모드"}`);
  if (baseMsg) log(baseMsg);
  setSummary("수집 중…");

  const delays = DELAYS[settings.speed] || DELAYS.normal;
  const ai = useAi ? new AiClassifier(settings, log) : null;
  const isStopped = () => state.stopRequested;

  // 엑셀 행 순서: 설정에 적힌 카페 순서 → 커뮤니티 순서
  const cafeSources = cafes.map((c) => ({ kind: "cafe", key: `cafe:${c.id}`, name: c.name || c.id, car: c.car, cafe: c, order: settings.cafes.indexOf(c), requireCar: REQUIRE_CAR_CAFES.includes(c.id) }));
  const commSources = communities.map((c) => ({ kind: "community", key: `comm:${c.url}`, name: c.name || c.url, site: c, order: 1000 + settings.communities.indexOf(c), requireCar: true }));
  initSourceTable([...cafeSources, ...commSources]);

  const naver = new NaverCollector({ delays, log, isStopped });
  const community = new CommunityCollector({ delays, log, isStopped });
  const ctx = {
    ai,
    range,
    settings,
    delays,
    naver,
    authorLookups: 0,
    naverWait: (r) => naver.wait(r),
    communityWait: (r) => community.wait(r),
  };

  const naverTask = async () => {
    if (!cafeSources.length) return;
    if (!(await checkLogin())) {
      for (const s of cafeSources) updateSource(s.key, { status: "건너뜀 (네이버 로그인 필요)", error: true });
      log("네이버 로그인이 안 돼 있어 카페 수집을 건너뜁니다", "err");
      return;
    }
    await naver.start();
    // 매일 같은 순서로 열지 않도록 카페 순서를 섞는다
    const order = shuffle(cafeSources);
    try {
      for (let i = 0; i < order.length; i++) {
        const src = order[i];
        updateSource(src.key, { status: "글 목록 읽는 중" });
        try {
          const posts = await naver.listCafe(src.cafe, range);
          log(`${src.name}: 기간 내 글 ${posts.length}개`);
          await processSource(src, posts, (post) => naver.readArticle(post, src.cafe), ctx);
        } catch (e) {
          if (e instanceof StopError || e instanceof BlockedError) throw e;
          updateSource(src.key, { status: `실패: ${e.message}`, error: true });
          log(`${src.name} 실패: ${e.message}`, "err");
        }
        if (i < order.length - 1) {
          await naver.wait(delays.cafeGap);
          if ((i + 1) % delays.restEvery === 0) {
            log("잠깐 쉬는 중 (네이버 계정 보호)");
            await naver.wait(delays.rest);
          }
        }
      }
    } catch (e) {
      if (e instanceof BlockedError) {
        log(`⚠ ${e.message}`, "err");
        for (const s of cafeSources) {
          const st = sourceRows.get(s.key).children[5].textContent;
          if (!/^완료|^실패/.test(st)) updateSource(s.key, { status: "건너뜀 (네이버 수집 중단)", error: true });
        }
        state.naverBlocked = e.message;
      } else if (!(e instanceof StopError)) {
        throw e;
      }
    } finally {
      await naver.finish();
    }
  };

  const communityTask = async () => {
    for (const src of commSources) {
      if (state.stopRequested) return;
      updateSource(src.key, { status: "글 목록 읽는 중" });
      try {
        const posts = await community.list(src.site, range);
        log(`${src.name}: 기간 내 글 ${posts.length}개`);
        await processSource(src, posts, (post) => community.readArticle(src.site, post), ctx);
      } catch (e) {
        if (e instanceof StopError) return;
        updateSource(src.key, { status: `실패: ${e.message}`, error: true });
        log(`${src.name} 실패: ${e.message}`, "err");
      }
    }
  };

  state.naverBlocked = null;
  const results = await Promise.allSettled([naverTask(), communityTask()]);
  for (const r of results) if (r.status === "rejected") log(`오류: ${r.reason && r.reason.message}`, "err");

  for (const [key, tr] of sourceRows) {
    const st = tr.children[5].textContent;
    if (!/^완료|^실패|^건너뜀/.test(st)) updateSource(key, { status: state.stopRequested ? "중지됨" : st });
  }

  // 보고 필요: 이번에 수집한 네이버 카페 글 중 심각한 4~6개 (신차 우선, 단순 정보 공유 제외)
  // 보고 필요: 이어서 작성한 합본이면 기존 행까지 합친 전체 카페 글에서 다시 4~6건 (기존 체크는 다시 정함)
  await pickReports(state.rows.filter((r) => (state.base ? isCafeRow(r) : r.kind === "cafe" && !r.fromBase)), ai, settings);

  sortRows();
  renderResults();
  await saveLastResult();
  state.costUsd = ai ? ai.costUsd() : 0;
  const finishedAt = Date.now();
  const mins = Math.round((finishedAt - startedAt) / 60000);
  const sec = (d) => `${fmtDateTime(d)}:${pad2(d.getSeconds())}`;
  $("#runTimes").textContent = `수집 시작 ${sec(new Date(startedAt))}  ·  수집 완료 ${sec(new Date(finishedAt))}  ·  소요 ${fmtDuration(finishedAt - startedAt)}`;
  log($("#runTimes").textContent);
  const costText = ai ? ` · AI 비용 약 $${state.costUsd.toFixed(2)} (입력 ${ai.usage.input + ai.usage.cacheRead + ai.usage.cacheWrite} / 출력 ${ai.usage.output} 토큰)` : "";
  const msg = `${state.stopRequested ? "중지됨" : "완료"}: 부정 이슈 ${state.rows.length}건 · ${mins}분${costText}${state.naverBlocked ? ` · ⚠ ${state.naverBlocked}` : ""}`;
  setSummary(msg);
  log(msg);
  await dbSave({
    id: `run-${finishedAt}`,
    startedAt,
    finishedAt,
    range: { start: range.start.getTime(), end: range.end.getTime() },
    count: state.rows.length,
    costUsd: state.costUsd,
    model: ai ? settings.model : "키워드",
    base: state.base ? state.base.label : "",
    stopped: state.stopRequested,
    blocked: state.naverBlocked || "",
    auto: AUTO,
    rows: serializeRows(state.rows),
  });
  await renderBaseOptions();
  await chrome.storage.local.set({
    lastRun: { at: Date.now(), count: state.rows.length, costUsd: state.costUsd, blocked: state.naverBlocked, stopped: state.stopRequested },
  });

  state.running = false;
  runGuard(false);
  $("#mergeBase").disabled = !state.base || !state.base.rows.length;
  $("#start").disabled = false;
  $("#stop").disabled = true;
  $("#download").disabled = false;

  if (AUTO) {
    if (!state.stopRequested) await chrome.storage.local.set({ lastAutoRangeEnd: range.end.getTime() });
    const off = settings.workdayReport ? dayOffReason(new Date(), settings) : "";
    if (off) {
      // 휴일: 수집만 해 두고 다음 근무일 아침 보고서에 합친다
      log(`오늘은 ${off} → 엑셀은 받지 않고 데일리 DB 에 저장했습니다. 다음 근무일 아침 보고서에 합쳐집니다.`);
      chrome.runtime.sendMessage({ type: "autoRunDone", count: state.rows.length, holiday: off }).catch(() => {});
    } else {
      let where = "";
      try {
        // 이전 기록을 이미 이어서 작성했으면 결과가 완성본이라 다시 합치지 않음
        if (settings.workdayReport && !state.autoBaseUsed) await buildWorkdayReport(ai, settings);
        where = await downloadReport(state.rows, state.range, false);
        await chrome.storage.local.set({ lastReportAt: finishedAt });
        log(`엑셀을 ${where}에 저장했습니다`);
        setSummary(`${$("#summary").textContent} · 엑셀을 ${where}에 저장했습니다`);
      } catch (e) {
        log(`엑셀 저장 실패: ${e.message}`, "err");
      }
      chrome.runtime.sendMessage({ type: "autoRunDone", count: state.rows.length, blocked: state.naverBlocked, where }).catch(() => {});
      if (where) savedAlert(where, true);
    }
  }
}

$("#start").addEventListener("click", () => {
  const { cafes } = pickedSources();
  if (cafes.length > 25 && !AUTO) {
    // 전체 수집은 시간이 오래 걸린다는 안내만
    log(`카페 ${cafes.length}곳 수집은 30~60분 정도 걸립니다. 이 탭을 닫지 마세요.`);
  }
  runCollection().catch((e) => {
    log(`오류: ${e.message}`, "err");
    state.running = false;
    runGuard(false);
    $("#start").disabled = false;
    $("#stop").disabled = true;
  });
});
$("#stop").addEventListener("click", () => {
  state.stopRequested = true;
  $("#stop").disabled = true;
  setSummary("중지하는 중… (지금까지 모은 결과로 정리합니다)");
});

$("#copyLog").addEventListener("click", async () => {
  const text = `부정 이슈 모니터링 ${chrome.runtime.getManifest().version}\n${$("#summary").textContent}\n${$("#log").textContent}`;
  try {
    await navigator.clipboard.writeText(text);
    $("#copyResult").textContent = "복사했습니다. 메신저 등에 붙여넣어 보내 주세요.";
  } catch {
    $("#copyResult").textContent = "복사하지 못했습니다. 기록을 직접 드래그해 복사해 주세요.";
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.running) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------------------
// 명령 프롬프트: 현재 AI 에 보내는 프롬프트 보기 + 추가 지시사항 수정 (최종 업데이트 시각·이력)
// ---------------------------------------------------------------------------

async function renderLearned() {
  const list = await loadLearned();
  const { learnedUpdatedAt, pptLearnedUpdatedAt, pptLearned = [], pptExamples = [] } = await chrome.storage.local.get(["learnedUpdatedAt", "pptLearnedUpdatedAt", "pptLearned", "pptExamples"]);
  const last = Math.max(learnedUpdatedAt || 0, pptLearnedUpdatedAt || 0);
  $("#learnedInfo").textContent =
    list.length || pptLearned.length || pptExamples.length
      ? `수집 ${list.length}건 · PPT ${pptLearned.length}건 · PPT 확정 예시 ${pptExamples.length}건${last ? ` · 최종 업데이트 ${fmtDateTime(new Date(last))}` : ""}`
      : "아직 없습니다. 결과 표나 PPT 미리보기에서 고치면 여기에 쌓입니다.";
  const box = $("#learnedList");
  box.textContent = "";
  // PPT 미리보기 수정 사례
  pptLearned.forEach((x, i) => {
    const ch = Object.entries(x.ch || {}).map(([k, [a, b]]) => `${({ title: "페이지 제목", code: "차종", spec: "제원", level: "불만 구분", progress: "경과", short: "요약표 내용", body: "본문 요약", reaction: "댓글 반응", duplicate: "신규/중복", region: "입고/운행지역", focus: "집중관리고객" })[k] || k} "${a}" → "${b}"`).join(" / ");
    box.append(
      el("div", { class: "item" },
        el("span", { class: "hint", text: `${fmtDateTime(new Date(x.at))} ` }),
        `📊 PPT [${x.cafe}] ${x.car}: ${ch}`,
        el("button", { class: "del", text: "삭제", title: "이 사례는 학습에서 뺍니다", onclick: async () => { const { pptLearned: all = [] } = await chrome.storage.local.get("pptLearned"); all.splice(i, 1); await chrome.storage.local.set({ pptLearned: all, pptLearnedUpdatedAt: Date.now() }); renderPrompt(); } })
      )
    );
  });
  list.forEach((x, i) => {
    const line = learnLine(x).replace(/^- /, "") || `[${x.community}] 「${x.title}」 →`;
    const text = x.type === "delete" ? `🗑 [${x.community}] 「${x.title}」 → 보고서에서 뺌 (${x.car} · ${x.summary})` : `✏️ ${line}${x.ch && x.ch.report ? `${/→$/.test(line) ? "" : " /"} 보고 필요 ${x.ch.report[1] ? "추가" : "해제"}` : ""}`;
    box.append(
      el("div", { class: "item" },
        el("span", { class: "hint", text: `${fmtDateTime(new Date(x.at))} ` }),
        text,
        el("button", { class: "del", text: "삭제", title: "이 사례는 학습에서 뺍니다", onclick: async () => { const all = await loadLearned(); all.splice(i, 1); await saveLearned(all); renderPrompt(); } })
      )
    );
  });
}

$("#clearLearned").addEventListener("click", async () => {
  if (!confirm("자동 학습 메모(수집·PPT)를 모두 지울까요? (다음 판정·작성부터 담당자 수정 사례가 빠집니다)")) return;
  await saveLearned([]);
  await chrome.storage.local.set({ pptLearned: [], pptLearnedUpdatedAt: Date.now() });
  renderPrompt();
});

function renderPrompt() {
  renderLearned().then(() => {
    $("#promptTriage").textContent = triageSystem(state.settings);
    $("#promptClassify").textContent = classifySystem(state.settings);
    $("#promptReport").textContent = reportSystem(state.settings.priorityCars, state.settings);
  });
  // PPT 문구 작성 프롬프트 (PPT·RAW 작성 탭 화면에서 가져옴)
  const pw = $("#pptFrame").contentWindow;
  if (pw && pw.PptLearn) pw.PptLearn.load().then(() => ($("#promptPpt").textContent = pw.PptLearn.system()));
  else $("#promptPpt").textContent = "PPT·RAW 작성 탭을 한 번 연 뒤 다시 보면 표시됩니다.";
  const s = state.settings;
  $("#customPrompt").value = s.customPrompt || "";
  $("#promptUpdated").textContent = s.customPromptUpdatedAt ? `최종 업데이트: ${fmtDateTime(new Date(s.customPromptUpdatedAt))}` : "아직 추가 지시사항 없음";
  $("#promptBuilt").textContent = `(기본 규칙 업데이트: ${PROMPT_BUILT_AT})`;
  $("#collectRules").textContent = COLLECT_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
  $("#promptTriage").textContent = triageSystem(s);
  $("#promptClassify").textContent = classifySystem(s);
  $("#promptReport").textContent = reportSystem(s.priorityCars, s);
  const box = $("#promptHistory");
  box.textContent = "";
  for (const h of s.promptHistory || []) {
    box.append(el("div", { class: "item" }, el("b", { text: fmtDateTime(new Date(h.at)) }), `\n${h.text || "(비움)"}`));
  }
  if (!(s.promptHistory || []).length) box.append(el("div", { class: "hint", text: "이력이 없습니다." }));
}

$("#savePrompt").addEventListener("click", async () => {
  const text = $("#customPrompt").value.trim();
  const s = await loadSettings();
  if (text === (s.customPrompt || "").trim()) {
    $("#promptUpdated").textContent = "바뀐 내용이 없습니다.";
    return;
  }
  s.customPrompt = text;
  s.customPromptUpdatedAt = Date.now();
  s.promptHistory = [{ at: s.customPromptUpdatedAt, text }, ...(s.promptHistory || [])].slice(0, 50);
  await saveSettings(s);
  state.settings = s;
  draft = structuredClone(s);
  renderPrompt();
});

// ---------------------------------------------------------------------------
// 설정 화면
// ---------------------------------------------------------------------------

function textInput(obj, key, placeholder = "") {
  return el("input", { type: "text", value: obj[key] || "", placeholder, oninput: (e) => (obj[key] = e.target.value.trim()) });
}

function delButton(list, i, rerender) {
  return el("button", {
    class: "del",
    text: "삭제",
    onclick: () => {
      list.splice(i, 1);
      rerender();
    },
  });
}

let draft = null; // 저장 전 설정

function renderSettings() {
  const s = draft;
  $("#apiKey").value = s.apiKey || "";
  const sel = $("#model");
  sel.textContent = "";
  for (const m of MODELS) sel.append(el("option", { value: m.id, text: `${m.label} — 100만 토큰당 입력 $${m.price[0]} / 출력 $${m.price[1]}`, selected: m.id === s.model }));
  $("#autoRun").checked = !!s.autoRun;
  $("#autoRunTime").value = s.autoRunTime || "06:00";
  $("#cutoffTime").value = s.cutoffTime || "07:30";
  $("#rangeStartTime").value = s.rangeStartTime || s.cutoffTime || "07:30";
  $("#workdayReport").checked = s.workdayReport !== false;
  $("#collectOnHolidays").checked = s.collectOnHolidays !== false;
  $("#holidays").value = s.holidays || "";
  const days = String(s.workdays || "1,2,3,4,5").split(",").map((x) => +x);
  const box = $("#workdayBoxes");
  box.textContent = "";
  [1, 2, 3, 4, 5, 6, 0].forEach((d) => box.append(el("label", { class: "check", style: "display:inline-flex;margin:0 8px 0 0" }, el("input", { type: "checkbox", "data-day": d, checked: days.includes(d) }), "일월화수목금토"[d])));
  $("#speed").value = s.speed || "normal";
  $("#carCodes").value = s.carCodes || "";
  $("#keywords").value = s.keywords || "";
  $("#terms").value = s.terms || "";
  $("#fileName").value = s.fileName || "";
  renderSaveDir();
  $("#priorityCars").value = s.priorityCars || "";
  renderCafeTable();
  renderCommunityTable();
  renderHighlightTable();
}

function renderCafeTable() {
  const tbody = $("#cafeTable tbody");
  tbody.textContent = "";
  draft.cafes.forEach((c, i) => {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, el("input", { type: "checkbox", checked: c.on !== false, onchange: (e) => (c.on = e.target.checked) })),
        el("td", {}, textInput(c, "name", "예: 팰리세이드 피플")),
        el("td", {}, textInput(c, "id", "예: allumpc")),
        el("td", {}, textInput(c, "car", "예: LX3 (여러 차종이면 비움)")),
        el("td", { style: "text-align:center" }, el("input", { type: "checkbox", checked: !!c.viaSearch, onchange: (e) => (c.viaSearch = e.target.checked) })),
        el("td", { style: "min-width:260px" }, textInput(c, "boards", "비우면 전체 · 예: 101, 31, 그룹:현대차 EV")),
        el("td", {}, delButton(draft.cafes, i, renderCafeTable))
      )
    );
  });
}

function renderCommunityTable() {
  const tbody = $("#communityTable tbody");
  tbody.textContent = "";
  draft.communities.forEach((c, i) => {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, el("input", { type: "checkbox", checked: c.on !== false, onchange: (e) => (c.on = e.target.checked) })),
        el("td", {}, textInput(c, "name", "예: 보배드림")),
        el("td", {}, textInput(c, "url", "https://…")),
        el("td", {}, delButton(draft.communities, i, renderCommunityTable))
      )
    );
  });
}

function renderHighlightTable() {
  const tbody = $("#highlightTable tbody");
  tbody.textContent = "";
  draft.highlights.forEach((h, i) => {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, textInput(h, "car", "예: LX3")),
        el("td", {}, textInput(h, "topic", "예: 전동 시트 관련 불만")),
        el("td", {}, delButton(draft.highlights, i, renderHighlightTable))
      )
    );
  });
}

$("#addCafe").addEventListener("click", () => {
  draft.cafes.push({ name: "", id: "", car: "", on: true });
  renderCafeTable();
});
$("#addCommunity").addEventListener("click", () => {
  draft.communities.push({ name: "", url: "", on: true });
  renderCommunityTable();
});
$("#addHighlight").addEventListener("click", () => {
  draft.highlights.push({ car: "", topic: "" });
  renderHighlightTable();
});

function readSettingsForm() {
  draft.apiKey = $("#apiKey").value.trim();
  draft.model = $("#model").value;
  draft.autoRun = $("#autoRun").checked;
  draft.autoRunTime = $("#autoRunTime").value || "06:00";
  draft.cutoffTime = $("#cutoffTime").value || "07:30";
  draft.rangeStartTime = $("#rangeStartTime").value || draft.cutoffTime;
  draft.workdayReport = $("#workdayReport").checked;
  draft.collectOnHolidays = $("#collectOnHolidays").checked;
  draft.holidays = $("#holidays").value;
  draft.workdays = [...document.querySelectorAll("#workdayBoxes input:checked")].map((x) => x.dataset.day).join(",") || "1,2,3,4,5";
  draft.speed = $("#speed").value;
  draft.carCodes = $("#carCodes").value;
  draft.keywords = $("#keywords").value;
  draft.terms = $("#terms").value;
  draft.fileName = $("#fileName").value.trim() || DEFAULT_SETTINGS.fileName;
  draft.priorityCars = $("#priorityCars").value.trim();
  // 카페 ID 에 주소 전체를 붙여넣은 경우 ID 만 남긴다
  for (const c of draft.cafes) {
    const m = String(c.id || "").match(/cafe\.naver\.com\/([A-Za-z0-9_\-]+)/);
    if (m) c.id = m[1];
  }
  draft.cafes = draft.cafes.filter((c) => c.id || c.name);
  draft.communities = draft.communities.filter((c) => c.url || c.name);
  draft.highlights = draft.highlights.filter((h) => h.car || h.topic);
}

async function ensureHostPermissions(communities) {
  const known = /(^|\.)(bobaedream\.co\.kr|clien\.net|ppomppu\.co\.kr)$/;
  const origins = [];
  for (const c of communities) {
    try {
      const u = new URL(c.url);
      if (!known.test(u.hostname)) origins.push(`${u.protocol}//${u.hostname}/*`);
    } catch {
      throw new Error(`커뮤니티 주소가 올바르지 않습니다: ${c.url}`);
    }
  }
  if (origins.length) {
    const ok = await chrome.permissions.request({ origins });
    if (!ok) throw new Error("새 커뮤니티 사이트 접근 권한을 허용해야 수집할 수 있습니다");
  }
}

$("#saveSettings").addEventListener("click", async () => {
  try {
    readSettingsForm();
    await ensureHostPermissions(draft.communities.filter((c) => c.on !== false));
    await saveSettings(draft);
    state.settings = structuredClone(draft);
    setIssueKeywords(state.settings.keywords);
    renderRangeDefaultLabel();
    renderSettings();
    renderPickList();
    updateAiInfo();
    updateAutoInfo();
    $("#saveResult").textContent = "저장했습니다 ✓";
    $("#saveResult").className = "hint ok";
  } catch (e) {
    $("#saveResult").textContent = e.message;
    $("#saveResult").className = "hint err";
  }
});

$("#resetSettings").addEventListener("click", () => {
  if (!confirm("카페·커뮤니티 목록, 키워드, 코드표, 노란색 항목을 처음 기본값으로 되돌릴까요? (API 키는 유지)")) return;
  const key = $("#apiKey").value.trim();
  draft = structuredClone(DEFAULT_SETTINGS);
  draft.apiKey = key;
  renderSettings();
  $("#saveResult").textContent = "기본값을 불러왔습니다. '설정 저장'을 눌러야 적용됩니다.";
  $("#saveResult").className = "hint";
});

$("#testKey").addEventListener("click", async () => {
  const out = $("#keyResult");
  out.textContent = "확인 중…";
  out.className = "hint";
  try {
    const key = $("#apiKey").value.trim();
    if (!key) throw new Error("API 키를 넣어 주세요");
    await new AiClassifier({ ...draft, apiKey: key, model: $("#model").value }, () => {}).ping();
    out.textContent = "정상입니다 ✓ ('설정 저장'을 눌러 주세요)";
    out.className = "hint ok";
  } catch (e) {
    let msg = e.message;
    if (e instanceof Anthropic.AuthenticationError) msg = "키가 올바르지 않습니다";
    else if (e instanceof Anthropic.PermissionDeniedError) msg = "이 키로는 사용할 수 없습니다 (권한 확인)";
    else if (e instanceof Anthropic.RateLimitError) msg = "요청 한도 초과 — 잠시 후 다시 시도";
    else if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) msg = "크레딧이 부족합니다 (Billing 에서 충전)";
    out.textContent = `실패: ${msg}`;
    out.className = "hint err";
  }
});

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

(async function init() {
  $("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  state.settings = await loadSettings();
  setIssueKeywords(state.settings.keywords);
  await loadLearned();
  draft = structuredClone(state.settings);
  renderSettings();
  renderMode();
  renderPickList();
  updateAiInfo();
  updateAutoInfo();
  const r = defaultRange(new Date(), state.settings);
  setRange(r.start, r.end);
  renderRangeDefaultLabel();
  await checkLogin();
  await renderBaseOptions();
  if (AUTO) {
    // 끝: 오늘 기준 시각(07:30)이 지났으면 그 시각, 아니면 지금 (기간을 07:30 ~ 07:30 으로 맞춤)
    const now = new Date();
    now.setSeconds(0, 0);
    const [ch, cm] = cutoffHM(state.settings);
    const cut = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ch, cm, 0);
    const end = now >= cut && now - cut < 3 * 3600 * 1000 ? cut : now;
    const { lastAutoRangeEnd, lastReportAt = 0 } = await chrome.storage.local.get(["lastAutoRangeEnd", "lastReportAt"]);
    const prev = lastAutoRangeEnd ? new Date(lastAutoRangeEnd) : null;
    // 지난 자동 수집이 끝난 시각부터 이어서 (주말에 못 돌린 경우도 포함, 7일 넘게 비었으면 최근 24시간)
    let start = prev && end - prev <= 7 * 86400000 && prev < end ? prev : new Date(end.getTime() - 86400000);
    // 지난 보고 이후에 직접(또는 휴일 자동) 수집해 둔 데일리 DB 기록이 있으면 자동으로 이어서 작성:
    // 그 기록들을 합쳐 기준으로 쓰고, 그 기록이 끝난 시각 이후만 새로 수집 (주말에 미리 모은 것·고친 것 그대로)
    const since = Math.max(lastReportAt || 0, Date.now() - 10 * 86400000);
    const prior = (await dbList())
      .filter((e) => e.finishedAt > since && (e.rows || []).length && !e.stopped && e.range && e.range.end > start.getTime() && e.range.end <= end.getTime())
      .sort((a, b) => a.finishedAt - b.finishedAt);
    if (prior.length) {
      const byKey = new Map();
      for (const e of prior) for (const r of deserializeRows(e.rows)) byKey.set(urlKey(r.url), r); // 같은 글은 더 나중 기록(고친 것) 우선
      const rows = [...byKey.values()];
      state.base = { label: `지난 보고 이후 수집 기록 ${prior.length}개(${prior.map((e) => `${fmtDateTime(new Date(e.range.start))}~${fmtDateTime(new Date(e.range.end))}`).join(", ")})`, rows };
      state.autoBaseUsed = true;
      start = new Date(Math.max(...prior.map((e) => e.range.end)));
      log(`이전 수집 기록 ${prior.length}개(${rows.length}건)를 자동으로 이어서 작성합니다: ${prior.map((e) => dbLabel(e)).join(" / ")}`);
    }
    setRange(start, end);
    log(`자동 수집을 시작합니다 (${fmtDateTime(start)} ~ ${fmtDateTime(end)}: ${prior.length ? "이전 수집 기록에 이어서" : "지난 자동 수집에 이어서"})`);
    await sleep(3000);
    $("#start").click();
  } else {
    await loadLastResult();
  }
})();
