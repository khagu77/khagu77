// 온라인 오전동향 PPT 보고서 작성기 - 작업 화면
// 엑셀(+ 표시 행) → 카페 글 캡처 → AI 요약 → 미리보기에서 확인·수정 → PPT 받기

const ARTICLE_DELAY = [4000, 8000]; // 글과 글 사이 쉬는 시간 (사람처럼 천천히)
const DEFAULT_IMAGES = 4; // 처음에 체크해 두는 본문 이미지 수

// 차종 코드 → 차명 (작성 가이드 부록 + 기존 보고서)
const MODEL_NAMES = {
  "NE N": "아이오닉5 N", NE: "아이오닉5", CE: "아이오닉6", ME1: "아이오닉9",
  TM: "싼타페", MX5: "싼타페", NX4: "투싼", IG: "그랜저", GN7: "그랜저", QX: "베뉴",
  JW: "GV60", JK: "GV70", JX: "GV80", IK: "G70", RG3: "G80", RS4: "G90",
  DN8: "쏘나타", CN7: "아반떼", CN8: "아반떼", FE: "넥쏘", AX: "캐스퍼", SX2: "코나", OS: "코나",
  LX2: "팰리세이드", LX3: "팰리세이드", US4: "스타리아", ST1: "ST1", HR: "포터", ST: "스타렉스",
};
const EV_ONLY = new Set(["NE", "CE", "ME1", "JW", "ST1"]);
const SPEC_WORDS = ["FCEV", "PHEV", "HEV", "EV"];

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let excelItems = [];
let items = [];
let stopRequested = false;
let plan = { all: true };

// ---------------------------------------------------------------------------
// 차종·제원
// ---------------------------------------------------------------------------
function splitCar(car) {
  const parts = String(car || "").trim().split(/\s+/).filter(Boolean);
  let spec = "";
  if (parts.length > 1 && SPEC_WORDS.includes(parts[parts.length - 1].toUpperCase())) spec = parts.pop().toUpperCase();
  const code = parts.join(" ");
  if (!spec && EV_ONLY.has(parts[0])) spec = "EV";
  return { code, spec: spec || "-" };
}

function modelName(car) {
  const parts = String(car || "").trim().split(/\s+/);
  return MODEL_NAMES[parts.slice(0, 2).join(" ")] || MODEL_NAMES[parts[0]] || parts[0] || "";
}

function isCafeUrl(url) {
  return /^https?:\/\/((m\.)?cafe\.naver\.com|naver\.me)\//i.test(url.trim());
}

// ---------------------------------------------------------------------------
// 설정 (이 PC 크롬에만 저장)
// ---------------------------------------------------------------------------
async function loadSettings() {
  for (const [id, label] of AI_MODELS) $("#aiModel").add(new Option(label, id));
  const s = await chrome.storage.local.get(["aiKey", "aiModel", "fileName", "ppi", "templateName", "templateSavedAt"]).catch(() => ({}));
  if (s.ppi) $("#ppi").value = String(s.ppi);
  const c = await chrome.storage.local.get(["countAll", "countTotal", "countMine", "countPart"]).catch(() => ({}));
  if (c.countPart === "front") document.querySelector('input[name="countPart"][value="front"]').checked = true;
  if (c.countAll === false) $("#countAll").checked = false;
  if (c.countTotal) $("#countTotal").value = c.countTotal;
  if (c.countMine) $("#countMine").value = c.countMine;
  for (const el of ["#countAll", "#countTotal", "#countMine"]) $(el).addEventListener("input", updateCountUi);
  document.querySelectorAll('input[name="countPart"]').forEach((el) => el.addEventListener("change", updateCountUi));
  updateCountUi();
  $("#aiKey").value = s.aiKey || "";
  if (s.aiModel && AI_MODELS.some(([id]) => id === s.aiModel)) $("#aiModel").value = s.aiModel;
  if (s.fileName) $("#fileName").value = s.fileName;
  showTemplateInfo(s.templateName, s.templateSavedAt);
  for (const el of ["#aiKey", "#aiModel", "#fileName", "#ppi"]) {
    $(el).addEventListener("change", () =>
      chrome.storage.local.set({
        aiKey: $("#aiKey").value.trim(),
        aiModel: $("#aiModel").value,
        fileName: $("#fileName").value.trim(),
        ppi: $("#ppi").value,
      }),
    );
  }
  if (!s.templateName) $("#settings").open = true;
  updateSettingsState();
}

function showTemplateInfo(name, at) {
  $("#templateInfo").textContent = name ? `저장된 템플릿: ${name} (${at || ""})` : "아직 템플릿이 없습니다. 완성된 보고서 PPT 를 한 번 넣어 주세요.";
  $("#templateInfo").className = name ? "hint ok" : "hint err";
}

async function updateSettingsState() {
  const s = await chrome.storage.local.get(["templateName"]).catch(() => ({}));
  const parts = [s.templateName ? "템플릿 있음" : "템플릿 없음", $("#aiKey").value.trim() ? "AI 요약 켜짐" : "AI 요약 꺼짐(API 키 없음)"];
  $("#settingsState").textContent = `— ${parts.join(" · ")}`;
}

function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function onTemplateFile() {
  const file = $("#templateFile").files[0];
  if (!file) return;
  const u8 = new Uint8Array(await file.arrayBuffer());
  try {
    const files = await Zip.read(u8);
    if (!files.has("ppt/presentation.xml")) throw new Error("PPT 파일이 아닙니다");
  } catch (e) {
    $("#templateInfo").textContent = `템플릿을 읽지 못했습니다: ${e.message}`;
    $("#templateInfo").className = "hint err";
    return;
  }
  const at = new Date().toLocaleString("ko-KR");
  await chrome.storage.local.set({ templateB64: toBase64(u8), templateName: file.name, templateSavedAt: at });
  showTemplateInfo(file.name, at);
  updateSettingsState();
  refreshButtons();
}

async function loadTemplate() {
  const s = await chrome.storage.local.get(["templateB64"]);
  if (!s.templateB64) throw new Error("설정에서 보고서 템플릿 PPT 를 먼저 넣어 주세요");
  return fromBase64(s.templateB64);
}

// ---------------------------------------------------------------------------
// 엑셀
// ---------------------------------------------------------------------------
async function onExcelFile() {
  const file = $("#excelFile").files[0];
  if (!file) return;
  try {
    const { items: marked, total, sheets } = await Excel.readMarked(new Uint8Array(await file.arrayBuffer()));
    excelItems = marked;
    // '총 N개' 는 + 표시 개수로 채워 둔다 (작성 개수만 정하면 되게)
    if (marked.length) {
      $("#countTotal").value = String(Math.min(12, marked.length));
      if (Number($("#countMine").value) > marked.length) $("#countMine").value = String(Math.min(12, marked.length));
      updateCountUi();
    }
    $("#excelInfo").textContent =
      `전체 ${total}건 중 + 표시 ${marked.length}건` +
      (marked.length ? `: ${marked.map((m) => m.car || "?").join(", ")}` : " (+ 표시된 행이 없습니다)") +
      (sheets.length > 1 ? ` · 시트 ${sheets.join(", ")}` : "");
    $("#excelInfo").className = marked.length ? "hint ok" : "hint err";
  } catch (e) {
    excelItems = [];
    $("#excelInfo").textContent = `엑셀을 읽지 못했습니다: ${e.message}`;
    $("#excelInfo").className = "hint err";
  }
  refreshButtons();
}

// 작성 개수: 전체 / 총 N칸 중 마지막 K칸 작성 (앞 칸은 연번만 있는 빈 칸)
function countPlan() {
  if ($("#countAll").checked) return { all: true };
  const total = Math.min(12, Math.max(1, Number($("#countTotal").value) || 1));
  const mine = Math.min(total, Math.max(1, Number($("#countMine").value) || 1));
  const part = document.querySelector('input[name="countPart"]:checked')?.value === "front" ? "front" : "back";
  return { all: false, total, mine, part, startNo: part === "front" ? 1 : total - mine + 1 };
}

function updateCountUi() {
  const plan = countPlan();
  $("#countOpts").classList.toggle("off", plan.all);
  $("#countHint").textContent = plan.all
    ? ""
    : `→ 요약표 ${plan.total}칸. + 글 중 ${plan.part === "front" ? "앞" : "뒤"}에서 ${plan.mine}개를 ` +
      `${plan.startNo}~${plan.startNo + plan.mine - 1}번으로 작성` +
      (plan.part === "front"
        ? plan.mine < plan.total ? `, ${plan.mine + 1}~${plan.total}번은 연번만 있는 빈 칸` : ""
        : plan.startNo > 1 ? `, 1~${plan.startNo - 1}번은 연번만 있는 빈 칸` : "") +
      (excelItems.length && excelItems.length !== plan.total ? ` (엑셀 + 표시는 ${excelItems.length}개)` : "");
  chrome.storage.local
    .set({
      countAll: $("#countAll").checked,
      countTotal: $("#countTotal").value,
      countMine: $("#countMine").value,
      countPart: countPlan().part || "back",
    })
    .catch(() => {});
}

function refreshButtons(running = false) {
  $("#start").disabled = running || !excelItems.length;
  $("#stop").disabled = !running;
  $("#build").disabled = running || !items.some((it) => it.ready);
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

// ---------------------------------------------------------------------------
// 게시물 처리: 캡처 → 이미지 다듬기 → AI 요약
// ---------------------------------------------------------------------------
async function processCaptures(cap) {
  const v = { header: null, body: null, comments: [], images: [] };
  const dpr = cap.dpr;
  // 제목 영역은 모양 그대로(줄 간격을 줄이지 않음) — 작성자 아이콘이 잘리지 않게
  if (cap.header) v.header = ImageProc.compactText(await ImageProc.toBitmap(cap.header), dpr, { collapse: false });
  if (cap.body) v.body = ImageProc.compactText(await ImageProc.toBitmap(cap.body), dpr);
  for (const b of cap.comments) v.comments.push(b ? ImageProc.compactText(await ImageProc.toBitmap(b), dpr) : null);
  for (const b of cap.images) v.images.push(b ? ImageProc.photo(await ImageProc.toBitmap(b), dpr, !!b.isOriginal) : null);
  for (const x of [v.header, v.body, ...v.comments, ...v.images]) if (x) x.url = await ImageProc.previewUrl(x.canvas);
  return v;
}

function fieldsFrom(row, info, ai) {
  // 제원: 엑셀 차종에 EV/HEV 표기가 있거나 전기차 전용 모델이면 그 값, 아니면 AI 가 게시글·작성자 인증글에서 확인한 값, 없으면 '-'
  const { code, spec: carSpec } = splitCar(row.car);
  const spec = carSpec !== "-" ? carSpec : ai.spec || "-";
  return {
    title: `${modelName(row.car)}(${row.car}) ${ai.issue}`.trim(),
    code,
    spec,
    kind: row.kind || "품질",
    level: ai.level || "주의",
    progress: "초기",
    cafe: row.cafe,
    url: info?.canonicalUrl || row.url, // naver.me 등은 https://cafe.naver.com/카페주소/글번호 로 통일
    views: info?.views || "",
    commentCount: info?.commentCount || "",
    body: ai.body,
    reaction: ai.reaction,
    short: ai.short,
    duplicate: ai.duplicate,
    region: ai.region || "-",
    focus: "-",
  };
}

async function processItem(it) {
  it.ready = false;
  it.deleted = false;
  it.error = "";
  const row = it.row;
  let info = null;
  if (isCafeUrl(row.url)) {
    setItemStatus(it, "캡처 준비");
    try {
      const cap = await captureCafePost(row.url, (step) => setItemStatus(it, step));
      info = cap.info;
      setItemStatus(it, "이미지 다듬는 중");
      it.visuals = await processCaptures(cap);
    } catch (e) {
      if (e instanceof DeletedPostError) {
        // 삭제된 게시물은 보고서에 넣지 않는다
        it.deleted = true;
        it.ready = true;
        renderItem(it);
        setItemStatus(it, "삭제된 게시물 — 보고서에서 제외", "err");
        return;
      }
      it.error = `캡처 실패: ${e.message || e}`;
      it.visuals = { header: null, body: null, comments: [], images: [] };
    }
  } else {
    it.error = "네이버 카페 글이 아니라 캡처하지 않았습니다(텍스트만)";
    it.visuals = { header: null, body: null, comments: [], images: [] };
  }
  it.info = info;

  const key = $("#aiKey").value.trim();
  let ai;
  if (key && info) {
    setItemStatus(it, "AI 요약 중");
    try {
      // 같은 보고서에서 앞서 쓴 본문 요약을 알려 주어 끝맺음이 겹치지 않게
      const recentBodies = items.filter((x) => x !== it && x.ready && !x.deleted && x.fields).map((x) => x.fields.body);
      ai = await aiSummarize(row, info, { apiKey: key, model: $("#aiModel").value, recentBodies });
    } catch (e) {
      it.error = [it.error, `AI 요약 실패: ${aiErrorMessage(e)} (엑셀 내용으로 초안)`].filter(Boolean).join(" · ");
      ai = excelDraft(row, info);
    }
  } else {
    ai = excelDraft(row, info);
  }
  it.fields = fieldsFrom(row, info, ai);
  it.noReaction = !!info && !(info.comments || []).length;
  it.sel = {
    header: true,
    body: true,
    comments: new Set(ai.comment_picks || []),
    images: new Set(it.visuals.images.map((_, i) => i).filter((i) => it.visuals.images[i]).slice(0, DEFAULT_IMAGES)),
  };
  it.ready = true;
  renderItem(it);
  setItemStatus(it, it.error ? "완료(확인 필요)" : "완료", it.error ? "err" : "ok");
}

async function start() {
  stopRequested = false;
  plan = countPlan();
  items = excelItems.map((row) => ({ no: null, row, ready: false }));
  $("#items").innerHTML = "";
  for (const it of items) renderItem(it);
  refreshButtons(true);
  // 'N개 중 K개 작성': 뒷부분이면 + 글 중 뒤에서 K개를 (N−K+1)~N번으로, 앞부분이면 앞에서 K개를 1~K번으로.
  // 나머지 글은 다른 담당자 몫이라 열지 않는다
  const mine = plan.all ? items : plan.part === "front" ? items.slice(0, plan.mine) : items.slice(-plan.mine);
  for (const it of items) {
    if (!mine.includes(it)) {
      it.skipped = true;
      setItemStatus(it, "작성 안 함 (다른 담당자 몫)");
    }
  }
  const need = mine.length;
  let nextNo = plan.all ? 1 : plan.startNo;
  let done = 0;
  let written = 0;
  for (const it of mine) {
    if (stopRequested) break;
    setSummary(`처리 중… ${done} / ${need}건`);
    await processItem(it);
    done++;
    if (!it.deleted) {
      // 전체: 삭제 글을 빼고 1번부터 이어서 / N개 중 K개: + 글 순서 그대로의 번호 (삭제 글 자리는 빈 칸)
      it.no = plan.all ? nextNo++ : plan.startNo + mine.indexOf(it);
      written++;
      renderItem(it);
      setItemStatus(it, it.error ? "완료(확인 필요)" : "완료", it.error ? "err" : "ok");
    }
    const next = mine[mine.indexOf(it) + 1];
    if (next && isCafeUrl(next.row.url) && !stopRequested) {
      await sleep(ARTICLE_DELAY[0] + Math.random() * (ARTICLE_DELAY[1] - ARTICLE_DELAY[0]));
    }
  }
  const failed = items.filter((it) => it.error).length;
  const deleted = items.filter((it) => it.deleted).length;
  setSummary(
    stopRequested ? `중지했습니다 (${done} / ${items.length}). 끝난 글로 PPT 를 받을 수 있습니다.` : `완료: ${items.filter((it) => it.ready && !it.deleted).length}건${deleted ? ` (삭제된 게시물 ${deleted}건 제외)` : ""}${failed ? ` · 확인 필요 ${failed}건` : ""}. 내용을 확인한 뒤 [PPT 받기]를 누르세요.`,
    failed ? "err" : "ok",
  );
  refreshButtons(false);
}

// ---------------------------------------------------------------------------
// 미리보기 카드
// ---------------------------------------------------------------------------
const FIELD_DEFS = [
  ["title", "페이지 제목", "text", "■ 뒤에 들어갈 '차명(모델명) 증상'"],
  ["url", "게시글 위치", "text", "https://cafe.naver.com/카페주소/글번호"],
  ["code", "차종", "text"],
  ["spec", "제원", "text"],
  ["level", "불만 구분", "select", ["주의", "경고", "심각"]],
  ["progress", "경과", "select", ["초기", "진행", "타결"]],
  ["views", "조회수", "text"],
  ["commentCount", "댓글수", "text"],
  ["body", "본문 요약", "textarea", `첫 줄을 꽉 채우게 (${BODY_MIN}~${BODY_MAX}자)`, BODY_MAX],
  ["reaction", "댓글 반응", "textarea", `한 줄 (최대 ${REACTION_MAX}자). 비우면 '댓글 반응 없음'(댓글이 없을 때) 또는 확인 필요`, REACTION_MAX],
  ["short", "요약표 내용", "text"],
  ["duplicate", "신규/중복", "text", "예: 신규, 중복 2건"],
  ["region", "입고/운행지역", "text", "본문에 명시된 경우만 (예: 부산 사상구)"],
  ["focus", "집중관리고객", "text"],
];

function setItemStatus(it, text, cls = "") {
  const el = it.el && $(".status", it.el);
  if (el) {
    el.textContent = text + (it.error && it.ready ? ` — ${it.error}` : "");
    el.className = `status ${cls}`;
  }
}

function renderItem(it) {
  if (!it.el) {
    it.el = document.createElement("section");
    it.el.className = "item";
    $("#items").appendChild(it.el);
  }
  const head = `<div class="item-head"><span class="no">${it.no ? `No.${it.no}` : ""}</span><span>${esc(it.row.car)} · ${esc(it.row.cafe)}</span>
    <a href="${esc(it.row.url)}" target="_blank" rel="noopener">${esc(it.row.url)}</a><span class="status">대기</span></div>`;
  if (!it.ready || it.deleted) {
    it.el.innerHTML = head + `<div class="hint">${esc(it.row.main)}</div>`;
    if (it.deleted) it.el.classList.add("deleted");
    return;
  }
  it.el.classList.remove("deleted");
  const f = it.fields;
  const fields = FIELD_DEFS.map(([k, label, type, extra, max]) => {
    const v = esc(f[k] ?? "");
    let input;
    if (type === "select") input = `<select data-k="${k}">${extra.map((o) => `<option${o === f[k] ? " selected" : ""}>${o}</option>`).join("")}</select>`;
    else if (type === "textarea") input = `<textarea data-k="${k}" rows="2" placeholder="${esc(extra || "")}">${v}</textarea>`;
    else input = `<input type="text" data-k="${k}" value="${v}" placeholder="${esc(extra || "")}">`;
    const cnt = max ? ` <span class="cnt" data-for="${k}" data-max="${max}"></span>` : "";
    return `<label>${label}${cnt}</label>${input}`;
  }).join("");

  const v = it.visuals;
  const shot = (kind, i, x, label, checked, cls = "") =>
    x
      ? `<label class="shot ${cls}${checked ? "" : " off"}"><span><input type="checkbox" data-kind="${kind}" data-i="${i}"${checked ? " checked" : ""}> ${esc(label)}</span><img src="${x.url}"></label>`
      : "";
  const comments = (it.info?.comments || [])
    .map((c, i) => (v.comments[i] ? shot("comment", c.index, v.comments[i], `${c.hasSticker ? "[이모티콘] " : ""}${c.text.slice(0, 40)}`, it.sel.comments.has(c.index)) : ""))
    .join("");
  const images = v.images.map((x, i) => shot("image", i, x, `이미지 ${i + 1}`, it.sel.images.has(i), "images")).join("");
  const shots = `<div class="shots">
    ${v.header || v.body ? `<h4>제목·본문 캡처</h4>${shot("header", 0, v.header, "제목", it.sel.header)}${shot("body", 0, v.body, "본문", it.sel.body)}` : ""}
    ${comments ? `<h4>댓글 캡처 (대댓글·작성자 댓글 제외 · 추천 2개 체크됨)</h4>${comments}` : ""}
    ${images ? `<h4>본문 첨부 이미지</h4>${images}` : ""}
  </div>`;

  it.el.innerHTML = head + `<div class="item-body"><div class="fields">${fields}</div>
    <div class="preview"><canvas width="600" height="415"></canvas><div class="buttons"><button data-act="retry">다시 캡처·요약</button></div></div></div>` + shots;

  // 내용 요약은 2줄 엄수: 본문 요약·댓글 반응 글자 수를 보여 주고 넘으면 빨갛게
  const updateCount = (k) => {
    const c = $(`.cnt[data-for="${k}"]`, it.el);
    if (!c) return;
    const n = (it.fields[k] || "").length;
    c.textContent = `${n}/${c.dataset.max}`;
    c.classList.toggle("err", n > Number(c.dataset.max));
  };
  for (const el of it.el.querySelectorAll("[data-k]")) {
    updateCount(el.dataset.k);
    el.addEventListener("input", () => {
      it.fields[el.dataset.k] = el.value.replace(/\n/g, " ");
      updateCount(el.dataset.k);
    });
  }
  for (const el of it.el.querySelectorAll("input[data-kind]")) {
    el.addEventListener("change", () => {
      const { kind, i } = el.dataset;
      if (kind === "header" || kind === "body") it.sel[kind] = el.checked;
      else {
        const set = kind === "comment" ? it.sel.comments : it.sel.images;
        el.checked ? set.add(Number(i)) : set.delete(Number(i));
      }
      el.closest(".shot").classList.toggle("off", !el.checked);
      drawPreview(it);
    });
  }
  $('[data-act="retry"]', it.el).addEventListener("click", async () => {
    refreshButtons(true);
    await processItem(it);
    refreshButtons(false);
  });
  drawPreview(it);
}

function selectedVisuals(it) {
  const v = it.visuals;
  const commentIdx = (it.info?.comments || []).map((c, i) => [c.index, i]).filter(([ci]) => it.sel.comments.has(ci)).map(([, i]) => i);
  return {
    header: it.sel.header ? v.header : null,
    body: it.sel.body ? v.body : null,
    comments: commentIdx.map((i) => v.comments[i]).filter(Boolean),
    images: [...it.sel.images].sort((a, b) => a - b).map((i) => v.images[i]).filter(Boolean),
  };
}

// 슬라이드 모양 미리보기 (안내선 + 캡처 배치)
function drawPreview(it) {
  const canvas = $(".preview canvas", it.el);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = 9906000;
  const H = 6858000;
  const s = canvas.width / W;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#c8ccd2";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const g = Layout.G;
  for (const x of [g.xText, g.xBody, g.xRight, g.xImg, g.xImgR]) {
    ctx.beginPath();
    ctx.moveTo(x * s, 0);
    ctx.lineTo(x * s, canvas.height);
    ctx.stroke();
  }
  for (const y of [g.yTop, g.yImg, g.yBottom]) {
    ctx.beginPath();
    ctx.moveTo(0, y * s);
    ctx.lineTo(canvas.width, y * s);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "#1b1d21";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(`■ ${it.fields.title}`.slice(0, 48), 404327 * s, 420000 * s);
  ctx.fillStyle = "#f1f2f4";
  ctx.fillRect(343851 * s, 653393 * s, 9228818 * s, (g.yTop - 653393 - 60000) * s);
  const { placements } = Layout.layout(selectedVisuals(it));
  for (const p of placements) {
    const src = p.item.canvas;
    const sh = p.crop && p.crop < 1 ? src.height * p.crop : src.height;
    ctx.drawImage(src, 0, 0, src.width, sh, p.x * s, p.y * s, p.w * s, p.h * s);
    ctx.strokeStyle = { header: "#5b9bd5", body: "#ed7d31", comment: "#70ad47", image: "#e00000" }[p.kind];
    ctx.strokeRect(p.x * s, p.y * s, p.w * s, p.h * s);
  }
}

// ---------------------------------------------------------------------------
// PPT 만들기
// ---------------------------------------------------------------------------
async function pictures(it) {
  const { placements } = Layout.layout(selectedVisuals(it));
  const out = [];
  for (const p of placements) {
    let item = p.item;
    let h = p.h;
    if (p.crop && p.crop < 1) {
      item = ImageProc.cropHeight(item, Math.floor(item.canvas.height * p.crop));
      h = (p.w * item.canvas.height) / item.canvas.width;
    }
    const isPhoto = p.kind === "image";
    const ppi = Number($("#ppi").value) || 330;
    const enc = await ImageProc.encodeAtPpi(item.canvas, p.w / Layout.CM, h / Layout.CM, { ppi, type: isPhoto ? "image/jpeg" : "image/png" });
    out.push({ blob: enc.blob, ext: isPhoto ? "jpeg" : "png", x: p.x, y: p.y, w: p.w, h, name: "그림" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 저장 폴더 (내가 고른 폴더에 바로 저장) — 크롬 확장은 경로 글자로는 저장할 수 없어서
// 폴더 선택 창으로 한 번 고르고, 그 폴더 정보를 이 PC 크롬(IndexedDB)에 기억해 둔다.
// ---------------------------------------------------------------------------
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
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
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

function showFolder(handle) {
  $("#folderInfo").textContent = handle ? `📁 ${handle.name} 에 저장` : "다운로드 폴더에 저장";
  $("#folderInfo").className = handle ? "hint ok" : "hint";
}

async function pickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ id: "report-out", mode: "readwrite", startIn: "desktop" });
    await kvSet("saveDir", handle);
    showFolder(handle);
  } catch (e) {
    if (e && e.name !== "AbortError") setSummary(`폴더를 고르지 못했습니다: ${e.message || e}`, "err");
  }
}

// 고른 폴더에 쓸 수 있는지 확인 (크롬을 다시 켠 뒤에는 한 번 허용을 물어봄 — 버튼을 누른 직후에만 가능)
async function saveDirIfAllowed() {
  const handle = await kvGet("saveDir");
  if (!handle) return null;
  try {
    let p = await handle.queryPermission({ mode: "readwrite" });
    if (p !== "granted") p = await handle.requestPermission({ mode: "readwrite" });
    return p === "granted" ? handle : null;
  } catch {
    return null;
  }
}

function reportDate() {
  const v = $("#reportDate").value;
  const [y, m, d] = v ? v.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
  return { y, m, d };
}

async function buildPpt() {
  $("#build").disabled = true;
  // 저장 폴더 허용 확인은 버튼을 누른 바로 그때 해야 해서 맨 먼저
  const saveDir = await saveDirIfAllowed();
  try {
    setSummary("PPT 만드는 중…");
    const template = await loadTemplate();
    const ready = items.filter((it) => it.ready && !it.deleted && it.no);
    if (!ready.length) throw new Error("보고서에 넣을 게시물이 없습니다(모두 삭제된 게시물)");
    const list = [];
    for (const it of ready) list.push({ ...it.fields, no: it.no, noReaction: it.noReaction, pictures: await pictures(it) });
    const { y, m, d } = reportDate();
    const startNo = plan.all ? 1 : plan.startNo;
    const totalRows = plan.all ? list.length : plan.total;
    const bytes = await Pptx.build(template, { dateText: `${y}.${pad(m)}.${pad(d)}`, items: list, startNo, totalRows });
    const name = ($("#fileName").value.trim() || "{날짜}_현대차 온라인 이슈 보고서").replace("{날짜}", `${String(y).slice(2)}${pad(m)}${pad(d)}`);
    const fileName = `${name.replace(/[<>:"/\\|?*]/g, "_")}.pptx`;
    const size = `${list.length}건, ${(bytes.length / 1024 / 1024).toFixed(1)}MB`;
    if (saveDir) {
      try {
        const fh = await saveDir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
        setSummary(`저장했습니다: 📁 ${saveDir.name}/${fileName} (${size})`, "ok");
        return;
      } catch (e) {
        setSummary(`고른 폴더에 저장하지 못해 다운로드 폴더로 받습니다 (${e.message || e})`, "err");
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSummary(`저장했습니다: 다운로드 폴더/${fileName} (${size})`, "ok");
  } catch (e) {
    setSummary(`PPT 를 만들지 못했습니다: ${e.message || e}`, "err");
  } finally {
    refreshButtons(false);
  }
}

// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const now = new Date();
  $("#reportDate").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  await loadSettings();
  $("#templateFile").addEventListener("change", onTemplateFile);
  $("#excelFile").addEventListener("change", onExcelFile);
  $("#aiKey").addEventListener("change", updateSettingsState);
  $("#start").addEventListener("click", start);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("지금 글까지만 끝내고 멈춥니다…");
  });
  $("#build").addEventListener("click", buildPpt);
  $("#pickFolder").addEventListener("click", pickFolder);
  $("#clearFolder").addEventListener("click", async () => {
    await kvSet("saveDir", null);
    showFolder(null);
  });
  showFolder(await kvGet("saveDir").catch(() => null));
});
