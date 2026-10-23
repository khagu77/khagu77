// 데이터 DB 화면: 받은 엑셀(날짜별) 목록 · 받기 · 수정본 올리기 · 삭제 · 등록, 작업 데이터 백업 받기·불러오기

const KINDS = ["seatFinal", "seat", "seatRaw"]; // 최종 파일 · 1차 검수 · 로우 엑셀
const CAR_CODES = ["LX3", "ME1", "MX5"];
// 백업에 넣는 작업 데이터 (API 키는 넣지 않음)
const BACKUP_KEYS = ["seatItems", "seatClubIds", "seatSettings", "seatCars"];
let pickFor = null; // { kind, date|null }
// 종류별로 보여줄 건수
// (최종 데이터의 '온라인 동향 N' = 일일 온라인 동향에 보고되지 않은 글 수)
const COUNT_FIELDS = {
  seatFinal: [["posts", "최종 글"], ["missing", "온라인 동향 N"]],
  seat: [["posts", "글"], ["missing", "온라인 동향 N"]],
  seatRaw: [["posts", "찾은 글"], ["checked", "체크"]],
};

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
  const stats = { posts: 0, missing: 0, nn: 0, ny: 0, yy: 0, yn: 0, LX3: 0, ME1: 0, MX5: 0, relHigh: 0 };
  const rels = [];
  for (const r of rows) {
    if (r.r <= 3 || r.cells.C === undefined) continue;
    stats.posts++;
    const car = String(r.cells.C).trim().toUpperCase();
    if (car in stats) stats[car]++;
    const yn = String(r.cells.I || "").replace(/\s+/g, "").toUpperCase(); // "N/Y"
    if (yn.startsWith("N")) stats.missing++;
    const code = yn.replace("/", "").toLowerCase();
    if (code in stats) stats[code]++;
    // K 주제 관련도: 숫자 0.85(백분율 서식) 또는 예전 글자 "85%"
    const k = r.cells.K;
    const rel = typeof k === "number" ? Math.round(k <= 1 ? k * 100 : k) : parseInt(String(k ?? "").replace("%", ""), 10);
    if (Number.isFinite(rel)) {
      rels.push(rel);
      if (rel >= 70) stats.relHigh++;
    }
  }
  stats.relAvg = rels.length ? Math.round(rels.reduce((a, b) => a + b, 0) / rels.length) : null;
  const summary = `글 ${stats.posts.toLocaleString()}개 · ${CAR_CODES.map((c) => `${c} ${stats[c].toLocaleString()}`).join(" · ")} · N/N ${stats.nn} · N/Y ${stats.ny} · Y/Y ${stats.yy}`;
  return { summary, stats };
}

function setInfo(text, cls = "") {
  $("#dbInfo").textContent = text;
  $("#dbInfo").className = `summary ${cls}`;
}

// 그 파일의 글 수와 바로 전 기록 대비 증감 (rows: 최신순) - 항목마다 한 줄: 이름 · 숫자 · 증감
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

// 내용: 건수를 작은 상자(칩)로
function fillChips(td, kind, rec) {
  const st = rec.stats;
  const chips = !st
    ? [[rec.summary || "-", ""]]
    : kind === "seatRaw"
      ? [[`찾은 글 ${(st.posts ?? 0).toLocaleString()}`, "main"], [`체크 ${(st.checked ?? 0).toLocaleString()}`, ""]]
      : [[`글 ${(st.posts ?? 0).toLocaleString()}`, "main"], ...CAR_CODES.map((c) => [`${c} ${(st[c] ?? 0).toLocaleString()}`, (st[c] ?? 0) ? "" : "zero"]),
        // 포함 여부(온라인동향 / 로데이터)별 건수 - 예전 기록은 '온라인 동향 N' 건수만
        ...(st.nn !== undefined
          ? [[`N/N ${st.nn.toLocaleString()}`, "warn"], [`N/Y ${(st.ny ?? 0).toLocaleString()}`, "warn"], [`Y/Y ${(st.yy ?? 0).toLocaleString()}`, "ok"]]
          : [[`온라인 동향 N ${(st.missing ?? 0).toLocaleString()}`, "warn"]])];
  // 주제 관련도: 평균 · 70% 이상 건수 (최종 검수한 글)
  if (st && typeof st.relAvg === "number") chips.push([`관련도 평균 ${st.relAvg}% · 70%↑ ${(st.relHigh ?? 0).toLocaleString()}`, st.relAvg >= 70 ? "warn" : "ok"]);
  if (st && kind === "seatFinal" && st.from) chips.push([`체크한 글 ${st.from.toLocaleString()}개 중`, ""]);
  // 이 파일에 든 글들에 쓴 AI 비용 (글마다 실제 사용량으로 나눠 붙인 것의 합)
  if (st && st.aiCost > 0) {
    chips.push([`AI 비용 ${fmtWon(st.aiCost)}${st.posts ? ` · 글당 ${fmtWon(st.aiCost / st.posts)}` : ""}`, "cost"]);
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
  const s = await chrome.storage.local.get(["seatItems", "seatClubIds", "seatCompare", "seatAiSpend", "aiModel"]).catch(() => ({}));
  const items = s.seatItems || [];
  const checked = items.filter((x) => x.checked);
  const userFiles = (s.seatCompare || []).filter((f) => !f.builtin);
  const lines = [
    ["찾은 글", `${items.length.toLocaleString()}개 (${CAR_CODES.map((c) => `${c} ${items.filter((x) => x.car === c).length}`).join(" · ")})`],
    ["체크한 글", `${checked.length.toLocaleString()}개`],
    ["본문 읽음", `${checked.filter((x) => x.bodyRead).length.toLocaleString()}개`],
    ["요약 씀", `${checked.filter((x) => x.summary).length.toLocaleString()}개 (AI ${checked.filter((x) => x.by === "ai").length} · 규칙 ${checked.filter((x) => x.by === "rule").length})`],
    ["AI 누적 비용 (기록)", s.seatAiSpend
      ? `${fmtWon(s.seatAiSpend.won)} · 입력 ${s.seatAiSpend.input.toLocaleString()} · 출력 ${s.seatAiSpend.output.toLocaleString()} 토큰 (1.0.8 부터 실제 사용량 · 1차 검토·요약 모두, 지운 글 포함)`
      : "아직 기록 없음 (1.0.8 부터 AI 를 쓸 때마다 기록)"],
    ["기록 전 사용분 (추정)", (() => {
      const e = estimateUntrackedWon(items, s.aiModel || "claude-opus-5-5");
      return e.posts ? `${fmtWon(e.won)} · 글 ${e.posts.toLocaleString()}개 (비용 기록 전에 AI 로 1차 검토·요약한 글 - 실제 청구액은 console.anthropic.com → Usage)` : "없음";
    })()],
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
  const where = await saveBytes(blob, `${today()}_전동시트_위험상황_작업데이터_백업.json`);
  setInfo(`✔ ${where}에 작업 데이터 백업 파일을 저장했습니다 (찾은 글 ${(data.seatItems || []).length.toLocaleString()}개).`, "ok");
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
$("#backup").addEventListener("click", () => (prepareFolder(), backup()));
$("#restore").addEventListener("click", () => {
  $("#restoreFile").value = "";
  $("#restoreFile").click();
});
$("#restoreFile").addEventListener("change", (e) => restore(e.target.files[0]));
render();
