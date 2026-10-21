// 주간 보고서 작성 (담당자 요청 2026-10-21)
// 그 주(월 ~ 마지막 근무일) 데일리 DB 의 일일 PPT 최종본에서 게시글을 모아 추천 10건을 체크해 보여 주고,
// 담당자가 고른 글의 지금 조회수·댓글 수를 다시 읽어 주간 보고서 양식 표에 채워 저장한다.
//   구분: 온라인 / (동호회) — 보배드림·클리앙·뽐뿌는 (자동차 커뮤니티)
//   차종: 일일 PPT 차종 · 현상: 상세 페이지 제목에서 차명(차종) 뒤 한 줄 · 상세 내용: 본문 요약
//   온라인 모니터링 단계: 주의/경고/심각 색 구분 + 지금 조회수 / 댓글 · 비고: 신규/중복 + (M/D 보고)

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PPT_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TOTAL = 10;
const PER_DAY = 2;
const COMMUNITY_RE = /bobaedream|clien\.net|ppomppu|보배드림|클리앙|뽐뿌/i;
const LEVEL_RANK = { 심각: 3, 경고: 2, 주의: 1 };

let settings = null;
let week = null; // { start, end, days: [dateKey] }
let cands = [];
let working = false;

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

// ---------------------------------------------------------------------------
// 저장소 (report-extension / kv)
// ---------------------------------------------------------------------------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("report-extension", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvGet(key) {
  const db = await idb();
  return new Promise((resolve) => {
    const r = db.transaction("kv").objectStore("kv").get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  });
}
async function kvSet(key, value) {
  const db = await idb();
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readwrite");
    if (value == null) tx.objectStore("kv").delete(key);
    else tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// 저장 위치: 주간 보고서용으로 따로 고른 폴더 → 없으면 PPT 저장 폴더 → 모니터링 엑셀 저장 폴더 → 다운로드 폴더
function monitorSaveDir() {
  return new Promise((resolve) => {
    const open = indexedDB.open("issueMonitor", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const r = open.result.transaction("handles").objectStore("handles").get("saveDir");
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}
async function weeklyDirHandle() {
  return (await kvGet("weeklySaveDir")) || (await kvGet("saveDir")) || (await monitorSaveDir());
}
async function weeklyDirIfAllowed(ask = true) {
  const h = await weeklyDirHandle();
  if (!h) return null;
  try {
    let p = await h.queryPermission({ mode: "readwrite" });
    if (p !== "granted" && ask) p = await h.requestPermission({ mode: "readwrite" });
    return p === "granted" ? h : null;
  } catch {
    return null;
  }
}
async function showWhere() {
  const own = await kvGet("weeklySaveDir");
  const h = own || (await weeklyDirHandle());
  $("#wkWhere").textContent = h ? `📁 ${h.name}${own ? "" : " (PPT 저장 폴더와 같음)"}` : "다운로드 폴더";
}
async function freeName(dir, fileName) {
  if (!dir) return fileName;
  const dot = fileName.lastIndexOf(".");
  const base = fileName.slice(0, dot);
  const ext = fileName.slice(dot);
  for (let i = 0; i < 100; i++) {
    const n = i ? `${base} (${i})${ext}` : fileName;
    try {
      await dir.getFileHandle(n);
    } catch {
      return n;
    }
  }
  return `${base} (${Date.now()})${ext}`;
}
async function saveFile(dir, fileName, bytes) {
  if (dir) {
    try {
      const fh = await dir.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      return `📁 ${dir.name}/${fileName}`;
    } catch (e) {
      setSummary(`고른 폴더에 저장하지 못해 다운로드 폴더로 받습니다 (${e.message || e})`, "err");
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: PPT_MIME }));
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return `다운로드 폴더/${fileName}`;
}

// ---------------------------------------------------------------------------
// 주간 기간: 기준일이 있는 주의 월요일 ~ 그 주 마지막 근무일
// ---------------------------------------------------------------------------
function weekOf(d) {
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 7; i++) days.push(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
  const work = days.filter((x) => isWorkday(x, settings));
  const end = work.length ? work[work.length - 1] : days[4];
  return { start: mon, end, days: days.map(DailyPpt.dateKey), workdays: work.map(DailyPpt.dateKey) };
}
const isLastWorkday = (d) => {
  const w = weekOf(d);
  return DailyPpt.dateKey(d) === DailyPpt.dateKey(w.end) && isWorkday(d, settings);
};
const md = (k) => {
  const [, m, d] = k.split("-").map(Number);
  return `${m}/${d}`;
};
const dow = (k) => "일월화수목금토"[new Date(`${k}T00:00`).getDay()];
const numOf = (v) => Number(String(v ?? "").replace(/[^\d]/g, "")) || 0;

function isNewCar(code) {
  const list = String(settings.priorityCars || "").split(",").map((x) => x.trim()).filter(Boolean);
  const c = String(code || "").trim();
  return list.some((p) => c === p || c.startsWith(`${p} `));
}

// ---------------------------------------------------------------------------
// 게시글 모으기 + 추천
// ---------------------------------------------------------------------------
async function loadWeek() {
  const v = $("#weekDate").value;
  const base = v ? new Date(`${v}T00:00`) : new Date();
  week = weekOf(base);
  const days = await DailyPpt.byDate();
  cands = [];
  const chips = [];
  for (const k of week.days) {
    const day = days.find((x) => x.date === k);
    const isWork = week.workdays.includes(k);
    if (!day) {
      if (isWork) chips.push(`<span class="day none">${md(k)}(${dow(k)}) PPT 없음</span>`);
      continue;
    }
    const f = day.final;
    let details = [];
    try {
      details = await PptRead.read(f.bytes);
    } catch {}
    chips.push(`<span class="day ${f.partial ? "warn" : "ok"}">${md(k)}(${dow(k)}) ${esc(DailyPpt.KIND_LABEL[f.kind])} ${details.length}건${f.partial ? " · ⚠ 일부만 있는 PPT(전체 PPT 를 데일리 DB 에 올려 주세요)" : ""}</span>`);
    for (const x of details) {
      if (!x.title) continue;
      const issue = x.title.replace(/^.*?\([^)]*\)\s*/, "").trim() || x.short || x.title;
      cands.push({
        key: `${k}#${x.no}`,
        date: k,
        no: x.no,
        code: x.code,
        issue,
        body: x.body,
        level: x.level || "주의",
        views: numOf(x.views),
        comments: numOf(x.commentCount),
        duplicate: (x.duplicate || "신규").replace(/\s+/g, " ").trim(),
        url: x.url,
        cafe: x.cafe,
        community: COMMUNITY_RE.test(`${x.url} ${x.cafe}`),
        isNew: isNewCar(x.code),
      });
    }
  }
  $("#dayList").innerHTML = chips.join("");
  $("#weekInfo").textContent = `${DailyPpt.dateKey(week.start)}(월) ~ ${DailyPpt.dateKey(week.end)}(${dow(DailyPpt.dateKey(week.end))}) · 근무일 ${week.workdays.length}일 · 게시글 ${cands.length}건`;
  recommend();
  renderCands();
}

const score = (c) => [LEVEL_RANK[c.level] || 1, c.isNew ? 1 : 0, c.views];
const byScore = (a, b) => {
  const x = score(a);
  const y = score(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return a.no - b.no;
};

// 하루 2건씩 10건 (근무일이 적으면 보고 건수 많은 날에서 3건), 경고·심각은 반드시, 그다음 신차·조회수 높은 순
function recommend() {
  const byDay = new Map();
  for (const c of cands) {
    if (!byDay.has(c.date)) byDay.set(c.date, []);
    byDay.get(c.date).push(c);
  }
  const days = [...byDay.keys()].sort();
  const quota = new Map(days.map((d) => [d, Math.min(PER_DAY, byDay.get(d).length)]));
  let rem = TOTAL - [...quota.values()].reduce((s, q) => s + q, 0);
  while (rem > 0) {
    const more = days.filter((d) => byDay.get(d).length > quota.get(d)).sort((a, b) => quota.get(a) - quota.get(b) || byDay.get(b).length - byDay.get(a).length);
    if (!more.length) break;
    quota.set(more[0], quota.get(more[0]) + 1);
    rem--;
  }
  // 같은 글이 여러 날 보고됐으면 처음 보고한 날 것 하나만
  const seen = new Set();
  const urlKey = (c) => String(c.url || c.key).replace(/[?#].*$/, "").toLowerCase();
  for (const c of [...cands].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    c.dup = seen.has(urlKey(c));
    seen.add(urlKey(c));
    c.picked = !c.dup && (c.level === "경고" || c.level === "심각");
  }
  for (const d of days) {
    const list = byDay.get(d).sort(byScore);
    let n = list.filter((c) => c.picked).length;
    for (const c of list) {
      if (n >= quota.get(d)) break;
      if (!c.picked && !c.dup) {
        c.picked = true;
        n++;
      }
    }
  }
}

function renderCands() {
  const tbody = $("#candTable tbody");
  tbody.innerHTML = "";
  $("#candTable").hidden = !cands.length;
  $("#candEmpty").hidden = !!cands.length;
  $("#candEmpty").textContent = week ? "이 주에 데일리 DB 에 보관된 일일 PPT 가 없습니다. 데일리 DB 탭에서 지난 전체 PPT 를 올려 주세요." : "위에서 [이 주 게시글 불러오기]를 눌러 주세요.";
  let last = "";
  for (const c of [...cands].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no))) {
    if (c.date !== last) {
      last = c.date;
      tbody.insertAdjacentHTML("beforeend", `<tr class="daysep"><td colspan="9">${md(c.date)}(${dow(c.date)}) 보고</td></tr>`);
    }
    const tr = document.createElement("tr");
    tr.className = c.picked ? "picked" : "";
    tr.innerHTML = `<td><input type="checkbox"${c.picked ? " checked" : ""}></td><td>${md(c.date)}</td><td>${c.no}</td><td>${c.community ? "커뮤니티" : "동호회"}</td><td>${esc(c.code)}${c.isNew ? " 🆕" : ""}</td><td>${esc(c.issue)}</td><td class="lv-${esc(c.level)}">${esc(c.level)}</td><td>${c.views.toLocaleString()} / ${c.comments.toLocaleString()}</td><td>${esc(c.duplicate)}</td>`;
    tr.querySelector("input").addEventListener("change", (e) => {
      c.picked = e.target.checked;
      tr.className = c.picked ? "picked" : "";
      renderCount();
    });
    tbody.appendChild(tr);
  }
  renderCount();
}

function renderCount() {
  const n = cands.filter((c) => c.picked).length;
  $("#pickCount").textContent = cands.length ? `${n}건 선택${n !== TOTAL ? ` (보통 ${TOTAL}건)` : ""}` : "";
  $("#buildWeekly").disabled = !n || working;
}

// ---------------------------------------------------------------------------
// 만들기: 조회수·댓글 새로 읽기 → 양식 표 채우기 → 저장 + 보관함
// ---------------------------------------------------------------------------
window.pptBusy = () => working; // 수집 화면 로딩바·뒤로 가기 막기용

async function buildWeekly({ auto = false } = {}) {
  const picked = cands.filter((c) => c.picked).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no));
  if (!picked.length) return setSummary("고른 게시글이 없습니다", "err");
  try {
    if (window.parent !== window && window.parent.isCollecting && window.parent.isCollecting()) {
      return setSummary("부정 이슈 수집이 진행 중입니다. 수집이 끝난 뒤 만들어 주세요 (네이버를 동시에 두 군데서 열지 않게).", "err");
    }
  } catch {}
  const tpl = await kvGet("weeklyTemplate");
  if (!tpl) return setSummary("주간 보고서 양식 PPT 를 먼저 넣어 주세요 (①)", "err");
  const dir = await weeklyDirIfAllowed(!auto);
  working = true;
  renderCount();
  try {
    let refreshed = 0;
    for (const [i, c] of picked.entries()) {
      setSummary(`처리 중… ${i} / ${picked.length}건 · 「${c.issue}」 조회수·댓글 다시 읽는 중`);
      if (/cafe\.naver\.com|naver\.me/.test(c.url || "")) {
        const got = await readPostCounts(c.url, { cafe: c.cafe, title: c.issue }).catch(() => null);
        if (got && !got.deleted && (got.views || got.commentCount)) {
          if (got.views) c.views = numOf(got.views);
          if (got.commentCount) c.comments = numOf(got.commentCount);
          refreshed++;
        }
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
      }
    }
    await closeCaptureWindow().catch(() => {});
    setSummary(`처리 중… ${picked.length} / ${picked.length}건 · PPT 만드는 중`);
    const bytes = await WeeklyPptx.build(tpl.bytes, picked.map((c) => ({ ...c, reportDate: c.date })));
    const endKey = DailyPpt.dateKey(week.end);
    const ymd = endKey.slice(2).replace(/-/g, "");
    const name = `${($("#wkName").value.trim() || "{날짜}_주간 모니터링 보고서").replace("{날짜}", ymd).replace(/[<>:"/\\|?*]/g, "_")}.pptx`;
    const fileName = await freeName(dir, name);
    const where = await saveFile(dir, fileName, bytes);
    const hist = (await kvGet("weeklyHistory")) || [];
    hist.unshift({ at: Date.now(), start: DailyPpt.dateKey(week.start), end: endKey, name: fileName, bytes, count: picked.length, where });
    await kvSet("weeklyHistory", hist.slice(0, 20));
    await chrome.storage.local.set({ weeklyLastBuilt: endKey });
    renderHistory();
    const msg = `✅ 주간 보고서 저장 완료: ${where} (${picked.length}건 · 조회수·댓글 새로 읽음 ${refreshed}건${picked.length - refreshed ? `, 나머지는 일일 보고 때 값` : ""})`;
    setSummary(msg, "ok");
    if (!auto) alert(msg);
  } catch (e) {
    setSummary(`주간 보고서를 만들지 못했습니다: ${e.message || e}`, "err");
  } finally {
    working = false;
    renderCount();
  }
}

async function renderHistory() {
  const hist = (await kvGet("weeklyHistory")) || [];
  const tbody = $("#histTable tbody");
  tbody.innerHTML = "";
  $("#histTable").hidden = !hist.length;
  $("#histEmpty").hidden = !!hist.length;
  for (const h of hist) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${new Date(h.at).toLocaleString("ko-KR")}</td><td>${esc(h.start)} ~ ${esc(h.end)}</td><td>${esc(h.name)}</td><td class="count-red">${h.count}건</td><td><button>받기</button></td>`;
    tr.querySelector("button").addEventListener("click", async () => {
      const dir = await weeklyDirIfAllowed(true);
      const where = await saveFile(dir, await freeName(dir, h.name), h.bytes);
      alert(`✅ 주간 보고서 저장 완료\n\n저장 위치: ${where}`);
    });
    tbody.appendChild(tr);
  }
}

async function showTemplate() {
  const tpl = await kvGet("weeklyTemplate");
  $("#tplInfo").textContent = tpl ? `넣어 둔 양식: ${tpl.name} (${new Date(tpl.at).toLocaleString("ko-KR")})` : "아직 양식이 없습니다. 지난주 주간 보고서 PPT 를 넣어 주세요.";
  $("#tplInfo").className = tpl ? "hint ok" : "hint err";
}

// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  settings = await loadSettings();
  const now = new Date();
  $("#weekDate").value = DailyPpt.dateKey(now);
  const { weeklyAuto = { on: false, time: "16:00" }, weeklyFileName } = await chrome.storage.local.get(["weeklyAuto", "weeklyFileName"]);
  $("#wkAuto").checked = !!weeklyAuto.on;
  $("#wkTime").value = weeklyAuto.time || "16:00";
  if (weeklyFileName) $("#wkName").value = weeklyFileName;
  const saveAuto = () => chrome.storage.local.set({ weeklyAuto: { on: $("#wkAuto").checked, time: $("#wkTime").value || "16:00" } });
  $("#wkAuto").addEventListener("change", saveAuto);
  $("#wkTime").addEventListener("change", saveAuto);
  $("#wkName").addEventListener("change", () => chrome.storage.local.set({ weeklyFileName: $("#wkName").value.trim() }));

  $("#tplFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      await WeeklyPptx.build(bytes, []); // 양식 표를 찾을 수 있는지 미리 확인
    } catch (err) {
      return setSummary(`이 파일은 주간 보고서 양식으로 쓸 수 없습니다: ${err.message || err}`, "err");
    }
    await kvSet("weeklyTemplate", { name: f.name, bytes, at: Date.now() });
    showTemplate();
    setSummary("주간 보고서 양식을 저장했습니다", "ok");
  });
  $("#pickWkFolder").addEventListener("click", async () => {
    try {
      const h = await window.showDirectoryPicker({ id: "weekly-out", mode: "readwrite", startIn: "desktop" });
      await kvSet("weeklySaveDir", h);
      showWhere();
    } catch (e) {
      if (e && e.name !== "AbortError") setSummary(`폴더를 고르지 못했습니다: ${e.message || e}`, "err");
    }
  });
  $("#clearWkFolder").addEventListener("click", async () => {
    await kvSet("weeklySaveDir", null);
    showWhere();
  });
  $("#loadWeek").addEventListener("click", () => loadWeek().catch((e) => setSummary(`불러오지 못했습니다: ${e.message || e}`, "err")));
  $("#reRecommend").addEventListener("click", () => {
    recommend();
    renderCands();
  });
  $("#buildWeekly").addEventListener("click", () => buildWeekly());

  await showTemplate();
  await showWhere();
  await renderHistory();
  await loadWeek().catch(() => {});

  // 자동 작성: 수집 화면이 ?weekly=1 로 열렸으면 (마지막 근무일 정해진 시각) 추천 10건으로 바로 만든다
  let auto = false;
  try {
    auto = new URL(window.parent.location.href).searchParams.get("weekly") === "1";
  } catch {}
  if (auto && isLastWorkday(now)) {
    const { weeklyLastBuilt } = await chrome.storage.local.get("weeklyLastBuilt");
    if (weeklyLastBuilt !== DailyPpt.dateKey(week.end) && cands.length) await buildWeekly({ auto: true });
  }
});
