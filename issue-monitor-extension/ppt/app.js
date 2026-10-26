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
  // 내연기관과 전기차가 같은 코드인 차: 전기차는 차명에 EV 를 붙인다 (2026-10-20 담당자 지정: "스타리아EV(US4 EV)", "캐스퍼EV(AX EV)", "포터EV(HR EV)", "코나EV(SX2 EV)"·"코나EV(OS EV)")
  "US4 EV": "스타리아EV", "AX EV": "캐스퍼EV", "HR EV": "포터EV", "SX2 EV": "코나EV", "OS EV": "코나EV",
  // 제네시스 전동화 모델(G80·GV70 등)은 차명에 EV 를 붙이지 않는다 (담당자 지정)
};
// 위 차들은 차종 칸(상세 표·2페이지 요약표)에도 "US4 EV" 처럼 EV 까지 적는다
const EV_IN_CODE = new Set(["US4", "AX", "HR", "SX2", "OS"]);
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
  refreshFullPptBtn();
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
      await restoreLastExcel(); // 오늘 첨부했던 전체 엑셀이 있으면 다시 불러오고, 작성하던 글도 화면에 되살림
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
  const code = spec === "EV" && EV_IN_CODE.has(parts[0]) ? `${parts.join(" ")} EV` : parts.join(" ");
  if (FCEV_ONLY.has(parts[0]) || MODEL_NAMES[parts[0]] === "넥쏘") spec = "FCEV";
  if (!spec && EV_ONLY.has(parts[0])) spec = "EV";
  return { code, spec: spec || "-" };
}

// 차종 코드별 출시·판매 제원 (국내, 그 세대의 지난 연식 포함). 2026-10 기준으로 정리 — 담당자가 틀린 곳을 알려 주면 고친다.
// 표기: 터보 "2.5T" / 자연흡기(N/A) "2.5" / 디젤 "2.2D" / LPI 는 배기량 없이 "LPI" / 하이브리드 "HEV" / 전기 "EV" / 수소 "FCEV"
const SPEC_LINEUP = {
  CN7: ["1.6", "1.6T", "2.0T", "HEV", "LPI"], // 아반떼 7세대 (1.6T N라인 초기, 2.0T 아반떼 N)
  CN8: ["2.0", "HEV"], // 디 올 뉴 아반떼 (2026)
  DN8: ["2.0", "1.6T", "2.5T", "HEV", "LPI"], // 쏘나타 (2.5T N라인)
  GN7: ["2.5", "3.5", "HEV", "LPI"], // 그랜저 (HEV 1.6T)
  IG: ["2.4", "2.5", "3.0", "3.3", "2.2D", "HEV", "LPI"],
  NX4: ["1.6T", "2.0D", "HEV", "PHEV"], // 투싼
  MX5: ["2.5T", "HEV"], // 싼타페 5세대 (디젤 없음)
  TM: ["2.0T", "2.4", "2.5", "2.5T", "2.0D", "2.2D", "HEV", "PHEV"], // 싼타페 4세대
  LX2: ["3.8", "2.2D"], // 팰리세이드 1세대
  LX3: ["2.5T", "HEV"], // 팰리세이드 2세대
  SX2: ["2.0", "1.6T", "HEV", "EV"], // 코나 2세대
  OS: ["2.0", "1.6T", "1.6D", "HEV", "EV"], // 코나 1세대
  QX: ["1.6"], // 베뉴
  AX: ["1.0", "1.0T", "EV"], // 캐스퍼 (EV 는 AX EV)
  US4: ["3.5", "2.2D", "HEV", "LPI", "EV"], // 스타리아 (EV 는 US4 EV)
  HR: ["2.5D", "LPI", "EV"], // 포터
  ST: ["2.5D", "LPI"], // 스타렉스
  NE: ["EV"], CE: ["EV"], ME1: ["EV"], ST1: ["EV"], JW: ["EV"], // 전기차 전용
  FE: ["FCEV"], NH2: ["FCEV"], // 넥쏘
  IK: ["2.0T", "2.5T", "3.3T", "2.2D"], // G70
  RG3: ["2.5T", "3.5T", "2.2D", "EV"], // G80 (EV 는 전동화 모델)
  RS4: ["3.5T"], // G90
  JK: ["2.5T", "3.5T", "2.2D", "EV"], // GV70
  JX: ["2.5T", "3.5T", "3.0D", "HEV"], // GV80 (HEV 2026-09~)
};
// 화물차는 제원 칸에 몇 톤인지 소문자 t 로 (예: "25t") (2026-10-20 담당자 지정)
const TRUCKS = new Set(["QZ"]);
const isTruck = (code) => TRUCKS.has(String(code || "").trim().split(/\s+/)[0]);

function specLineup(code) {
  return SPEC_LINEUP[String(code || "").trim().split(/\s+/)[0]] || null;
}

// 2.5 와 2.5T(터보)는 다른 제원: T 는 터보 모델, 숫자만은 자연흡기(N/A) 모델 (2026-10-20 담당자 지정)
// 그 차종에 이 배기량이 터보뿐이면 글에 "2.5" 로만 적혀 있어도 T 를 붙이고, 디젤이 하나뿐이면 "디젤" → "2.2D" 처럼 채운다
function normSpec(code, spec) {
  if (isTruck(code)) {
    const t = String(spec || "").match(/(\d{1,2}(?:\.\d)?)\s*(톤|t\b|ton)/i);
    return t ? `${t[1]}t` : "-";
  }
  let v = String(spec || "").trim().replace(/\s*(t|터보)$/i, "T");
  v = v.replace(/^(\d\.\d)\s*(d|디젤)$/i, "$1D").replace(/^(디젤|diesel)\s*(\d\.\d)$/i, "$2D");
  // LPI 는 배기량 없이 "LPI" 만 (2026-10-20 담당자 지정)
  if (/lpg|lpi/i.test(v)) v = "LPI";
  if (/^하이브리드$|^hev$/i.test(v)) v = "HEV";
  const line = specLineup(code);
  if (line) {
    if (/^\d\.\d$/.test(v) && !line.includes(v) && line.includes(`${v}T`)) v += "T";
    // 디젤은 배기량 없이 쓰지 않는다 (2026-10-20 담당자 지정): 그 차종의 디젤로 채움.
    // 디젤이 둘인 싼타페(TM)는 2.0D(2018~2020 초기)·2.2D 중 판매가 많고 F/L 이후 유일한 2.2D
    const diesel = line.filter((x) => /D$/.test(x));
    if (v === "디젤" && diesel.length) v = diesel.includes("2.2D") ? "2.2D" : diesel[0];
  }
  return v || "-";
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
  // 그림 해상도: 담당자 요청으로 기본 150ppi (PowerPoint 그림 압축 '화상(150ppi)'과 같음, 2026-10-20).
  // 예전 기본값(330)이 저장돼 있으면 한 번만 150 으로 바꾼다. 이후 담당자가 고른 값은 그대로 둔다.
  const { ppiDefault150 } = await chrome.storage.local.get("ppiDefault150").catch(() => ({}));
  if (!ppiDefault150) {
    s.ppi = "150";
    await chrome.storage.local.set({ ppi: "150", ppiDefault150: true }).catch(() => {});
  }
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
// 업데이트·새로고침으로 화면이 다시 열려도 오늘 첨부한 전체 엑셀과 작성하던 글이 사라지지 않게
// (담당자 지적 2026-10-23: 업데이트 후 RAW 받기 버튼이 꺼지고 작성한 PPT 내용이 화면에서 사라짐)
async function restoreLastExcel() {
  const last = await kvGet("lastExcel").catch(() => null);
  const today = new Date().toDateString();
  if (!last || !last.bytes || new Date(last.at).toDateString() !== today) return;
  await loadExcelBytes(last.bytes, `${last.name} · 오늘 첨부했던 파일을 다시 불러옴`);
  if (!excelItems.length && !excelAllRows.length) return;
  source.kind = "file";
  renderSource();
  await restoreItemsFromProgress();
  refreshButtons();
}

// 저장해 둔 작성 기록(이어하기용)으로 미리보기 카드를 되살린다 (다시 캡처하지 않음)
async function restoreItemsFromProgress() {
  if (items.some((it) => it.ready)) return;
  const prev = await loadPptProgress();
  if (!prev) return;
  const byUrl = new Map(prev.items.map((x) => [x.url, x]));
  plan = countPlan();
  items = excelItems.map((row) => ({ no: null, row, ready: false }));
  $("#items").innerHTML = "";
  let n = 0;
  // 번호: 저장된 번호가 없으면(예전 기록) 지금 작성 개수 설정대로 매긴다 (start() 와 같은 방식)
  const mine = plan.all ? items : plan.part === "front" ? items.slice(0, plan.mine) : items.slice(-plan.mine);
  let nextNo = 1;
  for (const it of items) {
    const x = byUrl.get(it.row.url);
    if (!x) {
      renderItem(it);
      setItemStatus(it, "작성 안 함");
      continue;
    }
    try {
      await restoreItem(it, x);
      it.no = x.no ?? (it.deleted ? null : plan.all ? nextNo++ : mine.includes(it) ? plan.startNo + mine.indexOf(it) : null);
      renderItem(it);
      setItemStatus(it, it.deleted ? "삭제된 게시물 — 보고서에서 제외" : "지난 작업에서 불러옴", it.deleted ? "err" : "ok");
      n++;
    } catch {
      renderItem(it);
    }
  }
  if (n) setSummary(`화면이 다시 열려 오늘 작성하던 글 ${n}건을 불러왔습니다. 이어서 [PPT 받기]·[RAW data 엑셀 파일 받기]를 할 수 있습니다.`, "ok");
}

async function onExcelFile() {
  const file = $("#excelFile").files[0];
  if (!file) return;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  await kvSet("lastExcel", { name: file.name, bytes: fileBytes, at: Date.now() }).catch(() => {});
  await loadExcelBytes(fileBytes, file.name);
  source.kind = excelItems.length || excelAllRows.length ? "file" : "";
  renderSource();
  await restoreItemsFromProgress().catch(() => {}); // 같은 엑셀로 작성하던 글이 있으면 미리보기 카드를 되살림
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
  // 후보는 이 차종에 실제로 출시된 제원(SPEC_LINEUP)에 있는 것만
  const line = specLineup(code);
  const hinted = [...new Set((info?.specHints || []).filter(sameCar).map((h) => normSpec(code, h.spec)))].filter((v) => v !== "-" && (isTruck(code) ? /^\d+(\.\d)?t$/.test(v) : !line || line.includes(v)));
  const aiSpec = ai.spec && ai.spec !== "-" ? ai.spec : hinted.length === 1 ? hinted[0] : "-";
  let spec = carSpec !== "-" ? carSpec : normSpec(code, aiSpec);
  if (spec === "-" && line && line.length === 1) spec = line[0]; // 제원이 하나뿐인 차
  if (spec === "-" && line && line.length === 2 && line.includes("EV") && /EV$/.test(code)) spec = "EV";
  return {
    title: `${modelName(row.car)}(${row.car}) ${ai.issue}`.trim(),
    code,
    spec,
    kind: row.kind || "품질",
    level: ai.level || "주의",
    progress: progressFor(ai.level, ai.progress),
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
      it.cap = cap; // 이어하기용 원본 캡처 (중단돼도 다시 찍지 않게 저장)
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

// ---------------------------------------------------------------------------
// 이어하기 (담당자 요청 2026-10-20): 글 하나의 캡처·요약이 끝날 때마다(미리보기에서 고친 내용 포함) 이 PC 에 저장해 두고,
// 실패·중지·창 닫힘 등으로 멈춘 뒤 같은 엑셀로 다시 [시작]하면 끝난 글은 다시 찍지 않고 이어서 한다
// ---------------------------------------------------------------------------
function savedItem(it) {
  const cap = it.cap ? { ...it.cap, imagesOriginal: (it.cap.images || []).map((b) => !!(b && b.isOriginal)) } : null;
  return {
    url: it.row.url,
    no: it.no ?? null,
    ready: it.ready,
    deleted: !!it.deleted,
    error: it.error || "",
    fields: it.fields || null,
    aiFields: it.aiFields || null,
    noReaction: !!it.noReaction,
    info: it.info || null,
    cap,
    sel: it.sel ? { header: it.sel.header, body: it.sel.body, comments: [...it.sel.comments], images: [...it.sel.images] } : null,
  };
}

let progressTimer = null;
function savePptProgress(delay = 0) {
  clearTimeout(progressTimer);
  progressTimer = setTimeout(async () => {
    const done = items.filter((it) => it.ready && !it.skipped);
    if (!done.length) return;
    await kvSet("pptProgress", { at: Date.now(), urls: items.map((it) => it.row.url), items: done.map(savedItem) }).catch(() => {});
  }, delay);
}

async function loadPptProgress() {
  const p = await kvGet("pptProgress").catch(() => null);
  if (!p || !p.items || !p.items.length || Date.now() - p.at > 3 * 86400000) return null;
  const now = new Set(excelItems.map((r) => r.url));
  const usable = p.items.filter((x) => now.has(x.url) && !/캡처 실패/.test(x.error || "")); // 캡처 실패한 글은 다시 한다
  return usable.length ? { ...p, items: usable } : null;
}

async function restoreItem(it, x) {
  it.row = { ...it.row };
  it.ready = x.ready;
  it.deleted = x.deleted;
  it.error = x.error;
  it.info = x.info;
  it.fields = x.fields;
  it.aiFields = x.aiFields;
  it.noReaction = x.noReaction;
  it.cap = x.cap;
  if (x.cap) {
    (x.cap.images || []).forEach((b, i) => b && (b.isOriginal = !!(x.cap.imagesOriginal || [])[i]));
    it.visuals = await processCaptures(x.cap);
  } else it.visuals = { header: null, body: null, comments: [], images: [] };
  it.sel = x.sel ? { header: x.sel.header, body: x.sel.body, comments: new Set(x.sel.comments), images: new Set(x.sel.images) } : { header: true, body: true, comments: new Set(), images: new Set() };
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
  const prev = await loadPptProgress();
  const resumeMap = new Map();
  if (prev && confirm(`지난번에 같은 엑셀로 작업하던 기록이 있습니다 (${prev.items.length}건 캡처·요약 완료, ${new Date(prev.at).toLocaleString("ko-KR")}).\n\n[확인] 끝난 글은 건너뛰고 이어서 하기\n[취소] 처음부터 다시 하기`)) {
    for (const x of prev.items) resumeMap.set(x.url, x);
  }
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
    const saved = resumeMap.get(it.row.url);
    if (saved) {
      setItemStatus(it, "지난 작업에서 불러오는 중");
      try {
        await restoreItem(it, saved);
      } catch {
        await processItem(it); // 불러오기 실패 → 다시 작업
      }
    } else await processItem(it);
    done++;
    savePptProgress();
    if (!it.deleted) {
      // 전체: 삭제 글을 빼고 1번부터 이어서 / N개 중 K개: + 글 순서 그대로의 번호 (삭제 글 자리는 빈 칸)
      it.no = plan.all ? nextNo++ : plan.startNo + mine.indexOf(it);
      written++;
      savePptProgress(500);
      renderItem(it);
      setItemStatus(it, it.error ? "완료(확인 필요)" : "완료", it.error ? "err" : "ok");
    }
    const next = mine[mine.indexOf(it) + 1];
    if (next && isCafeUrl(next.row.url) && !stopRequested && !saved && !resumeMap.has(next.row.url)) {
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
// 경과: 주의·경고는 '초기', 심각은 AI 가 내용을 보고 정한 값(초기/진행/타결) (담당자 지정 2026-10-26: 무조건 진행 아님)
function progressFor(level, aiProgress) {
  if (level !== "심각") return "초기";
  return ["초기", "진행", "타결"].includes(aiProgress) ? aiProgress : "초기";
}
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
    <div class="preview"><canvas width="600" height="415"></canvas><div class="buttons"><button data-act="retry" title="AI 요약에 비용이 듭니다">💰 다시 캡처·요약</button></div></div></div>` + shots;

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
      savePptProgress(2000); // 고친 내용도 이어하기 기록에
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
      savePptProgress(2000);
    });
  }
  $('[data-act="retry"]', it.el).addEventListener("click", async () => {
    refreshButtons(true);
    await processItem(it);
    refreshButtons(false);
    savePptProgress();
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
window.PptLearn = { load: async () => { await loadPptExamples(); return loadPptLearned(); }, save: savePptLearned, line: pptLearnLine, system: () => aiSystem(), fromPpt: (details) => learnFromPpt(details) };

// 담당자가 고친 PPT 를 올리면: 기억해 둔 원본과 비교해 바뀐 칸을 학습 메모로, 원본이 없으면 '확정 예시'로 저장
const PPT_DIFF_FIELDS = ["title", "spec", "level", "progress", "body", "reaction", "short", "duplicate", "region", "focus"];
async function onLearnPpt() {
  const file = $("#learnPptFile").files[0];
  $("#learnPptFile").value = "";
  if (!file) return;
  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const edited = await PptRead.read(fileBytes);
    if (!edited.length) throw new Error("이 파일에서 상세 슬라이드를 찾지 못했습니다");
    // 담당자 수정본 = 그날 최종본 (데일리 DB). 날짜는 파일 이름(예: 261021)에서, 없으면 보고서 날짜
    const rd = reportDate();
    const pptDate = DailyPpt.dateFromName(file.name) || `${rd.y}-${pad(rd.m)}-${pad(rd.d)}`;
    await DailyPpt.add({ date: pptDate, kind: "edited", partial: !!edited.partial, name: file.name, bytes: fileBytes, count: edited.length }).catch(() => {});
    const { diffs, examples, lines } = await learnFromPpt(edited);
    const msg = `수정한 PPT 학습 완료: 원본과 비교해 고친 글 ${diffs}건${examples ? ` · 원본이 없어 확정 예시로 저장 ${examples}건` : ""}. 다음 PPT 작성부터 반영됩니다. 이 파일을 ${pptDate} 최종본으로 데일리 DB 에 저장했습니다${edited.partial ? " (나눠 쓴 일부 PPT — 전체 PPT 도 [전체 PPT 첨부하기]로 올려 주세요)" : ""}.`;
    setSummary(msg + (lines.length ? `\n${lines.join("\n")}` : ""), "ok");
    $("#doneTitle").textContent = "✅ 수정한 PPT 학습 완료";
    $("#doneText").textContent = msg;
    $("#doneStats").textContent = lines.join(" · ");
    if (!$("#doneDialog").open) $("#doneDialog").showModal();
  } catch (err) {
    setSummary(`수정한 PPT 를 읽지 못했습니다: ${err.message || err}`, "err");
  }
}

// 최종본 PPT(담당자 수정본·전체 PPT)로 학습: 기억해 둔 시스템 원본이 있는 글은 고친 칸을 학습 메모로,
// 원본이 없는 글(다른 담당자가 쓴 글 등)은 '확정 예시'로. 같은 글은 나중에 올린 최종본으로 덮어쓴다.
// (담당자 확인 2026-10-26: 전체 PPT 를 첨부하면 그 파일을 최종본으로 보고 최종 학습도 그 파일로)
async function learnFromPpt(edited) {
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
  return { diffs, examples, lines };
}

// 1인용(나눠 쓰기)일 때: 담당자들이 합친 전체 PPT 를 올려 그날의 전체 최종본으로 데일리 DB 에 저장 (주간 보고서 바탕)
async function onFullPpt() {
  const file = $("#fullPptFile").files[0];
  $("#fullPptFile").value = "";
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const details = await PptRead.read(bytes);
    if (!details.length) throw new Error("이 파일에서 상세 슬라이드를 찾지 못했습니다");
    const rd = reportDate();
    const date = DailyPpt.dateFromName(file.name) || `${rd.y}-${pad(rd.m)}-${pad(rd.d)}`;
    await DailyPpt.add({ date, kind: "full", partial: !!details.partial, name: file.name, bytes, count: details.length });
    const { diffs, examples } = await learnFromPpt(details);
    setSummary(`전체 PPT 를 ${date} 최종본으로 데일리 DB 에 저장하고 학습했습니다 (${details.length}건 · 내가 쓴 글 중 고친 글 ${diffs}건 학습 · 확정 예시 ${examples}건${details.partial ? " · ⚠ 이 파일도 일부만 들어 있는 것 같습니다" : ""}). 다음 PPT 작성부터 반영됩니다.`, details.partial ? "err" : "ok");
  } catch (err) {
    setSummary(`전체 PPT 를 읽지 못했습니다: ${err.message || err}`, "err");
  }
}

function refreshFullPptBtn() {
  const btn = $("#fullPptBtn");
  if (!btn) return;
  const partial = source.mode === "solo" || !countPlan().all;
  btn.classList.toggle("disabled", !partial);
  $("#fullPptFile").disabled = !partial;
  btn.title = partial ? "담당자들이 합친 전체 PPT 를 올려 그날 최종본으로 데일리 DB 에 저장" : "전체 작성일 때는 필요 없습니다 (내가 만든 PPT 가 전체 최종본)";
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
// target: 크게 보기용 고해상도 캔버스 (없으면 화면의 작은 미리보기)
function drawPreview(it, target) {
  const canvas = target || $(".preview canvas", it.el);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = 9906000;
  const H = 6858000;
  const s = canvas.width / W;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const k = canvas.width / 600; // 화면 미리보기(600px) 대비 배율 — 글자·선 굵기도 같이 키운다
  ctx.strokeStyle = "#c8ccd2";
  ctx.lineWidth = k;
  ctx.setLineDash([3 * k, 3 * k]);
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
  ctx.font = `bold ${Math.round(13 * k)}px sans-serif`;
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
    ctx.lineWidth = k;
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
    const ppi = Number($("#ppi").value) || 150;
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
    // 이미 RAW 에 있던 게시글은 빼고 이어 붙였다 (확인 창 없이) — 저장 결과에 몇 건 뺐는지 알려 준다
    const name = ($("#rawName").value.trim() || "{날짜}_차종별 온라인 동향 raw data").replace("{날짜}", `${String(y).slice(2)}${pad(m)}${pad(d)}`);
    const fileName = await freeName(saveDir, `${name.replace(/[<>:"/\\|?*]/g, "_")}.xlsx`); // 덮어쓰지 않음
    const where = await saveFile(saveDir, fileName, res.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const saved = { name: fileName, bytes: res.bytes, savedAt: nowText() };
    await kvSet("rawLatest", saved); // 다음 날은 이 파일에 이어서
    // 데일리 DB 탭에서 보고 다시 받을 수 있게 RAW 파일 이력 (최근 15개)
    try {
      const hist = (await kvGet("rawHistory")) || [];
      hist.unshift({ id: `raw-${Date.now()}`, at: Date.now(), name: fileName, bytes: res.bytes, where, detail: res.sheets.map((s) => (s.count ? `${s.name} ${s.count}행 (연번 ${s.from}~${s.to})` : `${s.name} 0행`)).join(" · "), rows: res.sheets.reduce((n, s) => n + (s.count || 0), 0) });
      await kvSet("rawHistory", hist.slice(0, 15));
    } catch {}
    showRawInfo(saved);
    const detail = res.sheets.map((s) => (s.count ? `${s.name} ${s.count}행 (연번 ${s.from}~${s.to})` : `${s.name} 0행`)).join(" · ") + (res.skipped ? ` · 이미 RAW 에 있던 글 ${res.skipped}건은 빼고 붙임` : "");
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
    // 데일리 DB 에 그날 PPT 로 보관 (주간 보고서 바탕). 나눠 쓴(1인용) PPT 는 일부로 표시
    try {
      await DailyPpt.add({ date: `${y}-${pad(m)}-${pad(d)}`, kind: "system", partial: !plan.all, name: fileName, bytes, count: list.length });
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
  // 캡처 이미지·슬라이드 미리보기를 누르면 크게 보기 (담당자 요청 2026-10-20). 체크는 체크 칸·글자를 눌러서.
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".shot img");
    const cv = e.target.closest(".preview canvas");
    if (!img && !cv) return;
    e.preventDefault(); // 그림을 눌러도 체크가 바뀌지 않게
    if (img) return openZoom(img.src, (img.closest(".shot").querySelector("span") || {}).textContent);
    // 슬라이드 미리보기는 화면의 작은 캔버스(600px)를 그대로 키우면 글자가 안 보여서, 캡처 원본으로 크게 다시 그린다
    // (담당자 지적 2026-10-26: 미리보기를 눌러도 확대는 안 되고 위치만 바뀜)
    const it = items.find((x) => x.el && x.el.contains(cv));
    let src = cv.toDataURL("image/png");
    if (it) {
      try {
        const big = document.createElement("canvas");
        big.width = 2400;
        big.height = Math.round((2400 * 6858000) / 9906000);
        drawPreview(it, big);
        src = big.toDataURL("image/png");
      } catch {}
    }
    openZoom(src, it && it.fields ? `슬라이드 미리보기 · ${it.fields.title || ""}` : "슬라이드 미리보기");
  });
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
  $("#fullPptFile").addEventListener("change", onFullPpt);
  refreshFullPptBtn();
  for (const el of ["#countAll", "#countTotal", "#countMine"]) $(el).addEventListener("input", refreshFullPptBtn);
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

// ---------------------------------------------------------------------------
// 크게 보기: 화면 가득 맞춰 보여 주고, 그림을 한 번 더 누르면 원본 크기(스크롤), 바깥·Esc·닫기로 닫음
// ---------------------------------------------------------------------------
function openZoom(src, label = "") {
  let box = $("#zoomBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "zoomBox";
    box.innerHTML = `<div class="zoom-bar"><span class="zoom-label"></span><span class="hint">그림을 누르면 원본 크기 ↔ 화면 맞춤 · Esc 닫기</span><button type="button" class="zoom-close">닫기 ✕</button></div><div class="zoom-body"><img alt=""></div>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      if (e.target.tagName === "IMG") {
        // 원본 크기: 그림이 작아 화면 맞춤보다 작아지는 경우에도 확실히 커지게 (화면 맞춤의 2배 이상)
        const im = e.target;
        if (box.classList.toggle("actual")) {
          const r = im.getBoundingClientRect();
          const fitW = Math.min(r.width, (r.height * im.naturalWidth) / (im.naturalHeight || 1));
          im.style.width = `${Math.max(im.naturalWidth, fitW * 2)}px`;
        } else im.style.width = "";
      }
      else if (e.target.closest(".zoom-close") || e.target.classList.contains("zoom-body")) box.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") box.hidden = true;
    });
  }
  box.classList.remove("actual");
  $("img", box).style.width = "";
  $(".zoom-label", box).textContent = String(label || "").trim();
  $("img", box).src = src;
  box.hidden = false;
}
