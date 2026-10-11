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
  const now = new Date();
  const line = `[${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}] ${msg}`;
  const pre = $("#log");
  pre.append(cls === "err" ? el("span", { class: "err", text: line + "\n" }) : line + "\n");
  pre.scrollTop = pre.scrollHeight;
  console.log(line);
}

function setSummary(text) {
  $("#summary").textContent = text;
}

function showTab(name) {
  for (const b of document.querySelectorAll("nav .tab")) b.classList.toggle("active", b.dataset.tab === name);
  for (const t of ["collect", "db", "prompt", "settings"]) $(`#tab-${t}`).hidden = t !== name;
  if (name === "db") renderDb();
  if (name === "prompt") renderPrompt();
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

$("#rangeDefault").addEventListener("click", () => {
  const r = defaultRange();
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
    box.append(el("label", {}, el("input", { type: "checkbox", "data-kind": "cafe", "data-i": i, checked: true, onchange: updatePickCount }), c.name || c.id));
  });
  box.append(el("div", { class: "group", text: "자동차 커뮤니티" }));
  s.communities.forEach((c, i) => {
    if (!c.on || !c.url) return;
    box.append(el("label", {}, el("input", { type: "checkbox", "data-kind": "community", "data-i": i, checked: true, onchange: updatePickCount }), c.name || c.url));
  });
  updatePickCount();
}

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
  const tr = sourceRows.get(key);
  if (!tr) return;
  const td = tr.children;
  if (listed !== undefined) td[1].textContent = listed;
  if (candidates !== undefined) td[2].textContent = candidates;
  if (read !== undefined) td[3].textContent = read;
  if (issues !== undefined) td[4].textContent = issues;
  if (status !== undefined) {
    td[5].textContent = status;
    td[5].className = error ? "err" : "";
  }
}

// ---------------------------------------------------------------------------
// 결과 표 (받기 전에 고치기)
// ---------------------------------------------------------------------------

function fmtMonthDay(d) {
  return d ? `${pad2(d.getMonth() + 1)}월 ${pad2(d.getDate())}일` : "";
}

function renderResults() {
  const tbody = $("#results tbody");
  tbody.textContent = "";
  state.rows.forEach((r, i) => {
    const sum = el("input", { type: "text", value: r.summary, title: r.summary, oninput: (e) => (r.summary = e.target.value, e.target.title = e.target.value, saveLastResult()) });
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
      el("td", {}, el("input", { type: "text", value: r.car, size: 7, oninput: (e) => (r.car = e.target.value, saveLastResult()) })),
      el("td", { text: fmtMonthDay(r.date) }),
      el(
        "td",
        {},
        (() => {
          const sel = el("select", { onchange: (e) => (r.category = e.target.value, saveLastResult()) });
          for (const c of ["품질", "응대", "결품"]) sel.append(el("option", { value: c, text: c, selected: r.category === c }));
          return sel;
        })()
      ),
      el("td", { class: "url" }, el("a", { href: r.url, target: "_blank", title: r.url, text: r.url.replace(/^https?:\/\/(www\.)?/, "") })),
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
          },
        })
      ),
      (() => {
        const td = el("td", { class: `rep${r.report ? "" : " off"}`, text: r.report ? "✅" : "☐", title: r.kind === "community" ? "자동차 커뮤니티 글 (보고 필요 대상 아님)" : "눌러서 보고 필요 표시/해제" });
        td.addEventListener("click", () => {
          r.report = !r.report;
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
            state.rows.splice(i, 1);
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
  state.rows = state.rows.filter((r) => !r.selected);
  renderResults();
  await saveLastResult();
});

$("#clearResults").addEventListener("click", async () => {
  if (state.running || !state.rows.length) return;
  if (!confirm(`결과 표의 ${state.rows.length}건을 모두 비울까요? (데일리 DB 에 저장된 이력은 지워지지 않습니다)`)) return;
  state.rows = [];
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

async function renderDb() {
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
        el("td", { text: `${e.count}건` }),
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
}

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
    state.base = e ? { label: `데일리 DB ${fmtDateTime(new Date(e.finishedAt))}`, rows: deserializeRows(e.rows) } : null;
  }
  $("#baseInfo").textContent = state.base ? `기존 ${state.base.rows.length}건 뒤에 이어서 작성합니다 (같은 게시물은 기존 것만 남김).` : "";
  $("#clearBase").hidden = !state.baseFile;
}

$("#baseSelect").addEventListener("change", onBaseChange);
$("#baseFile").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const rows = await ReportXlsx.read(new Uint8Array(await f.arrayBuffer()));
    if (!rows.length) throw new Error("이 파일에서 보고서 행(커뮤니티명·주요 내용 머리글)을 찾지 못했습니다");
    state.baseFile = { label: `${f.name} (${rows.length}건)`, rows };
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
      savedAt: Date.now(),
    },
  });
}

async function loadLastResult() {
  const { lastResult } = await chrome.storage.local.get("lastResult");
  if (!lastResult) return;
  state.rows = deserializeRows(lastResult.rows);
  state.range = lastResult.range ? { start: new Date(lastResult.range.start), end: new Date(lastResult.range.end) } : null;
  if (state.rows.length || state.range) {
    renderResults();
    if (state.range) setSummary(`지난 수집 결과 (${fmtDateTime(state.range.start)} ~ ${fmtDateTime(state.range.end)}): ${state.rows.length}건`);
  }
}

// 설정의 파일 이름에서 {날짜} 를 수집 끝 날짜(예: 261011)로 바꾼다
function reportFilename(range, ascii = false) {
  const d = range ? range.end : new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  if (ascii) return `${ymd}_HMG_community_issues.xlsx`;
  const tpl = (state.settings && state.settings.fileName) || DEFAULT_SETTINGS.fileName;
  const name = tpl.replace(/\{날짜\}/g, ymd).replace(/[\\/:*?"<>|]/g, "_").replace(/\.xlsx$/i, "").trim();
  return `${name || ymd}.xlsx`;
}

async function downloadReport(rows = state.rows, range = state.range) {
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
}
$("#download").addEventListener("click", () => downloadReport(state.rows, state.range).catch((e) => log(`엑셀 저장 실패: ${e.message}`, "err")));

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
  if (src.requireCar && (!row.car || row.car === "-")) return null;
  // 키워드 모드: 2020년 이전 출시 세대는 화재·급발진·시동 꺼짐·사망사고·돌진 같은 매우 심각한 이슈만 (AI 모드는 AI 가 판단)
  if (row.byKeyword) {
    const start = state.codeYears && state.codeYears[String(row.car).replace(/ (EV|HEV|PHEV|N)$/, "")];
    if (start && start < 2020 && !VERY_SEVERE_RE.test(text)) return null;
    delete row.byKeyword;
  }
  return {
    community: src.name,
    date: it.ts ? new Date(it.ts) : null,
    url: it.url,
    order: src.order,
    ts: it.ts || 0,
    kind: src.kind,
    title: it.title,
    excerpt: String(it.body || "").slice(0, 400),
    report: false,
    ...row,
  };
}

// PE 여부 등 차종이 애매하다고 AI 가 표시한 카페 글: 작성자의 다른 글을 보고 차종 코드를 다시 정한다
// (네이버 화면을 더 열게 되므로 한 번 수집에 최대 AUTHOR_LOOKUP_MAX 명까지)
const AUTHOR_LOOKUP_MAX = 60;
async function refineUncertainCars(src, items, judged, ctx) {
  const targets = items.filter((it) => {
    const j = judged.get(it.key);
    return j && j.relevant && j.car_uncertain && it.writer && (it.writer.href || it.writer.memberKey);
  });
  if (!targets.length) return;
  const asks = [];
  for (const it of targets) {
    if (ctx.authorLookups >= AUTHOR_LOOKUP_MAX || state.stopRequested) break;
    ctx.authorLookups++;
    try {
      const titles = await ctx.naver.authorTitles(it, src.cafe, it.writer);
      asks.push({ key: it.key, title: it.title, carNow: judged.get(it.key).car_code, carHint: it.carHint, nick: it.writer.nick, authorTitles: titles, comments: it.comments });
    } catch (e) {
      if (e instanceof StopError || e instanceof BlockedError) throw e;
      log(`${src.name} 작성자 글 확인 실패: ${e.message}`, "err");
    }
  }
  if (!asks.length) return;
  try {
    const fixed = await ctx.ai.refineCars(asks);
    let changed = 0;
    for (const [key, code] of fixed) {
      const j = judged.get(key);
      if (j && code && code !== j.car_code) {
        j.car_code = code;
        changed++;
      }
    }
    log(`${src.name}: 차종이 애매한 글 ${asks.length}건 작성자 글 확인 → ${changed}건 차종 코드 수정`);
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
        title: info.title || post.title,
        body: info.body || "",
        comments: info.comments || "",
        url: post.url,
        ts: ts || post.ts,
        writer: info.writer || null,
      });
    } catch (e) {
      if (e instanceof StopError || e instanceof BlockedError) throw e;
      log(`${src.name} ${post.url} 본문 읽기 실패: ${e.message}`, "err");
    }
    updateSource(src.key, { read, status: `본문 확인 중 ${read}/${candidates.length}` });
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
        row = { car: j.car_code || firstHint(it.carHint) || "-", category: j.category, summary: j.summary, highlight: !!j.highlight };
      } else {
        const text = `${it.title}\n${it.body}`;
        const cat = keywordCategory(text);
        if (!cat) continue;
        const car = guessCarCode(text, parseCarCodes(settings.carCodes)) || firstHint(it.carHint) || "-";
        row = { car, category: cat, summary: it.title, highlight: keywordHighlight(car, text, settings.highlights), byKeyword: true };
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
      const car = guessCarCode(text, codes) || firstHint(it.carHint) || "-";
      const fin = finalizeRow({ car, category: cat, summary: it.title, highlight: keywordHighlight(car, text, settings.highlights), byKeyword: true }, it, src);
      if (!fin || !pushRow(fin)) continue;
      added++;
    }
  }
  sortRows();
  renderResults();
  saveLastResult();
  updateSource(src.key, { issues: added, status: "완료" });
}

// 이어서 작성한 기존 행은 원래 순서 그대로 앞에, 이번 수집 행은 카페·커뮤니티 순서 → 게시 시각 순
function sortRows() {
  state.rows.sort((a, b) => (a.fromBase ? 0 : 1) - (b.fromBase ? 0 : 1) || (a.fromBase ? a.baseIdx - b.baseIdx : a.order - b.order || a.ts - b.ts));
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
    state.rows = rows.map((r, i) => ({ ...r, order: i, ts: r.date ? r.date.getTime() : 0, kind: /cafe\.naver\.com|naver\.me/.test(r.url) ? "cafe" : "community", fromBase: true, baseIdx: i }));
    const m = f.name.match(/^(\d{2})(\d{2})(\d{2})/);
    const end = m ? new Date(2000 + +m[1], +m[2] - 1, +m[3], 8, 0) : new Date();
    state.range = { start: new Date(end.getTime() - 86400000), end };
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

  state.running = true;
  state.stopRequested = false;
  // 이어서 작성: 기존 행을 먼저 넣고(중복은 처음 것만), 이번 수집 결과를 뒤에 붙인다
  state.rows = [];
  state.seenKeys = new Set();
  if (state.base) {
    state.base.rows.forEach((r, i) => pushRow({ ...r, fromBase: true, baseIdx: i, kind: r.kind || "base", order: -1, ts: r.ts || 0 }));
    log(`이어서 작성: ${state.base.label} ${state.base.rows.length}건 → 중복 뺀 ${state.rows.length}건 뒤에 붙입니다`);
  }
  state.range = range;
  state.codeYears = codeStartYears(settings.carCodes);
  renderResults();
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#download").disabled = true;
  $("#log").textContent = "";
  const startedAt = Date.now();
  $("#runTimes").hidden = false;
  $("#runTimes").textContent = `수집 시작 ${fmtDateTime(new Date(startedAt))}:${pad2(new Date(startedAt).getSeconds())} · 수집 중…`;
  log(`v${chrome.runtime.getManifest().version} 수집 시작: ${fmtDateTime(range.start)} ~ ${fmtDateTime(range.end)}, 카페 ${cafes.length}곳, 커뮤니티 ${communities.length}곳, ${useAi ? `AI(${settings.model})` : "키워드 모드"}`);
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
  await pickReports(state.rows.filter((r) => r.kind === "cafe" && !r.fromBase), ai, settings);

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
      try {
        if (settings.workdayReport) await buildWorkdayReport(ai, settings);
        await downloadReport(state.rows, state.range);
        await chrome.storage.local.set({ lastReportAt: finishedAt });
        log("엑셀을 다운로드 폴더에 저장했습니다");
      } catch (e) {
        log(`엑셀 저장 실패: ${e.message}`, "err");
      }
      chrome.runtime.sendMessage({ type: "autoRunDone", count: state.rows.length, blocked: state.naverBlocked }).catch(() => {});
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

function renderPrompt() {
  const s = state.settings;
  $("#customPrompt").value = s.customPrompt || "";
  $("#promptUpdated").textContent = s.customPromptUpdatedAt ? `최종 업데이트: ${fmtDateTime(new Date(s.customPromptUpdatedAt))}` : "아직 추가 지시사항 없음";
  $("#promptBuilt").textContent = `(기본 규칙 업데이트: ${PROMPT_BUILT_AT})`;
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
  $("#fileName").value = s.fileName || "";
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
  draft.workdayReport = $("#workdayReport").checked;
  draft.collectOnHolidays = $("#collectOnHolidays").checked;
  draft.holidays = $("#holidays").value;
  draft.workdays = [...document.querySelectorAll("#workdayBoxes input:checked")].map((x) => x.dataset.day).join(",") || "1,2,3,4,5";
  draft.speed = $("#speed").value;
  draft.carCodes = $("#carCodes").value;
  draft.keywords = $("#keywords").value;
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
  draft = structuredClone(state.settings);
  renderSettings();
  renderPickList();
  updateAiInfo();
  updateAutoInfo();
  const r = defaultRange();
  setRange(r.start, r.end);
  await checkLogin();
  await renderBaseOptions();
  if (AUTO) {
    const end = new Date();
    end.setSeconds(0, 0);
    const { lastAutoRangeEnd } = await chrome.storage.local.get("lastAutoRangeEnd");
    const prev = lastAutoRangeEnd ? new Date(lastAutoRangeEnd) : null;
    // 지난 자동 수집이 끝난 시각부터 이어서 (주말에 못 돌린 경우도 포함, 7일 넘게 비었으면 최근 24시간)
    const start = prev && end - prev <= 7 * 86400000 && prev < end ? prev : new Date(end.getTime() - 86400000);
    setRange(start, end);
    log(`자동 수집을 시작합니다 (${fmtDateTime(start)} ~ ${fmtDateTime(end)}: 지난 자동 수집에 이어서)`);
    await sleep(3000);
    $("#start").click();
  } else {
    await loadLastResult();
  }
})();
