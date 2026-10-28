// 싼타페 페이스리프트(MX5 F/L) 가격 언급 게시물 수집 - 싼타페 동호회에서 기간을 정해, 제목·본문에 출시 예정인
// 싼타페 페이스리프트(MX5 F/L)의 가격 이야기가 있는 글을 찾아
// 순번 · 동호회명 · 작성일 · 제목 · 내용 요약 · URL · 작성자 닉네임 · 조회수 · 댓글수를 엑셀로 받는다.
// 목적: 아반떼·투싼 가격 공개(기준 사건) 전후로 싼타페 F/L 가격 여론이 어떻게 바뀌는지 보고하는 것.
// 그래서 글마다 구간(사건 전/후) · 가격 여론(긍정·중립·부정) · 비교 차종 · 구매 영향 · 여론 요지를 붙이고,
// 구간별·주별로 모아 '여론 변화' 시트로 정리한다.
// 네이버는 API 를 부르지 않고 검색 화면·게시글을 보이지 않는 틀(필요하면 뒤쪽 탭)로 열어 화면에 보이는 내용만 읽는다(cafe-common.js).

const DEFAULT_CAFES = ["MX5 | 싼타페MX5패밀리 | trailer", "MX5 | 클럽싼타페 | iroid", "MX5 | 싼타페MX5클럽 | choids"].join("\n");
// 예상 가격을 언급한 글을 빠짐없이 모으려고 넓게 검색한다 (같은 글이 여러 검색어에 나와도 한 번만 넣음)
const DEFAULT_QUERIES =
  "페리 가격, 페리 예상 가격, 페리 가격 예상, 페리 예상가, 페리 가격표, 페리 얼마, 페리 출시가, 페리 견적, 페리 사전계약, 페리 인상, " +
  "페이스리프트 가격, 페이스리프트 예상 가격, F/L 가격, 부분변경 가격, 신형 가격, 신형 싼타페 가격, 27년형 가격, " +
  "출시 가격, 예상 가격, 가격 인상, 싼타페 가격, 아반떼 가격, 투싼 가격";
const DEFAULT_FL_WORDS = "페리, 페이스리프트, 페이스 리프트, F/L, FL, 부분변경, 부분 변경, 신형, 더뉴, 더 뉴, 27년형, 2027년형, 출시 예정, 출시예정, 출시되면";
const DEFAULT_PRICE_WORDS =
  "가격, 가격표, 출시가, 판매가, 시작가, 차값, 찻값, 차량가, 만원, 만 원, 천만, 인상폭, 올랐, 오른다, 오를, 오르겠, 올린, 올려, 비싸, 비쌀, 비싼, 저렴, 싸게, 견적, 할인, 가성비, 얼마, 몇천";
// 비교 차종: 이 차 가격 이야기도 싼타페 동호회에서는 F/L 가격 예상과 이어지는 경우가 많아 함께 찾는다 (AI 가 싼타페와 이어지는지 다시 판단)
const DEFAULT_COMPARE_WORDS = "아반떼, 투싼";
// 기준 사건: 날짜 | 짧은 이름 | 설명(AI 에게 전달) - 이 날짜부터 '사건 후' 구간
const DEFAULT_EVENTS = [
  "2026-08-05 | 아반떼 가격 공개 | 8세대 디 올 뉴 아반떼 가격 공개·계약 시작 (가솔린 2,398만 원~, 하이브리드 2,942만 원~)",
  "2026-10-21 | 투싼 가격 공개 | 5세대 디 올 뉴 투싼 가격 공개·계약 시작 (3,140만 원~, 기본 트림 약 300만 원 인상)",
].join("\n");
const DEFAULT_SANTAFE_WORDS = "싼타페, 산타페, 싼타, 산타, 싼페, MX5";
const DEFAULT_EXCLUDE = "팝니다, 삽니다, 판매합니다, 공동구매";
const DEFAULT_AI_RULES = "";
const DEFAULT_SEARCH_URL = "https://cafe.naver.com/f-e/cafes/{cafeId}/menus/0?viewType=L&ta=ARTICLE_COMMENT&page={page}&q={q}";
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_LEAD_DAYS = 30; // 처음 열었을 때 기간: 첫 기준 사건 30일 전부터 오늘까지 (사건 전 여론과 비교하려고)
const HEADER_ROW = 3; // 양식 '게시물' 시트: 3행 머리글(B 순번 … J 댓글수 · K 구간 · L 가격 여론 · M 비교 차종 · N 구매 영향 · O 여론 요지)
const STYLE_ROW = 4;
const STAGE_HEADER_ROW = 5; // '구간별 여론' 시트 (3행: 여론 변화 보고)
const WEEK_HEADER_ROW = 3; // '주별 추이' 시트
const TONES = ["긍정", "중립", "부정"];
const IMPACTS = ["구매 의향", "대기·관망", "타 차종 고려·이탈", "해당 없음"];
const OUT_NAME = "싼타페 페이스리프트(MX5 FL) 가격 언급 게시물";
// 걸리는 시간 어림 (초): 검색 화면 한 페이지 · 글 하나
const SEC_PER_PAGE = 9;
const SEC_PER_ARTICLE = 12;

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본 · 권장)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴 · 정확도 낮음)"],
];
// AI_PRICE · WON_PER_USD · aiWonExact · fmtWon 은 ui.js
const AI_BATCH = 6; // 한 번에 보내는 글 수
const AI_PARALLEL = 3;
const AI_BODY_CHARS = 4000; // 글마다 보내는 본문 길이

let items = []; // { key, cafeIndex, cafeName, slug, articleId, title, text, date, hasTime, queries, related, note, checked, touched, body, bodyRead, bodyNote, nickname, views, comments, summary, by }
let clubIds = {}; // 영문 주소 → 카페 번호
let running = false;
let stopRequested = false;
let diagnostics = [];
let aiSpend = { won: 0, input: 0, output: 0 }; // AI 누적 비용 (요약·보고 모두)
let timeLog = { search: 0, read: 0, ai: 0, report: 0 }; // 누적 소요 시간(초): 찾기 · 본문 읽기·요약 · AI 요약 · 보고 쓰기

// 소요 시간 기록 (데이터 DB 에 파일마다 남김)
function addTime(kind, t0) {
  timeLog = { ...timeLog, [kind]: (timeLog[kind] || 0) + (Date.now() - t0) / 1000 };
  chrome.storage.local.set({ priceTime: timeLog }).catch(() => {});
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const SETTING_IDS = ["events", "cafeList", "queries", "flWords", "priceWords", "compareWords", "santafeWords", "exclude", "aiRules", "searchUrl", "maxPages"];
const SETTING_DEFAULTS = {
  events: DEFAULT_EVENTS, cafeList: DEFAULT_CAFES, queries: DEFAULT_QUERIES, flWords: DEFAULT_FL_WORDS, priceWords: DEFAULT_PRICE_WORDS,
  compareWords: DEFAULT_COMPARE_WORDS, santafeWords: DEFAULT_SANTAFE_WORDS, exclude: DEFAULT_EXCLUDE, aiRules: DEFAULT_AI_RULES, searchUrl: DEFAULT_SEARCH_URL, maxPages: DEFAULT_MAX_PAGES,
};

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["priceSettings", "priceStart", "priceClubIds", "saveAsk", "priceTabFallback", "aiKey", "aiModel", "priceAiOn"])
    .catch(() => ({}));
  const set = s.priceSettings || {};
  for (const id of SETTING_IDS) $(`#${id}`).value = set[id] ?? SETTING_DEFAULTS[id];
  $("#saveAsk").checked = !!s.saveAsk;
  $("#tabFallback").checked = s.priceTabFallback ?? true;
  clubIds = { ...(s.priceClubIds || {}) };
  for (const [id, slug] of Object.entries(await loadCafeSlugs())) if (!clubIds[slug.toLowerCase()]) clubIds[slug.toLowerCase()] = id;
  // 기간: 시작일은 지난번 값, 끝 날짜는 늘 오늘
  $("#endDate").value = ymd(new Date());
  $("#startDate").value = s.priceStart || ymd(defaultStart());
  const sel = $("#aiModel");
  sel.innerHTML = "";
  for (const [id, label] of AI_MODELS) sel.add(new Option(label, id));
  if (s.aiModel && AI_MODELS.some(([id]) => id === s.aiModel)) sel.value = s.aiModel;
  $("#aiKey").value = s.aiKey || "";
  $("#aiOn").checked = !!s.priceAiOn;
  showAiStatus();
  renderCafeInfo();
}

function saveSettings() {
  const set = {};
  for (const id of SETTING_IDS) set[id] = $(`#${id}`).value;
  set.maxPages = Math.max(1, Math.min(100, Number(set.maxPages) || DEFAULT_MAX_PAGES));
  set.searchUrl = normalizeSearchUrl(set.searchUrl);
  return chrome.storage.local
    .set({
      priceSettings: set,
      priceStart: $("#startDate").value,
      priceTabFallback: $("#tabFallback").checked,
      saveAsk: $("#saveAsk").checked,
      aiKey: $("#aiKey").value.trim(),
      aiModel: $("#aiModel").value,
      priceAiOn: $("#aiOn").checked,
    })
    .catch(() => {});
}

function saveClubIds() {
  return chrome.storage.local.set({ priceClubIds: clubIds }).catch(() => {});
}

function compactText(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

// 단어 목록 → [{ w: 비교할 글자, ascii: 영문·숫자 낱말인지 }]
function wordList(text) {
  return String(text || "")
    .split(/[,\n]/)
    .map((w) => compactText(w))
    .filter(Boolean)
    .map((w) => ({ w, ascii: /^[a-z0-9/]+$/.test(w) }));
}

// 한글 단어는 띄어쓰기를 빼고 들어 있는지, 영문 낱말(FL 등)은 앞뒤가 영문자가 아닐 때만 (flex·flat 에서 찾지 않음)
function hasWord(compact, w) {
  if (!w.ascii) return compact.includes(w.w);
  let i = compact.indexOf(w.w);
  while (i >= 0) {
    const before = compact[i - 1] || "";
    const after = compact[i + w.w.length] || "";
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return true;
    i = compact.indexOf(w.w, i + 1);
  }
  return false;
}

// 동호회 목록 → [{ car, name, slug }]
function cafes() {
  const out = [];
  for (const line of $("#cafeList").value.split(/\r?\n/)) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;
    const [car, name, addr] = parts.length >= 3 ? parts : ["", parts[0], parts[1]];
    const slug = (parseArticleUrl(addr).cafeUrl || addr.replace(/^https?:\/\/(?:m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, "")).trim();
    if (!isSlug(slug)) continue;
    out.push({ car: car.toUpperCase(), name: name || slug, slug });
  }
  return out;
}

function queries() {
  return [...new Set(String($("#queries").value).split(/[,\n]/).map((q) => q.trim()).filter(Boolean))];
}

function daysAgo(n) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
}

function dayOf(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// 기간: { start: 시작일 0시, end: 끝 날짜 다음 날 0시 }
function period() {
  const start = dayOf($("#startDate").value) || new Date(0);
  const e = dayOf($("#endDate").value);
  const end = e ? new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1) : new Date(8640000000000000);
  return { start, end };
}

function inPeriod(item, p = period()) {
  if (!item.date) return true; // 날짜를 모르면 빼지 않음 (본문을 읽으면 정해짐)
  const d = new Date(item.date);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day >= p.start && day < p.end;
}

function periodText() {
  return `${$("#startDate").value || "처음"} ~ ${$("#endDate").value || "오늘"}`;
}

// ---------------------------------------------------------------------------
// 기준 사건 · 구간: 사건 날짜(그날 포함)부터 '사건 후' 구간
// ---------------------------------------------------------------------------

// 기준 사건 → [{ day: Date(0시), name, note }] (날짜순)
function events() {
  const out = [];
  for (const line of String($("#events").value || "").split(/\r?\n/)) {
    const [d, name, note] = line.split("|").map((x) => (x || "").trim());
    const day = dayOf(d);
    if (day && name) out.push({ day, name, note: note || "" });
  }
  return out.sort((a, b) => a.day - b.day);
}

// 처음 열었을 때 시작일: 첫 기준 사건 30일 전 (사건이 없으면 30일 전)
function defaultStart() {
  const first = events()[0];
  if (!first) return daysAgo(DEFAULT_LEAD_DAYS);
  return new Date(first.day.getFullYear(), first.day.getMonth(), first.day.getDate() - DEFAULT_LEAD_DAYS);
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";

// 구간 → [{ i, name, from: Date|null, to: Date|null(다음 사건 날짜, 그날은 빠짐) }]
// 예) ① 아반떼 가격 공개 전 · ② 아반떼 가격 공개 후 · ③ 투싼 가격 공개 후
function stages() {
  const ev = events();
  const out = [{ i: 0, name: `${CIRCLED[0]} ${ev[0] ? `${ev[0].name} 전` : "전체"}`, from: null, to: ev[0]?.day || null }];
  ev.forEach((e, k) => out.push({ i: k + 1, name: `${CIRCLED[k + 1] || k + 2} ${e.name} 후`, from: e.day, to: ev[k + 1]?.day || null }));
  return out;
}

function stageOf(time, list = stages()) {
  if (!time) return null;
  const d = new Date(time);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return list.filter((s) => !s.from || day >= s.from).pop();
}

function renderCafeInfo() {
  const list = cafes();
  $("#cafeNames").textContent = list.length ? `동호회 ${list.length}곳: ${list.map((c) => `${c.name}(${c.slug})`).join(" · ")}` : "동호회가 없습니다 (설정에서 추가)";
  const tbody = $("#cafeInfo tbody");
  tbody.innerHTML = "";
  for (const c of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td><input type="text" class="slug" spellcheck="false" placeholder="자동 (숫자나 카페 주소 붙여넣기)"></td>`;
    tr.children[0].textContent = c.name;
    tr.children[1].textContent = c.slug;
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
  const filter = $("#cafeFilter");
  const keep = filter.value;
  filter.length = 1;
  for (const c of list) filter.add(new Option(c.name, c.slug.toLowerCase()));
  filter.value = [...filter.options].some((o) => o.value === keep) ? keep : "";
  updateJobInfo();
}

function renderCafeInfoIds() {
  const list = cafes();
  document.querySelectorAll("#cafeInfo tbody input").forEach((input, i) => {
    if (!input.value && list[i]) input.value = clubIds[list[i].slug.toLowerCase()] || "";
  });
}

// 찾을 일 목록: 동호회 × 검색어
function jobs() {
  const out = [];
  const qs = queries();
  cafes().forEach((c, cafeIndex) => {
    for (const q of qs) out.push({ ...c, cafeIndex, q });
  });
  return out;
}

function updateJobInfo() {
  const list = jobs();
  const p = period();
  const days = Math.max(1, Math.round((Math.min(p.end, new Date()) - p.start) / 86400000));
  // 기간이 짧으면 대부분 한두 페이지에서 끝남
  const pages = Math.min(Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES), Math.max(1, Math.ceil(days / 30)));
  const sec = list.length * pages * SEC_PER_PAGE;
  $("#jobInfo").textContent = list.length
    ? `기간 ${periodText()} · 동호회·검색어 ${list.length}개 · 예상 소요 시간 약 ${formatDuration(sec)} (글 수에 따라 달라짐)`
    : "설정에 동호회와 검색어를 넣어 주세요.";
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
// 관련 글 판단: 가격 단어 + (페리(F/L) 단어 또는 비교 차종), 관련 없는 단어가 있으면 제외
// (싼타페 동호회의 아반떼·투싼 가격 이야기는 F/L 가격 예상과 이어지는 경우가 많아 함께 체크 - AI 가 다시 판단)
// ---------------------------------------------------------------------------

function judge(text) {
  const t = compactText(text);
  const fl = wordList($("#flWords").value).some((w) => hasWord(t, w));
  // 비교 차종(아반떼·투싼) 글은 싼타페 이야기가 함께 있을 때만 (그 차 가격만의 이야기는 현행 차량 가격이라 넣지 않음)
  const cmpCar = wordList($("#compareWords").value).some((w) => hasWord(t, w));
  const cmp = cmpCar && wordList($("#santafeWords").value).some((w) => hasWord(t, w));
  const price = wordList($("#priceWords").value).some((w) => hasWord(t, w));
  const exc = wordList($("#exclude").value).some((w) => hasWord(t, w));
  // candidate: 가격 단어는 (목록에) 안 보여도 페리·비교 차종 단어가 있으면 본문까지 열어 확인할 글
  // (비교 차종 글은 목록 제목에 싼타페 단어가 없어도 본문에 있을 수 있어 본문까지 확인)
  return { related: (fl || cmp) && price && !exc, candidate: (fl || cmpCar) && !exc, fl, cmp, price, exc };
}

function judgeNote(j) {
  if (j.related) return "";
  if (j.exc) return "관련 없는 단어 있음";
  if (!j.fl && !j.cmp) return "페리(F/L)·비교 차종 단어 없음";
  return "가격 단어 없음";
}

// 비교 차종 이름 (설정의 첫 글자 그대로: 아반떼, 투싼)
function compareCars() {
  return String($("#compareWords").value || "").split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 글마다 여론: 가격 여론(긍정·중립·부정) · 비교 차종 · 구매 영향 · 여론 요지
// AI 를 쓰면 AI 가 판단하고, 쓰지 않으면 아래 단어 규칙으로 정한다(어림 - 보고 전 확인 필요).
// ---------------------------------------------------------------------------

const NEG_WORDS = ["비싸", "비쌀", "비싼", "올랐", "오르겠", "오를", "오른다", "인상폭", "부담", "거품", "창렬", "호구", "실망", "너무하", "미쳤", "선넘", "선 넘", "욕나", "안 살", "안살"];
const POS_WORDS = ["착하", "적당", "합리", "가성비좋", "가성비 좋", "괜찮", "저렴", "혜자", "잘나왔", "잘 나왔", "만족", "선방", "동결", "생각보다싸", "생각보다 싸"];
const WAIT_WORDS = ["기다리", "기다려", "대기", "관망", "존버", "지켜보", "보고 결정", "보고결정", "나오면 보고"];
const LEAVE_WORDS = ["투싼으로", "쏘렌토", "넘어가", "갈아타", "다른 차", "다른차", "포기", "수입차", "차라리"];
const BUY_WORDS = ["계약했", "계약할", "계약 예정", "사려고", "살 생각", "구매 예정", "구매예정", "사전계약", "출고 대기"];

function ruleOpinion(item) {
  const src = `${item.title} ${item.body || item.text || ""}`;
  const t = compactText(src);
  const count = (list) => list.filter((w) => t.includes(compactText(w))).length;
  const neg = count(NEG_WORDS);
  const pos = count(POS_WORDS);
  const tone = neg > pos ? "부정" : pos > neg ? "긍정" : "중립";
  const compare = compareCars().filter((c) => t.includes(compactText(c)));
  const impact = count(LEAVE_WORDS) ? "타 차종 고려·이탈" : count(WAIT_WORDS) ? "대기·관망" : count(BUY_WORDS) ? "구매 의향" : "해당 없음";
  return { tone, compare, impact, point: "", ...ruleRaise(src) };
}

// 예상 인상 폭(어림): "300만원 오른다" · "200~300 정도 인상" · "400 올랐" → 만 원 단위 (범위면 가운데 값)
// 페리·신형 단어가 있는 문장(이나 바로 앞 문장)에서만 찾는다 (현행 차량·다른 차 가격 숫자를 잡지 않도록)
function ruleRaise(src) {
  const flW = wordList($("#flWords").value);
  const isFl = (sent) => flW.some((w) => hasWord(compactText(sent), w));
  let prevFl = false;
  for (const sent of String(src || "").split(/(?<=[.!?。])\s+|\n+/)) {
    const fl = isFl(sent);
    const near = fl || prevFl;
    prevFl = fl;
    if (!near) continue;
    const m = sent.match(/(\d{2,4})(?:\s*[~\-]\s*(\d{2,4}))?\s*(?:만\s*원?|만)?\s*(?:정도|가량|쯤|이상|넘게)?\s*(?:은|는|이|가|씩)?\s*(인상|오르|오를|올라|올랐|오른|비싸|인하|내려|싸지)/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const v = Math.round((a + b) / 2);
    if (v <= 0 || v > 3000) continue;
    return { raise: /인하|내려|싸지/.test(m[3]) ? -v : v, expect: m[0].trim().slice(0, 40) };
  }
  return { raise: null, expect: "" };
}

// 표·엑셀에 쓰는 여론 (AI 결과가 있으면 그것, 없으면 규칙)
function opinion(item) {
  if (item.by === "ai" && item.tone) {
    return { tone: item.tone, compare: item.compare || [], impact: item.impact || "해당 없음", point: item.point || "", expect: item.expect || "", raise: item.raise ?? null };
  }
  return ruleOpinion(item);
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

// 카페 번호 알아내기: 카페 첫 화면 → 이미 찾은 그 카페 글 하나 (숨긴 화면에서 못 읽으면 뒤쪽 탭으로)
async function resolveClubId(slug) {
  const known = clubIds[slug.toLowerCase()];
  if (known) return known;
  const art = items.find((x) => x.slug.toLowerCase() === slug.toLowerCase())?.articleId;
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

// 게시글 화면: 제목 · 작성 시간 · 본문 · 작성자 닉네임 · 조회수 · 댓글수
// (각 틀 안에서 실행되므로 확장 바깥 함수는 쓸 수 없음)
function readPostInFrame() {
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
  const one = (s) => String(s || "").replace(/\s+/g, " ").trim();
  // "1,234" · "1.2만" → 1234 · 12000
  const num = (s) => {
    const m = String(s || "").match(/([\d][\d,]*(?:\.\d+)?)\s*(만)?/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(m[2] ? n * 10000 : n) : null;
  };
  const nickEl =
    q(".ArticleWriterProfile .nickname") || q(".WriterInfo .nickname") || q(".profile_info .nickname") || q(".nick_box .nickname") ||
    q(".article_writer .nickname") || q(".article_writer") || q(".p-nick") || q(".m-tcol-c.nick");
  const nickname = one(nickEl?.innerText).replace(/\s*(?:님|작성자|매니저|스탭)$/, "").slice(0, 60);
  // 글 머리(제목·작성자·날짜·조회)와 글 아래 도구 줄(댓글 버튼)에서 숫자를 찾는다
  // (본문·댓글 내용 속 "조회 100", "댓글 3개" 같은 글자를 잡지 않도록 그 둘은 빼고 본다)
  const head = q(".ArticleContentBox .article_header") || q(".article_header") || q(".WriterInfo") || q(".article_info");
  const tool = q(".ArticleTool") || q(".ArticleBottomBtns") || q(".comment_option");
  const commentBox = q(".CommentBox") || q(".comment_box");
  let outside = text;
  for (const el of [bodyEl, commentBox]) {
    const t = String(el?.innerText || "");
    if (t) outside = outside.replace(t, " ");
  }
  const viewsIn = (s) => num(String(s || "").match(/조회\s*수?\s*[\d][\d,.]*\s*만?/)?.[0]?.replace(/^조회\s*수?/, ""));
  let views = num(q(".article_info .count")?.innerText);
  if (views === null) views = viewsIn(head?.innerText);
  if (views === null) views = viewsIn(outside);
  let comments = num(q(".ArticleTool .button_comment")?.innerText || q(".button_comment")?.innerText || q(".comment_count")?.innerText);
  if (comments === null) {
    const m = `${head?.innerText || ""}\n${tool?.innerText || ""}`.match(/댓글\s*[\d][\d,]*/) || outside.match(/댓글\s*[\d][\d,]*/);
    comments = m ? num(m[0].replace(/^댓글/, "")) : null;
  }
  if (comments === null && commentBox) comments = commentBox.querySelectorAll("li.CommentItem").length;
  const body = String(bodyEl.innerText || "")
    .replace(/[​ ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return {
    found: true, title: titleEl ? one(titleEl.innerText) : "", body: body.slice(0, 8000), dateText, href: location.href,
    nickname, views, comments,
  };
}

async function readPost(url) {
  const tryIn = (mode) =>
    withTab(url, async (where) => {
      for (let i = 0; i < 8; i++) {
        const frames = await runInFrames(where, readPostInFrame);
        const hit = frames.find((f) => f.found);
        if (hit) {
          if (!hit.locked && !hit.deleted) hit.commentList = await readCommentsIn(where);
          return hit;
        }
        if (frames.some((f) => /nid\.naver\.com/.test(f.href || ""))) return { found: false, login: true };
        await sleep(1500);
      }
      return { found: false };
    }, { mode }).catch(() => ({ found: false }));
  const res = await tryIn("frame");
  if (!res.found && !res.login && $("#tabFallback").checked) return tryIn("tab");
  return res;
}

// 게시글 화면의 댓글·답글을 모두 읽는다 (댓글 페이지는 사람처럼 천천히 넘김 · 삭제 댓글 제외)
// 각 틀 안에서 실행되므로 확장 바깥 함수는 쓸 수 없음 (댓글 수집기 chrome-extension/app.js 의 scrapeCommentsInFrame 과 같은 방식)
async function readCommentsInFrame(pageDelay) {
  if (!document.querySelector("li.CommentItem, .CommentBox")) return { found: false, href: location.href };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const randomWait = () => wait(pageDelay[0] + Math.floor(Math.random() * (pageDelay[1] - pageDelay[0])));
  const all = [];
  const seen = new Set();
  const visited = new Set();
  for (let guard = 0; guard < 300; guard++) {
    for (const li of document.querySelectorAll("li.CommentItem")) {
      const q = (sel) => li.querySelector(sel)?.innerText.trim() || "";
      const row = {
        id: li.id || "",
        isReply: li.classList.contains("CommentItem--reply"),
        nickname: q(".comment_nickname"),
        content: q(".text_comment"),
        dateText: q(".comment_info_date"),
        deleted: !!li.querySelector(".comment_deleted, .comment_delete"),
      };
      const key = row.id || `${row.nickname}|${row.dateText}|${row.content}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(row);
      }
    }
    const current = document.querySelector(".CommentBox .ArticlePaginate button[aria-pressed='true']");
    if (current) visited.add(current.innerText.trim());
    let next = null;
    for (const btn of document.querySelectorAll(".CommentBox .ArticlePaginate button")) {
      const label = btn.innerText.trim();
      if (/^\d+$/.test(label) && !visited.has(label)) {
        next = btn;
        visited.add(label);
        break;
      }
    }
    if (!next) break;
    next.click();
    await randomWait();
  }
  return { found: true, rows: all.filter((r) => !r.deleted && r.content) };
}

// → [{ id, isReply, nickname, content, date(ms|null), dateText }] (댓글 영역이 없으면 [])
async function readCommentsIn(where) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answers = await runInFrames(where, readCommentsInFrame, [CAFE_PAGE_DELAY]);
    const hit = answers.find((r) => r.found);
    if (hit) {
      return hit.rows.map((r) => {
        const d = parseCafeDate(r.dateText);
        return { id: r.id, isReply: r.isReply, nickname: r.nickname, content: r.content.slice(0, 2000), dateText: r.dateText, date: d ? d.date.getTime() : null };
      });
    }
    await sleep(1000);
  }
  return [];
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
  if (!list.length) return setSummary("설정에 동호회와 검색어가 있는지 확인해 주세요.", "err");
  if (resume?.start) $("#startDate").value = resume.start;
  if (resume?.end) $("#endDate").value = resume.end;
  const p = period();
  if (p.start >= p.end) return setSummary("시작일이 끝 날짜보다 늦습니다. 기간을 다시 정해 주세요.", "err");
  await saveSettings();
  await checkLogin();
  startBusy();
  diagnostics = [];
  $("#diag").hidden = true;
  $("#log").innerHTML = "";
  const maxPages = Math.max(1, Number($("#maxPages").value) || DEFAULT_MAX_PAGES);
  const t0 = Date.now();
  let pagesDone = 0;
  let found = 0;
  let loginNeeded = false;
  const failed = [];
  const noClubId = new Set();
  const startAt = resume ? resume.next : 0;
  if (resume) log(`· 중단된 곳부터 이어서 찾습니다 (${startAt + 1}/${list.length}번째 동호회·검색어부터)`);
  log(`· 기간 ${periodText()}`);

  for (let ji = startAt; ji < list.length && !stopRequested; ji++) {
    const job = list[ji];
    const label = `${job.name} · '${job.q}'`;
    const remain = estimateRemaining(t0, ji - startAt, list.length - startAt, (list.length - ji) * 2 * SEC_PER_PAGE);
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
        if (day && day < p.start) {
          older++;
          continue;
        }
        if (day && day >= p.end) continue;
        const key = `${job.slug}/${x.articleId}`.toLowerCase();
        const have = items.find((it) => it.key === key);
        if (have) {
          if (!have.queries.includes(job.q)) have.queries.push(job.q);
          continue;
        }
        const item = {
          key, cafeIndex: job.cafeIndex, cafeName: job.name, slug: job.slug, articleId: x.articleId,
          title: x.title, text: x.text, date: parsed ? parsed.date.getTime() : null, hasTime: !!parsed?.hasTime, queries: [job.q],
          checked: false, touched: false, body: "", bodyRead: false, bodyNote: "", nickname: "", views: null, comments: null, summary: "", by: "",
        };
        const j = judge(`${item.title} ${item.text}`);
        item.related = j.related;
        item.candidate = j.candidate;
        item.note = judgeNote(j) + (!j.related && j.candidate ? " - 본문에서 확인" : "");
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
    if (!stopRequested) await saveResume("price", { jobs: list, next: ji + 1, start: $("#startDate").value, end: $("#endDate").value });
    if (ji + 1 < list.length && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }

  if (!stopRequested) await clearResume("price");
  $("#diag").hidden = !diagnostics.length;
  renderResults();
  const checked = items.filter((x) => x.checked).length;
  setSummary(
    `${stopRequested ? "중지됨 (다시 '게시물 찾기'를 누르면 이어서) - " : ""}새로 찾은 글 ${found}개 · 전체 ${items.length}개 중 가격 언급 글로 체크 ${checked}개 · ` +
      `${pagesDone}페이지, ${formatDuration((Date.now() - t0) / 1000)} 걸림` +
      (failed.length ? ` · 못 읽은 곳 ${failed.length}개(아래 기록 참고)` : "") +
      (loginNeeded ? " · 로그인이 필요합니다" : ""),
    loginNeeded || failed.length ? "err" : "ok",
  );
  addTime("search", t0);
  endBusy();
}

// 지금까지의 속도로 남은 시간 어림 → " · 남은 시간 약 12분"
function estimateRemaining(t0, done, total, fallbackSec) {
  const spent = (Date.now() - t0) / 1000;
  const sec = done > 0 ? (spent / done) * (total - done) : fallbackSec;
  return total - done > 0 ? ` · 남은 시간 약 ${formatDuration(sec)}` : "";
}

// ---------------------------------------------------------------------------
// 2. 본문 읽기 · 요약
// ---------------------------------------------------------------------------

const aiOn = () => $("#aiOn").checked && !!$("#aiKey").value.trim();
const readAllOn = () => !!$("#readAll")?.checked;

async function readBodies() {
  if (running) return;
  await saveSettings();
  // 본문 읽기: 체크한 글 (모두 읽기면 체크 안 된 글도). AI 를 쓰면 읽는 대로 18개씩 바로 판단·요약한다
  // (다 읽은 뒤 한꺼번에 하면 그동안 요약 칸이 비어 있고, 중간에 멈추면 요약이 하나도 안 남음)
  // 예상 가격 언급 글을 놓치지 않도록: 목록에 가격 단어가 안 보였어도 페리·비교 차종 단어가 있던 글(candidate)은 본문까지 확인
  const toCheck = (x) => x.checked || (!x.touched && (x.candidate || readAllOn()));
  // 이미 본문을 읽은 체크한 글도 댓글을 아직 안 읽었으면 댓글만 읽으러 다시 연다(본문 요약·AI 판단은 다시 하지 않음)
  const todo = sortedItems().filter((x) => toCheck(x) && (!x.bodyRead || (x.checked && !x.commentsRead)));
  const onlyComments = todo.filter((x) => x.bodyRead).length;
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
      !(await askConfirm(`본문·댓글을 읽을 글이 ${todo.length.toLocaleString()}개입니다 (예상 소요 시간 약 ${minutes}).\n` +
        (onlyComments ? `그중 ${onlyComments.toLocaleString()}개는 이미 요약한 글이라 댓글만 읽습니다(본문 요약 비용 없음).\n` : "") +
        (useAi ? `읽는 대로 Claude AI 가 판단·요약합니다 (예상 비용 ${fmtWon(aiCost)} · ${AI_MODELS.find(([id]) => id === model)[1].split(" (")[0]}).\n` : "") +
        "많은 글을 한 번에 열면 네이버 보호조치가 걸릴 수 있습니다. 중간에 '중지'로 멈춰도 그때까지 읽은 글의 요약은 남고, 나중에 이어서 읽을 수 있습니다.\n\n계속할까요?"))
    ) return;
    await checkLogin();
    startBusy();
    $("#log").hidden = false;
    const t0 = Date.now();
    const p = period();
    let ok = 0;
    for (let i = 0; i < todo.length && !stopRequested; i++) {
      const item = todo[i];
      showBusy(
        `본문 읽는 중 ${i + 1}/${todo.length} · ${item.cafeName}${estimateRemaining(t0, i, todo.length, (todo.length - i) * SEC_PER_ARTICLE)} — 끝날 때까지 이 탭을 닫지 마세요`,
        i, todo.length, "본문 읽는 중",
      );
      setSummary(`본문 읽는 중… (${i + 1}/${todo.length}) ${item.title}`);
      if (i) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
      const commentsOnly = item.bodyRead; // 이미 요약한 글: 댓글만
      const res = await readPost(articleUrl(item));
      if (res.found) {
        item.commentList = res.commentList || [];
        item.commentsRead = true;
        if (res.nickname) item.nickname = res.nickname;
        if (typeof res.views === "number") item.views = res.views;
        if (typeof res.comments === "number") item.comments = res.comments;
      }
      if (commentsOnly && !res.login) {
        if (!res.found) log(`· 댓글을 읽지 못함: ${item.title}`);
        renderRow(item);
        if (i % 5 === 4) await saveItems();
        continue;
      }
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
          if (res.nickname) item.nickname = res.nickname;
          if (res.views !== null && res.views !== undefined) item.views = res.views;
          if (res.comments !== null && res.comments !== undefined) item.comments = res.comments;
          const parsed = parseCafeDate(res.dateText);
          if (parsed) {
            item.date = parsed.date.getTime();
            item.hasTime = parsed.hasTime;
          }
          const j = judge(`${item.title}\n${item.body}`);
          item.related = j.related;
          item.note = judgeNote(j);
          // AI 를 쓰면 체크 여부는 AI 가 본문 내용을 보고 정한다. AI 를 안 쓰면 본문의 단어로 정한다.
          if (!aiOn() && !item.touched) item.checked = j.related;
          item.bodyNote = j.related ? "" : `본문 단어 확인: ${item.note}`;
          // 목록에 날짜만 보였던 글: 정확한 작성 시각으로 다시 보면 기간 밖일 수 있다
          if (!inPeriod(item, p) && !item.touched) {
            item.checked = false;
            item.bodyNote = "기간 밖 글";
          }
        }
      }
      if (item.bodyRead && !item.bodyNote.startsWith("기간 밖") && (item.checked || toCheck(item))) {
        if (useAi && item.body && (item.related || item.checked)) pending.push(item);
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
    const nComments = todo.reduce((n, x) => n + (x.commentList?.length || 0), 0);
    log(`· 본문 ${ok}개 · 댓글 ${nComments.toLocaleString()}개를 읽었습니다 (${formatDuration((Date.now() - t0) / 1000)} 걸림${spent})`);
    addTime("read", t0);
    endBusy();
    renderResults();
    if (aiFatal) {
      setSummary(`AI 요약을 하지 못했습니다: ${aiErrorMessage(aiFatal)} · 본문은 읽어 두었으니 키를 확인하고 '요약만 다시 쓰기'를 누르세요.`, "err");
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
  // 이미 읽었는데 아직 요약이 없는 글
  const left = sortedItems().filter((x) => x.checked && (!x.summary || x.by !== ($("#aiOn").checked ? "ai" : "rule")));
  if (left.length || !todo.length) await writeSummaries(false);
  stopRequested = false;
  await analyzeComments();
}

// 요약 쓰기 (force: 이미 쓴 글도 다시)
async function writeSummaries(force) {
  const targets = sortedItems().filter((x) => x.checked && (force || !x.summary || x.by !== ($("#aiOn").checked ? "ai" : "rule")));
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
    if (!(await askConfirm(`글 ${targets.length}개의 내용 요약을 Claude AI 로 씁니다.\n\n예상 비용 (대략):\n${est}\n\n지금 고른 모델: ${AI_MODELS.find(([id]) => id === model)[1]}\n예상 소요 시간 약 ${formatDuration(Math.ceil(targets.length / AI_BATCH / AI_PARALLEL) * 25)}\n\n계속할까요?`))) return;
    await aiWrite(targets, key, model);
  } else {
    for (const x of targets) writeByRule(x);
    renderResults();
    setSummary(`✔ 글 ${targets.length}개의 내용 요약을 규칙으로 썼습니다. 'Claude AI' 를 켜면 가격 이야기를 중심으로 더 자연스럽게 쓸 수 있습니다.`, "ok");
  }
  await saveItems();
}

// 규칙으로 요약: 본문에서 가격 단어가 있는 문장(페리 단어도 있으면 앞) 1~2개
function ruleSummary(item) {
  const src = item.body || item.text || "";
  const flW = wordList($("#flWords").value);
  const priceW = wordList($("#priceWords").value);
  const sentences = src
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  const scored = sentences.map((s, i) => {
    const c = compactText(s);
    return { s, i, score: (priceW.some((w) => hasWord(c, w)) ? 2 : 0) + (flW.some((w) => hasWord(c, w)) ? 1 : 0) };
  });
  const pick = scored.filter((x) => x.score >= 2).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  let out = pick.map((x) => x.s).join(" ");
  if (!out) out = item.title;
  return out.length > 150 ? `${out.slice(0, 148)}…` : out;
}

function writeByRule(item) {
  item.summary = ruleSummary(item);
  item.by = "rule";
}

// ---------------------------------------------------------------------------
// Claude AI 로 판단·요약 (공식 Anthropic SDK, 전역 Anthropic)
// ---------------------------------------------------------------------------

const AI_SYSTEM = `당신은 현대자동차 상품·가격 부문의 온라인 여론 모니터링 보고서를 쓰는 분석가입니다.
보고서의 핵심: 출시 예정인 싼타페 페이스리프트(MX5 F/L · 부분변경 · '페리' · 신형 싼타페)의 "예상 가격"에 대한 여론.
특히 아래 기준 사건(다른 차종의 가격 공개) 전후로 싼타페 F/L 예상 가격 여론이 어떻게 바뀌는지를 보려고 합니다.
{{events}}
당신이 쓴 결과는 그대로 사내 보고 엑셀에 들어가므로, 정확성과 일관성이 가장 중요합니다.

[입력] 글마다 id, 동호회, 작성일, 구간(기준 사건 전후), 제목, 본문(없으면 목록의 미리보기)을 받습니다.

[출력] 받은 글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다.

1. relevant (true/false): 싼타페 F/L 의 (예상) 가격 이야기·언급이 제목이나 본문에 있는지.
   - true: F/L 예상·유출·확정 가격, 트림·옵션·파워트레인별 가격, 현행 대비 인상·인하 폭, 그 가격에 대한 반응(비싸다·적당하다·가성비),
     가격 때문에 F/L 을 기다릴지 현행을 살지·다른 차로 갈지 고민하는 내용, 아반떼·투싼 등 다른 차 가격 공개를 보고
     싼타페 F/L 가격을 예상·걱정·기대하는 내용. 한 문장이라도 있으면 true.
   - false (현행 차량 가격은 넣지 않음): 현행(F/L 이전) 싼타페의 가격·견적·할인·프로모션·중고 시세만 이야기하는 글,
     현행 투싼·아반떼 등 다른 차종의 가격만 이야기하는 글(새로 공개된 아반떼·투싼 가격이라도 싼타페 F/L 가격 예상과 이어지지 않으면 false),
     용품·튜닝·정비·보험 비용, 판매·구매 글, 가격 언급 없이 F/L 디자인·사양·출시 일정만 이야기하는 글.
     단, 현행 가격을 말하면서 F/L 예상 가격·인상 폭도 함께 말하면 true (예: "현행 4천인데 페리는 300 오른다던데").
   - 싼타페 F/L 예상 가격 언급이 있는 글은 빠짐없이 모으는 것이 목적이므로, 판단이 애매하면 true 로 두고 summary 에 그 사정을 드러냅니다(사람이 최종 검토함).
2. tone (예상 가격 여론): 글쓴이가 싼타페 F/L (예상) 가격을 어떻게 보는지.
   "부정": 비싸다·인상이 과하다·부담된다·거품·구매를 포기하거나 미루겠다
   "긍정": 적당하다·합리적이다·가성비가 좋다·생각보다 덜 올랐다·이 가격이면 사겠다
   "중립": 가격 정보 공유·예상·문의만 있고 좋다/나쁘다 평가가 없음, 또는 평가가 엇갈림
3. expect (예상 가격·인상 폭 언급): 글에 나온 싼타페 F/L 예상 가격·인상 폭을 글에 쓰인 수치 그대로 짧게(40자 이내). 현행 차량 가격은 쓰지 않습니다.
   예) "기본 트림 3,900만 원대 예상", "현행 대비 300만 원 인상 예상", "투싼처럼 300만 원 오를 듯". 수치가 없으면 "".
4. raise (예상 인상 폭, 만 원 단위 정수): expect 에 현행 대비 인상 폭이 있으면 그 값(범위면 가운데 값, "200~300만" → 250).
   인하는 음수. 인상 폭이 글에 없으면 null. 글에 없는 값을 계산하거나 추측하지 않습니다.
5. compare (비교 차종): 글에서 싼타페 F/L 가격과 견주어 언급한 차종 중 [{{cars}}] 에 있는 것만 배열로. 없으면 [].
6. impact (구매 영향): "구매 의향"(이 가격이면 사겠다·계약 예정) / "대기·관망"(가격 보고 결정·기다림) /
   "타 차종 고려·이탈"(다른 차로 가겠다·포기) / "해당 없음".
7. point (여론 요지): 예상 가격에 대한 글쓴이의 핵심 의견을 한 구절(15~40자)로. 예) "투싼 인상 폭을 보니 F/L 도 300만 원 이상 오를까 우려"
8. summary (내용 요약): 한 문장, 50~150자. 사내 보고서 문체로 "~하는 내용" 처럼 "내용" 으로 끝냅니다.
   예상 가격 이야기를 중심으로 · 어떤 가격인지(예상·유출·확정, 트림·옵션) · 글에 나온 금액·인상 폭 · 글쓴이의 반응을 글에 있는 만큼만 담습니다.
   예) "투싼 가격 공개 후 기본 트림이 약 300만 원 오른 것을 보고 싼타페 F/L 도 비슷한 폭으로 오를 것이라며 부담을 나타내는 내용"
   예) "F/L 출시를 기다릴지 현행 모델 할인을 받아 계약할지 예상 가격 차이를 비교하며 다른 오너들의 의견을 묻는 내용"
   relevant=false 이면 글의 실제 주제를 같은 문체로 한 문장 요약하고 tone 은 "중립", 나머지는 비웁니다.

[반드시 지킬 것]
- 글에 없는 금액·사실(출시일·트림·사양·글쓴이 신원)을 지어내거나 추측해 단정하지 않습니다.
- 댓글 반응, 글쓴이 닉네임, 개인정보는 쓰지 않습니다. 욕설·과장은 중립적인 말로 바꿉니다.
- 모든 글을 같은 기준·같은 문체로 씁니다. 존댓말 어미나 마침표 없이 끝냅니다.`;

function eventLines() {
  const ev = events();
  return ev.length ? `[기준 사건]\n${ev.map((e) => `- ${ymd(e.day)} ${e.name}${e.note ? `: ${e.note}` : ""}`).join("\n")}` : "";
}

// 기준 사건·비교 차종과 담당자 추가 규칙(설정의 'AI 추가 규칙' 메모)을 붙인 지시문
function aiSystem() {
  const base = AI_SYSTEM.replace("{{events}}", eventLines()).replace("{{cars}}", compareCars().join(", "));
  const extra = String($("#aiRules")?.value || "").trim();
  return extra ? `${base}\n\n[담당자 추가 규칙 - 위 규칙보다 우선]\n${extra}` : base;
}

function aiSchema() {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            relevant: { type: "boolean" },
            tone: { type: "string", enum: TONES },
            expect: { type: "string" },
            raise: { anyOf: [{ type: "integer" }, { type: "null" }] },
            compare: { type: "array", items: { type: "string", enum: compareCars().length ? compareCars() : ["없음"] } },
            impact: { type: "string", enum: IMPACTS },
            point: { type: "string" },
            summary: { type: "string" },
          },
          required: ["id", "relevant", "tone", "expect", "raise", "compare", "impact", "point", "summary"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
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
  updateCounts(); // 💰 표시
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
  renderAiState();
  const box = $("#aiStatus");
  if (text === undefined) {
    const key = $("#aiKey").value.trim();
    text = !key
      ? "API 키가 없습니다. 키 없이도 쓸 수 있으며, 이때 내용 요약은 본문의 가격 문장으로 씁니다."
      : $("#aiOn").checked
        ? `✔ 저장된 키로 Claude AI 를 씁니다 (sk-ant-…${key.slice(-4)}).`
        : `저장된 키가 있지만 꺼져 있어 규칙으로 씁니다 (sk-ant-…${key.slice(-4)}).`;
    cls = key && $("#aiOn").checked ? "ok" : "";
  }
  box.textContent = text;
  box.className = `hint ${cls}`;
}

// 접혀 있어도 2번 칸 제목 옆에 AI 상태
function renderAiState() {
  const as = $("#aiState");
  const key = $("#aiKey").value.trim();
  const model = AI_MODELS.find(([id]) => id === $("#aiModel").value)?.[1].split(" (")[0] || "";
  as.textContent = !key ? "API 키 없음 - 규칙으로 요약" : $("#aiOn").checked ? `✔ 키 저장됨 · ${model} 사용` : "키 저장됨 · AI 꺼짐(규칙으로 요약)";
  as.className = `panel-state ${key && $("#aiOn").checked ? "ok" : "err"}`;
}

// 2번 칸 접기·펼치기: 사용자가 접거나 펼친 상태는 기억한다 (기억한 상태가 없으면 키가 없을 때만 펼침)
function setupPanel(id, needsAttention) {
  const el = $(`#${id}`);
  let saved = null;
  try {
    saved = localStorage.getItem(`pricePanel_${id}`);
  } catch {
    /* 무시 */
  }
  el.open = saved ? saved === "open" : needsAttention;
  el.addEventListener("toggle", () => {
    try {
      localStorage.setItem(`pricePanel_${id}`, el.open ? "open" : "closed");
    } catch {
      /* 무시 */
    }
  });
}

// 실제로 쓴 AI 비용: 요청마다 사용량으로 계산해 그 묶음의 글들에 똑같이 나눠 붙인다(x.aiCost, 원)
let aiSpendTimer = null;
function chargeAi(batch, msg, model) {
  const input = msg.usage?.input_tokens || 0;
  const output = msg.usage?.output_tokens || 0;
  const won = aiWonExact(input, output, model);
  for (const x of batch) x.aiCost = (x.aiCost || 0) + won / batch.length;
  aiSpend = { won: aiSpend.won + won, input: aiSpend.input + input, output: aiSpend.output + output };
  clearTimeout(aiSpendTimer);
  aiSpendTimer = setTimeout(() => chrome.storage.local.set({ priceAiSpend: aiSpend }).catch(() => {}), 300);
  return won;
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
function checkAiResult(r) {
  if (!r || typeof r.summary !== "string" || typeof r.relevant !== "boolean" || !TONES.includes(r.tone) || !IMPACTS.includes(r.impact)) return null;
  const one = (v, n) => String(v || "").replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim().slice(0, n);
  const summary = one(r.summary, 400);
  if (summary.length < 4) return null;
  const cars = compareCars();
  return {
    relevant: r.relevant, summary, tone: r.tone, impact: r.impact, expect: one(r.expect, 80), point: one(r.point, 100),
    raise: Number.isFinite(r.raise) && Math.abs(r.raise) < 5000 ? Math.round(r.raise) : null,
    compare: [...new Set((r.compare || []).filter((c) => cars.includes(c)))],
  };
}

async function aiBatch(client, model, batch, usage) {
  const input = batch.map((x) => ({
    id: x.key,
    동호회: x.cafeName,
    작성일: x.date ? formatDateTime(new Date(x.date), false) : "",
    구간: stageOf(x.date)?.name || "",
    제목: x.title,
    본문: (x.body || x.text || "").slice(0, AI_BODY_CHARS),
    본문여부: x.body ? "본문" : "목록 미리보기만 있음",
  }));
  const params = {
    model,
    max_tokens: 16000,
    system: aiSystem(),
    output_config: { effort: "medium", format: { type: "json_schema", schema: aiSchema() } },
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
  const results = batch.map((x) => checkAiResult(byId.get(x.key)));
  const bad = results.filter((r) => !r).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  batch.forEach((x, i) => {
    const r = results[i];
    Object.assign(x, { summary: r.summary, tone: r.tone, expect: r.expect, raise: r.raise, compare: r.compare, impact: r.impact, point: r.point });
    x.aiRelevant = results[i].relevant;
    x.by = "ai";
    // AI 가 본문을 보고 정한 대로 체크 (직접 체크·해제한 글은 그대로)
    if (!x.touched) x.checked = results[i].relevant;
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
  addTime("ai", t0);
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
// 댓글 분석: 수집한(체크한) 게시글의 댓글마다 가격 관련 여부 · 구체적 금액 언급 · 인상액 언급 ·
// 여론(긍정·중립·부정·단순비난) · 요지. AI 를 쓰면 AI, 아니면 아래 단어 규칙(어림)
// ---------------------------------------------------------------------------

const C_TONES = ["긍정", "중립", "부정", "단순비난"];
const BLAME_WORDS = ["현기", "흉기", "호구", "양아치", "도둑", "날강도", "강도", "창렬", "사기꾼", "등신", "개같", "노답", "꺼져", "ㅉㅉ", "쯧쯧", "답없", "미친놈", "현대가 그렇지", "그럼 그렇지"];
const COMMENT_BATCH = 40;
const COMMENT_VERSION = 1; // 댓글 판단 기준 버전 (바뀌면 다시 판단)

// 체크한 글의 댓글 → [{ x: 게시글, c: 댓글 }]
function allComments(list = sortedItems().filter((x) => x.checked)) {
  return list.flatMap((x) => (x.commentList || []).map((c) => ({ x, c })));
}

// 금액(차값 수준: 1천만 원 이상) 표현: "4,500만 원대" · "4천만" · "5천 중반" · "1.2억"
const AMOUNT_RE = /(\d{1,2},\d{3}|\d{4})\s*만\s*원?\s*(?:대|초반|중반|후반)?|\d\s*천\s*(?:\d{1,3}\s*)?(?:만\s*원?)?\s*(?:대|초반|중반|후반)?|\d(?:\.\d)?\s*억/g;
const RAISE_RE = /(\d{2,4})(?:\s*[~\-]\s*(\d{2,4}))?\s*(?:만\s*원?|만)?\s*(?:정도|가량|쯤|이상|넘게)?\s*(?:은|는|이|가|씩)?\s*(인상|오르|오를|올라|올랐|오른|올린|올려|비싸|인하|내려|싸지)[가-힣]*/; // 인상액 언급은 단어 끝까지("300 오르면")

function ruleComment(c) {
  const text = String(c.content || "");
  const t = compactText(text);
  const r = text.match(RAISE_RE);
  let raise = null;
  if (r) {
    const v = Math.round((Number(r[1]) + Number(r[2] || r[1])) / 2);
    if (v > 0 && v <= 3000) raise = /인하|내려|싸지/.test(r[3]) ? -v : v;
  }
  const amounts = [...text.matchAll(AMOUNT_RE)].map((m) => m[0].trim()).filter((a) => !r || !r[0].includes(a));
  const priceW = wordList($("#priceWords").value).some((w) => hasWord(t, w));
  const flW = wordList($("#flWords").value).some((w) => hasWord(t, w));
  const count = (list) => list.filter((w) => t.includes(compactText(w))).length;
  const blame = count(BLAME_WORDS);
  // 가격 글에 달린 비난·조롱도 가격에 대한 반응이라 가격 관련으로 센다
  const relevant = priceW || amounts.length > 0 || raise !== null || flW || blame > 0;
  const neg = count(NEG_WORDS);
  const pos = count(POS_WORDS);
  // 단순비난: 금액·인상액 같은 근거 없이 비난·조롱만
  const tone = blame && !amounts.length && raise === null ? "단순비난" : neg > pos || blame ? "부정" : pos > neg ? "긍정" : "중립";
  return {
    relevant, tone: relevant ? tone : blame ? "단순비난" : "중립", amount: amounts.join(", ").slice(0, 60),
    raiseText: r && raise !== null ? r[0].trim().slice(0, 40) : "", raise, point: "", by: "rule", v: COMMENT_VERSION,
  };
}

// 표·엑셀에 쓰는 댓글 판단 (AI 결과가 있으면 그것, 없으면 규칙)
function commentOpinion(c) {
  return c.a?.by === "ai" ? c.a : ruleComment(c);
}

const COMMENT_SYSTEM = `당신은 현대자동차 상품·가격 부문의 온라인 여론 모니터링 보고서를 쓰는 분석가입니다.
보고서의 핵심: 출시 예정인 싼타페 페이스리프트(MX5 F/L)의 "예상 가격"에 대한 여론. 다른 차종(아반떼·투싼) 가격 공개 전후의 변화를 봅니다.
{{events}}

[입력] 싼타페 F/L 예상 가격 이야기가 있는 동호회 게시글에 달린 댓글들. 댓글마다 id, 게시글 제목, 게시글 요약(맥락), 댓글 작성일, 구분(댓글/답글), 댓글 내용.
[출력] 받은 댓글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다.
1. relevant: 댓글이 싼타페 F/L (예상) 가격·인상·가격 반응·가격 때문에 기다림/이탈 등을 이야기하면 true.
   가격 글에 대고 회사·가격 정책을 비난·조롱하는 댓글도 가격에 대한 반응이므로 true(tone 은 "단순비난").
   인사·축하·감사, 사양·디자인·출고 일정만, 현행 차량 가격·할인만 이야기하면 false.
2. tone (댓글 여론):
   "부정": 비싸다·인상이 과하다·부담된다·안 사겠다 등 가격에 대한 부정적 의견(이유나 내용이 있음)
   "긍정": 적당하다·합리적이다·이 가격이면 산다 등
   "중립": 가격 정보·예상·질문만, 평가가 없거나 엇갈림
   "단순비난": 가격에 대한 구체적 내용·근거 없이 회사·브랜드·구매자를 비난·조롱·욕설만 하는 댓글 (예: "현기차가 그렇지 뭐", "호구들만 사겠지", "ㅋㅋ 또 올리네 양아치")
   relevant=false 이면 "중립".
3. amount (구체적 금액 언급): 댓글에 나온 싼타페 F/L 가격 관련 구체적 금액을 쓰인 그대로(예: "4,500만 원대", "하이브리드 풀옵 5천 중반"). 없으면 "". 현행 차량 가격은 쓰지 않습니다.
4. raiseText (인상액 언급): 인상·인하 폭 언급을 쓰인 그대로(예: "300 오를 듯", "200~300만 원 인상"). 없으면 "".
5. raise (인상액, 만 원 정수): raiseText 의 값(범위면 가운데 값, 인하는 음수). 없으면 null. 지어내거나 계산하지 않습니다.
6. point (요지): 가격에 대한 핵심 의견 한 구절(10~30자). relevant=false 이면 "".
[반드시] 댓글에 없는 금액·사실을 만들지 않습니다. 닉네임·개인정보는 쓰지 않습니다. 욕설은 그대로 옮기지 않고 요지에서 중립적으로 바꿉니다.`;

function commentSchema() {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" }, relevant: { type: "boolean" }, tone: { type: "string", enum: C_TONES },
            amount: { type: "string" }, raiseText: { type: "string" }, raise: { anyOf: [{ type: "integer" }, { type: "null" }] }, point: { type: "string" },
          },
          required: ["id", "relevant", "tone", "amount", "raiseText", "raise", "point"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

async function aiCommentBatch(client, model, batch, usage) {
  const input = batch.map(({ x, c }, i) => ({
    id: String(i), 게시글제목: x.title, 게시글요약: x.summary || "", 댓글작성일: c.date ? formatDateTime(new Date(c.date)) : c.dateText || "",
    구분: c.isReply ? "답글" : "댓글", 댓글: c.content.slice(0, 600),
  }));
  const params = {
    model,
    max_tokens: 16000,
    system: COMMENT_SYSTEM.replace("{{events}}", eventLines()) + (String($("#aiRules")?.value || "").trim() ? `\n\n[담당자 추가 규칙 - 위 규칙보다 우선]\n${$("#aiRules").value.trim()}` : ""),
    output_config: { effort: "low", format: { type: "json_schema", schema: commentSchema() } },
    messages: [{ role: "user", content: `아래 댓글 ${batch.length}개를 판단해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
  };
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  // 비용은 그 댓글이 달린 게시글들에 나눠 붙인다 (데이터 DB 의 파일별 AI 비용에 들어감)
  chargeAi(batch.map(({ x }) => x), msg, model);
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 댓글 판단을 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  const one = (v, n) => String(v || "").replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim().slice(0, n);
  const bad = batch.filter((_, i) => { const r = byId.get(String(i)); return !r || typeof r.relevant !== "boolean" || !C_TONES.includes(r.tone); }).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  batch.forEach(({ c }, i) => {
    const r = byId.get(String(i));
    c.a = {
      relevant: r.relevant, tone: r.tone, amount: one(r.amount, 60), raiseText: one(r.raiseText, 40),
      raise: Number.isFinite(r.raise) && Math.abs(r.raise) < 5000 ? Math.round(r.raise) : null, point: one(r.point, 60), by: "ai", v: COMMENT_VERSION,
    };
  });
}

// 체크한 글의 댓글 중 아직 판단하지 않은 것을 판단 (AI 를 켰으면 AI, 아니면 규칙)
async function analyzeComments({ force = false } = {}) {
  const useAi = aiOn();
  const todo = allComments().filter(({ c }) => force || !c.a || c.a.v !== COMMENT_VERSION || (useAi && c.a.by !== "ai"));
  if (!todo.length) return renderStages();
  if (!useAi) {
    for (const { c } of todo) c.a = ruleComment(c);
    await saveItems();
    renderResults();
    log(`· 댓글 ${todo.length.toLocaleString()}개를 규칙으로 판단했습니다 (AI 를 켜면 더 정확하게 판단)`);
    return;
  }
  const model = $("#aiModel").value;
  const chars = todo.reduce((n, { x, c }) => n + Math.min(600, c.content.length) + (x.summary || "").length + x.title.length + 60, 0);
  const batches = [];
  for (let i = 0; i < todo.length; i += COMMENT_BATCH) batches.push(todo.slice(i, i + COMMENT_BATCH));
  const est = aiCostWon(chars * 1.1 + 1200 * batches.length, todo.length * 45, model);
  if (!(await askConfirm(`수집한 글의 댓글 ${todo.length.toLocaleString()}개를 Claude AI 로 판단합니다 (가격 관련 여부 · 금액 언급 · 인상액 언급 · 긍정/중립/부정/단순비난).\n예상 비용 ${fmtWon(est)} · 약 ${formatDuration(Math.ceil(batches.length / AI_PARALLEL) * 25)}\n\n· [확인]: AI 로 판단\n· [취소]: 규칙(단어)으로 어림`))) {
    for (const { c } of todo) if (!c.a) c.a = ruleComment(c);
    await saveItems();
    renderResults();
    return;
  }
  const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
  const usage = { input: 0, output: 0 };
  const t0 = Date.now();
  let done = 0;
  let failed = 0;
  let fatal = null;
  let next = 0;
  startBusy();
  const progress = () => showBusy(`댓글 AI 판단 중 ${done}/${batches.length}묶음${estimateRemaining(t0, done, batches.length, (batches.length - done) * 25)}`, done, batches.length, "댓글 판단 중");
  progress();
  const worker = async () => {
    while (next < batches.length && !fatal && !stopRequested) {
      const batch = batches[next++];
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok && !fatal; attempt++) {
        try {
          await aiCommentBatch(client, model, batch, usage);
          ok = true;
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
        }
      }
      if (!ok) {
        failed += batch.length;
        for (const { c } of batch) c.a = ruleComment(c);
      }
      done++;
      progress();
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  addTime("ai", t0);
  endBusy();
  await saveItems();
  renderResults();
  const line = fatal
    ? `댓글 AI 판단을 하지 못했습니다: ${aiErrorMessage(fatal)} (규칙으로 대신 판단)`
    : `✔ 댓글 ${todo.length.toLocaleString()}개를 AI 로 판단했습니다 · ${formatDuration((Date.now() - t0) / 1000)} · 비용 ${fmtWon(aiWonExact(usage.input, usage.output, model))}` +
      (failed ? ` · ${failed}개는 실패해 규칙으로 판단` : "");
  log(`· ${line}`);
  // 본문 읽기 결과 문구 뒤에 이어 붙인다 (덮어쓰면 본문 결과가 안 보임)
  const before = $("#summary").textContent.trim();
  setSummary(before ? `${before} / ${line}` : line, fatal || failed || /err/.test($("#summary").className) ? "err" : "ok");
  stopRequested = false;
}

// ---------------------------------------------------------------------------
// 여론 변화: 구간(기준 사건 전후)별 · 주별로 체크한 글을 모아 본다
// ---------------------------------------------------------------------------

const DAY = 86400000;
const pct = (a, b) => (b ? a / b : 0);
const avg = (list) => (list.length ? list.reduce((n, v) => n + v, 0) / list.length : null);
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mmdd = (d) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 보고에 넣는 글: 체크한 글 중 기간 안의 글
function reportItems() {
  const p = period();
  return sortedItems().filter((x) => x.checked && inPeriod(x, p));
}

// 글 묶음 → 숫자 모음
// 체크한 글의 가격 관련 댓글 중 작성일이 [from, to) 안인 것 (작성일을 모르면 게시글 작성일)
function commentsIn(from, to) {
  return allComments(reportItems())
    .map(({ x, c }) => ({ x, c, a: commentOpinion(c), t: c.date ?? x.date }))
    .filter((v) => v.a.relevant && v.t && v.t >= from.getTime() && v.t < to.getTime());
}

function commentStats(list) {
  const ctone = Object.fromEntries(C_TONES.map((t) => [t, list.filter((v) => v.a.tone === t).length]));
  const raises = list.map((v) => v.a.raise).filter((v) => typeof v === "number");
  return {
    cn: list.length, ctone, cNegRatio: pct(ctone["부정"] + ctone["단순비난"], list.length),
    cAmountN: list.filter((v) => v.a.amount).length, cRaiseAvg: avg(raises), cList: list,
  };
}

function groupStats(list, days, from, to) {
  const ops = list.map((x) => ({ x, o: opinion(x) }));
  const tone = Object.fromEntries(TONES.map((t) => [t, ops.filter((v) => v.o.tone === t).length]));
  const raises = ops.map((v) => v.o.raise).filter((v) => typeof v === "number");
  const cars = Object.fromEntries(compareCars().map((c) => [c, ops.filter((v) => v.o.compare.includes(c)).length]));
  const num = (k) => list.map((x) => x[k]).filter((v) => typeof v === "number");
  return {
    n: list.length, days, perDay: days ? list.length / days : 0, tone,
    posRatio: pct(tone["긍정"], list.length), negRatio: pct(tone["부정"], list.length),
    expectN: ops.filter((v) => v.o.expect || typeof v.o.raise === "number").length,
    raiseAvg: avg(raises), raiseMed: median(raises), cars,
    wait: ops.filter((v) => v.o.impact === "대기·관망").length, leave: ops.filter((v) => v.o.impact === "타 차종 고려·이탈").length,
    views: avg(num("views")), comments: avg(num("comments")), ops,
    ...commentStats(from && to ? commentsIn(from, to) : []),
  };
}

// 구간별: 기간과 겹치는 구간만 → [{ stage, from, to(그날 빠짐), ...groupStats }]
function stageStats() {
  const p = period();
  const today = new Date();
  const lastEnd = Math.min(p.end, new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const list = reportItems();
  const st = stages();
  const out = [];
  for (const s of st) {
    const from = new Date(Math.max(p.start, s.from || -Infinity));
    const to = new Date(Math.min(lastEnd, s.to || Infinity));
    if (to <= from) continue;
    const mine = list.filter((x) => stageOf(x.date, st)?.i === s.i);
    out.push({ stage: s, from, to, ...groupStats(mine, Math.round((to - from) / DAY), from, to) });
  }
  return out;
}

// 주별 (월요일 시작)
function weekStats() {
  const p = period();
  const today = new Date();
  const lastEnd = new Date(Math.min(p.end, new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)));
  const list = reportItems();
  const st = stages();
  const ev = events();
  const out = [];
  let w = new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() - ((p.start.getDay() + 6) % 7));
  for (let guard = 0; w < lastEnd && guard < 400; guard++) {
    const next = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7);
    const from = new Date(Math.max(w, p.start));
    const to = new Date(Math.min(next, lastEnd));
    const mine = list.filter((x) => x.date && x.date >= from.getTime() && x.date < to.getTime());
    const evs = ev.filter((e) => e.day >= from && e.day < to);
    const last = new Date(to.getTime() - DAY);
    // 주 중간에 사건이 있으면 구간이 바뀌는 주: "② … → ③ …"
    const a = stageOf(from.getTime(), st);
    const b = stageOf(last.getTime(), st);
    out.push({
      label: `${ymd(from)} ~ ${mmdd(last)}`, stage: a, stageText: a && b && a.i !== b.i ? `${a.name.split(" ")[0]}→${b.name}` : a?.name || "",
      events: evs.map((e) => `${mmdd(e.day)} ${e.name}`),
      ...groupStats(mine, Math.round((to - from) / DAY), from, to),
    });
    w = next;
  }
  return out;
}

const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtMan = (v) => (typeof v === "number" ? `${Math.round(v).toLocaleString()}만 원` : "-");

// 숫자로 본 변화 (AI 없이도 늘 씀): 구간마다 한 줄 + 바로 앞 구간 대비 변화
function numberLines(stats = stageStats()) {
  const lines = [];
  stats.forEach((s, k) => {
    let line = `${s.stage.name} (${ymd(s.from)} ~ ${mmdd(new Date(s.to - DAY))}, ${s.days}일): 글 ${s.n}개(하루 ${s.perDay.toFixed(1)}개) · ` +
      `긍정 ${fmtPct(s.posRatio)} · 부정 ${fmtPct(s.negRatio)} · 예상 인상 폭 평균 ${fmtMan(s.raiseAvg)}(언급 ${s.expectN}개)` +
      ` · 가격 관련 댓글 ${s.cn}개(부정·비난 ${fmtPct(s.cNegRatio)} · 단순비난 ${s.ctone["단순비난"]}개)`;
    const prev = stats[k - 1];
    if (prev && prev.n && s.n) {
      const dp = Math.round((s.negRatio - prev.negRatio) * 100);
      line += ` → 직전 구간 대비 하루 글 수 ${prev.perDay.toFixed(1)}→${s.perDay.toFixed(1)}개, 부정 비율 ${dp >= 0 ? "+" : ""}${dp}%p`;
      if (typeof prev.raiseAvg === "number" && typeof s.raiseAvg === "number") line += `, 예상 인상 폭 ${fmtMan(prev.raiseAvg)}→${fmtMan(s.raiseAvg)}`;
      if (prev.cn && s.cn) {
        const dc = Math.round((s.cNegRatio - prev.cNegRatio) * 100);
        line += `, 댓글 부정·비난 비율 ${dc >= 0 ? "+" : ""}${dc}%p`;
      }
    }
    lines.push(`- ${line}`);
  });
  return lines;
}

// 구간 여론 요지: 지금 글로 쓴 AI 보고가 있으면 그것, 없으면 많이 본 글의 요지 3개
function stageNote(s, fresh = reportFresh()) {
  const ai = fresh && report?.stages?.[s.stage.name];
  if (ai) return ai;
  const top = [...s.ops].sort((a, b) => (b.x.views || 0) - (a.x.views || 0)).slice(0, 3);
  return top.length ? `많이 본 글: ${top.map((v) => v.o.point || v.x.summary || v.x.title).join(" / ")}` : "";
}

// ---------------------------------------------------------------------------
// 여론 변화 보고 (AI): 구간별 숫자와 글별 판단을 보고 예상 가격 여론이 어떻게 바뀌었는지 쓴다
// ---------------------------------------------------------------------------

let report = null; // { overall: [문장], stages: { 구간 이름: 요지 }, sig, at }

// 보고를 쓴 뒤 글·판단이 바뀌었는지 보는 표시
function reportSig() {
  return reportItems().map((x) => { const o = opinion(x); return `${x.key}:${o.tone}:${o.raise}:${(x.commentList || []).map((c) => commentOpinion(c).tone[0]).join("")}`; }).join("|") + `#${$("#events").value}`;
}

function reportFresh() {
  return !!report && report.sig === reportSig();
}

const REPORT_SYSTEM = `당신은 현대자동차 상품·가격 부문에 올리는 온라인 여론 보고서를 쓰는 분석가입니다.
보고서의 핵심: 출시 예정인 싼타페 페이스리프트(MX5 F/L)의 "예상 가격"에 대한 여론이 기준 사건(다른 차종의 가격 공개) 전후로 어떻게 바뀌었는지.
{{events}}

[입력] 구간별 숫자(글 수·하루 평균·긍정/부정 비율·예상 인상 폭 평균/중앙값·비교 차종 언급·구매 영향,
가격 관련 댓글 수·댓글 여론(긍정/중립/부정/단순비난)·댓글 금액·인상액 언급)와 댓글 요지 일부,
구간별 글 목록(작성일·예상 가격 여론·예상 가격 언급·예상 인상 폭·비교 차종·구매 영향·여론 요지·조회수)을 받습니다.

[출력]
- overall: 보고서 맨 위에 들어갈 핵심 요약 3~6개 항목. 각 항목은 한 문장의 개조식("~함", "~로 나타남" 처럼 끝냄).
  첫 항목은 기준 사건 전후 예상 가격 여론의 가장 큰 변화. 숫자는 입력에 있는 숫자만 인용(예: 부정 비율 40%→65%, 예상 인상 폭 평균 200만 원→300만 원).
  아반떼·투싼 가격 공개가 싼타페 F/L 예상 가격 인식에 어떤 영향을 주었는지(예: 투싼 인상 폭을 근거로 F/L 인상 예상 확산), 구매 영향(대기·이탈) 변화,
  게시글과 댓글 여론의 차이(예: 게시글은 중립 정보 공유가 많지만 댓글은 부정·단순비난이 많음)를 담습니다. 단순비난은 근거 있는 부정과 구분해 씁니다.
- stages: 구간마다 그 구간의 예상 가격 여론 요지를 2~3문장(150자 안팎)으로. 대표적인 주장·예상 수치·반응을 글 목록에 있는 만큼만.
[반드시] 입력에 없는 사실·숫자를 만들지 않습니다. 글이 적은 구간(5개 미만)은 "표본이 적어 해석에 유의" 를 붙입니다. 닉네임·개인정보는 쓰지 않습니다.`;

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "array", items: { type: "string" } },
    stages: {
      type: "array",
      items: { type: "object", properties: { stage: { type: "string" }, summary: { type: "string" } }, required: ["stage", "summary"], additionalProperties: false },
    },
  },
  required: ["overall", "stages"],
  additionalProperties: false,
};

async function writeReport() {
  if (running) return;
  const stats = stageStats();
  if (!stats.some((s) => s.n)) return setSummary("보고를 쓸 글이 없습니다 (기간 안의 체크한 글이 없음).", "err");
  if (!aiOn()) return setSummary("여론 변화 보고는 Claude AI 가 씁니다. 2번 'Claude AI 설정'에 API 키를 넣고 켜 주세요. (숫자로 본 변화는 AI 없이도 엑셀에 들어갑니다)", "err");
  const model = $("#aiModel").value;
  const input = {
    구간: stats.map((s) => ({
      구간: s.stage.name, 기간: `${ymd(s.from)} ~ ${ymd(new Date(s.to - DAY))}`, 일수: s.days, 글수: s.n, 하루평균: Number(s.perDay.toFixed(2)),
      긍정: s.tone["긍정"], 중립: s.tone["중립"], 부정: s.tone["부정"], 부정비율: fmtPct(s.negRatio), 긍정비율: fmtPct(s.posRatio),
      예상가격언급글: s.expectN, 예상인상폭평균만원: s.raiseAvg === null ? null : Math.round(s.raiseAvg), 예상인상폭중앙값만원: s.raiseMed,
      비교차종언급: s.cars, 대기관망: s.wait, 타차종이탈: s.leave,
      가격관련댓글: s.cn, 댓글여론: s.ctone, 댓글부정비난비율: fmtPct(s.cNegRatio), 댓글금액언급: s.cAmountN,
      댓글인상액평균만원: s.cRaiseAvg === null ? null : Math.round(s.cRaiseAvg),
      댓글요지: s.cList.filter((v) => v.a.point || v.a.amount || v.a.raiseText).slice(0, 60).map((v) => ({
        여론: v.a.tone, 금액: v.a.amount, 인상액: v.a.raiseText, 요지: v.a.point || v.c.content.slice(0, 80),
      })),
      글: [...s.ops].sort((a, b) => (b.x.views || 0) - (a.x.views || 0)).slice(0, 80).map(({ x, o }) => ({
        작성일: x.date ? ymd(new Date(x.date)) : "", 여론: o.tone, 예상: o.expect, 인상폭: o.raise, 비교: o.compare, 구매영향: o.impact,
        요지: o.point || x.summary || x.title, 조회수: x.views ?? null,
      })),
    })),
  };
  const text = JSON.stringify(input);
  const est = aiCostWon(text.length * 1.1 + 2000, 1500, model);
  if (!(await askConfirm(`체크한 글 ${reportItems().length.toLocaleString()}개로 '예상 가격 여론 변화' 보고 요지를 Claude AI 로 씁니다.\n예상 비용 ${fmtWon(est)} · 1분 안팎\n\n계속할까요?`))) return;
  startBusy();
  showBusy("여론 변화 보고 쓰는 중…", 0, 0, "보고 쓰는 중");
  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
    const params = {
      model,
      max_tokens: 16000,
      system: REPORT_SYSTEM.replace("{{events}}", eventLines()),
      output_config: { effort: "high", format: { type: "json_schema", schema: REPORT_SCHEMA } },
      messages: [{ role: "user", content: `아래 자료로 싼타페 F/L 예상 가격 여론 변화 보고를 써 주세요.\n\n${text}` }],
    };
    const stream = model === "claude-haiku-5-5"
      ? client.messages.stream(params)
      : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude 가 보고 작성을 거절했습니다");
    if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
    const parsed = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const clean = (t) => String(t || "").replace(/\s+/g, " ").replace(/^[-·•]\s*/, "").trim();
    report = {
      overall: (parsed.overall || []).map(clean).filter(Boolean),
      stages: Object.fromEntries((parsed.stages || []).map((s) => [String(s.stage).trim(), clean(s.summary)])),
      sig: reportSig(), at: Date.now(),
    };
    await chrome.storage.local.set({ priceReport: report }).catch(() => {});
    const cost = chargeAi([], msg, model);
    report.cost = cost;
    await chrome.storage.local.set({ priceReport: report }).catch(() => {});
    setSummary(`✔ 여론 변화 보고 요지를 썼습니다 · 비용 ${fmtWon(cost)} · 엑셀 '구간별 여론' 시트에 들어갑니다.`, "ok");
  } catch (e) {
    setSummary(`여론 변화 보고를 쓰지 못했습니다: ${aiErrorMessage(e)}`, "err");
  }
  addTime("report", t0);
  endBusy();
  renderStages();
}

// 화면의 '여론 변화' 표
function renderStages() {
  const box = $("#stageBox");
  if (!box) return;
  const stats = stageStats();
  const fresh = reportFresh();
  const tbody = $("#stageTable tbody");
  tbody.innerHTML = "";
  for (const s of stats) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="nowrap"></td><td class="nowrap"></td><td></td><td></td><td><div class="tonebar"><span class="pos"></span><span class="neu"></span><span class="neg"></span></div><div class="hint"></div></td><td></td><td></td><td><div class="tonebar"><span class="pos"></span><span class="neu"></span><span class="neg"></span><span class="blame"></span></div><div class="hint chint"></div></td><td class="sum"></td>`;
    tr.children[0].textContent = s.stage.name;
    tr.children[1].textContent = `${ymd(s.from)} ~ ${mmdd(new Date(s.to - DAY))} (${s.days}일)`;
    tr.children[2].textContent = `${s.n.toLocaleString()}개`;
    tr.children[3].textContent = s.perDay.toFixed(1);
    const [p, u, n] = TONES.map((t) => pct(s.tone[t], s.n) * 100);
    const bar = tr.querySelector(".tonebar");
    bar.children[0].style.width = `${p}%`;
    bar.children[1].style.width = `${u}%`;
    bar.children[2].style.width = `${n}%`;
    tr.querySelector("td .hint").replaceChildren(...toneText(`긍정 ${Math.round(p)}% · 중립 ${Math.round(u)}% · 부정 ${Math.round(n)}%`));
    tr.children[5].textContent = `${fmtMan(s.raiseAvg)} (${s.expectN}개)`;
    tr.children[6].replaceChildren(...compareCars().map((c) => Object.assign(document.createElement("div"), { textContent: `${c} ${s.cars[c]}` })));
    const cbar = tr.children[7].querySelector(".tonebar");
    C_TONES.forEach((t, k) => (cbar.children[k].style.width = `${pct(s.ctone[t], s.cn) * 100}%`));
    tr.children[7].querySelector(".chint").replaceChildren(
      `${s.cn}개 · `, ...toneText(`부정·비난 ${Math.round(s.cNegRatio * 100)}% · 단순비난 ${s.ctone["단순비난"]}개`),
    );
    tr.children[8].textContent = stageNote(s, fresh);
    tbody.appendChild(tr);
  }
  const text = [
    "숫자로 본 변화", ...numberLines(stats),
    ...(report?.overall?.length ? ["", `AI 보고 요지${fresh ? "" : " (보고를 쓴 뒤 글·판단이 바뀜 - 다시 쓰기 권장)"}`, ...report.overall.map((t) => `- ${t}`)] : []),
  ].join("\n");
  $("#reportText").replaceChildren(...toneText(text));
  $("#writeReport").disabled = running || !stats.some((s) => s.n);
  const st = stageState();
  const badge = $("#stageState");
  badge.className = `stage-state ${st.final ? "final" : "provisional"}`;
  badge.textContent = st.text;
}

// 지금 숫자가 확정치인지: 체크한 글 중 본문을 아직 안 읽은 글 · 본문에서 확인할 글이 남아 있으면 잠정치
function stageState() {
  const list = reportItems();
  const unread = list.filter((x) => !x.bodyRead || !x.commentsRead).length;
  const pending = items.filter((x) => !x.checked && !x.touched && x.candidate && !x.bodyRead && inPeriod(x)).length;
  if (!list.length && !pending) return { final: false, unread, pending, text: "아직 수집된 글이 없습니다" };
  if (!unread && !pending) return { final: true, unread, pending, text: `✔ 확정치 · 모든 글 본문·댓글 확인 완료${list.length && list.every((x) => x.by === "ai") ? " · AI 판단" : ""}` };
  return {
    final: false, unread, pending,
    text: `⚠ 잠정치 · 본문·댓글 확인 전 글 ${unread.toLocaleString()}개 포함` +
      (pending ? ` · 본문에서 확인할 글 ${pending.toLocaleString()}개 남음` : "") + " — '본문 읽고 요약하기' 후 확정됩니다",
  };
}

// "긍정 20%" · "부정 비율 +75%p" 처럼 여론 글자에 색(긍정 파랑 · 중립 녹색 · 부정 빨강)을 넣고 숫자는 굵게 → 노드 목록
function toneText(text) {
  const out = [];
  const re = /(긍정|중립|부정·비난|부정|단순비난)(\s*비율)?\s*([+-]?\d+(?:%p?|개))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const span = document.createElement("span");
    span.className = `t-${{ 긍정: "pos", 중립: "neu", 부정: "neg", "부정·비난": "neg", 단순비난: "blame" }[m[1]]}`;
    span.append(`${m[1]}${m[2] || ""} `, Object.assign(document.createElement("b"), { textContent: m[3] }));
    out.push(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

// ---------------------------------------------------------------------------
// 결과 표
// ---------------------------------------------------------------------------

// 작성일 → 동호회 순 (정렬 '동호회' 면 동호회 → 작성일)
function sortedItems() {
  const byDate = (a, b) => (a.date ?? Infinity) - (b.date ?? Infinity);
  return [...items].sort((a, b) =>
    $("#sortBy")?.value === "cafe" ? a.cafeIndex - b.cafeIndex || byDate(a, b) : byDate(a, b) || a.cafeIndex - b.cafeIndex,
  );
}

function visibleItems() {
  const cafe = $("#cafeFilter").value;
  const view = $("#viewFilter").value;
  return sortedItems().filter((x) => {
    if (cafe && x.slug.toLowerCase() !== cafe) return false;
    if (view === "checked") return x.checked;
    if (view === "unchecked") return !x.checked;
    if (view === "unread") return x.checked && !x.bodyRead;
    return true;
  });
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
    tr.innerHTML = `<td colspan="10" class="hint">… 화면에는 1,500개까지만 보입니다 (위 동호회·보기로 좁혀 보세요). 엑셀에는 체크한 글이 모두 들어갑니다.</td>`;
    tbody.appendChild(tr);
  }
  updateCounts();
}

function buildRow(item) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td><input type="checkbox"></td><td></td><td class="nowrap"></td><td><a target="_blank" rel="noopener"></a></td><td></td>` +
    `<td></td><td></td><td class="sum"></td><td class="note"></td><td><button class="small del">삭제</button></td>`;
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

const numText = (n) => (typeof n === "number" ? n.toLocaleString() : "");

function fillRow(tr, item) {
  tr.className = item.checked ? "" : "off";
  tr.querySelector("input").checked = item.checked;
  tr.children[1].textContent = item.cafeName;
  tr.children[2].textContent = item.date ? formatDateTime(new Date(item.date), item.hasTime) : "날짜 모름";
  const a = tr.querySelector("a");
  a.href = articleUrl(item);
  a.textContent = item.title;
  a.title = articleUrl(item);
  tr.children[4].textContent = item.nickname || "";
  tr.children[5].textContent = numText(item.views);
  tr.children[6].textContent = numText(item.comments);
  const o = item.checked && (item.summary || item.bodyRead) ? opinion(item) : null;
  const badge = document.createElement("div");
  badge.className = "opinion";
  if (o) {
    const tone = Object.assign(document.createElement("b"), { className: `tone tone-${o.tone}`, textContent: o.tone });
    const rest = [o.expect, o.compare.length ? `${o.compare.join("·")} 비교` : "", o.impact === "해당 없음" ? "" : o.impact].filter(Boolean).join(" · ");
    badge.append(tone, rest ? ` ${rest}` : "");
  }
  tr.children[7].replaceChildren(...(o ? [badge] : []), item.summary || "");
  const notes = [];
  if (item.bodyNote) notes.push(item.bodyNote);
  else if (item.note) notes.push(item.note);
  if (item.bodyRead && !item.bodyNote) notes.push("본문 읽음");
  if (item.by === "ai") notes.push(`AI 요약${item.aiRelevant === false ? " (MX5 F/L 가격 이야기가 없다고 판단 - 체크 해제)" : ""}`);
  else if (item.by) notes.push("규칙 요약");
  if (item.commentsRead) {
    const cs = (item.commentList || []).map(commentOpinion);
    const rel = cs.filter((a) => a.relevant);
    notes.push(`댓글 ${cs.length}개 읽음${cs.length ? ` (가격 관련 ${rel.length} · 부정 ${rel.filter((a) => a.tone === "부정").length} · 단순비난 ${cs.filter((a) => a.tone === "단순비난").length})` : ""}`);
  } else if (item.checked && item.bodyRead) notes.push("댓글 아직 안 읽음 ('본문 읽고 요약하기'를 누르면 읽음)");
  notes.push(`검색어: ${item.queries.join(", ")}`);
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
  const byCafe = cafes().map((c) => `${c.name} ${items.filter((x) => x.checked && x.slug.toLowerCase() === c.slug.toLowerCase()).length}`).join(" · ");
  $("#resultCount").textContent = items.length ? `전체 ${items.length}개 중 ${n}개 체크 (${byCafe}) · 본문 읽음 ${read}/${n}` : "";
  $("#saveExcel").disabled = !n || running;
  $("#readBodies").disabled = (!n && !items.length) || running;
  $("#rewrite").disabled = !n || running;
  $("#selDelete").disabled = !n || running;
  $("#selDelete").textContent = n ? `선택 삭제 (${n}개)` : "선택 삭제";
  // 💰 = AI 비용이 드는 버튼 (AI 를 켰을 때만)
  const coin = aiOn() ? "💰 " : "";
  $("#readBodies").textContent = coin + (n - read > 0 ? `본문 읽고 요약하기 (${n - read}개 · 약 ${formatDuration((n - read) * SEC_PER_ARTICLE)})` : "요약하기");
  for (const el of document.querySelectorAll(".cost-ico[data-when='ai']")) el.hidden = !aiOn();
  const unread = items.filter((x) => !x.bodyRead && !x.touched).length;
  $("#readAllInfo").textContent = `지금 읽을 글 ${unread.toLocaleString()}개 · 약 ${formatDuration(unread * SEC_PER_ARTICLE)}`;
  const vis = visibleItems();
  $("#checkAll").checked = !!vis.length && vis.every((x) => x.checked);
  $("#writeReport").textContent = `${aiOn() ? "💰 " : ""}여론 변화 보고 쓰기`;
  renderStagesSoon();
}

let stagesTimer = null;
function renderStagesSoon() {
  clearTimeout(stagesTimer);
  stagesTimer = setTimeout(renderStages, 150);
}

// 결과는 이 PC 크롬에 저장해 두어 화면을 다시 열어도 그대로
function saveItems() {
  return chrome.storage.local.set({ priceItems: items }).catch(() => {});
}

let saveTimer = null;
function saveItemsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveItems, 500);
}

// ---------------------------------------------------------------------------
// 엑셀 받기 (양식: B 순번 · C 동호회명 · D 작성일 · E 제목 · F 내용 요약 · G URL · H 작성자 닉네임 · I 조회수 · J 댓글수)
// ---------------------------------------------------------------------------

async function buildExcel(selected) {
  const resp = await fetch(chrome.runtime.getURL("price-template.xlsx"));
  const wb = await XlsxTemplate.Workbook.open(new Uint8Array(await resp.arrayBuffer()));
  const [postSheet, commentSheet, stageSheet, weekSheet] = wb.sheetNames();
  const st = stages();
  const nn = (v) => (typeof v === "number" && Number.isFinite(v) ? v : "");
  // ① 게시물
  const values = selected.map((x, i) => {
    const o = opinion(x);
    return [
      null, i + 1, x.cafeName, x.date ? excelSerial(new Date(x.date)) : "", x.title, x.summary || ruleSummary(x), articleUrl(x),
      x.nickname || "", nn(x.views), nn(x.comments),
      stageOf(x.date, st)?.name || "", o.tone, o.expect, nn(o.raise), o.compare.join(", "), o.impact === "해당 없음" ? "" : o.impact, o.point,
    ];
  });
  await wb.replaceRowsAfter(postSheet, HEADER_ROW, values, STYLE_ROW, { focusFirstNew: true });
  const links = {};
  values.forEach((v, i) => (links[`G${HEADER_ROW + 1 + i}`] = v[6]));
  await wb.addHyperlinks(postSheet, links);
  // 댓글 시트: 게시글 순서대로, 게시글 안에서는 작성순 · 구간은 댓글 작성일 기준
  const commentRows = [];
  selected.forEach((x, i) => {
    const list = [...(x.commentList || [])].sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
    for (const c of list) {
      const a = commentOpinion(c);
      const t = c.date ?? x.date;
      commentRows.push([
        null, commentRows.length + 1, x.cafeName, i + 1, x.title, articleUrl(x), stageOf(t, st)?.name || "",
        c.date ? excelSerial(new Date(c.date)) : c.dateText || "", c.nickname || "", c.isReply ? "답글" : "댓글", c.content,
        a.relevant ? "O" : "", a.tone, a.amount, a.raiseText, nn(a.raise), a.point,
      ]);
    }
  });
  await wb.replaceRowsAfter(commentSheet, HEADER_ROW, commentRows, STYLE_ROW);
  const clinks = {};
  commentRows.forEach((v, i) => (clinks[`F${HEADER_ROW + 1 + i}`] = v[5]));
  if (commentRows.length) await wb.addHyperlinks(commentSheet, clinks);
  // ② 구간별 여론 (기준 사건 전후) · 맨 위에 숫자로 본 변화 + AI 보고 요지
  const stats = stageStats();
  const fresh = reportFresh();
  const cars = compareCars();
  const carN = (s, name) => (cars.includes(name) ? s.cars[name] : "");
  const stageRows = stats.map((s) => [
    null, s.stage.name, `${ymd(s.from)} ~ ${ymd(new Date(s.to - DAY))}`, s.days, s.n, Math.round(s.perDay * 10) / 10,
    s.tone["긍정"], s.tone["중립"], s.tone["부정"], s.n ? s.posRatio : "", s.n ? s.negRatio : "",
    s.expectN, s.raiseAvg === null ? "" : Math.round(s.raiseAvg), s.raiseMed === null ? "" : Math.round(s.raiseMed),
    carN(s, "아반떼"), carN(s, "투싼"), s.wait, s.leave, s.views === null ? "" : Math.round(s.views), s.comments === null ? "" : Math.round(s.comments * 10) / 10,
    s.cn, ...C_TONES.map((t) => s.ctone[t]), s.cn ? s.cNegRatio : "", s.cAmountN, s.cRaiseAvg === null ? "" : Math.round(s.cRaiseAvg),
    stageNote(s, fresh),
  ]);
  await wb.replaceRowsAfter(stageSheet, STAGE_HEADER_ROW, stageRows, STAGE_HEADER_ROW + 1);
  const overall = [
    "[숫자로 본 변화]", ...numberLines(stats),
    ...(fresh && report?.overall?.length ? ["", "[보고 요지]", ...report.overall.map((t) => `- ${t}`)] : []),
  ].join("\n");
  const evText = events().map((e) => `${ymd(e.day)} ${e.name}`).join(" · ");
  const state = stageState();
  const cond = `${state.final ? "" : `[잠정치 · 본문·댓글 확인 전 글 ${state.unread}개 포함] `}기간 ${periodText()} · 기준 사건 ${evText || "없음"} · 동호회 ${cafes().map((c) => c.name).join(" · ")} · 글 ${selected.length.toLocaleString()}개 · 댓글 ${commentRows.length.toLocaleString()}개 · ${formatDateTime(new Date())} 받음`;
  await wb.setCellTexts(stageSheet, { B2: cond, B3: overall });
  // 3행(합친 칸)은 엑셀이 높이를 맞춰 주지 않아, 줄 수로 높이를 정한다 (한 줄 약 140자)
  const lines = overall.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 140)), 0);
  const path = wb._sheetPath(stageSheet);
  const xml = await wb.text(path);
  wb.texts.set(path, xml.replace(/<row r="3"([^>]*?)>/, (m, a) => `<row r="3"${a.replace(/\s(?:ht|customHeight)="[^"]*"/g, "")} ht="${Math.max(60, lines * 16 + 8)}" customHeight="1">`));
  // ③ 주별 추이
  const weekRows = weekStats().map((w) => [
    null, w.label, w.stageText, w.events.join(", "), w.n, w.tone["긍정"], w.tone["중립"], w.tone["부정"], w.n ? w.negRatio : "",
    w.raiseAvg === null ? "" : Math.round(w.raiseAvg), carN(w, "아반떼"), carN(w, "투싼"),
    w.views === null ? "" : Math.round(w.views), w.comments === null ? "" : Math.round(w.comments * 10) / 10,
    w.cn, w.cn ? w.cNegRatio : "", w.cRaiseAvg === null ? "" : Math.round(w.cRaiseAvg),
  ]);
  await wb.replaceRowsAfter(weekSheet, WEEK_HEADER_ROW, weekRows, WEEK_HEADER_ROW + 1);
  await wb.setCellTexts(weekSheet, { B2: cond });
  return wb.save();
}

// 받은 글 수 · 전 기록 대비 증감
async function showDiffs() {
  const box = $("#diffs");
  const lines = [];
  for (const [field, label] of [["posts", "엑셀에 넣은 글"], ["neg", "부정"], ["pos", "긍정"]]) {
    const d = await dbStatDiff("price", today(), field).catch(() => null);
    if (d) lines.push(diffLine(label, d));
  }
  box.hidden = !lines.length;
  box.replaceChildren(...lines);
}

function excelName() {
  const p = (id) => String($(`#${id}`).value || "").replace(/-/g, "");
  return `${today()}_${OUT_NAME}_${p("startDate")}-${p("endDate")}.xlsx`;
}

async function saveExcel() {
  if (running) return;
  const selected = sortedItems().filter((x) => x.checked);
  if (!selected.length) return;
  const unread = selected.filter((x) => !x.bodyRead).length;
  if (unread && !(await askConfirm(`본문을 아직 읽지 않은 글이 ${unread}개 있습니다. 이 글들은 작성자 닉네임·조회수·댓글수가 비고, 요약은 목록 미리보기로 씁니다.\n그대로 받을까요?\n(취소하면 받지 않습니다 - '본문 읽고 요약하기'를 먼저 눌러 주세요)`))) return;
  const out = selected.filter((x) => !inPeriod(x)).length;
  if (out && !(await askConfirm(`체크한 글 중 ${out}개는 지금 기간(${periodText()}) 밖의 글입니다. 함께 넣을까요?\n(취소하면 받지 않습니다 - '보기'로 확인하고 체크를 풀어 주세요)`))) return;
  if (aiOn() && !reportFresh() && (await askConfirm(`'구간별 여론' 시트의 보고 요지를 지금 글로 Claude AI 가 새로 쓸까요?\n· [확인]: 쓰고 받기 (💰)\n· [취소]: 숫자로 본 변화만 넣고 받기`))) {
    await writeReport();
  }
  $("#saveInfo").className = "hint";
  $("#saveInfo").textContent = "엑셀 만드는 중…";
  try {
    const bytes = await buildExcel(selected);
    const name = excelName();
    const where = await saveBytes(bytes, name);
    // 데이터 DB 에 오늘 파일로 보관 (같은 날 다시 받으면 바꿈) · 건수 · 여론 · AI 비용 · 소요 시간
    const ops = selected.map(opinion);
    const raises = ops.map((o) => o.raise).filter((v) => typeof v === "number");
    const cafesN = Object.fromEntries(cafes().map((c) => [c.name, selected.filter((x) => x.slug.toLowerCase() === c.slug.toLowerCase()).length]));
    const reportCost = reportFresh() ? report?.cost || 0 : 0;
    const stats = {
      posts: selected.length, cafes: cafesN,
      pos: ops.filter((o) => o.tone === "긍정").length, neu: ops.filter((o) => o.tone === "중립").length, neg: ops.filter((o) => o.tone === "부정").length,
      raiseAvg: raises.length ? Math.round(raises.reduce((a, b) => a + b, 0) / raises.length) : null,
      comments: allComments(selected).length,
      cRel: allComments(selected).filter(({ c }) => commentOpinion(c).relevant).length,
      cNeg: allComments(selected).filter(({ c }) => commentOpinion(c).tone === "부정").length,
      cBlame: allComments(selected).filter(({ c }) => commentOpinion(c).tone === "단순비난").length,
      period: periodText(), aiCost: Math.round(selected.reduce((n, x) => n + (x.aiCost || 0), 0) + reportCost), aiTotal: Math.round(aiSpend.won),
      time: { ...timeLog },
    };
    const summary = `글 ${stats.posts.toLocaleString()}개 · 긍정 ${stats.pos} · 중립 ${stats.neu} · 부정 ${stats.neg}`;
    let dbNote = "";
    try {
      await dbSaveDay("price", today(), name, bytes, "auto", summary, stats);
      dbNote = " · 데이터 DB에 오늘 파일로 저장했습니다";
      await showDiffs();
    } catch {
      dbNote = " · (데이터 DB 저장은 하지 못했습니다)";
    }
    $("#saveInfo").className = "hint ok";
    $("#saveInfo").textContent = `✔ ${where}에 ${name} - 글 ${selected.length.toLocaleString()}개${dbNote}`;
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
  setupPanel("panelAi", !$("#aiKey").value.trim());
  const saved = await chrome.storage.local.get(["priceItems", "priceReport"]).catch(() => ({}));
  items = saved.priceItems || [];
  report = saved.priceReport || null;
  const kept = await chrome.storage.local.get(["priceAiSpend", "priceTime"]).catch(() => ({}));
  aiSpend = kept.priceAiSpend || aiSpend;
  timeLog = { ...timeLog, ...(kept.priceTime || {}) };
  renderResults();
  if (items.length) setSummary(`지난번까지 찾은 글 ${items.length}개입니다. '게시물 찾기'를 다시 누르면 새로 찾은 글이 더해집니다.`);

  for (const id of [...SETTING_IDS, "tabFallback", "saveAsk"]) {
    $(`#${id}`).addEventListener("change", async () => {
      if (id === "searchUrl") $("#searchUrl").value = normalizeSearchUrl($("#searchUrl").value);
      await saveSettings();
      if (id === "cafeList") {
        renderCafeInfo();
        renderResults();
      }
      if (["queries", "maxPages", "events"].includes(id)) updateJobInfo();
      if (["events", "compareWords"].includes(id)) renderResults();
      if (["flWords", "priceWords", "compareWords", "santafeWords", "exclude"].includes(id)) {
        for (const x of items) {
          const j = judge(`${x.title} ${x.body || x.text}`);
          x.related = j.related;
          x.candidate = j.candidate;
          x.note = judgeNote(j);
          if (!x.touched && x.by !== "ai") x.checked = j.related;
        }
        renderResults();
        saveItemsSoon();
      }
    });
  }
  for (const id of ["startDate", "endDate"]) $(`#${id}`).addEventListener("change", () => (saveSettings(), updateJobInfo(), renderStages()));
  $("#fromEvent").addEventListener("click", () => {
    $("#endDate").value = ymd(new Date());
    $("#startDate").value = ymd(defaultStart());
    saveSettings();
    updateJobInfo();
    renderStages();
  });
  $("#writeReport").addEventListener("click", writeReport);
  for (const b of document.querySelectorAll("button.range")) {
    b.addEventListener("click", () => {
      $("#endDate").value = ymd(new Date());
      $("#startDate").value = ymd(daysAgo(Number(b.dataset.days)));
      saveSettings();
      updateJobInfo();
      renderStages();
    });
  }
  $("#aiKey").addEventListener("change", saveAiKey);
  $("#aiKey").addEventListener("keydown", (e) => e.key === "Enter" && saveAiKey());
  $("#aiSave").addEventListener("click", saveAiKey);
  $("#aiTest").addEventListener("click", testAiKey);
  for (const id of ["aiModel", "aiOn"]) $(`#${id}`).addEventListener("change", () => (saveSettings(), showAiStatus(), updateCounts()));
  $("#resetSettings").addEventListener("click", async () => {
    if (!(await askConfirm("동호회·검색어·관련 단어 설정을 처음 값으로 되돌릴까요?"))) return;
    for (const id of SETTING_IDS) $(`#${id}`).value = SETTING_DEFAULTS[id];
    await saveSettings();
    renderCafeInfo();
  });
  $("#search").addEventListener("click", async () => {
    const r = await loadResume("price");
    search(r && (await askConfirm(`중단된 게시물 찾기가 있습니다 (${r.jobs.length}개 중 ${r.next}개 완료 · 기간 ${r.start || "?"} ~ ${r.end || "?"}).\n\n· [확인]: 이어서 찾기\n· [취소]: 처음부터 다시 찾기`)) ? r : null);
  });
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 보는 화면까지 마칩니다)");
  });
  $("#cafeFilter").addEventListener("change", renderResults);
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
    report = null;
    // 새 작업의 소요 시간은 처음부터 (AI 누적 비용은 그대로 - 데이터 DB 에서 봄)
    timeLog = { search: 0, read: 0, ai: 0, report: 0 };
    await chrome.storage.local.set({ priceTime: timeLog }).catch(() => {});
    await chrome.storage.local.remove("priceReport").catch(() => {});
    await clearResume("price");
    renderResults();
    await saveItems();
  });
  $("#readBodies").addEventListener("click", readBodies);
  $("#readAll").addEventListener("change", updateCounts);
  $("#rewrite").addEventListener("click", () => !running && writeSummaries(true));
  // 저장 버튼을 누른 그때 폴더 쓰기 허용을 확인해 둔다 (허용 요청은 사용자 동작 안에서만 가능)
  $("#saveExcel").addEventListener("click", () => (prepareFolder(), saveExcel()));
  $("#pickFolder").addEventListener("click", pickSaveFolder);
  $("#clearFolder").addEventListener("click", clearSaveFolder);
  renderSaveFolder();
  $("#diag").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, at: new Date().toString(), diagnostics }, null, 1)], { type: "application/json" });
    prepareFolder();
    saveBytes(blob, `${today()}_MX5FL가격_진단.json`);
  });
  window.addEventListener("focus", checkLogin);
  checkLogin();
  // 중단된 찾기가 있으면 이어서 할지 묻는다
  const r = await loadResume("price");
  if (r && (await askConfirm(`중단된 게시물 찾기가 있습니다 (동호회·검색어 ${r.jobs.length}개 중 ${r.next}개 완료 · ${new Date(r.at).toLocaleString()}).\n\n· [확인]: 이어서 찾기\n· [취소]: 나중에 ('게시물 찾기'를 누르면 다시 물어봄)`))) search(r);
}

// 위쪽 '⚙ 설정' 버튼(price.html#settings): 설정을 펼치고 그 위치로
function openSettingsFromHash() {
  if (location.hash !== "#settings") return;
  $("#settings").open = true;
  $("#settings").scrollIntoView({ block: "start", behavior: "smooth" });
}
window.addEventListener("hashchange", openSettingsFromHash);

init().then(openSettingsFromHash);
