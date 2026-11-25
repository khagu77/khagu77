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
// 실제 보고일: 특정일 기준 요청(moDateOverride)이 있으면 그 날, 없으면 25일 규칙
async function effReportDate(y, m) {
  const ov = await kvGet(`moDateOverride:${ymKey(y, m)}`);
  return ov && /^\d{4}-\d{2}-\d{2}$/.test(ov) ? new Date(`${ov}T00:00`) : reportDate(y, m);
}
// 그 달 보고서를 작성·다운로드했는지 (보관함에 그 달 보고서가 있으면 완료. 직접 넣은 보고서도 완료로 봄)
async function moDone(y, m) {
  return ((await kvGet("moHistory")) || []).some((h) => h.ym === ymKey(y, m));
}
// 오늘 기준 보고 월: 보고일이 지났어도 작성·다운로드를 안 했으면 그 달(D+N 경고), 했으면 다음 달 (담당자 지시 2026-11-20)
async function upcomingYm() {
  const now = new Date();
  let [y, m] = prevYm(now.getFullYear(), now.getMonth() + 1); // 지난달 보고가 밀려 있을 수도
  for (let i = 0; i < 3; i++) {
    if (dkey(now) <= dkey(await effReportDate(y, m)) || !(await moDone(y, m))) return [y, m];
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return [y, m];
}
const daysUntil = (d) => {
  const t = new Date();
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
};
let autoMonth = true; // 보고 월을 담당자가 직접 고르지 않았으면 날짜가 지나면 자동으로 다음 보고 월로
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
// 보관 이름 바로잡기 (담당자 지적 2026-11-25): 맥 자모(NFD) 이름 → NFC, 버그로 생긴 "261125_11월 10월_…" → "261125_11월_…"
const fixName = (n) => String(n || "").normalize("NFC").replace(/^(\d{6,8}_\d{1,2}월) \d{1,2}월(?=[_ ])/, "$1");
async function histList() {
  const list = (await kvGet("moHistory")) || [];
  let fixed = false;
  for (const h of list) {
    const n = fixName(h.name);
    if (n !== h.name) {
      h.name = n;
      fixed = true;
    }
  }
  if (fixed) await kvSet("moHistory", list);
  return list.sort((a, b) => (b.ym || "").localeCompare(a.ym || "") || b.at - a.at);
}
async function histAdd(meta, bytes) {
  const list = await histList();
  for (const x of list.filter((x) => x.ym && x.ym === meta.ym)) await kvSet(`moFile:${x.id}`, null); // 같은 달은 새 파일로
  await kvSet(`moFile:${meta.id}`, bytes);
  await kvSet("moHistory", [meta, ...list.filter((x) => !(x.ym && x.ym === meta.ym))]);
  chrome.storage.local.set({ moUpdatedAt: Date.now() }).catch(() => {}); // 메뉴의 보고일 표시 갱신
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

// 보고일 폴더 (담당자 요청 2026-11-25): 저장 폴더 안에 보고일 이름(예: 20261125) 폴더를 만들어 그 안에 저장
const dateFolder = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d.replace(/-/g, "") : ""); // 예: 20261125 (담당자 정정 2026-11-25)
async function saveFile(fileName, bytes, reportDate) {
  const folder = dateFolder(reportDate);
  const h = (await kvGet("moSaveDir")) || (await kvGet("saveDir"));
  if (h) {
    try {
      let p = await h.queryPermission({ mode: "readwrite" });
      if (p !== "granted") p = await h.requestPermission({ mode: "readwrite" });
      if (p === "granted") {
        const dir = folder ? await h.getDirectoryHandle(folder, { create: true }) : h;
        const fh = await dir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
        return `📁 ${h.name}/${folder ? `${folder}/` : ""}${fileName}`;
      }
    } catch (e) {
      setSummary(`고른 폴더에 저장하지 못해 다운로드 폴더로 받습니다 (${e.message || e})`, "err");
    }
  }
  // 다운로드 폴더: 크롬 다운로드로 받아 한글 파일 이름이 그대로 붙게 (같은 이름이면 덮어씀)
  // 크롬이 overwrite 를 무시하고 "(1)" 을 붙이는 경우가 있어, 전에 받은 같은 이름 파일(과 (1)(2) 사본)을 먼저 지운다 (담당자 요청 2026-11-25)
  await removeOldDownloads(fileName, folder);
  const url = URL.createObjectURL(new Blob([bytes], { type: PPTX_MIME }));
  try {
    await chrome.downloads.download({ url, filename: folder ? `${folder}/${fileName}` : fileName, conflictAction: "overwrite", saveAs: false });
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return `다운로드 폴더/${folder ? `${folder}/` : ""}${fileName}`;
}
async function removeOldDownloads(fileName, folder) {
  try {
    const nfc = (x) => String(x || "").normalize("NFC");
    const stem = nfc(fileName).replace(/\.pptx$/i, "");
    const items = await chrome.downloads.search({ filenameRegex: "\\.pptx$", exists: true, limit: 500 });
    for (const it of items) {
      if (it.state === "in_progress") continue;
      const parts = nfc(it.filename).split(/[\\/]/);
      const base = parts.pop().replace(/ \(\d+\)(?=\.pptx$)/i, "").replace(/\.pptx$/i, "");
      if (base !== stem || (folder && parts.pop() !== folder)) continue;
      await chrome.downloads.removeFile(it.id).catch(() => {});
      await chrome.downloads.erase({ id: it.id }).catch(() => {});
    }
  } catch {}
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
    tr.innerHTML = `<td><b>${h.ym ? `${y}년 ${+m}월` : "-"}</b></td><td>${esc(h.date || "-")}</td><td>${h.uploaded ? '<span class="badge-edit">넣은 지난 보고서</span> ' : ""}${h.edited ? `<span class="badge-edit" title="${esc(new Date(h.edited).toLocaleString("ko-KR"))} 수정 파일 올림">수정본</span> ` : ""}${esc(h.name)}</td><td>${new Date(h.at).toLocaleString("ko-KR")}</td><td class="actions"><div class="acts"><button data-a="get" class="btn-get" type="button">⬇ 받기</button><label class="filebtn small" title="PPT 에서 직접 고친 파일로 이 달 보고서를 바꿉니다 (다음 달 틀·데일리 DB 도 이 파일로)">수정 파일 올리기<input type="file" data-a="up" accept=".pptx" hidden></label><button data-a="del" class="danger" type="button">삭제</button></div></td>`;
    tr.querySelector('[data-a="get"]').addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      await ensureSaveDir();
      const bytes = await kvGet(`moFile:${h.id}`);
      if (!bytes) return alert("파일 내용을 찾지 못했습니다");
      const where = await saveFile(h.name, bytes, h.date);
      Celebrate.done(btn);
      await Celebrate.after();
      alert(`✅ 월간 실적 보고 저장 완료\n\n저장 위치: ${where}`);
    });
    tr.querySelector('[data-a="up"]').addEventListener("change", async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (f) await replaceWithEdited(h, f);
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

// 보관함의 그 달 보고서를 담당자가 PPT 에서 직접 고친 파일로 바꾼다 (담당자 요청 2026-11-25)
// 파일 이름은 보관함 이름 그대로 (받으면 같은 이름으로 덮어씀). 고친 개요·주요 이슈는 다음 AI 작성 때 참고(학습)
async function replaceWithEdited(h, f) {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const info = await MonthlyPptx.read(bytes);
    if (h.ym && info.year && info.month && ymKey(info.year, info.month) !== h.ym && !confirm(`올린 파일의 제목은 ${info.year}년 ${info.month}월 보고서입니다. ${h.ym} 보고서를 이 파일로 바꿀까요?`)) return;
    const list = await histList();
    const cur = list.find((x) => x.id === h.id);
    if (!cur) return;
    const before = { page1: cur.overview1, page2: cur.overview2 && [cur.overview2.join(" ")], issues: cur.issues };
    const after = { page1: info.overview1, page2: info.overview2 && [info.overview2.join(" ")], issues: info.s1 && info.s1.issues };
    await kvSet(`moFile:${h.id}`, bytes);
    // 올린 파일 이름이 이 달 보고일(YYMMDD/YYYYMMDD)로 시작하면 그 이름으로 (" (1)" 은 뗌), 아니면 보관 이름 그대로
    const upName = fixName(f.name).replace(/ \(\d+\)(?=\.pptx$)/i, "");
    const d8 = String(cur.date || "").replace(/-/g, "");
    const newName = d8 && (upName.startsWith(d8) || upName.startsWith(d8.slice(2))) ? upName : fixName(cur.name);
    Object.assign(cur, { name: newName, overview1: info.overview1, overview2: info.overview2, issues: (info.s1 && info.s1.issues) || cur.issues, edited: Date.now(), editedFrom: f.name });
    await kvSet("moHistory", list);
    chrome.storage.local.set({ moUpdatedAt: Date.now() }).catch(() => {});
    const learned = cur.uploaded ? 0 : await recordEdits(h.ym, before, after, "받은 뒤 PPT 에서 직접 고침");
    setSummary(`✅ ${h.ym} 보고서를 수정 파일로 바꿨습니다 (${f.name} → 보관 이름 ${newName})${learned ? ` · 고친 개요·이슈 ${learned}곳을 기억해 다음 AI 작성 때 참고합니다` : ""}`, "ok");
    Celebrate.ding();
    await renderHist();
    await refresh();
  } catch (e) {
    setSummary(`수정 파일을 올리지 못했습니다: ${e.message || e}`, "err");
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
      await histAdd({ id: `mo-${Date.now()}-${ok.length}`, at: Date.now(), ym: ymKey(info.year, info.month), date, name: f.name.normalize("NFC"), uploaded: true, overview1: info.overview1, overview2: info.overview2 }, bytes);
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
// 보고일 표시 (담당자 요청 2026-11-20: 블루 굵게 조금 크게 · 이탤릭 밑줄 · D-N)
// 보고일이 지났는데 작성·다운로드를 안 했으면만 빨간 강한 효과와 D+N. 했으면 다음 보고일까지 D-N.
async function renderDateLabel() {
  if (!ctx || !ctx.date) return;
  const { y, m, date, start, autoDate, ovKey } = ctx;
  const info = $("#moDateInfo");
  info.textContent = "";
  const rd = document.createElement("span");
  rd.className = "mo-rdate";
  const diff = daysUntil(date);
  let warn = null;
  if (diff >= 0) rd.textContent = `보고일 ${fmt(date)} (${diff === 0 ? "D-Day" : `D-${diff}`})`;
  else if (!(await moDone(y, m))) {
    rd.textContent = `보고일 ${fmt(date)} (D+${-diff})`;
    rd.classList.add("mo-overdue");
    warn = document.createElement("div");
    warn.className = "mo-overdue-box";
    warn.textContent = `🚨 ${m}월 보고일이 ${-diff}일 지났는데 아직 보고서를 작성·다운로드하지 않았습니다! 아래에서 바로 작성해 주세요.`;
  } else {
    const [uy, um] = await upcomingYm();
    const nd = await effReportDate(uy, um);
    const nd2 = daysUntil(nd);
    rd.textContent = `보고일 ${fmt(date)} (✓ 작성 완료 · 다음 보고일 ${nd.getMonth() + 1}/${nd.getDate()} ${nd2 === 0 ? "D-Day" : `D-${nd2}`})`;
  }
  info.append(
    ovKey ? "✎ 특정일 기준 요청: " : "",
    rd,
    ovKey ? ` (원래 25일 기준 ${fmt(autoDate)})` : date.getDate() !== 25 ? " (25일이 주말·휴일이라 전 근무일)" : "",
    ` · 기간 ${dkey(start)} ~ ${dkey(date)}`
  );
  if (warn) info.append(warn);
  info.className = ovKey ? "hint err" : "hint";
}
async function refresh() {
  stats = null;
  $("#moStats").hidden = true;
  $("#moStatsEmpty").hidden = false;
  const ym = selYm();
  if (!ym) return;
  const [y, m] = ym;
  // 보고일: 기본은 25일 규칙. 일찍 보고를 요청받으면 담당자가 바꾼 날(보고 월마다 저장 "moDateOverride:<YYYY-MM>")
  const autoDate = reportDate(y, m);
  const ovKey = await kvGet(`moDateOverride:${ymKey(y, m)}`);
  const date = ovKey && /^\d{4}-\d{2}-\d{2}$/.test(ovKey) ? new Date(`${ovKey}T00:00`) : autoDate;
  $("#moDate").value = ovKey ? dkey(date) : ""; // 평소엔 비워 둠 (특정일 기준 요청일 때만 날짜)
  $("#moDateReset").hidden = !ovKey;
  const tpl = await templateFor(y, m);
  const [py, pm] = prevYm(y, m);
  const tplEnd = tpl && tpl.entry.ym === ymKey(py, pm) ? periodEndOf(tpl.info) : null;
  const start = tplEnd ? new Date(tplEnd.getFullYear(), tplEnd.getMonth(), tplEnd.getDate() + 1) : (() => {
    const p = reportDate(py, pm);
    return new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1);
  })();
  const xl = await excelFor(date);
  ctx = { y, m, date, start, end: date, tpl, xl };
  ctx.autoDate = autoDate;
  ctx.ovKey = ovKey;
  await renderDateLabel();
  $("#moTplInfo").textContent = tpl ? `틀: ${tpl.entry.name} (${tpl.info.year}년 ${tpl.info.month}월 보고서)${tpl.entry.ym !== ymKey(py, pm) ? ` · ⚠ ${pm}월 보고서가 없어 더 앞선 보고서를 씁니다` : ""}` : `${y}년 ${m}월 보다 앞선 월간 실적 보고가 없습니다. 지난달 보고서 PPT 를 넣어 주세요.`;
  $("#moTplInfo").className = tpl ? "hint ok" : "hint err";
  $("#moXlInfo").textContent = xl ? `일일동향 엑셀: ${xl.name}${xlOverride ? " (직접 고름)" : ""}${xl.date && xl.date < dkey(date) ? ` · ⚠ 보고일(${dkey(date)}) 파일이 아직 없어 ${xl.date} 파일로 집계 (3번 탭에서 새 일일동향 엑셀이 저장되면 자동으로 다시 집계)` : ""}` : "일일동향 엑셀이 없습니다. 3번 탭에서 만들거나 넣어 주세요.";
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
  // 온라인 상시 모니터링 건수: 자동 값이면 집계할 때마다 따라감, 담당자가 직접 고쳤으면 그대로 (담당자 지적 2026-11-16)
  if (onlineAuto || !$("#moOnline").value) {
    $("#moOnline").value = String(sel.length);
    onlineAuto = true;
  }
  $("#moOnline").classList.toggle("auto", onlineAuto);
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
    <div class="pv-row"><div class="pv-lab">개요</div><div class="pv-ov" data-k="ov2">${ov ? `○ ${esc(ov)}` : '<span class="pv-empty">④ 에서 2페이지 개요를 써 주세요</span>'}</div></div>
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
let onlineAuto = true; // 온라인 상시 모니터링 건수가 집계 자동 값인지 (직접 고치면 false)
const draftKey = () => (ctx ? `moDraft:${ymKey(ctx.y, ctx.m)}` : "");
async function loadDraft() {
  const d = (draftKey() && (await kvGet(draftKey()))) || null;
  const prev = (ctx.tpl && ctx.tpl.info.s1) || {};
  for (const [id, k, pv] of NUMS) {
    $(`#${id}`).value = d && d[k] != null ? d[k] : k === "cafes" && prev.cafes ? String(prev.cafes) : "";
    $(`#${pv}`).textContent = prev[k] != null ? `지난달 ${Number(prev[k]).toLocaleString()}` : "";
  }
  onlineAuto = !d || d.onlineAuto !== false;
  $("#moOnline").classList.toggle("auto", onlineAuto && $("#moOnline").value !== "");
  extras = d && d.extras ? d.extras : (prev.extras || []).map((x) => ({ title: x.title, date: x.date, count: "" })); // 지난달 목록은 건수 비우고
  $("#ov1").value = d ? d.ov1 || "" : "";
  $("#ov2").value = d ? d.ov2 || "" : "";
  $("#issues").value = d ? d.issues || "" : "";
  aiOut = (d && d.aiOut) || null;
  applyAutoCounts();
  renderExtras();
  updateLens();
  renderPreview();
}

// 번외 보고 기본 건수 자동 입력 (담당자 요청 2026-11-14): 월간 실적 기간 안의 근무일 수·주 수로
//  주간 품질 모니터링(온라인 부분) = 주 수 (주간 보고, 담당자 정정 2026-11-14) / 현대자동차 전차종 raw data 일일 보고 = 근무일 수
//  ‘블루핸즈 정비 예약’ 관련 주간 모니터링 = 주 수 (주간 보고) / LX3 북미 시트 사고 관련 일일 동향 모니터링 = 근무일 수 (× 2 아님, 담당자 정정 2026-11-14)
//  일일동향 엑셀화 일일 전달 = 근무일 수
// 근무일은 설정의 근무 요일·휴일 목록 기준, 주 수는 기간 안에 근무일이 하루라도 있는 주.
// 담당자가 직접 고친 건수는 그대로 두고, 비었거나 자동으로 넣은 건수만 다시 계산한다 (기간이 바뀌면 함께 바뀜).
const AUTO_COUNT_RULES = [
  { re: /주간\s*품질\s*모니터링/, label: "주 수 (주간 보고)", f: (w) => w.weeks }, // 담당자 정정 2026-11-14: 근무일 수 아님
  { re: /raw\s*data.*일일\s*보고|전차종.*raw/i, label: "근무일 수", f: (w) => w.days },
  { re: /블루\s*핸즈.*주간\s*모니터링|정비\s*예약.*주간/, label: "주 수", f: (w) => w.weeks },
  { re: /LX3.*시트.*(사고|일일\s*동향)|북미\s*시트/, label: "근무일 수", f: (w) => w.days }, // 담당자 정정 2026-11-14: × 2 하지 않음
  { re: /일일동향\s*엑셀화|엑셀화.*일일\s*전달/, label: "근무일 수", f: (w) => w.days },
  // 2026-11-10 에 시작한 업무: 시작일부터 근무일 수 (다음 달부터는 기간 전체 근무일 수와 같아짐) (담당자 지정 2026-11-14)
  { re: /GV90.*전\s*채널.*(일일\s*)?모니터링/i, label: "근무일 수 (11/10 시작)", since: "2026-11-10", f: (w) => w.days, addTitle: "‘GV90’ 관련 전 채널 일일 모니터링", addDate: "11/10~" },
];
function periodWork(since) {
  if (!ctx) return { days: 0, weeks: 0 };
  let days = 0;
  const weeks = new Set();
  // since(YYYY-MM-DD): 그 날 시작한 업무는 그 날부터만 센다
  const from = since && since > dkey(ctx.start) ? new Date(`${since}T00:00`) : new Date(ctx.start);
  for (let d = from; d <= ctx.end; d.setDate(d.getDate() + 1)) {
    if (!isWorkday(d, settings)) continue;
    days++;
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    weeks.add(dkey(mon));
  }
  return { days, weeks: weeks.size };
}
// 매달 하는 고정 업무 (raw data 일일 보고·일일동향 엑셀화·주간 품질 모니터링·LX3 북미 시트·블루핸즈 주간 모니터링)
// → 개요·주요 이슈 AI 작성 때는 참고하지 않는다 (담당자 지정 2026-11-14). 그 달 따로 요청받은 업무(GV90 등)만 참고.
const isFixedWork = (title) => AUTO_COUNT_RULES.some((r) => !r.since && r.re.test(String(title || "")));
function autoRuleOf(title) {
  return AUTO_COUNT_RULES.find((r) => r.re.test(String(title || "")));
}
function applyAutoCounts() {
  const w = periodWork();
  // 시작일이 정해진 정기 업무가 이 기간에 이미 시작했는데 목록에 없으면 넣는다 (예: 11/10 시작 GV90 전 채널 일일 모니터링)
  if (ctx) {
    for (const r of AUTO_COUNT_RULES.filter((r) => r.addTitle && r.since && r.since <= dkey(ctx.end))) {
      if (!extras.some((x) => r.re.test(String(x.title || "")))) extras.push({ title: r.addTitle, date: r.addDate || "", count: "", countAuto: true });
    }
  }
  for (const x of extras) {
    const r = autoRuleOf(x.title);
    if (!r) continue;
    if (String(x.count ?? "").trim() === "" || x.countAuto) {
      x.count = String(r.f(r.since ? periodWork(r.since) : w));
      x.countAuto = true;
    }
  }
  const info = $("#autoCountInfo");
  // 정기 업무 건수는 보고일까지 미리 계산한 최종 값 (일일동향 엑셀과 관계없음, 담당자 확인 2026-11-16)
  if (info) info.textContent = ctx ? `보고 기간 ${dkey(ctx.start)} ~ 보고일 ${dkey(ctx.end)} · 근무일 ${w.days}일 · ${w.weeks}주 = 보고일까지 미리 계산한 최종 건수입니다 (일일동향 엑셀과 관계없이 고정, 특정일 기준 요청이면 그 날까지로 다시 계산 · 직접 고치면 그 값 유지)` : "";
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
    <div class="pv-row"><div class="pv-lab">개요</div><div class="pv-ov" ${k("ov1")}>${ov.length ? ov.map((t) => `<div>○ ${esc(t)}</div>`).join("") : '<span class="pv-empty">④ 에서 개요를 써 주세요</span>'}</div></div>
    <table class="pv-t">
      <colgroup><col style="width:24%"><col style="width:15%"><col style="width:15%"><col></colgroup>
      <tr><th>항 목</th><th>${ctx.y}년 ${ctx.m}월</th><th>${pm}월</th><th>내 용</th></tr>
      <tr><td>온라인 상시 모니터링 (오전)</td><td class="cur" ${k("online")}>${num("moOnline", "건")}</td><td class="prv">${pnum("online", "건")}</td><td class="txt" ${k("issues")}>${issues.length ? list(issues) : '<div class="plain pv-empty">④ 주요 이슈</div>'}</td></tr>
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

// 담당자 수정 학습 (담당자 요청 2026-11-25): AI 가 쓴 문구와 담당자가 최종으로 고친 문구를 "moEdits" 에 모아
// 다음 달 AI 작성 때 '이렇게 고쳤다' 사례로 넘긴다 (최근 12건)
let aiOut = null;
async function recordEdits(ym, before, after, how) {
  const norm = (a) => (a || []).map((x) => String(x).trim()).filter(Boolean).join("\n");
  const add = [];
  for (const k of ["page1", "page2", "issues"]) {
    if (!before || !before[k] || !after || !after[k]) continue;
    if (norm(before[k]) && norm(after[k]) && norm(before[k]) !== norm(after[k])) add.push({ ym, at: Date.now(), part: k, how, before: before[k], after: after[k] });
  }
  if (!add.length) return 0;
  const list = ((await kvGet("moEdits")) || []).filter((e) => !(e.ym === ym && add.some((a) => a.part === e.part)));
  await kvSet("moEdits", [...add, ...list].slice(0, 12));
  return add.length;
}
async function saveDraft() {
  renderPreview();
  renderPreview2();
  if (!draftKey()) return;
  const d = { extras, ov1: $("#ov1").value, ov2: $("#ov2").value, issues: $("#issues").value };
  for (const [id, k] of NUMS) d[k] = $(`#${id}`).value;
  d.onlineAuto = onlineAuto;
  d.aiOut = aiOut;
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
    c.addEventListener("input", () => { x.count = c.value; x.countAuto = false; c.classList.remove("auto-cnt"); syncExtraSum(); saveDraft(); });
    const rule = autoRuleOf(x.title);
    if (rule && x.countAuto) {
      c.classList.add("auto-cnt");
      c.title = `자동: ${rule.label} (직접 고치면 그 값 유지)`;
    }
    // 제목을 바꿔 자동 항목이 되면 건수도 채움
    t.addEventListener("change", () => {
      if (autoRuleOf(x.title) && String(x.count ?? "").trim() === "") {
        applyAutoCounts();
        renderExtras();
        saveDraft();
      }
    });
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
  const t0 = Date.now(); // 데일리 DB 월간 '소요' 칸 (AI 개요 작성 시간)
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
      extraReports: extras.filter((x) => x.title && !isFixedWork(x.title)).map((x) => `${x.title}${x.date ? ` (${x.date})` : ""}`), // 고정 업무 제외
      lastMonthReport: { page1: tplInfo.overview1, page2: tplInfo.overview2, issues: tplInfo.s1.issues || [] },
      pastExamples: examples,
      dailyPosts: posts.slice(0, 400),
      excelRowsIfNoPpt: fallback.slice(0, 400),
      current: { page1: lines($("#ov1").value), page2: lines($("#ov2").value), issues: lines($("#issues").value) },
      request: $("#aiRequest").value.trim(),
      editorCorrections: ((await kvGet("moEdits")) || []).slice(0, 12).map((e) => ({ month: e.ym, part: e.part, ai_or_before: e.before, editor_final: e.after })),
    };
    $("#aiInfo").textContent = `일일 PPT ${days}일치 · 게시글 ${posts.length || fallback.length}건으로 쓰는 중… (1분 가량)`;
    const system = `당신은 현대자동차 온라인 여론 모니터링 담당자로서, 경영진에게 올리는 '월간 온라인 여론 동향 정리(월간 실적 보고)' 2장짜리 PPT 의 핵심 문구를 씁니다.
이 보고서에서 가장 중요한 부분은 각 페이지 상단 '개요'입니다. 한 달 동안의 일일 동향을 꼼꼼히 읽고, 무엇이 이번 달의 핵심이었는지 판단해 성의 있게 씁니다.

[입력]
- dailyPosts: 이 기간 매일 보고한 일일 PPT 게시글 (차종 코드, 불만 유형·단계(주의/경고/심각), 제목, 요약, 본문 요약, 댓글 반응, 신규/중복)
  (일일 PPT 가 없으면 excelRowsIfNoPpt: 일일동향 엑셀 행)
- carRanking / categories / totals: 이번 달·지난달 건수 (차종 순위, 증감)
- priorityCars: 회사가 중점 관리하는 신차·주요 차종 코드
- extraReports: 이번 달 번외 추가 요청 보고 중 그 달 따로 요청받은 업무 목록 (매달 하는 고정 업무는 이미 뺐음)
  필요하면 개요(1·2페이지)와 주요 이슈(issues)를 쓸 때 이 제목들을 참고해도 됩니다 (담당자 지정 2026-11-14).
  예) 'NX5 가격 공개 후 CN8 관련 이슈 보고', ''GV90' 관련 전 채널 일일 모니터링' 처럼 이번 달 특별히 요청받은 차종·이슈는 그 달의 중점 사항이므로 개요에 녹여 쓸 수 있습니다.
  단 이 달 일일 동향의 핵심 품질 이슈를 가리지 않게 하고, 제목을 그대로 나열하기보다 개요 문장에 자연스럽게 담습니다. raw data 일일 보고, 일일동향 엑셀화 일일 전달, 주간 품질 모니터링(온라인 부분), LX3 북미 시트 사고 관련 일일 동향 모니터링, '블루핸즈 정비 예약' 관련 주간 모니터링 같은 매달 하는 고정 업무는 개요·주요 이슈 어디에도 쓰지 않습니다 (담당자 지정 2026-11-14).
- lastMonthReport, pastExamples: 지난 보고서들의 개요 — 문체·길이·구성을 그대로 본받습니다 (내용은 이번 달 것으로)
- editorCorrections: 지난 보고서에서 AI 가 쓴(또는 시스템이 만든) 문구(ai_or_before)를 담당자가 최종으로 고친 문구(editor_final). 담당자가 고친 방향(표현, 길이, 강조점, 넣고 뺀 내용, 순서)을 규칙처럼 따라 처음부터 그렇게 씁니다 (담당자 지정 2026-11-25). part: page1=1페이지 개요, page2=2페이지 개요, issues=주요 이슈
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
- 2번: 이번 달 두 번째로 중요한 이슈를 씁니다. 그 달 따로 요청받은 업무(extraReports, 예: "NX5 가격 공개 후 CN8 관련 여론 동향", "'GV90' 관련 전 채널 일일 모니터링")가 중요하면 그것을 녹여 써도 됩니다.
  고정 업무(일일동향 엑셀 DB 전달, 주간 품질 모니터링, raw data 일일 보고 등)는 쓰지 않습니다. 지난 보고서에 고정 업무가 적혀 있어도 따라 하지 않습니다. 1번과 내용이 겹치지 않게.
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
    if (typeof CostLog !== "undefined") CostLog.addUsage("monthly", ymKey(ctx.y, ctx.m), msg.model || model, msg.usage); // 데일리 DB 월간 AI 비용
    if (msg.stop_reason === "refusal") throw new Error("Claude 가 작성을 거절했습니다");
    const out = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const clean = (a) => (a || []).map((s) => String(s).replace(/^\s*[○●•\-]\s*/, "").replace(/·/g, ", ").trim()).filter(Boolean);
    $("#ov1").value = clean(out.overview1).slice(0, 2).join("\n");
    $("#ov2").value = clean(out.overview2).join(" ");
    $("#issues").value = clean(out.issues).join("\n");
    aiOut = { page1: clean(out.overview1).slice(0, 2), page2: [clean(out.overview2).join(" ")], issues: clean(out.issues) };
    updateLens();
    await saveDraft();
    $("#aiInfo").textContent = `✅ 작성 완료 — ${out.note || ""}`;
    if (typeof CostLog !== "undefined") CostLog.addTime("monthly", ymKey(ctx.y, ctx.m), Date.now() - t0);
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
// 파일 이름: 틀(지난달) 보고서 이름에서 앞 날짜 → 보고일, 'N월' → 이번 보고 월 (담당자 지적 2026-11-25: 이번 달 파일이 10월로 만들어짐
//  → 이름에 'N월'이 여러 번 있거나 숫자에 붙어 있어도 틀 보고서의 월을 모두 바꾼다. 해가 바뀌면 'YYYY년'도)
function fileName() {
  if (!ctx || !ctx.tpl) return "";
  const d = ctx.date;
  const ymd8 = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  // 맥 파일 이름은 한글이 자모로 풀려(NFD) 있어 '월'을 못 찾음 → 먼저 합친다(NFC) (담당자 지적 2026-11-25: "261125_11월 10월_실적정리")
  let name = String(ctx.tpl.entry.name || "").normalize("NFC").replace(/\.pptx$/i, "");
  if (/^\d{8}/.test(name)) name = name.replace(/^\d{8}/, ymd8);
  else if (/^\d{6}/.test(name)) name = name.replace(/^\d{6}/, ymd8.slice(2));
  else name = `${ymd8.slice(2)}_${name}`;
  const info = ctx.tpl.info || {};
  const tm = Number(info.month) || 0;
  let hit = false;
  const sub = (re) => {
    name = name.replace(re, (_, a, b) => {
      hit = true;
      return `${a}${ctx.m}${b}`;
    });
  };
  if (tm) sub(new RegExp(`(^|[^0-9])0?${tm}(\\s*월)`, "g"));
  if (!hit) sub(/(^|[^0-9])\d{1,2}(\s*월)/g);
  if (!hit) name = name.replace(/^(\d{6,8})_?/, `$1_${ctx.m}월 `);
  if (info.year && Number(info.year) !== ctx.y) name = name.replace(new RegExp(`${info.year}(\\s*년)`, "g"), `${ctx.y}$1`);
  return `${name}.pptx`;
}

// 맥 파일 정보의 '출처(chrome-extension://…)'는 크롬 다운로드로 받을 때만 붙는다 (담당자 요청 2026-11-25: 출처 안 나오게)
// → 저장 폴더를 골라 두면 그 폴더에 직접 써서 출처가 남지 않음. 폴더가 없으면 버튼 누른 순간 한 번 고르게 한다
async function ensureSaveDir() {
  if ((await kvGet("moSaveDir")) || (await kvGet("saveDir"))) return;
  if (!window.showDirectoryPicker) return;
  try {
    setSummary("📁 저장할 폴더를 한 번 골라 주세요 (고르면 파일 정보에 '출처'가 남지 않고, 다음부터는 묻지 않습니다)");
    const h = await window.showDirectoryPicker({ id: "monthly-out", mode: "readwrite", startIn: "desktop" });
    await kvSet("moSaveDir", h);
    showWhere();
  } catch {}
}
async function build() {
  await ensureSaveDir(); // 버튼 누른 직후에 (늦으면 브라우저가 폴더 창을 막음)
  const t0 = Date.now(); // 데일리 DB 월간 '소요' 칸 (PPT 만들기 시간)
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
    const where = await saveFile(name, bytes, dkey(ctx.date));
    await histAdd({ id: `mo-${Date.now()}`, at: Date.now(), ym: ymKey(ctx.y, ctx.m), date: dkey(ctx.date), name, overview1: ov1, overview2: ov2, issues }, bytes);
    const learned = await recordEdits(ymKey(ctx.y, ctx.m), aiOut, { page1: ov1, page2: [ov2.join(" ")], issues }, "AI 작성 후 화면에서 고침");
    if (learned) setSummary(`✎ AI 문구를 고친 부분 ${learned}곳을 기억했습니다 — 다음 AI 작성부터 같은 방향으로 씁니다`, "ok");
    await renderHist();
    await renderDateLabel(); // 밀린 보고(D+N) 경고 끄고 다음 보고일 D-N 으로
    if (typeof CostLog !== "undefined") CostLog.addTime("monthly", ymKey(ctx.y, ctx.m), Date.now() - t0);
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
  // 기본 보고 월: 이번 달 보고일(특정일 기준 요청 반영)이 지나지 않았으면 이번 달, 지났으면 다음 달
  {
    const [y, m] = await upcomingYm();
    $("#moMonth").value = ymKey(y, m);
  }
  $("#moMonth").addEventListener("change", () => {
    autoMonth = false; // 직접 고른 달은 그대로 둔다
    xlOverride = null;
    refresh();
  });
  // 화면을 열어 둔 채 날짜가 바뀌면: 자동 선택이면 다음 보고 월로 넘어가고, D-N 다시 계산
  let lastDay = dkey(new Date());
  const onNewDay = async () => {
    const d = dkey(new Date());
    if (d === lastDay) return;
    lastDay = d;
    if (autoMonth) {
      const [y, m] = await upcomingYm();
      if ($("#moMonth").value !== ymKey(y, m)) {
        $("#moMonth").value = ymKey(y, m);
        xlOverride = null;
      }
    }
    refresh();
  };
  setInterval(onNewDay, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) onNewDay();
  });
  // 일찍 보고: 보고일을 바꾸면 기간 끝·파일 이름·쓸 일일동향 엑셀이 그 날로 바뀐다 (다음 달 기간은 이 날 다음 날부터)
  $("#moDate").addEventListener("change", async () => {
    const ym = selYm();
    const v = $("#moDate").value;
    if (!ym) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      // 비우면 25일 기준으로
      await kvSet(`moDateOverride:${ymKey(ym[0], ym[1])}`, null);
      chrome.storage.local.set({ moUpdatedAt: Date.now() }).catch(() => {});
      await refresh();
      if (ctx && ctx.tpl && ctx.xl) loadStats().catch(() => {});
      return;
    }
    const auto = dkey(reportDate(ym[0], ym[1]));
    await kvSet(`moDateOverride:${ymKey(ym[0], ym[1])}`, v === auto ? null : v);
    chrome.storage.local.set({ moUpdatedAt: Date.now() }).catch(() => {}); // 메뉴 보고일 알림도 이 날로
    await refresh();
    if (ctx && ctx.tpl && ctx.xl) loadStats().catch(() => {});
  });
  $("#moDateReset").addEventListener("click", async () => {
    const ym = selYm();
    if (!ym) return;
    await kvSet(`moDateOverride:${ymKey(ym[0], ym[1])}`, null);
    chrome.storage.local.set({ moUpdatedAt: Date.now() }).catch(() => {});
    await refresh();
    if (ctx && ctx.tpl && ctx.xl) loadStats().catch(() => {});
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
  $("#moOnline").addEventListener("input", () => {
    onlineAuto = false; // 직접 고친 값은 다시 집계해도 유지
    $("#moOnline").classList.remove("auto");
    saveDraft();
  });
  // 3번 탭에서 일일동향 엑셀을 새로 만들거나 넣으면 가장 최근 파일로 바로 다시 집계 (담당자 지적 2026-11-16: 실시간 반영)
  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== "local" || !ch.dtUpdatedAt) return;
    xlOverride = null;
    await refresh();
    if (ctx && ctx.tpl && ctx.xl) {
      await loadStats().catch(() => {});
      setSummary(`🔄 일일동향 엑셀이 새로 저장되어 ${ctx.xl.name} 로 다시 집계했습니다 (게시글 ${stats ? stats.total : 0}건)`, "ok");
    }
  });
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
