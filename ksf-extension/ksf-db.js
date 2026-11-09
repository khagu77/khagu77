// 데이터 DB 화면: 맨 위 대시보드(dashboard.js) · 날짜별 파일(받기 · 수정본 올리기 · 삭제) · 작업 데이터 백업 받기·불러오기

const KINDS = ["summary", "posts", "postsSenti", "comments", "commentsSenti", "ppt", "summaryText"];
const BACKUP_KEYS = ["ksfItems", "ksfClubIds", "ksfSettings", "ksfStart", "ksfEnd", "ksfTops", "ksfAiSpend", "ksfDashLive"];
const COUNT_FIELDS = [["posts", "게시글"], ["comments", "댓글"], ["reactions", "반응"]];
let pickFor = null; // { kind, date }

function setInfo(text, cls = "") {
  $("#dbInfo").textContent = text;
  $("#dbInfo").className = `summary ${cls}`;
}

function countsCell(td, rows, i) {
  const st = rows[i].stats || {};
  for (const [f, label] of COUNT_FIELDS) {
    if (typeof st[f] !== "number") continue;
    const prev = rows.slice(i + 1).find((r) => typeof r.stats?.[f] === "number");
    const d = { today: st[f], prev: prev ? prev.stats[f] : null, prevDate: prev?.date || null, diff: prev ? st[f] - prev.stats[f] : null };
    const line = document.createElement("div");
    line.className = "cnt";
    line.append(Object.assign(document.createElement("span"), { className: "k", textContent: label }), Object.assign(document.createElement("b"), { textContent: `${st[f].toLocaleString()}건` }), diffBadge(d));
    td.append(line);
  }
  if (st.ratio) {
    const neg = (st.ratio["부정"] || 0) + (st.ratio["단순비난"] || 0);
    td.append(Object.assign(document.createElement("div"), { className: "hint", textContent: `긍정 ${(st.ratio["긍정"] * 100).toFixed(1)}% · 부정 여론 ${(neg * 100).toFixed(1)}%` }));
  }
  if (!td.childNodes.length) td.textContent = "-";
}

async function render() {
  const all = (await Promise.all(KINDS.map((k) => dbList(k).catch(() => [])))).flat();
  const dates = [...new Set(all.map((r) => r.date))].sort((a, b) => b.localeCompare(a));
  const sums = (await dbList("summary").catch(() => [])).filter((r) => r.stats?.kind === "dash");
  const tbody = $("#days tbody");
  tbody.innerHTML = "";
  if (!dates.length) tbody.innerHTML = `<tr class="empty"><td colspan="3" class="hint">아직 저장된 파일이 없습니다. 수집 화면에서 [엑셀 만들기]를 누르면 자동으로 저장됩니다.</td></tr>`;
  dates.forEach((date, di) => {
    const tr = document.createElement("tr");
    if (di === 0) tr.className = "final";
    tr.innerHTML = `<td class="c-date"><div class="d"></div></td><td class="c-files"></td><td class="counts"></td>`;
    tr.querySelector(".d").textContent = prettyDate(date);
    if (di === 0) tr.children[0].append(Object.assign(document.createElement("span"), { className: "pill", textContent: "최종" }));
    for (const kind of KINDS) {
      const rec = all.find((r) => r.kind === kind && r.date === date);
      const line = document.createElement("div");
      line.className = "fileline";
      line.append(Object.assign(document.createElement("span"), { className: "k", textContent: DB_KINDS[kind].short }));
      if (rec) {
        const name = Object.assign(document.createElement("span"), { className: "fname", textContent: rec.name, title: `${new Date(rec.savedAt).toLocaleString()} · ${rec.source === "upload" ? "직접 올림" : "자동 저장"}${rec.summary ? ` · ${rec.summary}` : ""}` });
        const get = Object.assign(document.createElement("button"), { className: "small", textContent: "받기" });
        get.addEventListener("click", async () => {
          prepareFolder();
          const data = kind === "ppt" ? new Blob([rec.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })
            : kind === "summaryText" ? new Blob(["\ufeff", rec.bytes], { type: "text/plain;charset=utf-8" }) : rec.bytes;
          setInfo(`✔ ${await saveBytes(data, rec.name)}에 ${rec.name} 을(를) 저장했습니다.`, "ok");
        });
        const up = Object.assign(document.createElement("button"), { className: "small", textContent: "수정본 올리기" });
        up.addEventListener("click", () => {
          pickFor = { kind, date };
          $("#picker").value = "";
          $("#picker").click();
        });
        const del = Object.assign(document.createElement("button"), { className: "small danger", textContent: "삭제" });
        del.addEventListener("click", async () => {
          if (!(await askConfirm(`${prettyDate(date)} ${DB_KINDS[kind].short} 파일(${rec.name})을 데이터 DB에서 지울까요?`))) return;
          await dbDelete(rec.key);
          setInfo(`${prettyDate(date)} ${DB_KINDS[kind].short} 파일을 지웠습니다.`);
          render();
        });
        if (rec.source === "upload") name.append(Object.assign(document.createElement("span"), { className: "chip", textContent: "수정본" }));
        line.append(name, get, up, del);
      } else {
        line.append(Object.assign(document.createElement("span"), { className: "hint", textContent: "없음" }));
      }
      tr.children[1].append(line);
    }
    const si = sums.findIndex((r) => r.date === date);
    if (si >= 0) countsCell(tr.children[2], sums, si);
    else tr.children[2].textContent = "-";
    tbody.append(tr);
  });
  await renderWork();
  await renderDash();
  try {
    const est = await navigator.storage.estimate();
    $("#usage").textContent = `이 PC 크롬에 저장된 크기: 약 ${(est.usage / 1e6).toFixed(1)} MB (확장프로그램을 삭제하면 함께 지워집니다).`;
  } catch {
    /* 무시 */
  }
}

async function renderWork() {
  const s = await chrome.storage.local.get(["ksfItems", "ksfClubIds", "ksfAiSpend", "ksfTops"]).catch(() => ({}));
  const items = s.ksfItems || [];
  const checked = items.filter((x) => x.checked);
  const comments = checked.reduce((n, x) => n + (x.commentList || []).length, 0);
  const aiC = checked.reduce((n, x) => n + (x.commentList || []).filter((c) => c.a?.by === "ai").length, 0);
  const spent = s.ksfAiSpend;
  const lines = [
    ["찾은 글", `${items.length.toLocaleString()}개 (체크 ${checked.length.toLocaleString()}개)`],
    ["본문·댓글 읽음", `체크한 글 중 ${checked.filter((x) => x.bodyRead).length.toLocaleString()}개 · 댓글 ${comments.toLocaleString()}개`],
    ["AI 판단", `글 ${checked.filter((x) => x.a?.by === "ai").length.toLocaleString()}개 · 댓글 ${aiC.toLocaleString()}개`],
    ["주요 내용 TOP5", s.ksfTops?.at ? `${new Date(s.ksfTops.at).toLocaleString()} AI 정리` : "아직 AI 정리 전"],
    ["AI 누적 비용", spent ? `${fmtWon(spent.won)} · 입력 ${spent.input.toLocaleString()} · 출력 ${spent.output.toLocaleString()} 토큰` : "아직 기록 없음"],
    ["알아낸 카페 번호", `${Object.keys(s.ksfClubIds || {}).length}곳`],
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

async function onPicked(file) {
  if (!file || !pickFor) return;
  const { kind, date } = pickFor;
  try {
    const ext = kind === "ppt" ? ".pptx" : kind === "summaryText" ? ".txt" : ".xlsx";
    if (!file.name.toLowerCase().endsWith(ext)) throw new Error(`${ext} 파일을 골라 주세요.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind !== "summaryText") await Zip.read(bytes); // 깨진 파일인지 확인
    // 수정본: 파일만 바꾸고, 대시보드 숫자(stats)는 그대로 둔다
    await dbSaveDay(kind, date, file.name, bytes, "upload", "담당자 수정본", null);
    // PPT 수정본: 수집 화면의 SUMMARY 를 이 PPT 기준으로 다시 만들도록 (수집 화면이 열려 있으면 바로 · 아니면 다음에 열 때)
    if (kind === "ppt") {
      const st = await chrome.storage.local.get("ksfSettings").catch(() => ({}));
      const cars = [...new Set(String(st.ksfSettings?.cafeList || "아반떼 | |\n그랜저 | |\n싼타페 | |").split(/\r?\n/).map((l) => l.split("|")[0].trim()).filter(Boolean))];
      const data = await PptFill.read(bytes, cars);
      await chrome.storage.local.set({ ksfPptRev: { name: file.name, data, at: Date.now() } });
    }
    if (kind === "summaryText") await chrome.storage.local.set({ ksfSummaryText: new TextDecoder().decode(bytes).replace(/^\ufeff/, ""), ksfSummaryAt: Date.now() });
    setInfo(`✔ ${prettyDate(date)} ${DB_KINDS[kind].short} 파일을 ${file.name}(으)로 바꿨습니다.${kind === "ppt" ? " SUMMARY 는 이 PPT 수정본 기준으로 다시 만들어집니다 (수집 화면 ⑤탭)." : ""}`, "ok");
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
  const out = { app: "ksf-monitor", version: chrome.runtime.getManifest().version, at: new Date().toISOString(), data };
  const where = await saveBytes(new Blob([JSON.stringify(out)], { type: "application/json" }), `${today()}_코세페반응_작업데이터_백업.json`);
  setInfo(`✔ ${where}에 작업 데이터 백업 파일을 저장했습니다 (찾은 글 ${(data.ksfItems || []).length.toLocaleString()}개).`, "ok");
}

async function restore(file) {
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    if (json.app !== "ksf-monitor" || !json.data) throw new Error("이 프로그램의 백업 파일이 아닙니다.");
    const n = (json.data.ksfItems || []).length;
    if (!(await askConfirm(`백업(${new Date(json.at).toLocaleString()} · 찾은 글 ${n.toLocaleString()}개)으로 지금 작업 데이터를 바꿀까요?\n(받은 파일 목록·API 키는 그대로)`))) return;
    const set = {};
    for (const k of BACKUP_KEYS) if (json.data[k] !== undefined) set[k] = json.data[k];
    await chrome.storage.local.set(set);
    await chrome.storage.local.remove("resume_ksf").catch(() => {});
    setInfo(`✔ 백업을 불러왔습니다 (찾은 글 ${n.toLocaleString()}개).`, "ok");
  } catch (e) {
    setInfo(`백업을 불러오지 못했습니다: ${e.message}`, "err");
  }
  render();
}

$("#ver").textContent = `v${chrome.runtime.getManifest().version}`;
$("#picker").addEventListener("change", (e) => onPicked(e.target.files[0]));
$("#backup").addEventListener("click", () => (prepareFolder(), backup()));
$("#restore").addEventListener("click", () => {
  $("#restoreFile").value = "";
  $("#restoreFile").click();
});
$("#restoreFile").addEventListener("change", (e) => restore(e.target.files[0]));
// 수집 화면에서 엑셀을 새로 만들면 바로 반영
chrome.storage.onChanged.addListener((ch) => {
  if ((ch.ksfDashLive && dashMode === "live") || ch.ksfPptRev) renderDash();
});
window.addEventListener("focus", render);
render();
