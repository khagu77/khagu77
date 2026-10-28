// 데이터 DB 화면: 받은 보고 엑셀(날짜별) 목록 · 받기 · 수정본 올리기 · 삭제 · 등록, 작업 데이터 백업 받기·불러오기
// (시트 위험 게시물 수집의 seat-db.js 와 같은 모양 · 파일마다 AI 비용과 소요 시간을 함께 보여줌)

const KINDS = ["price"];
// 백업에 넣는 작업 데이터 (API 키는 넣지 않음)
const BACKUP_KEYS = ["priceItems", "priceClubIds", "priceSettings", "priceStart", "priceReport", "priceAiSpend", "priceTime"];
let pickFor = null; // { kind, date|null }
// 건수 칸: 항목마다 전 기록 대비 증감
const COUNT_FIELDS = {
  price: [["posts", "글"], ["neg", "부정"], ["pos", "긍정"], ["cRel", "가격 관련 댓글"], ["cBlame", "댓글 단순비난"]],
};

// "1시간 5분" · "40초"
function fmtSec(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  if (sec < 60) return `${sec}초`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
}

const TIME_PARTS = [["search", "찾기"], ["read", "본문 읽기·요약"], ["ai", "AI 요약"], ["report", "보고 쓰기"]];

// { search: 초, … } → "1시간 5분 (찾기 40분 · 본문 읽기·요약 20분 · …)"
function timeText(t) {
  const total = TIME_PARTS.reduce((n, [k]) => n + (t?.[k] || 0), 0);
  const parts = TIME_PARTS.filter(([k]) => t?.[k] >= 1).map(([k, label]) => `${label} ${fmtSec(t[k])}`);
  return { total, text: `${fmtSec(total)}${parts.length ? ` (${parts.join(" · ")})` : ""}` };
}

// 올린 파일이 이 프로그램의 보고 엑셀인지 확인하고 건수를 센다 ('게시물' 시트 3행 머리글)
async function summarize(kind, bytes) {
  const wb = await XlsxTemplate.Workbook.open(bytes);
  const rows = await wb.readRows(wb.sheetNames()[0]);
  const head = rows.find((r) => r.r === 3);
  if (!head || String(head.cells.B || "").trim() !== "순번" || String(head.cells.C || "").trim() !== "동호회명") {
    throw new Error("3행 머리글(B 순번 · C 동호회명 …)이 없습니다. 이 프로그램에서 받은 엑셀이 맞는지 확인해 주세요.");
  }
  const stats = { posts: 0, pos: 0, neu: 0, neg: 0, cafes: {} };
  const raises = [];
  for (const r of rows) {
    if (r.r <= 3 || r.cells.C === undefined) continue;
    stats.posts++;
    const cafe = String(r.cells.C).trim();
    stats.cafes[cafe] = (stats.cafes[cafe] || 0) + 1;
    const tone = String(r.cells.L || "").trim();
    if (tone === "긍정") stats.pos++;
    else if (tone === "부정") stats.neg++;
    else if (tone === "중립") stats.neu++;
    if (typeof r.cells.N === "number") raises.push(r.cells.N);
  }
  stats.raiseAvg = raises.length ? Math.round(raises.reduce((a, b) => a + b, 0) / raises.length) : null;
  if (wb.sheetNames().includes("댓글")) {
    Object.assign(stats, { comments: 0, cRel: 0, cNeg: 0, cBlame: 0 });
    for (const r of await wb.readRows("댓글")) {
      if (r.r <= 3 || r.cells.K === undefined) continue;
      stats.comments++;
      if (String(r.cells.L || "").trim() === "O") stats.cRel++;
      const t = String(r.cells.M || "").trim();
      if (t === "부정") stats.cNeg++;
      if (t === "단순비난") stats.cBlame++;
    }
  }
  return { summary: `글 ${stats.posts.toLocaleString()}개 · 긍정 ${stats.pos} · 중립 ${stats.neu} · 부정 ${stats.neg}`, stats };
}

function setInfo(text, cls = "") {
  $("#dbInfo").textContent = text;
  $("#dbInfo").className = `summary ${cls}`;
}

// 그 파일의 건수와 바로 전 기록 대비 증감 (rows: 최신순) - 항목마다 한 줄: 이름 · 숫자 · 증감
function fillCounts(td, kind, rows, i) {
  for (const [field, label] of COUNT_FIELDS[kind]) {
    const v = rows[i].stats?.[field];
    if (v === undefined || v === null) continue;
    const prev = rows.slice(i + 1).find((r) => r.stats?.[field] !== undefined && r.stats?.[field] !== null);
    const d = { today: v, prev: prev ? prev.stats[field] : null, prevDate: prev?.date || null, diff: prev ? v - prev.stats[field] : null };
    const line = document.createElement("div");
    line.className = "cnt";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    const n = document.createElement("b");
    n.textContent = `${v.toLocaleString()}건`;
    line.append(k, n, diffBadge(d));
    td.append(line);
  }
  if (!td.childNodes.length) td.textContent = "-";
}

// 내용: 건수 · 여론 · 비용 · 시간을 작은 상자(칩)로
function fillChips(td, kind, rec) {
  const st = rec.stats;
  const chips = !st
    ? [[rec.summary || "-", ""]]
    : [
      [`글 ${(st.posts ?? 0).toLocaleString()}`, "main"],
      ...Object.entries(st.cafes || {}).map(([c, n]) => [`${c} ${n.toLocaleString()}`, n ? "" : "zero"]),
      [`긍정 ${(st.pos ?? 0).toLocaleString()}`, "ok"], [`중립 ${(st.neu ?? 0).toLocaleString()}`, ""], [`부정 ${(st.neg ?? 0).toLocaleString()}`, "warn"],
    ];
  if (st && typeof st.raiseAvg === "number") chips.push([`예상 인상 폭 평균 ${st.raiseAvg.toLocaleString()}만 원`, "main"]);
  if (st && typeof st.comments === "number") {
    chips.push([`댓글 ${st.comments.toLocaleString()} (가격 관련 ${(st.cRel ?? 0).toLocaleString()})`, "main"]);
    chips.push([`댓글 부정 ${(st.cNeg ?? 0).toLocaleString()} · 단순비난 ${(st.cBlame ?? 0).toLocaleString()}`, "warn"]);
  }
  if (st?.period) chips.push([`기간 ${st.period}`, ""]);
  // 이 파일에 든 글들에 쓴 AI 비용 (글마다 실제 사용량으로 나눠 붙인 것 + 여론 변화 보고)
  if (st && st.aiCost > 0) chips.push([`AI 비용 ${fmtWon(st.aiCost)}${st.posts ? ` · 글당 ${fmtWon(st.aiCost / st.posts)}` : ""}`, "cost"]);
  // 소요 시간 (찾기·본문 읽기·AI·보고 쓰기 누적)
  if (st?.time) {
    const t = timeText(st.time);
    if (t.total) chips.push([`소요 시간 ${t.text}${st.posts ? ` · 글당 ${fmtSec(t.total / st.posts)}` : ""}`, "cost"]);
  }
  const box = document.createElement("div");
  box.className = "chips";
  for (const [text, cls] of chips) {
    const c = document.createElement("span");
    c.className = `chip ${cls}`;
    c.textContent = text;
    box.append(c);
  }
  td.append(box);
}

async function renderFiles(kind) {
  const tbody = document.querySelector(`section[data-kind="${kind}"] tbody`);
  tbody.innerHTML = "";
  const rows = await dbList(kind);
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="5" class="hint">아직 저장된 파일이 없습니다. 게시물 수집 화면에서 엑셀을 받으면 자동으로 저장됩니다.</td></tr>`;
    return;
  }
  rows.forEach((rec, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="c-date"><div class="d"></div></td><td class="c-file"><div class="fname"></div><div class="meta"></div></td>` +
      `<td class="c-sum"></td><td class="counts"></td>` +
      `<td class="c-act"><button class="small get">받기</button><button class="small up">수정본 올리기</button><button class="small danger del">삭제</button></td>`;
    tr.querySelector(".d").textContent = prettyDate(rec.date);
    if (i === 0) {
      tr.className = "final";
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = "최종";
      tr.children[0].append(pill);
    }
    tr.querySelector(".fname").textContent = rec.name;
    tr.querySelector(".meta").textContent = `${new Date(rec.savedAt).toLocaleString()} · ${rec.source === "upload" ? "직접 올림" : "자동 저장"}`;
    fillChips(tr.children[2], kind, rec);
    fillCounts(tr.children[3], kind, rows, i);
    tr.querySelector(".get").addEventListener("click", async () => {
      prepareFolder();
      setInfo(`✔ ${await saveBytes(rec.bytes, rec.name)}에 ${rec.name} 을(를) 저장했습니다.`, "ok");
    });
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
  const s = await chrome.storage.local.get(["priceItems", "priceClubIds", "priceAiSpend", "priceTime", "priceReport"]).catch(() => ({}));
  const items = s.priceItems || [];
  const checked = items.filter((x) => x.checked);
  const spent = s.priceAiSpend;
  const t = timeText(s.priceTime || {});
  const lines = [
    ["찾은 글", `${items.length.toLocaleString()}개`],
    ["체크한 글 (수집)", `${checked.length.toLocaleString()}개`],
    ["본문 읽음", `${items.filter((x) => x.bodyRead).length.toLocaleString()}개 (체크한 글 중 ${checked.filter((x) => x.bodyRead).length.toLocaleString()}개)`],
    ["요약 씀", `${checked.filter((x) => x.summary).length.toLocaleString()}개 (AI ${checked.filter((x) => x.by === "ai").length} · 규칙 ${checked.filter((x) => x.by === "rule").length})`],
    ["여론 변화 보고", s.priceReport?.at ? `${new Date(s.priceReport.at).toLocaleString()} 작성` : "아직 없음"],
    ["AI 누적 비용", spent ? `${fmtWon(spent.won)} · 입력 ${spent.input.toLocaleString()} · 출력 ${spent.output.toLocaleString()} 토큰 (요약·보고 모두, 지운 글 포함)` : "아직 기록 없음"],
    ["누적 소요 시간", t.total ? `${t.text}${checked.length ? ` · 체크한 글당 ${fmtSec(t.total / checked.length)}` : ""}` : "아직 기록 없음"],
    ["알아낸 카페 번호", `${Object.keys(s.priceClubIds || {}).length}곳`],
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
    // 수정본: 건수만 새로 세고, 그 파일에 쓴 비용·시간 기록은 그대로 둔다
    await dbSaveDay(kind, date, file.name, bytes, "upload", summary, stats);
    setInfo(`✔ ${prettyDate(date)} ${DB_KINDS[kind].short} 파일을 ${file.name}(으)로 ${pickFor.date ? "바꿨습니다" : "등록했습니다"} (${summary}).`, "ok");
  } catch (e) {
    setInfo(`파일을 올리지 못했습니다: ${e.message}`, "err");
  }
  pickFor = null;
  render();
}

async function backup() {
  const s = await chrome.storage.local.get(BACKUP_KEYS).catch(() => ({}));
  const data = {};
  for (const k of BACKUP_KEYS) if (s[k] !== undefined) data[k] = s[k];
  const out = { app: "mx5fl-price", version: chrome.runtime.getManifest().version, at: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const where = await saveBytes(blob, `${today()}_MX5FL_가격여론_작업데이터_백업.json`);
  setInfo(`✔ ${where}에 작업 데이터 백업 파일을 저장했습니다 (찾은 글 ${(data.priceItems || []).length.toLocaleString()}개).`, "ok");
}

async function restore(file) {
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    if (json.app !== "mx5fl-price" || !json.data) throw new Error("이 프로그램의 백업 파일이 아닙니다.");
    const n = (json.data.priceItems || []).length;
    if (!(await askConfirm(`백업(${new Date(json.at).toLocaleString()} · 찾은 글 ${n.toLocaleString()}개)으로 지금 작업 데이터를 바꿀까요?\n지금 찾은 글·요약은 백업 내용으로 바뀝니다. (받은 엑셀 목록·API 키는 그대로)`))) return;
    const set = {};
    for (const k of BACKUP_KEYS) if (json.data[k] !== undefined) set[k] = json.data[k];
    await chrome.storage.local.set(set);
    await chrome.storage.local.remove("resume_price").catch(() => {});
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
$("#backup").addEventListener("click", () => (prepareFolder(), backup()));
$("#restore").addEventListener("click", () => {
  $("#restoreFile").value = "";
  $("#restoreFile").click();
});
$("#restoreFile").addEventListener("change", (e) => restore(e.target.files[0]));
render();
