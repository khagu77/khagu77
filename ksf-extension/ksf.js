// 코리아 세일 페스타(K-세일 페스타) 차종별 동호회 반응 모니터링
// 대상 차종(아반떼 · 그랜저 · 싼타페) 동호회에서 기간 안의 코세페 관련 글을 찾아 본문·댓글을 읽고,
// 글·댓글마다 '어느 차종에 대한 반응인지'를 나눠 해당 차종 기준으로 코세페에 대한 긍정·중립·부정·단순비난을 판단한다.
//  - 일반적인 감정의 긍부정이 아니라 '코리아 세일 페스타(할인 행사)'에 대한 고객 반응의 긍부정
//  - 한 댓글이 여러 차종을 말하면 차종마다 따로 판단 (예: "아반떼는 많이 깎아 주는데 그랜저는 찔끔" → 아반떼 긍정 · 그랜저 부정)
//  - 차종 이름이 없으면 그 동호회(글)의 차종에 대한 반응
// 결과: 차종별 성향 비율 · 차종별 긍정/부정 주요 내용 TOP5(개수·비율) → 엑셀 · 보고서 PPT 3페이지
// 네이버는 API 를 부르지 않고 검색 화면·게시글을 보이지 않는 틀(필요하면 뒤쪽 탭)로 열어 화면에 보이는 내용만 읽는다(cafe-common.js).

const DEFAULT_CAFES = [
  "아반떼 | 아반떼 CN8 클럽 | 01088157554",
  "아반떼 | 아반떼 매니아 | blackboxclub",
  "아반떼 | 아반떼 클럽 | avantemd",
  "그랜저 | 그랜저 리더스 | suddenattackskincafe",
  "그랜저 | 그랜저 오너스 | allfm03",
  "그랜저 | 그랜저 멤버스 | bestcm",
  "그랜저 | 그랜저 매니아 | bestani",
  "그랜저 | 그랜저 패밀리 | mp3vilge",
  "싼타페 | 클럽 싼타페 | iroid",
  "싼타페 | 싼타페MX5클럽 | choids",
  "싼타페 | 싼타페MX5패밀리 | trailer",
].join("\n");
// 담당자가 확인한 카페 번호 (자동 확인보다 우선 - 잘못 저장된 번호를 바로잡는다)
const KNOWN_CLUB_IDS = { blackboxclub: "17638944" };
// 수집 키워드 (조합): 한 줄 = 검색어 하나 · 띄어 쓴 단어 = 모두 들어간 글 · A|B = A 또는 B · -단어 = 빼기
const DEFAULT_KEYWORDS = [
  "코리아세일페스타|코세페|K세일페스타|세일페스타",
  "코리아 세일 페스타",
  "K-세일 페스타",
  "할인|프로모션|특가|보상",
  "11월 할인|혜택|조건",
  "-보험",
].join("\n");
const DEFAULT_PURPOSE =
  "11/1(일)~11/8(일) '코리아 세일 페스타(K-세일 페스타)' 기간 현대차 할인 프로모션에 대해, 대상 차종(아반떼·그랜저·싼타페) 동호회 내 고객 반응을 차종별로 확인하고자 함.\n" +
  "일반적인 말투의 긍부정이 아니라 '코리아 세일 페스타'에 대한 반응 기준으로 긍정·부정을 분류하고, 기존 구매자 보상 요구·역차별 불만, 할인을 계기로 한 구매 검토 등 차종별로 많이 이야기된 주요 내용을 파악함.";
const DEFAULT_ISSUE = "코리아 세일 페스타";
// 코세페 단어: 있으면 '관련 글'로 체크
const DEFAULT_KSF_WORDS = "코리아세일페스타, 코리아 세일 페스타, 코세페, 세일페스타, 세일 페스타, K세일, K-세일, K 세일, 케이세일, KSF";
// 할인 단어: 코세페 단어가 없어도 기간 안의 할인 이야기는 코세페 반응일 수 있어 본문까지 읽어 확인 (AI 가 최종 판단)
const DEFAULT_SALE_WORDS = "할인, 프로모션, 특가, 세일, 보상, 할인폭, 할인율, 가격 인하, 재고 할인, 11월 혜택, 11월 조건";
// 차종 이름: 글·댓글에 이 이름이 있으면 해당 차종에 대한 반응으로 본다 (규칙 판단용 · AI 에게도 전달)
const DEFAULT_CAR_WORDS = [
  "아반떼 | 아반떼, 아방, 아반, CN8, CN7, avante",
  "그랜저 | 그랜저, 그렌저, 그랜져, 그랜, GN7, grandeur",
  "싼타페 | 싼타페, 산타페, 싼타, 싼페, MX5, santafe",
].join("\n");
const DEFAULT_EXCLUDE = "팝니다, 삽니다, 판매합니다, 공동구매, 보험 할인, 보험료, 썬팅, 틴팅, 블랙박스";
const DEFAULT_AI_RULES = "";
const DEFAULT_START = "2026-11-01T00:00";
const DEFAULT_END = "2026-11-08T23:59";
const DEFAULT_TITLE = "■ 코리아 세일 페스타 관련 차종별 동호회 여론 동향";
const DEFAULT_SEARCH_URL = "https://cafe.naver.com/f-e/cafes/{cafeId}/menus/0?viewType=L&ta=ARTICLE_COMMENT&page={page}&q={q}";
const DEFAULT_MAX_PAGES = 10;
const TONES = ["긍정", "중립", "부정", "단순비난"];
const OTHER_CAR = "기타 차종";
const OUT_NAME = "코리아 세일 페스타 차종별 동호회 반응";
const TOP_N = 5;
// 걸리는 시간 어림 (초): 검색 화면 한 페이지 · 글 하나
const SEC_PER_PAGE = 9;
const SEC_PER_ARTICLE = 14;

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본 · 권장)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴 · 정확도 낮음)"],
];
// AI_PRICE · WON_PER_USD · aiWonExact · fmtWon 은 ui.js
const AI_BATCH = 6; // 한 번에 보내는 글 수
const COMMENT_BATCH = 20; // 한 번에 보내는 댓글 수 (보고서 3p 의 바탕이라 작게 나눠 꼼꼼히)
const AI_PARALLEL = 3;
const AI_BODY_CHARS = 4000;
const JUDGE_VERSION = 1; // 판단 기준 버전 (바뀌면 다시 판단)

// items: 글 { key, car(동호회 차종), cafeIndex, cafeName, slug, articleId, title, text, date, hasTime, queries,
//              related, candidate, note, checked, touched, body, bodyRead, bodyNote, nickname, views, comments,
//              commentList: [{ id, isReply, parentText, nickname, content, dateText, date, a }], commentsRead,
//              summary, ksf(AI: 코세페 글인지), a: { ops: [{ car, tone, theme }], by, v } }
let items = [];
// 담당자가 지운 글(동호회/글번호) - 다시 찾기 때 또 넣지 않는다
let deletedKeys = new Set();
// 1.5.12 전에 지운 글은 기록이 없다 → 업데이트 뒤 첫 수집 한 번만, 지난 수집 날짜보다 이전에 쓰인 '새' 글은
// 이미 보고 지운 글로 보고 다시 넣지 않는다 (0 = 끝남)
let skipBefore = 0;
function forgetItems(list) {
  for (const x of list) deletedKeys.add(x.key);
  return chrome.storage.local.set({ ksfDeleted: [...deletedKeys] }).catch(() => {});
}
let clubIds = {}; // 영문 주소 → 카페 번호
let running = false;
let stopRequested = false;
let diagnostics = [];
let aiSpend = { won: 0, input: 0, output: 0 };
let report = null; // 보고서 초안 { title, channels, summary: [2], headline, short: {성향: [글]}, long: {성향: [글]}, at }
let tops = null; // 주요 내용 TOP5 묶음 { sig, by, cars: { 차종: { 긍정: [{ label, keys:[반응 키] }], 부정: [...] } }, at }

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const SETTING_IDS = ["purpose", "issueName", "keywords", "cafeList", "ksfWords", "saleWords", "carWords", "exclude", "aiRules", "searchUrl", "maxPages"];
const SETTING_DEFAULTS = {
  purpose: DEFAULT_PURPOSE, issueName: DEFAULT_ISSUE, keywords: DEFAULT_KEYWORDS, cafeList: DEFAULT_CAFES, ksfWords: DEFAULT_KSF_WORDS, saleWords: DEFAULT_SALE_WORDS, carWords: DEFAULT_CAR_WORDS,
  exclude: DEFAULT_EXCLUDE, aiRules: DEFAULT_AI_RULES, searchUrl: DEFAULT_SEARCH_URL, maxPages: DEFAULT_MAX_PAGES,
};

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["ksfSettings", "ksfStart", "ksfEnd", "ksfClubIds", "saveAsk", "ksfTabFallback", "aiKey", "aiModel", "ksfAiOn", "ksfOnlyP3", "ksfSound", "ksfOnlyNew"])
    .catch(() => ({}));
  const set = s.ksfSettings || {};
  for (const id of SETTING_IDS) $(`#${id}`).value = set[id] ?? SETTING_DEFAULTS[id];
  // 나중에 기본에 더한 동호회: 저장된 동호회 목록에 한 번만 넣어 준다 (담당자가 지우면 다시 넣지 않음)
  const added = (await chrome.storage.local.get("ksfCafesAdded").catch(() => ({}))).ksfCafesAdded || [];
  for (const line of ["아반떼 | 아반떼 클럽 | avantemd"]) {
    const slug = line.split("|").pop().trim();
    if (added.includes(slug)) continue;
    added.push(slug);
    const box = $("#cafeList");
    if (new RegExp(`\\b${slug}\\b`, "i").test(box.value)) continue;
    const lines = box.value.split("\n");
    const car = line.split("|")[0].trim();
    let at = -1;
    lines.forEach((l, i) => { if (l.split("|")[0].trim() === car) at = i; });
    lines.splice(at >= 0 ? at + 1 : lines.length, 0, line);
    box.value = lines.join("\n");
  }
  await chrome.storage.local.set({ ksfCafesAdded: added }).catch(() => {});
  // 1.5.14 에서 임시로 붙인 이름 → 실제 카페 이름
  $("#cafeList").value = $("#cafeList").value.replace(/\|\s*아반떼 MD 클럽\s*\|\s*avantemd/i, "| 아반떼 클럽 | avantemd");
  $("#saveAsk").checked = !!s.saveAsk;
  $("#tabFallback").checked = s.ksfTabFallback ?? true;
  // 1.0 의 'TOP5 슬라이드만 남기기'(기본 체크) 저장값은 쓰지 않는다 → 기본은 1~3페이지 모두
  $("#onlySlide").checked = !!s.ksfOnlyP3;
  $("#soundOn").checked = s.ksfSound ?? true;
  $("#onlyNew").checked = s.ksfOnlyNew ?? true;
  clubIds = { ...(s.ksfClubIds || {}) };
  for (const [id, slug] of Object.entries(await loadCafeSlugs())) if (!clubIds[slug.toLowerCase()]) clubIds[slug.toLowerCase()] = id;
  Object.assign(clubIds, KNOWN_CLUB_IDS);
  // 예전(날짜만) 값은 그날 0시 · 끝 날짜는 23:59 로
  const dt = (v, t) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? `${v}T${t}` : v);
  $("#startDate").value = dt(s.ksfStart, "00:00") || DEFAULT_START;
  $("#endDate").value = dt(s.ksfEnd, "23:59") || DEFAULT_END;
  const sel = $("#aiModel");
  sel.innerHTML = "";
  for (const [id, label] of AI_MODELS) sel.add(new Option(label, id));
  if (s.aiModel && AI_MODELS.some(([id]) => id === s.aiModel)) sel.value = s.aiModel;
  $("#aiKey").value = s.aiKey || "";
  $("#aiOn").checked = !!s.ksfAiOn;
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
      ksfSettings: set,
      ksfStart: $("#startDate").value,
      ksfEnd: $("#endDate").value,
      ksfTabFallback: $("#tabFallback").checked,
      ksfOnlyP3: $("#onlySlide").checked,
      ksfSound: $("#soundOn").checked,
      ksfOnlyNew: $("#onlyNew").checked,
      saveAsk: $("#saveAsk").checked,
      aiKey: $("#aiKey").value.trim(),
      aiModel: $("#aiModel").value,
      ksfAiOn: $("#aiOn").checked,
    })
    .catch(() => {});
}

function saveClubIds() {
  return chrome.storage.local.set({ ksfClubIds: clubIds }).catch(() => {});
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
    .map((w) => ({ w, ascii: /^[a-z0-9/-]+$/.test(w) }));
}

// 한글 단어는 띄어쓰기를 빼고 들어 있는지, 영문 낱말은 앞뒤가 영문자가 아닐 때만
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
    if (parts.length < 3) continue;
    const [car, name, addr] = parts;
    const slug = (parseArticleUrl(addr).cafeUrl || addr.replace(/^https?:\/\/(?:m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, "")).trim();
    // 카페 주소가 숫자로만 된 카페도 있다 (예: 아반떼 CN8 클럽 cafe.naver.com/01088157554 - 오전 온라인 동향 프로그램과 같은 주소)
    if (!car || !(isSlug(slug) || /^0\d{5,}$|^\d{10,}$/.test(slug))) continue;
    out.push({ car, name: name || slug, slug });
  }
  return out;
}

// 대상 차종 (동호회 목록 순서)
function targetCars() {
  return [...new Set(cafes().map((c) => c.car))];
}

// 차종 이름 → { 아반떼: [단어…] }
function carWords() {
  const out = {};
  for (const line of String($("#carWords").value || "").split(/\r?\n/)) {
    const [car, list] = line.split("|").map((p) => (p || "").trim());
    if (car && list) out[car] = wordList(list);
  }
  for (const car of targetCars()) if (!out[car]) out[car] = wordList(car);
  return out;
}

// 조합 키워드 → 검색어 목록 · 빼는 말
// 한 줄 = 검색어 하나(줄끼리 '또는') · 띄어 쓴 단어 = 모두 들어간 글 · A|B = A 또는 B · -단어 = 그 말이 있는 글 빼기
function keywordPlan(text = $("#keywords").value) {
  const queries = [];
  const minus = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    const terms = [];
    for (const p of parts) {
      if (p.startsWith("-") && p.length > 1) minus.push(p.slice(1));
      else terms.push(p.split("|").map((x) => x.trim()).filter(Boolean));
    }
    if (!terms.length) continue;
    let combos = [[]];
    for (const alts of terms) combos = combos.flatMap((c) => alts.map((a) => [...c, a]));
    for (const c of combos) queries.push(c.join(" "));
  }
  return { queries: [...new Set(queries)], minus: [...new Set(minus)] };
}

function queries() {
  return keywordPlan().queries;
}

function timeOf(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
}

function dayOf(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// 기간: { start: 시작 시각, end: 끝 시각 다음 1분 (그 분까지 포함) }
function period() {
  const start = timeOf($("#startDate").value) || new Date(0);
  const e = timeOf($("#endDate").value);
  const end = e ? new Date(e.getTime() + 60000) : new Date(8640000000000000);
  return { start, end };
}

function inPeriodTime(time, p = period()) {
  if (!time) return true; // 날짜를 모르면 빼지 않음
  return time >= p.start.getTime() && time < p.end.getTime();
}

// "11/1(일) 00:00 ~ 11/8(일) 23:59"
function periodText() {
  const f = (v) => {
    const d = timeOf(v);
    return d ? `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}` : "?";
  };
  return `${f($("#startDate").value)} ~ ${f($("#endDate").value)}`;
}

// 보고서 제목 (보고서 초안의 제목 → 없으면 '이슈명 관련 여론 동향')
function reportTitle() {
  return (report?.title || "").trim() || `${($("#issueName").value || DEFAULT_ISSUE).trim()} 관련 차종별 동호회 여론 동향`;
}

function renderCafeInfo() {
  const list = cafes();
  const byCar = targetCars().map((car) => `${car}: ${list.filter((c) => c.car === car).map((c) => c.name).join(", ")}`);
  $("#cafeNames").textContent = list.length ? `동호회 ${list.length}곳 · ${byCar.join(" / ")}` : "동호회가 없습니다 (설정에서 추가)";
  const tbody = $("#cafeInfo tbody");
  tbody.innerHTML = "";
  for (const c of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td></td><td><input type="text" class="slug" spellcheck="false" placeholder="자동 (숫자나 카페 주소 붙여넣기)"></td>`;
    tr.children[0].textContent = c.car;
    tr.children[1].textContent = c.name;
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
  const filter = $("#carFilter");
  const keep = filter.value;
  filter.length = 1;
  for (const car of targetCars()) filter.add(new Option(car, car));
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
  const sec = list.length * 1.5 * SEC_PER_PAGE;
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
// 관련 글 판단 (규칙): 코세페 단어가 있으면 체크 · 할인 단어만 있으면 본문까지 읽어 확인
// ---------------------------------------------------------------------------

function judge(text) {
  const t = compactText(text);
  const ksf = wordList($("#ksfWords").value).some((w) => hasWord(t, w));
  const sale = wordList($("#saleWords").value).some((w) => hasWord(t, w));
  const exc = wordList(`${$("#exclude").value}\n${keywordPlan().minus.join("\n")}`).some((w) => hasWord(t, w));
  return { related: ksf && !exc, candidate: (ksf || sale) && !exc, ksf, sale, exc };
}

// 코세페 검색어(코세페·코리아 세일 페스타…)로 찾은 글은 제목·미리보기에 단어가 없어도 본문·댓글에 있다
// (네이버가 본문·댓글까지 검색) → 본문을 읽어 확인할 글로 둔다
const KSF_QUERY_NOTE = "코세페 검색어로 찾음 - 본문에서 확인";
function ksfQueryHit(item) {
  // 날짜 없는 글 = 검색 화면 위에 늘 붙는 카페 공지(이용 안내·회칙·가격표 등) → 넣지 않는다
  if (!item.date) {
    if (item.note === KSF_QUERY_NOTE && !item.touched && !item.bodyRead) {
      item.candidate = false;
      item.note = "날짜 모름 (카페 공지로 보임)";
    }
    return false;
  }
  if (item.candidate || item.touched || item.bodyRead) return false;
  if (!(item.queries || []).some((q) => judge(q).ksf)) return false;
  if (judge(`${item.title} ${item.text}`).exc) return false;
  item.candidate = true;
  item.note = KSF_QUERY_NOTE;
  return true;
}

function judgeNote(j) {
  if (j.related) return "";
  if (j.exc) return "관련 없는 단어 있음";
  if (j.sale) return "본문 확인 단어 있음";
  return "코세페·할인 단어 없음";
}

// ---------------------------------------------------------------------------
// 차종별 반응 판단 (규칙 어림 - AI 를 켜면 AI 가 판단)
// 반응 하나 = (글 또는 댓글) × (그 글·댓글이 말하는 차종). 차종 이름이 없으면 동호회 차종.
// ---------------------------------------------------------------------------

const NEG_WORDS = [
  "보상", "역차별", "호구", "손해", "억울", "배신", "기만", "우롱", "뒤통수", "트라우마", "열받", "화나", "짜증", "욕나", "욕 나",
  "찔끔", "쥐꼬리", "생색", "별로", "실망", "재고", "떨이", "실적", "취소", "안 사", "안사", "안 삽", "다른 차", "넘어가", "먹이", "장난",
  "선넘", "너무하", "어이없", "황당", "씁쓸", "비싸", "속상",
];
const POS_WORDS = ["좋네", "좋아", "좋은 기회", "기회", "괜찮", "혜자", "득템", "개이득", "이득", "만족", "착하", "잘됐", "다행", "계약했", "계약하", "질렀", "살 만", "사볼", "알아보"];
const BLAME_WORDS = ["현기", "흉기", "양아치", "날강도", "도둑", "사기꾼", "개같", "꺼져", "망해라", "노조", "귀족노조"];
// 규칙으로 정하는 주요 내용 (AI 를 쓰지 않을 때) - [주요 내용, 단어들]
const NEG_THEMES = [
  ["기존 구매자 보상 필요·역차별 불만", ["보상", "역차별", "호구", "먼저 산", "먼저산", "출고한", "기존 구매", "계약자", "손해", "억울", "트라우마", "뒤통수"]],
  ["재고 처리·실적용 할인 의심", ["재고", "떨이", "실적", "밀어내"]],
  ["할인 폭·조건 불만", ["찔끔", "쥐꼬리", "생색", "할인폭", "할인 폭", "조건", "별로"]],
  ["가격 정책·회사 신뢰 하락", ["배신", "기만", "우롱", "먹이", "장난", "신뢰", "정책"]],
  ["구매 취소·타 차종 고려", ["취소", "안 사", "안사", "안 삽", "다른 차", "넘어가"]],
];
const POS_THEMES = [
  ["이번 할인을 계기로 구매를 알아보게 됨", ["알아보", "계약", "질렀", "사볼", "살까", "구매"]],
  ["구매자 입장에서 할인 혜택 반가움", ["좋", "괜찮", "기회", "혜자", "득템", "이득", "다행", "착하", "만족"]],
];

function carsIn(text) {
  const t = compactText(text);
  return Object.entries(carWords()).filter(([, ws]) => ws.some((w) => hasWord(t, w))).map(([car]) => car);
}

function ruleTone(text) {
  const t = compactText(text);
  const count = (list) => list.filter((w) => t.includes(compactText(w))).length;
  const neg = count(NEG_WORDS);
  const pos = count(POS_WORDS);
  const blame = count(BLAME_WORDS);
  if (blame && !neg && !pos) return "단순비난";
  if (neg > pos) return "부정";
  if (pos > neg) return "긍정";
  return blame ? "단순비난" : "중립";
}

function ruleTheme(text, tone) {
  const t = compactText(text);
  const list = tone === "부정" ? NEG_THEMES : tone === "긍정" ? POS_THEMES : [];
  for (const [label, ws] of list) if (ws.some((w) => t.includes(compactText(w)))) return label;
  return tone === "부정" ? "기타 부정 의견" : tone === "긍정" ? "기타 긍정 의견" : "";
}

// homeCar: 동호회 차종
function ruleOps(text, homeCar) {
  const found = carsIn(text);
  const cars = found.length ? found : [homeCar];
  const tone = ruleTone(text);
  return cars.map((car) => ({ car, tone, theme: ruleTheme(text, tone) }));
}

// 표·엑셀에 쓰는 판단 (AI 결과가 있으면 그것, 없으면 규칙)
// 담당자가 화면에서 고친 성향(holder.manual = { 차종: 성향 })을 덮어쓴다 - 보고서·엑셀·TOP5 에 그대로 반영
function withManual(ops, manual) {
  if (!manual || !Object.keys(manual).length) return ops;
  const out = ops.map((o) => ({ ...o }));
  for (const [car, tone] of Object.entries(manual)) {
    const theme = (o) => (/^(긍정|부정)$/.test(tone) ? (o && o.tone === tone && o.theme ? o.theme : tone === "부정" ? "기타 부정 의견" : "기타 긍정 의견") : "");
    const o = out.find((x) => x.car === car);
    if (o) Object.assign(o, { tone, theme: theme(o), reason: `담당자 수정${o.reason ? ` (AI: ${o.tone})` : ""}`, manual: true });
    else out.push({ car, tone, theme: theme(null), reason: "담당자 수정", manual: true });
  }
  return out;
}

function postOps(x) {
  const ops = x.a?.by === "ai" && x.a.v === JUDGE_VERSION ? x.a.ops : ruleOps(`${x.title}\n${x.body || x.text || ""}`, x.car);
  return withManual(ops, x.manual);
}

function commentOps(x, c) {
  const ops = c.a?.by === "ai" && c.a.v === JUDGE_VERSION ? c.a.ops : ruleOps(c.content, x.car);
  return withManual(ops, c.manual);
}

// 유형 구분 (글쓴이 유형): 담당자 수정 → AI → 단어 규칙(어림)
const PTYPE_NAMES = PTYPES.map(([t]) => t);
const TYPE_WORDS = [
  ["행사 기간 내 계약자", ["이번에 계약", "이번 할인으로 계약", "할인 보고 계약", "코세페로 계약", "코세페 계약", "질렀", "계약했습니다", "계약 완료", "계약완료"]],
  ["출고 대기자", ["출고 대기", "출고대기", "대기 중", "대기중", "출고 기다", "계약하고 기다", "계약자입장", "계약자 입장", "사전계약", "사전 계약"]],
  ["기존 출고자", ["출고했", "출고 받", "출고받", "인수했", "타고 있", "타는 중", "기출고", "먼저 산", "먼저산", "이미 산"]],
  ["계약 예정자", ["살까", "사려고", "계약 예정", "계약하러", "고민 중", "고민중", "알아보는", "구매 예정", "구매예정", "견적"]],
];
function ruleType(text) {
  const t = compactText(text);
  for (const [type, ws] of TYPE_WORDS) if (ws.some((w) => t.includes(compactText(w)))) return type;
  return "유형 구분 외";
}
function typeOf(h, text) {
  if (h.manualType) return h.manualType;
  if (h.a?.by === "ai" && h.a.ptype) return h.a.ptype;
  return ruleType(text);
}

// 판단이 AI(또는 담당자)로 정해졌는지 (잠정치 표시용)
const judged = (h) => h.a?.by === "ai" || (h.manual && Object.keys(h.manual).length);

// ---------------------------------------------------------------------------
// 카페 번호 알아내기: 카페 첫 화면(cafe.naver.com/영문주소)을 열어 화면 속 /cafes/번호/ 단서를 모은다
// ---------------------------------------------------------------------------

function clubIdHintsInFrame() {
  const strong = [];
  const weak = [];
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

// 게시글 화면: 제목 · 작성 시간 · 본문 · 작성자 닉네임 · 조회수 · 댓글수 (각 틀 안에서 실행)
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
    .replace(/[​ ]/g, " ")
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
// 답글은 바로 앞 댓글(부모)의 내용을 함께 남긴다 → "선생님 말씀이 맞습니다" 같은 답글을 맥락으로 판단
async function readCommentsInFrame(pageDelay) {
  if (!document.querySelector("li.CommentItem, .CommentBox")) return { found: false, href: location.href };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const randomWait = () => wait(pageDelay[0] + Math.floor(Math.random() * (pageDelay[1] - pageDelay[0])));
  const all = [];
  const seen = new Set();
  const visited = new Set();
  for (let guard = 0; guard < 300; guard++) {
    let parentText = "";
    for (const li of document.querySelectorAll("li.CommentItem")) {
      const q = (sel) => li.querySelector(sel)?.innerText.trim() || "";
      const isReply = li.classList.contains("CommentItem--reply");
      const row = {
        id: li.id || "",
        isReply,
        parentText: isReply ? parentText : "",
        nickname: q(".comment_nickname"),
        content: q(".text_comment"),
        dateText: q(".comment_info_date"),
        deleted: !!li.querySelector(".comment_deleted, .comment_delete"),
      };
      if (!isReply) parentText = row.content;
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

async function readCommentsIn(where) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answers = await runInFrames(where, readCommentsInFrame, [CAFE_PAGE_DELAY]);
    const hit = answers.find((r) => r.found);
    if (hit) {
      return hit.rows.map((r) => {
        const d = parseCafeDate(r.dateText);
        return {
          id: r.id, isReply: r.isReply, parentText: (r.parentText || "").slice(0, 300), nickname: r.nickname, content: r.content.slice(0, 2000),
          dateText: r.dateText, date: d ? d.date.getTime() : null,
        };
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
  let skippedOld = 0;
  // 지난 수집 때 이미 모은 동호회 (새로 넣은 동호회 글은 '예전에 지운 글' 어림에서 뺀다)
  const seenCafes = new Set(items.map((it) => it.slug.toLowerCase()));
  // 새 글만 찾기: 동호회마다 지난 수집 날(0시) 이후 글이 한 페이지에 하나도 없으면 그 검색어는 멈춘다
  // (지난 수집 기록이 없으면 이미 모은 글의 가장 최근 날짜로 어림)
  const onlyNew = $("#onlyNew").checked;
  const lastRun = (await chrome.storage.local.get("ksfLastRun").catch(() => ({}))).ksfLastRun || {};
  const latestItem = Math.max(0, ...items.map((it) => it.date || 0));
  const dayStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const cutOf = (slug) => {
    if (!onlyNew) return 0;
    const k = slug.toLowerCase();
    if (lastRun[k]) return dayStart(lastRun[k]);
    return seenCafes.has(k) && latestItem ? dayStart(latestItem) : 0;
  };
  if (onlyNew) log("· 새 글만 찾기: 이미 수집한 동호회는 지난 수집 날 이후 글이 없는 페이지에서 바로 다음 검색어로 넘어갑니다");
  let loginNeeded = false;
  const failed = [];
  const noClubId = new Set();
  const startAt = resume ? resume.next : 0;
  if (resume) log(`· 중단된 곳부터 이어서 찾습니다 (${startAt + 1}/${list.length}번째 동호회·검색어부터)`);
  log(`· 기간 ${periodText()}`);

  for (let ji = startAt; ji < list.length && !stopRequested; ji++) {
    const job = list[ji];
    const label = `${job.name} · '${job.q}'`;
    const remain = estimateRemaining(t0, ji - startAt, list.length - startAt, (list.length - ji) * 1.5 * SEC_PER_PAGE);
    showBusy(`게시물 찾는 중 ${ji + 1}/${list.length} · ${label}${remain} — 끝날 때까지 이 탭을 닫지 마세요`, ji, list.length, "게시물 찾는 중");
    setSummary(`찾는 중… ${ji + 1}/${list.length} · ${label}`);
    if (noClubId.has(job.slug)) continue;
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
    let oldPages = 0;
    const cut = cutOf(job.slug);
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
      let fresh = 0;
      let added = 0;
      for (const x of pageItems) {
        const parsed = parseCafeDate(x.dateText);
        if (parsed) dated++;
        if (parsed && parsed.date.getTime() >= cut) fresh++;
        const day = parsed ? new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate()) : null;
        const startDay = new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate());
        if (day && (day < startDay || (parsed.hasTime && parsed.date < p.start))) {
          older++;
          continue;
        }
        if (day && (parsed.hasTime ? parsed.date >= p.end : day >= p.end)) continue;
        const key = `${job.slug}/${x.articleId}`.toLowerCase();
        if (deletedKeys.has(key)) continue;
        const have = items.find((it) => it.key === key);
        if (!have && skipBefore && parsed && parsed.date.getTime() < skipBefore && seenCafes.has(job.slug.toLowerCase())) {
          deletedKeys.add(key);
          skippedOld++;
          continue;
        }
        if (have) {
          if (!have.queries.includes(job.q)) have.queries.push(job.q);
          ksfQueryHit(have);
          continue;
        }
        const item = {
          key, car: job.car, cafeIndex: job.cafeIndex, cafeName: job.name, slug: job.slug, articleId: x.articleId,
          title: x.title, text: x.text, date: parsed ? parsed.date.getTime() : null, hasTime: !!parsed?.hasTime, queries: [job.q],
          checked: false, touched: false, body: "", bodyRead: false, bodyNote: "", nickname: "", views: null, comments: null,
          commentList: [], commentsRead: false, summary: "",
        };
        const j = judge(`${item.title} ${item.text}`);
        item.related = j.related;
        item.candidate = j.candidate;
        item.note = judgeNote(j) + (!j.related && j.candidate ? " - 본문에서 확인" : "");
        item.checked = j.related;
        ksfQueryHit(item);
        items.push(item);
        added++;
        found++;
      }
      log(`· ${label}: ${page}페이지 ${pageItems.length}개 중 새 글 ${added}개` + (older ? ` (기간 전 글 ${older}개)` : ""));
      renderResults();
      // 검색 결과가 정확도순이면 작년·재작년 코세페 글이 앞쪽을 채우고 올해 글이 뒤 페이지에 나온다
      // → 한 페이지가 모두 기간 전 글이어도 멈추지 않고, 3페이지 연속일 때만 멈춘다
      oldPages = dated && older === dated ? oldPages + 1 : 0;
      if (oldPages >= 3) {
        log(`· ${label}: 3페이지 연속 기간 전 글뿐이라 여기서 멈춥니다`);
        break;
      }
      if (cut && dated && !fresh) {
        log(`· ${label}: 지난 수집 뒤 새 글이 없어 다음 검색어로 넘어갑니다`);
        break;
      }
      if (page < maxPages) await sleep(randomBetween(CAFE_PAGE_DELAY));
    }
    await saveItems();
    // 이 동호회의 마지막 검색어까지 끝났으면 수집 시각 기록 (다음 '새 글만 찾기' 기준)
    if (!stopRequested && !loginNeeded && !list.slice(ji + 1).some((j) => j.slug === job.slug)) {
      lastRun[job.slug.toLowerCase()] = t0;
      await chrome.storage.local.set({ ksfLastRun: lastRun }).catch(() => {});
    }
    if (!stopRequested) await saveResume("ksf", { jobs: list, next: ji + 1, start: $("#startDate").value, end: $("#endDate").value });
    if (ji + 1 < list.length && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }

  if (skippedOld) log(`· 예전에 삭제한 글로 보여 다시 넣지 않은 글 ${skippedOld}개`);
  await chrome.storage.local.set({ ksfDeleted: [...deletedKeys] }).catch(() => {});
  if (!stopRequested && skipBefore) {
    skipBefore = 0;
    await chrome.storage.local.set({ ksfSkipBefore: 0 }).catch(() => {});
  }
  if (!stopRequested) await clearResume("ksf");
  $("#diag").hidden = !diagnostics.length;
  renderResults();
  const checked = items.filter((x) => x.checked).length;
  const cand = items.filter((x) => !x.checked && x.candidate && !x.touched).length;
  setSummary(
    `${stopRequested ? "중지됨 (다시 '게시물 찾기'를 누르면 이어서) - " : ""}새로 찾은 글 ${found}개 · 전체 ${items.length}개 중 코세페 글로 체크 ${checked}개` +
      (cand ? ` · 할인 이야기라 본문에서 확인할 글 ${cand}개` : "") +
      ` · ${pagesDone}페이지, ${formatDuration((Date.now() - t0) / 1000)} 걸림` +
      (failed.length ? ` · 못 읽은 곳 ${failed.length}개(아래 기록 참고)` : "") +
      (loginNeeded ? " · 로그인이 필요합니다" : ""),
    loginNeeded || failed.length ? "err" : "ok",
  );
  endBusy();
  if (!stopRequested) playChime();
}

function estimateRemaining(t0, done, total, fallbackSec) {
  const spent = (Date.now() - t0) / 1000;
  const sec = done > 0 ? (spent / done) * (total - done) : fallbackSec;
  return total - done > 0 ? ` · 남은 시간 약 ${formatDuration(sec)}` : "";
}

// ---------------------------------------------------------------------------
// 2. 본문·댓글 읽기 → 판단
// ---------------------------------------------------------------------------

const aiOn = () => $("#aiOn").checked && !!$("#aiKey").value.trim();

async function readBodies() {
  if (running) return;
  await saveSettings();
  // 체크한 글 + (직접 해제하지 않은) 할인 이야기 글을 열어 본문·댓글을 읽는다
  const toRead = (x) => x.checked || (!x.touched && x.candidate);
  const todo = sortedItems().filter((x) => toRead(x) && !x.bodyRead);
  if (todo.length) {
    const minutes = formatDuration(todo.length * SEC_PER_ARTICLE);
    if (!(await askConfirm(`본문·댓글을 읽을 글이 ${todo.length.toLocaleString()}개입니다 (예상 소요 시간 약 ${minutes}).\n` +
      "많은 글을 한 번에 열면 네이버 보호조치가 걸릴 수 있습니다. 중간에 '중지'로 멈춰도 그때까지 읽은 글은 남고, 다시 누르면 이어서 읽습니다.\n\n계속할까요?"))) return;
    await checkLogin();
    startBusy();
    $("#log").hidden = false;
    const t0 = Date.now();
    let ok = 0;
    let nComments = 0;
    for (let i = 0; i < todo.length && !stopRequested; i++) {
      const item = todo[i];
      showBusy(
        `본문·댓글 읽는 중 ${i + 1}/${todo.length} · ${item.cafeName}${estimateRemaining(t0, i, todo.length, (todo.length - i) * SEC_PER_ARTICLE)} — 끝날 때까지 이 탭을 닫지 마세요`,
        i, todo.length, "본문 읽는 중",
      );
      setSummary(`본문·댓글 읽는 중… (${i + 1}/${todo.length}) ${item.title}`);
      if (i) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
      const res = await readPost(articleUrl(item));
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
          if (typeof res.views === "number") item.views = res.views;
          if (typeof res.comments === "number") item.comments = res.comments;
          item.commentList = res.commentList || [];
          item.commentsRead = true;
          nComments += item.commentList.length;
          const parsed = parseCafeDate(res.dateText);
          if (parsed) {
            item.date = parsed.date.getTime();
            item.hasTime = parsed.hasTime;
          }
          // 본문 단어로 다시 판단 (AI 를 쓰면 아래에서 AI 가 최종 판단)
          const j = judge(`${item.title}\n${item.body}\n${item.commentList.map((c) => c.content).join("\n")}`);
          item.related = j.related;
          item.candidate = j.candidate;
          item.note = judgeNote(j);
          if (!item.touched) item.checked = j.related || (j.candidate && aiOn());
          item.bodyNote = "";
          if (!inPeriodTime(item.date) && !item.touched) {
            item.checked = false;
            item.bodyNote = "기간 밖 글";
          }
        }
      }
      renderRow(item);
      if (i % 5 === 4) await saveItems();
    }
    await saveItems();
    log(`· 본문 ${ok}개 · 댓글 ${nComments.toLocaleString()}개를 읽었습니다 (${formatDuration((Date.now() - t0) / 1000)} 걸림)`);
    endBusy();
    renderResults();
    setSummary(
      `${stopRequested ? "중지됨 - " : "✔ "}본문 ${ok.toLocaleString()}개 · 댓글 ${nComments.toLocaleString()}개를 읽었습니다 · ${formatDuration((Date.now() - t0) / 1000)} 걸림` +
        (stopRequested ? " · 다시 누르면 남은 글부터 이어서 읽습니다" : ""),
      "ok",
    );
    if (stopRequested) {
      stopRequested = false;
      return;
    }
  }
  // 다음 단계(성향 분석)는 ④ 탭에서. AI 를 안 쓰면 규칙으로 바로 어림
  if (!aiOn()) await judgeAll();
  playChime();
  setSummary(`${$("#summary").textContent} · 다음: ④ 성향 분석 탭에서 '${aiOn() ? "💰 " : ""}AI 성향 분석 시작'`, $("#summary").className.includes("err") ? "err" : "ok");
}

// ---------------------------------------------------------------------------
// Claude AI 판단 (공식 Anthropic SDK, 전역 Anthropic)
// ---------------------------------------------------------------------------

// 코세페 반응 긍부정 기준 (글·댓글 공통) - 첨부된 분류 예시를 그대로 기준 예로 씀
const TONE_RULES = `[핵심 원칙]
- 일반적인 감정·말투의 긍부정이 아니라, '코리아 세일 페스타(K-세일 페스타 · 코세페 · 11월 현대차 할인 행사)'에 대한 고객 반응의 긍부정을 판단합니다.
- 반드시 '차종별로' 판단합니다. 글·댓글이 어느 차종에 대한 코세페 반응인지 나누고, 차종마다 해당 차종 기준의 성향을 정합니다.
  · 차종 이름이 없으면 그 글이 올라온 동호회의 차종(동호회차종)에 대한 반응입니다. 글의 맥락(게시글 제목·요약)이 특정 차종 이야기면 해당 차종입니다.
  · 여러 대상 차종을 말하면 차종마다 하나씩 (예: "아반떼는 많이 깎아 주는데 그랜저는 찔끔" → 아반떼 긍정 · 그랜저 부정).
  · 대상 차종이 아닌 차(투싼·쏘렌토 등)에 대한 반응만 있으면 car 는 "${OTHER_CAR}".
- tone (코세페에 대한 반응):
  "긍정": 할인 혜택을 반기거나 만족, 좋은 구매 기회로 봄, 이번 할인을 계기로 구매를 알아보거나 계약함, "사는 입장에선 괜찮다"
  "부정": 기존 구매자 역차별·보상 요구, 먼저 산 사람만 손해(호구·트라우마), 할인 폭·조건 불만, 재고 처리·실적용이라는 의심,
          가격 정책·회사에 대한 불신·실망, 구매 포기·취소 고려, 단골·충성 고객을 무시한다는 불만, 부정 의견에 동조("당연히 욕 나올 일이죠")
  "중립": 할인 조건·기간·금액 정보 공유나 문의, 코세페에 대한 평가가 없는 말, 회원끼리의 말다툼·사과·인사·응원
          (예: "말씀이 좀 지나치시네 본인만 안사면 될것을", "선생님 말씀이 다 맞습니다", "이 카페에 현대차 사신분들을 개돼지 취급하는 비하 발언이시네요",
           "혹시나 기분 나쁘신분 계시면 죄송합니다 맨 마지막 문구는 삭제했습니다")
  "단순비난": 코세페나 할인에 대한 구체적 내용·이유 없이 회사·노조·브랜드를 욕하거나 조롱만 함 (예: "흉기 망해라", "현기가 그렇지 뭐")
- 분류 예 (모두 동호회 차종에 대한 반응):
  부정: "그냥 잊고 현생이나 사러 갑니다.. 다들 오늘도 파이팅입니다" (행사에 실망해 체념) · "저도 현대차 트라우마 생겼어요" ·
        "근데 이번 아반떼 하브 8/5 계약자입장으로서 좋은소리 안나옴 이건 구입자문제도 카마스터 문제도아님 제조사 문제지" · "당연히 욕 나올 일이죠 ㅜㅜ" ·
        "사전 구매자들 배려 따윈 전혀 없는 선택이었죠 ㅎㅎ 보상안 마련해야됨" · "다음차는 기출고자의 보상대응보고 생각해야겠어요" ·
        "지금 할인한다는 건 진작에도 가격조정이 가능했던거 아닌가하는 의문과 지금의 대처에 대한 실망감" ·
        "동네에서 구멍가게를 해도 이런 짓은 안합니다. 소비자 그것도 단골 고객을 먹이는 짓은~" ·
        "애초에 하이브리드는 납기 2개월이면서 행사 왜하는지 모르겠어요. 그냥 가솔린 재고쌓인거 팔아먹을 목적으로밖에 안보임" ·
        "ㄷㄷ 그러네요 가솔린 재고처리겸 연말 실적 올릴라고;"
  긍정: "저도 그생각이 났는데 사는입장에선 또 괜찮네요"
- theme (주요 내용): tone 이 긍정·부정일 때만, 그 반응의 핵심 이유를 보고서 표에 들어갈 짧은 구절(8~25자)로.
  같은 이유는 같은 말로 씁니다. 예) 부정 "기존 구매자 대상 보상 지급 필요", "재고 처리·연말 실적용 할인으로 인식", "사전 계약자 역차별 불만",
  "진작 가격 조정이 가능했다는 불신", "할인 폭이 작음" / 긍정 "60개월 무이자 보고 계약 결심", "계기판 무상 장착 혜택 반가움".
  예시는 형식만 참고하고, 원문에 나온 구체적인 혜택·조건·트림·상황을 살려 씁니다 (어느 차종에나 붙는 일반 문구 금지).
  중립·단순비난이면 "".
- reason (판단 근거): 왜 해당 차종·그 성향으로 봤는지 원문에 근거해 한 구절(10~40자). 예) "8/5 계약자로서 할인에 손해를 봤다며 제조사 탓", "회원 간 언쟁으로 코세페 평가 없음".
- 정확성이 가장 중요합니다. 말투가 거칠어도 코세페에 대한 평가가 없으면 중립, 말투가 점잖아도 행사에 실망·불만이면 부정입니다.
  비꼬기·반어("참 잘하는 짓이네요")는 속뜻으로 판단합니다. 확신이 없으면 원문에 드러난 만큼만 판단하고 지나치게 부풀리지 않습니다.

[유형 구분 ptype - 글쓴이가 코세페 혜택과 어떤 관계인지, 글·댓글 하나에 하나 (차종별이 아님)]
  "일반": 예전 차 오너, 구매 계획을 밝히지 않은 회원 등 일반적인 의견 개진 (본인 구매·계약 상황과 무관하게 의견을 말함)
  "기존 출고자": 행사 전에 이미 차를 출고받아 타고 있는 사람 (혜택 미적용자) 예) "작년에 출고했는데", "지금 타고 있는데 억울하네요"
  "출고 대기자": 행사 전에 계약하고 아직 출고를 기다리는 사람 (혜택 미적용자) 예) "8/5 계약하고 대기 중인데", "출고 기다리는 입장에서"
  "행사 기간 내 계약자": 코세페 기간(할인 적용)에 계약한 사람 (혜택 적용자) 예) "이번 할인 보고 계약했습니다", "코세페로 질렀어요"
  "계약 예정자": 아직 계약 전이며 구매를 고민·예정하는 사람 (혜택 적용·미적용 미정) 예) "이번에 살까 고민 중", "계약하러 갈 예정"
  "유형 구분 외": 글로 구분이 안 되거나 위 5가지에 해당하지 않음 (인사·짧은 맞장구·회원 간 말다툼·정보 질문만 등)
  - 글에 드러난 본인 상황만으로 정합니다. 계약 시점이 행사 전이면 출고 여부에 따라 기존 출고자/출고 대기자, 출고 여부가 안 드러나면 출고 대기자.
  - "8/5 계약자입장으로서 좋은소리 안나옴" → 출고 대기자 · 본인 상황 없이 의견만 → 일반 · 판단 근거가 거의 없으면 유형 구분 외.`;

const POST_SYSTEM = `당신은 현대자동차 국내 마케팅·고객 부문에 올리는 온라인 여론 모니터링 보고서를 쓰는 분석가입니다.
주제: 차종별 네이버 동호회에서 '코리아 세일 페스타(K-세일 페스타 · 코세페)' 할인 행사에 대한 고객 반응.
대상 차종: {{cars}} · 모니터링 기간: {{period}}
당신이 쓴 결과는 그대로 사내 보고 엑셀·PPT 에 들어가므로 정확성과 일관성이 가장 중요합니다.

[입력] 글마다 id, 동호회, 동호회차종, 작성일, 제목, 본문.
[출력] 받은 글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다.
1. ksf (true/false): 코리아 세일 페스타(K-세일 페스타·코세페) 또는 그 기간 현대차 11월 할인 행사·프로모션에 대한 글인지.
   할인 조건 공유·문의, 할인에 대한 반응, 기존 구매자 보상 이야기, 할인을 보고 구매를 고민하는 글은 true.
   보험·용품·정비 할인, 중고 거래, 행사와 무관한 일반 글은 false. 애매하면 true (사람이 최종 검토).
2. summary: 한 문장, 40~120자, 사내 보고서 문체로 "~하는 내용" 으로 끝냄. 글에 있는 사실만.
3. ops: 이 글(제목+본문)이 말하는 차종별 코세페 반응. 최소 1개. ksf=false 이면 [{ car: 동호회차종, tone: "중립", theme: "" }].

${TONE_RULES}

[반드시] 글에 없는 사실을 지어내지 않습니다. 닉네임·개인정보는 쓰지 않습니다. 욕설은 그대로 옮기지 않습니다.`;

const COMMENT_SYSTEM = `당신은 현대자동차 국내 마케팅·고객 부문에 올리는 온라인 여론 모니터링 보고서를 쓰는 분석가입니다.
주제: 차종별 네이버 동호회에서 '코리아 세일 페스타(K-세일 페스타 · 코세페)' 할인 행사에 대한 고객 반응.
대상 차종: {{cars}} · 모니터링 기간: {{period}}

[입력] 코세페 관련 게시글에 달린 댓글들. 댓글마다 id, 동호회차종, 게시글 제목, 게시글 요약(맥락), 구분(댓글/답글), 앞 댓글(답글이면 그 답글이 달린 댓글), 댓글 내용.
[출력] 받은 댓글마다 하나씩, 받은 순서대로, id 를 그대로 돌려줍니다. ops: 이 댓글의 차종별 코세페 반응 (최소 1개).
답글은 앞 댓글에 대한 동의·반박인지 보고 판단합니다 (부정 댓글에 "맞아요" → 부정, 회원 간 말다툼·사과 → 중립).

${TONE_RULES}

[반드시] 댓글에 없는 사실을 지어내지 않습니다. 닉네임·개인정보는 쓰지 않습니다.`;

// 보고서 작성 목적 · 이슈명 · 기간 (모든 AI 지시문 맨 앞에) + 담당자 추가 규칙 · 재분석 지시사항
function purposeText() {
  const purpose = String($("#purpose")?.value || "").trim();
  return `[보고서 작성 목적 - 모든 판단은 이 목적에 맞춰서]\n${purpose || DEFAULT_PURPOSE}\n이슈명: ${($("#issueName")?.value || DEFAULT_ISSUE).trim()} · 모니터링 기간: ${periodText()}\n\n`;
}

function aiExtra() {
  const extra = String($("#aiRules")?.value || "").trim();
  const re = String($("#reInstr")?.value || "").trim();
  return (extra ? `\n\n[담당자 추가 규칙 - 위 규칙보다 우선]\n${extra}` : "") + (re ? `\n\n[재분석 지시사항 - 담당자가 준 것, 가장 우선]\n${re}` : "");
}

function fillSystem(text) {
  const cars = targetCars();
  const words = carWords();
  const carText = cars.map((c) => `${c}(${(words[c] || []).map((w) => w.w).join("·")})`).join(", ");
  return purposeText() + text.replace("{{cars}}", carText).replace("{{period}}", periodText()) + aiExtra();
}

function opsSchema() {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        car: { type: "string", enum: [...targetCars(), OTHER_CAR] },
        tone: { type: "string", enum: TONES },
        theme: { type: "string" },
        reason: { type: "string" },
      },
      required: ["car", "tone", "theme", "reason"],
      additionalProperties: false,
    },
  };
}

function postSchema() {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, ksf: { type: "boolean" }, summary: { type: "string" }, ptype: { type: "string", enum: PTYPE_NAMES }, ops: opsSchema() },
          required: ["id", "ksf", "summary", "ptype", "ops"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

function commentSchema() {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, ptype: { type: "string", enum: PTYPE_NAMES }, ops: opsSchema() },
          required: ["id", "ptype", "ops"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

// ops 검사·정리: 같은 차종은 하나만 · 긍정/부정이 아니면 주요 내용 비움 → 형식이 어긋나면 null
function cleanOps(ops, homeCar) {
  if (!Array.isArray(ops) || !ops.length) return null;
  const cars = [...targetCars(), OTHER_CAR];
  const out = [];
  for (const o of ops) {
    if (!o || !cars.includes(o.car) || !TONES.includes(o.tone)) return null;
    if (out.some((x) => x.car === o.car)) continue;
    const theme = /^(긍정|부정)$/.test(o.tone) ? String(o.theme || "").replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim().slice(0, 40) : "";
    const reason = String(o.reason || "").replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim().slice(0, 80);
    out.push({ car: o.car, tone: o.tone, theme: theme || (o.tone === "부정" ? "기타 부정 의견" : o.tone === "긍정" ? "기타 긍정 의견" : ""), reason });
  }
  return out.length ? out : [{ car: homeCar, tone: "중립", theme: "" }];
}

async function callAi(client, model, system, schema, content, effort = "medium") {
  const params = {
    model,
    max_tokens: 16000,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  };
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 판단을 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 잘렸습니다");
  return { msg, parsed: JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join("")) };
}

function chargeAi(msg, model, usage) {
  const input = msg.usage?.input_tokens || 0;
  const output = msg.usage?.output_tokens || 0;
  usage.input += input;
  usage.output += output;
  aiSpend = { won: aiSpend.won + aiWonExact(input, output, model), input: aiSpend.input + input, output: aiSpend.output + output };
  chrome.storage.local.set({ ksfAiSpend: aiSpend }).catch(() => {});
}

async function aiPostBatch(client, model, batch, usage) {
  const input = batch.map((x) => ({
    id: x.key, 동호회: x.cafeName, 동호회차종: x.car, 작성일: x.date ? formatDateTime(new Date(x.date), false) : "",
    제목: x.title, 본문: (x.body || x.text || "").slice(0, AI_BODY_CHARS),
  }));
  const { msg, parsed } = await callAi(client, model, fillSystem(POST_SYSTEM), postSchema(),
    `아래 글 ${batch.length}개를 규칙대로 판단해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}`);
  chargeAi(msg, model, usage);
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  const results = batch.map((x) => {
    const r = byId.get(x.key);
    if (!r || typeof r.ksf !== "boolean" || typeof r.summary !== "string") return null;
    const ops = cleanOps(r.ops, x.car);
    const summary = r.summary.replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim();
    return ops && summary.length >= 4 && PTYPE_NAMES.includes(r.ptype) ? { ksf: r.ksf, summary, ops, ptype: r.ptype } : null;
  });
  const bad = results.filter((r) => !r).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  batch.forEach((x, i) => {
    const r = results[i];
    x.summary = r.summary;
    x.ksf = r.ksf;
    x.a = { ops: r.ops, ptype: r.ptype, by: "ai", v: JUDGE_VERSION };
    if (!x.touched) x.checked = r.ksf && inPeriodTime(x.date);
  });
}

async function aiCommentBatch(client, model, batch, usage) {
  const input = batch.map(({ x, c }, i) => ({
    id: String(i), 동호회차종: x.car, 게시글제목: x.title, 게시글요약: x.summary || "", 구분: c.isReply ? "답글" : "댓글",
    앞댓글: c.isReply ? (c.parentText || "").slice(0, 200) : "", 댓글: c.content.slice(0, 600),
  }));
  const { msg, parsed } = await callAi(client, model, fillSystem(COMMENT_SYSTEM), commentSchema(),
    `아래 댓글 ${batch.length}개를 판단해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}`, "high");
  chargeAi(msg, model, usage);
  const byId = new Map((parsed.items || []).map((r) => [r.id, r]));
  const results = batch.map(({ x }, i) => {
    const r = byId.get(String(i));
    const ops = cleanOps(r?.ops, x.car);
    return ops && PTYPE_NAMES.includes(r.ptype) ? { ops, ptype: r.ptype } : null;
  });
  const bad = results.filter((r) => !r).length;
  if (bad) throw new Error(`결과 ${bad}건의 형식이 맞지 않습니다`);
  batch.forEach(({ c }, i) => (c.a = { ops: results[i].ops, ptype: results[i].ptype, by: "ai", v: JUDGE_VERSION }));
}

// 묶음들을 AI_PARALLEL 개씩 동시에 → { failed, fatal, lastError }
async function runBatches(batches, fn, onDone) {
  let next = 0;
  let failed = 0;
  let fatal = null;
  let lastError = null;
  const worker = async () => {
    while (next < batches.length && !fatal && !stopRequested) {
      const batch = batches[next++];
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok && !fatal; attempt++) {
        try {
          await fn(batch);
          ok = true;
        } catch (e) {
          lastError = e;
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
        }
      }
      if (!ok && !fatal && batch.length > 1) {
        // 하나씩 다시 (한 건 때문에 묶음 전체가 규칙 판단이 되지 않게)
        for (const one of batch) {
          try {
            await fn([one]);
          } catch (e) {
            lastError = e;
            failed++;
          }
        }
        ok = true;
      }
      if (!ok) failed += batch.length;
      onDone(batch);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, worker));
  return { failed, fatal, lastError };
}

// 판단할 것: 본문을 읽은 글(체크했거나 할인 이야기라 확인할 글) · 체크한 글의 댓글
function judgeTargets(force = false) {
  const fresh = (a) => a?.by === "ai" && a.v === JUDGE_VERSION && !!a.ptype;
  const posts = sortedItems().filter((x) => x.bodyRead && x.body && (x.checked || (!x.touched && x.candidate)) && (force || !fresh(x.a)));
  return { posts };
}

function commentTargets(force = false) {
  const fresh = (a) => a?.by === "ai" && a.v === JUDGE_VERSION && !!a.ptype;
  return reportComments().filter(({ c }) => force || !fresh(c.a));
}

// 판단: AI 를 켰으면 ① 글(코세페 글인지 · 요약 · 차종별 반응) → ② 체크한 글의 댓글(차종별 반응). 끄면 규칙(어림).
async function judgeAll({ force = false, postsOnly = false } = {}) {
  if (running) return;
  if (!aiOn()) {
    for (const x of items) if (x.checked && !x.summary) x.summary = ruleSummary(x);
    tops = null;
    await saveItems();
    renderResults();
    setSummary("✔ 규칙(단어)으로 차종별 반응을 어림했습니다. 보고에 쓰려면 Claude AI 를 켜고 '💰 AI 성향 분석 시작'을 눌러 주세요.", "ok");
    return;
  }
  const model = $("#aiModel").value;
  const { posts } = judgeTargets(force);
  // 댓글 수는 글 판단 뒤 체크가 바뀔 수 있어 어림 (지금 체크·확인 대상 글의 댓글)
  const willComments = sortedItems()
    .filter((x) => x.bodyRead && (x.checked || (!x.touched && x.candidate)))
    .flatMap((x) => (postsOnly ? [] : x.commentList || []).filter((c) => inPeriodTime(c.date) && (force || !(c.a?.by === "ai" && c.a.v === JUDGE_VERSION && c.a.ptype))));
  if (!posts.length && !willComments.length) {
    renderResults();
    setSummary("판단할 글·댓글이 없습니다 (모두 판단했습니다). 기준을 바꿨으면 '다시 판단하기'를 눌러 주세요.", "ok");
    return;
  }
  const postChars = posts.reduce((n, x) => n + Math.min(AI_BODY_CHARS, (x.body || "").length) + x.title.length + 150, 0);
  const cmtChars = willComments.reduce((n, c) => n + Math.min(600, c.content.length) + (c.isReply ? 200 : 0) + 120, 0);
  const est = aiCostWon(
    postChars * 1.1 + 2500 * Math.ceil(posts.length / AI_BATCH) + cmtChars * 1.1 + 2500 * Math.ceil(willComments.length / COMMENT_BATCH),
    posts.length * 220 + willComments.length * 50, model,
  );
  if (!(await askConfirm(`Claude AI 로 차종별 코세페 반응을 판단합니다.\n· 글 ${posts.length.toLocaleString()}개 (코세페 글인지 · 요약 · 차종별 반응)\n· 댓글 약 ${willComments.length.toLocaleString()}개 (차종별 반응)\n\n` +
    `예상 비용 ${fmtWon(est)} · ${AI_MODELS.find(([id]) => id === model)[1].split(" (")[0]}\n계속할까요?`))) return;
  const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
  const usage = { input: 0, output: 0 };
  const t0 = Date.now();
  startBusy();
  // ① 글
  const pb = [];
  for (let i = 0; i < posts.length; i += AI_BATCH) pb.push(posts.slice(i, i + AI_BATCH));
  let done = 0;
  const pr = await runBatches(pb, (b) => aiPostBatch(client, model, b, usage), (b) => {
    done++;
    showBusy(`글 판단 중 ${done}/${pb.length}묶음${estimateRemaining(t0, done, pb.length, (pb.length - done) * 25)}`, done, pb.length, "AI 판단 중");
    for (const x of b) renderRow(x);
  });
  await saveItems();
  // ② 댓글 (체크한 글만)
  let cr = { failed: 0, fatal: null };
  if (!pr.fatal && !stopRequested && !postsOnly) {
    const todo = commentTargets(force);
    const cb = [];
    for (let i = 0; i < todo.length; i += COMMENT_BATCH) cb.push(todo.slice(i, i + COMMENT_BATCH));
    const t1 = Date.now();
    done = 0;
    cr = await runBatches(cb, (b) => aiCommentBatch(client, model, b, usage), () => {
      done++;
      showBusy(`댓글 판단 중 ${done}/${cb.length}묶음${estimateRemaining(t1, done, cb.length, (cb.length - done) * 25)}`, done, cb.length, "AI 판단 중");
    });
  }
  tops = null; // 판단이 바뀌면 TOP5 는 다시 묶어야 함
  await chrome.storage.local.remove("ksfTops").catch(() => {});
  endBusy();
  await saveItems();
  renderResults();
  const fatal = pr.fatal || cr.fatal;
  const failed = pr.failed + cr.failed;
  const cost = fmtWon(aiWonExact(usage.input, usage.output, model));
  if (fatal) setSummary(`AI 판단을 하지 못했습니다: ${aiErrorMessage(fatal)} (판단하지 못한 것은 규칙으로 어림)`, "err");
  else
    setSummary(
      `${stopRequested ? "중지됨 - " : "✔ "}Claude AI 로 차종별 반응을 판단했습니다 · ${formatDuration((Date.now() - t0) / 1000)} · 비용 ${cost}` +
        (failed ? ` · ${failed}건은 실패해 규칙으로 어림(${aiErrorMessage(pr.lastError || cr.lastError)})` : "") +
        " · 다음: '💰 주요 내용 TOP5 정리'",
      failed ? "err" : "ok",
    );
  if (!stopRequested) playChime();
  stopRequested = false;
}

// 규칙 요약: 본문 앞 문장 1~2개
function ruleSummary(item) {
  const src = item.body || item.text || "";
  const ksfW = [...wordList($("#ksfWords").value), ...wordList($("#saleWords").value)];
  const sentences = src.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 6);
  const pick = sentences.filter((s) => ksfW.some((w) => hasWord(compactText(s), w))).slice(0, 2);
  let out = (pick.length ? pick : sentences.slice(0, 1)).join(" ") || item.title;
  return out.length > 150 ? `${out.slice(0, 148)}…` : out;
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
  updateCounts();
  showAiStatus(key ? "✔ API 키를 저장했습니다 (이 PC 크롬에만). '키 확인'으로 맞는 키인지 확인할 수 있습니다." : "API 키를 지웠습니다.", key ? "ok" : "");
}

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
      ? "API 키가 없습니다. 키 없이도 쓸 수 있지만, 차종별 반응은 단어 규칙으로 어림합니다(보고 전 확인 필요)."
      : $("#aiOn").checked
        ? `✔ 저장된 키로 Claude AI 를 씁니다 (sk-ant-…${key.slice(-4)}).`
        : `저장된 키가 있지만 꺼져 있어 규칙으로 어림합니다 (sk-ant-…${key.slice(-4)}).`;
    cls = key && $("#aiOn").checked ? "ok" : "";
  }
  box.textContent = text;
  box.className = `hint ${cls}`;
}

function renderAiState() {
  const as = $("#aiState");
  const key = $("#aiKey").value.trim();
  const model = AI_MODELS.find(([id]) => id === $("#aiModel").value)?.[1].split(" (")[0] || "";
  as.textContent = !key ? "API 키 없음 - 규칙으로 어림" : $("#aiOn").checked ? `✔ 키 저장됨 · ${model} 사용` : "키 저장됨 · AI 꺼짐(규칙으로 어림)";
  as.className = `panel-state ${key && $("#aiOn").checked ? "ok" : "err"}`;
}

function setupPanel(id, needsAttention) {
  const el = $(`#${id}`);
  let saved = null;
  try {
    saved = localStorage.getItem(`ksfPanel_${id}`);
  } catch {
    /* 무시 */
  }
  el.open = saved ? saved === "open" : needsAttention;
  el.addEventListener("toggle", () => {
    try {
      localStorage.setItem(`ksfPanel_${id}`, el.open ? "open" : "closed");
    } catch {
      /* 무시 */
    }
  });
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

// ---------------------------------------------------------------------------
// 집계: 반응(글·댓글 × 차종) → 차종별 성향 · 주요 내용 TOP5
// ---------------------------------------------------------------------------

// 보고에 넣는 글: 체크한 글 중 기간 안
function reportItems() {
  return sortedItems().filter((x) => x.checked && inPeriodTime(x.date));
}

// 보고에 넣는 댓글: 그 글의 댓글 중 작성일이 기간 안 (모르면 넣음)
function reportComments(list = reportItems()) {
  return list.flatMap((x) => (x.commentList || []).filter((c) => inPeriodTime(c.date)).map((c) => ({ x, c })));
}

// 반응 목록 → [{ key, x, c|null, kind: 게시글/댓글/답글, car, tone, theme, text, date }]
function reactions(list = reportItems()) {
  const out = [];
  for (const x of list) {
    const ptype = typeOf(x, `${x.title}\n${x.body || x.text || ""}`);
    postOps(x).forEach((o) => out.push({ key: `${x.key}#p#${o.car}`, x, c: null, kind: "게시글", ...o, ptype, text: `${x.title}\n${x.body || x.text || ""}`, date: x.date }));
    for (const c of (x.commentList || []).filter((cc) => inPeriodTime(cc.date))) {
      commentOps(x, c).forEach((o) => out.push({
        key: `${x.key}#c#${c.id || `${c.nickname}|${c.dateText}|${c.content.slice(0, 30)}`}#${o.car}`, x, c, kind: c.isReply ? "답글" : "댓글", ...o, ptype: typeOf(c, c.content), text: c.content, date: c.date ?? x.date,
      }));
    }
  }
  return out;
}

function toneCounts(list) {
  const n = Object.fromEntries(TONES.map((t) => [t, 0]));
  for (const r of list) n[r.tone]++;
  return n;
}

// 성향 비율·TOP5 의 바탕: 보고 양식(1p 채널별 표 · 3p TOP5)처럼 게시글과 댓글(답글 포함) 반응 전체
function basis(rs) {
  return rs;
}

// 차종별 숫자 → [{ car, posts, comments, n(바탕 반응 수), tone: {긍정…}, ratio: {긍정…} }] (맨 앞 '전체')
function carStats(rs = reactions()) {
  const list = reportItems();
  const rows = [];
  const make = (car, rr, posts, comments) => {
    const b = basis(rr);
    const tone = toneCounts(b);
    const ratio = Object.fromEntries(TONES.map((t) => [t, b.length ? tone[t] / b.length : 0]));
    return { car, n: b.length, posts, comments, tone, ratio };
  };
  rows.push(make("전체", rs, list.length, reportComments(list).length));
  for (const car of targetCars()) {
    const rr = rs.filter((r) => r.car === car);
    const posts = new Set(rr.filter((r) => !r.c).map((r) => r.x.key)).size;
    const comments = rr.filter((r) => r.c).length;
    rows.push(make(car, rr, posts, comments));
  }
  const other = rs.filter((r) => r.car === OTHER_CAR);
  if (other.length) rows.push(make(OTHER_CAR, other, new Set(other.filter((r) => !r.c).map((r) => r.x.key)).size, other.filter((r) => r.c).length));
  return rows;
}

// TOP5 를 묶은 뒤 판단이 바뀌었는지 보는 표시
function topsSig(rs = reactions()) {
  let h = 0;
  for (const r of basis(rs)) {
    if (!/^(긍정|부정)$/.test(r.tone)) continue;
    const s = `${r.key}|${r.tone}|${r.theme};`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

// 주요 내용 묶음 (AI 로 묶었고 그 뒤 판단이 그대로면 그것, 아니면 같은 주요 내용끼리)
// → { 차종: { 긍정: [{ label, count, ratio, examples: [글] }], 부정: [...] , total: { 긍정, 부정 } } }
function topThemes(rs = reactions()) {
  const fresh = tops && tops.sig === topsSig(rs);
  const out = {};
  for (const car of targetCars()) {
    out[car] = { total: {} };
    for (const tone of ["긍정", "부정"]) {
      const rr = basis(rs).filter((r) => r.car === car && r.tone === tone);
      out[car].total[tone] = rr.length;
      let groups;
      if (fresh && tops.cars?.[car]?.[tone]) {
        const byKey = new Map(rr.map((r) => [r.key, r]));
        groups = tops.cars[car][tone].map((g) => ({ label: g.label, list: g.keys.map((k) => byKey.get(k)).filter(Boolean) }));
        // 묶음에 없는 반응은 그 주요 내용 그대로 (거의 없음)
        const used = new Set(groups.flatMap((g) => g.list.map((r) => r.key)));
        for (const r of rr.filter((r) => !used.has(r.key))) {
          const g = groups.find((x) => x.label === r.theme) || groups[groups.push({ label: r.theme, list: [] }) - 1];
          g.list.push(r);
        }
      } else {
        const map = new Map();
        for (const r of rr) {
          const label = r.theme || (tone === "부정" ? "기타 부정 의견" : "기타 긍정 의견");
          if (!map.has(label)) map.set(label, []);
          map.get(label).push(r);
        }
        groups = [...map.entries()].map(([label, list]) => ({ label, list }));
      }
      // '기타' 묶음은 순위에서 맨 뒤로
      groups.sort((a, b) => (/^기타/.test(a.label) - /^기타/.test(b.label)) || b.list.length - a.list.length);
      out[car][tone] = groups.filter((g) => g.list.length).map((g) => ({
        label: g.label, count: g.list.length, ratio: rr.length ? g.list.length / rr.length : 0,
        examples: g.list.map((r) => r.text.split("\n").pop().trim()).filter(Boolean).sort((a, b) => Math.abs(a.length - 60) - Math.abs(b.length - 60)).slice(0, 3),
        keys: g.list.map((r) => r.key),
        list: g.list,
      }));
    }
  }
  return { cars: out, fresh: !!fresh, by: fresh ? tops.by : "rule" };
}

// 유형 구분별 숫자 · 가장 많이 나온 여론 (TOP5 묶음의 주요 내용 중 그 유형에서 가장 많이 나온 것 · 없으면 대표 원문)
// → [{ type, n, share, tone{}, ratio{}, top: { label, tone, count, quote } | null }]
function typeStats(rs = reactions()) {
  const top = topThemes(rs);
  const labelOf = new Map();
  for (const car of targetCars()) for (const t of ["긍정", "부정"]) for (const g of top.cars[car][t]) for (const k of g.keys) labelOf.set(k, { label: g.label, tone: t });
  const stats = PTYPE_NAMES.map((type) => {
    const list = rs.filter((r) => r.ptype === type);
    const tone = toneCounts(list);
    const ratio = Object.fromEntries(TONES.map((t) => [t, list.length ? tone[t] / list.length : 0]));
    const cnt = new Map();
    for (const r of list) {
      const l = labelOf.get(r.key) || (/^(긍정|부정)$/.test(r.tone) && r.theme ? { label: r.theme, tone: r.tone } : null);
      if (!l || /^기타/.test(l.label)) continue;
      const k = `${l.tone}\u0001${l.label}`;
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    const ranked = [...cnt].sort((a, b) => b[1] - a[1]);
    return { type, list, n: list.length, share: rs.length ? list.length / rs.length : 0, tone, ratio, ranked, top: null };
  });
  // 유형마다 '가장 많이 나온 여론'이 겹치지 않게: (유형, 내용) 짝을 건수 많은 순으로 나눠 준다
  // - 같은 내용을 여러 유형이 많이 말하면 가장 많이 말한 유형이 갖고, 나머지 유형은 다음 순위 내용
  // - '일반'·'유형 구분 외'는 구체적인 유형이 다 고른 뒤에 고른다
  const used = new Set();
  const phase = (t) => (t.type === "유형 구분 외" ? 2 : t.type === "일반" ? 1 : 0);
  for (const ph of [0, 1, 2]) {
    const pairs = stats.filter((t) => t.n && phase(t) === ph).flatMap((t) => t.ranked.map(([k, n]) => ({ t, k, n })));
    pairs.sort((a, b) => b.n - a.n);
    for (const { t, k, n } of pairs) {
      const [tn, label] = k.split("\u0001");
      if (t.top || used.has(label)) continue;
      used.add(label);
      t.top = { label, tone: tn, count: n, quote: false };
    }
  }
  for (const t of stats) {
    if (t.top || !t.n) continue;
    // 겹치지 않는 주요 내용이 없으면 그 유형에서 가장 많은 성향의 대표 원문
    const main = TONES.slice().sort((a, b) => t.tone[b] - t.tone[a])[0];
    const q = t.list.filter((r) => r.tone === main).map((r) => (r.c ? r.c.content : r.x.title).replace(/\s+/g, " ").trim()).filter((x) => x.length >= 6)
      .sort((a, b) => Math.abs(a.length - 50) - Math.abs(b.length - 50))[0];
    if (q) t.top = { label: `‘${q.length > 60 ? `${q.slice(0, 59)}…` : q}’`, tone: main, count: t.tone[main], quote: true };
  }
  return stats.map(({ list, ranked, ...t }) => t);
}

const GROUP_SYSTEM = `당신은 현대자동차 국내 마케팅·고객 부문 온라인 여론 보고서를 쓰는 분석가입니다.
보고서 3페이지 '차종별 긍정·부정 주요 내용 TOP5' 를 만듭니다: 해당 차종 동호회에서 '코리아 세일 페스타(K-세일 페스타 · 코세페)'에 대해
가장 많이 이슈화되고 이야기된 내용을 많은 순으로 뽑는 표입니다 (순위 · 내용 · 개수 · 비율).
[입력] 차종, 성향(긍정 또는 부정), 반응 목록(id, 구분(게시글/댓글/답글), 주요 내용 후보, 판단 근거, 원문).
[할 일]
1. 검수: 원문을 다시 읽고, 이 차종에 대한 코세페 반응으로서 성향이 틀린 것만 fixes 에 넣습니다 (id, 바른 tone, 바른 성향이 긍정·부정이면 theme).
   - 코세페 평가가 없는 회원 간 대화·인사·정보 문의 → 중립 · 이유 없는 욕·조롱 → 단순비난 · 반대 성향이면 바꿈.
   - 확실히 틀린 것만 고칩니다. 애매하면 그대로 둡니다.
2. 묶기: fixes 에 넣지 않은 반응을 '같은 이슈'끼리 묶습니다. groups: 묶음마다 label 과 ids.
   - label: 보고서 표의 '내용' 칸 문구, 8~28자, 보고서 문체(명사형 · "~필요", "~인식", "~불만", "~함").
     형식 예) 부정 "하이브리드 사전 계약자 역차별 불만", "가솔린 재고 처리용 할인으로 인식"
              긍정 "60개월 무이자 보고 계약 결심", "계기판 무상 장착 혜택 반가움"
   - 예시 문구를 그대로 쓰지 말고, 이 차종 원문에 나온 구체적인 내용(트림·혜택·조건·상황)을 살려 씁니다.
     어느 차종에나 붙일 수 있는 일반 문구("할인을 계기로 구매 검토", "할인 혜택이 반가움" 등)는 쓰지 않습니다.
   - [이미 쓴 문구] 가 주어지면 그 문구와 같거나 거의 같은 표현은 쓰지 않습니다 (보고서에서 차종마다 내용이 달라 보여야 함).
   - 의미가 같은 이슈는 표현이 달라도 하나로 합칩니다(많이 이야기된 이슈가 쪼개져 순위가 낮아지지 않게). 다른 이슈를 억지로 합치지 않습니다.
   - 반응이 많은 순으로 최대 8개 묶음. 한두 번만 나온 이슈들은 마지막에 "기타 부정 의견"/"기타 긍정 의견" 하나로 모읍니다.
   - fixes 에 넣지 않은 모든 id 를 정확히 한 묶음에만 넣습니다 (빠뜨리거나 두 번 넣지 않음).`;

const GROUP_SCHEMA = {
  type: "object",
  properties: {
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, tone: { type: "string", enum: TONES }, theme: { type: "string" } },
        required: ["id", "tone", "theme"],
        additionalProperties: false,
      },
    },
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
        required: ["label", "ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["fixes", "groups"],
  additionalProperties: false,
};

// 반응의 판단(ops 중 해당 차종 것)을 고친다 (TOP5 검수 결과)
function fixReaction(r, tone, theme) {
  const holder = r.c || r.x;
  if (!holder.a || holder.a.by !== "ai") return false;
  const op = holder.a.ops.find((o) => o.car === r.car);
  if (!op) return false;
  op.tone = tone;
  op.theme = /^(긍정|부정)$/.test(tone) ? String(theme || "").trim().slice(0, 40) || (tone === "부정" ? "기타 부정 의견" : "기타 긍정 의견") : "";
  op.reason = `${op.reason ? `${op.reason} → ` : ""}TOP5 검수에서 ${tone}(으)로 고침`;
  op.fixed = true;
  return true;
}

// 💰 주요 내용 TOP5 정리: 차종 × (긍정·부정)마다 AI 가 원문을 다시 보며 성향을 검수하고, 많이 이야기된 이슈끼리 묶는다
async function groupThemes() {
  if (running) return;
  if (!aiOn()) {
    tops = null;
    renderStats();
    return setSummary("AI 를 켜지 않아 같은 주요 내용 문구끼리 묶었습니다 (규칙). AI 를 켜면 원문을 다시 검수하고 같은 이슈끼리 묶어 TOP5 를 정리합니다.", "ok");
  }
  const rs0 = basis(reactions());
  const notAi = rs0.filter((r) => /^(긍정|부정)$/.test(r.tone) && (r.c || r.x).a?.by !== "ai").length;
  if (notAi && !(await askConfirm(`긍정·부정 반응 중 ${notAi}개는 아직 AI 로 판단하지 않은 규칙 어림입니다. 먼저 '💰 차종별 반응 판단하기'를 하는 것이 정확합니다.\n그래도 지금 TOP5 를 정리할까요?`))) return;
  const jobsList = [];
  for (const car of targetCars()) for (const tone of ["긍정", "부정"]) {
    const rr = rs0.filter((r) => r.car === car && r.tone === tone);
    if (rr.length) jobsList.push({ car, tone, rr });
  }
  if (!jobsList.length) return setSummary("묶을 긍정·부정 반응이 없습니다. 먼저 본문·댓글을 읽고 판단해 주세요.", "err");
  const model = $("#aiModel").value;
  const total = jobsList.reduce((n, j) => n + j.rr.length, 0);
  const est = aiCostWon(total * 160 + jobsList.length * 1200, total * 30 + jobsList.length * 300, model);
  if (!(await askConfirm(`차종별 긍정·부정 반응 ${total.toLocaleString()}개를 Claude AI 가 원문으로 다시 검수하고(틀린 성향은 고침), 많이 이야기된 이슈끼리 묶어 TOP5 를 정리합니다.\n예상 비용 ${fmtWon(est)}\n\n계속할까요?`))) return;
  const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
  const usage = { input: 0, output: 0 };
  startBusy();
  const t0 = Date.now();
  const result = { by: "ai", cars: {}, at: Date.now() };
  let done = 0;
  let failed = 0;
  let fixedN = 0;
  let lastError = null;
  for (const j of jobsList) {
    if (stopRequested) break;
    showBusy(`TOP5 검수·정리 중 ${done + 1}/${jobsList.length} · ${j.car} ${j.tone}`, done, jobsList.length, "TOP5 정리 중");
    const input = j.rr.map((r, i) => ({
      id: String(i), 구분: r.kind, 주요내용: r.theme, 판단근거: r.reason || "",
      원문: (r.c ? r.c.content : `[제목] ${r.x.title} ${r.x.summary || ""}`).replace(/\s+/g, " ").slice(0, 300),
    }));
    let out = null;
    for (let attempt = 1; attempt <= 3 && !out; attempt++) {
      try {
        const usedLabels = Object.values(result.cars).flatMap((c) => Object.values(c).flat().map((g) => g.label)).filter((l) => !/^기타/.test(l));
        const { msg, parsed } = await callAi(client, model, purposeText() + GROUP_SYSTEM + aiExtra(), GROUP_SCHEMA,
          `차종: ${j.car} · 성향: ${j.tone} · 반응 ${input.length}개` +
            (usedLabels.length ? `\n[이미 쓴 문구] ${usedLabels.join(" / ")}` : "") + `\n\n${JSON.stringify(input)}`);
        chargeAi(msg, model, usage);
        const fixes = (parsed.fixes || []).filter((f) => j.rr[Number(f.id)] && f.tone !== j.tone && TONES.includes(f.tone));
        const fixedIds = new Set(fixes.map((f) => f.id));
        const seen = new Set();
        const gs = (parsed.groups || []).map((g) => ({
          label: String(g.label || "").replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim().slice(0, 40),
          keys: (g.ids || []).filter((id) => j.rr[Number(id)] && !fixedIds.has(id) && !seen.has(id) && seen.add(id)).map((id) => j.rr[Number(id)].key),
        })).filter((g) => g.label && g.keys.length);
        if (seen.size + fixedIds.size < j.rr.length * 0.9) throw new Error("묶음에서 빠진 반응이 많습니다");
        out = { fixes, gs };
      } catch (e) {
        lastError = e;
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) break;
      }
    }
    if (out) {
      for (const f of out.fixes) if (fixReaction(j.rr[Number(f.id)], f.tone, f.theme)) fixedN++;
      result.cars[j.car] = result.cars[j.car] || {};
      result.cars[j.car][j.tone] = out.gs;
    } else failed++;
    done++;
  }
  // 그래도 차종끼리 같은 문구가 남으면 원문을 보고 다르게 다시 쓴다
  if (!failed && !stopRequested) {
    showBusy("TOP5 문구 겹침 확인 중", jobsList.length, jobsList.length, "TOP5 정리 중");
    await relabelDuplicates(client, model, result, usage).catch((e) => { lastError = e; });
  }
  endBusy();
  await saveItems();
  // 검수로 성향을 고친 반응이 다른 쪽(긍정↔부정)으로 옮겨 갔으면 그쪽 묶음에는 '그 주요 내용'으로 들어간다 (topThemes)
  result.sig = topsSig(reactions());
  if (!failed && !stopRequested) {
    tops = result;
    await chrome.storage.local.set({ ksfTops: tops }).catch(() => {});
  }
  renderResults();
  renderStats();
  const cost = fmtWon(aiWonExact(usage.input, usage.output, model));
  setSummary(
    failed || stopRequested
      ? `TOP5 정리를 마치지 못했습니다${lastError ? `: ${aiErrorMessage(lastError)}` : ""} (같은 문구끼리 묶은 결과를 보여줍니다) · 비용 ${cost}`
      : `✔ 차종별 긍정·부정 주요 내용 TOP5 를 정리했습니다 (검수로 성향을 고친 반응 ${fixedN}개) · ${formatDuration((Date.now() - t0) / 1000)} · 비용 ${cost}`,
    failed || stopRequested ? "err" : "ok",
  );
  if (!stopRequested) playChime();
  stopRequested = false;
}

// TOP5 문구가 차종끼리(또는 한 차종의 긍정·부정끼리) 같으면, 각 묶음 원문을 보고 서로 다르게 다시 쓴다 ('기타 ~ 의견'은 그대로)
const RELABEL_SYSTEM = `당신은 현대자동차 국내 마케팅 온라인 여론 보고서를 쓰는 분석가입니다.
보고서의 '차종별 긍정·부정 주요 내용 TOP5' 표에서 서로 다른 차종(또는 묶음)인데 '내용' 문구가 같거나 거의 같은 것들이 있습니다.
각 묶음의 원문 예시를 읽고, 그 묶음에서 실제로 이야기된 구체적인 내용(차종·트림·혜택·조건·상황)을 살려 문구를 다시 씁니다.
- 8~28자, 보고서 문체(명사형 · "~필요", "~인식", "~불만", "~함").
- 다시 쓴 문구끼리, 그리고 [그대로 둘 문구] 와도 같거나 거의 같으면 안 됩니다.
- 뜻은 원래 문구와 원문에서 벗어나지 않게 합니다 (성향을 바꾸거나 없는 내용을 지어내지 않음).`;
const RELABEL_SCHEMA = {
  type: "object",
  properties: { labels: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"], additionalProperties: false } } },
  required: ["labels"],
  additionalProperties: false,
};

function normLabel(l) {
  return String(l || "").replace(/[\s·.,~'"‘’“”]/g, "");
}

async function relabelDuplicates(client, model, result, usage) {
  const all = [];
  for (const [car, c] of Object.entries(result.cars)) for (const [tone, gs] of Object.entries(c)) for (const g of gs || []) all.push({ car, tone, g });
  const byNorm = new Map();
  for (const x of all) {
    if (/^기타/.test(x.g.label)) continue;
    const k = normLabel(x.g.label);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(x);
  }
  const dup = [...byNorm.values()].filter((l) => l.length > 1).flat();
  if (!dup.length) return 0;
  const byKey = new Map(reactions().map((r) => [r.key, r]));
  const keep = all.filter((x) => !dup.includes(x) && !/^기타/.test(x.g.label)).map((x) => x.g.label);
  const input = dup.map((x, i) => ({
    id: String(i), 차종: x.car, 성향: x.tone, 지금문구: x.g.label, 개수: x.g.keys.length,
    원문예시: x.g.keys.map((k) => byKey.get(k)).filter(Boolean).slice(0, 6)
      .map((r) => (r.c ? r.c.content : `${r.x.title} ${r.x.summary || ""}`).replace(/\s+/g, " ").slice(0, 200)),
  }));
  const { msg, parsed } = await callAi(client, model, purposeText() + RELABEL_SYSTEM, RELABEL_SCHEMA,
    `[그대로 둘 문구] ${keep.join(" / ") || "없음"}\n\n[다시 쓸 묶음]\n${JSON.stringify(input)}`);
  chargeAi(msg, model, usage);
  let n = 0;
  for (const l of parsed.labels || []) {
    const x = dup[Number(l.id)];
    const label = String(l.label || "").replace(/\s+/g, " ").replace(/[.。]\s*$/, "").trim().slice(0, 40);
    if (x && label) {
      x.g.label = label;
      n++;
    }
  }
  return n;
}

function topsHaveDup(result) {
  const seen = new Set();
  for (const c of Object.values(result.cars)) for (const gs of Object.values(c)) for (const g of gs || []) {
    if (/^기타/.test(g.label)) continue;
    const k = normLabel(g.label);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

// 지금 보이는 TOP5(정리했든 같은 문구끼리 묶었든)에서 차종끼리 같은 문구가 있으면 원문에 맞게 다르게 다시 써서 저장
// 보고서·PPT·엑셀을 만들기 전에 저절로 부른다 (AI 를 켰을 때만)
async function ensureDistinctTops({ quiet = true } = {}) {
  if (!aiOn()) return { n: 0 };
  const rs = reactions();
  const cur = topThemes(rs);
  const result = { by: cur.by === "rule" ? "rule" : "ai", cars: {}, at: tops?.at || Date.now() };
  for (const car of targetCars()) {
    result.cars[car] = {};
    for (const tone of ["긍정", "부정"]) result.cars[car][tone] = (cur.cars[car]?.[tone] || []).map((g) => ({ label: g.label, keys: [...g.keys] }));
  }
  if (!topsHaveDup(result)) return { n: 0 };
  const model = $("#aiModel").value;
  const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 4 });
  const usage = { input: 0, output: 0 };
  startBusy();
  showBusy("차종별 TOP5 문구 겹침 고치는 중", 0, 1, "TOP5 문구");
  try {
    const n = await relabelDuplicates(client, model, result, usage);
    if (n) {
      result.sig = topsSig(rs);
      tops = result;
      await chrome.storage.local.set({ ksfTops: tops }).catch(() => {});
    }
    return { n, won: aiWonExact(usage.input, usage.output, model) };
  } catch (e) {
    if (!quiet) throw e;
    return { n: 0, error: e };
  } finally {
    endBusy();
    stopRequested = false;
    renderStats();
    if (typeof renderTabs === "function") renderTabs();
  }
}

// 이미 정리한 TOP5 의 문구만 겹치지 않게 다시 쓰기 (묶음·개수는 그대로)
async function relabelTops() {
  if (running) return;
  if (!aiOn()) return setSummary("AI 를 켜야 문구를 다시 쓸 수 있습니다.", "err");
  try {
    const r = await ensureDistinctTops({ quiet: false });
    setSummary(r.n ? `✔ 겹치던 TOP5 문구 ${r.n}개를 차종별 원문에 맞게 다시 썼습니다 · 비용 ${fmtWon(r.won)} · 보고서·PPT·엑셀은 다시 만들어 주세요` : "겹치는 TOP5 문구가 없습니다.", "ok");
  } catch (e) {
    setSummary(`문구를 다시 쓰지 못했습니다: ${aiErrorMessage(e)}`, "err");
  }
}


// ---------------------------------------------------------------------------
// 화면: 결과 표 · 차종별 현황
// ---------------------------------------------------------------------------

function sortedItems() {
  const cars = targetCars();
  const byDate = (a, b) => (a.date ?? Infinity) - (b.date ?? Infinity);
  return [...items].sort((a, b) =>
    $("#sortBy")?.value === "date"
      ? byDate(a, b) || a.cafeIndex - b.cafeIndex
      : cars.indexOf(a.car) - cars.indexOf(b.car) || a.cafeIndex - b.cafeIndex || byDate(a, b),
  );
}

function visibleItems() {
  const car = $("#carFilter").value;
  const view = $("#viewFilter").value;
  return sortedItems().filter((x) => {
    if (car && x.car !== car) return false;
    if (view === "checked") return x.checked;
    if (view === "unchecked") return !x.checked;
    if (view === "unread") return (x.checked || x.candidate) && !x.bodyRead;
    return true;
  });
}

const rowEls = new Map();

function renderResults() {
  const tbody = $("#results tbody");
  tbody.innerHTML = "";
  rowEls.clear();
  const list = visibleItems();
  const frag = document.createDocumentFragment();
  for (const item of list.slice(0, 1500)) frag.appendChild(buildRow(item));
  tbody.appendChild(frag);
  if (!items.length) tbody.innerHTML = `<tr><td colspan="9" class="hint">아직 찾은 글이 없습니다. 위 '게시글 수집 시작'을 눌러 주세요.</td></tr>`;
  if (list.length > 1500) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="hint">… 화면에는 1,500개까지만 보입니다 (위 차종·보기로 좁혀 보세요).</td>`;
    tbody.appendChild(tr);
  }
  updateCounts();
  if (typeof renderTabs === "function") renderTabs();
}

function buildRow(item) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td><input type="checkbox" class="pick"></td><td class="nowrap car"></td><td class="src"></td><td class="ttl"><a target="_blank" rel="noopener"></a></td>` +
    `<td class="nowrap"></td><td class="num"></td><td class="tone-cell"></td><td class="judge"></td><td><button class="small del">삭제</button></td>`;
  tr.querySelector(".pick").addEventListener("change", (e) => {
    item.checked = e.target.checked;
    item.touched = true;
    tr.className = item.checked ? "" : "off";
    updateCounts();
    saveItemsSoon();
    if (typeof renderTabs === "function") renderTabs();
  });
  tr.querySelector(".del").addEventListener("click", () => {
    items = items.filter((x) => x !== item);
    forgetItems([item]);
    tr.remove();
    rowEls.delete(item.key);
    updateCounts();
    saveItemsSoon();
  });
  rowEls.set(item.key, tr);
  fillRow(tr, item);
  return tr;
}

function toneBadge(tone, text = tone) {
  return Object.assign(document.createElement("b"), { className: `tone tone-${tone}`, textContent: text });
}

// 성향 고르기 (담당자 수정 → holder.manual[차종]) · AI(규칙) 판정과 같게 고르면 수정 표시를 지움
function toneSelect(holder, op, onChange) {
  const sel = document.createElement("select");
  sel.className = `tone-sel s-${op.tone}${op.manual ? " manual" : ""}`;
  for (const t of TONES) sel.add(new Option(t, t, false, t === op.tone));
  sel.title = op.manual ? `담당자 수정 · ${op.reason || ""}` : op.reason || "";
  sel.addEventListener("change", () => {
    holder.manual = { ...(holder.manual || {}) };
    holder.manual[op.car] = sel.value;
    // 원래 판정과 같으면 수정 표시를 지운다
    const base = (holder.a?.by === "ai" ? holder.a.ops : null)?.find((o) => o.car === op.car);
    if (base && base.tone === sel.value) delete holder.manual[op.car];
    sel.className = `tone-sel s-${sel.value}${holder.manual[op.car] ? " manual" : ""}`;
    saveItemsSoon();
    renderStatsSoon();
    onChange?.();
  });
  return sel;
}

// 유형 구분 고르기 (담당자 수정 → holder.manualType) · AI 판정과 같게 고르면 수정 표시를 지움
function typeSelect(holder, text, onChange) {
  const sel = document.createElement("select");
  const cur = typeOf(holder, text);
  sel.className = `type-sel${holder.manualType ? " manual" : ""}`;
  for (const t of PTYPE_NAMES) sel.add(new Option(t, t, false, t === cur));
  sel.style.color = (PTYPES.find(([t]) => t === cur) || [, "FF8A8F98"])[1].replace(/^FF/, "#");
  sel.title = holder.manualType ? "담당자 수정" : holder.a?.by === "ai" && holder.a.ptype ? "AI 판정" : "단어 규칙 어림";
  sel.addEventListener("change", () => {
    holder.manualType = sel.value;
    if (holder.a?.by === "ai" && holder.a.ptype === sel.value) delete holder.manualType;
    sel.className = `type-sel${holder.manualType ? " manual" : ""}`;
    sel.style.color = (PTYPES.find(([t]) => t === sel.value) || [, "FF8A8F98"])[1].replace(/^FF/, "#");
    saveItemsSoon();
    renderStatsSoon();
    onChange?.();
  });
  return sel;
}

function fillRow(tr, item) {
  tr.className = item.checked ? "" : "off";
  tr.querySelector(".pick").checked = item.checked;
  tr.children[1].textContent = item.car;
  tr.children[2].textContent = item.cafeName;
  const a = tr.querySelector("a");
  a.href = articleUrl(item);
  a.textContent = item.title;
  a.title = articleUrl(item);
  tr.children[4].textContent = item.date ? formatDateTime(new Date(item.date), item.hasTime) : "날짜 모름";
  tr.children[5].textContent = item.commentsRead ? (item.commentList || []).length.toLocaleString() : typeof item.comments === "number" ? item.comments.toLocaleString() : "";
  // 게시글 성향: 차종마다 고르기 (본문을 읽은 뒤)
  const cell = tr.children[6];
  cell.replaceChildren();
  if (item.bodyRead && item.body) {
    const ops = postOps(item);
    for (const o of ops) {
      const line = document.createElement("div");
      line.className = "tone-line";
      if (ops.length > 1 || o.car !== item.car) line.append(Object.assign(document.createElement("span"), { className: "hint", textContent: `${o.car} ` }));
      line.append(toneSelect(item, o, () => fillRow(tr, item)));
      cell.append(line);
    }
    const tl = document.createElement("div");
    tl.className = "tone-line";
    tl.append(typeSelect(item, `${item.title}\n${item.body || item.text || ""}`, () => fillRow(tr, item)));
    cell.append(tl);
  } else cell.append(Object.assign(document.createElement("span"), { className: "hint", textContent: "본문 읽은 뒤" }));
  // AI 판독: 관련 여부 + 요약 (없으면 규칙 메모)
  const j = tr.children[7];
  j.replaceChildren();
  if (item.a?.by === "ai") {
    j.append(Object.assign(document.createElement("b"), { className: item.ksf === false ? "j-no" : "j-yes", textContent: item.ksf === false ? "무관 " : "관련 " }), item.summary || "");
  } else {
    const notes = [item.bodyNote || item.note, item.summary].filter(Boolean);
    j.append(Object.assign(document.createElement("span"), { className: "hint", textContent: notes.join(" · ") || (item.bodyRead ? "AI 판독 전" : "본문 읽기 전") }));
  }
  j.title = `검색어: ${item.queries.join(", ")}`;
}

function renderRow(item) {
  const tr = rowEls.get(item.key);
  if (tr) fillRow(tr, item);
  updateCounts();
}

function updateCounts() {
  const n = items.filter((x) => x.checked).length;
  const read = items.filter((x) => x.checked && x.bodyRead).length;
  const byCar = targetCars().map((car) => `${car} ${items.filter((x) => x.checked && x.car === car).length}`).join(" · ");
  $("#resultCount").textContent = items.length ? `전체 ${items.length}개 중 ${n}개 체크 (${byCar}) · 본문·댓글 읽음 ${read}/${n}` : "";
  const coin = aiOn() ? "💰 " : "";
  const left = items.filter((x) => !x.bodyRead && (x.checked || (!x.touched && x.candidate))).length;
  $("#readBodies").textContent = left
    ? `본문·댓글 수집 시작 (${left.toLocaleString()}개 · 약 ${formatDuration(left * SEC_PER_ARTICLE)})`
    : "본문·댓글 수집 (모두 읽음)";
  $("#readBodies").disabled = !items.length || running;
  $("#recollect").disabled = !items.some((x) => x.checked && x.bodyRead) || running;
  $("#judge").textContent = `${coin}AI 성향 분석 시작`;
  $("#rejudge").textContent = `${coin}처음부터 다시 분석`;
  $("#groupTop").textContent = `${coin}주요 내용 TOP5 정리`;
  $("#writeReport").textContent = `${coin}AI 보고서 초안 작성`;
  for (const id of ["judge", "rejudge", "groupTop", "judgePosts", "writeReport", "reanalyze"]) $(`#${id}`).disabled = !n || running;
  $("#makeFiles").disabled = !n || running;
  $("#savePpt").disabled = !n || running;
  $("#selDelete").disabled = !n || running;
  $("#selDelete").textContent = n ? `선택 삭제 (${n}개)` : "선택 삭제";
  for (const el of document.querySelectorAll(".cost-ico")) el.hidden = !aiOn();
  const vis = visibleItems();
  $("#checkAll").checked = !!vis.length && vis.every((x) => x.checked);
  renderStatsSoon();
}

let statsTimer = null;
function renderStatsSoon() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(renderStats, 150);
}

const fmtPct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

// 차종별 현황 표 + TOP5
function renderStats() {
  const rs = reactions();
  const stats = carStats(rs);
  const tbody = $("#statTable tbody");
  tbody.replaceChildren();
  for (const s of stats) {
    const tr = document.createElement("tr");
    if (s.car === "전체") tr.className = "total";
    const td = (v, cls = "") => Object.assign(document.createElement("td"), { textContent: v, className: cls });
    tr.append(td(s.car), td(s.posts.toLocaleString(), "num"), td(s.comments.toLocaleString(), "num"), td(s.n.toLocaleString(), "num"));
    for (const t of TONES) {
      const c = td("", "num");
      c.append(toneBadge(t, s.n ? fmtPct(s.ratio[t]) : "-"), Object.assign(document.createElement("span"), { className: "hint", textContent: ` ${s.tone[t]}` }));
      tr.append(c);
    }
    tbody.append(tr);
  }
  const unjudged = rs.filter((r) => !judged(r.c || r.x)).length;
  $("#statState").textContent = !rs.length
    ? "아직 반응이 없습니다 (체크한 글의 본문·댓글을 읽으면 계산됩니다)."
    : unjudged
      ? `잠정치: 반응 ${rs.length.toLocaleString()}개 중 ${unjudged.toLocaleString()}개는 규칙(단어)으로 어림한 값입니다${aiOn() ? " - '💰 AI 성향 분석 시작'을 누르면 AI 로 판단" : ""}.`
      : `✔ 반응 ${rs.length.toLocaleString()}개 모두 AI 로 판단했습니다.`;
  $("#statState").className = `hint ${rs.length && !unjudged ? "ok" : ""}`;
  const all = stats[0];
  $("#toneHead").textContent = all.n
    ? `분석한 반응 ${all.n.toLocaleString()}개 (게시글 ${all.posts.toLocaleString()} · 댓글 ${all.comments.toLocaleString()}) · 부정 여론(부정+단순비난) ${fmtPct(all.ratio["부정"] + all.ratio["단순비난"])} vs 긍정 ${fmtPct(all.ratio["긍정"])}`
    : "";
  // TOP5
  const t = topThemes(rs);
  const box = $("#topBox");
  box.replaceChildren();
  for (const car of targetCars()) {
    const row = document.createElement("div");
    row.className = "top-row";
    row.append(Object.assign(document.createElement("div"), { className: "top-car", textContent: car }));
    for (const tone of ["긍정", "부정"]) {
      const col = document.createElement("div");
      col.className = "top-col";
      col.append(Object.assign(document.createElement("div"), { className: `top-head tone-bg-${tone}`, textContent: `${tone} (${t.cars[car].total[tone].toLocaleString()})` }));
      const table = document.createElement("table");
      table.className = "compact top-table";
      table.innerHTML = "<thead><tr><th>순위</th><th>내용</th><th>개수</th><th>비율</th></tr></thead>";
      const tb = document.createElement("tbody");
      for (let i = 0; i < TOP_N; i++) {
        const g = t.cars[car][tone][i];
        const tr = document.createElement("tr");
        const label = document.createElement("td");
        if (g) {
          label.textContent = g.label;
          label.title = "누르면 이 이슈로 묶인 반응 원문을 펼칩니다";
          tr.className = "pick";
        }
        tr.append(Object.assign(document.createElement("td"), { textContent: i + 1, className: "num" }), label,
          Object.assign(document.createElement("td"), { textContent: g ? `${g.count}건` : "", className: "num" }),
          Object.assign(document.createElement("td"), { textContent: g ? fmtPct(g.ratio) : "", className: "num" }));
        tb.append(tr);
        if (g) {
          // 펼치면: 이 이슈로 묶인 반응 원문 (구분 · 판단 근거) - 사람이 맞게 묶였는지 확인
          const more = document.createElement("tr");
          more.className = "members";
          more.hidden = true;
          const td = document.createElement("td");
          td.colSpan = 4;
          const ul = document.createElement("ul");
          for (const r of g.list) {
            const li = document.createElement("li");
            const a = Object.assign(document.createElement("a"), { href: articleUrl(r.x), target: "_blank", rel: "noopener", textContent: `[${r.kind}]` });
            li.append(a, ` ${(r.c ? r.c.content : r.x.title).replace(/\s+/g, " ").slice(0, 200)}`);
            if (r.reason) li.append(Object.assign(document.createElement("span"), { className: "hint", textContent: ` — ${r.reason}` }));
            ul.append(li);
          }
          td.append(ul);
          more.append(td);
          tr.addEventListener("click", () => (more.hidden = !more.hidden));
          tb.append(more);
        }
      }
      table.append(tb);
      col.append(table);
      row.append(col);
    }
    box.append(row);
  }
  saveDashSoon();
  $("#topState").textContent = t.fresh
    ? `✔ Claude AI 가 원문을 검수하고 같은 이슈끼리 묶은 TOP5 입니다 (${new Date(tops.at).toLocaleString()}) · 개수 = 그 이슈를 말한 게시글·댓글 반응 수 · 비율 = 해당 차종 긍정(부정) 반응 중 비중 · 줄을 누르면 원문`
    : `같은 주요 내용 문구끼리 센 잠정 TOP5 입니다${aiOn() ? " - '💰 주요 내용 TOP5 정리'를 누르면 AI 가 원문을 검수하고 같은 이슈끼리 묶어 많이 이야기된 순으로 정리" : ""} · 줄을 누르면 원문`;
}

function saveItems() {
  return chrome.storage.local.set({ ksfItems: items }).catch(() => {});
}

let saveTimer = null;
function saveItemsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveItems, 500);
}

// ---------------------------------------------------------------------------
// 엑셀 받기
// ---------------------------------------------------------------------------

function fileStem() {
  const p = (id) => String($(`#${id}`).value || "").slice(0, 10).replace(/-/g, "").slice(4);
  return `${today()}_${OUT_NAME}_${p("startDate")}-${p("endDate")}`;
}

// 대표 반응 (성향마다 원문 몇 개 · 짧고 내용 있는 것)
function quotes(rs, car, tone, n = 6) {
  const list = rs.filter((r) => (car === "전체" || r.car === car) && r.tone === tone).map((r) => r.text.split("\n").pop().replace(/\s+/g, " ").trim());
  const uniq = [...new Set(list)].filter((s) => s.length >= 6);
  uniq.sort((a, b) => Math.abs(a.length - 70) - Math.abs(b.length - 70));
  return uniq.slice(0, n).map((s) => `‘${s.length > 140 ? `${s.slice(0, 138)}…` : s}’`).join(", ");
}

function buildExcel() {
  const list = reportItems();
  const rs = reactions(list);
  const stats = carStats(rs);
  const top = topThemes(rs);
  const cars = targetCars();
  const tone = (t) => ({ v: t, s: `tone-${t}` });
  const pct = (v, s = "pct") => ({ v: Math.round(v * 10000) / 10000, s });
  const num = (v) => ({ v, s: "center" });
  const cond = `모니터링 기간 ${periodText()} · 모니터링 채널: 차종별 주요 동호회 (${cafes().map((c) => c.name).join(", ")}) · ` +
    `게시글 ${list.length.toLocaleString()}개 · 댓글 ${reportComments(list).length.toLocaleString()}개 · ${formatDateTime(new Date())} 작성`;
  const unjudged = rs.filter((r) => !judged(r.c || r.x)).length;

  // ① 요약: 차종별 성향 · 차종별 주요 내용 TOP5 (보고서 3p) · 성향별 대표 반응
  const S = [];
  const merges = [];
  S.push([null, { v: reportTitle(), s: "title" }]);
  merges.push("B1:K1");
  S.push([null, { v: cond, s: "note" }]);
  merges.push("B2:K2");
  if (unjudged) {
    S.push([null, { v: `※ 잠정치: 반응 ${rs.length}개 중 ${unjudged}개는 검토 전 수치`, s: "note" }]);
    merges.push(`B${S.length}:K${S.length}`);
  }
  S.push([]);
  S.push([null, { v: "1. 차종별 코세페 반응 성향 (반응 = 게시글·댓글 × 언급 차종)", s: "title" }]);
  S.push([null, ...["차종", "게시글", "댓글", "반응 수", "긍정", "중립", "부정", "단순비난", "부정 여론(부정+단순비난)"].map((h) => ({ v: h, s: "head" }))]);
  for (const s of stats) {
    S.push([null, { v: s.car, s: "bold" }, num(s.posts), num(s.comments), num(s.n),
      ...TONES.map((t) => (s.n ? pct(s.ratio[t], t === "긍정" ? "pct-긍정" : t === "부정" ? "pct-부정" : "pct") : num("-"))),
      s.n ? pct(s.ratio["부정"] + s.ratio["단순비난"], "pct-부정") : num("-")]);
  }
  S.push([null, ...["차종 (건수)", "게시글", "댓글", "반응 수", "긍정", "중립", "부정", "단순비난", "부정 여론(부정+단순비난)"].map((h) => ({ v: h, s: "sub" }))]);
  for (const s of stats) S.push([null, { v: s.car, s: "bold" }, num(s.posts), num(s.comments), num(s.n), ...TONES.map((t) => num(s.tone[t])), num(s.tone["부정"] + s.tone["단순비난"])]);
  S.push([]);
  S.push([null, { v: "2. 차종별 긍정·부정 주요 내용 TOP5 - 많이 이야기된 이슈 순 (보고서 3p · 개수 = 그 이슈를 말한 게시글·댓글 반응 수 · 비율 = 해당 차종 긍정/부정 반응 중 비중)", s: "title" }]);
  S.push([null, { v: "차종", s: "head" }, { v: "긍정", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" },
    { v: "부정", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }]);
  merges.push(`C${S.length}:F${S.length}`, `G${S.length}:J${S.length}`);
  S.push([null, { v: "", s: "head" }, ...["순위", "내용", "개수", "비율", "순위", "내용", "개수", "비율"].map((h) => ({ v: h, s: "sub" }))]);
  merges.push(`B${S.length - 1}:B${S.length}`);
  for (const car of cars) {
    const first = S.length + 1;
    for (let i = 0; i < TOP_N; i++) {
      const p = top.cars[car]["긍정"][i];
      const n = top.cars[car]["부정"][i];
      S.push([null, { v: i ? "" : `${car}\n(긍정 ${top.cars[car].total["긍정"]} · 부정 ${top.cars[car].total["부정"]})`, s: "wrap-head" },
        num(i + 1), { v: p ? p.label : "", s: "wrap" }, num(p ? p.count : ""), p ? pct(p.ratio) : num(""),
        num(i + 1), { v: n ? n.label : "", s: "wrap" }, num(n ? n.count : ""), n ? pct(n.ratio) : num("")]);
    }
    merges.push(`B${first}:B${first + TOP_N - 1}`);
  }
  S.push([]);
  S.push([null, { v: "3. 차종별 성향별 주요 반응 (원문)", s: "title" }]);
  S.push([null, { v: "차종", s: "head" }, { v: "성향", s: "head" }, { v: "비율", s: "head" }, { v: "주요 반응", s: "head" }]);
  merges.push(`E${S.length}:K${S.length}`);
  const heights = {};
  for (const s of stats.filter((x) => x.car !== OTHER_CAR)) {
    for (const t of TONES) {
      const q = quotes(rs, s.car, t);
      S.push([null, { v: s.car, s: "bold" }, tone(t), s.n ? pct(s.ratio[t]) : num("-"), { v: q || "-", s: "wrap" }]);
      merges.push(`E${S.length}:K${S.length}`);
      heights[S.length] = Math.min(160, Math.max(20, Math.ceil(q.length / 95) * 16 + 6));
    }
  }
  S.push([]);
  S.push([null, { v: "4. 유형 구분별 반응 (글쓴이 유형 · 반응 기준)", s: "title" }]);
  S.push([null, ...["유형 구분", "반응 수", "비중", "긍정", "중립", "부정", "단순비난", "가장 많이 나온 여론"].map((h) => ({ v: h, s: "head" }))]);
  merges.push(`I${S.length}:K${S.length}`);
  for (const t of typeStats(rs)) {
    const topText = t.top ? `${t.top.quote ? "" : `[${t.top.tone}] `}${t.top.label}${t.top.quote ? "" : ` (${t.top.count}건)`}` : "-";
    S.push([null, { v: t.type, s: "bold" }, num(t.n), t.n ? pct(t.share) : num("-"), ...TONES.map((k) => (t.n ? pct(t.ratio[k], k === "긍정" ? "pct-긍정" : k === "부정" ? "pct-부정" : "pct") : num("-"))), { v: topText, s: "wrap" }]);
    merges.push(`I${S.length}:K${S.length}`);
    heights[S.length] = topText.length > 48 ? 34 : 20;
  }
  for (const line of typeNotes()) {
    S.push([null, { v: line, s: "note" }]);
    merges.push(`B${S.length}:K${S.length}`);
  }
  const summary = {
    name: "요약", rows: S, merges, heights, noGrid: true,
    widths: { 1: 2, 2: 16, 3: 9, 4: 34, 5: 9, 6: 9, 7: 9, 8: 34, 9: 9, 10: 9, 11: 22 },
  };

  // ② 게시글
  const P = [[null, ...["순번", "차종(동호회)", "동호회명", "작성일", "제목", "내용 요약", "URL", "작성자", "조회수", "댓글수(읽은 댓글)", "글 반응(차종: 성향)", "글 주요 내용"].map((h) => ({ v: h, s: "head" }))]];
  list.forEach((x, i) => {
    const ops = postOps(x);
    P.push([null, num(i + 1), num(x.car), { v: x.cafeName, s: "cell" }, x.date ? { v: excelSerial(new Date(x.date)), s: "date" } : num(""),
      { v: x.title, s: "wrap" }, { v: x.summary || ruleSummary(x), s: "wrap" }, { v: articleUrl(x), s: "cell" }, { v: x.nickname || "", s: "cell" },
      num(typeof x.views === "number" ? x.views : ""), num(`${x.comments ?? ""}${x.commentList ? ` (${x.commentList.length})` : ""}`),
      { v: ops.map((o) => `${o.car}: ${o.tone}`).join(", "), s: "wrap" }, { v: ops.map((o) => o.theme).filter(Boolean).join(" / "), s: "wrap" }]);
  });
  const posts = { name: "게시글", rows: P, freeze: 1, filter: "B1:M1", widths: { 1: 2, 2: 6, 3: 10, 4: 18, 5: 16, 6: 40, 7: 50, 8: 34, 9: 14, 10: 8, 11: 12, 12: 22, 13: 30 } };

  // ③ 반응 (raw): 반응 하나 = 글·댓글 × 차종
  const groupOf = new Map();
  for (const car of cars) for (const t of ["긍정", "부정"]) top.cars[car][t].forEach((g, i) => g.keys.forEach((k) => groupOf.set(k, `${i + 1}위 ${g.label}`)));
  const R = [[null, ...["순번", "반응 차종", "성향", "유형 구분", "주요 내용", "TOP 묶음", "판단 근거", "구분", "내용", "작성일", "작성자", "동호회 차종", "동호회명", "게시글 제목", "게시글 URL", "판단"].map((h) => ({ v: h, s: "head" }))]];
  const order = (r) => [cars.indexOf(r.car) < 0 ? 99 : cars.indexOf(r.car), TONES.indexOf(r.tone)];
  const sorted = [...rs].sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1] || (a.date ?? 0) - (b.date ?? 0));
  sorted.forEach((r, i) => {
    const text = r.c ? r.c.content : `[제목] ${r.x.title}\n${(r.x.body || r.x.text || "").slice(0, 1500)}`;
    R.push([null, num(i + 1), num(r.car), tone(r.tone), num(r.ptype), { v: r.theme, s: "wrap" }, { v: groupOf.get(r.key) || "", s: "wrap" }, { v: r.reason || "", s: "wrap" }, num(r.kind), { v: text, s: "wrap" },
      r.date ? { v: excelSerial(new Date(r.date)), s: "date" } : num(""), { v: r.c ? r.c.nickname : r.x.nickname || "", s: "cell" },
      num(r.x.car), { v: r.x.cafeName, s: "cell" }, { v: r.x.title, s: "wrap" }, { v: articleUrl(r.x), s: "cell" },
      num((r.c ? r.c.a?.by : r.x.a?.by) === "ai" ? "검토 완료" : "검토 전")]);
  });
  const raw = { name: "반응 전체", rows: R, freeze: 1, filter: "B1:Q1", widths: { 1: 2, 2: 6, 3: 10, 4: 9, 5: 16, 6: 28, 7: 26, 8: 30, 9: 8, 10: 60, 11: 16, 12: 14, 13: 10, 14: 16, 15: 30, 16: 34, 17: 6 } };

  // ④ 판단 기준 (보고용 설명)
  const C = [
    [null, { v: "코리아 세일 페스타 반응 성향 판단 기준", s: "title" }],
    [],
    [null, { v: "구분", s: "head" }, { v: "기준", s: "head" }],
    [null, { v: "대상", s: "bold" }, { v: "모니터링 기간 안에 대상 차종 동호회에 올라온 코리아 세일 페스타(K-세일 페스타·코세페·11월 할인 행사) 관련 게시글과 그 댓글·답글 (삭제 댓글 제외)", s: "wrap" }],
    [null, { v: "반응 단위", s: "bold" }, { v: "게시글·댓글 하나가 말하는 차종마다 반응 하나. 차종 이름이 없으면 그 동호회 차종에 대한 반응, 여러 차종을 말하면 차종마다 따로 판단", s: "wrap" }],
    [null, tone("긍정"), { v: "할인 혜택을 반기거나 만족, 좋은 구매 기회로 봄, 이번 할인을 계기로 구매를 알아보거나 계약함", s: "wrap" }],
    [null, tone("부정"), { v: "기존 구매자 역차별·보상 요구, 할인 폭·조건 불만, 재고 처리·실적용 할인 의심, 가격 정책·회사 불신, 구매 포기·취소 고려, 부정 의견 동조", s: "wrap" }],
    [null, tone("중립"), { v: "할인 조건·기간 정보 공유·문의, 코세페에 대한 평가가 없는 말, 회원 간 말다툼·사과·인사·응원", s: "wrap" }],
    [null, tone("단순비난"), { v: "코세페·할인에 대한 구체적 내용 없이 회사·노조·브랜드를 욕하거나 조롱만 함", s: "wrap" }],
    [null, { v: "비율", s: "bold" }, { v: "성향 비율 = 해당 차종 반응 중 비중 · TOP5 비율 = 해당 차종 긍정(부정) 반응 중 비중", s: "wrap" }],
    [null, { v: "판단 방법", s: "bold" }, { v: unjudged ? `담당자 원문 검토 (일부 ${unjudged}건은 검토 전 잠정치)` : "담당자 원문 검토", s: "wrap" }],
  ];
  C.push([null, { v: "유형 구분", s: "bold" }, { v: "글·댓글마다 글쓴이가 코세페 혜택과 어떤 관계인지 하나로 구분 (차종별이 아님)", s: "wrap" }]);
  for (const [t, , note] of PTYPES) C.push([null, { v: t, s: "center" }, { v: note, s: "wrap" }]);
  const crit = { name: "판단 기준", rows: C, noGrid: true, widths: { 1: 2, 2: 14, 3: 110 }, merges: ["B1:C1"] };
  return XlsxBook.build([summary, posts, raw, crit], { font: "맑은 고딕" });
}

// ---------------------------------------------------------------------------
// 파일 만들기: 이슈 모니터링 보고서 작성 프로그램과 같은 양식의 엑셀 4종 + 차종별 반응 요약 (+ PPT)
// [엑셀 만들기]를 누르면 모두 만들어 데이터 DB 에 오늘 파일로 저장하고, 📥 받기 버튼이 반짝이며 알림음 (누르면 받음)
// ---------------------------------------------------------------------------

const FILE_BASE = "동호회";
const fileBase = () => `${today()}_${($("#issueName").value || DEFAULT_ISSUE).replace(/[\\/:*?"<>|]/g, " ").trim()}_${FILE_BASE}`;
const CAR_COLORS = ["#002c5f", "#00809d", "#a2652a", "#6b6b45", "#7b3fe4"];
let pending = {}; // 종류 → { name, bytes } (받기 버튼을 누르면 저장)

const GET_BUTTONS = { summary: "#getSummary", posts: "#getPosts", postsSenti: "#getPostsSenti", comments: "#getComments", commentsSenti: "#getCommentsSenti", ppt: "#getPpt" };

// 받기 버튼: 파일이 준비되면 무지개빛으로 반짝이게 (누르면 멈춤)
function readyButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle("ready", !!on);
  btn.disabled = !on && !btn.dataset.keep;
}

// 완료 알림음 '딩동댕' (LX3 수집기와 같은 소리 · 설정에서 끌 수 있음)
function playChime() {
  if ($("#soundOn") && !$("#soundOn").checked) return;
  try {
    const ac = new AudioContext();
    const t0 = ac.currentTime + 0.05;
    [784, 988, 1319].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = t0 + i * 0.22;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => ac.close(), 1500);
  } catch {
    /* 소리를 못 내도 넘어감 */
  }
}

// 차종 순서 (대상 차종 → 기타 차종)
function carOrder(list) {
  const cars = targetCars();
  return [...new Set(list)].sort((a, b) => (cars.indexOf(a) < 0 ? 99 : cars.indexOf(a)) - (cars.indexOf(b) < 0 ? 99 : cars.indexOf(b)));
}

// 게시물 리스트 (이슈 보고서 양식: No · 출처 · 제목 · 작성시간 · Link)
// 로우데이터: 동호회 차종마다 시트 · 성향분석 포함: 반응 차종마다 시트(해당 차종에 대한 글의 성향)
async function makePostsFile(withSentiment = false) {
  const list = reportItems();
  const rowOf = (x, tone = "") => ({ source: x.cafeName, title: x.title, date: x.date, url: articleUrl(x), sentiment: tone, ptype: tone ? typeOf(x, `${x.title}\n${x.body || x.text || ""}`) : "" });
  const byDate = (a, b) => (b.date || 0) - (a.date || 0);
  let sheets;
  if (!withSentiment) {
    sheets = carOrder(list.map((x) => x.car)).map((car) => ({ name: car, rows: list.filter((x) => x.car === car).sort(byDate).map((x) => rowOf(x)) }));
  } else {
    const rs = reactions(list).filter((r) => !r.c);
    sheets = carOrder(rs.map((r) => r.car)).map((car) => ({
      name: car, rows: rs.filter((r) => r.car === car).map((r) => r.x).sort(byDate).map((x) => rowOf(x, postOps(x).find((o) => o.car === car)?.tone || "")),
    }));
  }
  if (!sheets.length) sheets = [{ name: "게시물", rows: [] }];
  return { name: `${fileBase()}_게시물 리스트${withSentiment ? "_성향분석 포함" : ""}.xlsx`, bytes: await buildPostsXlsx(sheets, withSentiment) };
}

// 댓글 (이슈 보고서 양식: 1행 제목 · 연번 · 출처(동호회명) · text · 작성일 · 게시글 URL (+ 유형 구분 · 성향))
// 로우데이터: 동호회 차종마다 시트(댓글 한 줄씩) · 성향 분석: 반응 차종마다 시트(댓글 × 차종 한 줄씩)
async function makeCommentsFile(withSentiment) {
  const list = reportItems();
  const rowOf = (x, c, tone = "") => ({
    source: x.cafeName, cafeUrl: `https://cafe.naver.com/${x.slug}`, text: c.content, sentiment: tone, ptype: tone ? typeOf(c, c.content) : "",
    writtenAt: c.date ? formatDateTime(new Date(c.date)) : c.dateText || "", url: articleUrl(x),
  });
  let sheets;
  if (!withSentiment) {
    const cs = reportComments(list);
    sheets = carOrder(cs.map(({ x }) => x.car)).map((car) => ({
      name: car, title: `코세페_${car} 동호회 댓글`, rows: cs.filter(({ x }) => x.car === car).map(({ x, c }) => rowOf(x, c)),
    }));
  } else {
    const rs = reactions(list).filter((r) => r.c);
    sheets = carOrder(rs.map((r) => r.car)).map((car) => ({
      name: car, title: `코세페_${car} 동호회 댓글 성향`, rows: rs.filter((r) => r.car === car).map((r) => rowOf(r.x, r.c, r.tone)),
    }));
  }
  if (!sheets.length) sheets = [{ name: "댓글", title: "코세페_동호회 댓글", rows: [] }];
  return { name: `${fileBase()}_댓글 ${withSentiment ? "성향 분석" : "raw data"}.xlsx`, bytes: await buildCommentsXlsx(sheets, withSentiment) };
}

// 대시보드 숫자 (데이터 DB 화면 맨 위 · 메일 붙여넣기용) - 요약 파일과 함께 저장
function dashSnapshot() {
  const list = reportItems();
  const rs = reactions(list);
  const stats = carStats(rs);
  const top = topThemes(rs);
  const pick = (g) => ({ label: g.label, count: g.count, ratio: g.ratio });
  const total = stats[0];
  return {
    at: Date.now(),
    start: $("#startDate").value,
    end: $("#endDate").value,
    period: periodText(),
    title: reportTitle(),
    summary: (report?.summary || []).filter(Boolean),
    headline: report?.headline || "",
    // 성향별 대표 댓글 (보고서 1페이지와 같은 것 · 초안이 없으면 자동으로 고른 것)
    short: Object.fromEntries(TONES.map((t) => [t, (typeof pptReportData === "function" ? pptReportData().short[t] : report?.short?.[t] || []).slice(0, 3)])),
    channels: typeof pptReportData === "function" ? pptReportData().channelsLabel : "",
    cafes: cafes().map((c) => ({ car: c.car, name: c.name })),
    posts: total.posts,
    comments: total.comments,
    reactions: total.n,
    tone: total.tone,
    ratio: total.ratio,
    unjudged: rs.filter((r) => !judged(r.c || r.x)).length,
    topsAi: top.fresh,
    // 유형 구분별 (글쓴이 유형): 반응 수 · 비중 · 성향 · 가장 많이 나온 여론
    types: typeStats(rs).map((t) => ({ type: t.type, n: t.n, share: t.share, tone: t.tone, ratio: t.ratio, top: t.top })),
    cars: targetCars().map((car, i) => {
      const s = stats.find((x) => x.car === car);
      return {
        car, color: CAR_COLORS[i % CAR_COLORS.length], cafes: cafes().filter((c) => c.car === car).length, cafeNames: cafes().filter((c) => c.car === car).map((c) => c.name),
        posts: s.posts, comments: s.comments, n: s.n, tone: s.tone, ratio: s.ratio,
        pos: top.cars[car]["긍정"].slice(0, TOP_N).map(pick), neg: top.cars[car]["부정"].slice(0, TOP_N).map(pick),
        posN: top.cars[car].total["긍정"], negN: top.cars[car].total["부정"],
      };
    }),
  };
}

// 엑셀 만들기: 5개 파일을 만들어 데이터 DB 에 오늘 파일로 저장 → 📥 받기 버튼 반짝 + 알림음
async function makeFiles() {
  if (running) return;
  await ensureDistinctTops();
  const list = reportItems();
  if (!list.length) return setSummary("기간 안의 체크한 글이 없습니다.", "err");
  const unread = list.filter((x) => !x.bodyRead).length;
  if (unread && !(await askConfirm(`본문·댓글을 아직 읽지 않은 글이 ${unread}개 있습니다. 이 글들의 댓글은 빠집니다.\n그대로 만들까요?`))) return;
  const rs = reactions(list);
  const unjudged = rs.filter((r) => !judged(r.c || r.x)).length;
  if (unjudged && aiOn() && !(await askConfirm(`반응 ${rs.length}개 중 ${unjudged}개는 아직 AI 로 판단하지 않은 규칙 어림입니다 (성향 칸이 어림값).\n그대로 만들까요? ([취소] 후 '💰 차종별 반응 판단하기')`))) return;
  $("#saveInfo").className = "hint";
  $("#saveInfo").textContent = "엑셀 만드는 중…";
  for (const sel of Object.values(GET_BUTTONS)) readyButton($(sel), false);
  try {
    const files = {
      summary: { name: `${fileBase()}_차종별 반응 요약.xlsx`, bytes: buildExcel() },
      posts: await makePostsFile(false),
      postsSenti: await makePostsFile(true),
      comments: await makeCommentsFile(false),
      commentsSenti: await makeCommentsFile(true),
    };
    const snap = dashSnapshot();
    const day = today();
    const sums = {
      summary: [`게시글 ${snap.posts} · 댓글 ${snap.comments} · 반응 ${snap.reactions}`, { ...snap, kind: "dash" }],
      posts: [`게시글 ${snap.posts}`, { posts: snap.posts }],
      postsSenti: [`게시글 반응 ${rs.filter((r) => !r.c).length}`, { posts: snap.posts, pos: toneCounts(rs.filter((r) => !r.c))["긍정"], neg: toneCounts(rs.filter((r) => !r.c))["부정"] }],
      comments: [`댓글 ${snap.comments}`, { comments: snap.comments }],
      commentsSenti: [`댓글 반응 ${rs.filter((r) => r.c).length}`, { comments: snap.comments, pos: toneCounts(rs.filter((r) => r.c))["긍정"], neg: toneCounts(rs.filter((r) => r.c))["부정"], blame: toneCounts(rs.filter((r) => r.c))["단순비난"] }],
    };
    let dbNote = " · 데이터 DB에 오늘 파일로 저장했습니다";
    try {
      for (const [kind, f] of Object.entries(files)) await dbSaveDay(kind, day, f.name, f.bytes, "auto", sums[kind][0], sums[kind][1]);
    } catch {
      dbNote = " · (데이터 DB 저장은 하지 못했습니다)";
    }
    pending = { ...pending, ...files };
    for (const kind of Object.keys(files)) readyButton($(GET_BUTTONS[kind]), true);
    $("#saveInfo").className = "hint ok";
    if (typeof refreshSummary === "function") await refreshSummary("엑셀과 함께");
    $("#saveInfo").textContent = `✔ 엑셀 5개를 만들었습니다 (게시글 ${list.length.toLocaleString()}개 · 댓글 ${snap.comments.toLocaleString()}개 · 반응 ${rs.length.toLocaleString()}개)${dbNote}. 반짝이는 📥 버튼을 눌러 받으세요.`;
    playChime();
  } catch (e) {
    $("#saveInfo").className = "hint err";
    $("#saveInfo").textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  }
}

// 📥 받기
async function getFile(kind) {
  const f = pending[kind];
  if (!f) return;
  readyButton($(GET_BUTTONS[kind]), false);
  $(GET_BUTTONS[kind]).disabled = false;
  const data = kind === "ppt" ? new Blob([f.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }) : f.bytes;
  const where = await saveBytes(data, f.name);
  const info = kind === "ppt" ? $("#pptInfo") : $("#saveInfo");
  info.className = "hint ok";
  info.textContent = `✔ ${where}에 ${f.name} 저장`;
}

// 보고서 PPT 3p 채우기: 사용자가 고른 보고서 PPT 를 틀로 → 📥 PPT 받기 반짝
async function savePpt() {
  if (running) return;
  await ensureDistinctTops();
  const file = $("#pptFile").files[0];
  if (!file) {
    $("#pptInfo").className = "hint err";
    $("#pptInfo").textContent = "먼저 보고서 PPT 파일(양식 3페이지 '순위·내용·개수·비율' 표가 있는 파일)을 골라 주세요.";
    return;
  }
  const top = topThemes();
  if (!top.fresh && aiOn() && (await askConfirm("주요 내용 TOP5 를 아직 AI 로 정리하지 않았습니다(같은 문구끼리 센 값).\n· [확인]: 먼저 💰 TOP5 정리하고 PPT 만들기\n· [취소]: 지금 값으로 만들기"))) {
    await groupThemes();
  }
  const t = topThemes();
  const cars = {};
  for (const car of targetCars()) cars[car] = { pos: t.cars[car]["긍정"].slice(0, TOP_N), neg: t.cars[car]["부정"].slice(0, TOP_N) };
  $("#pptInfo").className = "hint";
  $("#pptInfo").textContent = "PPT 만드는 중…";
  readyButton($("#getPpt"), false);
  try {
    if (!$("#onlySlide").checked && !report?.summary?.some(Boolean) && aiOn() &&
      (await askConfirm("1페이지 2줄 요약·대표 댓글(보고서 초안)이 아직 없습니다.\n· [확인]: 먼저 💰 AI 보고서 초안을 쓰고 PPT 만들기\n· [취소]: 요약 없이(대표 댓글은 자동으로 골라) 만들기"))) {
      await writeReport();
    }
    const { bytes, filled } = await PptFill.fill(new Uint8Array(await file.arrayBuffer()), {
      cars, title: `■ ${reportTitle()}`, onlyThis: $("#onlySlide").checked, report: pptReportData(),
    });
    const name = `${fileBase()}_차종별 반응 보고서.pptx`;
    pending.ppt = { name, bytes };
    await dbSaveDay("ppt", today(), name, bytes, "auto", `TOP5 표 ${filled.length}개`, null).catch(() => {});
    readyButton($("#getPpt"), true);
    // 프로그램이 PPT 를 새로 만들면 예전 수정본 기준은 지우고 새 데이터로
    if (typeof pptRev !== "undefined" && pptRev) {
      pptRev = null;
      await chrome.storage.local.remove("ksfPptRev").catch(() => {});
      $("#revPptState").textContent = "현재 SUMMARY 기준: 프로그램 데이터";
    }
    if (typeof refreshSummary === "function") await refreshSummary("PPT 와 함께");
    $("#pptInfo").className = "hint ok";
    $("#pptInfo").textContent = `✔ PPT 를 만들었습니다 - ${filled.join(" · ")} 채움${t.fresh ? "" : " · TOP5 는 같은 문구끼리 센 값"} · 데이터 DB 에도 저장. 반짝이는 📥 PPT 받기를 누르세요.`;
    playChime();
  } catch (e) {
    $("#pptInfo").className = "hint err";
    $("#pptInfo").textContent = `PPT 를 만들지 못했습니다: ${e.message}`;
  }
}

// 대시보드 숫자를 늘 최신으로 남겨 둔다 (데이터 DB 화면에서 '지금 작업 중인 값'으로 보여줌)
let dashTimer = null;
function saveDashSoon() {
  clearTimeout(dashTimer);
  dashTimer = setTimeout(() => chrome.storage.local.set({ ksfDashLive: dashSnapshot() }).catch(() => {}), 800);
}

// ---------------------------------------------------------------------------
// 작업 중 표시 · 로그인 · 시작
// ---------------------------------------------------------------------------

function startBusy() {
  running = true;
  stopRequested = false;
  $("#search").disabled = true;
  for (const b of document.querySelectorAll(".stopbtn")) b.disabled = false;
  updateCounts();
}

function endBusy() {
  running = false;
  hideBusy();
  $("#search").disabled = false;
  for (const b of document.querySelectorAll(".stopbtn")) b.disabled = true;
  updateCounts();
  if (typeof renderTabs === "function") renderTabs();
}

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
  $("#ver").textContent = `v${chrome.runtime.getManifest().version}`;
  await loadSettings();
  setupPanel("panelAi", !$("#aiKey").value.trim());
  const saved = await chrome.storage.local.get(["ksfItems", "ksfTops", "ksfAiSpend", "ksfDeleted"]).catch(() => ({}));
  items = saved.ksfItems || [];
  deletedKeys = new Set(saved.ksfDeleted || []);
  const sb = (await chrome.storage.local.get("ksfSkipBefore").catch(() => ({}))).ksfSkipBefore;
  if (sb === undefined) {
    const last = Math.max(0, ...items.map((x) => x.date || 0));
    if (last) {
      const d = new Date(last);
      skipBefore = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }
    await chrome.storage.local.set({ ksfSkipBefore: skipBefore }).catch(() => {});
  } else skipBefore = sb || 0;
  for (const x of items) ksfQueryHit(x);
  tops = saved.ksfTops || null;
  aiSpend = saved.ksfAiSpend || aiSpend;
  renderResults();
  if (items.length) setSummary(`지난번까지 찾은 글 ${items.length}개입니다. '게시물 찾기'를 다시 누르면 새로 찾은 글이 더해집니다.`);

  for (const id of [...SETTING_IDS, "tabFallback", "saveAsk", "onlySlide", "soundOn", "onlyNew"]) {
    const el = $(`#${id}`);
    // 글자 칸은 칸 밖을 눌러야 'change' 가 와서, 고치는 즉시(잠깐 멈추면) 적용되게 'input' 도 받는다
    if (el.tagName === "TEXTAREA") {
      let t = null;
      el.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => el.dispatchEvent(new Event("change")), 800);
      });
    }
    el.addEventListener("change", async () => {
      if (id === "searchUrl") $("#searchUrl").value = normalizeSearchUrl($("#searchUrl").value);
      await saveSettings();
      if (id === "cafeList") renderCafeInfo();
      if (["keywords", "maxPages"].includes(id)) updateJobInfo();
      if (["cafeList", "carWords"].includes(id)) renderResults();
      if (["ksfWords", "saleWords", "exclude"].includes(id)) {
        for (const x of items) {
          const j = judge(`${x.title} ${x.body || x.text}`);
          x.related = j.related;
          x.candidate = j.candidate;
          x.note = judgeNote(j);
          if (!x.touched && x.a?.by !== "ai") x.checked = j.related;
          ksfQueryHit(x);
        }
        renderResults();
        saveItemsSoon();
      }
    });
  }
  for (const id of ["startDate", "endDate"]) $(`#${id}`).addEventListener("change", () => (saveSettings(), updateJobInfo(), renderResults()));
  $("#aiKey").addEventListener("change", saveAiKey);
  $("#aiKey").addEventListener("keydown", (e) => e.key === "Enter" && saveAiKey());
  $("#aiSave").addEventListener("click", saveAiKey);
  $("#aiTest").addEventListener("click", testAiKey);
  for (const id of ["aiModel", "aiOn"]) $(`#${id}`).addEventListener("change", () => (saveSettings(), showAiStatus(), updateCounts()));
  $("#resetSettings").addEventListener("click", async () => {
    if (!(await askConfirm("동호회·검색어·관련 단어 설정을 처음 값으로 되돌릴까요?"))) return;
    for (const id of SETTING_IDS) $(`#${id}`).value = SETTING_DEFAULTS[id];
    $("#startDate").value = DEFAULT_START;
    $("#endDate").value = DEFAULT_END;
    await saveSettings();
    renderCafeInfo();
  });
  $("#search").addEventListener("click", async () => {
    const r = await loadResume("ksf");
    search(r && (await askConfirm(`중단된 게시물 찾기가 있습니다 (${r.jobs.length}개 중 ${r.next}개 완료 · 기간 ${r.start || "?"} ~ ${r.end || "?"}).\n\n· [확인]: 이어서 찾기\n· [취소]: 처음부터 다시 찾기`)) ? r : null);
  });
  for (const b of document.querySelectorAll(".stopbtn")) b.addEventListener("click", () => {
    stopRequested = true;
    for (const x of document.querySelectorAll(".stopbtn")) x.disabled = true;
    setSummary("중지하는 중… (지금 하는 것까지 마칩니다)");
  });
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
    await forgetItems(items.filter((x) => x.checked));
    items = items.filter((x) => !x.checked);
    renderResults();
    await saveItems();
  });
  $("#clearAll").addEventListener("click", async () => {
    if (!items.length || !(await askConfirm(`찾은 글 ${items.length}개(읽은 본문·댓글·판단 포함)를 모두 지울까요?\n(삭제했던 글 기록도 지워져 다음 수집 때 다시 찾습니다)`))) return;
    items = [];
    deletedKeys = new Set();
    skipBefore = 0;
    await chrome.storage.local.remove(["ksfDeleted", "ksfLastRun"]).catch(() => {});
    await chrome.storage.local.set({ ksfSkipBefore: 0 }).catch(() => {});
    tops = null;
    await chrome.storage.local.remove("ksfTops").catch(() => {});
    await clearResume("ksf");
    renderResults();
    await saveItems();
  });
  $("#readBodies").addEventListener("click", readBodies);
  $("#judge").addEventListener("click", () => judgeAll());
  $("#rejudge").addEventListener("click", async () => {
    if (await askConfirm("이미 판단한 글·댓글도 모두 처음부터 다시 판단할까요? (기준·AI 추가 규칙을 바꿨을 때)")) judgeAll({ force: true });
  });
  $("#groupTop").addEventListener("click", groupThemes);
  $("#relabelTop").addEventListener("click", relabelTops);
  $("#makeFiles").addEventListener("click", makeFiles);
  $("#savePpt").addEventListener("click", savePpt);
  // 받기: 누른 그때 폴더 쓰기 허용을 확인해 둔다 (허용 요청은 사용자 동작 안에서만 가능)
  for (const [kind, sel] of Object.entries(GET_BUTTONS)) $(sel).addEventListener("click", () => (prepareFolder(), getFile(kind)));
  $("#pickFolder").addEventListener("click", pickSaveFolder);
  $("#clearFolder").addEventListener("click", clearSaveFolder);
  renderSaveFolder();
  $("#diag").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, at: new Date().toString(), diagnostics }, null, 1)], { type: "application/json" });
    prepareFolder();
    saveBytes(blob, `${today()}_코세페_진단.json`);
  });
  window.addEventListener("focus", checkLogin);
  checkLogin();
  const r = await loadResume("ksf");
  if (r && (await askConfirm(`중단된 게시물 찾기가 있습니다 (동호회·검색어 ${r.jobs.length}개 중 ${r.next}개 완료 · ${new Date(r.at).toLocaleString()}).\n\n· [확인]: 이어서 찾기\n· [취소]: 나중에 ('게시물 찾기'를 누르면 다시 물어봄)`))) search(r);
}

function openSettingsFromHash() {
  if (location.hash !== "#settings") return;
  $("#settings").open = true;
  $("#settings").scrollIntoView({ block: "start", behavior: "smooth" });
}
window.addEventListener("hashchange", openSettingsFromHash);

init().then(openSettingsFromHash);
