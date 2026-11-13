// 일일동향 엑셀 리스트 (담당자 요청 2026-11-13)
// 누적 일일동향 엑셀(기준 파일) 끝에 보고 날짜의 최종 PPT 게시글을 덧붙여 날마다 새 파일을 만든다.
// 파일 이름은 기준 파일 이름 앞의 날짜(YYMMDD)만 보고 날짜로 바꾼다. 만든 파일은 다음 날의 기준 파일이 된다.
// 보관 (IndexedDB report-extension / kv, 영구): 기준 "dtBase" {name, bytes, at},
//   목록 "dtHistory" [{id, at, date, name, added, skipped, uploaded, attached, rows}], 파일 내용 "dtFile:<id>"
// 1인용(다른 담당자 작성)인 날 (담당자 요청 2026-11-13):
//   - 그분이 만든 일일동향 엑셀을 '작성된 일일동향 엑셀 첨부'로 넣어 일일 데이터로 쌓는다 (attached, 날짜는 파일 이름 앞 YYMMDD)
//   - 직접 만들어야 하면 '이 날짜 전체 PPT 첨부'로 그날 전체 PPT 를 데일리 DB(full)에 올리고 그걸로 만든다
//   - 만들 때 기준은 '보고 날짜 바로 전 날짜의 보관 파일'(없으면 지금 기준 파일). 다음 기준은 더 최근 날짜일 때만 바꾼다
const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let rowsToAdd = [];
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
const serialOf = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
const serialText = (n) => {
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const ymdOf = (k) => k.slice(2).replace(/-/g, "");

// ---------------------------------------------------------------------------
// 저장 위치: 일일동향용으로 고른 폴더 → 없으면 PPT 저장 폴더 → 다운로드 폴더
// ---------------------------------------------------------------------------
async function dirHandle() {
  return (await kvGet("dtSaveDir")) || (await kvGet("saveDir")) || null;
}
async function dirIfAllowed() {
  const h = await dirHandle();
  if (!h) return null;
  try {
    let p = await h.queryPermission({ mode: "readwrite" });
    if (p !== "granted") p = await h.requestPermission({ mode: "readwrite" });
    return p === "granted" ? h : null;
  } catch {
    return null;
  }
}
async function showWhere() {
  const own = await kvGet("dtSaveDir");
  const h = own || (await dirHandle());
  $("#dtWhere").textContent = h ? `📁 ${h.name}${own ? "" : " (PPT 저장 폴더와 같음)"}` : "다운로드 폴더";
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
  // 다운로드 폴더: 크롬 다운로드로 받아 한글 파일 이름이 그대로 붙게 (같은 이름이면 덮어씀)
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
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

// ---------------------------------------------------------------------------
// 보관함 (영구)
// ---------------------------------------------------------------------------
async function histList() {
  const list = (await kvGet("dtHistory")) || [];
  return list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.at - a.at);
}
async function histAdd(meta, bytes) {
  const list = await histList();
  // 같은 보고 날짜는 새 파일로 바꾼다
  for (const x of list.filter((x) => x.date && x.date === meta.date)) await kvSet(`dtFile:${x.id}`, null);
  await kvSet(`dtFile:${meta.id}`, bytes);
  await kvSet("dtHistory", [meta, ...list.filter((x) => !(x.date && x.date === meta.date))]);
}
async function renderHist() {
  const hist = await histList();
  $("#dtHist").hidden = !hist.length;
  $("#dtHistEmpty").hidden = !!hist.length;
  const pages = Math.max(1, Math.ceil(hist.length / 10));
  histPage = Math.min(Math.max(1, histPage), pages);
  let pager = document.getElementById("dtPager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "dtPager";
    pager.className = "pager";
    $("#dtHist").after(pager);
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
  const base = await kvGet("dtBase");
  const tbody = $("#dtHist tbody");
  tbody.innerHTML = "";
  for (const h of hist.slice((histPage - 1) * 10, histPage * 10)) {
    const tr = document.createElement("tr");
    const isBase = base && base.name === h.name;
    tr.innerHTML = `<td><b>${esc(h.date || "-")}</b></td><td>${h.attached ? '<span class="badge-edit">첨부(작성된 파일)</span> ' : h.uploaded ? '<span class="badge-edit">넣은 기준 파일</span> ' : ""}${esc(h.name)}${isBase ? " ← 다음 기준" : ""}</td><td class="count-red">${h.attached ? (h.rows ? `누적 ${h.rows.toLocaleString()}건` : "-") : h.uploaded ? "-" : `${h.added || 0}건`}${h.skipped ? `<span class="hint"> (이미 있던 글 ${h.skipped}건 뺌)</span>` : ""}</td><td>${new Date(h.at).toLocaleString("ko-KR")}</td><td class="actions"><div class="acts"><button data-a="get" class="btn-get" type="button">⬇ 받기</button>${isBase ? "" : '<button data-a="base" type="button">기준으로</button>'}<button data-a="del" class="danger" type="button">삭제</button></div></td>`;
    tr.querySelector('[data-a="get"]').addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const bytes = await kvGet(`dtFile:${h.id}`);
      if (!bytes) return alert("파일 내용을 찾지 못했습니다");
      const where = await saveFile(await dirIfAllowed(), h.name, bytes);
      Celebrate.done(btn);
      await Celebrate.after();
      alert(`✅ 일일동향 엑셀 저장 완료\n\n저장 위치: ${where}`);
    });
    tr.querySelector('[data-a="base"]')?.addEventListener("click", async () => {
      const bytes = await kvGet(`dtFile:${h.id}`);
      if (!bytes || !confirm(`다음 일일동향 엑셀을 이 파일 끝에 이어 쓸까요?\n${h.name}`)) return;
      await kvSet("dtBase", { name: h.name, bytes, at: Date.now() });
      showBase();
      renderHist();
    });
    tr.querySelector('[data-a="del"]').addEventListener("click", async () => {
      if (!confirm(`보관함에서 지울까요?\n${h.name}\n(저장 폴더의 파일은 그대로입니다)`)) return;
      await kvSet(`dtFile:${h.id}`, null);
      await kvSet("dtHistory", (await histList()).filter((x) => x.id !== h.id));
      renderHist();
    });
    tbody.append(tr);
  }
}

// ---------------------------------------------------------------------------
// 기준 파일
// ---------------------------------------------------------------------------
async function showBase() {
  const base = await kvGet("dtBase");
  if (!base) {
    $("#dtBaseInfo").textContent = "아직 기준 파일이 없습니다. 지금까지 쓰던 일일동향 엑셀을 넣어 주세요.";
    $("#dtBaseInfo").className = "hint err";
    return null;
  }
  try {
    const info = await DailyTrend.inspect(base.bytes);
    $("#dtBaseInfo").textContent = `기준: ${base.name} · ${info.rows.toLocaleString()}건 · 마지막 게시일 ${info.lastSerial ? serialText(info.lastSerial) : "-"}`;
    $("#dtBaseInfo").className = "hint ok";
  } catch (e) {
    $("#dtBaseInfo").textContent = `기준 파일을 읽지 못했습니다: ${e.message || e}`;
    $("#dtBaseInfo").className = "hint err";
  }
  return base;
}

// ---------------------------------------------------------------------------
// 보고 날짜의 최종 PPT → 엑셀 행
// ---------------------------------------------------------------------------
// 게시일: 데일리 DB 수집 기록 → 날짜별 전체 엑셀 → 날짜별 RAW 에서 같은 글 주소로 찾고, 없으면 보고 날짜 하루 전
async function postDates() {
  const map = new Map();
  // 게시일 → 엑셀 날짜 번호. 숫자·숫자 글자("46338")는 그대로, 날짜 글자·시각은 날짜로 바꾼다.
  // 2010~2040년 범위 밖이면 버린다 (담당자 지적 2026-11-13: "46338" 글자를 연도로 읽어 46338-01-01 이 됨)
  const toSerial = (v) => {
    if (v == null || v === "") return 0;
    let n = 0;
    if (typeof v === "number" || /^\s*\d+(\.\d+)?\s*$/.test(String(v))) {
      n = Number(v);
      if (n > 1e11) n = serialOf(new Date(n)); // ms 시각
      else n = Math.floor(n);
    } else {
      const d = new Date(String(v).replace(/\./g, "-").trim());
      n = isNaN(d) ? 0 : serialOf(d);
    }
    return n >= 40179 && n <= 51136 ? n : 0;
  };
  const put = (url, v) => {
    const k = DailyTrend.urlKey(url);
    const serial = toSerial(v);
    if (k && serial && !map.has(k)) map.set(k, serial);
  };
  const { dailyDb = [] } = await chrome.storage.local.get("dailyDb");
  for (const e of dailyDb) for (const r of e.rows || []) if (r.date) put(r.url, r.date);
  const full = (await kvGet("fullDaily")) || {};
  for (const d of Object.values(full)) for (const r of d.rows || []) put(r.url, r.date);
  const recent = (await kvGet("rawRecent")) || {};
  for (const rows of Object.values(recent)) for (const r of rows || []) put(r.url, r.serial);
  return map;
}

async function loadDay() {
  rowsToAdd = [];
  $("#dtBuild").disabled = true;
  $("#dtPreview").hidden = true;
  const date = $("#dtDate").value;
  if (!date) return;
  showUseBase().catch(() => {});
  const fin = await DailyPpt.finalOf(date);
  const dow = "일월화수목금토"[new Date(`${date}T00:00`).getDay()];
  if (!fin) {
    $("#dtPptInfo").textContent = `${date}(${dow}) 의 최종 PPT 가 데일리 DB 에 없습니다${/[토일]/.test(dow) ? " (주말은 보고가 없고 월요일 PPT 에 들어갑니다)" : ""}.`;
    $("#dtPptInfo").className = "hint err";
    return;
  }
  const details = (await PptRead.read(await DailyPpt.bytesOf(fin.id))).filter((d) => d.title).sort((a, b) => (a.no || 0) - (b.no || 0));
  const dates = await postDates();
  const fallback = serialOf(new Date(`${date}T00:00`)) - 1;
  rowsToAdd = details.map((d) => {
    const naver = /cafe\.naver\.com|naver\.me/i.test(d.url || "");
    const reaction = String(d.reaction || "").trim();
    return {
      no: d.no,
      code: d.code || "-",
      spec: d.spec || "-",
      kind: d.kind || "품질",
      level: d.level || "주의",
      media: naver ? "동호회" : "커뮤니티",
      cafe: String(d.cafe || "").replace(/^(동호회|커뮤니티)\s*/, "").trim(),
      serial: dates.get(DailyTrend.urlKey(d.url)) || fallback,
      url: d.url || "",
      content: `${String(d.body || "").trim()}\n${reaction ? `댓글 반응 :${reaction}` : "댓글 반응 없음"}`,
      duplicate: d.duplicate || "신규",
      region: d.region || "-",
    };
  });
  $("#dtPptInfo").textContent = `${date}(${dow}) 최종 PPT: ${DailyPpt.KIND_LABEL[fin.kind] || fin.kind} · ${fin.name} · 게시글 ${rowsToAdd.length}건${fin.partial ? " · ⚠ 나눠 쓴 일부 PPT (전체 PPT 를 데일리 DB 에 올리면 전체가 들어갑니다)" : ""}`;
  $("#dtPptInfo").className = fin.partial ? "hint err" : "hint ok";
  const tbody = $("#dtPreview tbody");
  tbody.innerHTML = rowsToAdd
    .map((r) => `<tr><td>${r.no ?? ""}</td><td>${esc(r.code)}</td><td>${esc(r.spec)}</td><td>${esc(r.kind)}(<b class="lv-${esc(r.level)}">${esc(r.level)}</b>)</td><td>${esc(r.media)}</td><td>${esc(r.cafe)}</td><td>${serialText(r.serial)}</td><td>${esc(r.content).replace(/\n/g, "<br>")}</td><td>${esc(r.duplicate)}</td><td>${esc(r.region)}</td></tr>`)
    .join("");
  $("#dtPreview").hidden = !rowsToAdd.length;
  $("#dtBuild").disabled = !rowsToAdd.length;
  showUseBase().catch(() => {});
}

// 이 보고 날짜에 이어 쓸 바탕: 보고 날짜보다 앞선 가장 최근 보관 파일 → 없으면 지금 기준 파일
const nameDate = (n) => DailyPpt.dateFromName(n) || "";
async function baseFor(date) {
  const base = await kvGet("dtBase");
  const prev = (await histList()).filter((h) => h.date && h.date < date).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  for (const h of prev) {
    if (base && nameDate(base.name) && nameDate(base.name) < date && nameDate(base.name) > h.date) break; // 기준 파일이 더 최근이면 그것
    const bytes = await kvGet(`dtFile:${h.id}`);
    if (bytes) return { name: h.name, bytes };
  }
  return base || null;
}
async function showUseBase() {
  const date = $("#dtDate").value;
  const b = date ? await baseFor(date) : null;
  const same = date ? (await histList()).find((h) => h.date === date) : null;
  $("#dtUseBase").textContent = b
    ? `이어 쓸 파일: ${b.name} → 만들 파일: ${(/^\d{6}/.test(b.name) ? b.name.replace(/^\d{6}/, ymdOf(date)) : `${ymdOf(date)}_${b.name}`)}${same ? ` · ⚠ 이 날짜 파일(${same.name}${same.attached ? ", 첨부" : ""})이 이미 보관돼 있어 새로 만들면 바뀝니다` : ""}`
    : "";
}

async function build() {
  const date = $("#dtDate").value;
  const base = await baseFor(date);
  if (!base) return setSummary("먼저 ① 기준 엑셀을 넣어 주세요", "err");
  const same = (await histList()).find((h) => h.date === date && h.attached);
  if (same && !confirm(`${date} 은 이미 작성된 파일(${same.name})을 첨부해 두었습니다.\n그날 PPT 로 새로 만들어 바꿀까요?`)) return;
  if (!rowsToAdd.length) return setSummary("더할 게시글이 없습니다", "err");
  const btn = $("#dtBuild");
  btn.disabled = true;
  try {
    const dir = await dirIfAllowed(); // 버튼을 누른 바로 그때 폴더 허용 확인
    setSummary("일일동향 엑셀 만드는 중…");
    const res = await DailyTrend.append(base.bytes, rowsToAdd);
    const ymd = ymdOf(date);
    const name = /^\d{6}/.test(base.name) ? base.name.replace(/^\d{6}/, ymd) : `${ymd}_${base.name}`;
    const where = await saveFile(dir, name, res.bytes);
    const id = `dt-${Date.now()}`;
    await histAdd({ id, at: Date.now(), date, name, added: res.added, skipped: res.skipped }, res.bytes);
    const cur = await kvGet("dtBase");
    if (!cur || !nameDate(cur.name) || nameDate(cur.name) <= date) await kvSet("dtBase", { name, bytes: res.bytes, at: Date.now() }); // 다음 날은 이 파일에 이어서 (지난 날짜를 다시 만들 땐 그대로)
    await showBase();
    await renderHist();
    const msg = `✅ 일일동향 엑셀 저장 완료: ${where} · ${res.added}건 더함${res.skipped ? ` (이미 있던 글 ${res.skipped}건은 뺌)` : ""}`;
    setSummary(msg, "ok");
    Celebrate.done(btn);
    Celebrate.ding();
    await Celebrate.after();
    alert(msg);
  } catch (e) {
    setSummary(`일일동향 엑셀을 만들지 못했습니다: ${e.message || e}`, "err");
  } finally {
    btn.disabled = !rowsToAdd.length;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // 기본 보고 날짜: 오늘 PPT 가 있으면 오늘, 없으면 가장 최근 PPT 날짜
  const today = DailyPpt.dateKey(new Date());
  const days = await DailyPpt.byDate().catch(() => []);
  $("#dtDate").value = days.find((d) => d.date === today) ? today : (days[0] && days[0].date) || today;
  $("#dtBase").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const info = await DailyTrend.inspect(bytes);
      await kvSet("dtBase", { name: f.name, bytes, at: Date.now() });
      await histAdd({ id: `dt-${Date.now()}`, at: Date.now(), date: DailyPpt.dateFromName(f.name) || "", name: f.name, uploaded: true }, bytes);
      setSummary(`기준 파일을 넣었습니다: ${f.name} (${info.rows.toLocaleString()}건)`, "ok");
    } catch (err) {
      setSummary(`이 파일은 일일동향 엑셀로 쓸 수 없습니다: ${err.message || err}`, "err");
    }
    showBase();
    renderHist();
  });
  $("#dtAttach").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const ok = [];
    const bad = [];
    for (const f of files) {
      const date = nameDate(f.name);
      if (!date) {
        bad.push(`${f.name}: 파일 이름 앞에 날짜(YYMMDD)가 없습니다`);
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      try {
        const info = await DailyTrend.inspect(bytes);
        await histAdd({ id: `dt-${Date.now()}-${ok.length}`, at: Date.now(), date, name: f.name, attached: true, rows: info.rows }, bytes);
        ok.push({ date, name: f.name, bytes, rows: info.rows });
      } catch (err) {
        bad.push(`${f.name}: 일일동향 엑셀로 읽지 못했습니다 (${err.message || err})`);
      }
    }
    // 가장 최근 날짜 파일이 지금 기준보다 최근이면 다음 기준으로
    ok.sort((a, b) => b.date.localeCompare(a.date));
    const cur = await kvGet("dtBase");
    if (ok[0] && (!cur || !nameDate(cur.name) || nameDate(cur.name) <= ok[0].date)) await kvSet("dtBase", { name: ok[0].name, bytes: ok[0].bytes, at: Date.now() });
    setSummary(`${ok.length ? `✅ 작성된 일일동향 엑셀 ${ok.length}개를 쌓았습니다 (${ok.map((x) => x.date).sort().join(", ")})` : ""}${bad.length ? `${ok.length ? "\n" : ""}⚠ ${bad.join("\n⚠ ")}` : ""}`, bad.length ? "err" : "ok");
    if (ok.length) Celebrate.ding();
    await showBase();
    await renderHist();
    showUseBase().catch(() => {});
  });
  $("#dtFullPpt").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    const date = $("#dtDate").value;
    if (!f || !date) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const details = await PptRead.read(bytes);
      const n = details.filter((d) => d.title).length;
      if (!n) throw new Error("상세 슬라이드(■ 제목 + 표)를 찾지 못했습니다");
      const fromName = nameDate(f.name);
      if (fromName && fromName !== date && !confirm(`파일 이름의 날짜(${fromName})와 고른 보고 날짜(${date})가 다릅니다. ${date} 의 전체 PPT 로 넣을까요?`)) return;
      await DailyPpt.add({ date, kind: "full", name: f.name, bytes, count: n, partial: !!details.partial });
      setSummary(`✅ ${date} 전체 PPT 를 데일리 DB 에 넣었습니다: ${f.name} (게시글 ${n}건)`, "ok");
      await loadDay();
    } catch (err) {
      setSummary(`전체 PPT 를 읽지 못했습니다: ${err.message || err}`, "err");
    }
  });
  $("#dtLoad").addEventListener("click", () => loadDay().catch((e) => setSummary(`불러오지 못했습니다: ${e.message || e}`, "err")));
  $("#dtDate").addEventListener("change", () => loadDay().catch(() => {}));
  $("#dtBuild").addEventListener("click", build);
  $("#dtPickFolder").addEventListener("click", async () => {
    try {
      const h = await window.showDirectoryPicker({ id: "dtrend-out", mode: "readwrite", startIn: "desktop" });
      await kvSet("dtSaveDir", h);
      showWhere();
    } catch (e) {
      if (e && e.name !== "AbortError") setSummary(`폴더를 고르지 못했습니다: ${e.message || e}`, "err");
    }
  });
  $("#dtClearFolder").addEventListener("click", async () => {
    await kvSet("dtSaveDir", null);
    showWhere();
  });
  await showBase();
  await showWhere();
  await renderHist();
  await loadDay().catch(() => {});
  showUseBase().catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.dailyPptUpdatedAt) loadDay().catch(() => {});
  });
});
