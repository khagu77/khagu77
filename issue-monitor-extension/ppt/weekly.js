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
let basis = []; // 이번 주 작성에 쓰는 날짜별 일일 PPT 최종본 [{ day, id, at }]
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
// "1.3만"·"2,731건" → 숫자 (비교·정렬용). 화면·PPT 에는 만 단위 글자를 그대로 쓴다
const numOf = (v) => {
  const t = String(v ?? "").replace(/[\s,건]/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)([만천])$/);
  if (m) return Math.round(Number(m[1]) * (m[2] === "만" ? 10000 : 1000));
  return Number(t.replace(/[^\d]/g, "")) || 0;
};
const countLabel = (v) => {
  const t = String(v ?? "").replace(/[\s건]/g, "");
  return /^\d[\d.,]*[만천]$/.test(t) ? t : numOf(v).toLocaleString("en-US");
};

function isNewCar(code) {
  const list = String(settings.priorityCars || "").split(",").map((x) => x.trim()).filter(Boolean);
  const c = String(code || "").trim();
  return list.some((p) => c === p || c.startsWith(`${p} `));
}

// ---------------------------------------------------------------------------
// 게시글 모으기 + 추천
// ---------------------------------------------------------------------------
let excludedDays = new Set(); // 이번 주 작성에서 뺀 날 (날짜 칩을 눌러 빼기/넣기)

async function loadWeek() {
  const v = $("#weekDate").value;
  const base = v ? new Date(`${v}T00:00`) : new Date();
  week = weekOf(base);
  const days = await DailyPpt.byDate();
  cands = [];
  const chips = [];
  basis = []; // 이번 주 작성에 쓰는 날짜별 일일 PPT 최종본 (선택 저장 때 함께 기록)
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
    const off = excludedDays.has(k);
    chips.push(`<button type="button" class="day ${off ? "off" : f.partial ? "warn" : "ok"}" data-day="${k}" title="${off ? "눌러서 다시 넣기" : "눌러서 이 날 보고서를 이번 주 작성에서 빼기"}">${off ? "✕ " : "✓ "}${md(k)}(${dow(k)}) ${esc(DailyPpt.KIND_LABEL[f.kind])} ${details.length}건${off ? " · 뺌" : f.partial ? " · ⚠ 일부만 있는 PPT(전체 PPT 를 데일리 DB 에 올려 주세요)" : ""}</button>`);
    if (off) continue;
    basis.push({ day: k, id: f.id, at: f.at || 0 });
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
        viewsText: countLabel(x.views),
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
  for (const b of document.querySelectorAll("#dayList [data-day]")) {
    b.addEventListener("click", () => {
      const k = b.dataset.day;
      excludedDays.has(k) ? excludedDays.delete(k) : excludedDays.add(k);
      loadWeek();
    });
  }
  $("#weekInfo").textContent = `${DailyPpt.dateKey(week.start)}(월) ~ ${DailyPpt.dateKey(week.end)}(${dow(DailyPpt.dateKey(week.end))}) · 근무일 ${week.workdays.length}일 · 게시글 ${cands.length}건`;
  recommend();
  // 담당자가 이 주에 고쳐 둔 선택이 있으면 그대로 (추천보다 우선)
  // 단, 선택을 저장한 뒤 일일 보고서가 새로 붙었거나(예: 4일치로 고른 뒤 금요일 PPT 첨부) 최종본이 바뀌었거나 뺀 날이 달라졌으면
  // 저장된 선택은 지우고 지금 날짜들 전체를 기준으로 다시 10건 추천 (담당자 지적 2026-10-30: 5번째 PPT 글이 체크되지 않음)
  let saved = await loadPicks();
  if (saved && pickBasisChanged(saved)) {
    await savePicks(true);
    saved = null;
    $("#weekInfo").textContent += " · 일일 보고서가 바뀌어 전체 날짜 기준으로 다시 추천했습니다";
  }
  if (saved) {
    const set = new Set(saved.keys);
    for (const c of cands) c.picked = set.has(c.key);
    $("#weekInfo").textContent += ` · 담당자가 고른 선택 불러옴 (${new Date(saved.at).toLocaleString("ko-KR")} 저장)`;
  }
  renderCands();
}

function pickBasisChanged(saved) {
  if (Array.isArray(saved.basis)) {
    const sig = (b) => b.map((x) => `${x.day}:${x.id}`).sort().join("|");
    return sig(saved.basis) !== sig(basis);
  }
  // 예전 저장(기준 기록 없음): 선택을 저장한 뒤에 들어온 일일 보고서가 있으면 바뀐 것으로
  return basis.some((x) => x.at > (saved.at || 0));
}

// 주간 보고 게시글 선택을 바꿀 때마다 그 주 선택을 바로 저장 (담당자 요청 2026-10-23)
// 다시 열거나 새로고침해도 고친 선택 그대로. [추천대로 다시 체크]·[↺ 초기화]를 누르면 추천으로 돌아감
const weekKey = () => (week ? DailyPpt.dateKey(week.start) : "");
async function loadPicks() {
  const all = (await kvGet("weeklyPicks")) || {};
  return all[weekKey()] || null;
}
async function savePicks(clear = false) {
  if (!week) return;
  const all = (await kvGet("weeklyPicks")) || {};
  if (clear) delete all[weekKey()];
  else all[weekKey()] = { keys: cands.filter((c) => c.picked).map((c) => c.key), at: Date.now(), basis };
  // 최근 12주만 보관
  const keys = Object.keys(all).sort().reverse().slice(0, 12);
  await kvSet("weeklyPicks", Object.fromEntries(keys.map((k) => [k, all[k]])));
  const st = $("#pickSaved");
  if (st) st.textContent = clear ? "추천대로 (저장된 선택 없음)" : `✓ 선택 저장됨 ${new Date().toLocaleTimeString("ko-KR")}`;
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
  // 겹치는 글을 빼느라 10건이 안 되면, 남은 글 중 점수 높은 순으로 채운다
  let total = cands.filter((c) => c.picked).length;
  for (const c of cands.filter((x) => !x.picked && !x.dup).sort(byScore)) {
    if (total >= TOTAL) break;
    c.picked = true;
    total++;
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
    tr.innerHTML = `<td><input type="checkbox"${c.picked ? " checked" : ""}></td><td>${md(c.date)}</td><td>${c.no}</td><td>${c.community ? "커뮤니티" : "동호회"}</td><td>${esc(c.code)}${c.isNew ? " 🆕" : ""}</td><td>${esc(c.issue)}</td><td class="lv-${esc(c.level)}">${esc(c.level)}</td><td>${esc(c.viewsText || c.views.toLocaleString())} / ${c.comments.toLocaleString()}</td><td>${esc(c.duplicate)}</td>`;
    tr.querySelector("input").addEventListener("change", (e) => {
      c.picked = e.target.checked;
      tr.className = c.picked ? "picked" : "";
      renderCount();
      savePicks();
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
          if (got.views) {
            c.views = numOf(got.views);
            c.viewsText = countLabel(got.views);
          }
          if (got.commentCount) c.comments = numOf(got.commentCount);
          refreshed++;
        }
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
      }
    }
    await closeCaptureWindow().catch(() => {});
    setSummary(`처리 중… ${picked.length} / ${picked.length}건 · PPT 만드는 중`);
    const bytes = await WeeklyPptx.build(tpl.bytes, picked.map((c) => ({ ...c, views: c.viewsText || c.views, reportDate: c.date })));
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

// 주간 보고서 보관함(주간 DB): 주마다 시스템 작성본 + 담당자 수정본(최종본). 수정본을 올리면 그 주의 최종본이 된다 (담당자 요청 2026-10-23)
async function weeklyRowsIn(bytes) {
  // 올린 PPT 에서 게시글 줄 수 (구분 칸이 '온라인'인 줄)
  try {
    const files = await Zip.read(bytes);
    let n = 0;
    for (const [name, data] of files) {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
      const x = Zip.text(data);
      n += (x.match(/<a:tr[ >][\s\S]*?<\/a:tr>/g) || []).filter((tr) => /<a:t>\s*온라인\s*<\/a:t>/.test(tr)).length;
    }
    return n;
  } catch {
    return 0;
  }
}

async function attachWeeklyFinal(file, target = null) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const count = await weeklyRowsIn(bytes);
  if (!count) throw new Error(`${file.name}: 주간 보고서 표(구분 '온라인' 줄)를 찾지 못했습니다`);
  const hist = (await kvGet("weeklyHistory")) || [];
  let h = target ? hist.find((x) => x.at === target.at) : null;
  if (!h) {
    let d = DailyPpt.dateFromName(file.name);
    if (!d) {
      d = (prompt(`「${file.name}」 은 어느 주의 보고서인가요? 그 주의 아무 날짜나 적어 주세요 (예: 2026-10-23)`, DailyPpt.dateKey(new Date())) || "").trim().replace(/[./]/g, "-");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`${file.name}: 날짜를 알 수 없어 건너뜁니다`);
    }
    const w = weekOf(new Date(`${d}T00:00`));
    const start = DailyPpt.dateKey(w.start);
    const end = DailyPpt.dateKey(w.end);
    h = hist.find((x) => x.start === start && x.end === end);
    if (!h) {
      h = { at: Date.now(), start, end, name: file.name, bytes, count, where: "", uploaded: true };
      hist.unshift(h);
    }
  }
  h.final = { name: file.name, bytes, at: Date.now(), count };
  await kvSet("weeklyHistory", hist.slice(0, 20));
  return `${h.start} ~ ${h.end} 주 최종본: ${file.name} (${count}건)`;
}

let wkTarget = null;
async function renderHistory() {
  const hist = (await kvGet("weeklyHistory")) || [];
  const tbody = $("#histTable tbody");
  tbody.innerHTML = "";
  $("#histTable").hidden = !hist.length;
  $("#histEmpty").hidden = !!hist.length;
  for (const h of hist) {
    const f = h.final || null;
    const tr = document.createElement("tr");
    const short = (t) => {
      const d = new Date(t);
      return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    tr.innerHTML = `<td>${short(h.at)}</td><td>${esc(h.start)} ~ ${esc(h.end)}</td><td><b>${f ? "담당자 수정본" : h.uploaded ? "올린 파일" : "시스템 작성본"}</b>${f ? `<div class="hint">${short(f.at)} 올림</div>` : ""}</td><td>${esc(f ? f.name : h.name)}</td><td class="count-red">${f ? f.count : h.count}건</td><td class="actions"><div class="acts"><button data-a="get" class="btn-get" title="${f ? "담당자 수정본(최종본) 받기" : "받기"}">⬇ ${f ? "최종본 받기" : "받기"}</button>${f && !h.uploaded ? '<button data-a="sys" class="btn-sys" title="시스템이 처음 만든 파일 받기">시스템본 받기</button>' : ""}<button data-a="up">수정본 올리기</button>${f ? '<button data-a="delf" class="btn-warn" title="올린 수정본만 지우고 시스템 작성본을 최종본으로">수정본 지우기</button>' : ""}<button data-a="del" class="danger">삭제</button></div></td>`;
    const save = async (name, bytes) => {
      const dir = await weeklyDirIfAllowed(true);
      const where = await saveFile(dir, await freeName(dir, name), bytes);
      alert(`✅ 주간 보고서 저장 완료\n\n저장 위치: ${where}`);
    };
    tr.querySelector('[data-a="get"]').addEventListener("click", () => save(f ? f.name : h.name, f ? f.bytes : h.bytes));
    tr.querySelector('[data-a="sys"]')?.addEventListener("click", () => save(h.name, h.bytes));
    // 필요 없는 주간 보고서 기록 지우기 (담당자 요청 2026-10-23) — 저장 폴더의 파일은 그대로
    const removeIt = async (onlyFinal) => {
      const list = (await kvGet("weeklyHistory")) || [];
      const i = list.findIndex((x) => x.at === h.at);
      if (i < 0) return;
      if (onlyFinal && !list[i].uploaded) delete list[i].final;
      else list.splice(i, 1);
      await kvSet("weeklyHistory", list);
      renderHistory();
    };
    tr.querySelector('[data-a="del"]').addEventListener("click", () => {
      if (confirm(`주간 DB 에서 ${h.start} ~ ${h.end} 주간 보고서 기록을 지울까요?${f ? "\n(시스템 작성본과 올린 수정본 모두)" : ""}\n(저장 폴더의 파일은 그대로입니다)`)) removeIt(false);
    });
    tr.querySelector('[data-a="delf"]')?.addEventListener("click", () => {
      if (confirm(`올린 수정본(${f.name})만 지울까요?${h.uploaded ? "\n(시스템 작성본이 없는 주라 이 주 기록 전체가 지워집니다)" : "\n시스템 작성본이 다시 최종본이 됩니다."}`)) removeIt(true);
    });
    tr.querySelector('[data-a="up"]').addEventListener("click", () => {
      wkTarget = h;
      $("#wkUploadOne").click();
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
    savePicks(true); // 추천으로 돌아감 (저장된 선택 지움)
  });
  // 선택 초기화: 체크를 모두 지움 (처음부터 직접 고를 때)
  $("#clearPicks").addEventListener("click", () => {
    for (const c of cands) c.picked = false;
    renderCands();
    savePicks();
  });
  // 기간 초기화: 기준일을 오늘로, 뺀 날도 모두 다시 넣고 새로 불러와 추천대로 체크
  $("#resetWeek").addEventListener("click", () => {
    excludedDays = new Set();
    $("#weekDate").value = DailyPpt.dateKey(new Date());
    week = weekOf(new Date());
    savePicks(true)
      .then(() => loadWeek())
      .catch((e) => setSummary(`불러오지 못했습니다: ${e.message || e}`, "err"));
  });
  $("#buildWeekly").addEventListener("click", () => buildWeekly());
  $("#wkUpload").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const ok = [];
    const bad = [];
    for (const f of files) {
      try {
        ok.push(await attachWeeklyFinal(f));
      } catch (err) {
        bad.push(err.message || String(err));
      }
    }
    await renderHistory();
    alert(`${ok.length ? `✅ 주간 DB 에 최종본으로 저장했습니다\n${ok.join("\n")}` : ""}${bad.length ? `\n\n⚠ 저장하지 못한 파일\n${bad.join("\n")}` : ""}`);
  });
  $("#wkUploadOne").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !wkTarget) return;
    try {
      alert(`✅ ${await attachWeeklyFinal(f, wkTarget)}`);
    } catch (err) {
      alert(`⚠ ${err.message || err}`);
    }
    wkTarget = null;
    await renderHistory();
  });

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
