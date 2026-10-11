// 스크립트 AI 검열 - 스크립트 분석 엑셀(예: '스크립트 RAW' 시트)에서 G열이 '해당없음'이 아닌 행의
// F열 스크립트("[0:00] 내용" 줄들)를 기본 규칙 교정 + AI(Claude) 교정한 뒤, 원래 파일 이름_modify.xlsx 로 받는다.
// 엑셀은 template.js 로 그대로 열어 F열 셀 글자만 바꾼다(다른 열·시트·서식 유지).

const SKIP_LABEL = "해당없음";
const TS_LINE = /^(\s*\[\d{1,2}(?::\d{2}){1,2}\]\s*)(.*)$/; // "[0:00] 내용" / "[1:02:03] 내용"
const ROW_PARALLEL = 3; // 동시에 검토하는 행 수 (각 행의 묶음 요청은 ai-correct.js 가 전체 동시 요청 수를 다시 묶음)

let source = null; // { name, bytes, sheet, targets: [{ r, label, title, script }], skipped }
let output = null; // { bytes, name }
let running = false;
let stopRequested = false;

function hasScriptLines(text) {
  return String(text || "").split(/\r?\n/).some((l) => TS_LINE.test(l));
}

// 시트 고르기: '스크립트 RAW' 가 있으면 그것, 없으면 F열에 "[0:00]" 스크립트가 있는 첫 시트
async function pickSheet(wb) {
  const names = wb.sheetNames();
  if (names.includes("스크립트 RAW")) return names.find((n) => n === "스크립트 RAW");
  for (const n of names) {
    const rows = await wb.readRows(n);
    if (rows.some((row) => hasScriptLines(row.cells.F))) return n;
  }
  return null;
}

async function loadFile(f) {
  source = null;
  output = null;
  $("#saveModify").disabled = true;
  $("#start").disabled = true;
  $("#progress tbody").innerHTML = "";
  $("#progress").hidden = true;
  setSummary("");
  const info = $("#fileInfo");
  if (!f) {
    info.textContent = "";
    return;
  }
  info.className = "hint";
  info.textContent = "파일 읽는 중…";
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const wb = await XlsxTemplate.Workbook.open(bytes);
    const sheet = await pickSheet(wb);
    if (!sheet) throw new Error("F열에 '[0:00] 내용' 형식의 스크립트가 있는 시트를 찾지 못했습니다");
    const rows = await wb.readRows(sheet);
    const targets = [];
    const skipped = { none: 0, noScript: 0 };
    for (const row of rows) {
      const label = String(row.cells.G ?? "").trim();
      if (!hasScriptLines(row.cells.F)) {
        if (row.cells.F !== undefined || label) skipped.noScript++;
        continue;
      }
      if (label === SKIP_LABEL) {
        skipped.none++;
        continue;
      }
      const title = [row.cells.B, row.cells.C].filter((v) => v !== undefined && v !== "").join(" · ");
      targets.push({ r: row.r, label, title, script: String(row.cells.F) });
    }
    source = { name: f.name, bytes, sheet, targets, skipped };
    const chars = targets.reduce((n, t) => n + t.script.length, 0);
    info.className = targets.length ? "hint ok" : "hint err";
    info.textContent =
      `✔ '${sheet}' 시트: 검토 대상 ${targets.length}행 (G열 '해당없음' ${skipped.none}행, 스크립트가 없는 행 ${skipped.noScript}행 제외) · ` +
      `글자 수 약 ${chars.toLocaleString()}자 · 받을 파일: ${modifyName(f.name)}`;
    for (const t of targets) addRow(t);
    $("#progress").hidden = !targets.length;
    $("#start").disabled = !targets.length;
  } catch (e) {
    info.className = "hint err";
    info.textContent = `파일을 읽지 못했습니다: ${e.message}`;
  }
}

function modifyName(name) {
  return /\.xlsx$/i.test(name) ? name.replace(/\.xlsx$/i, "_modify.xlsx") : `${name}_modify.xlsx`;
}

function addRow(t) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td></td><td class="url"></td><td></td><td class="status">대기</td>`;
  tr.children[0].textContent = t.r;
  tr.children[1].textContent = t.title || "";
  tr.children[2].textContent = t.label || "(비어 있음)";
  $("#progress tbody").appendChild(tr);
  t.tr = tr;
}

// F열 스크립트 하나: 시간 표시([0:00])는 떼어 두고 글자만 교정한 뒤 다시 붙인다.
async function correctScript(script, settings, onProgress) {
  const parts = script.split(/\r?\n/).map((line) => {
    const m = line.match(TS_LINE);
    return m ? { pre: m[1], text: m[2] } : { pre: "", text: line };
  });
  const idx = parts.map((p, i) => (p.text.trim() ? i : -1)).filter((i) => i >= 0);
  const basic = idx.map((i) => ScriptCorrect.correctText(parts[i].text).text);
  const res = await aiCorrectLines(basic, { apiKey: settings.key, model: settings.model, onProgress });
  idx.forEach((i, k) => (parts[i].text = res.lines[k]));
  return { text: parts.map((p) => p.pre + p.text).join("\n"), failed: res.failed, lastError: res.lastError };
}

async function runPool(items, size, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length && !stopRequested) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

function costLine(chars) {
  return AI_MODELS.map(([id, label]) => `· ${label.split(" (")[0]}: 약 ${aiCostEstimateWon(chars, id).toLocaleString()}원`).join("\n");
}

async function start() {
  if (!source || running) return;
  const settings = { key: $("#aiKey").value.trim(), model: $("#aiModel").value };
  if (!settings.key) return setSummary("Anthropic API 키를 넣어 주세요.", "err");
  const chars = source.targets.reduce((n, t) => n + t.script.length, 0);
  const modelLabel = (AI_MODELS.find(([id]) => id === settings.model) || ["", settings.model])[1];
  const ok = confirm(
    `${source.targets.length}행, 약 ${chars.toLocaleString()}자를 '${modelLabel}'(으)로 검토합니다.\n\n` +
      `예상 요금 (대략적인 추정):\n${costLine(chars)}\n\n계속할까요?`,
  );
  if (!ok) return;

  running = true;
  stopRequested = false;
  output = null;
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#saveModify").disabled = true;
  $("#reviewFile").disabled = true;
  const updates = {};
  const count = { ok: 0, partial: 0, fail: 0 };
  let finished = 0;

  await runPool(source.targets, ROW_PARALLEL, async (t) => {
    const status = t.tr.querySelector(".status");
    const set = (text, cls = "") => {
      status.textContent = text;
      status.className = `status ${cls}`;
    };
    set("AI 검토 중…");
    try {
      const res = await correctScript(t.script, settings, (done, total) => set(`AI 검토 중… (${done} / ${total}줄)`));
      updates[`F${t.r}`] = res.text;
      if (res.failed) {
        count.partial++;
        set(`완료 (${res.failed}줄은 원래대로: ${aiErrorMessage(res.lastError)})`, "ok");
      } else {
        count.ok++;
        set("완료", "ok");
      }
    } catch (e) {
      count.fail++;
      set(`실패: ${aiErrorMessage(e)} (원래 스크립트 유지)`, "err");
    }
    finished++;
    setSummary(`AI 검토 중… (${finished} / ${source.targets.length}행)`);
  });

  const stopped = stopRequested;
  try {
    const wb = await XlsxTemplate.Workbook.open(source.bytes);
    await wb.setCellTexts(source.sheet, updates);
    output = { bytes: await wb.save(), name: modifyName(source.name) };
    $("#saveModify").disabled = false;
    const done = count.ok + count.partial;
    setSummary(
      `${stopped ? "중지됨 - " : ""}${done} / ${source.targets.length}행 교정` +
        (count.fail ? ` · 실패 ${count.fail}행(원래 스크립트 유지)` : "") +
        `. '_modify 파일 받기'로 내려받으세요.`,
      count.fail ? "" : "ok",
    );
    alert(
      `스크립트 AI 검토를 ${stopped ? "중지했습니다" : "마쳤습니다"}.\n\n교정 ${done}행` +
        (count.partial ? `(일부 줄만 교정 ${count.partial}행)` : "") +
        (count.fail ? ` · 실패 ${count.fail}행` : "") +
        `\n\n'_modify 파일 받기' 버튼으로 ${output.name} 을(를) 받으세요.`,
    );
  } catch (e) {
    setSummary(`엑셀 파일을 만들지 못했습니다: ${e.message}`, "err");
  }
  running = false;
  $("#start").disabled = false;
  $("#stop").disabled = true;
  $("#reviewFile").disabled = false;
}

function download() {
  if (!output) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([output.bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = output.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function init() {
  menu("review.html");
  const sel = $("#aiModel");
  for (const [id, label] of AI_MODELS) sel.add(new Option(label, id));
  const saved = await chrome.storage.local.get(["aiKey", "aiModel"]).catch(() => ({}));
  $("#aiKey").value = saved.aiKey || "";
  if (saved.aiModel && AI_MODELS.some(([id]) => id === saved.aiModel)) sel.value = saved.aiModel;
  const save = () => chrome.storage.local.set({ aiKey: $("#aiKey").value.trim(), aiModel: sel.value }).catch(() => {});
  $("#aiKey").addEventListener("input", save);
  sel.addEventListener("change", save);
  $("#reviewFile").addEventListener("change", (e) => loadFile(e.target.files[0]));
  $("#start").addEventListener("click", start);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 검토 중인 행까지 마칩니다)");
  });
  $("#saveModify").addEventListener("click", download);
}

init();
