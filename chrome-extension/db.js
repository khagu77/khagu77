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
  return rawSummary(wb);
}

function setInfo(text, cls = "") {
  $("#dbInfo").textContent = text;
  $("#dbInfo").className = `summary ${cls}`;
}

// 그날 수집 건수와 바로 전 기록일 대비 증감 (rows: 최신순)
function fillCounts(td, kind, rows, i) {
  // 합계(게시물)와 채널별 증감을 같은 비교 날짜로 (채널별 증감을 더하면 합계 증감)
  const { total, channels } = statDiffs(kind, rows, i);
  if (total) {
    const line = document.createElement("div");
    line.append(`게시물 ${total.today.toLocaleString()}건 `, diffBadge(total));
    td.append(line);
  }
  for (const c of channels) {
    const line = document.createElement("div");
    line.append(channelChip(c.label), ` ${c.d.today.toLocaleString()}건 `, diffBadge(c.d));
    td.append(line);
  }
  if (!td.childNodes.length) td.textContent = "-";
}

async function render() {
  for (const sec of document.querySelectorAll("section[data-kind]")) {
    const kind = sec.dataset.kind;
    const tbody = sec.querySelector("tbody");
    tbody.innerHTML = "";
    const rows = await dbList(kind);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="hint">아직 저장된 파일이 없습니다. [파일 등록]으로 지금까지의 최종 파일을 넣거나, 수집 후 엑셀을 받으면 자동으로 저장됩니다.</td></tr>`;
      continue;
    }
    rows.forEach((rec, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="nowrap"></td><td></td><td></td><td class="counts"></td><td class="saved"></td>` +
        `<td class="acts"><button class="small get">받기</button><button class="small up">수정본 올리기</button><button class="small danger del">삭제</button></td>`;
      tr.children[0].textContent = prettyDate(rec.date) + (i === 0 ? " · 최종" : "");
      tr.dataset.date = rec.date;
      if (i === 0) tr.className = "final";
      tr.children[1].textContent = rec.name;
      tr.children[2].replaceChildren(...summaryNodes(rec.summary));
      tr.children[2].className = "sum";
      fillCounts(tr.children[3], kind, rows, i);
      // 저장: 날짜 / 시각 / 자동 저장·직접 올림 을 줄마다 (칸을 좁혀 수집 건수 칸을 넓게)
      const at = new Date(rec.savedAt);
      const h = at.getHours();
      tr.children[4].textContent =
        `${prettyDate(`${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`)}\n` +
        `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${pad(at.getMinutes())}\n${rec.source === "upload" ? "직접 올림" : "자동 저장"}`;
      // 버튼만 고른다 (전일 대비 ▲ 표시도 'up' 이름을 써서 '.up' 만 쓰면 그 표시에 붙어 버튼이 안 눌렸음)
      tr.querySelector("button.get").addEventListener("click", () => downloadBytes(rec.bytes, rec.name));
      tr.querySelector("button.up").addEventListener("click", () => {
        pickFor = { kind, date: rec.date };
        $("#picker").value = "";
        $("#picker").click();
      });
      tr.querySelector("button.del").addEventListener("click", async () => {
        if (!confirm(`${prettyDate(rec.date)} ${DB_KINDS[kind].short} 파일(${rec.name})을 최종 DB에서 지울까요?`)) return;
        await dbDelete(rec.key);
        setInfo(`${prettyDate(rec.date)} 파일을 지웠습니다.`);
        render();
      });
      tbody.appendChild(tr);
    });
  }
  if (typeof renderDash === "function") renderDash(); // 맨 위 '오늘의 대시보드'도 새 숫자로
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
    // 댓글 raw data: 유튜브 건수는 시트 전체라 올린 파일에서 다시 셈 (다른 채널 건수는 그날 수집한 그대로)
    const stats = kind === "raw" ? { youtube: await youtubeRowCount(bytes) } : null;
    await dbSaveDay(kind, date, file.name, bytes, "upload", summary, stats && stats.youtube != null ? stats : null);
    const msg = `✔ ${prettyDate(date)} ${DB_KINDS[kind].short}을(를) ${file.name}(으)로 ${pickFor.date ? "바꿨습니다" : "등록했습니다"}`;
    setInfo(`${msg} (${summary.replace(/\n/g, " ")}).`, "ok");
    pickFor = null;
    await render();
    flashRow(kind, date, msg);
    return;
  } catch (e) {
    setInfo(`파일을 올리지 못했습니다: ${e.message}`, "err");
    $("#dbInfo").scrollIntoView({ block: "center" });
  }
  pickFor = null;
  render();
}

// 올린 댓글 raw data 의 유튜브 시트 줄 수 (머리글 빼고)
async function youtubeRowCount(bytes) {
  try {
    const wb = await XlsxTemplate.Workbook.open(bytes);
    if (!wb.sheetNames().includes("유튜브")) return null;
    return (await wb.readRows("유튜브")).filter((r) => r.r > 1 && Object.values(r.cells).some((v) => v !== undefined && v !== "")).length;
  } catch {
    return null;
  }
}

// 방금 올린 줄을 화면 가운데로 가져와 잠깐 강조하고, 파일 이름 아래에 안내
function flashRow(kind, date, msg) {
  const tr = [...document.querySelectorAll(`section[data-kind=${kind}] tbody tr`)].find((x) => x.dataset.date === date);
  if (!tr) return;
  const note = document.createElement("div");
  note.className = "hint ok";
  note.textContent = msg;
  tr.children[1].append(note);
  tr.classList.add("flash");
  tr.scrollIntoView({ block: "center" });
  setTimeout(() => tr.classList.remove("flash"), 2500);
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
// 예전 모양('동호회 마지막 연번 …')의 댓글 raw data 기록은 채널별 마지막 연번으로 한 번 바꿔 둔다
refreshRawSummaries().then((n) => n && render());
