// GV90 게시물 수집 화면
//  수집(언론·동호회·유튜브·커뮤니티: 이슈 모니터링 보고서 수집기) → 본문·조회수·댓글 수 확인 → 분석(AI 또는 키워드·단어 사전)
//  → 결과 표에서 확인·수정 → 엑셀 만들기(일일동향 RAW 양식 + 성향) · 데일리 DB 저장
//  자동 수집(?auto=1)·근무일 보고서(휴일 수집분 합본)·수집 기간 기본값은 온라인 오전 일일동향과 같은 규칙

const AUTO = new URLSearchParams(location.search).has("auto");
const CH_ORDER = ["언론", "유튜브", "동호회", "자동차 커뮤니티"];

let settings = null;
let items = [];
let running = false;
let stopRequested = false;
let curRange = null; // { start, end } (ms) 이번 결과의 수집 기간
let curRunId = null; // 이번 수집 회차
let mergedRunIds = []; // 결과 표에 합친 휴일 수집 회차
let pendingXlsx = null; // { bytes, name } 만든 엑셀 (저장 버튼으로 다시 저장할 때)
let dbKeys = new Set(); // 데일리 DB 에 이미 있는 글
let heartbeatTimer = null;

isWorking = () => running; // common.js: 작업 중 뒤로 가기·닫기 막기

// ---------------------------------------------------------------------------
// 기록 · 요약
// ---------------------------------------------------------------------------

function log(text, cls = "") {
  const box = $("#log");
  box.hidden = false;
  const line = el("div", { class: cls, text: `${fmtDateTime(new Date()).slice(11)} ${korMsg(text)}` });
  box.append(line);
  box.scrollTop = box.scrollHeight;
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

// 진행 신호 (백그라운드 자동 수집이 '수집 중'인지 보고, 멈춘 탭을 깨움)
function markRunning(on) {
  clearInterval(heartbeatTimer);
  if (on) {
    const beat = () => chrome.storage.local.set({ gvRunHeartbeat: { at: Date.now() } }).catch(() => {});
    beat();
    heartbeatTimer = setInterval(beat, 30000);
    chrome.runtime.sendMessage({ type: "runStarted" }).catch(() => {});
  } else {
    chrome.storage.local.remove("gvRunHeartbeat").catch(() => {});
    chrome.runtime.sendMessage({ type: "runEnded" }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "appIdle?") {
    chrome.tabs.getCurrent().then((t) => {
      if (t && t.id === msg.tabId) reply({ idle: !running });
    });
    return true;
  }
});

// ---------------------------------------------------------------------------
// 설정 화면
// ---------------------------------------------------------------------------

function fillSettingsForm(s) {
  for (const id of ["autoRunTime", "rangeStartTime", "cutoffTime", "holidays", "fileName", "saveFolder", "macFolderPath", "keywords", "cafeKeywords", "newsMaxPages", "cafeMaxPages", "speed", "apiKey"]) $(`#${id}`).value = s[id] ?? "";
  for (const id of ["autoRun", "workdayReport", "collectOnHolidays", "saveAsk", "sound", "youtubeSearch", "aiOn"]) $(`#${id}`).checked = !!s[id];
  const days = String(s.workdays || "1,2,3,4,5").split(",").map(Number);
  const box = $("#workdaysBox");
  box.querySelectorAll("label").forEach((l) => l.remove());
  "일월화수목금토".split("").forEach((d, i) => box.append(el("label", { class: "inline" }, el("input", { type: "checkbox", "data-day": i, checked: days.includes(i) }), d)));
  const sel = $("#model");
  sel.textContent = "";
  for (const [id, label] of AI_MODELS) sel.add(new Option(label, id));
  sel.value = s.model;
  $("#lexPos").value = s.lexicon.pos || "";
  $("#lexNeg").value = s.lexicon.neg || "";
  $("#lexBlame").value = s.lexicon.blame || "";
  $("#chNews").checked = s.channels.news;
  $("#chCafe").checked = s.channels.cafe;
  $("#chYoutube").checked = s.channels.youtube;
  $("#chCommunity").checked = s.channels.community;
  $("#xlsxScope").value = s.xlsxScope || "all";
  renderChannelTables();
}

function readSettingsForm(s) {
  const out = { ...s };
  for (const id of ["autoRunTime", "rangeStartTime", "cutoffTime", "holidays", "fileName", "saveFolder", "macFolderPath", "keywords", "cafeKeywords", "speed", "model"]) out[id] = $(`#${id}`).value;
  out.apiKey = $("#apiKey").value.trim();
  out.newsMaxPages = Math.max(1, Math.min(10, +$("#newsMaxPages").value || 3));
  out.cafeMaxPages = Math.max(1, Math.min(10, +$("#cafeMaxPages").value || 3));
  for (const id of ["autoRun", "workdayReport", "collectOnHolidays", "saveAsk", "sound", "youtubeSearch", "aiOn"]) out[id] = $(`#${id}`).checked;
  out.workdays = [...document.querySelectorAll("#workdaysBox input[data-day]")].filter((x) => x.checked).map((x) => x.dataset.day).join(",") || "1,2,3,4,5";
  out.lexicon = { pos: $("#lexPos").value, neg: $("#lexNeg").value, blame: $("#lexBlame").value };
  out.channels = { news: $("#chNews").checked, cafe: $("#chCafe").checked, youtube: $("#chYoutube").checked, community: $("#chCommunity").checked };
  out.xlsxScope = $("#xlsxScope").value;
  return out;
}

async function persistSettings() {
  settings = readSettingsForm(settings);
  await saveSettings(settings);
  setExtraLexicon(settings.lexicon);
  renderRangeLabel();
  updateAutoInfo();
  $("#saveWhere").textContent = await saveWhereText();
  showEstimate();
}

// 채널 표: 바꾸면 바로 저장 (설정 저장 버튼을 따로 누르지 않아도 됨)
let channelSaveTimer = null;
function saveChannels(msg = "✔ 저장했습니다") {
  clearTimeout(channelSaveTimer);
  channelSaveTimer = setTimeout(async () => {
    await saveSettings(settings);
    $("#settingsSaved").textContent = msg;
    setTimeout(() => ($("#settingsSaved").textContent = ""), 3000);
  }, 300);
  channelCounts();
}

function cellInput(obj, key, placeholder, onSave) {
  const i = el("input", { type: "text", class: "cell", placeholder, spellcheck: "false" });
  i.value = obj[key] || "";
  i.addEventListener("change", () => {
    obj[key] = i.value.trim();
    onSave?.();
    saveChannels();
  });
  return i;
}

// 끌어서 순서 바꾸기 (온라인 오전 일일동향과 같은 방식): 왼쪽 ⠿ 손잡이를 잡고 원하는 줄 위·아래로 놓는다
const dragFrom = {};
function dragRow(tr, list, i, table, rerender) {
  const handle = el("td", { class: "drag-handle", text: "⠿", title: "끌어서 순서 바꾸기" });
  handle.addEventListener("mousedown", () => (tr.draggable = true));
  tr.addEventListener("dragstart", (e) => {
    dragFrom[table] = i;
    tr.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  });
  tr.addEventListener("dragend", () => {
    tr.draggable = false;
    tr.classList.remove("dragging");
    for (const x of document.querySelectorAll(`${table} tr.drop-before, ${table} tr.drop-after`)) x.classList.remove("drop-before", "drop-after");
  });
  tr.addEventListener("dragover", (e) => {
    if (!(dragFrom[table] >= 0)) return;
    e.preventDefault();
    const r = tr.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    tr.classList.toggle("drop-after", after);
    tr.classList.toggle("drop-before", !after);
  });
  tr.addEventListener("dragleave", () => tr.classList.remove("drop-before", "drop-after"));
  tr.addEventListener("drop", (e) => {
    e.preventDefault();
    const from = dragFrom[table];
    dragFrom[table] = -1;
    if (!(from >= 0)) return;
    const r = tr.getBoundingClientRect();
    let to = i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    const [moved] = list.splice(from, 1);
    if (from < to) to--;
    list.splice(to, 0, moved);
    rerender();
    saveChannels("✔ 순서를 바꿔 저장했습니다 (이 순서대로 수집)");
  });
  return handle;
}

function renderCafeTable() {
  const s = settings;
  const tb = $("#cafeTable tbody");
  tb.textContent = "";
  s.cafes.forEach((c, i) => {
    const tr = el("tr", {});
    tb.append(tr);
    tr.append(
      dragRow(tr, s.cafes, i, "#cafeTable", renderCafeTable),
      el("td", {}, el("input", { type: "checkbox", checked: c.on !== false, onchange: (e) => { c.on = e.target.checked; saveChannels(); } })),
      el("td", {}, cellInput(c, "name", "예: 제네시스 클럽")),
      el("td", {}, cellInput(c, "slug", "예: newgenesisdh", () => { c.slug = c.slug.replace(/^https?:\/\/(m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, ""); })),
      el("td", {}, cellInput(c, "car", "예: JG1 (여러 차종이면 비움)")),
      el("td", { style: "text-align:center" }, el("input", { type: "checkbox", title: "바로 열면 안 보이는 글이 많은 카페: 네이버 검색(카페 탭)을 거쳐 들어가 읽음", checked: !!c.viaSearch, onchange: (e) => { c.viaSearch = e.target.checked; saveChannels(); } })),
      el("td", {}, el("a", { href: `https://cafe.naver.com/${c.slug}`, target: "_blank", title: "카페 열기", text: "↗" })),
      el("td", {}, el("button", { class: "small danger", text: "삭제", onclick: () => {
        if (!confirm(`'${c.name || c.slug}' 동호회를 목록에서 지울까요?`)) return;
        s.cafes.splice(i, 1);
        s.removedCafes = [...new Set([...(s.removedCafes || []), c.slug])]; // 기본 카페를 지웠으면 다시 넣지 않음
        renderCafeTable();
        saveChannels("✔ 지웠습니다");
      } })),
    );
  });
  channelCounts();
}

function renderYtTable() {
  const s = settings;
  const yb = $("#ytTable tbody");
  yb.textContent = "";
  s.youtubeChannels.forEach((c, i) => {
    const tr = el("tr", {});
    yb.append(tr);
    tr.append(
      dragRow(tr, s.youtubeChannels, i, "#ytTable", renderYtTable),
      el("td", {}, el("input", { type: "checkbox", checked: c.on !== false, onchange: (e) => { c.on = e.target.checked; saveChannels(); } })),
      el("td", {}, cellInput(c, "name", "채널 이름")),
      el("td", {}, el("a", { href: `https://www.youtube.com/channel/${c.id}`, target: "_blank", text: c.id })),
      el("td", {}, el("button", { class: "small danger", text: "삭제", onclick: () => {
        if (!confirm(`'${c.name}' 채널을 목록에서 지울까요?`)) return;
        s.youtubeChannels.splice(i, 1);
        renderYtTable();
        saveChannels("✔ 지웠습니다");
      } })),
    );
  });
  channelCounts();
}

function renderChannelTables() {
  renderCafeTable();
  renderYtTable();
  const cb = $("#communityBox");
  cb.textContent = "";
  for (const c of settings.communities) cb.append(el("label", { class: "inline" }, el("input", { type: "checkbox", checked: c.on, onchange: (e) => { c.on = e.target.checked; saveChannels(); } }), `${c.name} `, el("span", { class: "hint", text: c.url })), " ");
}

// 게시물 수집 예상 시간(초): 채널별로 화면을 여는 횟수 × 그 속도 설정의 대기 시간으로 대략 계산
function estimateCollectSec(s = settings) {
  const d = DELAYS[s.speed] || DELAYS.normal;
  const avg = (r) => (r[0] + r[1]) / 2000;
  const on = s.channels;
  const queries = searchQueries(parseKeywords(s.keywords), 30).length;
  const cafeQ = String(s.cafeKeywords || "GV90").split(/[,\n]/).filter((x) => x.trim()).length || 1;
  const parts = {};
  if (on.news) parts.언론 = queries * Math.min(s.newsMaxPages, 2) * (1.2 + avg(d.news)) + queries * 1.5 * (1.5 + avg(d.news));
  if (on.youtube) parts.유튜브 = s.youtubeChannels.filter((c) => c.on !== false).length * 1.6 + (s.youtubeSearch ? 5 * 2.6 : 0) + 8 * 2.5;
  if (on.cafe) {
    const n = s.cafes.filter((c) => c.on).length;
    parts.동호회 = n * (cafeQ * (1.4 * (6 + avg(d.page)) + avg(d.page)) + avg(d.cafeGap)) + n * 0.4 * (10 + avg(d.article));
  }
  if (on.community) parts.커뮤니티 = s.communities.filter((c) => c.on).length * 6 * (1.5 + avg(d.community));
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const big = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  return { total, parts, big: big ? big[0] : "" };
}

async function showEstimate() {
  if (!settings || running) return;
  const e = estimateCollectSec();
  const cafes = settings.cafes.filter((c) => c.on).length;
  const cafeQ = String(settings.cafeKeywords || "").split(/[,\n]/).filter((x) => x.trim()).length;
  let text = e.total
    ? `⏱ 예상 소요 시간 ${fmtDur(e.total)}${e.big === "동호회" ? ` (대부분 동호회 ${cafes}곳 × 검색어 ${cafeQ}개 — 사람 속도로 천천히 읽음)` : ""}`
    : "";
  const cp = await loadResume();
  if (cp && !running) {
    const left = estimateCollectSec(remainingSettings(settings, cp)).total;
    text += `${text ? "\n" : ""}⏸ 지난번 중지된 수집이 있습니다 (${resumeText(cp)}) — '수집 시작'을 누르면 이어서 할지 묻습니다 · 이어서 하면 ${fmtDur(left)}`;
  }
  $("#estInfo").textContent = text;
}

// ---------------------------------------------------------------------------
// 이어하기: 수집 진행 위치(끝난 채널·카페·사이트, 이미 확인한 글, 찾은 글)를 저장해 두고
//  중지·창 닫힘·오류 뒤 '수집 시작'을 누르면 멈춘 곳부터 이어서 수집
// ---------------------------------------------------------------------------

const RESUME_KEY = "gvResume";
const RESUME_KEEP_MS = 3 * 86400000;

async function loadResume() {
  const o = await chrome.storage.local.get(RESUME_KEY).catch(() => ({}));
  const cp = o && o[RESUME_KEY];
  if (!cp || !cp.range || Date.now() - (cp.at || 0) > RESUME_KEEP_MS) return null;
  return cp;
}

async function clearResume() {
  await chrome.storage.local.remove(RESUME_KEY).catch(() => {});
}

function resumeText(cp) {
  const d = cp.done || {};
  const parts = [];
  if (cp.on?.news) parts.push(`언론 ${d.news ? "끝" : "남음"}`);
  if (cp.on?.youtube) parts.push(`유튜브 ${d.youtube ? "끝" : "남음"}`);
  if (cp.on?.cafe) parts.push(`동호회 ${(d.cafes || []).length}/${cp.cafeTotal || "?"}곳 끝`);
  if (cp.on?.community) parts.push(`커뮤니티 ${(d.communities || []).length}/${cp.commTotal || "?"}곳 끝`);
  return `기간 ${fmtDateTime(new Date(cp.range.start))} ~ ${fmtDateTime(new Date(cp.range.end))} · 찾은 글 ${(cp.items || []).length}건 · ${parts.join(" · ")} · ${fmtDateTime(new Date(cp.at)).slice(5, 16)} 멈춤`;
}

// 이어할 때 남은 곳만 담은 설정 (예상 시간 계산용)
function remainingSettings(s, cp) {
  const d = cp.done || {};
  const cafes = new Set(d.cafes || []);
  const comms = new Set(d.communities || []);
  return {
    ...s,
    channels: { ...s.channels, news: s.channels.news && !d.news, youtube: s.channels.youtube && !d.youtube },
    cafes: s.cafes.filter((c) => !cafes.has(c.slug)),
    communities: s.communities.filter((c) => !comms.has(c.url)),
  };
}

function channelCounts() {
  showEstimate();
  const s = settings;
  const cafes = s.cafes.filter((c) => c.on).length;
  const yts = s.youtubeChannels.filter((c) => c.on !== false).length;
  $("#cafeCount").textContent = `${cafes}곳`;
  $("#ytCount").textContent = `채널 ${yts}개${s.youtubeSearch ? " + 검색" : ""}`;
  $("#cafeOnCount").textContent = `(${cafes}/${s.cafes.length}곳 수집)`;
  $("#ytOnCount").textContent = `(${yts}/${s.youtubeChannels.length}개 수집)`;
}

// ---------------------------------------------------------------------------
// 수집 기간 · 자동 수집 안내
// ---------------------------------------------------------------------------

function setRange(start, end) {
  $("#rangeStart").value = toLocalInput(new Date(start));
  $("#rangeEnd").value = toLocalInput(new Date(end));
}

function readRange() {
  const start = new Date($("#rangeStart").value);
  const end = new Date($("#rangeEnd").value);
  if (isNaN(start) || isNaN(end) || start >= end) throw new Error("수집 기간을 확인해 주세요 (시작이 끝보다 앞이어야 합니다)");
  return { start, end };
}

function renderRangeLabel() {
  const workday = settings.workdayReport && isWorkday(new Date(), settings);
  $("#rangeDefault").textContent = `기본값 (${workday ? "직전 근무일" : "전일"} ${settings.rangeStartTime || "07:30"} ~ 금일 ${settings.cutoffTime || "07:30"})`;
}

// 날짜가 바뀌면(화면을 밤새 열어 둔 경우 등) 수집 기간을 오늘 기준으로 다시 맞춤 (일일동향과 같음)
let rangeDay = new Date().toDateString();
function refreshRangeIfNewDay() {
  const today = new Date().toDateString();
  if (today === rangeDay || running) return;
  rangeDay = today;
  const r = defaultRange(new Date(), settings);
  setRange(r.start, r.end);
  renderRangeLabel();
  updateAutoInfo();
  log(`날짜가 바뀌어 수집 기간을 오늘 기준으로 맞췄습니다 (${fmtDateTime(r.start)} ~ ${fmtDateTime(r.end)})`);
}
setInterval(refreshRangeIfNewDay, 60 * 1000);
window.addEventListener("focus", () => refreshRangeIfNewDay());

async function updateAutoInfo() {
  const s = settings;
  const now = new Date();
  const off = dayOffReason(now, s);
  const mode = s.workdayReport ? ` · 근무일 보고서 모드${s.collectOnHolidays ? " (휴일엔 수집만, 다음 근무일에 합본)" : " (휴일엔 쉼)"}` : "";
  $("#autoInfo").textContent = s.autoRun
    ? `⏰ 자동 수집: 매일 ${s.autoRunTime}${mode} · 오늘은 ${off ? `휴일(${off})` : "근무일"}`
    : `⏰ 자동 수집: 꺼짐 (설정에서 켤 수 있음)${mode}`;
  const { gvLastReportAt = 0 } = await chrome.storage.local.get("gvLastReportAt").catch(() => ({}));
  const pend = (await pendingRuns(gvLastReportAt)).filter((r) => r.id !== curRunId && !mergedRunIds.includes(r.id));
  $("#pendingInfo").textContent = pend.length
    ? `📦 아직 엑셀에 담지 않은 수집분 ${pend.length}회 (${pend.map((r) => `${fmtDay(r.range.end)}${r.holiday ? ` ${r.holiday}` : ""} ${r.items.filter((x) => x.checked).length}건`).join(", ")}) → 근무일에 수집하면 결과 표에 합쳐집니다`
    : "";
}

async function checkLogin() {
  let ok = false;
  try {
    ok = !!(await chrome.cookies.get({ url: "https://www.naver.com/", name: "NID_AUT" }));
  } catch {}
  const box = $("#login");
  box.textContent = "";
  if (ok) box.append(el("span", { class: "hint ok", text: "✔ 네이버 로그인됨" }));
  else box.append("⚠ 네이버에 로그인돼 있지 않습니다. 카페 수집 전에 ", el("a", { href: "https://nid.naver.com/nidlogin.login", target: "_blank", text: "네이버 로그인" }), " 해 주세요. (언론·유튜브·커뮤니티는 로그인 없이 수집됩니다)");
  return ok;
}

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

function itemText(x) {
  return `${x.title || ""} ${x.body || ""} ${x.snippet || ""}`;
}

// 결과 표 한 줄 모양으로
function toItem(p, extra = {}) {
  return {
    key: p.key,
    channel: CH_NAME[p.channel] || p.channel,
    media: p.source || p.press || "",
    url: p.url,
    title: p.title || "",
    body: (p.body || "").slice(0, 3000),
    snippet: (p.snippet || "").slice(0, 800),
    date: p.date || null,
    exact: !!p.exact,
    views: p.views ?? null,
    ccount: parseCount(p.ccount),
    harsh: false,
    checked: false,
    touched: false,
    related: false,
    car: CAR_NAME,
    category: "",
    sentiment: "",
    summary: "",
    by: "",
    // 댓글 수집 때 다시 쓰는 정보
    src: { cafeSlug: p.cafeSlug || "", clubId: p.clubId || "", articleId: p.articleId || "", oid: p.oid || "", aid: p.aid || "", videoId: p.videoId || "", siteUrl: p.siteUrl || "" },
    ...extra,
  };
}

// 유튜브 검색 (최신 업로드순): 모니터링 채널 밖 영상
async function youtubeSearch(q, range) {
  const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAI%253D&hl=ko&gl=KR`);
  const data = extractJsonAfter(html, "ytInitialData");
  const out = [];
  walk(data, (k, v) => {
    if (k !== "videoRenderer" || !v || !v.videoId) return; // 쇼츠 칸(reelItemRenderer 등)은 읽지 않음
    if (/^\/shorts\//.test(v.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || "")) return false; // 쇼츠
    const parsed = parseKoreanDate(ytText(v.publishedTimeText).replace(/^스트리밍 시간:\s*/, ""));
    const place = placeInRange(parsed, { from: range.start, to: range.end });
    if (place === "older" || place === "newer") return false;
    out.push({ videoId: v.videoId, title: ytText(v.title), author: ytText(v.ownerText), snippet: ytText(v.detailedMetadataSnippets?.[0]?.snippetText || v.descriptionSnippet) });
    return false;
  });
  return out;
}

function directUrlList() {
  return String($("#directUrls").value || "").split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
}

async function collect() {
  if (running) return;
  await persistSettings();
  const s = settings;
  let range;
  try {
    range = readRange();
  } catch (e) {
    return setSummary(e.message, "err");
  }
  const on = s.channels;
  if (!on.news && !on.cafe && !on.youtube && !on.community) return setSummary("수집할 채널을 하나 이상 고르세요.", "err");
  // 지난번 중지된 수집이 있으면 이어서 할지 (자동 수집은 같은 기간이면 묻지 않고 이어서)
  let cp = await loadResume();
  if (cp) {
    const same = cp.range.end === range.end.getTime();
    const yes = AUTO ? same : confirm(`지난번 중지된 수집이 있습니다.\n${resumeText(cp)}\n\n[확인] 멈춘 곳부터 이어서 수집\n[취소] 처음부터 새로 수집`);
    if (!yes) {
      await clearResume();
      cp = null;
    } else {
      range = { start: new Date(cp.range.start), end: new Date(cp.range.end) };
      setRange(range.start, range.end);
    }
  }
  running = true;
  stopRequested = false;
  markRunning(true);
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#log").textContent = "";
  resetSaveButton($("#getList"), "📥 엑셀 저장하기");
  $("#getList").disabled = true;
  pendingXlsx = null;
  const startedAt = cp?.startedAt || Date.now();
  const isStopped = () => stopRequested;
  const delays = DELAYS[s.speed] || DELAYS.normal;
  const kw = parseKeywords(s.keywords);
  const queries = searchQueries(kw, 30);
  const range2 = { from: range.start, to: range.end };
  const found = new Map();
  // 찾는 대로 아래 결과 표에 바로 보여 줌 (일일동향처럼) · 성향은 무료 분석으로 바로 채우고, 끝나면 한 번 더 정리
  dbKeys = new Set((await allPosts()).map((p) => p.key));
  items = [];
  mergedRunIds = [];
  curRange = { start: range.start.getTime(), end: range.end.getTime() };
  setExtraLexicon(s.lexicon);
  // 진행 위치 (이어하기)
  const done = { news: false, youtube: false, cafes: [], communities: [], ...(cp?.done || {}) };
  const seen = new Set(cp?.seen || []); // 이미 확인한 글 (기간 밖·실패 포함) → 이어할 때 다시 열지 않음
  const runId = cp?.runId || `run-${Date.now()}`;
  let cpSavedAt = 0;
  const saveCp = async (force = false) => {
    if (!force && Date.now() - cpSavedAt < 10000) return;
    cpSavedAt = Date.now();
    await chrome.storage.local.set({
      [RESUME_KEY]: {
        v: 1, at: Date.now(), runId, startedAt, auto: AUTO, on: { ...on },
        range: { start: range.start.getTime(), end: range.end.getTime() },
        cafeTotal: s.cafes.filter((c) => c.on).length, commTotal: s.communities.filter((c) => c.on).length,
        done, seen: [...seen], items: items.map(serialize),
      },
    }).catch(() => {});
  };
  const check = (key) => {
    seen.add(key);
    saveCp();
  };
  let liveTimer = null;
  const liveRender = () => {
    if (liveTimer) return;
    liveTimer = setTimeout(() => {
      liveTimer = null;
      sortItems();
      renderResults();
      $("#liveInfo").textContent = running ? `⏳ 수집 중 — 지금까지 ${items.length}건 (찾는 대로 아래에 추가됩니다 · 끝나면 정리·저장)` : "";
    }, 400);
  };
  const add = (it) => {
    if (found.has(it.key)) return;
    found.set(it.key, it);
    if (it.restored) {
      items.push(it);
      return liveRender();
    }
    it.related = it.direct || mentionsCar(itemText(it)) || matchesKeywords(itemText(it), kw);
    it.checked = it.related;
    if (dbKeys.has(it.key)) {
      it.dup = true;
      it.checked = false;
    }
    Object.assign(it, ruleAnalyze(it));
    it.harsh = it.harsh || it.sentiment === "단순비난";
    items.push(it);
    liveRender();
  };
  const inRange = (ms) => !ms || (ms >= range.start.getTime() && ms < range.end.getTime());
  const errors = [];
  if (cp) {
    for (const raw of cp.items || []) add({ ...deserialize(raw), restored: true });
    log(`▶ 이어서 수집합니다 — ${resumeText(cp)}`);
  }
  const est = estimateCollectSec(cp ? remainingSettings(s, cp) : s);
  startWorkClock(est.total);
  log(`수집 시작: ${fmtDateTime(range.start)} ~ ${fmtDateTime(range.end)} · 키워드 ${queries.length}개 (${queries.slice(0, 6).join(", ")}${queries.length > 6 ? " …" : ""})`);
  log(`예상 소요 시간 ${fmtDur(est.total)} (${Object.entries(est.parts).map(([k, v]) => `${k} ${fmtDur(v)}`).join(" · ")}) — 진행하면서 위쪽 막대에 남은 시간이 보입니다`);
  if (on.cafe) await checkLogin();
  const direct = directUrlList();
  try {
    // 1) 언론
    if (on.news && !done.news && !stopRequested) {
      const nc = new NewsCollector({ delays, log, isStopped, replies: false });
      showWork("언론: 네이버 뉴스 검색 중", 0, 0);
      const cands = await nc.search(queries, range2, s.newsMaxPages);
      for (const u of direct.filter((u) => newsIds(u))) {
        const ids = newsIds(u);
        cands.push({ key: `news:${ids.oid}/${ids.aid}`, channel: "news", ...ids, url: newsUrl(ids), title: "", direct: true });
      }
      let out = 0;
      for (let i = 0; i < cands.length && !stopRequested; i++) {
        const c = cands[i];
        showWork(`언론: 기사 확인 ${i + 1}/${cands.length}`, i, cands.length);
        if (seen.has(c.key) || found.has(c.key)) continue;
        if (c.external) {
          check(c.key);
          const parsed = parseKoreanDate(c.dateText);
          const place = placeInRange(parsed, range2);
          if (place === "older" || place === "newer") {
            out++;
            continue;
          }
          add(toItem({ ...c, source: c.press || new URL(c.url).hostname.replace(/^www\./, ""), date: parsed ? parsed.date.getTime() : null, exact: !!parsed?.exact }));
          continue;
        }
        try {
          const a = await nc.readArticle(c);
          check(c.key);
          if (!c.direct && a.date && !inRange(a.date)) {
            out++;
            continue;
          }
          const n = await nc.commentCount(c).catch(() => null);
          add(toItem({ ...c, title: a.title || c.title, source: a.press || c.press || "네이버 뉴스", date: a.date, exact: a.exact, body: a.body, ccount: n }, { direct: !!c.direct }));
        } catch (e) {
          if (e instanceof StopError) throw e;
          log(`  · 기사 확인 실패 ${c.url}: ${e.message}`, "err");
        }
        await sleep(randomBetween(delays.news));
      }
      log(`언론: 기사 ${[...found.values()].filter((x) => x.channel === "언론").length}건 (기간 밖 ${out}건 제외)`);
      if (!stopRequested) {
        done.news = true;
        await saveCp(true);
      }
    }

    // 2) 유튜브: 모니터링 채널 RSS(제목·설명에 키워드) + 검색
    if (on.youtube && !done.youtube && !stopRequested) {
      const yc = new YoutubeCollector({ log, isStopped });
      const chs = s.youtubeChannels.filter((c) => c.on !== false);
      const vids = new Map();
      for (let i = 0; i < chs.length && !stopRequested; i++) {
        const ch = chs[i];
        showWork(`유튜브 채널 확인 ${i + 1}/${chs.length} · ${ch.name}`, i, chs.length);
        try {
          const { posts } = await yc.listChannel(ch, range2);
          for (const p of posts) if (matchesKeywords(`${p.title} ${p.snippet}`, kw)) vids.set(p.videoId, p);
        } catch (e) {
          errors.push(`${ch.name}: ${e.message}`);
        }
        await sleep(randomBetween([500, 1000]));
      }
      log(`유튜브: 모니터링 채널 ${chs.length}개 중 키워드 맞는 영상 ${vids.size}건`);
      if (s.youtubeSearch) {
        for (const q of queries.slice(0, 5)) {
          if (stopRequested) break;
          showWork(`유튜브 검색 "${q}"`, 0, 0);
          try {
            const hits = await youtubeSearch(q, range);
            for (const h of hits) if (!vids.has(h.videoId) && matchesKeywords(`${h.title} ${h.snippet}`, kw)) vids.set(h.videoId, { videoId: h.videoId, title: h.title, source: h.author, snippet: h.snippet, fromSearch: true });
            log(`유튜브 검색 "${q}": 기간 안 영상 ${hits.length}건`);
          } catch (e) {
            log(`유튜브 검색 "${q}" 실패: ${e.message}`, "err");
          }
          await sleep(randomBetween([800, 1500]));
        }
      }
      for (const u of direct) {
        const id = parseYoutubeId(u);
        if (id && !vids.has(id)) vids.set(id, { videoId: id, direct: true });
      }
      const list = [...vids.values()];
      let shorts = 0;
      for (let i = 0; i < list.length && !stopRequested; i++) {
        const v = list[i];
        showWork(`유튜브: 영상 확인 ${i + 1}/${list.length}`, i, list.length);
        if (seen.has(`yt:${v.videoId}`) || found.has(`yt:${v.videoId}`)) continue;
        try {
          // 쇼츠는 빼고 수집 (직접 넣은 주소는 그대로)
          if (!v.direct && (await yc.isShort(v.videoId))) {
            shorts++;
            continue;
          }
          const pg = await yc.videoPage(v.videoId);
          // 댓글 수: 영상 화면에 없으면 댓글 머리글에서 (한 번 더 요청)
          if (pg.ccount == null) pg.ccount = await yc.commentCount(pg).catch(() => null);
          check(`yt:${v.videoId}`);
          const date = v.date || pg.date;
          if (!v.direct && date && !inRange(date) && !v.date) {
            // 검색 결과의 '1일 전' 은 날짜만 알 때가 있어 영상 게시일(날짜)로 다시 확인
            const d = new Date(date);
            const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
            if (dayEnd <= range.start.getTime() || date >= range.end.getTime()) continue;
          }
          add(toItem({ key: `yt:${v.videoId}`, channel: "youtube", source: pg.author || v.source, url: `https://www.youtube.com/watch?v=${v.videoId}`, title: pg.title || v.title, date, exact: !!v.date, body: pg.description || v.snippet, views: pg.views, ccount: pg.ccount }, { direct: !!v.direct }));
        } catch (e) {
          log(`  · 영상 확인 실패 ${v.videoId}: ${e.message}`, "err");
        }
        await sleep(randomBetween([600, 1200]));
      }
      log(`유튜브: 영상 ${[...found.values()].filter((x) => x.channel === "유튜브").length}건${shorts ? ` (쇼츠 ${shorts}건 제외)` : ""}`);
      if (!stopRequested) {
        done.youtube = true;
        await saveCp(true);
      }
    }

    // 3) 동호회: 카페마다 카페 안 검색 → 글을 열어 본문·작성 시각·조회수·댓글 수
    if (on.cafe && !stopRequested) {
      const cc = new CafeCollector({ delays, log, isStopped });
      const cafes = s.cafes.filter((c) => c.on);
      const cq = String(s.cafeKeywords || "GV90").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      log(`동호회: ${cafes.length}곳 · 카페 검색어 ${cq.map((q) => `"${q}"`).join(", ")}`);
      const doneCafes = new Set(done.cafes);
      if (doneCafes.size) log(`동호회: 지난번에 끝낸 ${cafes.filter((c) => doneCafes.has(c.slug)).length}곳은 건너뜁니다`);
      let blocked = false;
      // 글 읽기 (끝나면 true, 로그인·보호조치로 막히면 false)
      const readPosts = async (posts, label, prog = (j) => [j, posts.length]) => {
        for (let j = 0; j < posts.length && !stopRequested; j++) {
          const { post, cafe } = posts[j];
          if (seen.has(post.key) || found.has(post.key)) continue;
          showWork(`${label} · 글 읽기 ${j + 1}/${posts.length}`, ...prog(j));
          let a = null;
          try {
            await cc.wait(delays.article);
            a = await cc.readArticle(post, cafe);
          } catch (e) {
            if (e instanceof StopError) throw e;
            log(`  · ${post.title || post.url}: ${e.message}`, "err");
            if (/로그인|보호조치/.test(e.message)) {
              errors.push(e.message);
              add(toItem(post, { note: "글을 열지 못함", direct: !!post.direct }));
              return false;
            }
          }
          check(post.key);
          if (a && !post.direct && a.date && a.exact && !inRange(a.date)) continue;
          add(toItem({ ...post, title: a?.title || post.title, source: a?.source || cafe.fullName || cafe.name, date: a?.date || post.date, exact: a ? a.exact : post.exact, body: a?.body || "", views: a?.views ?? post.views, ccount: a?.ccount ?? post.ccount }, { direct: !!post.direct, note: a ? "" : "글을 열지 못함" }));
        }
        return true;
      };
      for (let i = 0; i < cafes.length && !stopRequested && !blocked; i++) {
        const cafe = cafes[i];
        if (doneCafes.has(cafe.slug)) continue;
        const label = `동호회 ${i + 1}/${cafes.length} · ${cafe.name}`;
        showWork(`${label} 검색`, i, cafes.length);
        let list = [];
        try {
          list = await cc.search(cafe, cq, range2, s.cafeMaxPages, (what) => showWork(`${label} 검색 · ${what}`, i, cafes.length));
          if (list.length) log(`동호회 ${cafe.name}: 기간 안 글 ${list.length}건`);
        } catch (e) {
          if (e instanceof StopError) throw e;
          errors.push(`${cafe.name}: ${e.message}`);
          log(`동호회 ${cafe.name}: ${e.message}`, "err");
          if (/로그인|보호조치/.test(e.message)) blocked = true; // 로그인 뒤 이어서 (다른 오류는 이 카페를 넘어감)
        }
        if (list.length && !(await readPosts(list.map((post) => ({ post, cafe })), label, () => [i, cafes.length]))) blocked = true;
        if (!blocked && !stopRequested) {
          done.cafes.push(cafe.slug);
          await saveCp(true);
        }
        if (i + 1 < cafes.length && !stopRequested && !blocked) await cc.wait(delays.cafeGap);
      }
      const directPosts = [];
      for (const u of direct.filter((u) => /cafe\.naver\.com/.test(u))) {
        const fe = u.match(/cafes\/(\d+)\/articles\/(\d+)/);
        const sm = u.match(/cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/);
        const slug = sm && !/^(f-e|ca-fe)$/.test(sm[1]) ? sm[1] : "";
        const articleId = fe ? fe[2] : sm ? sm[2] : "";
        if (!articleId) continue;
        const cafe = s.cafes.find((c) => c.slug === slug) || { name: slug || "네이버 카페", slug };
        directPosts.push({ post: { key: `cafe:${slug || fe?.[1]}/${articleId}`, channel: "cafe", source: cafe.name, cafeSlug: slug, clubId: fe ? fe[1] : "", articleId, url: u, title: "", date: null, exact: false, snippet: "", direct: true }, cafe });
      }
      if (directPosts.length && !stopRequested && !blocked) await readPosts(directPosts, "동호회: 직접 넣은 글");
      log(`동호회: 글 ${[...found.values()].filter((x) => x.channel === "동호회").length}건`);
    }

    // 4) 자동차 커뮤니티: 게시판 목록에서 제목에 키워드 → 글을 받아 본문·조회수·댓글 수
    if (on.community && !stopRequested) {
      const mc = new CommunityCollector({ delays, log, isStopped });
      const sites = s.communities.filter((c) => c.on);
      for (let i = 0; i < sites.length && !stopRequested; i++) {
        const site = sites[i];
        if (done.communities.includes(site.url)) continue;
        showWork(`커뮤니티 확인 ${i + 1}/${sites.length} · ${site.name}`, i, sites.length);
        let list = [];
        try {
          list = await mc.search(site, kw, range2);
        } catch (e) {
          if (e instanceof StopError) throw e;
          errors.push(`${site.name}: ${e.message}`);
          log(`커뮤니티 ${site.name}: ${e.message}`, "err");
        }
        for (const u of direct.filter((u) => { try { return communityAdapter(u) && new URL(u).hostname.replace(/^m\./, "www.") === new URL(site.url).hostname.replace(/^m\./, "www."); } catch { return false; } })) {
          const ad = communityAdapter(site.url);
          list.push({ key: `${ad.domain}:${ad.articleId(u) || u}`, channel: "community", source: site.name, domain: ad.domain, siteUrl: site.url, url: u, title: "", date: null, exact: false, snippet: "", direct: true });
        }
        for (let j = 0; j < list.length && !stopRequested; j++) {
          const p = list[j];
          showWork(`커뮤니티 ${site.name}: 글 확인 ${j + 1}/${list.length}`, j, list.length);
          if (seen.has(p.key) || found.has(p.key)) continue;
          const info = await readCommunityInfo(p).catch(() => null);
          check(p.key);
          add(toItem({ ...p, body: info?.body || "", date: info?.date || p.date, exact: info?.date ? true : p.exact, views: info?.views ?? null, ccount: info?.ccount ?? p.ccount }, { direct: !!p.direct, title: info?.title || p.title }));
          await mc.wait(delays.community);
        }
        if (!stopRequested) {
          done.communities.push(site.url);
          await saveCp(true);
        }
      }
      log(`커뮤니티: 글 ${[...found.values()].filter((x) => x.channel === "자동차 커뮤니티").length}건`);
    }
  } catch (e) {
    if (!(e instanceof StopError)) log(`수집 중 오류: ${e.message}`, "err");
  }
  // 다 돌았으면 진행 위치를 지우고, 중지·오류로 멈췄으면 남겨 둠 → 다음 '수집 시작'에서 이어서
  const finished = !stopRequested && (!on.news || done.news) && (!on.youtube || done.youtube) &&
    (!on.cafe || s.cafes.filter((c) => c.on).every((c) => done.cafes.includes(c.slug))) &&
    (!on.community || s.communities.filter((c) => c.on).every((c) => done.communities.includes(c.url)));
  const incomplete = stopRequested || !finished;
  if (incomplete) await saveCp(true);
  else await clearResume();

  // 관련성 (키워드): 제목·본문에 GV90 키워드가 있으면 체크
  const fresh = items.slice(); // 수집 중에 표에서 지운 글은 다시 넣지 않음
  clearTimeout(liveTimer);
  liveTimer = null;
  $("#liveInfo").textContent = "";
  for (const x of fresh) {
    delete x.restored;
    x.related = x.direct || mentionsCar(itemText(x)) || matchesKeywords(itemText(x), kw);
    if (!x.touched) x.checked = x.related; // 수집 중에 표에서 직접 바꾼 체크는 그대로
  }
  // 데일리 DB 에 이미 있는 글은 체크 해제 (지난 보고에 들어감)
  dbKeys = new Set((await allPosts()).map((p) => p.key));
  for (const x of fresh) if (dbKeys.has(x.key)) {
    x.dup = true;
    if (!x.touched) x.checked = false;
  }
  items = fresh;
  curRange = { start: range.start.getTime(), end: range.end.getTime() };
  mergedRunIds = [];
  log(`찾은 후보 게시글 ${items.length}건 (${CH_ORDER.map((c) => `${c} ${items.filter((x) => x.channel === c).length}`).join(" · ")})`);

  // 분석
  if (!stopRequested) await analyze(items.filter((x) => !x.dup), { auto: AUTO });
  else for (const x of items) Object.assign(x, { ...ruleAnalyze(x), ...pickEdited(x) });

  // 수집 회차로 남김 (휴일 수집분은 다음 근무일에 합침)
  const off = s.workdayReport ? dayOffReason(new Date(), s) : "";
  curRunId = runId; // 이어서 한 수집은 같은 회차로 덮어씀 (중지 회차가 따로 남아 겹치지 않게)
  await saveRun({ id: curRunId, startedAt, finishedAt: Date.now(), range: curRange, auto: AUTO, holiday: off, stopped: stopRequested, items: items.map(serialize), errors });

  // 근무일이면 아직 엑셀에 담지 않은 휴일 수집분을 합친다
  if (!off && s.workdayReport && !stopRequested) await mergePending();

  hideWork();
  running = false;
  markRunning(false);
  $("#start").disabled = false;
  $("#stop").disabled = true;
  sortItems();
  renderResults();
  await saveLast();
  updateAutoInfo();
  showEstimate();
  const checked = items.filter((x) => x.checked).length;
  setSummary(
    `${stopRequested ? "중지됨 — " : ""}후보 ${items.length}건 중 GV90 관련 게시물 ${checked}건을 체크했습니다${mergedRunIds.length ? ` (휴일 수집분 ${mergedRunIds.length}회 합침)` : ""}.` +
      (errors.length ? ` 못 읽은 곳 ${errors.length}곳 — 수집 기록 참고.` : "") +
      (incomplete ? " ⏸ 아직 남은 곳이 있습니다 — '수집 시작'을 다시 누르면 멈춘 곳부터 이어서 합니다." : "") +
      " 필요 없는 글은 체크를 풀고 '엑셀 만들기'를 누르세요.",
    errors.length ? "err" : "ok",
  );
  if (!stopRequested) celebrate(null);
  return { off, errors };
}

// 커뮤니티 글 화면: 제목·본문·작성 시각·조회수·댓글 수 (댓글 본문은 읽지 않음 — 댓글 수집 단계에서)
// 본문 글자만: 스크립트·스타일·동영상 대체 문구("Your browser does not support the video tag") 등은 빼고 읽음
function bodyTextOf(e) {
  if (!e) return "";
  const c = e.cloneNode(true);
  c.querySelectorAll("script, style, noscript, template, video, audio, iframe, object, embed, svg, canvas, button, select").forEach((x) => x.remove());
  return textOf(c);
}

async function readCommunityInfo(post) {
  const ad = communityAdapter(post.siteUrl || post.url);
  const doc = await fetchDocument(post.url);
  let body = "";
  for (const sel of ad.bodySelectors || []) {
    const t = bodyTextOf(doc.querySelector(sel));
    if (t) {
      body = t;
      break;
    }
  }
  const full = textOf(doc.body);
  let date = null;
  for (const t of [...(ad.dateSelectors || []).map((x) => textOf(doc.querySelector(x))).filter(Boolean), full.slice(0, 6000)]) {
    const m = t.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})[^\d]{0,12}(\d{1,2}):(\d{2})/);
    if (m) {
      date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
      break;
    }
  }
  const t0 = post.title ? full.indexOf(post.title.slice(0, 12)) : -1;
  const near = t0 >= 0 ? full.slice(Math.max(0, t0 - 300), t0 + 3000) : full.slice(0, 8000);
  const vm = near.match(/조회(?:수)?\s*[:：]?\s*(\d[\d,]*)/) || full.match(/조회(?:수)?\s*[:：]?\s*(\d[\d,]*)/);
  const views = vm ? +vm[1].replace(/,/g, "") : null;
  // 이 글의 댓글 수: 제목 옆 [N] → 목록의 댓글 수 → 본문 근처 '댓글 N' (작성자 정보 줄의 총 댓글 수는 빼고 · 조회수보다 큰 수는 버림)
  const ccount = articleCommentCount(doc, ad, { listCount: post.ccount ?? null, views, title: post.title });
  return { title: post.title, body: body.slice(0, 3000), date, views, ccount };
}

// 표에서 직접 고친 값 (다시 분석해도 그대로 둠)
function pickEdited(x) {
  const out = {};
  for (const k of x.edited || []) out[k] = x[k];
  return out;
}

// 분석: 규칙(단어 사전) 먼저, AI 를 쓸 수 있으면 AI 로 관련성·구분·성향·주요 내용
async function analyze(list, { auto = false, forceAi = false } = {}) {
  setExtraLexicon(settings.lexicon);
  for (const x of list) {
    Object.assign(x, ruleAnalyze(x), pickEdited(x));
    x.harsh = x.harsh || x.sentiment === "단순비난";
  }
  const useAi = (settings.aiOn || forceAi) && settings.apiKey && typeof Anthropic !== "undefined";
  if (!useAi || !list.length) {
    if (forceAi && !settings.apiKey) setSummary("설정에 Claude API 키를 넣어 주세요.", "err");
    renderResults();
    return;
  }
  const model = settings.model;
  if (!auto) {
    const est = aiEstimate(list, model);
    if (!confirm(`게시물 ${list.length}건을 Claude AI 로 판독합니다 (관련성 · 구분 · 성향 · 주요 내용).\n예상 비용 ${fmtWon(est)} · 예상 소요 시간 ${fmtDur(Math.ceil(list.length / AI_BATCH / AI_PARALLEL) * 30)} · ${AI_MODELS.find(([id]) => id === model)?.[1] || model}\n\n계속할까요? ([취소]를 누르면 무료 분석 결과로 둡니다)`)) return;
  }
  startWorkClock(Math.ceil(list.length / AI_BATCH / AI_PARALLEL) * 30);
  showWork(`AI 판독 중 (0/${Math.ceil(list.length / AI_BATCH)}묶음)`, 0, 0);
  const res = await aiAnalyze(list, {
    apiKey: settings.apiKey,
    model,
    isStopped: () => stopRequested,
    onProgress: (done, total) => showWork(`AI 판독 중 (${done}/${total}묶음)`, done, total),
    onResult: (x, r) => {
      const edited = pickEdited(x);
      x.category = r.category;
      x.sentiment = r.sentiment;
      x.summary = r.summary || x.summary;
      x.by = "ai";
      x.related = r.related;
      x.harsh = x.harsh || r.sentiment === "단순비난";
      if (!x.touched && !x.dup) x.checked = r.related || !!x.direct;
      Object.assign(x, edited);
    },
  });
  hideWork();
  if (res.fatal) log(`AI 판독 실패: ${res.fatal} → 무료 분석 결과로 둡니다`, "err");
  else log(`AI 판독 완료: ${list.length - res.failed}건 · 비용 ${fmtWon(res.usage.won)}${res.failed ? ` · 실패 ${res.failed}건(무료 분석 결과)` : ""}`);
  renderResults();
}

// 아직 엑셀에 담지 않은 수집 회차(휴일 수집분)를 결과 표에 합친다 (같은 글은 처음 것만)
async function mergePending() {
  const { gvLastReportAt = 0 } = await chrome.storage.local.get("gvLastReportAt").catch(() => ({}));
  const runs = (await pendingRuns(gvLastReportAt)).filter((r) => r.id !== curRunId);
  if (!runs.length) return;
  const have = new Set(items.map((x) => x.key));
  let added = 0;
  for (const r of runs) {
    for (const raw of r.items) {
      const x = deserialize(raw);
      if (have.has(x.key)) continue;
      have.add(x.key);
      x.fromRun = `${fmtDay(r.range.end)}${r.holiday ? ` ${r.holiday}` : ""} 수집`;
      if (dbKeys.has(x.key)) {
        x.dup = true;
        x.checked = false;
      }
      items.push(x);
      added++;
    }
    curRange = { start: Math.min(curRange.start, r.range.start), end: Math.max(curRange.end, r.range.end) };
  }
  mergedRunIds = runs.map((r) => r.id);
  log(`근무일 보고서: 아직 엑셀에 담지 않은 수집분 ${runs.length}회(${runs.map((r) => `${fmtDay(r.range.end)}${r.holiday ? ` ${r.holiday}` : ""}`).join(", ")})에서 ${added}건을 합쳤습니다`);
}

// ---------------------------------------------------------------------------
// 결과 표
// ---------------------------------------------------------------------------

const serialize = (x) => ({ ...x });
const deserialize = (x) => ({ ...x });

function sortItems() {
  items.sort((a, b) => CH_ORDER.indexOf(a.channel) - CH_ORDER.indexOf(b.channel) || (a.date || 0) - (b.date || 0));
}

function visibleItems() {
  const f = $("#filter").value;
  return items.filter((x) =>
    !f ? true : f === "checked" ? x.checked : f === "neg" ? x.sentiment === "부정" || x.sentiment === "단순비난" : f === "hot" ? isHot(x) : f === "new" ? !x.dup : true,
  );
}

function markEdited(x, field) {
  x.edited = [...new Set([...(x.edited || []), field])];
  x.by = x.by === "ai" ? "ai+edit" : "edit";
}

function renderResults() {
  $("#resultBox").hidden = !items.length;
  const tb = $("#results tbody");
  tb.textContent = "";
  for (const x of visibleItems()) {
    const tr = el("tr", { class: `${x.checked ? "" : "off"} ${x.dup ? "dup" : ""}` });
    const cb = el("input", { type: "checkbox", checked: x.checked, onchange: (e) => { x.checked = e.target.checked; x.touched = true; tr.classList.toggle("off", !x.checked); updateCounts(); saveLast(); } });
    const sum = el("input", { type: "text", class: "sum", title: x.title ? `제목: ${x.title}` : "", onchange: (e) => { x.summary = e.target.value; markEdited(x, "summary"); saveLast(); } });
    sum.value = x.summary || "";
    const cat = categorySelect(x.category, (v) => {
      x.category = v;
      markEdited(x, "category");
      saveLast();
    });
    const sen = el("select", { class: `senti ${SENTI_CLASS[x.sentiment] || "neu"}`, onchange: (e) => { x.sentiment = e.target.value; sen.className = `senti ${SENTI_CLASS[x.sentiment]}`; markEdited(x, "sentiment"); saveLast(); updateCounts(); } });
    for (const v of SENTIMENTS) sen.add(new Option(v, v));
    sen.value = x.sentiment || "중립";
    const notes = [];
    if (String(x.by || "").startsWith("ai")) notes.push(el("span", { class: "badge ai", text: "AI" }));
    if (x.dup) notes.push(el("span", { class: "badge dup", text: "이미 DB" }));
    else notes.push(el("span", { class: "badge new", text: "새 글" }));
    if (x.fromRun) notes.push(el("span", { class: "hint", text: ` ${x.fromRun.replace(/ 수집$/, "")}` }));
    if (x.note) notes.push(el("span", { class: "hint err", text: ` ${x.note}` }));
    if (!x.related && !x.direct) notes.push(el("span", { class: "hint", text: " 키워드 없음" }));
    const noteTitle = [x.dup ? "이미 데일리 DB 에 있는 글 (지난 보고에 들어감)" : "새 글", String(x.by || "").startsWith("ai") ? "AI 판독" : "", x.fromRun || "", x.note || "", !x.related && !x.direct ? "제목·본문에 GV90 키워드 없음" : ""].filter(Boolean).join(" · ");
    tr.append(
      el("td", {}, cb),
      el("td", {}, chChip(x.channel)),
      el("td", { class: "clip", title: x.media, text: x.media }),
      el("td", { class: "nowrap", text: x.date ? fmtDateTime(x.date).slice(5, x.exact ? 16 : 10) : "-" }),
      el("td", { class: "clip", title: x.title || "" }, el("span", { class: "title", text: x.title || "(제목 없음)" })),
      el("td", { class: "url clip", title: x.url }, countsBadge(x), el("a", { href: x.url, target: "_blank", text: x.url.replace(/^https?:\/\/(www\.)?/, "") })),
      el("td", {}, sum),
      el("td", {}, cat),
      el("td", {}, sen),
      el("td", { class: "clip notes", title: noteTitle }, ...notes),
      el("td", {}, el("button", { class: "small danger", text: "✕", title: "목록에서 지우기", onclick: () => { items = items.filter((y) => y !== x); renderResults(); saveLast(); } })),
    );
    tb.append(tr);
  }
  updateCounts();
}

function updateCounts() {
  const c = items.filter((x) => x.checked);
  const bySent = SENTIMENTS.map((sx) => `${sx} ${c.filter((x) => x.sentiment === sx).length}`).join(" · ");
  $("#resultCount").textContent = `전체 ${items.length}건 · 체크 ${c.length}건 (${CH_ORDER.map((ch) => `${ch} ${c.filter((x) => x.channel === ch).length}`).join(" · ")}) · 성향: ${bySent} · 🔥/조회·댓글 많은 글 ${c.filter(isHot).length}건`;
  $("#saveList").disabled = !c.length || running;
  $("#checkAll").checked = items.length && c.length === items.length;
}

async function saveLast() {
  await chrome.storage.local.set({ gvLastResult: { items, curRange, curRunId, mergedRunIds, at: Date.now() } }).catch(() => {});
}

// 예전 버전에서 본문에 섞여 들어온 코드·동영상 문구·링크가 주요 내용에 있으면 무료 요약을 다시 만듦 (직접 고친 값은 그대로)
function fixDirtySummaries() {
  let n = 0;
  for (const x of items) {
    if ((x.edited || []).includes("summary")) continue;
    const dirty = (t) => /window\.onload|\$\(\s*document|function\s*\(|Your browser does not support|https?:\/\//i.test(t || "");
    if (!dirty(x.summary) && !dirty(x.body)) continue;
    x.body = cleanBody(x.body);
    if (!x.by || x.by === "rule" || dirty(x.summary)) x.summary = ruleSummary({ title: x.title, body: x.body });
    n++;
  }
  return n;
}

async function restoreLast() {
  const { gvLastResult } = await chrome.storage.local.get("gvLastResult").catch(() => ({}));
  if (!gvLastResult || !gvLastResult.items?.length || Date.now() - gvLastResult.at > 3 * 86400000) return;
  ({ items, curRange, curRunId, mergedRunIds } = { mergedRunIds: [], ...gvLastResult });
  fixDirtySummaries();
  dbKeys = new Set((await allPosts()).map((p) => p.key));
  renderResults();
  setSummary(`지난 결과 ${items.length}건을 불러왔습니다 (${fmtDateTime(gvLastResult.at)} 수집).`);
}

// ---------------------------------------------------------------------------
// 엑셀 만들기 · 데일리 DB 저장
// ---------------------------------------------------------------------------

async function makeExcel({ interactive = true } = {}) {
  await persistSettings();
  const s = settings;
  const chosen = items.filter((x) => x.checked);
  if (!chosen.length) return null;
  $("#saveList").disabled = true;
  const day = todayKey();
  // 데일리 DB 저장 (이미 있는 글은 연번·보고일 그대로, 분석값만 갱신)
  const toSave = chosen.map((x) => ({ ...x, body: (x.body || "").slice(0, 2000), day }));
  const res = await savePosts(toSave, day);
  const fileName = reportFileName(s, curRange ? new Date(curRange.end) : new Date());
  await refreshDay(day, { from: curRange?.start ?? null, to: curRange?.end ?? null, fileName, keepEmpty: true });
  dbKeys = new Set((await allPosts()).map((p) => p.key));
  // 엑셀
  const posts = s.xlsxScope === "today" ? await postsOfDay(day) : await allPosts();
  const daily = (await listDays()).slice().reverse();
  const bytes = Gv90Xlsx.buildRaw({ posts, daily });
  await saveDayFile(day, fileName, bytes);
  await markRunsReported([curRunId, ...mergedRunIds].filter(Boolean));
  await chrome.storage.local.set({ gvLastReportAt: Date.now() });
  for (const x of chosen) x.dup = true;
  pendingXlsx = { bytes, name: fileName };
  let where = "";
  try {
    where = await saveFile(bytes, fileName, { interactive });
    $("#saveInfo").textContent = `✔ 데일리 DB 저장(새 글 ${res.added}건 · 고친 글 ${res.updated}건) · 엑셀(${s.xlsxScope === "today" ? "이번 보고분" : `누적 ${posts.length}건`})을 ${where} 바로 저장했습니다.`;
    $("#saveInfo").className = "hint ok";
    markSaved($("#getList"), "✔ 엑셀 저장 완료!", where);
  } catch (e) {
    $("#saveInfo").textContent = `엑셀은 만들었지만 저장하지 못했습니다 (${e.message}) → '📥 엑셀 저장하기'를 눌러 주세요`;
    $("#saveInfo").className = "hint err";
    resetSaveButton($("#getList"), "📥 엑셀 저장하기");
    readyButton($("#getList"), true);
  }
  await showDiffs(day);
  renderResults();
  await saveLast();
  updateAutoInfo();
  celebrate($("#getList"));
  return where;
}

// 전일(바로 전 보고일) 대비 증감
async function showDiffs(day) {
  const days = await listDays();
  const i = days.findIndex((d) => d.day === day);
  const box = $("#diffs");
  box.textContent = "";
  if (i < 0) return (box.hidden = true);
  const d = days[i];
  const prev = days[i + 1];
  const line = (label, now, before) => {
    const diff = before == null ? null : now - before;
    return el("span", {}, `${label} ${now.toLocaleString()}건 `, diff == null ? el("span", { class: "diff none", text: "(전 기록 없음)" }) : el("span", { class: `diff ${diff > 0 ? "up" : diff < 0 ? "down" : "none"}`, text: diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : "– 0" }));
  };
  const bad = (x) => (x?.stats?.bySentiment?.부정 || 0) + (x?.stats?.bySentiment?.단순비난 || 0);
  box.append(
    el("b", { text: `${prettyDay(day)} 보고` }),
    line("게시물", d.stats.posts, prev ? prev.stats.posts : null),
    line("부정+단순비난", bad(d), prev ? bad(prev) : null),
    ...CH_ORDER.map((c) => line(c, d.stats.byChannel?.[c] || 0, prev ? prev.stats.byChannel?.[c] || 0 : null)),
  );
  box.hidden = false;
}

// ---------------------------------------------------------------------------
// 자동 수집 (온라인 오전 일일동향과 같은 흐름)
// ---------------------------------------------------------------------------

async function runAuto() {
  const s = settings;
  const now = new Date();
  const off = s.workdayReport ? dayOffReason(now, s) : "";
  if (off && !s.collectOnHolidays) return;
  // 기간: 지난 자동 수집이 끝난 시각부터 (7일 넘게 비었으면 기본값) ~ 금일 끝 시각
  const def = defaultRange(now, s);
  const { gvLastAutoRangeEnd = 0 } = await chrome.storage.local.get("gvLastAutoRangeEnd").catch(() => ({}));
  const start = gvLastAutoRangeEnd && gvLastAutoRangeEnd < def.end.getTime() && def.end.getTime() - gvLastAutoRangeEnd <= 7 * 86400000 ? new Date(gvLastAutoRangeEnd) : def.start;
  setRange(start, def.end);
  log(`자동 수집을 시작합니다 (${fmtDateTime(start)} ~ ${fmtDateTime(def.end)}${off ? ` · 오늘은 ${off}: 수집만 해 두고 다음 근무일 엑셀에 합칩니다` : ""})`);
  let result;
  try {
    result = await collect();
  } catch (e) {
    chrome.runtime.sendMessage({ type: "autoRunDone", ok: false, message: `수집 중 오류: ${korMsg(e.message)}` }).catch(() => {});
    return;
  }
  await chrome.storage.local.set({ gvLastAutoRangeEnd: def.end.getTime() }).catch(() => {});
  const count = items.filter((x) => x.checked).length;
  if (off) {
    log(`오늘은 ${off} → 엑셀은 받지 않고 데일리 DB 수집 기록에 저장했습니다. 다음 근무일 아침 엑셀에 합쳐집니다.`);
    chrome.runtime.sendMessage({ type: "autoRunDone", count, holiday: off }).catch(() => {});
    return;
  }
  let where = "";
  try {
    if (count) where = await makeExcel({ interactive: false });
    else log("체크된 GV90 관련 게시물이 없어 엑셀을 만들지 않았습니다");
  } catch (e) {
    log(`엑셀 저장 실패: ${e.message}`, "err");
  }
  chrome.runtime.sendMessage({ type: "autoRunDone", count, where, message: count ? undefined : "새 GV90 관련 게시물이 없습니다." }).catch(() => {});
}

// ---------------------------------------------------------------------------
// 화면 준비
// ---------------------------------------------------------------------------

async function init() {
  settings = await loadSettings();
  setExtraLexicon(settings.lexicon);
  fillSettingsForm(settings);
  const r = defaultRange(new Date(), settings);
  setRange(r.start, r.end);
  renderRangeLabel();
  await updateAutoInfo();
  await checkLogin();
  $("#saveWhere").textContent = await saveWhereText();
  const dir = await getSaveDir();
  $("#saveDirName").textContent = dir ? `📁 ${dir.name} (고른 폴더에 바로 저장)` : "고른 폴더 없음 → 크롬 다운로드 폴더에 저장";
  $("#saveDirClear").hidden = !dir;
  if (location.hash === "#settings") $("#settings").open = true;
  if (AUTO) await runAuto();
  else await restoreLast();
}

$("#start").addEventListener("click", () => collect().catch((e) => {
  log(`오류: ${e.message}`, "err");
  running = false;
  markRunning(false);
  hideWork();
  $("#start").disabled = false;
  $("#stop").disabled = true;
}));
$("#stop").addEventListener("click", () => {
  stopRequested = true;
  $("#stop").disabled = true;
  setSummary("중지하는 중… (지금까지 모은 결과로 정리하고 진행 위치를 저장합니다 — 다음에 '수집 시작'을 누르면 이어서 할 수 있습니다)");
});
$("#rangeDefault").addEventListener("click", () => {
  const r = defaultRange(new Date(), settings);
  setRange(r.start, r.end);
});
$("#saveRangeDefault").addEventListener("click", async () => {
  const hm = (v) => (String(v || "").match(/T(\d{2}:\d{2})/) || [])[1];
  const st = hm($("#rangeStart").value);
  const en = hm($("#rangeEnd").value);
  if (!st || !en) return ($("#rangeSaved").textContent = "시작·끝 시각을 먼저 입력해 주세요");
  $("#rangeStartTime").value = st;
  $("#cutoffTime").value = en;
  await persistSettings();
  $("#rangeSaved").textContent = `저장했습니다: 다음부터 전일 ${st} ~ 금일 ${en}`;
});
$("#copyLog").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`GV90 수집 ${chrome.runtime.getManifest().version}\n${$("#summary").textContent}\n${$("#log").innerText}`);
    $("#copyResult").textContent = "복사했습니다. 메신저 등에 붙여넣어 보내 주세요.";
  } catch {
    $("#copyResult").textContent = "복사하지 못했습니다";
  }
});
$("#openSettings").addEventListener("click", (e) => {
  e.preventDefault();
  $("#settings").open = true;
  $("#settings").scrollIntoView({ behavior: "smooth" });
});

// 결과 표 버튼
$("#selAll").addEventListener("click", () => { items.forEach((x) => { x.checked = true; x.touched = true; }); renderResults(); saveLast(); });
$("#selNone").addEventListener("click", () => { items.forEach((x) => { x.checked = false; x.touched = true; }); renderResults(); saveLast(); });
$("#checkAll").addEventListener("change", (e) => { items.forEach((x) => { x.checked = e.target.checked; x.touched = true; }); renderResults(); saveLast(); });
$("#selDelete").addEventListener("click", () => {
  const n = items.filter((x) => x.checked).length;
  if (!n || !confirm(`체크한 글 ${n}건을 목록에서 지울까요?`)) return;
  items = items.filter((x) => !x.checked);
  renderResults();
  saveLast();
});
$("#unselDelete").addEventListener("click", () => {
  const n = items.filter((x) => !x.checked).length;
  if (!n) return setSummary("체크 안 된 글이 없습니다.");
  if (!confirm(`체크 안 된 글 ${n}건을 결과 표에서 지울까요?\n(체크한 글 ${items.length - n}건만 남습니다 · 데일리 DB 에 저장된 글은 지워지지 않습니다)`)) return;
  items = items.filter((x) => x.checked);
  renderResults();
  saveLast();
  setSummary(`체크 안 된 글 ${n}건을 지웠습니다. 남은 글 ${items.length}건.`, "ok");
});
$("#filter").addEventListener("change", renderResults);
$("#analyzeRule").addEventListener("click", async () => {
  await persistSettings();
  fixDirtySummaries();
  for (const x of items) {
    Object.assign(x, ruleAnalyze(x), pickEdited(x));
    if (!x.touched && !x.dup) x.checked = x.related || !!x.direct;
  }
  renderResults();
  saveLast();
  setSummary("무료 분석(단어 사전)으로 다시 분석했습니다 (표에서 직접 고친 값은 그대로).", "ok");
});
$("#analyzeAi").addEventListener("click", async () => {
  await persistSettings();
  if (!settings.apiKey) {
    $("#settings").open = true;
    return setSummary("설정의 'Claude AI 판독'에 API 키를 넣어 주세요.", "err");
  }
  running = true;
  stopRequested = false;
  $("#analyzeAi").disabled = true;
  try {
    // 이미 AI 로 분석한 글은 빼고 (지난번 실패해 무료 분석으로 남은 글만 다시 · 비용 아낌)
    let list = items.filter((x) => !x.dup);
    const fresh = list.filter((x) => !String(x.by || "").startsWith("ai"));
    if (fresh.length && fresh.length < list.length && confirm(`AI 분석이 아직 안 된 글 ${fresh.length}건만 분석할까요?\n(이미 AI 로 분석한 ${list.length - fresh.length}건은 그대로 둡니다 · [취소]는 모두 다시)`)) list = fresh;
    await analyze(list, { forceAi: true });
  } finally {
    running = false;
    $("#analyzeAi").disabled = false;
    saveLast();
    celebrate(null);
  }
});
$("#saveList").addEventListener("click", () => prepareSaveDir().then(() => makeExcel()).catch((e) => {
  $("#saveInfo").textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  $("#saveInfo").className = "hint err";
  $("#saveList").disabled = false;
}));
$("#getList").addEventListener("click", async () => {
  if (!pendingXlsx) {
    const f = await getDayFile(todayKey());
    if (f) pendingXlsx = { bytes: f.bytes, name: f.name };
  }
  if (!pendingXlsx) return;
  if (!confirmResave($("#getList"))) return;
  const where = await saveFile(pendingXlsx.bytes, pendingXlsx.name);
  $("#saveInfo").textContent = `✔ ${where} 저장했습니다.`;
  markSaved($("#getList"), "✔ 엑셀 저장 완료!", where);
  Celebrate.done($("#getList"));
});
$("#xlsxScope").addEventListener("change", persistSettings);
for (const id of ["chNews", "chCafe", "chYoutube", "chCommunity"]) $(`#${id}`).addEventListener("change", persistSettings);

// 설정 버튼
$("#saveSettings").addEventListener("click", async () => {
  await persistSettings();
  $("#settingsSaved").textContent = "✔ 저장했습니다";
  setTimeout(() => ($("#settingsSaved").textContent = ""), 3000);
});
$("#resetSettings").addEventListener("click", async () => {
  if (!confirm("설정을 처음 값으로 되돌릴까요? (API 키·저장 폴더는 그대로 둡니다)")) return;
  const keep = { apiKey: settings.apiKey };
  await chrome.storage.local.remove("gvSettings");
  settings = { ...(await loadSettings()), ...keep };
  await saveSettings(settings);
  fillSettingsForm(settings);
  renderRangeLabel();
  updateAutoInfo();
});
$("#pingHelper").addEventListener("click", async () => {
  const info = $("#pingHelperInfo");
  info.className = "hint";
  info.textContent = "확인 중…";
  const r = await chrome.runtime.sendMessage({ type: "gvPingHelper" }).catch((e) => ({ ok: false, error: e.message }));
  if (r?.ok) {
    info.className = "hint ok";
    info.textContent = `✔ 연결됨 (도우미 버전 ${r.version}) — 저장할 때마다 '출처' 정보를 지웁니다.`;
  } else {
    info.className = "hint err";
    info.textContent = r?.version
      ? `⚠ 도우미가 예전 버전(${r.version})입니다. '빠른다운로드_도우미설치.app'을 다시 실행해 주세요.`
      : `⚠ 연결 안 됨 — 이 확장의 ID ${r?.id || chrome.runtime.id} 가 도우미에 등록되어 있지 않거나 도우미가 없습니다. GV90수집기 압축 안의 '빠른다운로드_도우미설치.app'(1.4.7 이상)을 실행한 뒤, chrome://extensions 에서 GV90 수집기를 새로고침(↻)하세요. (${r?.error || ""})`;
  }
});
$("#saveDirPick").addEventListener("click", async () => {
  try {
    const d = await pickSaveDir();
    $("#saveDirName").textContent = `📁 ${d.name} (고른 폴더에 바로 저장)`;
    $("#saveDirClear").hidden = false;
  } catch {}
  $("#saveWhere").textContent = await saveWhereText();
});
$("#saveDirClear").addEventListener("click", async () => {
  await clearSaveDir();
  $("#saveDirName").textContent = "고른 폴더 없음 → 크롬 다운로드 폴더에 저장";
  $("#saveDirClear").hidden = true;
  $("#saveWhere").textContent = await saveWhereText();
});
$("#sound").addEventListener("change", async () => {
  await persistSettings();
  if (settings.sound) Celebrate.ding();
});
$("#cafeAll").addEventListener("click", () => { settings.cafes.forEach((c) => (c.on = true)); renderCafeTable(); saveChannels(); });
$("#cafeNone").addEventListener("click", () => { settings.cafes.forEach((c) => (c.on = false)); renderCafeTable(); saveChannels(); });
$("#cafeAdd").addEventListener("click", () => {
  const slug = $("#cafeAddSlug").value.trim().replace(/^https?:\/\/(m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, "");
  if (!slug) return;
  if (settings.cafes.some((c) => c.slug === slug)) return ($("#settingsSaved").textContent = "이미 목록에 있는 카페입니다");
  settings.cafes.push({ name: $("#cafeAddName").value.trim() || slug, slug, car: $("#cafeAddCar").value.trim(), on: true, viaSearch: false });
  settings.removedCafes = (settings.removedCafes || []).filter((x) => x !== slug);
  $("#cafeAddName").value = $("#cafeAddSlug").value = $("#cafeAddCar").value = "";
  renderCafeTable();
  saveChannels("✔ 추가했습니다 (맨 아래 · ⠿ 를 끌어 위치를 옮길 수 있음)");
});
$("#ytAll").addEventListener("click", () => { settings.youtubeChannels.forEach((c) => (c.on = true)); renderYtTable(); saveChannels(); });
$("#ytNone").addEventListener("click", () => { settings.youtubeChannels.forEach((c) => (c.on = false)); renderYtTable(); saveChannels(); });
$("#ytAdd").addEventListener("click", async () => {
  $("#ytAddInfo").textContent = "채널 찾는 중…";
  try {
    const ch = await YoutubeCollector.resolveChannel($("#ytAddInput").value);
    if (!settings.youtubeChannels.some((c) => c.id === ch.id)) settings.youtubeChannels.push({ ...ch, on: true });
    $("#ytAddInput").value = "";
    $("#ytAddInfo").textContent = `✔ ${ch.name} 추가 (맨 아래 · ⠿ 를 끌어 위치를 옮길 수 있음)`;
    renderYtTable();
    saveChannels();
  } catch (e) {
    $("#ytAddInfo").textContent = e.message;
  }
});
$("#aiTest").addEventListener("click", async () => {
  const key = $("#apiKey").value.trim();
  if (!key) return ($("#aiInfo").textContent = "API 키를 넣어 주세요");
  $("#aiInfo").textContent = "확인 중…";
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
    await client.messages.create({ model: $("#model").value, max_tokens: 16, messages: [{ role: "user", content: "확인" }] });
    $("#aiInfo").textContent = "✔ 사용할 수 있는 키입니다";
    $("#aiInfo").className = "hint ok";
    await persistSettings();
  } catch (e) {
    $("#aiInfo").textContent = `✖ ${aiErrorText(e)}`;
    $("#aiInfo").className = "hint err";
  }
});

const gv90Init = init(); // 테스트가 기다림
