// LX3 / ME1 / MX5 전동 시트 작동 위험 상황 관련 게시물 수집 - 차종별 네이버 동호회에서 양산 시점부터 지금까지
// 2·3열 시트 조작 중 안전 사고·위험(우려)을 언급한 글을 찾아, 온라인 동향·로데이터에 들어 있었는지(Y/N)와
// 주요내용 요약·누락 사유를 붙여 엑셀(첨부 양식)로 받는다.
// 네이버는 API 를 부르지 않고 검색 화면·게시글을 보이지 않는 틀(필요하면 뒤쪽 탭)로 열어 화면에 보이는 내용만 읽는다(cafe-common.js).

const CARS = [
  { code: "LX3", label: "팰리세이드 (LX3)", start: "2024-12-20" },
  { code: "ME1", label: "아이오닉9 (ME1)", start: "2024-12-16" },
  { code: "MX5", label: "싼타페 (MX5)", start: "2023-08-15" },
];
const DEFAULT_CAFES = [
  "LX3 | 팰리세이드 피플 | allumpc",
  "LX3 | 클럽 팰리세이드 | naworl",
  "LX3 | LX3 클럽 | gamewinds",
  "LX3 | 팰리세이드 오너스 클럽 | tobloomer",
  "LX3 | 더팰리세이드 | hyundaipalisade",
  "ME1 | 전기차 동호회 | allfm01 | 혼합",
  "ME1 | 아이오닉 멤버스 | cafeclip | 혼합",
  "ME1 | 아이오닉9 오너스 | ioniq9owners",
  "ME1 | 아이오닉9 클럽 | optimusex119",
  "MX5 | 싼타페MX5패밀리 | trailer",
  "MX5 | 클럽싼타페 | iroid",
  "MX5 | 싼타페MX5클럽 | choids",
].join("\n");
// 이미 알고 있는 카페 번호 (나머지는 찾을 때 카페 첫 화면을 열어 알아낸다)
const KNOWN_CLUB_IDS = { allumpc: "16624720" };
const DEFAULT_QUERIES = "2열 시트, 3열 시트, 2열 끼임, 3열 끼임, 시트 끼임, 시트 폴딩, 전동시트, 시트 위험, 시트 사고, 시트 다칠";
const DEFAULT_MIXED_QUERIES = "{차종} 2열, {차종} 3열, {차종} 시트 끼임, {차종} 전동시트";
const DEFAULT_CAR_WORDS = ["LX3 | 팰리세이드, 팰리, LX3", "ME1 | 아이오닉9, 아이오닉 9, 아9, ioniq9, ioniq 9, ME1", "MX5 | 싼타페, 싼타, MX5"].join("\n");
const DEFAULT_ROW_WORDS = "2열, 3열, 이열, 삼열, 뒷좌석, 뒷자리, 뒷열, 시트, 좌석, 폴딩, 접이, 원터치, 워크인, 슬라이딩, 리클라이닝";
const DEFAULT_RISK_WORDS =
  "끼임, 끼여, 끼었, 끼인, 끼이, 끼일, 끼어, 낄뻔, 낄 뻔, 다칠, 다쳤, 다침, 부상, 사고, 위험, 아찔, 조심, 주의, 무섭, 무서, 골절, 멍들, 멍이, 피가, 피나, 병원, " +
  "깔려, 깔릴, 압박, 눌려, 짓눌, 손가락, 발가락, 발목, 아이가, 아이들, 아이 손, 애기, 아기, 애들, 강아지, 사망, 리콜, 안전, 센서, 감지, 안 멈, 안멈, 멈추지";
const DEFAULT_EXCLUDE = "시트커버, 시트지, 열선, 통풍, 썬팅, 틴팅, 팝니다, 삽니다, 판매합니다, 공동구매";
// 꼭 넣을 글: 요청서의 예시 게시물 (검색으로 찾았는지 점검하는 기준으로도 씀)
const DEFAULT_MUST = ["https://cafe.naver.com/gamewinds/4299497", "https://cafe.naver.com/tobloomer/133964"].join("\n");
// 동호회별 모니터링 시작일: 이 날짜 이전 글은 그 동호회가 모니터링 대상이 아니었으므로 누락 사유를 정해진 문장으로
// (팰리세이드 오너스 클럽: 동향·로데이터에 '26.3.11 게시글부터 나옴 - 3.12 보고부터 모니터링)
const DEFAULT_MONITOR_START = "tobloomer | 2026-03-11 | '26년 3월 12일부터 모니터링 대상 동호회로 지정";
// AI 추가 규칙(메모)의 기본 항목. 새 항목은 이미 메모를 저장해 둔 PC 에도 한 번 덧붙인다(seatRuleBlocks 에 넣은 항목 기록).
const AI_RULE_BLOCKS = [
  ["tobloomer-start", `- 팰리세이드 오너스 클럽(cafe.naver.com/tobloomer)은 '26년 3월 12일부터 모니터링 대상 동호회가 되었다.
  그 이전(게시일 '26.3.11 이전) 글이 온라인 동향에 없으면, 누락 사유는 "해당 동호회는 당시 모니터링 대상 동호회가 아니었음('26년 3월 12일부터 모니터링 대상 동호회로 지정)" 으로 쓴다.`],
  ["raw-start", `- 전차종 로데이터 엑셀은 '24년 4월 15일부터 처음 작성되었다. 그 이전에는 전차종 로데이터 파일이 없었다.
  첫 로데이터('24.4.15 월)는 직전 근무일 4.12(금)~주말 글부터 담았다. 게시일이 '24.4.12 이전이고 로데이터에도 없는 글의 누락 사유에는 "전차종 로데이터는 '24년 4월 15일부터 작성되어 이 글의 게시 시점에는 로데이터 파일이 없었음" 을 앞에 쓰고,
  그 뒤에 글 내용에 따른 이유를 이어 쓴다. (이 앞부분은 프로그램이 붙이므로 AI 는 글 내용에 따른 이유만 쓴다. 로데이터에 없다는 것 자체를 이유로 쓰지 않는다.)`],
  ["final-review-focus", `- 최종 검수는 다음 4가지에 초점을 맞춰 다시 판단한다.
  1. 전동 시트 작동 관련 이슈인지 재검수 - 전동 트렁크(테일게이트)·도어·선루프 등 다른 이슈는 추가로 배제한다.
  2. 전동 시트 작동 중 사고(끼임·눌림·부딪힘·부상·파손)가 발생했는지 재검수한다.
  3. 전동 시트 작동 관련 위험성·안전사고 우려를 언급했는지 재검수한다.
  4. 여러 다른 이슈를 함께 말한 글이라도, 전동 시트 작동의 위험성·사고 발생·안전사고 우려 내용이 조금이라도 포함되면 포함으로 본다.
  최종 포함 = 1번이 해당하고 2·3·4번 중 하나라도 해당하는 글.`],
];
const DEFAULT_AI_RULES = `## 담당자 추가 규칙\n${AI_RULE_BLOCKS.map(([, t]) => t).join("\n")}`;
const DEFAULT_RAW_START = "2024-04-15"; // 전차종 로데이터 엑셀 작성 시작일
// 첫 로데이터(4.15 월)에 담긴 게시일 시작: 직전 근무일 4.12(금)~주말 글부터 들어 있음 ('24년 로데이터 맨 앞 행들 확인)
const DEFAULT_RAW_COVER = "2024-04-12";
const DEFAULT_SEARCH_URL = "https://cafe.naver.com/f-e/cafes/{cafeId}/menus/0?viewType=L&ta=ARTICLE_COMMENT&page={page}&q={q}";
const DEFAULT_MAX_PAGES = 10;
const HEADER_ROW = 3; // 양식: 3행 머리글(B 순번 · C 차종 · D 동호회명 · E 게시일 · F 제목 · G URL · H 요약 · I 포함 여부 · J 누락 사유)
const STYLE_ROW = 4;
const OUT_NAME = "LX3·ME1·MX5 전동 시트 작동 위험 상황 관련 게시물_1차 검수.xlsx"; // 체크한 글 전체 + 관련도
const FINAL_NAME = "LX3·ME1·MX5 전동 시트 작동 위험 상황 관련 게시물_최종.xlsx"; // AI 최종 검수를 통과한 글
const RELEVANCE_RED = 70; // 관련도 이 값 이상은 빨강, 미만은 파랑 (엑셀 색은 seat-template.xlsx K열 조건부 서식 0.7)
const RAW_NAME = "LX3·ME1·MX5 전동 시트 작동 위험 상황 관련 게시물_전체 raw data.xlsx";
const EXCEL_FONT = "현대산스 Text"; // 받는 엑셀 글꼴 (양식 seat-template.xlsx 도 이 글꼴)
const BLUE = "FF0070C0"; // 포함 여부 Y
const RED = "FFE00000"; // 포함 여부 N
// 걸리는 시간 어림 (초): 검색 화면 한 페이지 · 글 하나
const SEC_PER_PAGE = 9;
const SEC_PER_ARTICLE = 12;

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본 · 권장)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴 · 정확도 낮음)"],
];
// AI_PRICE · WON_PER_USD · aiWonExact · fmtWon 은 seat-ui.js
const AI_BATCH = 6; // 한 번에 보내는 글 수
const AI_PARALLEL = 3;
const AI_BODY_CHARS = 4000; // 글마다 보내는 본문 길이

let items = []; // { key, car, cafeIndex, cafeName, slug, articleId, title, text, date, queries, related, checked, touched, mixedOk, body, bodyRead, bodyNote, summary, reason, by }
let compare = []; // 비교 파일 [{ id, name, kind: "trend"|"raw", keys, slugs, minDate, maxDate, rows }]
let clubIds = {}; // 영문 주소 → 카페 번호
let running = false;
let stopRequested = false;
let diagnostics = [];

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const SETTING_IDS = ["mustList", "monitorStart", "rawStart", "rawCover", "aiRules", "cafeList", "queries", "mixedQueries", "carWords", "rowWords", "riskWords", "exclude", "searchUrl", "maxPages"];
const SETTING_DEFAULTS = {
  mustList: DEFAULT_MUST,
  monitorStart: DEFAULT_MONITOR_START,
  rawStart: DEFAULT_RAW_START,
  rawCover: DEFAULT_RAW_COVER,
  aiRules: DEFAULT_AI_RULES,
  cafeList: DEFAULT_CAFES, queries: DEFAULT_QUERIES, mixedQueries: DEFAULT_MIXED_QUERIES, carWords: DEFAULT_CAR_WORDS,
  rowWords: DEFAULT_ROW_WORDS, riskWords: DEFAULT_RISK_WORDS, exclude: DEFAULT_EXCLUDE, searchUrl: DEFAULT_SEARCH_URL, maxPages: DEFAULT_MAX_PAGES,
};

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["seatSettings", "seatCars", "seatClubIds", "saveAsk", "seatTabFallback", "aiKey", "aiModel", "seatAiOn", "seatRuleBlocks"])
    .catch(() => ({}));
  const set = s.seatSettings || {};
  for (const id of SETTING_IDS) $(`#${id}`).value = set[id] ?? SETTING_DEFAULTS[id];
  // 새로 생긴 기본 규칙 항목을 저장된 메모에 한 번 덧붙인다 (사용자가 지운 항목은 다시 넣지 않음)
  const known = new Set(s.seatRuleBlocks || (set.aiRules !== undefined ? ["tobloomer-start"] : AI_RULE_BLOCKS.map(([id]) => id)));
  const add = AI_RULE_BLOCKS.filter(([id]) => !known.has(id));
  if (add.length && set.aiRules !== undefined) $("#aiRules").value = `${$("#aiRules").value.trimEnd()}\n${add.map(([, t]) => t).join("\n")}`;
  // 1.0.9 에서 덧붙인 로데이터 규칙 문구를 고친 문구로 (게시일 기준 '24.4.15 → 4.12, 로데이터에 있는 글 제외)
  const OLD_RAW_LINE = "  게시일이 '24.4.15 이전인 글의 누락 사유에는";
  if ($("#aiRules").value.includes(OLD_RAW_LINE)) {
    $("#aiRules").value = $("#aiRules").value.replace(OLD_RAW_LINE, "  첫 로데이터('24.4.15 월)는 직전 근무일 4.12(금)~주말 글부터 담았다. 게시일이 '24.4.12 이전이고 로데이터에도 없는 글의 누락 사유에는");
    add.push(["fix", ""]);
  }
  chrome.storage.local.set({ seatRuleBlocks: AI_RULE_BLOCKS.map(([id]) => id) }).catch(() => {});
  const rulesChanged = add.length && set.aiRules !== undefined; // 다른 칸을 모두 채운 뒤 저장 (아래 끝에서)
  $("#saveAsk").checked = !!s.saveAsk;
  chrome.storage.local.remove("saveFolder").catch(() => {}); // 예전 '다운로드 폴더 안 폴더 이름' 입력은 '폴더 선택'으로 바뀜
  $("#tabFallback").checked = s.seatTabFallback ?? true;
  clubIds = { ...KNOWN_CLUB_IDS, ...(s.seatClubIds || {}) };
  // LX3 화면에서 알아 둔 카페 번호 → 영문 주소도 쓴다
  for (const [id, slug] of Object.entries(await loadCafeSlugs())) if (!clubIds[slug.toLowerCase()]) clubIds[slug.toLowerCase()] = id;
  renderCars(s.seatCars || {});
  const sel = $("#aiModel");
  sel.innerHTML = "";
  for (const [id, label] of AI_MODELS) sel.add(new Option(label, id));
  if (s.aiModel && AI_MODELS.some(([id]) => id === s.aiModel)) sel.value = s.aiModel;
  $("#aiKey").value = s.aiKey || "";
  $("#aiOn").checked = !!s.seatAiOn;
  showAiStatus();
  if (rulesChanged) await saveSettings();
}

function saveSettings() {
  const set = {};
  for (const id of SETTING_IDS) set[id] = $(`#${id}`).value;
  set.maxPages = Math.max(1, Math.min(100, Number(set.maxPages) || DEFAULT_MAX_PAGES));
  set.searchUrl = normalizeSearchUrl(set.searchUrl);
  return chrome.storage.local
    .set({
      seatSettings: set,
      seatCars: carSettings(),
      seatTabFallback: $("#tabFallback").checked,
      saveAsk: $("#saveAsk").checked,
      aiKey: $("#aiKey").value.trim(),
      aiModel: $("#aiModel").value,
      seatAiOn: $("#aiOn").checked,
    })
    .catch(() => {});
}

function saveClubIds() {
  return chrome.storage.local.set({ seatClubIds: clubIds }).catch(() => {});
}

function words(text) {
  return String(text || "")
    .split(/[,\n]/)
    .map((w) => compactText(w))
    .filter(Boolean);
}

function compactText(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

// 동호회 목록 → [{ car, name, slug, mixed }]
function cafes() {
  const out = [];
  for (const line of $("#cafeList").value.split(/\r?\n/)) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) continue;
    const car = parts[0].toUpperCase();
    const slug = (parseArticleUrl(parts[2]).cafeUrl || parts[2].replace(/^https?:\/\/(?:m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, "")).trim();
    if (!CARS.some((c) => c.code === car) || !isSlug(slug)) continue;
    out.push({ car, name: parts[1] || slug, slug, mixed: /혼합/.test(parts[3] || "") });
  }
  return out;
}

// 차종 이름: { ME1: ["아이오닉9", …] }
function carWords() {
  const out = {};
  for (const line of $("#carWords").value.split(/\r?\n/)) {
    const [car, list] = line.split("|").map((p) => p.trim());
    if (car && list) out[car.toUpperCase()] = list.split(",").map((w) => w.trim()).filter(Boolean);
  }
  return out;
}

function renderCars(saved) {
  const tbody = $("#carRows");
  tbody.innerHTML = "";
  for (const car of CARS) {
    const s = saved[car.code] || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="checkbox" class="carOn"></td><td></td><td><input type="date" class="carStart"></td><td class="hint"></td>`;
    tr.dataset.car = car.code;
    tr.querySelector(".carOn").checked = s.on ?? true;
    tr.children[1].textContent = car.label;
    tr.querySelector(".carStart").value = s.start || car.start;
    tbody.appendChild(tr);
    for (const input of tr.querySelectorAll("input")) input.addEventListener("change", () => (saveSettings(), updateJobInfo()));
  }
  renderCafeInfo();
}

function carSettings() {
  const out = {};
  for (const tr of document.querySelectorAll("#carRows tr")) {
    out[tr.dataset.car] = { on: tr.querySelector(".carOn").checked, start: tr.querySelector(".carStart").value };
  }
  return out;
}

function carStart(code) {
  const v = carSettings()[code]?.start || CARS.find((c) => c.code === code).start;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function endDate() {
  const v = $("#endDate").value;
  if (!v) return new Date(8640000000000000);
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d + 1); // 끝 날짜 하루 전체 포함
}

function renderCafeInfo() {
  const list = cafes();
  for (const tr of document.querySelectorAll("#carRows tr")) {
    const names = list.filter((c) => c.car === tr.dataset.car).map((c) => c.name + (c.mixed ? "(혼합)" : ""));
    tr.children[3].textContent = names.length ? `${names.length}곳: ${names.join(", ")}` : "없음 (설정에서 추가)";
  }
  const tbody = $("#cafeInfo tbody");
  tbody.innerHTML = "";
  for (const c of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td></td><td><input type="text" class="slug" spellcheck="false" placeholder="자동 (숫자나 카페 주소 붙여넣기)"></td>`;
    tr.children[0].textContent = c.car;
    tr.children[1].textContent = c.name + (c.mixed ? " (혼합)" : "");
    tr.children[2].textContent = c.slug;
    const input = tr.querySelector("input");
    input.value = clubIds[c.slug.toLowerCase()] || "";
    input.addEventListener("change", async () => {
      const raw = input.value.trim();
      const v = raw ? clubIdFromInput(raw) : "";
      if (raw && !v) {
        input.value = clubIds[c.slug.toLowerCase()] || "";
        askAlert("카페 번호를 찾지 못했습니다. 숫자(예: 16624720)나 카페 '전체글보기' 화면의 주소를 붙여 넣어 주세요.");
        return;
      }
      input.value = v;
      if (v) clubIds[c.slug.toLowerCase()] = v;
      else delete clubIds[c.slug.toLowerCase()];
      await saveClubIds();
    });
    tbody.appendChild(tr);
  }
  updateJobInfo();
}

// 찾을 일 목록: 고른 차종의 동호회 × 검색어
function jobs() {
  const on = carSettings();
  const names = carWords();
  const plain = String($("#queries").value).split(/[,\n]/).map((q) => q.trim()).filter(Boolean);
  const mixed = String($("#mixedQueries").value).split(/[,\n]/).map((q) => q.trim()).filter(Boolean);
  const out = [];
  cafes().forEach((c, cafeIndex) => {
    if (!on[c.car]?.on) return;
    const carName = (names[c.car] || [c.car])[0];
    const qs = c.mixed ? mixed.map((q) => q.replace(/\{차종\}/g, carName)) : plain;
    for (const q of [...new Set(qs)]) out.push({ ...c, cafeIndex, q });
  });
  return out;
}

function updateJobInfo() {
  const list = jobs();
  const pages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  // 대부분 몇 페이지 안에서 끝나므로 최대치의 1/3 정도로 어림
  const sec = list.length * Math.max(1, Math.ceil(pages / 3)) * SEC_PER_PAGE;
  $("#jobInfo").textContent = list.length
    ? `동호회·검색어 ${list.length}개 · 예상 소요 시간 약 ${formatDuration(sec)} (글 수에 따라 달라짐)`
    : "찾을 차종을 고르세요.";
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}초`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
}

function normalizeSearchUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return DEFAULT_SEARCH_URL;
  if (u.includes("{cafeId}") && u.includes("{q}")) return u;
  u = u.replace(/\/cafes\/\d+\//, "/cafes/{cafeId}/").replace(/([?&](?:search\.)?clubid=)\d+/i, "$1{cafeId}");
  if (/[?&](?:q|query|search\.query)=/i.test(u)) u = u.replace(/([?&](?:q|query|search\.query)=)[^&#]*/i, "$1{q}");
  else u += `${u.includes("?") ? "&" : "?"}q={q}`;
  if (/[?&](?:search\.)?page=/i.test(u)) u = u.replace(/([?&](?:search\.)?page=)\d*/i, "$1{page}");
  else u += "&page={page}";
  return u;
}

function searchUrl(cafeId, q, page) {
  return normalizeSearchUrl($("#searchUrl").value)
    .replace("{cafeId}", cafeId)
    .replace("{q}", encodeURIComponent(q))
    .replace("{page}", String(page));
}

// ---------------------------------------------------------------------------
// 관련 글 판단: 시트 단어 + 위험 단어 (+ 혼합 동호회는 차종 이름), 관련 없는 단어가 있으면 제외
// ---------------------------------------------------------------------------

function judge(item, text) {
  const t = compactText(text);
  const names = (carWords()[item.car] || []).map(compactText);
  // '아이오닉' 의 '아이' 같은 차종 이름이 위험 단어(아이가 …)로 잡히지 않게 차종 이름을 먼저 뺀다
  let plain = t;
  for (const n of names) if (n) plain = plain.split(n).join(" ");
  const row = words($("#rowWords").value).some((w) => plain.includes(w));
  const risk = words($("#riskWords").value).some((w) => plain.includes(w));
  const exc = words($("#exclude").value).some((w) => plain.includes(w));
  const carOk = !item.mixed || names.some((n) => n && t.includes(n));
  return { related: row && risk && !exc && carOk, row, risk, exc, carOk };
}

function judgeNote(j) {
  if (j.related) return "";
  if (!j.carOk) return "차종 이름 없음(혼합 동호회)";
  if (j.exc) return "관련 없는 단어 있음";
  if (!j.row) return "시트 단어 없음";
  return "위험 단어 없음";
}

// ---------------------------------------------------------------------------
// 카페 번호 알아내기: 카페 첫 화면(cafe.naver.com/영문주소)을 열어 화면 속 /cafes/번호/ 단서를 모은다
// ---------------------------------------------------------------------------

function clubIdHintsInFrame() {
  const strong = []; // 이 화면 자체의 주소·틀 주소 (가장 믿을 만함)
  const weak = []; // 링크·스크립트·불러온 자료 주소 (다른 카페 링크가 섞일 수 있음)
  const RE = /\/cafes\/(\d{4,})\b|[?&](?:search\.)?club_?id=(\d{4,})|[?&]cafe_?id=(\d{4,})/gi;
  const add = (s, list) => {
    for (const m of String(s || "").matchAll(RE)) list.push(m[1] || m[2] || m[3]);
  };
  add(location.href, strong);
  for (const f of document.querySelectorAll("iframe[src]")) add(f.getAttribute("src"), strong);
  for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]', 'meta[property="al:android:url"]', 'meta[property="al:ios:url"]']) {
    const el = document.querySelector(sel);
    if (el) add(el.getAttribute("content") || el.getAttribute("href"), strong);
  }
  for (const a of document.querySelectorAll("a[href]")) add(a.getAttribute("href"), weak);
  for (const s of document.querySelectorAll("script:not([src])")) {
    const text = s.textContent || "";
    for (const m of text.matchAll(/["']?(?:clubId|cafeId|g_sClubId|clubid|cafeid)["']?\s*[:=]\s*["']?(\d{4,})/g)) strong.push(m[1]);
    add(text, weak);
  }
  try {
    for (const e of performance.getEntriesByType("resource")) add(e.name, weak);
  } catch {
    /* 무시 */
  }
  return { strong, weak, href: location.href };
}

// 여러 프레임의 단서 → 카페 번호 (화면 주소·틀 주소·스크립트 값 우선, 링크는 압도적으로 많을 때만)
function pickClubId(frames) {
  const score = new Map();
  for (const f of frames) {
    for (const id of f.strong || []) score.set(id, (score.get(id) || 0) + 10);
    for (const id of f.weak || []) score.set(id, (score.get(id) || 0) + 1);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [best, second] = ranked;
  if (best[1] >= 10) return best[0];
  return !second || best[1] >= second[1] * 3 ? best[0] : null;
}

// 비교 파일에 있는 이 카페의 글 하나 (글 화면은 주소가 /cafes/카페번호/articles/글번호 로 바뀌는 경우가 많다)
function sampleArticle(slug) {
  const prefix = `${slug.toLowerCase()}/`;
  for (const f of compare) {
    const k = f.keys.find((x) => x.startsWith(prefix));
    if (k) return k.slice(prefix.length);
  }
  const it = items.find((x) => x.slug.toLowerCase() === slug.toLowerCase());
  return it ? it.articleId : null;
}

async function clubIdFrom(url, mode) {
  return withTab(url, async (where) => {
    let frames = [];
    for (let i = 0; i < 6; i++) {
      frames = await runInFrames(where, clubIdHintsInFrame);
      const id = pickClubId(frames);
      if (id) return { id };
      await sleep(1500);
    }
    return { id: null, snapshot: await runInFrames(where, snapshotInFrame), hints: frames };
  }, { mode }).catch((e) => ({ id: null, error: String(e?.message || e) }));
}

// 카페 번호 알아내기: 카페 첫 화면 → 그 카페 글 하나 (숨긴 화면에서 못 읽으면 뒤쪽 탭으로)
async function resolveClubId(slug) {
  const known = clubIds[slug.toLowerCase()];
  if (known) return known;
  const art = sampleArticle(slug);
  const urls = [`https://cafe.naver.com/${slug}`, ...(art ? [`https://cafe.naver.com/${slug}/${art}`] : [])];
  const tries = urls.map((u) => [u, "frame"]);
  if ($("#tabFallback").checked) tries.push(...urls.map((u) => [u, "tab"]));
  for (const [url, mode] of tries) {
    log(`  ↳ ${slug} 카페 번호 확인 중: ${url} (${mode === "tab" ? "뒤쪽 탭" : "숨긴 화면"})`);
    const res = await clubIdFrom(url, mode);
    if (res.id) {
      clubIds[slug.toLowerCase()] = res.id;
      await saveClubIds();
      await saveCafeSlug(res.id, slug);
      log(`  ↳ ${slug} 카페 번호: ${res.id}`);
      return res.id;
    }
    diagnostics.push({ clubId: slug, url, mode, error: res.error, hints: res.hints, frames: res.snapshot });
    await sleep(randomBetween(CAFE_PAGE_DELAY));
  }
  return null;
}

// 카페 번호 칸: 숫자 또는 카페 주소(…/cafes/12345/… · clubid=12345)를 붙여 넣으면 번호만 뽑는다
function clubIdFromInput(v) {
  const s = String(v || "").trim();
  const m = s.match(/\/cafes\/(\d{4,})/) || s.match(/club_?id=(\d{4,})/i) || s.match(/^(\d{4,})$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 화면 읽기
// ---------------------------------------------------------------------------

function log(text) {
  const box = $("#log");
  box.hidden = false;
  const line = document.createElement("div");
  line.textContent = text;
  box.appendChild(line);
  while (box.childElementCount > 2000) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

async function scanSearchPage(url) {
  const res = await scanSearchPageIn(url, "frame").catch(() => ({ items: [], noResult: false, login: false }));
  if (!res.items.length && !res.noResult && !res.login && $("#tabFallback").checked) {
    log("  ↳ 숨긴 화면에서 글을 못 읽어 뒤쪽 탭으로 다시 확인합니다");
    return scanSearchPageIn(url, "tab").catch(() => ({ items: [], noResult: false, login: false }));
  }
  return res;
}

async function scanSearchPageIn(url, mode) {
  return withTab(url, async (where) => {
    let last = { items: [], noResult: false, login: false };
    let emptyInRow = 0;
    for (let i = 0; i < 14; i++) {
      const frames = await runInFrames(where, scanSearchInFrame);
      last = {
        items: frames.flatMap((f) => f.items || []),
        noResult: frames.some((f) => f.noResult),
        login: frames.some((f) => /nid\.naver\.com/.test(f.href || "")),
      };
      if (last.items.length || last.login) break;
      emptyInRow = last.noResult ? emptyInRow + 1 : 0;
      if (emptyInRow >= 4) break;
      await sleep(1500);
    }
    if (!last.items.length && !last.login && !last.noResult) last.snapshot = await runInFrames(where, snapshotInFrame);
    return last;
  }, { mode });
}

// 게시글 화면: 제목 · 작성 시간 · 본문
function readArticleBodyInFrame() {
  const q = (sel) => document.querySelector(sel);
  const text = String(document.body?.innerText || "");
  if (/카페\s*멤버만|멤버에게만\s*공개|가입\s*후\s*(?:이용|열람)|등급이\s*되어야/.test(text) && !q(".se-main-container, .ContentRenderer, .article_viewer")) {
    return { found: true, locked: true, href: location.href };
  }
  if (/삭제되었거나\s*없는\s*게시글|존재하지\s*않는\s*게시글|삭제된\s*게시글/.test(text)) return { found: true, deleted: true, href: location.href };
  const bodyEl = q(".se-main-container") || q(".ContentRenderer") || q(".article_viewer") || q("#postViewArea") || q("#tbody") || q(".article_container");
  const titleEl = q(".ArticleTitle .title_text") || q("h3.title_text") || q(".title_text") || q(".tit-box .b");
  if (!bodyEl) return { found: false, href: location.href };
  const re = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2})/;
  let dateText = "";
  for (const el of document.querySelectorAll(".article_info .date, .ArticleWriterProfile .date, .WriterInfo .date, [class*='article'] .date, .date")) {
    const m = (el.innerText || "").match(re);
    if (m) {
      dateText = m[0];
      break;
    }
  }
  const body = String(bodyEl.innerText || "")
    .replace(/[​ ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { found: true, title: titleEl ? String(titleEl.innerText || "").trim() : "", body: body.slice(0, 8000), dateText, href: location.href };
}

async function readArticleBody(url) {
  const tryIn = (mode) =>
    withTab(url, async (where) => {
      for (let i = 0; i < 8; i++) {
        const frames = await runInFrames(where, readArticleBodyInFrame);
        const hit = frames.find((f) => f.found);
        if (hit) return hit;
        if (frames.some((f) => /nid\.naver\.com/.test(f.href || ""))) return { found: false, login: true };
        await sleep(1500);
      }
      return { found: false };
    }, { mode }).catch(() => ({ found: false }));
  const res = await tryIn("frame");
  if (!res.found && !res.login && $("#tabFallback").checked) return tryIn("tab");
  return res;
}

function articleUrl(item) {
  return shortArticleUrl(item.slug, item.articleId);
}

// ---------------------------------------------------------------------------
// 1. 게시물 찾기 (동호회 × 검색어, 중단되면 이어서)
// ---------------------------------------------------------------------------

async function search(resume = null) {
  if (running) return;
  const list = resume ? resume.jobs : jobs();
  if (!list.length) return setSummary("찾을 차종을 고르고, 설정에 동호회와 검색어가 있는지 확인해 주세요.", "err");
  await saveSettings();
  await checkLogin();
  startBusy();
  diagnostics = [];
  $("#diag").hidden = true;
  $("#log").innerHTML = "";
  const maxPages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  const end = endDate();
  const t0 = Date.now();
  let pagesDone = 0;
  let found = 0;
  let loginNeeded = false;
  const failed = [];
  const noClubId = new Set();
  const startAt = resume ? resume.next : 0;
  if (resume) log(`· 중단된 곳부터 이어서 찾습니다 (${startAt + 1}/${list.length}번째 동호회·검색어부터)`);

  for (let ji = startAt; ji < list.length && !stopRequested; ji++) {
    const job = list[ji];
    const label = `${job.car} ${job.name} · '${job.q}'`;
    const remain = estimateRemaining(t0, ji - startAt, list.length - startAt, (list.length - ji) * 3 * SEC_PER_PAGE);
    showBusy(`게시물 찾는 중 ${ji + 1}/${list.length} · ${label}${remain} — 끝날 때까지 이 탭을 닫지 마세요`, ji, list.length, "게시물 찾는 중");
    setSummary(`찾는 중… ${ji + 1}/${list.length} · ${label}`);
    if (noClubId.has(job.slug)) continue; // 번호를 못 알아낸 카페의 나머지 검색어는 건너뜀
    const cafeId = await resolveClubId(job.slug);
    if (!cafeId) {
      noClubId.add(job.slug);
      log(
        `✖ ${job.name}(${job.slug}): 카페 번호를 알아내지 못해 이 동호회는 건너뜁니다. ` +
          `크롬에서 이 카페의 '전체글보기'를 열고 주소창 주소(…/cafes/숫자/…)를 복사해 설정의 '카페 번호' 칸에 붙여 넣은 뒤 다시 찾아 주세요.`,
      );
      failed.push(`${job.name} (카페 번호)`);
      $("#diag").hidden = false;
      continue;
    }
    renderCafeInfoIds();
    const start = carStart(job.car);
    let prevKeys = "";
    for (let page = 1; page <= maxPages && !stopRequested; page++) {
      const res = await scanSearchPage(searchUrl(cafeId, job.q, page));
      pagesDone++;
      if (res.login) {
        loginNeeded = true;
        log(`✖ ${job.name}: 네이버 로그인이 필요합니다`);
        failed.push(label);
        break;
      }
      const pageItems = res.items.filter((x) => !x.cafeId || x.cafeId === cafeId);
      const keys = pageItems.map((x) => x.articleId).join(",");
      if (!pageItems.length || keys === prevKeys) {
        if (!pageItems.length && res.snapshot) diagnostics.push({ job: label, page, url: searchUrl(cafeId, job.q, page), frames: res.snapshot });
        if (!pageItems.length && !res.noResult && page === 1) failed.push(label);
        log(`· ${label}: ${page}페이지 ${pageItems.length ? "(앞 페이지와 같음 - 끝)" : res.noResult ? "검색 결과 없음" : "글 목록을 읽지 못함"}`);
        break;
      }
      prevKeys = keys;
      let older = 0;
      let dated = 0;
      let added = 0;
      for (const x of pageItems) {
        const parsed = parseCafeDate(x.dateText);
        if (parsed) dated++;
        const day = parsed ? new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate()) : null;
        if (day && day < start) {
          older++;
          continue;
        }
        if (day && day >= end) continue;
        const key = `${job.slug}/${x.articleId}`.toLowerCase();
        const have = items.find((it) => it.key === key);
        if (have) {
          if (!have.queries.includes(job.q)) have.queries.push(job.q);
          continue;
        }
        const item = {
          key, car: job.car, cafeIndex: job.cafeIndex, cafeName: job.name, slug: job.slug, mixed: job.mixed, articleId: x.articleId,
          title: x.title, text: x.text, date: parsed ? parsed.date.getTime() : null, hasTime: !!parsed?.hasTime, queries: [job.q],
          checked: false, touched: false, body: "", bodyRead: false, bodyNote: "", summary: "", reason: "", by: "",
        };
        const j = judge(item, `${item.title} ${item.text}`);
        item.related = j.related;
        item.note = judgeNote(j);
        item.checked = j.related;
        items.push(item);
        added++;
        found++;
      }
      log(`· ${label}: ${page}페이지 ${pageItems.length}개 중 새 글 ${added}개`);
      renderResults();
      if (dated && older === dated) break; // 이 페이지가 모두 시작일 이전 → 다음 페이지는 더 이전
      if (page < maxPages) await sleep(randomBetween(CAFE_PAGE_DELAY));
    }
    await saveItems();
    if (!stopRequested) await saveResume("seat", { jobs: list, next: ji + 1 });
    if (ji + 1 < list.length && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }

  if (!stopRequested) await clearResume("seat");
  const must = stopRequested ? null : await addMustPosts();
  $("#diag").hidden = !diagnostics.length;
  renderResults();
  const checked = items.filter((x) => x.checked).length;
  setSummary(
    `${stopRequested ? "중지됨 (다시 '게시물 찾기'를 누르면 이어서) - " : ""}새로 찾은 글 ${found}개 · 전체 ${items.length}개 중 관련 글로 체크 ${checked}개 · ` +
      `${pagesDone}페이지, ${formatDuration((Date.now() - t0) / 1000)} 걸림` +
      (failed.length ? ` · 못 읽은 곳 ${failed.length}개(아래 기록 참고)` : "") +
      (loginNeeded ? " · 로그인이 필요합니다" : "") +
      (must ? ` · 꼭 넣을 글 ${must.length}개 중 검색으로 찾음 ${must.filter((m) => m.bySearch).length}개` : ""),
    loginNeeded || failed.length ? "err" : "ok",
  );
  endBusy();
}

// 꼭 넣을 글: [{ url, car }] (줄 앞 'LX3 ' 처럼 차종을 붙일 수 있음)
function mustList() {
  const out = [];
  for (const line of String($("#mustList").value).split(/\r?\n/)) {
    const m = line.trim().match(/^(?:([A-Za-z]{2}\d)\s*[|,:]?\s*)?(https?:\/\/\S+)$/);
    if (m) out.push({ car: m[1] ? m[1].toUpperCase() : null, url: m[2] });
  }
  return out;
}

function slugOfClubId(id) {
  return Object.entries(clubIds).find(([, v]) => v === id)?.[0] || null;
}

// 꼭 넣을 글을 결과에 넣는다. 검색으로 이미 찾은 글이면 체크만, 아니면 글을 열어 제목·날짜·본문을 읽어 넣는다.
// → [{ url, key, bySearch, note }] (기록창에 하나씩 알림)
async function addMustPosts() {
  const list = mustList();
  if (!list.length) return null;
  const report = [];
  log(`· 꼭 넣을 글 ${list.length}개를 확인합니다`);
  for (const [i, m] of list.entries()) {
    if (stopRequested) break;
    showBusy(`꼭 넣을 글 확인 중 ${i + 1}/${list.length}`, i, list.length, "꼭 넣을 글 확인 중");
    let ids = parseArticleUrl(m.url);
    let slug = ids.cafeUrl || (ids.cafeId && slugOfClubId(ids.cafeId));
    let res = null;
    if (!slug || !ids.articleId) {
      // naver.me 짧은 주소 등: 열어서 실제 주소를 본다
      res = await readArticleBody(m.url);
      ids = parseArticleUrl(res.href || "");
      slug = ids.cafeUrl || (ids.cafeId && slugOfClubId(ids.cafeId));
    }
    if (!slug || !ids.articleId) {
      log(`✖ 꼭 넣을 글 주소를 알아보지 못했습니다: ${m.url} (cafe.naver.com/카페주소/글번호 모양으로 넣어 주세요)`);
      report.push({ url: m.url, bySearch: false, note: "주소 확인 못 함" });
      continue;
    }
    const key = `${slug}/${ids.articleId}`.toLowerCase();
    const cafe = cafes().find((c) => c.slug.toLowerCase() === slug.toLowerCase());
    let item = items.find((x) => x.key === key);
    if (item) {
      const wasChecked = item.checked;
      item.must = true;
      item.checked = true;
      item.touched = true;
      item.mustNote = wasChecked ? "검색으로 찾음" : "검색엔 나왔지만 단어 판단으로 체크 안 됨";
      report.push({ url: m.url, key, bySearch: true, note: item.mustNote });
    } else {
      if (!res) {
        await sleep(randomBetween(CAFE_ARTICLE_DELAY));
        res = await readArticleBody(shortArticleUrl(slug, ids.articleId));
      }
      const parsed = res.found ? parseCafeDate(res.dateText) : null;
      item = {
        key, car: m.car || cafe?.car || "?", cafeIndex: cafe ? cafes().indexOf(cafe) : 999, cafeName: cafe?.name || slug, slug, mixed: !!cafe?.mixed,
        articleId: ids.articleId, title: res.title || `(제목 확인 못 함) ${slug}/${ids.articleId}`, text: "", date: parsed ? parsed.date.getTime() : null,
        hasTime: !!parsed?.hasTime, queries: [], checked: true, touched: true, must: true, related: true, note: "",
        body: res.body || "", bodyRead: !!res.found && !res.locked && !res.deleted,
        bodyNote: res.login ? "로그인 필요 - 본문 못 읽음" : res.locked ? "멤버 공개 글 - 본문 못 봄" : res.deleted ? "삭제된 글" : res.found ? "" : "본문을 읽지 못함",
        summary: "", reason: "", by: "",
      };
      const before = parsed && cafe && parsed.date < carStart(cafe.car);
      item.mustNote = `검색으로 못 찾아 직접 넣음${before ? " (양산 시점 이전 글)" : ""}`;
      items.push(item);
      report.push({ url: m.url, key, bySearch: false, note: item.mustNote });
    }
    log(`· 꼭 넣을 글 ${key}: ${item.mustNote}${item.title ? ` - ${item.title}` : ""}`);
  }
  await saveItems();
  hideBusy();
  return report;
}

function renderCafeInfoIds() {
  const list = cafes();
  document.querySelectorAll("#cafeInfo tbody input").forEach((input, i) => {
    if (!input.value && list[i]) input.value = clubIds[list[i].slug.toLowerCase()] || "";
  });
}

// 지금까지의 속도로 남은 시간 어림 → " · 남은 시간 약 12분"
function estimateRemaining(t0, done, total, fallbackSec) {
  const spent = (Date.now() - t0) / 1000;
  const sec = done > 0 ? (spent / done) * (total - done) : fallbackSec;
  return total - done > 0 ? ` · 남은 시간 약 ${formatDuration(sec)}` : "";
}

// ---------------------------------------------------------------------------
// 2. 비교 파일 (온라인 동향 · 로데이터)
// ---------------------------------------------------------------------------

// 같은 글인지 비교하는 열쇠: 영문 카페 주소 + 글번호 (카페 번호 주소는 아는 경우 영문 주소로)
function postKey(url) {
  const ids = parseArticleUrl(String(url || ""));
  if (!ids.articleId) return null;
  let cafe = ids.cafeUrl;
  if (!cafe && ids.cafeId) cafe = Object.entries(clubIds).find(([, id]) => id === ids.cafeId)?.[0] || `#${ids.cafeId}`;
  return cafe ? `${cafe}/${ids.articleId}`.toLowerCase() : null;
}

async function loadCompare() {
  compare = (await chrome.storage.local.get("seatCompare").catch(() => ({}))).seatCompare || [];
  await loadBuiltinCompare();
  await loadShortMap();
  for (const f of compare) f.keySet = new Set(f.keys);
  if (applyShortMap()) await saveCompare();
}

// 함께 받은 비교 자료(compare-data.json: 미리 전달받은 온라인 동향·로데이터 파일의 카페 글 주소)를 처음 한 번 등록한다.
// 사내 자료라 공개 저장소에는 올리지 않고 전달용 압축 파일에만 넣는다(없으면 건너뜀).
// 자료 버전이 바뀌면 그 파일들만 새 것으로 바꾸고, 직접 등록한 파일은 그대로 둔다.
async function loadBuiltinCompare() {
  let data;
  try {
    const resp = await fetch(chrome.runtime.getURL("compare-data.json"));
    if (!resp.ok) return;
    data = await resp.json();
  } catch {
    return;
  }
  const { seatBuiltinVersion } = await chrome.storage.local.get("seatBuiltinVersion").catch(() => ({}));
  if (!data?.files?.length || seatBuiltinVersion === data.version) return;
  const names = new Set(data.files.map((f) => f.name));
  compare = compare.filter((f) => !f.builtin && !names.has(f.name)).concat(data.files.map((f) => ({ ...f, builtin: true })));
  compare.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  await saveCompare();
  await chrome.storage.local.set({ seatBuiltinVersion: data.version }).catch(() => {});
}

function saveCompare() {
  return chrome.storage.local.set({ seatCompare: compare.map(({ keySet, ...f }) => f) }).catch(() => {});
}

function excelDate(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).getTime();
  const m = String(v || "").match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

async function readCompareFile(file) {
  const wb = await XlsxTemplate.Workbook.open(new Uint8Array(await file.arrayBuffer()));
  const keys = new Set();
  const slugs = {};
  let trend = 0;
  let raw = 0;
  let minDate = null;
  let maxDate = null;
  let rows = 0;
  const shorts = new Set(); // naver.me 짧은 주소 (우리 동호회·차종 행만) - 나중에 '짧은 주소 풀기'로 카페 주소로 바꿔 비교
  let shortAll = 0;
  for (const sheet of wb.sheetNames()) {
    const data = await wb.readRows(sheet);
    // 머리글: 첫 5행 안에서 '게시일'·'게시글 위치' 같은 글자가 있는 행
    let dateCol = null;
    let nameCol = null;
    let carCol = null;
    for (const r of data.slice(0, 5)) {
      const heads = Object.entries(r.cells).map(([c, v]) => [c, String(v).replace(/\s+/g, "")]);
      if (heads.some(([, v]) => /불만구분|^중복$|^재원$/.test(v))) trend++;
      if (heads.some(([, v]) => /^주요내용$|^커뮤니티명$/.test(v))) raw++;
      const d = heads.find(([, v]) => /^게시일/.test(v));
      if (d && !dateCol) dateCol = d[0];
      const n = heads.find(([, v]) => /^(?:동호회명|커뮤니티명|매체명)$/.test(v));
      if (n && !nameCol) nameCol = n[0];
      const c = heads.find(([, v]) => v === "차종");
      if (c && !carCol) carCol = c[0];
    }
    for (const r of data) {
      let hit = false;
      for (const v of Object.values(r.cells)) {
        if (typeof v !== "string") continue;
        const short = v.match(SHORT_LINK_RE);
        if (short) {
          shortAll++;
          if (shortRowWanted(nameCol && r.cells[nameCol], carCol && r.cells[carCol])) shorts.add(short[1]);
          hit = true;
          continue;
        }
        if (!v.includes("cafe.naver.com")) continue;
        const k = postKey(v);
        if (!k) continue;
        keys.add(k);
        const slug = k.split("/")[0];
        slugs[slug] = (slugs[slug] || 0) + 1;
        hit = true;
      }
      if (!hit) continue;
      rows++;
      const d = dateCol ? excelDate(r.cells[dateCol]) : null;
      if (d) {
        minDate = minDate === null ? d : Math.min(minDate, d);
        maxDate = maxDate === null ? d : Math.max(maxDate, d);
      }
    }
  }
  const kind = trend > raw ? "trend" : raw > trend ? "raw" : /raw|로\s*데이터/i.test(file.name) ? "raw" : "trend";
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, kind, keys: [...keys], slugs, minDate, maxDate, rows,
    shorts: [...shorts], shortAll,
  };
}

// ---------------------------------------------------------------------------
// naver.me 짧은 주소 풀기: 짧은 주소 서비스에 '어디로 넘어가는지'만 묻는다 (카페 글은 열지 않고, 네이버 로그인 정보도 보내지 않음)
// 풀린 결과(짧은 주소 → 카페 영문 주소/글번호)는 저장해 두어 다시 묻지 않는다.
// ---------------------------------------------------------------------------

const SHORT_LINK_RE = /naver\.me\/([A-Za-z0-9]+)/;
const SHORT_PARALLEL = 4;
const SHORT_DELAY = [150, 350];
let shortMap = {}; // 짧은 주소 코드 → "카페주소/글번호" (카페 글이 아니거나 못 풀면 "")

// 짧은 주소가 있는 행 중 풀 것: 우리 동호회 이름이나 우리 차종(LX3·ME1·MX5)인 행, 둘 다 모르는 행
function shortRowWanted(name, car) {
  const n = compactText(name);
  const c = String(car || "").trim().toUpperCase();
  if (!n && !c) return true;
  if (/^(LX3|ME1?|MX5)\b/.test(c)) return true;
  return !!n && cafes().some((x) => compactText(x.name) === n);
}

async function loadShortMap() {
  shortMap = (await chrome.storage.local.get("seatShortMap").catch(() => ({}))).seatShortMap || {};
}

function saveShortMap() {
  return chrome.storage.local.set({ seatShortMap: shortMap }).catch(() => {});
}

// 아직 풀지 않은 짧은 주소
function pendingShorts() {
  const out = new Set();
  for (const f of compare) for (const code of f.shorts || []) if (!(code in shortMap)) out.add(code);
  return [...out];
}

// 풀린 짧은 주소를 각 비교 파일의 글 목록에 넣는다
function applyShortMap() {
  let changed = false;
  for (const f of compare) {
    for (const code of f.shorts || []) {
      const k = shortMap[code];
      if (!k || f.keySet.has(k)) continue;
      f.keySet.add(k);
      f.keys.push(k);
      const slug = k.split("/")[0];
      f.slugs[slug] = (f.slugs[slug] || 0) + 1;
      changed = true;
    }
  }
  return changed;
}

// 짧은 주소 하나 → 넘어가는 주소. 확장의 webRequest 로 첫 응답의 상태·Location 머리글만 보고 따라가지 않는다.
const shortResponses = new Map(); // 요청 주소 → { status, loc }
if (chrome.webRequest?.onHeadersReceived) {
  chrome.webRequest.onHeadersReceived.addListener(
    (d) => {
      const loc = (d.responseHeaders || []).find((h) => h.name.toLowerCase() === "location")?.value;
      shortResponses.set(d.url, { status: d.statusCode, loc: loc ? new URL(loc, d.url).href : "" });
    },
    { urls: ["https://naver.me/*"] },
    ["responseHeaders"],
  );
}

// → "카페주소/글번호" · ""(카페 글이 아님, 또는 만료·삭제되어 넘어가지 않는 주소) · null(응답 없음 - 다음에 다시)
async function resolveShort(code) {
  let url = `https://naver.me/${code}`;
  for (let hop = 0; hop < 3; hop++) {
    shortResponses.delete(url);
    try {
      await fetch(url, { redirect: "manual", credentials: "omit", cache: "no-store" });
    } catch {
      /* 아래에서 판단 */
    }
    // 응답 머리글 알림(webRequest)이 fetch 보다 조금 늦게 올 수 있어 잠깐 기다린다
    for (let i = 0; i < 20 && !shortResponses.has(url); i++) await sleep(50);
    const res = shortResponses.get(url);
    shortResponses.delete(url);
    if (!res || res.status >= 500 || res.status === 429) return null; // 응답 없음·서버 오류·요청 많음 → 다시 시도할 것
    if (!res.loc) return ""; // 응답은 왔는데 넘어가지 않음: 만료·삭제된 짧은 주소
    const key = /cafe\.naver\.com/.test(res.loc) ? postKey(res.loc) : null;
    if (key) return key;
    if (!/^https:\/\/naver\.me\//.test(res.loc)) return ""; // 카페 글이 아닌 곳으로 넘어감
    url = res.loc;
  }
  return "";
}

async function resolveShorts() {
  if (running) return;
  const todo = pendingShorts();
  if (!todo.length) return renderShortInfo();
  startBusy();
  const t0 = Date.now();
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !stopRequested) {
      const code = todo[next++];
      const key = await resolveShort(code);
      if (key === null) failed++;
      else shortMap[code] = key;
      done++;
      if (done % 50 === 0 || done === todo.length) {
        showBusy(`짧은 주소 푸는 중 ${done.toLocaleString()}/${todo.length.toLocaleString()}${estimateRemaining(t0, done, todo.length, 0)}`, done, todo.length, "짧은 주소 푸는 중");
        await saveShortMap();
      }
      await sleep(randomBetween(SHORT_DELAY));
    }
  };
  const before = new Map(items.map((x) => [x.key, inclusion(x)]));
  showBusy(`짧은 주소 푸는 중 0/${todo.length.toLocaleString()}`, 0, todo.length, "짧은 주소 푸는 중");
  await Promise.all(Array.from({ length: SHORT_PARALLEL }, worker));
  await saveShortMap();
  if (applyShortMap()) await saveCompare();
  endBusy();
  renderCompare();
  renderResults();
  // 포함 여부(Y/N)가 바뀐 글 (체크 수는 바뀌지 않음 - 체크는 관련 글 판단, Y/N 은 동향·로데이터에 있었는지)
  const changed = items.filter((x) => {
    const a = before.get(x.key);
    const b = inclusion(x);
    return a && (a.trend !== b.trend || a.raw !== b.raw);
  });
  const changedChecked = changed.filter((x) => x.checked).length;
  setSummary(
    `${stopRequested ? "중지됨 - " : "✔ "}짧은 주소 ${done.toLocaleString()}개를 확인했습니다 (${formatDuration((Date.now() - t0) / 1000)} 걸림) · ` +
      `포함 여부(Y/N)가 바뀐 글 ${changed.length.toLocaleString()}개 (그중 체크한 글 ${changedChecked.toLocaleString()}개)` +
      (failed ? ` · 응답이 없어 못 푼 ${failed.toLocaleString()}개는 다시 누르면 다시 시도합니다` : ""),
    failed ? "err" : "ok",
  );
  stopRequested = false;
}

function deadShorts() {
  const codes = new Set(compare.flatMap((f) => f.shorts || []));
  return [...codes].filter((c) => shortMap[c] === "").length;
}

// 2·3번 접기·펼치기: 접혀 있어도 제목 옆에 상태를 보여주고, 사용자가 접거나 펼친 상태는 기억한다
// (기억한 상태가 없으면 준비가 덜 된 칸만 펼침)
function panelRemembered(id) {
  try {
    return localStorage.getItem(`seatPanel_${id}`);
  } catch {
    return null;
  }
}

function setupPanel(id, needsAttention) {
  const el = $(`#${id}`);
  const saved = panelRemembered(id);
  el.open = saved ? saved === "open" : needsAttention;
  el.addEventListener("toggle", () => {
    try {
      localStorage.setItem(`seatPanel_${id}`, el.open ? "open" : "closed");
    } catch {
      /* 무시 */
    }
  });
}

function renderPanelStates() {
  if (typeof updateCounts === "function" && $("#readBodies")) updateCounts();
  const cs = $("#compareState");
  if (cs) {
    const pend = pendingShorts().length;
    const kinds = { trend: 0, raw: 0 };
    for (const f of compare) kinds[f.kind]++;
    cs.textContent = !compare.length
      ? "비교 파일 없음 - 포함 여부가 모두 N / N"
      : `파일 ${compare.length}개 (동향 ${kinds.trend} · 로데이터 ${kinds.raw}) · ${pend ? `짧은 주소 ${pend.toLocaleString()}개 안 풀림` : "짧은 주소 모두 확인"}`;
    cs.className = `panel-state ${!compare.length || pend ? "err" : "ok"}`;
  }
  const as = $("#aiState");
  if (as) {
    const key = $("#aiKey").value.trim();
    const model = AI_MODELS.find(([id]) => id === $("#aiModel").value)?.[1].split(" (")[0] || "";
    as.textContent = !key ? "API 키 없음 - 규칙으로 작성" : $("#aiOn").checked ? `✔ 키 저장됨 · ${model} 사용` : `키 저장됨 · AI 꺼짐(규칙으로 작성)`;
    as.className = `panel-state ${key && $("#aiOn").checked ? "ok" : "err"}`;
  }
}

function renderShortInfo() {
  renderPanelStates();
  const box = $("#shortInfo");
  if (!box) return;
  const total = new Set(compare.flatMap((f) => f.shorts || [])).size;
  const pending = pendingShorts().length;
  box.hidden = !total;
  $("#shortText").textContent = pending
    ? `비교 파일에 naver.me 짧은 주소 ${total.toLocaleString()}개(우리 동호회·차종)가 있고, 그중 ${pending.toLocaleString()}개를 아직 풀지 않았습니다. 풀어야 그 글들도 포함 여부(Y)에 잡힙니다. (예상 소요 시간 약 ${formatDuration((pending / SHORT_PARALLEL) * 0.6)})`
    : `✔ 짧은 주소 ${total.toLocaleString()}개를 모두 확인했습니다 (카페 글 ${Object.values(shortMap).filter(Boolean).length.toLocaleString()}개` +
      `${deadShorts() ? ` · 카페 글이 아니거나 만료·삭제되어 열리지 않는 주소 ${deadShorts().toLocaleString()}개` : ""}).`;
  $("#shortText").className = pending ? "hint err" : "hint ok";
  $("#resolveShorts").hidden = !pending;
}

async function addCompareFiles(files) {
  const box = $("#compareInfo");
  box.className = "hint";
  let added = 0;
  for (const [i, file] of [...files].entries()) {
    box.textContent = `파일 읽는 중… (${i + 1}/${files.length}) ${file.name} - 큰 파일은 몇십 초 걸립니다`;
    showBusy(`비교 파일 읽는 중 ${i + 1}/${files.length} · ${file.name}`, i, files.length, "비교 파일 읽는 중");
    try {
      const f = await readCompareFile(file);
      f.keySet = new Set(f.keys);
      compare = compare.filter((x) => x.name !== f.name); // 같은 이름은 바꿔 넣기
      compare.push(f);
      applyShortMap(); // 이미 풀어 둔 짧은 주소는 바로 반영
      added++;
    } catch (e) {
      box.className = "hint err";
      box.textContent = `${file.name} 을(를) 읽지 못했습니다: ${e.message}`;
      hideBusy();
      return;
    }
  }
  hideBusy();
  compare.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  await saveCompare();
  box.className = "hint ok";
  box.textContent = `✔ ${added}개 파일을 등록했습니다.`;
  $("#compareFiles").value = "";
  renderCompare();
  renderResults();
}

function renderCompare() {
  const tbody = $("#compareTable tbody");
  tbody.innerHTML = "";
  $("#compareTable").hidden = !compare.length;
  const day = (t) => (t === null || t === undefined ? "?" : new Date(t).toISOString().slice(0, 10));
  for (const f of compare) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td><select><option value="trend">온라인 동향</option><option value="raw">로데이터</option></select></td><td></td><td class="nowrap"></td><td><button class="small danger">삭제</button></td>`;
    tr.children[0].textContent = f.name + (f.builtin ? " (미리 등록)" : "");
    const sel = tr.querySelector("select");
    sel.value = f.kind;
    sel.addEventListener("change", async () => {
      f.kind = sel.value;
      await saveCompare();
      renderResults();
    });
    tr.children[2].textContent = `${f.keys.length.toLocaleString()}개`;
    tr.children[3].textContent = `${day(f.minDate)} ~ ${day(f.maxDate)}`;
    tr.querySelector("button").addEventListener("click", async () => {
      if (!(await askConfirm(`${f.name} 을(를) 비교 파일에서 뺄까요?`))) return;
      compare = compare.filter((x) => x !== f);
      await saveCompare();
      renderCompare();
      renderResults();
    });
    tbody.appendChild(tr);
  }
  if (!compare.length) $("#compareInfo").textContent = "등록된 비교 파일이 없습니다. 비교 파일이 없으면 포함 여부는 N / N 으로 씁니다.";
  renderShortInfo();
}

// → { trend: bool, raw: bool, trendCafe: 이 동호회가 온라인 동향 파일에 나온 적 있는지, trendRange: 게시일이 동향 파일 기간 안인지 }
function inclusion(item) {
  const of = (kind) => compare.filter((f) => f.kind === kind);
  const has = (kind) => of(kind).some((f) => f.keySet.has(item.key));
  const trendFiles = of("trend");
  const slug = item.slug.toLowerCase();
  const min = Math.min(...trendFiles.map((f) => f.minDate ?? Infinity));
  const max = Math.max(...trendFiles.map((f) => f.maxDate ?? -Infinity));
  const d = item.date ? Date.UTC(new Date(item.date).getFullYear(), new Date(item.date).getMonth(), new Date(item.date).getDate()) : null;
  return {
    trend: has("trend"),
    raw: has("raw"),
    trendCafe: trendFiles.some((f) => (f.slugs[slug] || 0) > 0),
    trendRange: !trendFiles.length || d === null || (d >= min && d <= max + 86400000 * 3),
  };
}

const yn = (b) => (b ? "Y" : "N");

// ---------------------------------------------------------------------------
// 3. 본문 읽기 · 요약 · 누락 사유
// ---------------------------------------------------------------------------

const aiOn = () => $("#aiOn").checked && !!$("#aiKey").value.trim();
const readAllOn = () => !!$("#readAll")?.checked;

async function readBodies() {
  if (running) return;
  await saveSettings();
  // ① AI 1차 검토: 체크 안 된 글을 제목·미리보기 내용으로 다시 보고, 관련 가능성이 있으면 체크
  if (aiOn() && $("#screenOn").checked && !readAllOn()) {
    const ok = await aiScreen();
    if (ok === false || stopRequested) {
      stopRequested = false;
      return;
    }
  }
  // ② 본문 읽기: 체크한 글 (전체 정독이면 체크 안 된 글도). AI 를 쓰면 읽는 대로 18개씩 바로 판단·요약한다
  // (다 읽은 뒤 한꺼번에 하면 그동안 요약 칸이 비어 있고, 중간에 멈추면 요약이 하나도 안 남음)
  const todo = sortedItems().filter((x) => (x.checked || (readAllOn() && !x.touched)) && !x.bodyRead);
  const useAi = aiOn();
  const model = $("#aiModel").value;
  const usage = { input: 0, output: 0 };
  let aiFailed = 0;
  let aiFatal = null;
  const pending = [];
  const flush = async () => {
    if (!pending.length || aiFatal) return;
    const batch = pending.splice(0);
    const r = await aiWrite(batch, $("#aiKey").value.trim(), model, { nested: true, usage });
    aiFailed += r.failed;
    if (r.fatal) aiFatal = r.fatal;
    for (const x of batch) renderRow(x);
    await saveItems();
  };
  if (todo.length) {
    const minutes = formatDuration(todo.length * SEC_PER_ARTICLE);
    const aiCost = useAi
      ? aiCostWon(todo.length * (AI_BODY_CHARS * 0.6 + 300) + 1500 * Math.ceil(todo.length / AI_BATCH), todo.length * 160, model)
      : 0;
    if (
      (todo.length > 40 || useAi) &&
      !(await askConfirm(`본문을 읽을 글이 ${todo.length.toLocaleString()}개입니다 (예상 소요 시간 약 ${minutes}).\n` +
        (useAi ? `읽는 대로 Claude AI 가 판단·요약합니다 (예상 비용 ${fmtWon(aiCost)} · ${AI_MODELS.find(([id]) => id === model)[1].split(" (")[0]}).\n` : "") +
        "많은 글을 한 번에 열면 네이버 보호조치가 걸릴 수 있습니다. 중간에 '중지'로 멈춰도 그때까지 읽은 글의 요약은 남고, 나중에 이어서 읽을 수 있습니다.\n\n계속할까요?"))
    ) return;
    await checkLogin();
    startBusy();
    $("#log").hidden = false;
    const t0 = Date.now();
    let ok = 0;
    for (let i = 0; i < todo.length && !stopRequested; i++) {
      const item = todo[i];
      showBusy(
        `본문 읽는 중 ${i + 1}/${todo.length} · ${item.cafeName}${estimateRemaining(t0, i, todo.length, (todo.length - i) * SEC_PER_ARTICLE)} — 끝날 때까지 이 탭을 닫지 마세요`,
        i, todo.length, "본문 읽는 중",
      );
      setSummary(`본문 읽는 중… (${i + 1}/${todo.length}) ${item.title}`);
      if (i) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
      const res = await readArticleBody(`https://cafe.naver.com/${item.slug}/${item.articleId}`);
      if (res.login) {
        log("✖ 네이버 로그인이 필요합니다 - 로그인한 뒤 다시 누르면 이어서 읽습니다");
        break;
      }
      if (!res.found) {
        item.bodyNote = "본문을 읽지 못함";
        log(`· 본문을 읽지 못함: ${item.title}`);
      } else {
        item.bodyRead = true;
        if (res.locked) item.bodyNote = "멤버 공개 글 - 본문 못 봄";
        else if (res.deleted) item.bodyNote = "삭제된 글";
        else {
          ok++;
          item.body = res.body || "";
          if (res.title) item.title = res.title;
          const parsed = parseCafeDate(res.dateText);
          if (parsed) {
            item.date = parsed.date.getTime();
            item.hasTime = parsed.hasTime;
          }
          const j = judge(item, `${item.title}\n${item.body}`);
          item.related = j.related;
          item.note = judgeNote(j);
          // AI 를 쓰면 체크 여부는 AI 가 본문 내용을 보고 정한다. AI 를 안 쓰면 본문의 단어로 정한다.
          if (!aiOn() && !item.touched) item.checked = j.related;
          item.bodyNote = j.related ? "" : `본문 단어 확인: ${item.note}`;
        }
      }
      if (item.bodyRead && (item.checked || readAllOn())) {
        if (useAi) pending.push(item);
        else if (item.checked) writeByRule(item);
      }
      renderRow(item);
      if (pending.length >= AI_BATCH * AI_PARALLEL) {
        showBusy(`본문 읽는 중 ${i + 1}/${todo.length} · 읽은 글 AI 요약 중…`, i, todo.length, "AI 요약 중");
        await flush();
      } else if (i % 5 === 4) await saveItems();
    }
    await flush(); // 중지했어도 읽은 글은 요약
    await saveItems();
    const spent = useAi ? ` · AI 비용 ${fmtWon(aiWonExact(usage.input, usage.output, model))}` : "";
    log(`· 본문 ${ok}개를 읽었습니다 (${formatDuration((Date.now() - t0) / 1000)} 걸림${spent})`);
    endBusy();
    renderResults();
    if (aiFatal) {
      setSummary(`AI 요약을 하지 못했습니다: ${aiErrorMessage(aiFatal)} · 본문은 읽어 두었으니 키를 확인하고 '요약·사유만 다시 쓰기'를 누르세요.`, "err");
      stopRequested = false;
      return;
    }
    setSummary(
      `${stopRequested ? "중지됨 - " : "✔ "}본문 ${ok.toLocaleString()}개를 읽고 ${useAi ? "AI 로 판단·요약했습니다" : "규칙으로 요약했습니다"} · ` +
        `${formatDuration((Date.now() - t0) / 1000)} 걸림${spent}` +
        (aiFailed ? ` · ${aiFailed}개는 AI 가 실패해 규칙으로 썼습니다` : "") +
        (stopRequested ? " · 다시 누르면 남은 글부터 이어서 읽습니다" : ""),
      aiFailed ? "err" : "ok",
    );
    if (stopRequested) {
      stopRequested = false;
      return;
    }
  }
  // 이미 읽었는데 아직 요약이 없는 글(예: 예전 버전에서 읽은 글)
  const left = sortedItems().filter((x) => x.checked && (!x.summary || x.by !== ($("#aiOn").checked ? "ai" : "rule")));
  if (left.length || !todo.length) await writeSummaries(false);
  stopRequested = false;
}

// 요약·누락 사유 쓰기 (force: 이미 쓴 글도 다시)
async function writeSummaries(force) {
  // AI 로 쓸 때: 체크한 글 + (전체 정독이면) 본문을 읽은 체크 안 된 글도 AI 가 관련 여부를 판단
  const wanted = (x) => x.checked || (aiOn() && readAllOn() && x.bodyRead && !x.touched && x.by !== "ai");
  const targets = sortedItems().filter((x) => wanted(x) && (force || !x.summary || x.by !== ($("#aiOn").checked ? "ai" : "rule")));
  if (!targets.length) {
    renderResults();
    setSummary("요약할 글이 없습니다 (체크한 글은 모두 요약했습니다).", "ok");
    return;
  }
  if ($("#aiOn").checked) {
    const key = $("#aiKey").value.trim();
    if (!key) {
      setSummary("Claude AI 로 쓰려면 API 키를 넣어 주세요 (또는 'Claude AI' 체크를 풀면 규칙으로 씁니다).", "err");
      $("#aiKey").focus();
      return;
    }
    const model = $("#aiModel").value;
    const chars = targets.reduce((n, x) => n + Math.min(AI_BODY_CHARS, (x.body || x.text || "").length) + x.title.length + 200, 0);
    const est = AI_MODELS.map(([id, label]) => `· ${label.split(" (")[0]}: ${fmtWon(aiCostWon(chars * 1.1 + 1500 * Math.ceil(targets.length / AI_BATCH), targets.length * 160, id))}`).join("\n");
    if (!(await askConfirm(`글 ${targets.length}개의 요약·누락 사유를 Claude AI 로 씁니다.\n\n예상 비용 (대략):\n${est}\n\n지금 고른 모델: ${AI_MODELS.find(([id]) => id === model)[1]}\n예상 소요 시간 약 ${formatDuration(Math.ceil(targets.length / AI_BATCH / AI_PARALLEL) * 25)}\n\n계속할까요?`))) return;
    await aiWrite(targets, key, model);
  } else {
    for (const x of targets) writeByRule(x);
    renderResults();
    setSummary(`✔ 글 ${targets.length}개의 요약·누락 사유를 규칙으로 썼습니다. 'Claude AI' 를 켜면 더 자연스럽게 쓸 수 있습니다.`, "ok");
  }
  await saveItems();
}

// 규칙으로 요약: 본문에서 시트·위험 단어가 많은 문장 1~2개
function ruleSummary(item) {
  const src = item.body || item.text || "";
  const rowW = words($("#rowWords").value);
  const riskW = words($("#riskWords").value);
  const sentences = src
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  const scored = sentences.map((s, i) => {
    const c = compactText(s);
    return { s, i, score: (rowW.some((w) => c.includes(w)) ? 1 : 0) + (riskW.some((w) => c.includes(w)) ? 2 : 0) };
  });
  const pick = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  let out = pick.map((x) => x.s).join(" ");
  if (!out) out = item.title;
  return out.length > 150 ? `${out.slice(0, 148)}…` : out;
}

const OUT_OF_RANGE = "비교한 온라인 동향 파일의 기간 밖에 게시된 글로, 해당 기간 동향 파일 확인 필요";

// 규칙으로 누락 사유 (온라인 동향에 없을 때만)
// 동호회별 모니터링 시작일 → { slug: { from: Date(그날 0시), note } }
function monitorStarts() {
  const out = {};
  for (const line of String($("#monitorStart")?.value || "").split(/\r?\n/)) {
    const [slug, day, note] = line.split("|").map((x) => (x || "").trim());
    const m = (day || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (slug && m) out[slug.toLowerCase()] = { from: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), note };
  }
  return out;
}

// 이 글이 그 동호회 모니터링 시작 전 글이면 정해진 누락 사유, 아니면 ""
function notMonitoredReason(item) {
  const ms = monitorStarts()[String(item.slug || "").toLowerCase()];
  if (!ms || !item.date || new Date(item.date) >= ms.from) return "";
  return `해당 동호회(${item.cafeName})는 당시 모니터링 대상 동호회가 아니었음${ms.note ? ` (${ms.note})` : ""}`;
}

// 로데이터가 없던 시기의 글인지 → 누락 사유 앞에 붙일 말 (아니면 "")
// 기준: 게시일이 '첫 로데이터에 담긴 게시일 시작' 이전이고, 로데이터에도 없는 글 (로데이터에 있으면(Y) 붙이지 않음)
function rawStartNote(item, inc = inclusion(item)) {
  if (inc.raw || !item.date) return "";
  const day = (id) => String($(`#${id}`)?.value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const w = day("rawStart");
  const c = day("rawCover") || w;
  if (!w || !c) return "";
  if (new Date(item.date) >= new Date(Number(c[1]), Number(c[2]) - 1, Number(c[3]))) return "";
  return `전차종 로데이터는 '${w[1].slice(2)}년 ${Number(w[2])}월 ${Number(w[3])}일부터 작성되어 이 글의 게시 시점에는 로데이터 파일이 없었음`;
}

// 표·엑셀에 쓰는 누락 사유: 온라인 동향에 있으면 없음 → 모니터링 시작 전 동호회면 정해진 문장 →
// (AI·규칙으로 쓴 사유) 앞에 로데이터 작성 전이면 그 내용을 붙임
function finalReason(x, inc = inclusion(x)) {
  if (inc.trend) return "";
  const nm = notMonitoredReason(x);
  if (nm) return nm;
  const r = x.reason || ruleReason(x, inc);
  const raw = rawStartNote(x, inc);
  if (!raw || r.startsWith(raw)) return r;
  return r ? `${raw} · ${r}` : raw;
}

function ruleReason(item, inc) {
  if (inc.trend) return "";
  const nm = notMonitoredReason(item);
  if (nm) return nm;
  const t = compactText(`${item.title} ${item.body || item.text}`);
  const any = (list) => list.some((w) => t.includes(w));
  if (!inc.trendRange) return OUT_OF_RANGE;
  if (!inc.trendCafe && !inc.raw) return "해당 동호회가 온라인 동향 모니터링 대상 채널에 포함되지 않아 수집되지 않은 것으로 추정";
  let why;
  if (any(["기사", "뉴스", "보도", "리콜", "공지", "업데이트", "무상수리"])) why = "언론 보도·리콜/업데이트 소식을 공유한 글로 고객 실사용 불만에 해당하지 않아";
  else if (any(["다쳤", "부상", "병원", "피가", "피나", "골절", "멍들", "멍이", "응급", "깁스"]))
    why = "실제 부상 언급은 있으나 경미하고 작동 중 신체 접촉 등 사용 부주의 사례로 판단되어";
  else if (any(["끼었", "끼여", "끼임", "끼인", "낄뻔", "끼일뻔", "아찔", "큰일날", "큰일 날"])) why = "끼임 직전·아차 상황 경험담으로 실제 사고(부상)로 이어지지 않아";
  else if (/[?？]|궁금|문의|되나요|있나요|어떻게|인가요|건가요/.test(`${item.title} ${item.body || item.text}`))
    why = "안전장치·작동 방식에 대한 단순 문의성 글로 품질 불만으로 보기 어려워";
  else if (any(["조심", "주의", "위험", "걱정", "무섭", "무서", "다칠"])) why = "실제 사고 발생이 아닌 사용 시 주의 당부·위험 우려 수준의 글로";
  else why = "시트 기능·편의성 위주의 의견으로 안전 사고와의 관련성이 낮다고 판단되어";
  return inc.raw
    ? `로데이터에는 수집되었으나, ${why} 온라인 동향 보고 대상에서 제외된 것으로 추정`
    : `${why} 품질 이슈로 분류되지 않아 수집되지 않은 것으로 추정`;
}

function writeByRule(item) {
  item.summary = ruleSummary(item);
  item.reason = ruleReason(item, inclusion(item));
  item.by = "rule";
}

// ---------------------------------------------------------------------------
// Claude AI 로 요약·누락 사유 (공식 Anthropic SDK, 전역 Anthropic)
// ---------------------------------------------------------------------------

const AI_SITUATIONS = ["실제 사고", "아차 사고", "위험 우려", "문의", "기사·공지 공유", "관련 없음"];

const AI_SYSTEM = `당신은 현대자동차 품질 부문의 온라인 동향 모니터링 보고서를 검수하는 분석가입니다.
조사 주제: 아이오닉9(ME1)·팰리세이드(LX3)·싼타페(MX5)의 2열·3열 시트를 조작할 때(전동 폴딩·원터치 워크인·슬라이딩·리클라이닝·
복귀 등) 안전 사고가 발생했거나, 발생할 뻔했거나, 발생할 우려·가능성을 언급한 네이버 동호회 게시물.
당신이 쓴 결과는 그대로 사내 보고 엑셀에 들어가므로, 정확성과 일관성이 가장 중요합니다.

[입력] 글마다 id, 차종, 동호회, 게시일, 제목, 본문(없으면 목록의 미리보기), 온라인동향포함, 로데이터포함, 동호회모니터링 을 받습니다.

[출력] 받은 글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다.

1. relevant (true/false): 이 글이 조사 주제에 해당하는지.
   - true: 2·3열 시트 조작(또는 시트 작동) 중 사람·반려동물·물건이 끼이거나 눌리거나 부딪힌 사고, 그럴 뻔한 상황,
     그런 위험에 대한 우려·경고·주의 당부, 끼임 방지·안전 센서 작동에 대한 의문, 관련 리콜·업데이트 소식.
   - false: 1열(운전석·조수석) 시트만의 이야기, 카시트 제품 추천·장착 방법, 시트 소음·가죽·열선·통풍·편의성만의 이야기,
     위험과 무관한 시트 기능 질문, 판매·구매 글, 조사 차종과 무관한 글.
   - 판단이 애매하면 true 로 두고 summary 에 그 사정을 드러냅니다(사람이 최종 검토함).
   - 꼭포함=true 인 글은 담당자가 조사 주제의 대표 사례로 지정한 글이므로 반드시 relevant=true 로 둡니다.
2. situation: 아래 중 하나.
   "실제 사고"(실제로 끼이거나 다침·파손) / "아차 사고"(끼일 뻔·다칠 뻔) / "위험 우려"(우려·경고·주의 당부, 가능성 언급) /
   "문의"(안전장치·작동 방식 질문) / "기사·공지 공유"(언론 기사·리콜·업데이트 공지 공유) / "관련 없음"(relevant=false 일 때만)
3. summary (주요내용 요약): 한 문장, 40~120자. 사내 온라인 동향 보고서 문체로, "~했다며 ~하는 내용" / "~에 대해 문의하는 내용" 처럼
   "내용" 으로 끝냅니다. 누가(본인·아이·가족 등) · 어떤 시트 조작 중 · 무슨 일이(어디가 끼였는지·다쳤는지·뻔했는지) ·
   글쓴이의 요구·반응(불만·우려·문의·당부)을 글에 있는 만큼만 담습니다.
   예) "3열 탑승 중 2열 전동 시트 원터치 복귀 시 아이의 발이 끼여 멍이 들었다며 끼임 방지 기능 미작동에 대해 불만을 제기하는 내용"
   예) "2열 시트 폴딩 시 센서가 없어 아이 손이 끼일 수 있다며 다른 오너들에게 주의를 당부하는 내용"
   예) "2열 전동 시트 끼임 사고 관련 리콜 기사를 공유하며 업데이트 일정에 대해 문의하는 내용"
   relevant=false 이면 글의 실제 주제를 같은 문체로 한 문장 요약합니다.
4. reason (미포함시 누락 사유):
   - 온라인동향포함=true 이거나 relevant=false 이면 반드시 빈 문자열 "".
   - 그 밖에는 이 글이 온라인 동향 보고에서 빠졌을 그럴듯한 이유를 한 문장(30~90자)으로 쓰고 반드시 "~로 추정" 으로 끝냅니다.
   - 글 내용에 근거한 이유를 고릅니다. 예:
     · 실제 사고가 아닌 사용 시 주의 당부·위험 우려 수준의 글이라 품질 이슈로 분류되지 않은 것으로 추정
     · 끼임 직전의 아차 상황으로 실제 부상·파손이 없어 보고 기준에 미달한 것으로 추정
     · 경미한 부상이나 작동 중 신체를 넣은 사용 부주의 사례로 판단되어 품질 이슈에서 제외된 것으로 추정
     · 안전장치 작동 방식에 대한 단순 문의로 불만·결함 글로 분류되지 않은 것으로 추정
     · 언론 기사·리콜 공지 공유 글로 고객 실사용 불만이 아니어서 제외된 것으로 추정
   - 동호회모니터링=false 이고 로데이터포함=false 이면, 해당 동호회가 모니터링 대상 채널이 아니었을 가능성을 사유로 씁니다.
   - 로데이터포함=true 이면 "로데이터에는 수집되었으나, " 로 시작해 온라인 동향 보고 기준에 못 미친 이유를 씁니다.

[반드시 지킬 것]
- 글에 없는 사실(부상 정도·차량 상태·날짜·정비 결과·글쓴이 신원)을 지어내거나 추측해 단정하지 않습니다.
- 댓글 반응, 글쓴이 닉네임, 개인정보는 쓰지 않습니다. 욕설·과장은 중립적인 말로 바꿉니다.
- 2열·3열을 구분해 글에 쓰인 대로 씁니다(글에 없으면 "뒷좌석 시트" 처럼 글의 표현을 따릅니다).
- 모든 글을 같은 기준·같은 문체로 씁니다. 존댓말 어미나 마침표 없이 "내용" / "추정" 으로 끝냅니다.`;

// 담당자 추가 규칙(설정의 'AI 추가 규칙' 메모)을 붙인 지시문
function aiSystem() {
  const extra = String($("#aiRules")?.value || "").trim();
  return extra ? `${AI_SYSTEM}\n\n[담당자 추가 규칙 - 위 규칙보다 우선]\n${extra}` : AI_SYSTEM;
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          situation: { type: "string", enum: AI_SITUATIONS },
          summary: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "relevant", "situation", "summary", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// AI 1차 검토: 체크 안 된 글(직접 해제하지 않은 것)을 제목·미리보기로 다시 보고, 본문을 읽어 볼 만한지 고른다.
// 놓치지 않는 것이 목적이라 애매하면 '관련 가능'으로 본다 (최종 판단은 본문을 읽은 뒤 다시 AI 가 함).
// ---------------------------------------------------------------------------

const SCREEN_BATCH = 40;

const SCREEN_SYSTEM = `당신은 현대자동차 품질 부문 온라인 동향 모니터링의 1차 검토자입니다.
조사 주제: 아이오닉9(ME1)·팰리세이드(LX3)·싼타페(MX5)의 2열·3열 시트를 조작할 때(전동 폴딩·원터치 워크인·슬라이딩·리클라이닝·
복귀 등) 안전 사고가 발생했거나, 발생할 뻔했거나, 발생할 우려·가능성을 언급한 네이버 동호회 게시물.

네이버 카페 검색 결과의 제목과 미리보기(본문 일부·목록 글자)만 보고, 본문을 읽어 볼 가치가 있는지 고릅니다.
- maybe=true: 2·3열(뒷좌석) 시트의 조작·작동과 함께 사람(특히 아이)·반려동물·물건의 끼임·눌림·부딪힘·부상, 위험·불안·무서움,
  주의 당부, 안전장치·센서·멈춤, 리콜·업데이트 이야기가 나오거나 그럴 가능성이 조금이라도 보이는 글.
  제목이 짧거나 모호해도(예: "큰일날 뻔했어요", "애들 있는 집 조심하세요", "3열 탈 때 이거 아셨나요") 주제와 이어질 수 있으면 true.
- maybe=false: 판매·구매·공동구매, 카시트 제품 추천·장착 방법, 시트 가죽·색상·통풍·열선·소음·편의성만의 이야기,
  1열(운전석·조수석)만의 이야기, 조사 차종과 무관한 글, 출고·계약·정비 일반 이야기.
- 제목·미리보기에 시트·좌석·2열·3열·뒷자리·폴딩·워크인·탑승·하차 같은 시트 단서도, 사고·다침·끼임·위험·조심·아이 같은 안전 단서도
  하나도 없는 글(예: "이거 어떻게 하는게 좋을까요?" 뿐인 글)은 false 입니다.
- 시트 단서나 안전 단서가 있고 주제와 이어질 수 있는데 확신이 없으면 true 입니다(놓치는 것이 더 큰 손해).
why: 판단 근거를 15~40자로 (예: "3열 하차 중 2열 복귀 시 아이 위험 언급 가능").
받은 글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다.`;

const SCREEN_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, maybe: { type: "boolean" }, why: { type: "string" } },
        required: ["id", "maybe", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

async function aiScreenBatch(client, model, batch, usage) {
  const input = batch.map((x) => ({ id: x.key, 차종: x.car, 동호회: x.cafeName, 제목: x.title, 미리보기: (x.text || "").slice(0, 400) }));
  const params = {
    model,
    max_tokens: 16000,
    system: SCREEN_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCREEN_SCHEMA } },
    messages: [{ role: "user", content: `아래 글 ${batch.length}개를 1차 검토해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
  };
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  chargeAi(batch, msg, model);
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 검토를 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  const bad = batch.filter((x) => typeof byId.get(x.key)?.maybe !== "boolean").length;
  if (bad) throw new Error(`결과 ${bad}건이 빠졌습니다`);
  for (const x of batch) {
    const r = byId.get(x.key);
    x.aiScreen = { maybe: r.maybe, why: String(r.why || "").replace(/\s+/g, " ").trim().slice(0, 80) };
    if (r.maybe && !x.touched) x.checked = true;
  }
}

// → false: 취소 · true: 끝남(또는 할 것 없음)
async function aiScreen() {
  const targets = sortedItems().filter((x) => !x.checked && !x.touched && !x.aiScreen);
  if (!targets.length) return true;
  const model = $("#aiModel").value;
  const chars = targets.reduce((n, x) => n + x.title.length + Math.min(400, (x.text || "").length) + 60, 0);
  const batches = Math.ceil(targets.length / SCREEN_BATCH);
  const cost = aiCostWon(chars * 1.1 + 900 * batches, targets.length * 30, model);
  if (!(await askConfirm(
    `체크 안 된 글 ${targets.length.toLocaleString()}개를 AI 가 제목·미리보기로 한 번 더 검토합니다 (관련 가능성이 있으면 체크).\n` +
      `예상 비용 ${fmtWon(cost)} · 예상 소요 시간 약 ${formatDuration(Math.ceil(batches / AI_PARALLEL) * 30)} (네이버 접속 없음)\n\n` +
      "· [확인]: 검토하고 본문 읽기로\n· [취소]: 멈추기 (아래 'AI 1차 검토' 체크를 풀면 건너뜀)",
  ))) return false;
  const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
  const list = [];
  for (let i = 0; i < targets.length; i += SCREEN_BATCH) list.push(targets.slice(i, i + SCREEN_BATCH));
  const usage = { input: 0, output: 0 };
  const t0 = Date.now();
  let done = 0;
  let failed = 0;
  let fatal = null;
  let next = 0;
  startBusy();
  const progress = () => showBusy(`AI 1차 검토 중 ${done}/${list.length}묶음${estimateRemaining(t0, done, list.length, (list.length - done) * 30)}`, done, list.length, "AI 1차 검토 중");
  progress();
  const worker = async () => {
    while (next < list.length && !fatal && !stopRequested) {
      const batch = list[next++];
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok && !fatal; attempt++) {
        try {
          await aiScreenBatch(client, model, batch, usage);
          ok = true;
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
        }
      }
      if (!ok) failed += batch.length;
      done++;
      progress();
      for (const x of batch) renderRow(x);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  endBusy();
  await saveItems();
  renderResults();
  const added = targets.filter((x) => x.aiScreen?.maybe).length;
  const spent = aiWonExact(usage.input, usage.output, model);
  const line = fatal
    ? `AI 1차 검토를 하지 못했습니다: ${aiErrorMessage(fatal)}`
    : `✔ AI 1차 검토: 체크 안 된 글 ${targets.length.toLocaleString()}개 중 ${added.toLocaleString()}개를 관련 가능으로 보고 체크했습니다 · ` +
      `${formatDuration((Date.now() - t0) / 1000)} · 비용 ${fmtWon(spent)}${failed ? ` · ${failed}개는 실패(다시 누르면 다시 검토)` : ""}`;
  log(`· ${line}`);
  setSummary(line, fatal || failed ? "err" : "ok");
  return !fatal;
}

// ---------------------------------------------------------------------------
// AI 최종 검수: 본문 판독·요약까지 마친 체크한 글을 판독 내용(제목·요약·상황·본문 일부)으로 한 번 더 보고
// 주제 관련도(0~100%)와 최종 포함 여부를 정한다 → 1차 검수 엑셀의 관련도 · 최종 파일(포함된 글만)
// ---------------------------------------------------------------------------

const REVIEW_BATCH = 10;
const REVIEW_VERSION = 2; // 최종 검수 기준 버전 (4항목 재검수) - 이전 기준으로 검수한 글은 다시 검수
const reviewed = (x) => x.review?.v === REVIEW_VERSION;

// 최종 검수 지시문 + 담당자 추가 규칙(메모)
function reviewSystem() {
  const extra = String($("#aiRules")?.value || "").trim();
  return extra ? `${REVIEW_SYSTEM}\n\n[담당자 추가 규칙 - 위 규칙보다 우선]\n${extra}` : REVIEW_SYSTEM;
}
const REVIEW_BODY_CHARS = 1500;

const REVIEW_SYSTEM = `당신은 현대자동차 품질 부문 온라인 동향 보고서의 최종 검수자입니다.
조사 주제: 아이오닉9(ME1)·팰리세이드(LX3)·싼타페(MX5)의 2열·3열 전동 시트를 작동·조작할 때(전동 폴딩·원터치 워크인·슬라이딩·리클라이닝·
복귀 등) 안전 사고가 발생했거나, 발생할 뻔했거나, 발생할 우려·가능성을 언급한 네이버 동호회 게시물.

이미 본문을 읽고 요약까지 마친 글을 받습니다(제목, 주요내용 요약, AI 상황 분류, 본문 일부).
판독된 내용을 토대로 글마다 아래 4가지를 하나씩 다시 검수합니다(checks).
1. seatIssue: 전동 시트 작동 관련 이슈를 다루는 글인가?
   - 전동 트렁크(테일게이트)·도어·슬라이딩 도어·선루프·창문·사이드미러 등 시트가 아닌 다른 장치의 작동 이슈는 false (추가로 배제).
   - 카시트 제품, 시트 가죽·열선·통풍·소음 같은 작동과 무관한 시트 이야기만 있으면 false.
2. accident: 전동 시트 작동 중 사고(사람·반려동물·물건의 끼임·눌림·부딪힘·부상·파손)가 실제로 발생했는가?
3. concern: 전동 시트 작동 관련 위험성·안전사고 우려(끼일 뻔함, 위험하다, 조심하라, 센서·멈춤 등 안전장치 의문 포함)를 언급했는가?
4. partialMention: 여러 다른 이슈(옵션·품질·출고 등)를 함께 말한 글이라도, 전동 시트 작동의 위험성·사고 발생·안전사고 우려 내용이 조금이라도 포함되는가?
   한 문장이라도 있으면 true.

그리고:
- relevance: 조사 주제와의 관련도 (0~100 정수) - 최종 파일 '판단 기준' 시트와 같은 기준
  100: 2·3열 전동 시트 작동 중 실제로 끼이거나 다친 사고가 명확함(끼였다·눌렸다·다쳤다·멍·피·병원·파손 등 실제 결과 + 원인이 시트 작동)
  85~95: 실제로 겪은 아차 사고·구체적 위험 장면(끼일 뻔·다칠 뻔·급히 멈춤) - 95: 사고 직전·반복 경험 / 85: 한 번의 짧은 아차 경험
  70~84: 위험성·안전사고 우려·주의 당부·안전장치(센서·멈춤) 의문이 글의 중심 - 84: 구체적 상황을 들어 우려 / 70: 짧은 우려·당부
  40~69: 다른 주제 글 속 한두 문장의 위험 언급, 일반론, 기사·공지 단순 공유 - 69: 위험 문장이 분명함 / 40: 스치듯 언급
  10~39: 전동 시트 작동 이야기지만 불편·고장·소음만 있고 위험 언급 없음
  0~9: 주제와 무관(전동 트렁크·도어·선루프 등 다른 장치, 카시트·가죽·열선 등 작동과 무관한 시트 이야기)
  같은 구간 안에서는 장면·결과가 구체적일수록, 아이·반려동물 등 피해 대상이 분명할수록, 반복될수록 위쪽 점수.
- why: 4가지 판단의 근거를 한 문장(20~80자)으로. 예) "다른 옵션 이야기 중 2열 원터치 복귀 시 아이 발 끼임 우려를 한 줄 언급"
- 판독된 내용에 없는 사실을 지어내지 않고, 모든 글에 같은 기준을 적용합니다. 받은 순서대로, id 를 그대로 돌려줍니다.
- 최종 포함 여부는 프로그램이 정합니다: seatIssue 가 true 이고 accident·concern·partialMention 중 하나라도 true 이면 포함
  (꼭포함=true 인 글은 항상 포함).`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          seatIssue: { type: "boolean" },
          accident: { type: "boolean" },
          concern: { type: "boolean" },
          partialMention: { type: "boolean" },
          relevance: { type: "integer" },
          why: { type: "string" },
        },
        required: ["id", "seatIssue", "accident", "concern", "partialMention", "relevance", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

async function aiReviewBatch(client, model, batch, usage) {
  const input = batch.map((x) => ({
    id: x.key, 차종: x.car, 제목: x.title, 주요내용요약: x.summary || "", AI상황: x.situation || "",
    본문: (x.body || x.text || "").slice(0, REVIEW_BODY_CHARS), 꼭포함: !!x.must,
  }));
  const params = {
    model,
    max_tokens: 8000,
    system: reviewSystem(),
    output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    messages: [{ role: "user", content: `아래 글 ${batch.length}개를 최종 검수해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
  };
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  chargeAi(batch, msg, model);
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 최종 검수를 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  const CHECKS = ["seatIssue", "accident", "concern", "partialMention"];
  const bad = batch.filter((x) => {
    const r = byId.get(x.key);
    return !r || !Number.isFinite(r.relevance) || CHECKS.some((k) => typeof r[k] !== "boolean");
  }).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  for (const x of batch) {
    const r = byId.get(x.key);
    const relevance = Math.max(0, Math.min(100, Math.round(r.relevance)));
    const checks = Object.fromEntries(CHECKS.map((k) => [k, r[k]]));
    // 최종 포함: 전동 시트 작동 이슈이고(1) 사고(2)·우려(3)·일부 언급(4) 중 하나라도 해당 (꼭 넣을 글은 항상)
    const keep = (checks.seatIssue && (checks.accident || checks.concern || checks.partialMention)) || !!x.must;
    x.review = { v: REVIEW_VERSION, relevance, keep, checks, why: String(r.why || "").replace(/\s+/g, " ").trim().slice(0, 160), at: Date.now() };
  }
}

// → true: 끝남 · false: 취소·실패
async function aiReview(targets) {
  const model = $("#aiModel").value;
  const chars = targets.reduce((n, x) => n + (x.title || "").length + (x.summary || "").length + Math.min(REVIEW_BODY_CHARS, (x.body || x.text || "").length) + 80, 0);
  const batches = Math.ceil(targets.length / REVIEW_BATCH);
  const est = aiCostWon(chars * 1.1 + 1200 * batches, targets.length * 50, model);
  if (!(await askConfirm(
    `체크한 글 ${targets.length.toLocaleString()}개를 AI 가 최종 검수합니다 (판독된 내용으로 주제 관련도 % 와 최종 포함 여부 판단).\n` +
      `예상 비용 ${fmtWon(est)} · 예상 소요 시간 약 ${formatDuration(Math.ceil(batches / AI_PARALLEL) * 25)} (본문을 다시 읽지 않음 · 네이버 접속 없음)\n\n계속할까요?`,
  ))) return false;
  const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
  const list = [];
  for (let i = 0; i < targets.length; i += REVIEW_BATCH) list.push(targets.slice(i, i + REVIEW_BATCH));
  const usage = { input: 0, output: 0 };
  const t0 = Date.now();
  let done = 0;
  let failed = 0;
  let fatal = null;
  let lastError = null;
  let next = 0;
  startBusy();
  const progress = () => showBusy(`AI 최종 검수 중 ${done}/${list.length}묶음${estimateRemaining(t0, done, list.length, (list.length - done) * 25)}`, done, list.length, "AI 최종 검수 중");
  progress();
  const worker = async () => {
    while (next < list.length && !fatal && !stopRequested) {
      const batch = list[next++];
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok && !fatal; attempt++) {
        try {
          await aiReviewBatch(client, model, batch, usage);
          ok = true;
        } catch (e) {
          lastError = e;
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
        }
      }
      if (!ok && !fatal && batch.length > 1) {
        ok = true;
        for (const x of batch) {
          try {
            await aiReviewBatch(client, model, [x], usage);
          } catch (e) {
            lastError = e;
            failed++;
          }
        }
      } else if (!ok) failed += batch.length;
      done++;
      progress();
      for (const x of batch) renderRow(x);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  endBusy();
  await saveItems();
  renderResults();
  const kept = targets.filter((x) => x.review?.keep).length;
  const line = fatal
    ? `AI 최종 검수를 하지 못했습니다: ${aiErrorMessage(fatal)}`
    : `✔ AI 최종 검수: ${targets.length.toLocaleString()}개 중 ${kept.toLocaleString()}개 최종 포함 · ${formatDuration((Date.now() - t0) / 1000)} · ` +
      `비용 ${fmtWon(aiWonExact(usage.input, usage.output, model))}${failed ? ` · ${failed}개는 실패(다시 누르면 다시 검수: ${aiErrorMessage(lastError)})` : ""}`;
  log(`· ${line}`);
  setSummary(line, fatal || failed ? "err" : "ok");
  stopRequested = false;
  return !fatal && !failed;
}

// 4항목 판정 → " · ①시트O ②사고X ③우려O ④일부O"
function reviewChecksText(x) {
  const c = x.review?.checks;
  if (!c) return "";
  const o = (b) => (b ? "O" : "X");
  return ` · ①시트작동${o(c.seatIssue)} ②사고${o(c.accident)} ③우려${o(c.concern)} ④일부언급${o(c.partialMention)}`;
}

// 최종 검수만 다시 (요약을 고쳤거나 기준을 바꿨을 때)
async function redoReview() {
  if (running) return;
  const checked = sortedItems().filter((x) => x.checked);
  if (!checked.length) return;
  if (!aiOn()) return setSummary("AI 최종 검수는 API 키가 필요합니다 (3번 Claude AI 설정).", "err");
  await aiReview(checked);
}

// API 키 저장: 키를 넣으면 'Claude AI 로 쓰기'를 자동으로 켠다
async function saveAiKey() {
  const key = $("#aiKey").value.trim();
  $("#aiKey").value = key;
  if (key && !/^sk-ant-/.test(key)) {
    showAiStatus("API 키는 sk-ant- 로 시작합니다. 다시 확인해 주세요.", "err");
    return;
  }
  $("#aiOn").checked = !!key;
  await saveSettings();
  showAiStatus(key ? "✔ API 키를 저장했습니다 (이 PC 크롬에만). '키 확인'으로 맞는 키인지 확인할 수 있습니다." : "API 키를 지웠습니다.", key ? "ok" : "");
}

// 키 확인: 모델 정보만 물어본다 (요금 없음)
async function testAiKey() {
  const key = $("#aiKey").value.trim();
  if (!key) return showAiStatus("API 키를 먼저 넣어 주세요.", "err");
  showAiStatus("키 확인 중…");
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
    await client.models.retrieve($("#aiModel").value);
    await saveAiKey();
    showAiStatus(`✔ 키가 맞습니다. ${AI_MODELS.find(([id]) => id === $("#aiModel").value)[1].split(" (")[0]} 를 쓸 수 있습니다.`, "ok");
  } catch (e) {
    showAiStatus(`✖ ${aiErrorMessage(e)}`, "err");
  }
}

function showAiStatus(text, cls = "") {
  renderPanelStates();
  const box = $("#aiStatus");
  if (!box) return;
  if (text === undefined) {
    const key = $("#aiKey").value.trim();
    text = !key
      ? "API 키가 없습니다. 키 없이도 쓸 수 있으며, 이때 요약·누락 사유는 규칙으로 씁니다."
      : $("#aiOn").checked
        ? `✔ 저장된 키로 Claude AI 를 씁니다 (sk-ant-…${key.slice(-4)}).`
        : `저장된 키가 있지만 꺼져 있어 규칙으로 씁니다 (sk-ant-…${key.slice(-4)}).`;
    cls = key && $("#aiOn").checked ? "ok" : "";
  }
  box.textContent = text;
  box.className = `hint ${cls}`;
}

// 실제로 쓴 AI 비용: 요청마다 사용량으로 계산해 그 묶음의 글들에 똑같이 나눠 붙이고(x.aiCost, 원), 전체 누적도 남긴다
let aiSpend = { won: 0, input: 0, output: 0 };

let aiSpendTimer = null;
function chargeAi(batch, msg, model) {
  const input = msg.usage?.input_tokens || 0;
  const output = msg.usage?.output_tokens || 0;
  const won = aiWonExact(input, output, model);
  for (const x of batch) x.aiCost = (x.aiCost || 0) + won / batch.length;
  aiSpend = { won: aiSpend.won + won, input: aiSpend.input + input, output: aiSpend.output + output };
  clearTimeout(aiSpendTimer);
  aiSpendTimer = setTimeout(() => chrome.storage.local.set({ seatAiSpend: aiSpend }).catch(() => {}), 300);
}

function aiCostWon(inTokens, outTokens, model) {
  const [inP, outP] = AI_PRICE[model] || AI_PRICE["claude-opus-5-5"];
  return Math.max(10, Math.round((((inTokens * inP + outTokens * outP) / 1e6) * WON_PER_USD) / 10) * 10);
}

function aiErrorMessage(e) {
  if (typeof Anthropic === "undefined") return "AI 도구를 불러오지 못했습니다";
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없습니다";
  if (e instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다(잠시 후 다시 시도)";
  if (e instanceof Anthropic.APIConnectionError) return "Claude API 에 연결하지 못했습니다(인터넷 확인)";
  if (e instanceof Anthropic.APIError) return `Claude API 오류: ${e.message}`;
  return e && e.message ? e.message : String(e);
}

// 결과 한 건 검사: 형식이 어긋나면 null (그 묶음을 다시 요청)
function checkAiResult(r, inc, must = false, fixedReason = "") {
  if (!r || typeof r.summary !== "string" || typeof r.reason !== "string" || !AI_SITUATIONS.includes(r.situation)) return null;
  const summary = r.summary.replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim();
  let reason = r.reason.replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim();
  if (summary.length < 4) return null;
  const relevant = !!r.relevant || must; // 꼭 넣을 글은 늘 주제에 맞는 글로 본다
  if (inc.trend || !relevant) reason = "";
  else if (fixedReason) reason = fixedReason; // 모니터링 시작 전 글: 정해진 문장
  else if (!inc.trendRange) reason = OUT_OF_RANGE; // 비교 파일 기간 밖은 추정하지 않고 확인 필요로
  else if (!reason || !/추정$/.test(reason)) return null;
  return { relevant, situation: relevant && r.situation === "관련 없음" ? "위험 우려" : r.situation, summary, reason };
}

async function aiBatch(client, model, batch, usage) {
  const input = batch.map((x) => {
    const inc = inclusion(x);
    return {
      id: x.key,
      차종: x.car,
      동호회: x.cafeName,
      게시일: x.date ? formatDateTime(new Date(x.date), false) : "",
      제목: x.title,
      본문: (x.body || x.text || "").slice(0, AI_BODY_CHARS),
      본문여부: x.body ? "본문" : "목록 미리보기만 있음",
      온라인동향포함: inc.trend,
      로데이터포함: inc.raw,
      동호회모니터링: inc.trendCafe,
      로데이터작성전: !!rawStartNote(x, inc),
      꼭포함: !!x.must,
    };
  });
  const params = {
    model,
    max_tokens: 16000,
    system: aiSystem(),
    output_config: { effort: "medium", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{ role: "user", content: `아래 글 ${batch.length}개를 규칙대로 판단해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
  };
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  chargeAi(batch, msg, model);
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 이 글들의 요약을 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  // 한 건이라도 빠지거나 형식이 어긋나면 묶음 전체를 다시 요청 (반쯤 맞은 결과를 섞지 않음)
  const results = batch.map((x) => checkAiResult(byId.get(x.key), inclusion(x), !!x.must, notMonitoredReason(x)));
  const bad = results.filter((r) => !r).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  batch.forEach((x, i) => {
    const r = results[i];
    x.summary = r.summary;
    x.reason = r.reason;
    x.situation = r.situation;
    x.aiRelevant = r.relevant;
    x.by = "ai";
    // AI 가 본문을 보고 정한 대로 체크 (직접 체크·해제한 글은 그대로) - 무관한 글은 다시 체크하면 엑셀에 들어감
    if (!x.touched) x.checked = r.relevant;
  });
}

// nested: 본문을 읽는 도중에 읽은 글만 바로 요약할 때 (진행 막대·결과 문구는 본문 읽기 쪽에서 보여줌, 중지를 눌러도 이 묶음은 마침)
async function aiWrite(targets, apiKey, model, { nested = false, usage = { input: 0, output: 0 } } = {}) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const batches = [];
  for (let i = 0; i < targets.length; i += AI_BATCH) batches.push(targets.slice(i, i + AI_BATCH));
  let done = 0;
  let failed = 0;
  let fatal = null;
  let lastError = null;
  const t0 = Date.now();
  if (!nested) startBusy();
  const progress = () =>
    nested || showBusy(`Claude AI 로 요약 중 ${done}/${batches.length}묶음${estimateRemaining(t0, done, batches.length, (batches.length - done) * 25)}`, done, batches.length, "AI 요약 중");
  progress();
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !fatal && (nested || !stopRequested)) {
      const batch = batches[next++];
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok && !fatal; attempt++) {
        try {
          await aiBatch(client, model, batch, usage);
          ok = true;
        } catch (e) {
          lastError = e;
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
        }
      }
      // 묶음이 끝내 실패하면 글 하나씩 다시 (한 글의 결과 때문에 묶음 전체가 규칙 문장이 되지 않게)
      if (!ok && !fatal && batch.length > 1) {
        for (const x of batch) {
          try {
            await aiBatch(client, model, [x], usage);
          } catch (e) {
            lastError = e;
            failed++;
            writeByRule(x);
          }
        }
        ok = true;
      }
      if (!ok) {
        failed += batch.length;
        for (const x of batch) writeByRule(x);
      }
      done++;
      progress();
      for (const x of batch) renderRow(x);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  if (nested) return { failed, fatal, lastError };
  endBusy();
  renderResults();
  const cost = aiWonExact(usage.input, usage.output, model);
  const spent = formatDuration((Date.now() - t0) / 1000);
  if (fatal) setSummary(`AI 요약을 하지 못했습니다: ${aiErrorMessage(fatal)} (규칙으로 대신 썼습니다)`, "err");
  else
    setSummary(
      `✔ 글 ${targets.length - failed}개를 Claude AI 로 요약했습니다 · ${spent} 걸림 · 사용한 비용 ${fmtWon(cost)} ` +
        `(입력 ${usage.input.toLocaleString()} · 출력 ${usage.output.toLocaleString()} 토큰)` +
        (failed ? ` · ${failed}개는 실패해 규칙으로 썼습니다(${aiErrorMessage(lastError)})` : ""),
      failed ? "err" : "ok",
    );
}

// ---------------------------------------------------------------------------
// 결과 표
// ---------------------------------------------------------------------------

const carOrder = (code) => CARS.findIndex((c) => c.code === code);

// 차종 → 게시일 → 동호회 순
function sortedItems() {
  return [...items].sort((a, b) => carOrder(a.car) - carOrder(b.car) || (a.date ?? Infinity) - (b.date ?? Infinity) || a.cafeIndex - b.cafeIndex);
}

// 포함 여부 → "NN" · "NY" · "YN" · "YY" (온라인동향 / 로데이터)
function ynCode(x) {
  const inc = inclusion(x);
  return yn(inc.trend) + yn(inc.raw);
}

// Y / N(동향엔 있는데 로데이터엔 없음)은 나올 수 없는 조합이라 보기·정렬에서 빼고, 생기면 건수에만 '확인 필요'로
const YN_ORDER = ["NN", "NY", "YY", "YN"];

function visibleItems() {
  const car = $("#carFilter").value;
  const view = $("#viewFilter").value;
  let list = sortedItems().filter((x) => {
    if (car && x.car !== car) return false;
    if (view === "checked") return x.checked;
    if (view === "unchecked") return !x.checked;
    if (view === "missing") return x.checked && !inclusion(x).trend;
    if (view.startsWith("yn:")) return x.checked && ynCode(x) === view.slice(3);
    if (view === "final") return x.checked && ((reviewed(x) && x.review.keep) || x.must);
    if (view === "dropped") return x.checked && reviewed(x) && !x.review.keep && !x.must;
    return true;
  });
  if ($("#sortBy")?.value === "yn") {
    const rank = new Map(list.map((x) => [x.key, YN_ORDER.indexOf(ynCode(x))]));
    list = list.map((x, i) => [x, i]).sort((a, b) => rank.get(a[0].key) - rank.get(b[0].key) || a[1] - b[1]).map(([x]) => x);
  }
  return list;
}

// 체크한 글의 포함 여부별 건수 (차종 고르면 그 차종만)
function renderYnCounts() {
  const box = $("#ynCounts");
  if (!box) return;
  const car = $("#carFilter").value;
  const list = items.filter((x) => x.checked && (!car || x.car === car));
  const n = Object.fromEntries(YN_ORDER.map((c) => [c, 0]));
  for (const x of list) n[ynCode(x)]++;
  box.textContent = list.length
    ? `체크한 글의 포함 여부 (온라인동향 / 로데이터): ${["NN", "NY", "YY"].map((c) => `${c[0]} / ${c[1]} ${n[c].toLocaleString()}`).join(" · ")}` +
      (n.YN ? ` · Y / N ${n.YN.toLocaleString()} (동향엔 있는데 로데이터엔 없음 - 로데이터 파일 확인 필요)` : "")
    : "";
}

const rowEls = new Map();

function renderResults() {
  const tbody = $("#results tbody");
  tbody.innerHTML = "";
  rowEls.clear();
  $("#resultBox").hidden = !items.length && !running;
  const list = visibleItems();
  const frag = document.createDocumentFragment();
  for (const item of list.slice(0, 1500)) frag.appendChild(buildRow(item));
  tbody.appendChild(frag);
  if (list.length > 1500) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="10" class="hint">… 화면에는 1,500개까지만 보입니다 (위 차종·보기로 좁혀 보세요). 엑셀에는 체크한 글이 모두 들어갑니다.</td>`;
    tbody.appendChild(tr);
  }
  updateCounts();
}

function buildRow(item) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td><input type="checkbox"></td><td class="nowrap"></td><td class="nowrap"></td><td></td><td><a target="_blank" rel="noopener"></a></td>` +
    `<td class="sum"></td><td class="nowrap yn"></td><td class="sum"></td><td class="note"></td><td><button class="small del">삭제</button></td>`;
  tr.querySelector("input").addEventListener("change", (e) => {
    item.checked = e.target.checked;
    item.touched = true;
    tr.className = item.checked ? "" : "off";
    updateCounts();
    saveItemsSoon();
  });
  tr.querySelector(".del").addEventListener("click", () => {
    items = items.filter((x) => x !== item);
    tr.remove();
    rowEls.delete(item.key);
    updateCounts();
    saveItemsSoon();
  });
  rowEls.set(item.key, tr);
  fillRow(tr, item);
  return tr;
}

function fillRow(tr, item) {
  tr.className = item.checked ? "" : "off";
  tr.querySelector("input").checked = item.checked;
  tr.children[1].textContent = item.car;
  tr.children[2].textContent = item.date ? formatDateTime(new Date(item.date), false) : "날짜 모름";
  tr.children[3].textContent = item.cafeName;
  const a = tr.querySelector("a");
  a.href = articleUrl(item);
  a.textContent = item.title;
  a.title = articleUrl(item);
  tr.children[5].textContent = item.summary || "";
  const inc = inclusion(item);
  tr.children[6].innerHTML = `<b class="yn-${inc.trend ? "y" : "n"}">${yn(inc.trend)}</b> / <b class="yn-${inc.raw ? "y" : "n"}">${yn(inc.raw)}</b>`;
  tr.children[7].textContent = item.reason || item.by ? finalReason(item, inc) : inc.trend ? "" : notMonitoredReason(item);
  const notes = [];
  if (item.must) notes.push(`★ 꼭 넣을 글: ${item.mustNote || ""}`);
  if (item.review) notes.push(`최종 검수${reviewed(item) ? "" : "(이전 기준 - 다시 검수 필요)"}: 관련도 ${item.review.relevance}% · ${item.review.keep || item.must ? "포함" : "제외"}${reviewChecksText(item)} - ${item.review.why}`);
  if (item.aiScreen) notes.push(`AI 1차(제목·미리보기): ${item.aiScreen.maybe ? "관련 가능" : "무관"} - ${item.aiScreen.why}`);
  if (item.bodyNote) notes.push(item.bodyNote);
  else if (item.note) notes.push(item.note);
  if (item.bodyRead && !item.bodyNote) notes.push("본문 읽음");
  if (item.by === "ai") notes.push(`AI: ${item.situation || "요약"}${item.aiRelevant === false ? " (주제와 무관하다고 판단 - 체크 해제)" : ""}`);
  else if (item.by) notes.push("규칙 요약");
  notes.push(`검색어: ${item.queries.join(", ")}`);
  // 비고: 항목마다 한 줄, 길면 4줄까지만 보이고 마우스를 올리면 전체
  tr.children[8].replaceChildren(...notes.map((t) => Object.assign(document.createElement("div"), { textContent: t })));
  tr.children[8].title = notes.join("\n");
}

function renderRow(item) {
  const tr = rowEls.get(item.key);
  if (tr) fillRow(tr, item);
  updateCounts();
}

function updateCounts() {
  const n = items.filter((x) => x.checked).length;
  const read = items.filter((x) => x.checked && x.bodyRead).length;
  const byCar = CARS.map((c) => `${c.code} ${items.filter((x) => x.checked && x.car === c.code).length}`).join(" · ");
  $("#resultCount").textContent = items.length ? `전체 ${items.length}개 중 ${n}개 체크 (${byCar}) · 본문 읽음 ${read}/${n}` : "";
  $("#saveList").disabled = !n || running;
  $("#saveFinal").disabled = !n || running;
  $("#redoReview").disabled = !n || running;
  $("#saveRaw").disabled = !items.length || running;
  $("#readBodies").disabled = (!n && !items.length) || running;
  $("#rewrite").disabled = !n || running;
  $("#selDelete").disabled = !n || running;
  $("#selDelete").textContent = n ? `선택 삭제 (${n}개)` : "선택 삭제";
  // 💰 = AI 비용이 드는 버튼 (본문 읽기·다시 쓰기는 AI 를 켰을 때만 비용)
  const coin = aiOn() ? "💰 " : "";
  $("#readBodies").textContent = coin + (n - read > 0 ? `본문 읽고 요약하기 (${n - read}개 · 약 ${formatDuration((n - read) * SEC_PER_ARTICLE)})` : "요약하기");
  for (const el of document.querySelectorAll(".cost-ico[data-when='ai']")) el.hidden = !aiOn();
  // ②·③: 검수가 남은 글이 있고 AI 가 켜져 있을 때만 비용 (검수가 끝나면 두 버튼 모두 무료)
  const needReview = aiOn() && items.some((x) => x.checked && !reviewed(x));
  for (const el of document.querySelectorAll(".cost-ico[data-when='review']")) el.hidden = !needReview;
  const unread = items.filter((x) => !x.bodyRead && !x.touched).length;
  if ($("#readAllInfo")) $("#readAllInfo").textContent = `지금 읽을 글 ${unread.toLocaleString()}개 · 약 ${formatDuration(unread * SEC_PER_ARTICLE)}`;
  const vis = visibleItems();
  $("#checkAll").checked = !!vis.length && vis.every((x) => x.checked);
  renderYnCounts();
}

// 결과는 이 PC 크롬에 저장해 두어 화면을 다시 열어도 그대로
function saveItems() {
  return chrome.storage.local.set({ seatItems: items }).catch(() => {});
}

let saveTimer = null;
function saveItemsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveItems, 500);
}

// ---------------------------------------------------------------------------
// 엑셀 받기 (첨부 양식: B 순번 · C 차종 · D 동호회명 · E 게시일 · F 제목 · G URL · H 주요내용 요약 · I 포함 여부 · J 누락 사유)
// ---------------------------------------------------------------------------

async function buildExcel(selected, { final = false } = {}) {
  // 최종 파일은 '판단 기준' 시트가 붙은 양식 (scripts/build_seat_final_template.py)
  const resp = await fetch(chrome.runtime.getURL(final ? "seat-final-template.xlsx" : "seat-template.xlsx"));
  const wb = await XlsxTemplate.Workbook.open(new Uint8Array(await resp.arrayBuffer()));
  const sheet = wb.sheetNames()[0];
  const values = selected.map((x, i) => {
    const inc = inclusion(x);
    const d = x.date ? new Date(x.date) : null;
    return [
      null, i + 1, x.car, x.cafeName,
      d ? excelSerial(new Date(d.getFullYear(), d.getMonth(), d.getDate())) : "",
      x.title, articleUrl(x), x.summary || ruleSummary(x),
      {
        runs: [
          { text: yn(inc.trend), color: inc.trend ? BLUE : RED, bold: true, font: EXCEL_FONT },
          { text: " / ", font: EXCEL_FONT },
          { text: yn(inc.raw), color: inc.raw ? BLUE : RED, bold: true, font: EXCEL_FONT },
        ],
      },
      finalReason(x, inc),
      relevanceCell(x),
    ];
  });
  await wb.replaceRowsAfter(sheet, HEADER_ROW, values, STYLE_ROW, { focusFirstNew: true });
  const links = {};
  values.forEach((v, i) => (links[`G${HEADER_ROW + 1 + i}`] = v[6]));
  await wb.addHyperlinks(sheet, links);
  if (final) {
    // '판단 기준' 시트의 {{키}} 자리를 지금 설정값·건수로 채운다 (보고용이라 'AI' 라는 말은 쓰지 않음)
    const crit = "판단 기준";
    const fill = finalCriteria();
    const updates = {};
    for (const row of await wb.readRows(crit)) {
      for (const [col, v] of Object.entries(row.cells)) {
        const m = typeof v === "string" && v.match(/^\{\{(\w+)\}\}$/);
        if (m) updates[`${col}${row.r}`] = fill[m[1]] ?? "";
      }
    }
    await wb.setCellTexts(crit, updates);
  }
  return wb.save();
}

// 최종 파일 '판단 기준' 시트에 넣을 값 (그때의 설정·건수)
function finalCriteria() {
  const n = (v) => Number(v).toLocaleString();
  const lines = (v) => String(v || "").split(/[,\n]/).map((w) => w.trim()).filter(Boolean).join(", ");
  const day = (t) => (t === null || t === undefined ? "?" : new Date(t).toISOString().slice(0, 10));
  const end = $("#endDate").value || ymd(new Date());
  const cafeList = cafes();
  const ms = monitorStarts();
  const m = String($("#rawStart").value || ""), c = String($("#rawCover").value || "");
  return {
    period: CARS.map((x) => `${x.label}: ${ymd(carStart(x.code))} ~ ${end} (양산 시점부터)`).join("\n"),
    cafes: CARS.map((x) => {
      const list = cafeList.filter((cf) => cf.car === x.code);
      return `${x.code} (${list.length}곳): ${list.map((cf) => `${cf.name}(cafe.naver.com/${cf.slug})${cf.mixed ? " - 여러 차종 동호회라 차종 이름이 있는 글만" : ""}`).join(", ")}`;
    }).join("\n"),
    queries: `일반 동호회: ${lines($("#queries").value)}\n여러 차종 동호회: ${lines($("#mixedQueries").value).replace(/\{차종\}/g, "(차종 이름)")}\n` +
      `검색어마다 결과 최대 ${$("#maxPages").value}페이지까지, 시작일보다 오래된 글만 나오면 그 전에 멈춤`,
    words: `제목·미리보기에 아래 시트 단어와 위험 단어가 함께 있으면 체크, 제외 단어가 있으면 체크 해제\n` +
      `· 시트 단어: ${lines($("#rowWords").value)}\n· 위험 단어: ${lines($("#riskWords").value)}\n· 제외 단어: ${lines($("#exclude").value)}`,
    must: mustList().length ? `검색·판단과 상관없이 넣는 글(담당자 지정): ${mustList().map((x) => x.url).join(", ")}` : "없음",
    compareFiles: compare.length
      ? compare.map((f) => `[${f.kind === "trend" ? "온라인 동향" : "로데이터"}] ${f.name} (게시일 ${day(f.minDate)} ~ ${day(f.maxDate)} · 카페 글 ${n(f.keys.length)}개)`).join("\n") +
        (pendingShorts().length ? `\n※ 아직 풀지 않은 짧은 주소 ${n(pendingShorts().length)}개` : "")
      : "등록된 비교 파일 없음",
    monitorStart: Object.keys(ms).length
      ? Object.entries(ms).map(([slug, v]) => {
        const name = cafeList.find((cf) => cf.slug.toLowerCase() === slug)?.name || slug;
        return `${name}(cafe.naver.com/${slug}): 게시일 ${ymd(v.from)} 이전 글은 모니터링 대상이 아니었으므로, 온라인 동향에 없으면 누락 사유를 '해당 동호회(${name})는 당시 모니터링 대상 동호회가 아니었음${v.note ? ` (${v.note})` : ""}' 으로 씀`;
      }).join("\n")
      : "없음",
    rawStart: `전차종 로데이터는 ${m} 부터 작성(첫 로데이터에는 ${c} 게시글부터 담김). 그 이전 게시글이면서 로데이터에도 없는 글은 누락 사유 앞에 ` +
      `'전차종 로데이터는 …부터 작성되어 이 글의 게시 시점에는 로데이터 파일이 없었음' 을 붙임 (로데이터에 있는 글에는 붙이지 않음)`,
  };
}

// K열 주제 관련도: 숫자(0.85 → 양식의 백분율 서식으로 85%), 색은 양식의 조건부 서식(70% 이상 빨강 · 미만 파랑)
// (글자 "85%" 로 넣으면 엑셀이 '텍스트로 저장된 숫자' 경고를 띄우고 정렬도 글자순이 됨) · 검수 전이면 빈칸
function relevanceCell(x) {
  const r = x.review?.relevance;
  return typeof r === "number" ? r / 100 : "";
}

// "글 120개 · LX3 50 · ME1 40 · MX5 30 · 동향 미포함 95"
function fileSummary(stats) {
  return `글 ${stats.posts.toLocaleString()}개 · ${CARS.map((c) => `${c.code} ${(stats[c.code] || 0).toLocaleString()}`).join(" · ")} · ` +
    `N/N ${(stats.nn || 0).toLocaleString()} · N/Y ${(stats.ny || 0).toLocaleString()} · Y/Y ${(stats.yy || 0).toLocaleString()}`;
}

// 받은 글 수 · 전 기록 대비 증감
async function showDiffs() {
  const box = $("#diffs");
  const d = await dbStatDiff("seat", today(), "posts").catch(() => null);
  box.hidden = !d;
  box.replaceChildren();
  if (d) box.append(diffLine("엑셀에 넣은 글", d));
}

// 1차 검수(kind "seat": 체크한 글 전체) · 최종 파일(kind "seatFinal": 그중 AI 최종 검수를 통과한 글)
// ② 1차 검수 · ③ 최종 파일: 검수(관련도·4항목)가 안 된 체크한 글은 먼저 AI 검수 (② 에서 한 검수를 ③ 이 그대로 씀 → 비용은 한 번)
// → true: 진행 · false: 멈춤
async function ensureReviewed(kind) {
  const todo = sortedItems().filter((x) => x.checked && !reviewed(x)); // 검수 안 했거나 이전 기준으로 한 글
  if (!todo.length) return true;
  if (!aiOn()) {
    if (kind === "seatFinal") {
      setSummary("최종 파일은 AI 검수가 필요합니다. 3번 'Claude AI 설정'에 API 키를 넣고 켜 주세요.", "err");
      return false;
    }
    return askConfirm(`AI 가 꺼져 있어 검수하지 않은 글 ${todo.length}개는 '주제 관련도' 칸이 비어 있게 됩니다. 그대로 받을까요?`);
  }
  return aiReview(todo);
}

async function saveList() {
  if (running) return;
  if (!(await ensureReviewed("seat"))) return;
  return saveReport("seat");
}

async function saveFinal() {
  if (running) return;
  if (!(await ensureReviewed("seatFinal"))) return;
  return saveReport("seatFinal");
}

async function saveReport(kind) {
  const all = sortedItems().filter((x) => x.checked);
  const selected = kind === "seatFinal" ? all.filter((x) => (reviewed(x) && x.review.keep) || x.must) : all;
  if (!all.length) return;
  if (kind === "seatFinal" && !selected.length) {
    setSummary("AI 최종 검수를 통과한 글이 없습니다.", "err");
    return;
  }
  const noSummary = selected.filter((x) => !x.summary).length;
  if (noSummary && !(await askConfirm(`요약을 아직 쓰지 않은 글이 ${noSummary}개 있습니다. 이 글들은 규칙으로 요약해 넣을까요?\n(취소하면 받지 않습니다 - '본문 읽고 요약하기'를 먼저 눌러 주세요)`))) return;
  if (!compare.length && !(await askConfirm("비교 파일(온라인 동향·로데이터)이 등록되지 않아 포함 여부가 모두 N / N 으로 들어갑니다. 계속할까요?"))) return;
  const pend = pendingShorts().length;
  if (pend && !(await askConfirm(`비교 파일의 naver.me 짧은 주소 ${pend.toLocaleString()}개를 아직 풀지 않았습니다. 그 글들은 포함 여부가 N 으로 잘못 나올 수 있습니다.\n\n· [확인]: 그래도 받기\n· [취소]: 먼저 '짧은 주소 풀기' 하기`))) {
    $("#shortInfo").scrollIntoView({ block: "center" });
    return;
  }
  $("#saveInfo").className = "hint";
  $("#saveInfo").textContent = "엑셀 만드는 중…";
  try {
    const bytes = await buildExcel(selected, { final: kind === "seatFinal" });
    const name = datedFileName(kind === "seatFinal" ? FINAL_NAME : OUT_NAME);
    const where = await saveBytes(bytes, name);
    const miss = selected.filter((x) => !inclusion(x).trend).length;
    // 데이터 DB 에 오늘 파일로 보관 (같은 날 다시 받으면 바꿈)
    const yns = { nn: 0, ny: 0, yy: 0, yn: 0 };
    for (const x of selected) yns[ynCode(x).toLowerCase()]++;
    const reviewed = selected.filter((x) => typeof x.review?.relevance === "number");
    const rel = reviewed.length ? Math.round(reviewed.reduce((n, x) => n + x.review.relevance, 0) / reviewed.length) : null;
    const stats = { posts: selected.length, missing: miss, ...yns, ...(kind === "seatFinal" ? { from: all.length } : {}), relAvg: rel,
      relHigh: reviewed.filter((x) => x.review.relevance >= RELEVANCE_RED).length, aiCost: Math.round(selected.reduce((n, x) => n + (x.aiCost || 0), 0)), aiTotal: Math.round(aiSpend.won) };
    for (const c of CARS) stats[c.code] = selected.filter((x) => x.car === c.code).length;
    let dbNote = "";
    try {
      await dbSaveDay(kind, today(), name, bytes, "auto", fileSummary(stats), stats);
      dbNote = ` · 데이터 DB(${DB_KINDS[kind].short})에 오늘 파일로 저장했습니다`;
      if (kind === "seat") await showDiffs();
    } catch {
      dbNote = " · (데이터 DB 저장은 하지 못했습니다)";
    }
    $("#saveInfo").className = "hint ok";
    if (kind === "seatFinal") {
      // 최종 파일: "1차 검수 130개 중 85개 최종 확정"을 먼저
      const head = `✔ 1차 검수 ${all.length.toLocaleString()}개 중 ${selected.length.toLocaleString()}개 최종 확정 (제외 ${(all.length - selected.length).toLocaleString()}개)`;
      $("#saveInfo").textContent = `${head} · ${where}에 ${name} 저장 · 온라인 동향 N ${miss}개${dbNote}`;
      setSummary(head, "ok");
    } else {
      $("#saveInfo").textContent = `✔ ${where}에 ${name} - 글 ${selected.length.toLocaleString()}개 · 온라인 동향 N ${miss}개${dbNote}`;
    }
  } catch (e) {
    $("#saveInfo").className = "hint err";
    $("#saveInfo").textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  }
}

// 전체 raw 데이터: 찾은 글 전체(체크 안 된 글 포함)와 판단 근거·요약·본문 - 검토·보관용
const RAW_HEADERS = [
  "순번", "차종", "동호회명", "게시일", "제목", "URL", "최종 포함(체크)", "온라인동향/로데이터 포함 여부", "주요내용 요약", "미포함시 누락 사유",
  "AI 판단(상황)", "AI 1차 검토(제목·미리보기)", "꼭 넣을 글", "본문 읽음", "비고(판단 근거)", "검색어", "AI 비용(원)", "AI 비용($)",
  "주제 관련도(%)", "최종 검수", "①전동 시트 작동 이슈", "②작동 중 사고", "③위험·안전사고 우려", "④타 이슈 중 일부 언급", "최종 검수 근거", "본문",
];

function rawRows() {
  return sortedItems().map((x, i) => {
    const inc = inclusion(x);
    const ai = x.by === "ai" ? `${x.aiRelevant === false ? "무관" : "관련"} · ${x.situation || ""}` : x.by === "rule" ? "규칙 요약" : "";
    const screen = x.aiScreen ? `${x.aiScreen.maybe ? "관련 가능" : "무관"} - ${x.aiScreen.why}` : "";
    const notes = [x.mustNote, x.bodyNote || x.note].filter(Boolean).join(" · ");
    return [
      i + 1, x.car, x.cafeName, x.date ? formatDateTime(new Date(x.date), false) : "", x.title, articleUrl(x), x.checked ? "O" : "",
      `${yn(inc.trend)} / ${yn(inc.raw)}`, x.summary || "", x.reason || x.by ? finalReason(x, inc) : "", ai, screen, x.must ? "O" : "",
      x.bodyRead ? "O" : "", notes, (x.queries || []).join(", "), x.aiCost ? Math.round(x.aiCost * 10) / 10 : "", x.aiCost ? Math.round((x.aiCost / WON_PER_USD) * 10000) / 10000 : "",
      typeof x.review?.relevance === "number" ? x.review.relevance : "",
      x.review ? `${x.review.keep || x.must ? "포함" : "제외"}${reviewed(x) ? "" : " (이전 기준)"}` : "",
      ...["seatIssue", "accident", "concern", "partialMention"].map((k) => (x.review?.checks ? (x.review.checks[k] ? "O" : "X") : "")),
      x.review?.why || "",
      (x.body || "").slice(0, 32000),
    ];
  });
}

async function saveRaw() {
  if (!items.length) return;
  $("#saveInfo").className = "hint";
  $("#saveInfo").textContent = "전체 raw 데이터 엑셀 만드는 중…";
  try {
    const rows = rawRows();
    const bytes = XlsxWriter.build([{
      name: "전체 raw data", rows: [RAW_HEADERS, ...rows],
      widths: { 1: 6, 2: 6, 3: 16, 4: 11, 5: 40, 6: 38, 7: 8, 8: 10, 9: 50, 10: 40, 11: 16, 12: 36, 13: 7, 14: 7, 15: 40, 16: 24, 17: 9, 18: 9, 19: 9, 20: 8, 21: 9, 22: 9, 23: 9, 24: 9, 25: 40, 26: 80 },
      wrapCols: [5, 9, 10, 12, 15, 25],
    }], { font: EXCEL_FONT, headFill: "FFF37021" });
    const name = datedFileName(RAW_NAME);
    const where = await saveBytes(bytes, name);
    const checked = items.filter((x) => x.checked).length;
    const stats = { posts: items.length, checked, aiCost: Math.round(items.reduce((n, x) => n + (x.aiCost || 0), 0)), aiTotal: Math.round(aiSpend.won) };
    let dbNote = "";
    try {
      await dbSaveDay("seatRaw", today(), name, bytes, "auto", `찾은 글 ${items.length.toLocaleString()}개 · 체크 ${checked.toLocaleString()}개`, stats);
      dbNote = " · 데이터 DB(로우 엑셀)에 오늘 파일로 저장했습니다";
    } catch {
      dbNote = " · (데이터 DB 저장은 하지 못했습니다)";
    }
    $("#saveInfo").className = "hint ok";
    $("#saveInfo").textContent = `✔ ${where}에 ${name} - 찾은 글 ${items.length.toLocaleString()}개 (체크 ${checked.toLocaleString()}개)${dbNote}`;
  } catch (e) {
    $("#saveInfo").className = "hint err";
    $("#saveInfo").textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// 작업 중 표시 (진행 막대·나가기 막기는 cafe-common.js 의 showBusy/hideBusy)
// ---------------------------------------------------------------------------

function startBusy() {
  running = true;
  stopRequested = false;
  $("#search").disabled = true;
  $("#stop").disabled = false;
  updateCounts();
}

function endBusy() {
  running = false;
  hideBusy();
  $("#search").disabled = false;
  $("#stop").disabled = true;
  updateCounts();
}

// ---------------------------------------------------------------------------
// 로그인 · 시작
// ---------------------------------------------------------------------------

async function checkLogin() {
  const box = $("#login");
  let ok = false;
  try {
    ok = !!(await chrome.cookies.get({ url: "https://www.naver.com/", name: "NID_AUT" }));
  } catch {
    ok = false;
  }
  box.className = ok ? "login ok" : "login bad";
  if (ok) box.textContent = "네이버 로그인됨 ✓";
  else
    box.innerHTML =
      '카페 글을 찾으려면 네이버 로그인이 필요합니다. <a href="https://nid.naver.com/nidlogin.login" target="_blank">여기서 로그인</a>한 뒤 이 화면으로 돌아오세요.';
  return ok;
}

async function init() {
  await loadSettings();
  aiSpend = (await chrome.storage.local.get("seatAiSpend").catch(() => ({}))).seatAiSpend || aiSpend;
  $("#endDate").value = ymd(new Date());
  await loadCompare();
  renderCompare();
  setupPanel("panelCompare", !compare.length || pendingShorts().length > 0);
  setupPanel("panelAi", !$("#aiKey").value.trim());
  for (const c of CARS) $("#carFilter").add(new Option(c.label, c.code));
  const saved = (await chrome.storage.local.get("seatItems").catch(() => ({}))).seatItems || [];
  items = saved;
  renderResults();
  if (items.length) setSummary(`지난번까지 찾은 글 ${items.length}개입니다. '게시물 찾기'를 다시 누르면 새로 찾은 글이 더해집니다.`);

  for (const id of [...SETTING_IDS, "tabFallback", "saveAsk"]) {
    $(`#${id}`).addEventListener("change", async () => {
      if (id === "searchUrl") $("#searchUrl").value = normalizeSearchUrl($("#searchUrl").value);
      await saveSettings();
      if (id === "cafeList") renderCafeInfo();
      if (["queries", "mixedQueries", "maxPages", "carWords"].includes(id)) updateJobInfo();
      if (["rowWords", "riskWords", "exclude", "carWords"].includes(id)) {
        for (const x of items) {
          const j = judge(x, `${x.title} ${x.body || x.text}`);
          x.related = j.related;
          x.note = judgeNote(j);
          if (!x.touched) x.checked = j.related;
        }
        renderResults();
        saveItemsSoon();
      }
    });
  }
  $("#aiKey").addEventListener("change", saveAiKey);
  $("#aiKey").addEventListener("keydown", (e) => e.key === "Enter" && saveAiKey());
  $("#aiSave").addEventListener("click", saveAiKey);
  $("#aiTest").addEventListener("click", testAiKey);
  for (const id of ["aiModel", "aiOn"]) $(`#${id}`).addEventListener("change", () => (saveSettings(), showAiStatus()));
  $("#resetSettings").addEventListener("click", async () => {
    if (!(await askConfirm("동호회·검색어·관련 단어 설정을 처음 값으로 되돌릴까요?"))) return;
    for (const id of SETTING_IDS) $(`#${id}`).value = SETTING_DEFAULTS[id];
    renderCars({});
    await saveSettings();
  });
  $("#search").addEventListener("click", async () => {
    const r = await loadResume("seat");
    search(r && (await askConfirm(`중단된 게시물 찾기가 있습니다 (${r.jobs.length}개 중 ${r.next}개 완료).\n\n· [확인]: 이어서 찾기\n· [취소]: 처음부터 다시 찾기`)) ? r : null);
  });
  $("#mustOnly").addEventListener("click", async () => {
    if (running) return;
    await saveSettings();
    startBusy();
    const r = await addMustPosts();
    endBusy();
    renderResults();
    setSummary(r ? `꼭 넣을 글 ${r.length}개를 넣었습니다 (검색으로 찾은 글 ${r.filter((m) => m.bySearch).length}개 · 자세한 내용은 기록창).` : "꼭 넣을 글 칸에 주소가 없습니다.", r ? "ok" : "err");
  });
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 보는 화면까지 마칩니다)");
  });
  $("#resolveShorts").addEventListener("click", resolveShorts);
  $("#compareFiles").addEventListener("change", (e) => e.target.files.length && addCompareFiles(e.target.files));
  $("#carFilter").addEventListener("change", renderResults);
  $("#viewFilter").addEventListener("change", renderResults);
  $("#sortBy").addEventListener("change", renderResults);
  const setVisible = (fn) => {
    for (const x of visibleItems()) {
      x.checked = fn(x);
      x.touched = true;
    }
    renderResults();
    saveItemsSoon();
  };
  $("#selAll").addEventListener("click", () => setVisible(() => true));
  $("#selNone").addEventListener("click", () => setVisible(() => false));
  $("#checkAll").addEventListener("change", (e) => setVisible(() => e.target.checked));
  $("#selDelete").addEventListener("click", async () => {
    const n = items.filter((x) => x.checked).length;
    if (!n || !(await askConfirm(`체크한 게시물 ${n}개를 목록에서 삭제할까요?`))) return;
    items = items.filter((x) => !x.checked);
    renderResults();
    await saveItems();
  });
  $("#clearAll").addEventListener("click", async () => {
    if (!items.length || !(await askConfirm(`찾은 글 ${items.length}개(읽은 본문·요약 포함)를 모두 지울까요?`))) return;
    items = [];
    await clearResume("seat");
    renderResults();
    await saveItems();
  });
  $("#readBodies").addEventListener("click", readBodies);
  $("#readAll").addEventListener("change", updateCounts);
  $("#rewrite").addEventListener("click", () => !running && writeSummaries(true));
  // 저장 버튼을 누른 그때 폴더 쓰기 허용을 확인해 둔다 (허용 요청은 사용자 동작 안에서만 가능)
  $("#saveList").addEventListener("click", () => (prepareFolder(), saveList()));
  $("#saveRaw").addEventListener("click", () => (prepareFolder(), saveRaw()));
  $("#saveFinal").addEventListener("click", () => (prepareFolder(), saveFinal()));
  $("#redoReview").addEventListener("click", redoReview);
  $("#pickFolder").addEventListener("click", pickSaveFolder);
  $("#clearFolder").addEventListener("click", clearSaveFolder);
  renderSaveFolder();
  $("#diag").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, at: new Date().toString(), diagnostics }, null, 1)], { type: "application/json" });
    prepareFolder();
    saveBytes(blob, `${today()}_시트위험_진단.json`);
  });
  window.addEventListener("focus", checkLogin);
  checkLogin();
  // 중단된 찾기가 있으면 이어서 할지 묻는다
  const r = await loadResume("seat");
  if (r && (await askConfirm(`중단된 게시물 찾기가 있습니다 (동호회·검색어 ${r.jobs.length}개 중 ${r.next}개 완료 · ${new Date(r.at).toLocaleString()}).\n\n· [확인]: 이어서 찾기\n· [취소]: 나중에 ('게시물 찾기'를 누르면 다시 물어봄)`))) search(r);
}

// 위쪽 '⚙ 설정' 버튼(seat.html#settings): 설정을 펼치고 그 위치로
function openSettingsFromHash() {
  if (location.hash !== "#settings") return;
  $("#settings").open = true;
  $("#settings").scrollIntoView({ block: "start", behavior: "smooth" });
}
window.addEventListener("hashchange", openSettingsFromHash);

init().then(openSettingsFromHash);
