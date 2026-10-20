// 온라인 오전동향 PPT 보고서 작성기 - 작업 화면
// 엑셀(+ 표시 행) → 카페 글 캡처 → AI 요약 → 미리보기에서 확인·수정 → PPT 받기

const ARTICLE_DELAY = [4000, 8000]; // 글과 글 사이 쉬는 시간 (사람처럼 천천히)
const DEFAULT_IMAGES = 4; // 처음에 체크해 두는 본문 이미지 수

// 차종 코드 → 차명 (작성 가이드 부록 + 기존 보고서)
const MODEL_NAMES = {
  "NE N": "아이오닉5 N", NE: "아이오닉5", CE: "아이오닉6", ME1: "아이오닉9",
  TM: "싼타페", MX5: "싼타페", NX4: "투싼", IG: "그랜저", GN7: "그랜저", QX: "베뉴",
  JW: "GV60", JK: "GV70", JX: "GV80", IK: "G70", RG3: "G80", RS4: "G90",
  DN8: "쏘나타", CN7: "아반떼", CN8: "아반떼", FE: "넥쏘", NH2: "넥쏘", AX: "캐스퍼", SX2: "코나", OS: "코나",
  LX2: "팰리세이드", LX3: "팰리세이드", US4: "스타리아", ST1: "ST1", HR: "포터", ST: "스타렉스", QZ: "엑시언트",
};
const EV_ONLY = new Set(["NE", "CE", "ME1", "JW", "ST1"]);
// 수소전기차(넥쏘): 제원은 무조건 FCEV (그냥 EV 아님)
const FCEV_ONLY = new Set(["FE", "NH2"]);
const SPEC_WORDS = ["FCEV", "PHEV", "HEV", "EV"];

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let excelItems = [];
let excelAllRows = []; // RAW data 이어 쓰기용: 오늘 엑셀의 모든 행
let items = [];
let stopRequested = false;
let plan = { all: true };

// ---------------------------------------------------------------------------
// 부정 이슈 모니터링과 한 프로그램으로 합침 (이 화면은 모니터링 화면의 'PPT·RAW' 탭 안에 들어감)
// - 수집 모드 '전체': 방금 수집·검토한 결과 표(전체 엑셀)를 그대로 넘겨받아 PPT·RAW 작성
// - 수집 모드 '1인용': 결과 표는 일부 카페뿐이라 넘기지 않음 → 이 화면에서 전체(통합) 엑셀을 직접 첨부해야 작성 가능
// ---------------------------------------------------------------------------
let source = { mode: "all", kind: "", label: "" }; // kind: "results"(수집 결과) | "file"(직접 첨부) | ""
let titleByUrl = new Map(); // 수집 결과의 글 제목 (넥쏘 카페·영운모 검색 경유용, 엑셀에는 제목 열이 없음)

const normUrl = (u) => String(u || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^http:/, "https:").replace("://m.cafe.", "://cafe.").toLowerCase();

const parentApp = () => {
  try {
    return window.parent !== window ? window.parent : null;
  } catch {
    return null;
  }
};
// 모니터링 수집이 진행 중이면 PPT 캡처를 막는다 (네이버를 동시에 두 군데서 열지 않게)
const collecting = () => {
  try {
    const p = parentApp();
    return !!(p && typeof p.isCollecting === "function" && p.isCollecting());
  } catch {
    return false;
  }
};

function renderSource() {
  const solo = source.mode === "solo";
  $("#sourceMode").textContent = solo ? "1인용" : "전체";
  $("#sourceMode").className = `badge ${solo ? "solo" : "all"}`;
  $("#sourceHint").textContent = solo
    ? "1인용 수집 결과는 일부 카페뿐이라 PPT·RAW 에 쓰지 않습니다. 담당자들이 합친 전체(통합) 엑셀을 아래에 첨부해 주세요."
    : source.kind === "results"
      ? "부정 이슈 수집 결과 표(검토·수정한 그대로)를 사용합니다. 다른 엑셀로 만들려면 아래에 첨부하세요."
      : "수집 결과가 없으면 전체 엑셀을 아래에 첨부해 주세요.";
  $("#excelLabel").firstChild.textContent = solo ? "전체(통합) 엑셀 첨부 (필수) " : "다른 엑셀로 작성 (선택) ";
}

async function setSource({ mode, bytes, label, titles } = {}) {
  source.mode = mode === "solo" ? "solo" : "all";
  // API 키를 아직 안 넣었으면 모니터링 설정의 키를 다시 확인 (모니터링 설정에서 나중에 넣은 경우)
  if (!$("#aiKey").value.trim()) {
    const mon = (await chrome.storage.local.get("settings").catch(() => ({}))).settings || {};
    if (mon.apiKey) {
      $("#aiKey").value = mon.apiKey;
      if (mon.model && AI_MODELS.some(([id]) => id === mon.model)) $("#aiModel").value = mon.model;
      updateSettingsState();
    }
  }
  titleByUrl = new Map(Object.entries(titles || {}).map(([u, t]) => [normUrl(u), t]));
  if (source.mode === "solo") {
    // 1인용: 직접 첨부한 파일만 쓴다 (수집 결과에서 받은 자료는 비움)
    if (source.kind !== "file") {
      excelItems = [];
      excelAllRows = [];
      source.kind = "";
      $("#excelInfo").textContent = "전체(통합) 엑셀을 첨부해 주세요";
      $("#excelInfo").className = "hint err";
    }
  } else if (bytes && source.kind !== "file") {
    await loadExcelBytes(bytes, label || "수집 결과");
    source.kind = excelItems.length || excelAllRows.length ? "results" : "";
  }
  source.label = label || "";
  showFolder(await saveDirHandle()); // 모니터링 설정에서 바꾼 저장 폴더도 바로 반영
  renderSource();
  refreshButtons();
}
window.PptBridge = { setSource, isBusy: () => !$("#stop").disabled };

// ---------------------------------------------------------------------------
// 차종·제원
// ---------------------------------------------------------------------------
function splitCar(car) {
  const parts = String(car || "").trim().split(/\s+/).filter(Boolean);
  let spec = "";
  if (parts.length > 1 && SPEC_WORDS.includes(parts[parts.length - 1].toUpperCase())) spec = parts.pop().toUpperCase();
  const code = parts.join(" ");
  if (FCEV_ONLY.has(parts[0]) || MODEL_NAMES[parts[0]] === "넥쏘") spec = "FCEV";
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
  const s = await chrome.storage.local.get(["aiKey", "aiModel", "fileName", "rawName", "ppi", "templateName", "templateSavedAt"]).catch(() => ({}));
  if (s.rawName) $("#rawName").value = s.rawName;
  if (s.ppi) $("#ppi").value = String(s.ppi);
  const c = await chrome.storage.local.get(["countAll", "countTotal", "countMine", "countPart"]).catch(() => ({}));
  if (c.countPart === "front") document.querySelector('input[name="countPart"][value="front"]').checked = true;
  if (c.countAll === false) $("#countAll").checked = false;
  if (c.countTotal) $("#countTotal").value = c.countTotal;
  if (c.countMine) $("#countMine").value = c.countMine;
  for (const el of ["#countAll", "#countTotal", "#countMine"]) $(el).addEventListener("input", updateCountUi);
  document.querySelectorAll('input[name="countPart"]').forEach((el) => el.addEventListener("change", updateCountUi));
  updateCountUi();
  // API 키·모델: 여기서 따로 넣지 않았으면 부정 이슈 모니터링 설정의 것을 같이 쓴다
  const mon = (await chrome.storage.local.get("settings").catch(() => ({}))).settings || {};
  $("#aiKey").value = s.aiKey || mon.apiKey || "";
  const model = s.aiModel || mon.model;
  if (model && AI_MODELS.some(([id]) => id === model)) $("#aiModel").value = model;
  if (s.fileName) $("#fileName").value = s.fileName;
  showTemplateInfo(s.templateName, s.templateSavedAt);
  for (const el of ["#aiKey", "#aiModel", "#fileName", "#rawName", "#ppi"]) {
    $(el).addEventListener("change", () =>
      chrome.storage.local.set({
        aiKey: $("#aiKey").value.trim(),
        aiModel: $("#aiModel").value,
        fileName: $("#fileName").value.trim(),
        rawName: $("#rawName").value.trim(),
        ppi: $("#ppi").value,
      }),
    );
  }
  if (!s.templateName) openSettings();
  updateSettingsState();
}

function showTemplateInfo(name, at) {
  $("#templateInfo").textContent = name ? `저장된 템플릿: ${name} (${at || ""})` : "아직 템플릿이 없습니다. 완성된 보고서 PPT 를 한 번 넣어 주세요.";
  $("#templateInfo").className = name ? "hint ok" : "hint err";
}

async function updateSettingsState() {
  const s = await chrome.storage.local.get(["templateName"]).catch(() => ({}));
  const parts = [s.templateName ? "템플릿 있음" : "템플릿 없음", $("#aiKey").value.trim() ? "AI 요약 켜짐" : "AI 요약 꺼짐(API 키 없음)"];
  $("#settingsState").textContent = parts.join(" · ");
}

function openSettings() {
  const d = $("#settings");
  if (!d.open) d.showModal();
}

// ---------------------------------------------------------------------------
// 소요 시간 · 예상 AI 비용
// ---------------------------------------------------------------------------
let runStart = 0; // [캡처·요약 시작] 누른 시각
let captureMs = 0; // 캡처·요약에 걸린 시간
let statsTimer = null;

function fmtDuration(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (h) return `${h}시간 ${m}분 ${sec}초`;
  return m ? `${m}분 ${sec}초` : `${sec}초`;
}

function statsText(ms) {
  return `⏱ 소요 시간 ${fmtDuration(ms)} · 💰 예상 AI 비용 ${AiCost.text()}`;
}

function showStats() {
  if (!runStart) return;
  const el = $("#stats");
  el.hidden = false;
  el.textContent = statsText((captureMs || Date.now() - runStart));
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
  await loadExcelBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  source.kind = excelItems.length || excelAllRows.length ? "file" : "";
  renderSource();
  refreshButtons();
}

async function loadExcelBytes(bytes, label) {
  try {
    const { items: marked, total, sheets } = await Excel.readMarked(bytes);
    // 엑셀에 제목 열이 없으면 수집 결과의 글 제목으로 채운다 (네이버 검색 경유 카페용)
    for (const m of marked) if (!m.title && titleByUrl.has(normUrl(m.url))) m.title = titleByUrl.get(normUrl(m.url));
    excelItems = marked;
    excelAllRows = await Excel.readAllRows(bytes).catch(() => []);
    // '총 N개' 는 + 표시 개수로 채워 둔다 (작성 개수만 정하면 되게)
    if (marked.length) {
      $("#countTotal").value = String(Math.min(12, marked.length));
      if (Number($("#countMine").value) > marked.length) $("#countMine").value = String(Math.min(12, marked.length));
      updateCountUi();
    }
    $("#excelInfo").textContent =
      `${label ? `[${label}] ` : ""}전체 ${total}건 중 + 표시 ${marked.length}건` +
      (marked.length ? `: ${marked.map((m) => m.car || "?").join(", ")}` : " (+ 표시된 행이 없습니다)") +
      (sheets.length > 1 ? ` · 시트 ${sheets.join(", ")}` : "");
    $("#excelInfo").className = marked.length ? "hint ok" : "hint err";
  } catch (e) {
    excelItems = [];
    excelAllRows = [];
    $("#excelInfo").textContent = `엑셀을 읽지 못했습니다: ${e.message}`;
    $("#excelInfo").className = "hint err";
  }
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
  const noSource = source.mode === "solo" && source.kind !== "file"; // 1인용은 전체 엑셀을 첨부해야만
  $("#start").disabled = running || noSource || !excelItems.length;
  $("#stop").disabled = !running;
  $("#build").disabled = running || !items.some((it) => it.ready);
  $("#rawBuild").disabled = running || noSource || !excelAllRows.length;
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
  if (cap.body) {
    // 길어서 여러 장으로 나눠 찍은 본문은 위아래로 이어 붙인다
    let bodyBlob = cap.body;
    if (Array.isArray(cap.body)) {
      const parts = [];
      for (const b of cap.body) if (b) parts.push(await ImageProc.toBitmap(b));
      const W = Math.max(...parts.map((p) => p.width));
      const H = parts.reduce((s, p) => s + p.height, 0);
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W, H);
      let y = 0;
      for (const p of parts) {
        g.drawImage(p, 0, y);
        y += p.height;
      }
      bodyBlob = await c.convertToBlob({ type: "image/png" });
    }
    v.body = ImageProc.compactText(await ImageProc.toBitmap(bodyBlob), dpr);
  }
  for (const b of cap.comments) v.comments.push(b ? ImageProc.compactText(await ImageProc.toBitmap(b), dpr) : null);
  for (const [i, b] of cap.images.entries()) {
    if (!b) {
      v.images.push(null);
      continue;
    }
    const im = ImageProc.photo(await ImageProc.toBitmap(b), dpr, !!b.isOriginal);
    // 영상은 흰 여백·검은 띠를 잘라 영상 화면 폭에 딱 맞게
    v.images.push(cap.info.images[i] && cap.info.images[i].video ? ImageProc.trimBorders(im) : im);
  }
  for (const x of [v.header, v.body, ...v.comments, ...v.images]) if (x) x.url = await ImageProc.previewUrl(x.canvas);
  return v;
}

function fieldsFrom(row, info, ai) {
  // 제원: 엑셀 차종에 EV/HEV 표기가 있거나 전기차 전용 모델이면 그 값, 아니면 AI 가 게시글·작성자 인증글에서 확인한 값, 없으면 '-'
  const { code, spec: carSpec } = splitCar(row.car);
  // AI 가 비워 뒀어도 작성자 게시물 보기 등에서 찾은 제원 후보가 하나로 모이면 그 값을 쓴다
  // (작성자가 다른 차 이야기를 한 후보는 빼고: 이 글 자체·닉네임에서 찾았거나, 앞뒤 문장/글 제목에 이 차가 나온 것만)
  const carWords = [code, modelName(row.car)].filter((w) => w && w !== "-");
  const sameCar = (h) => /^(게시판명|게시글|작성자 닉네임)/.test(h.from) || carWords.some((w) => `${h.from} ${h.snippet}`.includes(w));
  const hinted = [...new Set((info.specHints || []).filter(sameCar).map((h) => h.spec))];
  const aiSpec = ai.spec && ai.spec !== "-" ? ai.spec : hinted.length === 1 ? hinted[0] : "-";
  const spec = carSpec !== "-" ? carSpec : aiSpec;
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
    // 집중관리고객: 민원·소송·소비자원·리콜센터·국민청원·언론 제보 등 이슈화하려는 강한 불만 글이면 작성자 닉네임
    focus: ai.focus && info?.author ? String(info.author).trim() : "-",
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
      const cap = await captureCafePost(row.url, (step) => setItemStatus(it, step), { cafe: row.cafe, title: row.title });
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
      ai = await aiSummarize(row, info, { apiKey: key, model: $("#aiModel").value, recentBodies, titlePrefix: `${modelName(row.car)}(${row.car})` });
    } catch (e) {
      it.error = [it.error, `AI 요약 실패: ${aiErrorMessage(e)} (엑셀 내용으로 초안)`].filter(Boolean).join(" · ");
      ai = excelDraft(row, info);
    }
  } else {
    ai = excelDraft(row, info);
  }
  it.fields = fieldsFrom(row, info, ai);
  it.aiFields = { ...it.fields }; // 자동 학습용: AI 가 처음 쓴 값
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
  if (collecting()) {
    setSummary("부정 이슈 수집이 진행 중입니다. 수집이 끝난 뒤 캡처·요약을 시작해 주세요.", "err");
    return;
  }
  const chain = $("#autoChain").checked;
  await loadPptLearned(); // 담당자 수정 사례를 최신으로
  await loadPptExamples();
  // 끝나고 바로 저장할 때: 저장 폴더 허용은 버튼을 누른 지금 받아 둔다 (나중엔 물을 수 없음)
  const chainDir = chain ? await saveDirIfAllowed() : null;
  stopRequested = false;
  AiCost.reset();
  runStart = Date.now();
  captureMs = 0;
  clearInterval(statsTimer);
  statsTimer = setInterval(showStats, 1000);
  showStats();
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
  captureMs = Date.now() - runStart;
  clearInterval(statsTimer);
  showStats();
  const failed = items.filter((it) => it.error).length;
  const deleted = items.filter((it) => it.deleted).length;
  setSummary(
    stopRequested ? `중지했습니다 (${done} / ${items.length}). 끝난 글로 PPT 를 받을 수 있습니다.` : `완료: ${items.filter((it) => it.ready && !it.deleted).length}건${deleted ? ` (삭제된 게시물 ${deleted}건 제외)` : ""}${failed ? ` · 확인 필요 ${failed}건` : ""}. 내용을 확인한 뒤 [PPT 받기]를 누르세요.`,
    failed ? "err" : "ok",
  );
  refreshButtons(false);
  // 'PPT·RAW 바로 저장': 캡처·요약이 끝나면 이어서 PPT 와 RAW 를 저장하고 한 번에 알린다
  if (chain && !stopRequested && items.some((it) => it.ready && !it.deleted && it.no)) {
    const ppt = await buildPpt({ dir: chainDir, quiet: true });
    const raw = excelAllRows.length ? await buildRaw({ dir: chainDir, quiet: true }) : null;
    $("#doneTitle").textContent = ppt && raw ? "✅ PPT·RAW 저장 완료" : ppt ? "✅ PPT 저장 완료 (RAW 는 확인 필요)" : "⚠ PPT 저장 실패";
    $("#doneText").textContent = [ppt && `PPT: ${ppt}`, raw && `RAW: ${raw}`].filter(Boolean).join("\n") || $("#summary").textContent;
    $("#doneStats").textContent = $("#stats").textContent;
    const dlg = $("#doneDialog");
    if (!dlg.open) dlg.showModal();
  }
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
      learnPptItem(it);
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

// 미리보기에서 고친 값 → 자동 학습 메모 (1.5초 모아 저장, 원래대로 되돌리면 지움)
const pptLearnTimers = new Map();
function learnPptItem(it) {
  if (!it.aiFields) return;
  const key = normUrl(it.row.url);
  clearTimeout(pptLearnTimers.get(key));
  pptLearnTimers.set(
    key,
    setTimeout(async () => {
      pptLearnTimers.delete(key);
      const ch = {};
      const t = (v) => String(v ?? "").trim();
      for (const k of Object.keys(PPT_LEARN_FIELDS)) if (t(it.fields[k]) !== t(it.aiFields[k])) ch[k] = [t(it.aiFields[k]), t(it.fields[k])];
      const list = (await loadPptLearned()).filter((x) => x.key !== key);
      if (Object.keys(ch).length) list.unshift({ key, at: Date.now(), cafe: it.row.cafe || "", car: it.row.car || "", title: String(it.row.title || "").slice(0, 80), ch });
      await savePptLearned(list);
    }, 1500)
  );
}
window.PptLearn = { load: async () => { await loadPptExamples(); return loadPptLearned(); }, save: savePptLearned, line: pptLearnLine, system: () => aiSystem() };

// 담당자가 고친 PPT 를 올리면: 기억해 둔 원본과 비교해 바뀐 칸을 학습 메모로, 원본이 없으면 '확정 예시'로 저장
const PPT_DIFF_FIELDS = ["title", "spec", "level", "progress", "body", "reaction", "short", "duplicate", "region", "focus"];
async function onLearnPpt() {
  const file = $("#learnPptFile").files[0];
  $("#learnPptFile").value = "";
  if (!file) return;
  try {
    const edited = await PptRead.read(new Uint8Array(await file.arrayBuffer()));
    if (!edited.length) throw new Error("이 파일에서 상세 슬라이드를 찾지 못했습니다");
    const { pptSnapshots = [] } = await chrome.storage.local.get("pptSnapshots");
    const byKey = new Map();
    for (const s of [...pptSnapshots].reverse()) for (const x of s.items) byKey.set(x.key, x); // 최신 원본 우선
    const t = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
    let diffs = 0;
    let examples = 0;
    const lines = [];
    const learned = await loadPptLearned();
    const exList = await loadPptExamples();
    for (const e of edited) {
      const key = normUrl(e.url);
      const orig = byKey.get(key);
      if (orig) {
        const ch = {};
        for (const k of PPT_DIFF_FIELDS) {
          const a = t(orig.fields[k]);
          const b = t(e[k]);
          if (b && a !== b) ch[k] = [a, b];
        }
        if (Object.keys(ch).length) {
          const i = learned.findIndex((x) => x.key === key);
          if (i >= 0) learned.splice(i, 1);
          learned.unshift({ key, at: Date.now(), cafe: orig.cafe || e.cafe, car: orig.car || e.code, title: orig.title || "", ch, from: "PPT 수정본" });
          diffs++;
          lines.push(`No.${e.no} ${e.title}: ${Object.keys(ch).map((k) => PPT_LEARN_FIELDS[k] || k).join(", ")} 수정`);
        }
      } else {
        // 원본을 모르면 담당자 확정본을 예시로
        const i = exList.findIndex((x) => x.key === key);
        if (i >= 0) exList.splice(i, 1);
        exList.unshift({ key, at: Date.now(), car: e.code, kind: e.kind, title: e.title, short: e.short, spec: e.spec, level: e.level, region: e.region, body: e.body, reaction: e.reaction });
        examples++;
      }
    }
    await savePptLearned(learned);
    await savePptExamples(exList);
    const msg = `수정한 PPT 학습 완료: 원본과 비교해 고친 글 ${diffs}건${examples ? ` · 원본이 없어 확정 예시로 저장 ${examples}건` : ""}. 다음 PPT 작성부터 반영됩니다.`;
    setSummary(msg + (lines.length ? `\n${lines.join("\n")}` : ""), "ok");
    $("#doneTitle").textContent = "✅ 수정한 PPT 학습 완료";
    $("#doneText").textContent = msg;
    $("#doneStats").textContent = lines.join(" · ");
    if (!$("#doneDialog").open) $("#doneDialog").showModal();
  } catch (err) {
    setSummary(`수정한 PPT 를 읽지 못했습니다: ${err.message || err}`, "err");
  }
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
    if (p.region) {
      ctx.drawImage(src, 0, p.region.y0, p.region.w, p.region.y1 - p.region.y0, p.x * s, p.y * s, p.w * s, p.h * s);
    } else {
      const sh = p.crop && p.crop < 1 ? src.height * p.crop : src.height;
      ctx.drawImage(src, 0, 0, src.width, sh, p.x * s, p.y * s, p.w * s, p.h * s);
    }
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
    if (p.region) {
      item = ImageProc.region(item, p.region.y0, p.region.y1, p.region.w);
      h = (p.w * item.canvas.height) / item.canvas.width;
    } else if (p.crop && p.crop < 1) {
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
  $("#saveWhere").textContent = handle ? `📁 ${handle.name}` : "다운로드 폴더";
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
// 저장 폴더: 여기서 따로 고르지 않았으면 부정 이슈 모니터링 설정의 '엑셀 저장 폴더'를 같이 쓴다
function monitorSaveDir() {
  return new Promise((resolve) => {
    const open = indexedDB.open("issueMonitor", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const r = open.result.transaction("handles").objectStore("handles").get("saveDir");
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}
async function saveDirHandle() {
  return (await kvGet("saveDir").catch(() => null)) || (await monitorSaveDir());
}

async function saveDirIfAllowed() {
  const handle = await saveDirHandle();
  if (!handle) return null;
  try {
    let p = await handle.queryPermission({ mode: "readwrite" });
    if (p !== "granted") p = await handle.requestPermission({ mode: "readwrite" });
    return p === "granted" ? handle : null;
  } catch {
    return null;
  }
}

// 같은 이름이 이미 있으면 덮어쓰지 않고 '이름 (1).확장자', '(2)' … 로 (짝 파일 suffixes 도 함께 비어 있어야 함)
async function freeName(saveDir, fileName, pairSuffixes = []) {
  if (!saveDir) return fileName;
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  const exists = async (n) => {
    try {
      await saveDir.getFileHandle(n);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 100; i++) {
    const b = i ? `${base} (${i})` : base;
    const names = [`${b}${ext}`, ...pairSuffixes.map((s) => `${b}${s}${ext}`)];
    let taken = false;
    for (const n of names) if (await exists(n)) taken = true;
    if (!taken) return `${b}${ext}`;
  }
  return `${base} (${Date.now()})${ext}`;
}

// 고른 저장 폴더에 쓰고(못 쓰면 다운로드 폴더로) 저장한 위치 글자를 돌려준다
async function saveFile(saveDir, fileName, bytes, type) {
  if (saveDir) {
    try {
      const fh = await saveDir.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      return `📁 ${saveDir.name}/${fileName}`;
    } catch (e) {
      setSummary(`고른 폴더에 저장하지 못해 다운로드 폴더로 받습니다 (${e.message || e})`, "err");
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return `다운로드 폴더/${fileName}`;
}

// ---------------------------------------------------------------------------
// RAW data 엑셀: 오늘 엑셀의 모든 행을 지난 RAW 파일 끝에 이어 붙여 저장 (만든 파일은 기억해 두고 다음 날 이어 씀)
// ---------------------------------------------------------------------------
function showRawInfo(saved) {
  $("#rawInfo").textContent = saved
    ? `이어 쓸 RAW 파일: ${saved.name} (${saved.savedAt || ""})`
    : "아직 RAW 파일이 없습니다. 지난 'YYMMDD_차종별 온라인 동향 raw data.xlsx' 를 한 번 넣어 주세요.";
  $("#rawInfo").className = saved ? "hint ok" : "hint err";
}

const nowText = () => new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

async function onRawFile() {
  const file = $("#rawFile").files[0];
  if (!file) return;
  const saved = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), savedAt: nowText() };
  await kvSet("rawLatest", saved);
  showRawInfo(saved);
}

async function buildRaw(opts = {}) {
  pptWorking++;
  try {
    return await buildRawWork(opts);
  } finally {
    pptWorking--;
  }
}

async function buildRawWork(opts = {}) {
  if (opts instanceof Event) opts = {};
  $("#rawBuild").disabled = true;
  const saveDir = opts.dir !== undefined ? opts.dir : await saveDirIfAllowed(); // 버튼을 누른 바로 그때 폴더 허용 확인
  try {
    const base = await kvGet("rawLatest");
    if (!base) {
      openSettings();
      throw new Error("이어 쓸 RAW data 엑셀이 없습니다. 설정에서 지난 RAW 파일을 한 번 넣어 주세요");
    }
    setSummary(`RAW data 엑셀 만드는 중… (${base.name} 에 ${excelAllRows.length}행 이어 붙이기)`);
    const { y, m, d } = reportDate();
    // 게시일이 빈 행: 오늘 엑셀에서 가장 많은 게시일, 그것도 없으면 보고서 날짜 하루 전
    const counts = {};
    for (const r of excelAllRows) {
      const k = Raw.dateSerial(r.date);
      if (k) counts[k] = (counts[k] || 0) + 1;
    }
    const common = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const fallbackSerial = common ? Number(common) : Raw.toSerial(y, m, d) - 1;
    const res = await Raw.append(base.bytes, excelAllRows, { fallbackSerial });
    if (res.dupDates.length && !confirm(`RAW 파일에 이미 ${res.dupDates.join(", ")} 자료가 들어 있습니다.\n같은 날 자료를 두 번 넣는 것일 수 있어요. 그래도 이어 붙일까요?`)) {
      setSummary("RAW data 엑셀 만들기를 취소했습니다");
      return;
    }
    const name = ($("#rawName").value.trim() || "{날짜}_차종별 온라인 동향 raw data").replace("{날짜}", `${String(y).slice(2)}${pad(m)}${pad(d)}`);
    const fileName = await freeName(saveDir, `${name.replace(/[<>:"/\\|?*]/g, "_")}.xlsx`); // 덮어쓰지 않음
    const where = await saveFile(saveDir, fileName, res.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const saved = { name: fileName, bytes: res.bytes, savedAt: nowText() };
    await kvSet("rawLatest", saved); // 다음 날은 이 파일에 이어서
    // 데일리 DB 탭에서 보고 다시 받을 수 있게 RAW 파일 이력 (최근 15개)
    try {
      const hist = (await kvGet("rawHistory")) || [];
      hist.unshift({ id: `raw-${Date.now()}`, at: Date.now(), name: fileName, bytes: res.bytes, where, detail: res.sheets.map((s) => (s.count ? `${s.name} ${s.count}행 (연번 ${s.from}~${s.to})` : `${s.name} 0행`)).join(" · "), rows: excelAllRows.length });
      await kvSet("rawHistory", hist.slice(0, 15));
    } catch {}
    showRawInfo(saved);
    const detail = res.sheets.map((s) => (s.count ? `${s.name} ${s.count}행 (연번 ${s.from}~${s.to})` : `${s.name} 0행`)).join(" · ");
    setSummary(`RAW data 저장했습니다: ${where} — ${detail}`, "ok");
    if (opts.quiet) return `${where} (${detail})`;
    $("#doneTitle").textContent = "✅ RAW data 엑셀 저장 완료";
    $("#doneText").textContent = `${where} 에 저장했습니다.`;
    $("#doneStats").textContent = detail;
    const dlg = $("#doneDialog");
    if (!dlg.open) dlg.showModal();
    return where;
  } catch (e) {
    setSummary(`RAW data 엑셀을 만들지 못했습니다: ${e.message || e}`, "err");
    return null;
  } finally {
    refreshButtons(false);
  }
}

function reportDate() {
  const v = $("#reportDate").value;
  const [y, m, d] = v ? v.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
  return { y, m, d };
}

// 수집 화면이 물어봄: 게시물 캡처 중이거나 PPT·RAW 를 만드는 중이면 true (그때는 자동 수집이 이 화면을 다시 불러오지 않음)
let pptWorking = 0;
window.pptBusy = () => !$("#stop").disabled || pptWorking > 0;

async function buildPpt(opts = {}) {
  pptWorking++;
  try {
    return await buildPptWork(opts);
  } finally {
    pptWorking--;
  }
}

async function buildPptWork(opts = {}) {
  if (opts instanceof Event) opts = {};
  $("#build").disabled = true;
  // 저장 폴더 허용 확인은 버튼을 누른 바로 그때 해야 해서 맨 먼저
  const saveDir = opts.dir !== undefined ? opts.dir : await saveDirIfAllowed();
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
    // 다시 받아도 덮어쓰지 않음: 이름 (1), (2) … (시스템 작성본도 같은 번호로)
    const fileName = await freeName(saveDir, `${name.replace(/[<>:"/\\|?*]/g, "_")}.pptx`, ["_시스템 작성본"]);
    const size = `${list.length}건, ${(bytes.length / 1024 / 1024).toFixed(1)}MB`;
    // 저장 끝: 소요 시간(캡처·요약 시작부터 PPT 저장까지)·예상 AI 비용과 함께 완료 알림
    const done = (where, sz) => {
      setSummary(`저장했습니다: ${where} (${sz})`, "ok");
      const total = runStart ? Date.now() - runStart : 0;
      const stats = runStart ? `${statsText(total)}` : `💰 예상 AI 비용 ${AiCost.text()}`;
      $("#stats").hidden = false;
      $("#stats").textContent = stats + (captureMs ? ` (캡처·요약 ${fmtDuration(captureMs)})` : "");
      if (opts.quiet) return;
      $("#doneTitle").textContent = "✅ PPT 작성 완료";
      $("#doneText").textContent = `${where} 에 저장했습니다 (${sz}).`;
      $("#doneStats").textContent = $("#stats").textContent;
      const d = $("#doneDialog");
      if (!d.open) d.showModal();
    };
    // 자동 학습용: 시스템이 쓴 원본 값을 기억 (담당자가 PPT 를 고쳐 다시 올리면 비교)
    try {
      const { pptSnapshots = [] } = await chrome.storage.local.get("pptSnapshots");
      pptSnapshots.unshift({ at: Date.now(), fileName, items: ready.map((it) => ({ key: normUrl(it.fields.url || it.row.url), no: it.no, cafe: it.row.cafe || "", car: it.row.car || "", title: String(it.row.title || "").slice(0, 80), fields: { ...it.fields } })) });
      await chrome.storage.local.set({ pptSnapshots: pptSnapshots.slice(0, 30) });
    } catch {}
    const where = await saveFile(saveDir, fileName, bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    // 시스템 원본을 한 부 더 (담당자가 PowerPoint 에서 고친 뒤에도 비교할 수 있게, 이 파일은 고치지 않고 둠)
    try {
      await saveFile(saveDir, fileName.replace(/\.pptx$/i, "_시스템 작성본.pptx"), bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    } catch {}
    done(where, size);
    return `${where} (${size})`;
  } catch (e) {
    setSummary(`PPT 를 만들지 못했습니다: ${e.message || e}`, "err");
    return null;
  } finally {
    refreshButtons(false);
  }
}

// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  if (parentApp()) document.body.classList.add("embedded");
  const { pptAutoChain } = await chrome.storage.local.get("pptAutoChain").catch(() => ({}));
  $("#autoChain").checked = !!pptAutoChain;
  $("#autoChain").addEventListener("change", () => chrome.storage.local.set({ pptAutoChain: $("#autoChain").checked }));
  renderSource();
  await loadPptLearned();
  await loadPptExamples();
  const now = new Date();
  $("#reportDate").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // 화면을 밤새 열어 둔 경우: 날짜가 바뀌면 보고서 날짜도 오늘로 (작업 중이면 그대로)
  let shownDay = now.toDateString();
  const refreshDay = () => {
    const d = new Date();
    if (d.toDateString() === shownDay || !$("#stop").disabled) return;
    shownDay = d.toDateString();
    $("#reportDate").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  setInterval(refreshDay, 60 * 1000);
  document.addEventListener("visibilitychange", refreshDay);
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
  $("#rawBuild").addEventListener("click", buildRaw);
  $("#rawFile").addEventListener("change", onRawFile);
  $("#learnPptFile").addEventListener("change", onLearnPpt);
  showRawInfo(await kvGet("rawLatest").catch(() => null));
  $("#openSettings").addEventListener("click", openSettings);
  $("#changeFolder").addEventListener("click", openSettings);
  $("#pickFolder").addEventListener("click", pickFolder);
  $("#clearFolder").addEventListener("click", async () => {
    await kvSet("saveDir", null);
    showFolder(await saveDirHandle());
  });
  showFolder(await saveDirHandle());
});
