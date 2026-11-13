// 월간 실적 보고 (담당자 요청 2026-11-13)
// - 매월 25일 보고, 25일이 주말·휴일이면 바로 전 근무일. 기간 = 지난 보고일 다음 날 ~ 이번 보고일 (게시일 기준)
// - 지난달 보고서 PPT 를 틀로 그대로 써서 글자만 바꾼다 (MonthlyPptx). 지난달 값은 '전월' 칸으로 옮긴다
// - 2페이지 표(차종·카테고리·채널)는 보고일의 일일동향 엑셀에서 기간 안 게시글을 세어 채운다
//   차종은 이번 달 순위순, 전월은 같은 차종의 지난 보고서 건수, 두 달 모두 0건인 차종은 뺀다
// - 1페이지 화재/급발진·시스템 수집·동호회·유튜브·번외 횟수·번외 내용(제목+날짜)은 담당자가 직접 입력
// - 개요(1·2페이지, 서로 겹치지 않게)와 주요 이슈 목록은 이 기간 데일리 DB 의 일일 PPT 를 근거로 AI 가 쓰고 담당자가 고친다
// 보관 (IndexedDB report-extension / kv, 영구): 목록 "moHistory" [{id, at, ym, date, name, uploaded, overview1, overview2}],
//   파일 "moFile:<id>", 입력 초안 "moDraft:<YYYY-MM>", 저장 폴더 "moSaveDir"
const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const OV1_MAX = 62; // 1페이지 개요 한 줄 (14pt, 한 줄 안)
const OV2_MAX = 125; // 2페이지 개요 2줄
let settings = {};
let xlOverride = null; // 담당자가 직접 고른 일일동향 엑셀 {name, bytes}
let stats = null;
let histPage = 1;

function setSummary(text, cls = "") {
  const el = $("#summary");
  el.textContent = text;
  el.className = `summary ${cls}`;
}
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
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
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

// ---------------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------------
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymKey = (y, m) => `${y}-${pad(m)}`;
const prevYm = (y, m) => (m === 1 ? [y - 1, 12] : [y, m - 1]);
const serialOf = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
const dow = (d) => "일월화수목금토"[d.getDay()];
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}(${dow(d)})`;
// 보고일: 25일, 주말·휴일이면 바로 전 근무일
function reportDate(y, m) {
  const d = new Date(y, m - 1, 25);
  for (let i = 0; i < 15 && dayOffReason(d, settings); i++) d.setDate(d.getDate() - 1);
  return d;
}
function selYm() {
  const v = $("#moMonth").value || "";
  const m = v.match(/^(\d{4})-(\d{2})$/);
  return m ? [+m[1], +m[2]] : null;
}
// 지난 보고서 제목의 기간 끝 날짜 ("‘26.9/24 ~ ‘26.10/23")
function periodEndOf(info) {
  const m = String(info && info.period || "").match(/[‘'’]?(\d{2})\.(\d{1,2})\/(\d{1,2})\s*$/);
  return m ? new Date(2000 + +m[1], +m[2] - 1, +m[3]) : null;
}

// ---------------------------------------------------------------------------
// 보관함
// ---------------------------------------------------------------------------
async function histList() {
  const list = (await kvGet("moHistory")) || [];
  return list.sort((a, b) => (b.ym || "").localeCompare(a.ym || "") || b.at - a.at);
}
async function histAdd(meta, bytes) {
  const list = await histList();
  for (const x of list.filter((x) => x.ym && x.ym === meta.ym)) await kvSet(`moFile:${x.id}`, null); // 같은 달은 새 파일로
  await kvSet(`moFile:${meta.id}`, bytes);
  await kvSet("moHistory", [meta, ...list.filter((x) => !(x.ym && x.ym === meta.ym))]);
}
// 이 보고 월의 틀: 그 전 달 보고서 (없으면 그보다 앞선 가장 최근 보고서)
async function templateFor(y, m) {
  const ym = ymKey(y, m);
  for (const h of (await histList()).filter((h) => h.ym && h.ym < ym)) {
    const bytes = await kvGet(`moFile:${h.id}`);
    if (bytes) return { entry: h, bytes, info: await MonthlyPptx.read(bytes) };
  }
  return null;
}

async function saveFile(fileName, bytes) {
  const h = (await kvGet("moSaveDir")) || (await kvGet("saveDir"));
  if (h) {
    try {
      let p = await h.queryPermission({ mode: "readwrite" });
      if (p !== "granted") p = await h.requestPermission({ mode: "readwrite" });
      if (p === "granted") {
        const fh = await h.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
        return `📁 ${h.name}/${fileName}`;
      }
    } catch (e) {
      setSummary(`고른 폴더에 저장하지 못해 다운로드 폴더로 받습니다 (${e.message || e})`, "err");
    }
  }
  // 다운로드 폴더: 크롬 다운로드로 받아 한글 파일 이름이 그대로 붙게 (같은 이름이면 덮어씀)
  const url = URL.createObjectURL(new Blob([bytes], { type: PPTX_MIME }));
  try {
    await chrome.downloads.download({ url, filename: fileName, conflictAction: "overwrite", saveAs: false });
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return `다운로드 폴더/${fileName}`;
}
async function showWhere() {
  const own = await kvGet("moSaveDir");
  const h = own || (await kvGet("saveDir"));
  $("#moWhere").textContent = h ? `📁 ${h.name}${own ? "" : " (PPT 저장 폴더와 같음)"}` : "다운로드 폴더";
}

async function renderHist() {
  const hist = await histList();
  $("#moHist").hidden = !hist.length;
  $("#moHistEmpty").hidden = !!hist.length;
  const pages = Math.max(1, Math.ceil(hist.length / 10));
  histPage = Math.min(Math.max(1, histPage), pages);
  let pager = document.getElementById("moPager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "moPager";
    pager.className = "pager";
    $("#moHist").after(pager);
  }
  pager.innerHTML = "";
  pager.hidden = pages <= 1;
  for (let i = 1; i <= pages && pages > 1; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(i);
    if (i === histPage) b.className = "cur";
    b.disabled = i === histPage;
    b.addEventListener("click", () => {
      histPage = i;
      renderHist();
    });
    pager.append(b);
  }
  const tbody = $("#moHist tbody");
  tbody.innerHTML = "";
  for (const h of hist.slice((histPage - 1) * 10, histPage * 10)) {
    const tr = document.createElement("tr");
    const [y, m] = (h.ym || "-").split("-");
    tr.innerHTML = `<td><b>${h.ym ? `${y}년 ${+m}월` : "-"}</b></td><td>${esc(h.date || "-")}</td><td>${h.uploaded ? '<span class="badge-edit">넣은 지난 보고서</span> ' : ""}${esc(h.name)}</td><td>${new Date(h.at).toLocaleString("ko-KR")}</td><td class="actions"><div class="acts"><button data-a="get" class="btn-get" type="button">⬇ 받기</button><button data-a="del" class="danger" type="button">삭제</button></div></td>`;
    tr.querySelector('[data-a="get"]').addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const bytes = await kvGet(`moFile:${h.id}`);
      if (!bytes) return alert("파일 내용을 찾지 못했습니다");
      const where = await saveFile(h.name, bytes);
      Celebrate.done(btn);
      await Celebrate.after();
      alert(`✅ 월간 실적 보고 저장 완료\n\n저장 위치: ${where}`);
    });
    tr.querySelector('[data-a="del"]').addEventListener("click", async () => {
      if (!confirm(`보관함에서 지울까요?\n${h.name}\n(저장 폴더의 파일은 그대로입니다)`)) return;
      await kvSet(`moFile:${h.id}`, null);
      await kvSet("moHistory", (await histList()).filter((x) => x.id !== h.id));
      renderHist();
      refresh();
    });
    tbody.append(tr);
  }
}

// 지난 보고서 넣기 (여러 개): 보고 월은 PPT 제목의 ‘YY.M월, 보고일은 파일 이름 앞 날짜 (없으면 제목 기간 끝)
async function uploadReports(files) {
  const ok = [];
  const bad = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const info = await MonthlyPptx.read(bytes);
      if (!info.year || !info.month) throw new Error("제목에서 ‘YY.M월 을 찾지 못했습니다");
      const end = periodEndOf(info);
      const date = DailyPpt.dateFromName(f.name) || (end ? dkey(end) : "");
      await histAdd({ id: `mo-${Date.now()}-${ok.length}`, at: Date.now(), ym: ymKey(info.year, info.month), date, name: f.name, uploaded: true, overview1: info.overview1, overview2: info.overview2 }, bytes);
      ok.push(`${info.year}년 ${info.month}월`);
    } catch (e) {
      bad.push(`${f.name}: ${e.message || e}`);
    }
  }
  setSummary(`${ok.length ? `✅ 지난 월간 실적 보고 ${ok.length}개를 넣었습니다 (${ok.join(", ")})` : ""}${bad.length ? `${ok.length ? "\n" : ""}⚠ ${bad.join("\n⚠ ")}` : ""}`, bad.length ? "err" : "ok");
  if (ok.length) Celebrate.ding();
  await renderHist();
  await refresh();
}

// ---------------------------------------------------------------------------
// 일일동향 엑셀 (보고일의 파일) → 집계
// ---------------------------------------------------------------------------
async function excelFor(date) {
  if (xlOverride) return xlOverride;
  const list = ((await kvGet("dtHistory")) || []).filter((h) => h.date && h.date <= dkey(date)).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  for (const h of list) {
    const bytes = await kvGet(`dtFile:${h.id}`);
    if (bytes) return { name: h.name, bytes, date: h.date };
  }
  const base = await kvGet("dtBase");
  return base ? { name: base.name, bytes: base.bytes } : null;
}
function catLabel(labels, kind) {
  const k = String(kind || "").trim();
  const tests = [
    [/품질/, /품질/],
    [/결품/, /결품/],
    [/응대|서비스/, /서비스|응대/],
    [/^제도/, /^제도/],
  ];
  for (const [kr, lr] of tests) if (kr.test(k)) return labels.find((l) => lr.test(l)) || k;
  return labels.find((l) => l === k) || k;
}
function chanLabel(labels, media) {
  const m = String(media || "").trim();
  if (/동호회/.test(m)) return labels.find((l) => /동호회/.test(l)) || m;
  if (/커뮤니티/.test(m)) return labels.find((l) => /커뮤니티/.test(l)) || m;
  return labels.find((l) => l === m) || m;
}

let ctx = null; // 지금 보고 월의 {y, m, date, start, end, tpl, xl}
async function refresh() {
  stats = null;
  $("#moStats").hidden = true;
  $("#moStatsEmpty").hidden = false;
  const ym = selYm();
  if (!ym) return;
  const [y, m] = ym;
  const date = reportDate(y, m);
  const tpl = await templateFor(y, m);
  const [py, pm] = prevYm(y, m);
  const tplEnd = tpl && tpl.entry.ym === ymKey(py, pm) ? periodEndOf(tpl.info) : null;
  const start = tplEnd ? new Date(tplEnd.getFullYear(), tplEnd.getMonth(), tplEnd.getDate() + 1) : (() => {
    const p = reportDate(py, pm);
    return new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1);
  })();
  const xl = await excelFor(date);
  ctx = { y, m, date, start, end: date, tpl, xl };
  $("#moDateInfo").textContent = `보고일 ${fmt(date)}${date.getDate() !== 25 ? " (25일이 주말·휴일이라 전 근무일)" : ""} · 기간 ${dkey(start)} ~ ${dkey(date)}`;
  $("#moTplInfo").textContent = tpl ? `틀: ${tpl.entry.name} (${tpl.info.year}년 ${tpl.info.month}월 보고서)${tpl.entry.ym !== ymKey(py, pm) ? ` · ⚠ ${pm}월 보고서가 없어 더 앞선 보고서를 씁니다` : ""}` : `${y}년 ${m}월 보다 앞선 월간 실적 보고가 없습니다. 지난달 보고서 PPT 를 넣어 주세요.`;
  $("#moTplInfo").className = tpl ? "hint ok" : "hint err";
  $("#moXlInfo").textContent = xl ? `일일동향 엑셀: ${xl.name}${xlOverride ? " (직접 고름)" : ""}${xl.date && xl.date < dkey(date) ? ` · ⚠ 보고일(${dkey(date)}) 파일이 아직 없어 ${xl.date} 파일로 집계 (보고일에 다시 불러오세요)` : ""}` : "일일동향 엑셀이 없습니다. 3번 탭에서 만들거나 넣어 주세요.";
  $("#moXlInfo").className = xl ? "hint ok" : "hint err";
  $("#moNameInfo").textContent = tpl ? `파일 이름: ${fileName()}` : "";
  await loadDraft();
}

async function loadStats() {
  if (!ctx || !ctx.xl) return setSummary("일일동향 엑셀이 없습니다", "err");
  if (!ctx.tpl) return setSummary("지난달 월간 실적 보고 PPT 를 먼저 넣어 주세요", "err");
  const rows = await DailyTrend.readRows(ctx.xl.bytes);
  const a = serialOf(ctx.start);
  const b = serialOf(ctx.end);
  const sel = rows.filter((r) => r.serial >= a && r.serial <= b);
  const prev = ctx.tpl.info.prev;
  const labels = await MonthlyPptx.labels(ctx.tpl.bytes);
  const cnt = new Map();
  for (const r of sel) cnt.set(r.code, (cnt.get(r.code) || 0) + 1);
  const prevCar = new Map(prev.cars.map((c) => [c.code, c.count]));
  const codes = [...new Set([...cnt.keys(), ...prevCar.keys()])];
  const cars = codes
    .map((code) => ({ code, cur: cnt.get(code) || 0, prev: prevCar.get(code) || 0 }))
    .filter((c) => c.cur || c.prev) // 두 달 모두 0건이면 뺀다
    .sort((x, y) => y.cur - x.cur || y.prev - x.prev || x.code.localeCompare(y.code));
  const catCnt = new Map();
  for (const r of sel) {
    const l = catLabel(labels.cats, r.kind);
    catCnt.set(l, (catCnt.get(l) || 0) + 1);
  }
  const chanCnt = new Map();
  for (const r of sel) {
    const l = chanLabel(labels.chans, r.media);
    chanCnt.set(l, (chanCnt.get(l) || 0) + 1);
  }
  const prevOf = (list, name) => (list.find((x) => x.name === name) || { count: 0 }).count;
  const cats = labels.cats.map((name) => ({ name, cur: catCnt.get(name) || 0, prev: prevOf(prev.cats, name) }));
  const chans = labels.chans.map((name) => ({ name, cur: chanCnt.get(name) || 0, prev: prevOf(prev.chans, name) }));
  const lost = sel.length - cats.reduce((s, c) => s + c.cur, 0);
  stats = { total: sel.length, sel, cars, cats, chans };
  renderStats();
  if (!$("#moOnline").value) $("#moOnline").value = String(sel.length);
  saveDraft();
  setSummary(`✅ ${dkey(ctx.start)} ~ ${dkey(ctx.end)} 게시글 ${sel.length}건을 집계했습니다${lost ? ` · ⚠ 카테고리 표에 없는 불만구분 ${lost}건` : ""}`, lost ? "err" : "ok");
}

function renderStats() {
  if (!stats) return;
  const pct = (n, t, dg = 2) => `${(t ? (n / t) * 100 : 0).toFixed(dg)}%`;
  const table = (sel, list, total, top, dg = 2) => {
    const prevTotal = list.reduce((s, c) => s + c.prev, 0);
    $(`${sel} tbody`).innerHTML =
      list.map((c, i) => `<tr class="${top && i < 5 ? "top5" : ""}"><td>${esc(c.code || c.name)}</td><td>${c.cur}</td><td class="pct">${pct(c.cur, total, dg)}</td><td>${c.prev}</td></tr>`).join("") +
      `<tr class="sum"><td>이슈 보고 건수 합계</td><td>${total}</td><td>${pct(total, total, dg)}</td><td>${prevTotal}</td></tr>`;
  };
  table("#moCars", stats.cars, stats.total, true);
  table("#moCats", stats.cats, stats.total, false);
  table("#moChans", stats.chans, stats.total, false, 0); // 채널 비율은 PPT 처럼 소수점 없이
  $("#moStats").hidden = false;
  $("#moStatsEmpty").hidden = true;
  renderPreview2();
}

// 2페이지 미리보기 (담당자 요청 2026-11-13): 제목·개요(2페이지)·차종 표(TOP5 점선)·카테고리·채널 표
function renderPreview2() {
  const box = $("#pv2");
  if (!box || !ctx || !stats) return;
  const [, pm] = prevYm(ctx.y, ctx.m);
  const yy = String(ctx.y).slice(2);
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const pct = (n, t, dg = 2) => `${(t ? (n / t) * 100 : 0).toFixed(dg)}%`;
  const ov = lines($("#ov2").value).join(" ");
  const tbl = (cap, head, list, dg, top) => {
    const prevT = list.reduce((s, c) => s + c.prev, 0);
    const n5 = Math.min(5, list.length);
    return `<div class="pv2-cap">${cap}</div><table class="pv-t s"><tr><th>${head}</th><th>${ctx.m}월</th><th>비율</th><th>${pm}월</th></tr>${list
      .map((c, i) => `<tr class="${top && i < n5 ? `t5${i === 0 ? " t5-first" : ""}${i === n5 - 1 ? " t5-last" : ""}` : ""}"><td>${esc(c.code || c.name)}</td><td>${c.cur}</td><td class="r">${pct(c.cur, stats.total, dg)}</td><td>${c.prev}</td></tr>`)
      .join("")}<tr class="sum"><td>합계</td><td>${stats.total}</td><td>${pct(stats.total, stats.total, dg)}</td><td>${prevT}</td></tr></table>`;
  };
  box.innerHTML = `
    <div class="pv-title">■ ‘${yy}.${ctx.m}월 온라인 여론 동향 정리 <small>(‘${String(ctx.start.getFullYear()).slice(2)}.${md(ctx.start)} ~ ‘${yy}.${md(ctx.end)})</small></div>
    <div class="pv-row"><div class="pv-lab">개요</div><div class="pv-ov" data-k="ov2">${ov ? `○ ${esc(ov)}` : '<span class="pv-empty">⑤ 에서 2페이지 개요를 써 주세요</span>'}</div></div>
    <div class="pv2-body">
      <div>${tbl("이슈 보고 內 차종 별 비율", "차종", stats.cars, 2, true)}</div>
      <div>${tbl("이슈 보고 內 카테고리 비율", "이슈 항목", stats.cats, 2, false)}<div style="height:6px"></div>${tbl("이슈 보고 內 채널 별 비율", "채널", stats.chans, 0, false)}</div>
    </div>`;
  if (pvFocus === "ov2") for (const el of box.querySelectorAll('[data-k="ov2"]')) el.classList.add("hl");
}

// ---------------------------------------------------------------------------
// 입력 초안 (보고 월마다 저장)
// ---------------------------------------------------------------------------
const NUMS = [
  ["moOnline", "online", "pvOnline"],
  ["moFire", "fire", "pvFire"],
  ["moCollect", "collect", "pvCollect"],
  ["moCafes", "cafes", "pvCafes"],
  ["moYoutube", "youtube", "pvYoutube"],
  ["moExtraCount", "extraCount", "pvExtraCount"],
];
let extras = [];
const draftKey = () => (ctx ? `moDraft:${ymKey(ctx.y, ctx.m)}` : "");
async function loadDraft() {
  const d = (draftKey() && (await kvGet(draftKey()))) || null;
  const prev = (ctx.tpl && ctx.tpl.info.s1) || {};
  for (const [id, k, pv] of NUMS) {
    $(`#${id}`).value = d && d[k] != null ? d[k] : k === "cafes" && prev.cafes ? String(prev.cafes) : "";
    $(`#${pv}`).textContent = prev[k] != null ? `지난달 ${Number(prev[k]).toLocaleString()}` : "";
  }
  extras = d && d.extras ? d.extras : (prev.extras || []).map((x) => ({ title: x.title, date: x.date, count: "" })); // 지난달 목록은 건수 비우고
  $("#ov1").value = d ? d.ov1 || "" : "";
  $("#ov2").value = d ? d.ov2 || "" : "";
  $("#issues").value = d ? d.issues || "" : "";
  renderExtras();
  updateLens();
  renderPreview();
}
// ---------------------------------------------------------------------------
// 1페이지 미리보기 (담당자 요청 2026-11-13): PPT 1페이지 모양을 줄여 그리고, 입력값을 그 자리에 바로 채운다
// 입력칸을 누르면 그 값이 들어가는 자리가 노랗게 강조된다 (data-k 로 연결)
// ---------------------------------------------------------------------------
const PV_FOR = { ov2: "ov2", moOnline: "online", moFire: "fire", moCollect: "collect", moCafes: "cafes", moYoutube: "youtube", moExtraCount: "extraCount", ov1: "ov1", issues: "issues", extraList: "extras" };
let pvFocus = "";
function renderPreview() {
  const box = $("#pv1");
  if (!box || !ctx) return;
  const prev = (ctx.tpl && ctx.tpl.info.s1) || {};
  const notes = prev.notes || {};
  const [py, pm] = prevYm(ctx.y, ctx.m);
  const v = (id) => $(`#${id}`).value;
  const num = (id, unit) => (v(id) === "" ? `<span class="pv-empty">?</span> ${unit}` : `${Number(v(id)).toLocaleString()} ${unit}`);
  const pnum = (k, unit) => (prev[k] != null ? `${Number(prev[k]).toLocaleString()} ${unit}` : "-");
  const yy = String(ctx.y).slice(2);
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const list = (arr, plain) => (arr.length ? arr.map((t) => `<div class="${plain ? "plain" : ""}">${esc(t)}</div>`).join("") : `<div class="plain">-</div>`);
  const ov = lines($("#ov1").value);
  const issues = lines($("#issues").value);
  const ex = extras.filter((x) => (x.title || "").trim()).map((x) => `${x.title.trim()}${(x.date || "").trim() ? ` (${x.date.trim()})` : ""}`);
  const cafesNote = (notes.cafes && notes.cafes[0] ? notes.cafes[0] : "")
    .replace(/\d{2}(?=\s*년)/, yy)
    .replace(/\d{1,2}(?=\s*월)/, String(ctx.m))
    .replace(/\d+(?=\s*개)/, v("moCafes") || "$&");
  const k = (name) => `data-k="${name}"`;
  box.innerHTML = `
    <div class="pv-title" ${k("title")}>■ ‘${yy}.${ctx.m}월 온라인 여론 동향 정리 <small>(‘${String(ctx.start.getFullYear()).slice(2)}.${md(ctx.start)} ~ ‘${yy}.${md(ctx.end)})</small></div>
    <div class="pv-row"><div class="pv-lab">개요</div><div class="pv-ov" ${k("ov1")}>${ov.length ? ov.map((t) => `<div>○ ${esc(t)}</div>`).join("") : '<span class="pv-empty">⑤ 에서 개요를 써 주세요</span>'}</div></div>
    <table class="pv-t">
      <colgroup><col style="width:24%"><col style="width:15%"><col style="width:15%"><col></colgroup>
      <tr><th>항 목</th><th>${ctx.y}년 ${ctx.m}월</th><th>${pm}월</th><th>내 용</th></tr>
      <tr><td>온라인 상시 모니터링 (오전)</td><td class="cur" ${k("online")}>${num("moOnline", "건")}</td><td class="prv">${pnum("online", "건")}</td><td class="txt" ${k("issues")}>${issues.length ? list(issues) : '<div class="plain pv-empty">⑤ 주요 이슈</div>'}</td></tr>
      <tr><td>차량 화재 / 급발진</td><td class="cur" ${k("fire")}>${num("moFire", "건")}</td><td class="prv">${pnum("fire", "건")}</td><td class="txt">${list(notes.fire || [], true)}</td></tr>
      <tr><td>모니터링 시스템 수집</td><td class="cur" ${k("collect")}>${num("moCollect", "건")}</td><td class="prv">${pnum("collect", "건")}</td><td class="txt">${list(notes.collect || [], true)}</td></tr>
      <tr><td>모니터링 동호회</td><td class="cur" ${k("cafes")}>${num("moCafes", "개")}</td><td class="prv">${pnum("cafes", "개")}</td><td class="txt" ${k("cafes")}>${cafesNote ? list([cafesNote]) : list([])}</td></tr>
      <tr><td>유튜브 채널</td><td class="cur" ${k("youtube")}>${num("moYoutube", "건")}</td><td class="prv">${pnum("youtube", "건")}</td><td class="txt">${list(notes.youtube || [])}</td></tr>
      <tr><td>번외 추가 요청 보고</td><td class="cur" ${k("extraCount")}>${num("moExtraCount", "회")}</td><td class="prv">${pnum("extraCount", "회")}</td><td class="txt" ${k("extras")}>${list(ex)}</td></tr>
    </table>`;
  if (pvFocus) for (const el of box.querySelectorAll(`[data-k="${pvFocus}"]`)) el.classList.add("hl");
}
function bindPreviewFocus() {
  const keyOf = (el) => {
    if (!el || el === document.body) return "";
    const id = el.id || (el.closest && el.closest("#extraList") ? "extraList" : "");
    return PV_FOR[id] || "";
  };
  const apply = (k) => {
    if (k === pvFocus) return;
    pvFocus = k;
    renderPreview();
    renderPreview2();
  };
  document.addEventListener("focusin", (e) => apply(keyOf(e.target)));
  // 칸 밖을 누르면(포커스가 빠지면) 노란 강조를 지운다 (담당자 지적 2026-11-13)
  document.addEventListener("focusout", () => setTimeout(() => apply(keyOf(document.activeElement)), 0));
  window.addEventListener("blur", () => apply(""));
}

async function saveDraft() {
  renderPreview();
  renderPreview2();
  if (!draftKey()) return;
  const d = { extras, ov1: $("#ov1").value, ov2: $("#ov2").value, issues: $("#issues").value };
  for (const [id, k] of NUMS) d[k] = $(`#${id}`).value;
  await kvSet(draftKey(), d);
}
// 번외 보고 건수 합계 → '번외 추가 요청 보고 (회)' 자동 입력 (담당자 요청 2026-11-13)
// 건수를 하나라도 넣었으면 합계로 채우고(초록 칸), 하나도 없으면 직접 입력한 값 그대로
function syncExtraSum() {
  const filled = extras.filter((x) => String(x.count ?? "").trim() !== "");
  const sum = filled.reduce((s, x) => s + (Number(x.count) || 0), 0);
  const inp = $("#moExtraCount");
  const note = $("#exSumNote");
  if (filled.length) {
    inp.value = String(sum);
    inp.classList.add("auto");
    note.textContent = `✓ 자동 합계 ${sum}회 (건수 넣은 ${filled.length}줄의 합)`;
    note.classList.add("on");
  } else {
    inp.classList.remove("auto");
    note.textContent = "↓ 아래 번외 보고 내용에 건수를 넣으면 자동 합계가 입력됩니다";
    note.classList.remove("on");
  }
  renderPreview();
}
function renderExtras() {
  const box = $("#extraList");
  box.innerHTML = "";
  if (extras.length) {
    const head = document.createElement("div");
    head.className = "ex ex-head";
    head.innerHTML = "<span>제목</span><span>날짜</span><span>건수</span><span></span><span></span><span></span>";
    box.append(head);
  }
  extras.forEach((x, i) => {
    const row = document.createElement("div");
    row.className = "ex";
    row.innerHTML = `<input type="text" placeholder="제목 (예: ‘NX5 시승기’ 관련 유튜버 콘텐츠 모니터링)"><input type="text" placeholder="날짜 (예: 11/20)"><input type="number" class="cnt" min="0" placeholder="건수"><button type="button" title="위로">↑</button><button type="button" title="아래로">↓</button><button type="button" class="danger">삭제</button>`;
    const [t, d, c] = row.querySelectorAll("input");
    c.value = x.count ?? "";
    c.addEventListener("input", () => { x.count = c.value; syncExtraSum(); saveDraft(); });
    const [up, down, del] = row.querySelectorAll("button");
    t.value = x.title || "";
    d.value = x.date || "";
    t.addEventListener("input", () => { x.title = t.value; saveDraft(); });
    d.addEventListener("input", () => { x.date = d.value; saveDraft(); });
    up.disabled = i === 0;
    down.disabled = i === extras.length - 1;
    up.addEventListener("click", () => { [extras[i - 1], extras[i]] = [extras[i], extras[i - 1]]; renderExtras(); saveDraft(); });
    down.addEventListener("click", () => { [extras[i + 1], extras[i]] = [extras[i], extras[i + 1]]; renderExtras(); saveDraft(); });
    del.addEventListener("click", () => { extras.splice(i, 1); renderExtras(); saveDraft(); });
    box.append(row);
  });
  syncExtraSum();
}
const lines = (s) => String(s || "").split("\n").map((x) => x.replace(/^\s*[○●•\-]\s*/, "").trim()).filter(Boolean);
function updateLens() {
  const l1 = lines($("#ov1").value);
  $("#ov1Len").innerHTML = l1.map((s, i) => `<span class="${s.length > OV1_MAX ? "over" : ""}">${i + 1}줄 ${s.length}자${s.length > OV1_MAX ? ` (약 ${OV1_MAX}자 넘으면 두 줄로 넘어갈 수 있음)` : ""}</span>`).join(" · ") + (l1.length && l1.length !== 2 ? ` · <span class="over">2줄을 권장</span>` : "");
  $("#ov1Len").className = "mo-len";
  const l2 = lines($("#ov2").value).join(" ");
  $("#ov2Len").innerHTML = l2 ? `<span class="${l2.length > OV2_MAX ? "over" : ""}">${l2.length}자${l2.length > OV2_MAX ? ` (약 ${OV2_MAX}자 넘으면 3줄로 넘어갈 수 있음)` : ""}</span>` : "";
}

// ---------------------------------------------------------------------------
// AI: 개요(1·2페이지) · 주요 이슈
// ---------------------------------------------------------------------------
async function aiKeyModel() {
  const s = await chrome.storage.local.get(["aiKey", "aiModel"]).catch(() => ({}));
  return { apiKey: s.aiKey || settings.apiKey || "", model: s.aiModel || settings.model || "claude-opus-5-5" };
}
// 이 기간 데일리 DB 일일 PPT 게시글 (보고 날짜 기준)
async function periodPosts() {
  const days = (await DailyPpt.byDate()).filter((d) => d.date >= dkey(ctx.start) && d.date <= dkey(ctx.end));
  const out = [];
  for (const d of days.sort((a, b) => a.date.localeCompare(b.date))) {
    const bytes = await DailyPpt.bytesOf(d.final.id);
    if (!bytes) continue;
    try {
      for (const x of await PptRead.read(bytes)) {
        if (!x.title) continue;
        out.push({ date: d.date, code: x.code, kind: x.kind, level: x.level, progress: x.progress, title: x.title, short: x.short || "", body: x.body, reaction: x.reaction, duplicate: x.duplicate || "" });
      }
    } catch {}
  }
  return { posts: out, days: days.length };
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    overview1: { type: "array", items: { type: "string" } },
    overview2: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["overview1", "overview2", "issues", "note"],
  additionalProperties: false,
};

async function aiWrite() {
  if (!ctx) return;
  const { apiKey, model } = await aiKeyModel();
  if (!apiKey) return setSummary("Claude API 키가 없습니다. 모니터링 설정 또는 PPT·RAW 작성 설정에서 넣어 주세요", "err");
  if (!stats) await loadStats();
  if (!stats) return;
  const btn = $("#aiWrite");
  btn.disabled = true;
  $("#aiInfo").textContent = "이 기간 일일 PPT 읽는 중…";
  try {
    const { posts, days } = await periodPosts();
    // 일일 PPT 가 없으면 일일동향 엑셀 '내용'으로 대신
    const fallback = posts.length ? [] : stats.sel.map((r) => ({ code: r.code, kind: r.kind, content: r.content.split(/\r?\n/)[0] }));
    const examples = (await histList()).filter((h) => h.ym !== ymKey(ctx.y, ctx.m) && (h.overview1 || h.overview2)).slice(0, 6).map((h) => ({ month: h.ym, page1: h.overview1 || [], page2: h.overview2 || [] }));
    const tplInfo = ctx.tpl.info;
    const input = {
      reportMonth: `${ctx.y}년 ${ctx.m}월`,
      period: `${dkey(ctx.start)} ~ ${dkey(ctx.end)}`,
      priorityCars: settings.priorityCars || "",
      totals: { thisMonth: stats.total, lastMonth: stats.cars.reduce((s, c) => s + c.prev, 0) },
      carRanking: stats.cars.slice(0, 15).map((c) => ({ code: c.code, thisMonth: c.cur, lastMonth: c.prev })),
      categories: stats.cats.filter((c) => c.cur || c.prev),
      extraReports: extras.filter((x) => x.title).map((x) => `${x.title}${x.date ? ` (${x.date})` : ""}`),
      lastMonthReport: { page1: tplInfo.overview1, page2: tplInfo.overview2, issues: tplInfo.s1.issues || [] },
      pastExamples: examples,
      dailyPosts: posts.slice(0, 400),
      excelRowsIfNoPpt: fallback.slice(0, 400),
      current: { page1: lines($("#ov1").value), page2: lines($("#ov2").value), issues: lines($("#issues").value) },
      request: $("#aiRequest").value.trim(),
    };
    $("#aiInfo").textContent = `일일 PPT ${days}일치 · 게시글 ${posts.length || fallback.length}건으로 쓰는 중… (1분 가량)`;
    const system = `당신은 현대자동차 온라인 여론 모니터링 담당자로서, 경영진에게 올리는 '월간 온라인 여론 동향 정리(월간 실적 보고)' 2장짜리 PPT 의 핵심 문구를 씁니다.
이 보고서에서 가장 중요한 부분은 각 페이지 상단 '개요'입니다. 한 달 동안의 일일 동향을 꼼꼼히 읽고, 무엇이 이번 달의 핵심이었는지 판단해 성의 있게 씁니다.

[입력]
- dailyPosts: 이 기간 매일 보고한 일일 PPT 게시글 (차종 코드, 불만 유형·단계(주의/경고/심각), 제목, 요약, 본문 요약, 댓글 반응, 신규/중복)
  (일일 PPT 가 없으면 excelRowsIfNoPpt: 일일동향 엑셀 행)
- carRanking / categories / totals: 이번 달·지난달 건수 (차종 순위, 증감)
- priorityCars: 회사가 중점 관리하는 신차·주요 차종 코드
- extraReports: 이번 달 번외 추가 요청 보고(담당자가 수행한 별도 업무) 목록
- lastMonthReport, pastExamples: 지난 보고서들의 개요 — 문체·길이·구성을 그대로 본받습니다 (내용은 이번 달 것으로)
- current / request: 담당자가 고쳐 둔 문구와 다시 쓰기 요청. request 가 있으면 그 요청을 최우선으로 반영하고, 요청과 관계없는 부분은 current 를 존중합니다

[판단 기준 — 무엇이 중요한가]
1) 신차·priorityCars 차종에서 반복되거나 새로 나타난 품질 이슈 (출고 초기 불량, 같은 증상 다수 발생)
2) 건수가 많은 차종(TOP5)과 지난달 대비 크게 늘어난 차종·증상
3) 경고·심각 단계, 안전과 관련된 이슈(제동, 화재, 주행 중 시동 꺼짐 등), 리콜·무상수리·업데이트와 맞물린 여론
4) 여러 차종에 공통으로 나타나는 계절성·공통 VOC (기온 변화에 따른 습기, 공기압, 소음 등)
여러 글에 흩어진 같은 증상은 하나로 묶어 '경향'으로 씁니다. 글 한 건짜리 사소한 이슈는 개요에 넣지 않습니다.

[overview1 — 1페이지 개요: 정확히 2개 항목]
- 각 항목은 PPT 한 줄(14pt)에 들어가도록 ${OV1_MAX}자 이내, 가능하면 45~${OV1_MAX}자로 꽉 차게.
- 1번: 이번 달 가장 중요한 이슈 — 차종 코드 + 구체 증상 + 현황/대응 ("~로 집중 모니터링 중", "~ 지속 발생" 등).
  예) "ME1 2,3열 시트 업데이트 리콜 시행과 함께 LX3 동호회에서 시트 관련 각종 불만 사항 지속 발생으로 집중 모니터링 중"
- 2번: 지난 보고서 2번 줄처럼 이번 달 수행한 주요 모니터링 업무를 extraReports 에서 골라 요약하거나(예: "일일동향 엑셀 DB전달, 주간 품질 모니터링(온라인 부분), NX5 가격 공개 후 CN8 관련 여론 동향 관련 모니터링 外"),
  지난 보고서들이 두 번째 핵심 이슈를 썼다면 그 방식을 따릅니다. 1번과 내용이 겹치지 않게.
[overview2 — 2페이지 개요: 1개 항목, 2줄 분량]
- ${OV2_MAX - 25}~${OV2_MAX}자. 2페이지는 차종·카테고리 통계 페이지이므로, 품질 불만의 차종별 경향(어떤 차종들에서 어떤 증상들이 나타났는지)과 공통·계절성 VOC 를 묶어 씁니다.
  예) "CN8 및 GN7 PE 신차 출고 직후 발생되는 방전, 각종 도장 불량, 시트 작동 오류, 계기반 디스플레이 미작동 등 다양한 품질 관련 불만 이슈에 현재 집중 모니터링 중이며, 기온이 낮아짐에 따라 발생되는 습기, 공기압 이슈 등 다양한 VOC도 함께 확인 중"
- 1페이지 개요와 겹치면 안 됩니다: 1페이지에서 다룬 차종·증상을 2페이지에서 되풀이하지 말고, 다른 차종·다른 증상·다른 관점(전체 경향, 공통 VOC)으로 씁니다.
[issues — 1페이지 '온라인 상시 모니터링' 내용 칸: 7~8개]
- 형식: "차종코드 증상 요약" (예: "LX3 전자 제어 서스펜션 점검 메시지 점등", "CN8 주행 중 계기반, 내비게이션 등 전체 화면 꺼짐 불만", "ME1 소음 발생 수리 중 차량 파손 응대 불만"). 30자 안팎, 명사형.
- 이번 달 주요 이슈를 차종이 고루 섞이게 고르되 신차·주요 차종과 경고·심각 이슈를 우선합니다. 개요와 같은 이슈가 들어가도 됩니다.

[표현]
- 보고체, 명사형/"~ 중" 끝맺음. 과장·추측 금지, dailyPosts 에 있는 사실만. "에러", "결함" 대신 "오류", "불량", "증상". "계기판" 대신 "계기반", "내비" 대신 "내비게이션".
- 가운뎃점(·) 대신 쉼표. 차종은 코드로(예: NX5, GN7 PE). 앞에 "○", "●" 기호는 붙이지 않습니다.
- note: 담당자에게 무엇을 근거로 어떤 이슈를 골랐는지 2~3문장으로 알립니다.`;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
    const params = { model, max_tokens: 12000, system, output_config: { effort: "high", format: { type: "json_schema", schema: AI_SCHEMA } }, messages: [{ role: "user", content: JSON.stringify(input) }] };
    const stream = model === "claude-haiku-5-5" ? client.messages.stream(params) : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude 가 작성을 거절했습니다");
    const out = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const clean = (a) => (a || []).map((s) => String(s).replace(/^\s*[○●•\-]\s*/, "").replace(/·/g, ", ").trim()).filter(Boolean);
    $("#ov1").value = clean(out.overview1).slice(0, 2).join("\n");
    $("#ov2").value = clean(out.overview2).join(" ");
    $("#issues").value = clean(out.issues).join("\n");
    updateLens();
    await saveDraft();
    $("#aiInfo").textContent = `✅ 작성 완료 — ${out.note || ""}`;
  } catch (e) {
    $("#aiInfo").textContent = "";
    setSummary(`AI 작성 실패: ${e.message || e}`, "err");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 만들기
// ---------------------------------------------------------------------------
function fileName() {
  if (!ctx || !ctx.tpl) return "";
  const ymd = `${String(ctx.date.getFullYear()).slice(2)}${pad(ctx.date.getMonth() + 1)}${pad(ctx.date.getDate())}`;
  let name = ctx.tpl.entry.name;
  if (/^\d{6}/.test(name)) name = name.replace(/^\d{6}/, ymd);
  else name = `${ymd}_${name}`;
  name = name.replace(/(\d{1,2})(\s*월)/, `${ctx.m}$2`);
  return name.toLowerCase().endsWith(".pptx") ? name : `${name}.pptx`;
}

async function build() {
  if (!ctx || !ctx.tpl) return setSummary("지난달 월간 실적 보고 PPT 를 먼저 넣어 주세요", "err");
  if (!stats) await loadStats();
  if (!stats) return;
  const ov1 = lines($("#ov1").value);
  const ov2 = lines($("#ov2").value);
  const issues = lines($("#issues").value);
  const missing = [];
  if (!ov1.length) missing.push("1페이지 개요");
  if (!ov2.length) missing.push("2페이지 개요");
  if (!issues.length) missing.push("주요 이슈");
  for (const [id, , , label] of NUMS.map((x) => [...x, $(`#${x[0]}`).closest("label").firstChild.textContent.trim()])) if ($(`#${id}`).value === "") missing.push(label);
  if (missing.length && !confirm(`아직 비어 있는 항목이 있습니다:\n- ${missing.join("\n- ")}\n\n비어 있는 개요·이슈는 지난달 문구가 그대로 남고, 빈 숫자는 지난달 숫자가 남습니다. 그래도 만들까요?`)) return;
  const btn = $("#moBuild");
  btn.disabled = true;
  try {
    setSummary("월간 실적 보고 PPT 만드는 중…");
    const num = (id) => ($(`#${id}`).value === "" ? null : Number($(`#${id}`).value));
    const bytes = await MonthlyPptx.build(ctx.tpl.bytes, {
      year: ctx.y,
      month: ctx.m,
      start: ctx.start,
      end: ctx.end,
      overview1: ov1,
      overview2: ov2,
      s1: { online: num("moOnline"), fire: num("moFire"), collect: num("moCollect"), cafes: num("moCafes"), youtube: num("moYoutube"), extraCount: num("moExtraCount"), issues, extras },
      cars: stats.cars,
      cats: stats.cats,
      chans: stats.chans,
    });
    const name = fileName();
    const where = await saveFile(name, bytes);
    await histAdd({ id: `mo-${Date.now()}`, at: Date.now(), ym: ymKey(ctx.y, ctx.m), date: dkey(ctx.date), name, overview1: ov1, overview2: ov2 }, bytes);
    await renderHist();
    const msg = `✅ 월간 실적 보고 저장 완료: ${where}`;
    setSummary(msg, "ok");
    Celebrate.done(btn);
    Celebrate.ding();
    await Celebrate.after();
    alert(msg);
  } catch (e) {
    setSummary(`월간 실적 보고를 만들지 못했습니다: ${e.message || e}`, "err");
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  settings = await loadSettings().catch(() => ({ ...DEFAULT_SETTINGS }));
  // 기본 보고 월: 이번 달 보고일이 지나지 않았으면 이번 달, 지났으면 다음 달
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  if (dkey(now) > dkey(reportDate(y, m))) [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  $("#moMonth").value = ymKey(y, m);
  $("#moMonth").addEventListener("change", () => {
    xlOverride = null;
    refresh();
  });
  $("#moUpload").addEventListener("change", (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) uploadReports(files);
  });
  $("#moXl").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    xlOverride = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    await refresh();
    loadStats().catch((err) => setSummary(`집계하지 못했습니다: ${err.message || err}`, "err"));
  });
  $("#moLoad").addEventListener("click", () => loadStats().catch((e) => setSummary(`집계하지 못했습니다: ${e.message || e}`, "err")));
  $("#exAdd").addEventListener("click", () => {
    extras.push({ title: "", date: "" });
    renderExtras();
    $("#extraList .ex:last-child input").focus();
  });
  for (const id of ["ov1", "ov2", "issues"]) $(`#${id}`).addEventListener("input", () => { updateLens(); saveDraft(); });
  for (const [id] of NUMS) $(`#${id}`).addEventListener("input", saveDraft);
  $("#aiWrite").addEventListener("click", aiWrite);
  bindPreviewFocus();
  $("#moBuild").addEventListener("click", build);
  $("#moPickFolder").addEventListener("click", async () => {
    try {
      const h = await window.showDirectoryPicker({ id: "monthly-out", mode: "readwrite", startIn: "desktop" });
      await kvSet("moSaveDir", h);
      showWhere();
    } catch (e) {
      if (e && e.name !== "AbortError") setSummary(`폴더를 고르지 못했습니다: ${e.message || e}`, "err");
    }
  });
  $("#moClearFolder").addEventListener("click", async () => {
    await kvSet("moSaveDir", null);
    showWhere();
  });
  await showWhere();
  await renderHist();
  await refresh();
  if (ctx && ctx.tpl && ctx.xl) loadStats().catch(() => {});
});
