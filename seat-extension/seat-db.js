// 데이터 DB 화면: 받은 엑셀(날짜별) 목록 · 받기 · 수정본 올리기 · 삭제 · 등록, 작업 데이터 백업 받기·불러오기

const KINDS = ["seat", "seatRaw"]; // 최종 데이터 · 전체 raw 데이터
const CAR_CODES = ["LX3", "ME1", "MX5"];
// 백업에 넣는 작업 데이터 (API 키는 넣지 않음)
const BACKUP_KEYS = ["seatItems", "seatClubIds", "seatSettings", "seatCars"];
let pickFor = null; // { kind, date|null }
// 종류별로 보여줄 건수
const COUNT_FIELDS = { seat: [["posts", "글"], ["missing", "동향 미포함"]], seatRaw: [["posts", "찾은 글"], ["checked", "체크"]] };

// 올린 파일이 그 종류의 양식인지 확인하고 건수를 센다
async function summarize(kind, bytes) {
  const wb = await XlsxTemplate.Workbook.open(bytes);
  const rows = await wb.readRows(wb.sheetNames()[0]);
  if (kind === "seatRaw") {
    // 전체 raw 데이터: 1행 머리글(A 순번 · G 최종 포함(체크))
    const head = rows.find((r) => r.r === 1);
    if (!head || String(head.cells.A || "").trim() !== "순번" || !/체크/.test(String(head.cells.G || ""))) {
      throw new Error("1행 머리글(A 순번 · G 최종 포함(체크) …)이 없습니다. 이 프로그램에서 받은 전체 raw 데이터 엑셀이 맞는지 확인해 주세요.");
    }
    const stats = { posts: 0, checked: 0 };
    for (const r of rows) {
      if (r.r <= 1 || r.cells.A === undefined) continue;
      stats.posts++;
      if (String(r.cells.G || "").trim()) stats.checked++;
    }
    return { summary: `찾은 글 ${stats.posts.toLocaleString()}개 · 체크 ${stats.checked.toLocaleString()}개`, stats };
  }
  // 최종 데이터: 3행 머리글(B 순번 · C 차종 · I 포함 여부)
  const head = rows.find((r) => r.r === 3);
  if (!head || String(head.cells.B || "").trim() !== "순번" || String(head.cells.C || "").trim() !== "차종") {
    throw new Error("3행 머리글(B 순번 · C 차종 …)이 없습니다. 이 프로그램에서 받은 엑셀이 맞는지 확인해 주세요.");
  }
  const stats = { posts: 0, missing: 0, LX3: 0, ME1: 0, MX5: 0 };
  for (const r of rows) {
    if (r.r <= 3 || r.cells.C === undefined) continue;
    stats.posts++;
    const car = String(r.cells.C).trim().toUpperCase();
    if (car in stats) stats[car]++;
    if (/^\s*N/i.test(String(r.cells.I || ""))) stats.missing++;
  }
  const summary = `글 ${stats.posts.toLocaleString()}개 · ${CAR_CODES.map((c) => `${c} ${stats[c].toLocaleString()}`).join(" · ")} · 동향 미포함 ${stats.missing.toLocaleString()}`;
  return { summary, stats };
}

function setInfo(text, cls = "") {
  $("#dbInfo").textContent = text;
  $("#dbInfo").className = `summary ${cls}`;
}

// 그 파일의 글 수와 바로 전 기록 대비 증감 (rows: 최신순)
function fillCounts(td, kind, rows, i) {
  for (const [field, label] of COUNT_FIELDS[kind]) {
    const v = rows[i].stats?.[field];
    if (v === undefined || v === null) continue;
    const prev = rows.slice(i + 1).find((r) => r.stats?.[field] !== undefined && r.stats?.[field] !== null);
    const d = { today: v, prev: prev ? prev.stats[field] : null, prevDate: prev?.date || null, diff: prev ? v - prev.stats[field] : null };
    const line = document.createElement("div");
    line.append(`${label} ${v.toLocaleString()}건 `, diffBadge(d));
    td.append(line);
  }
  if (!td.childNodes.length) td.textContent = "-";
}

async function renderFiles(kind) {
  const tbody = document.querySelector(`section[data-kind="${kind}"] tbody`);
  tbody.innerHTML = "";
  const rows = await dbList(kind);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="hint">아직 저장된 파일이 없습니다. 게시물 수집 화면에서 엑셀을 받으면 자동으로 저장됩니다.</td></tr>`;
    return;
  }
  rows.forEach((rec, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="nowrap"></td><td></td><td></td><td class="counts"></td><td class="nowrap"></td>` +
      `<td class="nowrap"><button class="small get">받기</button> <button class="small up">수정본 올리기</button> <button class="small danger del">삭제</button></td>`;
    tr.children[0].textContent = prettyDate(rec.date) + (i === 0 ? " · 최종" : "");
    if (i === 0) tr.className = "final";
    tr.children[1].textContent = rec.name;
    tr.children[2].textContent = rec.summary || "";
    fillCounts(tr.children[3], kind, rows, i);
    tr.children[4].textContent = `${new Date(rec.savedAt).toLocaleString()} · ${rec.source === "upload" ? "직접 올림" : "자동 저장"}`;
    tr.querySelector(".get").addEventListener("click", () => downloadBytes(rec.bytes, rec.name));
    tr.querySelector(".up").addEventListener("click", () => {
      pickFor = { kind, date: rec.date };
      $("#picker").value = "";
      $("#picker").click();
    });
    tr.querySelector(".del").addEventListener("click", async () => {
      if (!(await askConfirm(`${prettyDate(rec.date)} ${DB_KINDS[kind].short} 파일(${rec.name})을 데이터 DB에서 지울까요?`))) return;
      await dbDelete(rec.key);
      setInfo(`${prettyDate(rec.date)} 파일을 지웠습니다.`);
      render();
    });
    tbody.appendChild(tr);
  });
}

async function renderWork() {
  const s = await chrome.storage.local.get(["seatItems", "seatClubIds", "seatCompare"]).catch(() => ({}));
  const items = s.seatItems || [];
  const checked = items.filter((x) => x.checked);
  const userFiles = (s.seatCompare || []).filter((f) => !f.builtin);
  const lines = [
    ["찾은 글", `${items.length.toLocaleString()}개 (${CAR_CODES.map((c) => `${c} ${items.filter((x) => x.car === c).length}`).join(" · ")})`],
    ["체크한 글", `${checked.length.toLocaleString()}개`],
    ["본문 읽음", `${checked.filter((x) => x.bodyRead).length.toLocaleString()}개`],
    ["요약 씀", `${checked.filter((x) => x.summary).length.toLocaleString()}개 (AI ${checked.filter((x) => x.by === "ai").length} · 규칙 ${checked.filter((x) => x.by === "rule").length})`],
    ["알아낸 카페 번호", `${Object.keys(s.seatClubIds || {}).length}곳`],
    ["비교 파일", (s.seatCompare || []).length ? `${s.seatCompare.length}개 (직접 등록 ${userFiles.length}개)` : "0개 (게시물 수집 화면을 처음 열면 미리 받은 비교 파일이 등록됩니다)"],
  ];
  const tbody = $("#work tbody");
  tbody.innerHTML = "";
  for (const [k, v] of lines) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<th></th><td></td>";
    tr.children[0].textContent = k;
    tr.children[1].textContent = v;
    tbody.appendChild(tr);
  }
}

async function render() {
  for (const kind of KINDS) await renderFiles(kind);
  await renderWork();
  try {
    const est = await navigator.storage.estimate();
    $("#usage").textContent = `이 PC 크롬에 저장된 크기: 약 ${(est.usage / 1e6).toFixed(1)} MB (확장프로그램을 삭제하면 함께 지워집니다).`;
  } catch {
    /* 무시 */
  }
}

async function onPicked(file) {
  if (!file || !pickFor) return;
  const date = pickFor.date || dateFromName(file.name);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { kind } = pickFor;
    const { summary, stats } = await summarize(kind, bytes);
    const existing = (await dbList(kind)).find((r) => r.date === date);
    if (!pickFor.date && existing && !(await askConfirm(`${prettyDate(date)}에 이미 파일(${existing.name})이 있습니다. 이 파일로 바꿀까요?`))) return;
    await dbSaveDay(kind, date, file.name, bytes, "upload", summary, stats);
    setInfo(`✔ ${prettyDate(date)} ${DB_KINDS[kind].short} 파일을 ${file.name}(으)로 ${pickFor.date ? "바꿨습니다" : "등록했습니다"} (${summary}).`, "ok");
  } catch (e) {
    setInfo(`파일을 올리지 못했습니다: ${e.message}`, "err");
  }
  pickFor = null;
  render();
}

async function backup() {
  const s = await chrome.storage.local.get([...BACKUP_KEYS, "seatCompare"]).catch(() => ({}));
  const data = {};
  for (const k of BACKUP_KEYS) if (s[k] !== undefined) data[k] = s[k];
  data.seatCompare = (s.seatCompare || []).filter((f) => !f.builtin); // 미리 등록된 비교 자료는 압축 파일에 있으므로 뺌
  const out = { app: "seat-risk", version: chrome.runtime.getManifest().version, at: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  await clickDownload(blob, `${today()}_전동시트_위험상황_작업데이터_백업.json`);
  setInfo(`✔ 작업 데이터 백업 파일을 받았습니다 (찾은 글 ${(data.seatItems || []).length.toLocaleString()}개).`, "ok");
}

async function restore(file) {
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    if (json.app !== "seat-risk" || !json.data) throw new Error("이 프로그램의 백업 파일이 아닙니다.");
    const n = (json.data.seatItems || []).length;
    if (!(await askConfirm(`백업(${new Date(json.at).toLocaleString()} · 찾은 글 ${n.toLocaleString()}개)으로 지금 작업 데이터를 바꿀까요?\n지금 찾은 글·요약은 백업 내용으로 바뀝니다. (받은 엑셀 목록·API 키는 그대로)`))) return;
    const set = {};
    for (const k of BACKUP_KEYS) if (json.data[k] !== undefined) set[k] = json.data[k];
    const { seatCompare = [] } = await chrome.storage.local.get("seatCompare").catch(() => ({}));
    const restored = json.data.seatCompare || [];
    const names = new Set(restored.map((f) => f.name));
    set.seatCompare = seatCompare.filter((f) => f.builtin && !names.has(f.name)).concat(restored);
    await chrome.storage.local.set(set);
    await chrome.storage.local.remove("resume_seat").catch(() => {});
    setInfo(`✔ 백업을 불러왔습니다 (찾은 글 ${n.toLocaleString()}개).`, "ok");
  } catch (e) {
    setInfo(`백업을 불러오지 못했습니다: ${e.message}`, "err");
  }
  render();
}

for (const sec of document.querySelectorAll("section[data-kind]")) sec.querySelector(".register").addEventListener("click", () => {
  pickFor = { kind: sec.dataset.kind, date: null };
  $("#picker").value = "";
  $("#picker").click();
});
$("#picker").addEventListener("change", (e) => onPicked(e.target.files[0]));
$("#backup").addEventListener("click", backup);
$("#restore").addEventListener("click", () => {
  $("#restoreFile").value = "";
  $("#restoreFile").click();
});
$("#restoreFile").addEventListener("change", (e) => restore(e.target.files[0]));
render();
