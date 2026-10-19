// 최종 DB 화면: 종류별로 날짜마다 최종 파일 목록 · 받기 · 수정본 올리기 · 삭제 · 처음 등록

let pickFor = null; // { kind, date|null }

// 올린 파일이 그 종류의 양식인지 확인하고 요약 글자를 만든다
async function summarize(kind, bytes) {
  const wb = await XlsxTemplate.Workbook.open(bytes);
  const names = wb.sheetNames();
  if (kind === "buzz") {
    const sheet = names.includes("채널별 버즈량 현황") ? "채널별 버즈량 현황" : names[0];
    let last = 0;
    let count = 0;
    for (const r of await wb.readRows(sheet)) {
      if (r.r <= 3) continue;
      const n = Number(r.cells.B);
      if (Number.isFinite(n) && r.cells.B !== undefined) {
        last = Math.max(last, n);
        count++;
      }
    }
    if (!count) throw new Error(`'${sheet}' 시트 B열(순번)에 숫자가 없습니다. 게시물 리스트 파일이 맞는지 확인해 주세요.`);
    return `${count.toLocaleString()}행 · 마지막 순번 ${last.toLocaleString()}`;
  }
  for (const need of ["동호회", "유튜브"]) {
    if (!names.includes(need)) throw new Error(`'${need}' 시트가 없습니다. 댓글 raw data 파일이 맞는지 확인해 주세요.`);
  }
  let last = 0;
  for (const r of await wb.readRows("동호회")) {
    const n = Number(r.cells.A);
    if (r.r > 1 && Number.isFinite(n) && r.cells.A !== undefined) last = Math.max(last, n);
  }
  return `동호회 마지막 연번 ${last.toLocaleString()}`;
}

function setInfo(text, cls = "") {
  $("#dbInfo").textContent = text;
  $("#dbInfo").className = `summary ${cls}`;
}

async function render() {
  for (const sec of document.querySelectorAll("section[data-kind]")) {
    const kind = sec.dataset.kind;
    const tbody = sec.querySelector("tbody");
    tbody.innerHTML = "";
    const rows = await dbList(kind);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="hint">아직 저장된 파일이 없습니다. [파일 등록]으로 지금까지의 최종 파일을 넣거나, 수집 후 엑셀을 받으면 자동으로 저장됩니다.</td></tr>`;
      continue;
    }
    rows.forEach((rec, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="nowrap"></td><td></td><td></td><td class="nowrap"></td>` +
        `<td class="nowrap"><button class="small get">받기</button> <button class="small up">수정본 올리기</button> <button class="small danger del">삭제</button></td>`;
      tr.children[0].textContent = prettyDate(rec.date) + (i === 0 ? " · 최종" : "");
      if (i === 0) tr.className = "final";
      tr.children[1].textContent = rec.name;
      tr.children[2].textContent = rec.summary || "";
      tr.children[3].textContent = `${new Date(rec.savedAt).toLocaleString()} · ${rec.source === "upload" ? "직접 올림" : "자동 저장"}`;
      tr.querySelector(".get").addEventListener("click", () => downloadBytes(rec.bytes, rec.name));
      tr.querySelector(".up").addEventListener("click", () => {
        pickFor = { kind, date: rec.date };
        $("#picker").value = "";
        $("#picker").click();
      });
      tr.querySelector(".del").addEventListener("click", async () => {
        if (!confirm(`${prettyDate(rec.date)} ${DB_KINDS[kind].short} 파일(${rec.name})을 최종 DB에서 지울까요?`)) return;
        await dbDelete(rec.key);
        setInfo(`${prettyDate(rec.date)} 파일을 지웠습니다.`);
        render();
      });
      tbody.appendChild(tr);
    });
  }
  try {
    const est = await navigator.storage.estimate();
    $("#usage").textContent = `이 PC 크롬에 저장된 크기: 약 ${(est.usage / 1e6).toFixed(1)} MB (확장프로그램을 삭제하면 함께 지워집니다).`;
  } catch {
    /* 무시 */
  }
}

async function onPicked(file) {
  if (!file || !pickFor) return;
  const { kind } = pickFor;
  const date = pickFor.date || dateFromName(file.name);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const summary = await summarize(kind, bytes);
    const existing = (await dbList(kind)).find((r) => r.date === date);
    if (!pickFor.date && existing && !confirm(`${prettyDate(date)}에 이미 파일(${existing.name})이 있습니다. 이 파일로 바꿀까요?`)) return;
    await dbSaveDay(kind, date, file.name, bytes, "upload", summary);
    setInfo(`✔ ${prettyDate(date)} ${DB_KINDS[kind].short}을(를) ${file.name}(으)로 ${pickFor.date ? "바꿨습니다" : "등록했습니다"} (${summary}).`, "ok");
  } catch (e) {
    setInfo(`파일을 올리지 못했습니다: ${e.message}`, "err");
  }
  pickFor = null;
  render();
}

for (const sec of document.querySelectorAll("section[data-kind]")) {
  sec.querySelector(".register").addEventListener("click", () => {
    pickFor = { kind: sec.dataset.kind, date: null };
    $("#picker").value = "";
    $("#picker").click();
  });
}
$("#picker").addEventListener("change", (e) => onPicked(e.target.files[0]));
render();
