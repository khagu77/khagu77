// 블루핸즈/하이테크센터 정비 예약 관련 주간 보고서
// 1) 기사목록 파일(모니터링 사이트의 .xls = HTML 표)에서 네이버 카페 글을 읽고
// 2) 지난 보고서에 없는 글만 탭으로 열어 작성자(닉네임)를 확인한다.
//    본문이 안 보이면 네이버 검색 카페 탭에서 제목으로 같은 글을 찾아 그 링크로 들어가 확인하고,
//    '처음부터 검색으로 들어갈 카페'(넥쏘카페·영운모)는 바로 검색으로 들어간다. 그래도 못 보면 패스.
//    삭제된 게시물(삭제되었거나 존재하지 않는 글 - 알림창으로 알려 주는 경우 포함)은 목록에 빨간 취소선으로 표시하고
//    엑셀에는 넣지 않는다(연번도 주지 않음).
// 3) 지난 보고서 아래에 날짜순으로 이어 쓰고(연번·작성자·URL), 파일명 앞 날짜를 오늘로 바꿔 받는다.
// 4) 받은 보고서의 모든 행을 DB 목록(이 PC 크롬 저장소)에 모은다.
// 네이버 API 는 부르지 않는다 - 화면(탭)을 열어 보이는 내용만 읽는다(cafe-common.js).

const DEFAULT_SEARCH_FIRST = "nexocafe\n넥쏘카페\n영운모";
const DEFAULT_SEARCH_URL = "https://search.naver.com/search.naver?ssc=tab.cafe.all&query={q}";
const DEFAULT_REPORT_NAME = "정비 예약 관련 게시물 보고서.xlsx";
const CHANNEL = "동호회";
const HEADERS = ["No", "채널", "채널명", "작성일", "제목", "작성자", "URL"];

let items = []; // { key, srcNo, date, cafe, title, url, slug, cafeId, articleId, state, author, status, note, no }
let listName = "";
let report = null; // { name, bytes, info }
let db = {}; // 글 키 → { no, channel, cafe, date, title, author, url, file, savedAt }
let history = [];
let cafeSlugs = {};
let running = false;
let stopRequested = false;

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function log(text) {
  const box = $("#log");
  box.hidden = false;
  const line = document.createElement("div");
  line.textContent = text;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

function setHint(sel, text, cls = "") {
  $(sel).textContent = text;
  $(sel).className = `hint ${cls}`;
}

// 같은 글인지 비교하는 키: '카페주소/글번호' (카페 번호만 알면 'id:번호/글번호')
function articleKey(url) {
  const p = parseArticleUrl(url);
  if (!p.articleId) return clean(url).toLowerCase();
  const cafe = p.cafeUrl ? p.cafeUrl.toLowerCase() : p.cafeId ? `id:${p.cafeId}` : "";
  return `${cafe}/${p.articleId}`;
}

function sameArticle(a, b) {
  if (a === b) return true;
  const [ca, ia] = [a.slice(0, a.lastIndexOf("/")), a.slice(a.lastIndexOf("/") + 1)];
  const [cb, ib] = [b.slice(0, b.lastIndexOf("/")), b.slice(b.lastIndexOf("/") + 1)];
  if (ia !== ib || !ia) return false;
  // 한쪽이 카페 번호로만 되어 있으면 기억해 둔 영문 주소로 맞춰 본다
  const slugOf = (c) => (c.startsWith("id:") ? (cafeSlugs[c.slice(3)] || "").toLowerCase() || c : c);
  return slugOf(ca) === slugOf(cb);
}

function normalizeUrl(raw) {
  const p = parseArticleUrl(raw);
  if (!p.articleId || !/naver\.com/i.test(String(raw))) return { url: clean(raw), slug: "", cafeId: "", articleId: "" };
  const slug = p.cafeUrl || (p.cafeId && cafeSlugs[p.cafeId]) || "";
  const url = slug ? shortArticleUrl(slug, p.articleId) : `https://cafe.naver.com/f-e/cafes/${p.cafeId}/articles/${p.articleId}`;
  return { url, slug, cafeId: p.cafeId || "", articleId: p.articleId };
}

// "2026-10-12 09:59:00", "2026.10.12. 09:59", 엑셀 날짜 일련번호 → Date
function toDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number" && isFinite(v) && v > 20000) {
    const ms = Math.round(v * 86400000) + Date.UTC(1899, 11, 30);
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }
  const m = String(v ?? "").match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

const dateText = (d) => (d ? formatDateTime(d) : "");

function ymdNumber(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

async function loadSettings() {
  const s = await chrome.storage.local
    .get(["bhSearchFirst", "bhSearchUrl", "bhKeepGaps", "bhExtraHolidays", "bhDb", "bhHistory"])
    .catch(() => ({}));
  $("#searchFirst").value = s.bhSearchFirst ?? DEFAULT_SEARCH_FIRST;
  $("#searchUrl").value = s.bhSearchUrl || DEFAULT_SEARCH_URL;
  $("#keepGaps").checked = s.bhKeepGaps ?? true;
  $("#extraHolidays").value = s.bhExtraHolidays || "";
  db = s.bhDb || {};
  history = s.bhHistory || [];
  cafeSlugs = await loadCafeSlugs();
}

function saveSettings() {
  let url = $("#searchUrl").value.trim() || DEFAULT_SEARCH_URL;
  if (!url.includes("{q}")) url = url.replace(/([?&]query=)[^&#]*/, "$1{q}");
  if (!url.includes("{q}")) url += `${url.includes("?") ? "&" : "?"}query={q}`;
  $("#searchUrl").value = url;
  return chrome.storage.local
    .set({
      bhSearchFirst: $("#searchFirst").value,
      bhSearchUrl: url,
      bhKeepGaps: $("#keepGaps").checked,
      bhExtraHolidays: $("#extraHolidays").value,
    })
    .catch(() => {});
}

function searchFirstWords() {
  return $("#searchFirst").value.split(/[\r\n,]+/).map(clean).filter(Boolean);
}

function isSearchFirst(x) {
  return searchFirstWords().some(
    (w) => (x.slug && w.toLowerCase() === x.slug.toLowerCase()) || (x.cafe && x.cafe.replace(/\s+/g, "").includes(w.replace(/\s+/g, ""))),
  );
}

// ---------------------------------------------------------------------------
// 보고 일정
// ---------------------------------------------------------------------------

async function renderSchedule() {
  const extra = parseExtraHolidays($("#extraHolidays").value);
  const plan = reportSchedule(new Date(), extra);
  const { bhLastReportDay } = await chrome.storage.local.get("bhLastReportDay").catch(() => ({}));
  const moved = (w) => (w.moved ? ` - 월요일 ${dayLabel(w.monday)}이 ${w.reason}이라 다음 근무일에 보고` : "");
  const box = $("#schedule");
  if (plan.isReportDay) {
    const done = bhLastReportDay === ymd(plan.today);
    box.className = done ? "schedule" : "schedule due";
    box.textContent = done
      ? `✔ 오늘 ${dayLabel(plan.today)} 주간 보고서를 받았습니다${moved(plan.next)}.`
      : `오늘 ${dayLabel(plan.today)}은 주간 보고일입니다${moved(plan.next)}.`;
  } else {
    box.className = "schedule";
    box.textContent = `다음 보고일: ${dayLabel(plan.next.day)}${moved(plan.next)} · 지난 보고일: ${dayLabel(plan.prev.day)}`;
  }
}

// ---------------------------------------------------------------------------
// 1. 기사목록 파일 읽기
// ---------------------------------------------------------------------------

// 표(2차원 배열)에서 머리글 줄을 찾아 열 위치를 정한다
function findColumns(table) {
  const pick = (cells, re) => cells.findIndex((c) => re.test(clean(c)));
  for (let r = 0; r < Math.min(table.length, 20); r++) {
    const cells = table[r].map((c) => clean(c));
    const title = pick(cells, /^제목$/);
    const url = pick(cells, /^(link|url|주소|링크|원문)$/i);
    if (title < 0 || url < 0) continue;
    return {
      header: r,
      title,
      url,
      cafe: pick(cells, /^(출처|채널명|카페명?|매체명?|사이트명?)$/),
      date: pick(cells, /^(작성시간|작성일시?|게시일시?|등록일시?)$/),
      no: pick(cells, /^(no|연번|순번|번호)$/i),
    };
  }
  throw new Error("머리글(제목 · Link)을 찾지 못했습니다. 모니터링 사이트에서 받은 기사목록 파일인지 확인해 주세요.");
}

async function readTableFromFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const wb = await XlsxTemplate.Workbook.open(bytes);
    const rows = await wb.readRows(wb.sheetNames()[0]);
    return rows.map((r) => {
      const arr = [];
      for (const [col, v] of Object.entries(r.cells)) {
        let n = 0;
        for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
        arr[n - 1] = v;
      }
      return Array.from(arr, (v) => v ?? "");
    });
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf)
    throw new Error("예전 엑셀(.xls) 형식이라 읽지 못합니다. 엑셀에서 열어 '다른 이름으로 저장 → Excel 통합 문서(.xlsx)'로 바꾼 뒤 골라 주세요.");
  let text = new TextDecoder("utf-8").decode(bytes);
  if (/charset\s*=\s*["']?(euc-kr|ks_c_5601|cp949)/i.test(text.slice(0, 2000))) text = new TextDecoder("euc-kr").decode(bytes);
  const doc = new DOMParser().parseFromString(text, "text/html");
  const table = [...doc.querySelectorAll("table")].find((t) => /제목/.test(t.textContent)) || doc.querySelector("table");
  if (!table) throw new Error("파일에서 표를 찾지 못했습니다.");
  return [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th, td")].map((td) => td.textContent));
}

async function loadListFile(file) {
  if (!file) return;
  setHint("#listInfo", "파일 읽는 중…");
  try {
    const table = await readTableFromFile(file);
    const col = findColumns(table);
    const rows = [];
    table.slice(col.header + 1).forEach((cells, i) => {
      const title = clean(cells[col.title]);
      const raw = clean(cells[col.url]);
      if (!title && !raw) return;
      const n = normalizeUrl(raw);
      rows.push({
        key: articleKey(n.url),
        srcNo: col.no >= 0 ? Number(cells[col.no]) || i + 1 : i + 1,
        date: col.date >= 0 ? toDate(cells[col.date]) : null,
        cafe: col.cafe >= 0 ? clean(cells[col.cafe]) : "",
        title,
        ...n,
        state: n.articleId ? "new" : "notcafe",
        author: "",
        status: "",
        note: n.articleId ? "" : "네이버 카페 글 주소가 아님",
      });
    });
    if (!rows.length) throw new Error("글이 하나도 없습니다.");
    // 날짜순(오래된 글 먼저). 같은 시간이면 기사목록에서 아래쪽(먼저 올라온) 글 먼저
    rows.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || b.srcNo - a.srcNo);
    items = rows;
    listName = file.name;
    const dates = rows.map((x) => x.date).filter(Boolean);
    const span = dates.length ? ` (${dateText(dates[0])} ~ ${dateText(dates[dates.length - 1])})` : "";
    setHint("#listInfo", `✔ ${file.name} - 글 ${rows.length}개${span}`, "ok");
    $("#log").innerHTML = "";
    $("#log").hidden = true;
    setSummary("");
    setHint("#saveInfo", "");
    markDuplicates();
    persist();
  } catch (e) {
    setHint("#listInfo", `파일을 읽지 못했습니다: ${e.message}`, "err");
  }
}

// ---------------------------------------------------------------------------
// 2. 지난 보고서 파일
// ---------------------------------------------------------------------------

function pickReportSheet(wb) {
  return wb.sheetNames()[0];
}

// 보고서 시트 → 머리글 행, 마지막 행·연번, 서식 견본 행, 전체 행(DB 용)
async function analyzeReport(wb) {
  const sheet = pickReportSheet(wb);
  const rows = await wb.readRows(sheet);
  const head = rows.find((r) => Object.values(r.cells).some((v) => /^url$/i.test(clean(v))));
  if (!head) throw new Error("머리글(No · 채널 · 채널명 · 작성일 · 제목 · 작성자 · URL)을 찾지 못했습니다.");
  const colOf = {};
  for (const [c, v] of Object.entries(head.cells)) colOf[clean(v)] = c;
  const C = (name, fallback) => colOf[name] || fallback;
  const cols = { no: C("No", "A"), channel: C("채널", "B"), cafe: C("채널명", "C"), date: C("작성일", "D"), title: C("제목", "E"), author: C("작성자", "F"), url: C("URL", "G") };
  const data = rows.filter((r) => r.r > head.r && Object.values(r.cells).some((v) => clean(v)));
  let lastNo = 0;
  const records = [];
  for (const r of data) {
    const no = Number(r.cells[cols.no]);
    if (Number.isFinite(no)) lastNo = Math.max(lastNo, no);
    const d = toDate(r.cells[cols.date]);
    const url = clean(r.cells[cols.url]);
    records.push({
      no: Number.isFinite(no) ? no : "",
      channel: clean(r.cells[cols.channel]) || CHANNEL,
      cafe: clean(r.cells[cols.cafe]),
      date: dateText(d),
      title: clean(r.cells[cols.title]),
      author: clean(r.cells[cols.author]),
      url,
    });
  }
  const lastRow = data.length ? Math.max(...data.map((r) => r.r)) : head.r;
  const sameFormat = HEADERS.every((h, i) => colOf[h] === String.fromCharCode(65 + i));
  return { sheet, headerRow: head.r, lastRow, lastNo, styleRow: data.length ? lastRow : head.r + 1, records, sameFormat };
}

async function loadReportFile(file) {
  report = null;
  if (!file) {
    renderReportInfo();
    markDuplicates();
    return;
  }
  setHint("#reportInfo", "파일 읽는 중…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = await analyzeReport(await XlsxTemplate.Workbook.open(bytes));
    report = { name: file.name, bytes, info };
    try {
      localStorage.setItem("bhReportName", file.name);
    } catch {
      /* 무시 */
    }
  } catch (e) {
    setHint("#reportInfo", `파일을 읽지 못했습니다: ${e.message}`, "err");
    markDuplicates();
    return;
  }
  renderReportInfo();
  markDuplicates();
}

function rememberedReportName() {
  try {
    return localStorage.getItem("bhReportName") || DEFAULT_REPORT_NAME;
  } catch {
    return DEFAULT_REPORT_NAME;
  }
}

function dbRecords() {
  return Object.values(db);
}

function dbMaxNo() {
  return dbRecords().reduce((m, r) => (Number.isFinite(Number(r.no)) && r.no !== "" ? Math.max(m, Number(r.no)) : m), 0);
}

function renderReportInfo() {
  if (report) {
    const i = report.info;
    setHint(
      "#reportInfo",
      `✔ '${i.sheet}' 시트 ${i.records.length.toLocaleString()}행(마지막 연번 ${i.lastNo.toLocaleString()}) 아래에 이어 씁니다. ` +
        `받을 파일: ${datedFileName(report.name)}` +
        (i.sameFormat ? "" : " ⚠ 머리글 순서가 양식(No·채널·채널명·작성일·제목·작성자·URL)과 달라요 - 새 행은 양식 순서로 씁니다."),
      i.sameFormat ? "ok" : "err",
    );
  } else {
    const n = dbRecords().length;
    setHint(
      "#reportInfo",
      n
        ? `파일을 고르지 않으면 DB 목록 ${n.toLocaleString()}행 + 이번 글로 같은 양식의 파일을 만듭니다 (${datedFileName(rememberedReportName())}).`
        : `파일을 고르지 않으면 같은 양식의 새 파일로 받습니다 (${datedFileName(rememberedReportName())}).`,
    );
  }
}

// 지난 보고서(없으면 DB)에 이미 있는 글 표시
function markDuplicates() {
  // 글 키 → 보고서(없으면 DB)에 적혀 있는 작성자
  const have = report ? report.info.records.map((r) => [articleKey(r.url), r.author]) : Object.entries(db).map(([k, r]) => [k, r.author]);
  for (const x of items) {
    if (x.state === "notcafe" || x.state === "deleted") continue;
    const hit = have.find(([k]) => sameArticle(k, x.key));
    x.state = hit ? "dup" : "new";
    x.knownAuthor = hit ? clean(hit[1]) : "";
  }
  renderItems();
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

function baseNo() {
  return report ? report.info.lastNo : dbMaxNo();
}

// 연번: 날짜순. '패스한 글도 연번 자리 남기기'면 새 글 전체에, 아니면 작성자가 있는 글에만
function assignNumbers() {
  let no = baseNo();
  const keep = $("#keepGaps").checked;
  for (const x of items) {
    x.no = "";
    if (x.state !== "new") continue;
    if (keep || clean(x.author)) x.no = ++no;
  }
}

const STATUS_TEXT = {
  ok: ["✔ 확인", "ok"],
  search: ["✔ 확인(검색 경유)", "ok"],
  manual: ["✔ 직접 입력", "ok"],
  pass: ["패스", "err"],
  run: ["확인 중…", "run"],
};

function renderItems() {
  assignNumbers();
  const tbody = $("#items tbody");
  tbody.innerHTML = "";
  for (const x of items) {
    const tr = document.createElement("tr");
    tr.className = { new: "", dup: "dup", deleted: "deleted" }[x.state] ?? "skip";
    tr.innerHTML =
      '<td class="nowrap"></td><td class="nowrap"></td><td></td><td class="title"><a target="_blank" rel="noopener"></a></td>' +
      '<td class="url"></td><td></td><td class="st"></td>';
    const td = tr.children;
    td[0].textContent = x.no;
    td[1].textContent = dateText(x.date);
    td[2].textContent = x.cafe;
    td[3].firstChild.textContent = x.title;
    td[3].firstChild.href = x.url;
    td[4].textContent = x.url;
    if (x.state === "new" && clean(x.author) && !x.editing) {
      // 확인된 작성자 닉네임은 글자로 보여 주고, [수정]으로 고칠 수 있게
      td[5].innerHTML = '<b class="nick"></b> <button class="small edit">수정</button>';
      td[5].firstChild.textContent = x.author;
      const edit = td[5].querySelector("button");
      edit.disabled = running;
      edit.addEventListener("click", () => {
        x.editing = true;
        renderItems();
        [...document.querySelectorAll("#items input.author")].find((el) => el.dataset.key === x.key)?.focus();
      });
    }
    if (x.state === "new" && !(clean(x.author) && !x.editing)) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "author";
      input.dataset.key = x.key;
      input.value = x.author;
      input.placeholder = x.status === "pass" ? "패스 (직접 입력 가능)" : "";
      input.disabled = running;
      input.addEventListener("change", () => {
        x.editing = false;
        x.author = clean(input.value);
        x.status = x.author ? "manual" : x.status === "manual" ? "" : x.status;
        renderItems();
        persist();
      });
      td[5].appendChild(input);
    }
    if (x.state === "new") {
      const [text, cls] = STATUS_TEXT[x.status] || ["", ""];
      td[6].textContent = text + (x.note && x.status === "pass" ? ` - ${x.note}` : "");
      td[6].className = `st ${cls}`;
    } else if (x.state === "deleted") {
      // 삭제된 게시물: 빨간 취소선으로 남겨 두고 엑셀에는 넣지 않는다
      td[6].innerHTML = '<span class="del-label">삭제된 게시물</span> <button class="small undo" title="삭제된 글이 아니면 다시 목록에 넣습니다">되돌리기</button>';
      td[6].className = "st";
      const undo = td[6].querySelector("button");
      undo.disabled = running;
      undo.addEventListener("click", () => {
        x.state = "new";
        x.note = "";
        markDuplicates();
        persist();
      });
    } else {
      if (x.state === "dup" && x.knownAuthor) {
        td[5].innerHTML = '<span class="nick known"></span>';
        td[5].firstChild.textContent = x.knownAuthor;
      }
      td[6].textContent = x.state === "dup" ? "이미 보고서에 있음" : x.note;
    }
    tbody.appendChild(tr);
  }
  $("#itemsBox").hidden = !items.length;
  updateCounts();
}

function updateCounts() {
  const fresh = items.filter((x) => x.state === "new");
  const done = fresh.filter((x) => clean(x.author));
  const passed = fresh.filter((x) => !clean(x.author) && x.status === "pass");
  const dup = items.filter((x) => x.state === "dup").length;
  const other = items.filter((x) => x.state === "notcafe").length;
  const deleted = items.filter((x) => x.state === "deleted");
  $("#itemCount").textContent =
    `전체 ${items.length}개 · 새 글 ${fresh.length}개(작성자 확인 ${done.length} · 패스 ${passed.length} · 남음 ${fresh.length - done.length - passed.length})` +
    (dup ? ` · 이미 보고서에 있음 ${dup}개` : "") +
    (other ? ` · 카페 글 아님 ${other}개` : "") +
    (deleted.length ? ` · 삭제된 게시물 ${deleted.length}개(엑셀에서 뺌)` : "");
  $("#start").disabled = running || !fresh.some((x) => !clean(x.author));
  $("#start").textContent = passed.length && passed.length === fresh.length - done.length ? "패스한 글 다시 확인" : "작성자 확인 시작";
  $("#save").disabled = running || !done.length;
  $("#stop").disabled = !running;
}

function persist() {
  const plain = items.map((x) => ({ ...x, editing: false, date: x.date ? x.date.getTime() : null }));
  chrome.storage.local.set({ bhLast: { items: plain, listName, at: Date.now() } }).catch(() => {});
}

async function restoreLast() {
  const { bhLast } = await chrome.storage.local.get("bhLast").catch(() => ({}));
  if (!bhLast?.items?.length) return;
  items = bhLast.items.map((x) => ({ ...x, date: x.date ? new Date(x.date) : null, status: x.status === "run" ? "" : x.status }));
  listName = bhLast.listName || "";
  setHint("#listInfo", `지난번에 읽은 ${listName} (${new Date(bhLast.at).toLocaleString()}) - 새 파일을 고르면 바뀝니다.`);
  markDuplicates();
}

// ---------------------------------------------------------------------------
// 화면에서 읽기 (각 프레임 안에서 실행 - 혼자 동작해야 함)
// ---------------------------------------------------------------------------

// 게시글 화면: 작성자 닉네임 · 본문이 보이는지 · 막힘 안내
function readAuthorInFrame() {
  const top = window === window.top;
  let alerted = ""; // bh-alert.js 가 막아 둔 알림창 글자 (삭제된 게시물 등)
  try {
    alerted = sessionStorage.getItem("bhAlert") || "";
  } catch {
    /* 무시 */
  }
  const text = `${(document.body && document.body.innerText) || ""}\n${alerted}`;
  const blocked =
    /(카페\s*)?멤버(만|에게만)\s*(볼|읽|열람|공개)|가입\s*(후|하시면|해야)\s*.{0,10}(볼|읽|열람|이용)|등급이?\s*.{0,10}(되면|이상).{0,10}(볼|읽|열람)|열람\s*권한|권한이\s*없|비공개\s*(게시|글|처리)/.test(text);
  const deleted =
    /삭제되었거나\s*(존재하지|없는)|존재하지\s*않는\s*(게시|글)|(게시글|게시물|글)이\s*삭제(되었|됐|된)|삭제된\s*(게시글|게시물|글)(입니다)?\s*[.!]?\s*$|작성자가\s*삭제|이동되었거나\s*삭제/m.test(
      text,
    );
  const pick = (sels) => {
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (t) return t;
      }
    }
    return "";
  };
  const nick = pick([
    ".ArticleContentBox .article_writer .nickname",
    ".ArticleContentBox .WriterInfo .nickname",
    ".ArticleContentBox .nick_box .nickname",
    ".article_header .WriterInfo .nickname",
    ".article_header .nick_box .nickname",
    ".article_header .nickname",
    ".WriterInfo .nickname",
    ".ArticleWriterProfile .nickname",
    ".article_writer .nickname",
    ".article_writer strong",
    "td.p-nick a",
    ".post_writer .nick",
    ".post_title .nick .ellip",
    ".user_wrap .nick",
  ]);
  const bodyEl = document.querySelector(
    ".ArticleContentBox .article_container, .se-main-container, .ContentRenderer, .article_viewer, #tbody, #postContent, .post_cont, #postViewArea",
  );
  const hasBody = !!bodyEl && (((bodyEl.innerText || "").trim().length > 0) || !!bodyEl.querySelector("img, video, iframe"));
  const title = pick([".ArticleContentBox .title_text", ".article_header .title_text", "h3.title_text", ".tit-box .b", ".post_title h2"]);
  const alertDeleted =
    !!alerted && /삭제되었거나|존재하지\s*않는|삭제된\s*(게시|글)|(게시글|게시물|글)이\s*삭제|이동되었거나\s*삭제/.test(alerted);
  return { href: location.href, top, nick, hasBody, blocked, deleted, alertDeleted, alerted, title, login: /nid\.naver\.com/.test(location.href) };
}

// 네이버 검색 결과: 같은 글(글번호 · 카페 주소)로 가는 링크
function findArticleLinkInFrame(articleId, slug) {
  const text = (document.body && document.body.innerText) || "";
  const noResult = /검색\s*결과가\s*없|검색결과가\s*없|일치하는\s*(검색\s*)?결과가\s*없/.test(text);
  const hits = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href], a[data-url]")) {
    for (const h of [a.href, a.getAttribute("data-url") || ""]) {
      if (!h || seen.has(h)) continue;
      let s = "";
      let id = "";
      let m = h.match(/^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)(?:[/?#]|$)/);
      if (m && !/^(f-e|ca-fe|cafes)$/.test(m[1])) [s, id] = [m[1], m[2]];
      else if (/cafe\.naver\.com/.test(h)) {
        m = h.match(/\/articles\/(\d+)/) || h.match(/[?&]articleid=(\d+)/i);
        if (m) id = m[1];
        const k = h.match(/\/cafes\/([A-Za-z][\w-]*)\/articles/);
        if (k) s = k[1];
      }
      if (id !== String(articleId)) continue;
      if (s && slug && s.toLowerCase() !== String(slug).toLowerCase()) continue;
      seen.add(h);
      hits.push({ href: h, art: /[?&]art=/.test(h), text: (a.innerText || "").trim().slice(0, 120) });
    }
  }
  hits.sort((x, y) => y.art - x.art || y.text.length - x.text.length);
  return { hits, noResult, top: window === window.top, href: location.href };
}

// ---------------------------------------------------------------------------
// 탭 다루기
// ---------------------------------------------------------------------------

async function framesWithin(tabId, func, args = [], ms = 8000) {
  // 화면이 알림창 등으로 멈춰도 기다리기만 하지 않도록 시간 제한
  return Promise.race([runInFrames(tabId, func, args), sleep(ms).then(() => [])]);
}

function waitForNavigation(tabId, ms = 30000) {
  return new Promise((resolve) => {
    let seenLoading = false;
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id, info) {
      if (id !== tabId) return;
      if (info.status === "loading") seenLoading = true;
      if (info.status === "complete" && seenLoading) done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// 열린 글 화면에서 작성자를 읽는다 → { author, hints } / { deleted } / { blocked } / { login } / {}
async function pollArticle(tabId) {
  let blockedSeen = 0;
  let deletedSeen = 0;
  for (let i = 0; i < 8; i++) {
    const frames = await framesWithin(tabId, readAuthorInFrame);
    // 삭제 알림창이 떴던 글은 바로 삭제된 게시물로
    if (frames.some((f) => f.alertDeleted)) return { deleted: true };
    const ok = frames.find((f) => f.nick && f.hasBody && !f.blocked);
    if (ok) {
      const hints = await framesWithin(tabId, cafeSlugHintsInFrame);
      return { author: ok.nick.replace(/\s*님$/, ""), title: ok.title, hints };
    }
    if (frames.some((f) => f.login)) return { login: true };
    // 삭제 안내는 본문·작성자가 없는 화면에서 두 번 연속 보일 때만 (본문 속 '삭제' 글자 오인 방지)
    if (frames.some((f) => f.deleted && !f.hasBody) && ++deletedSeen >= 2) return { deleted: true };
    if (frames.some((f) => f.blocked) && ++blockedSeen >= 2) return { blocked: true };
    await sleep(1500);
  }
  return {};
}

function failReason(r) {
  return r.login ? "로그인 화면이 나옴" : r.blocked ? "본문이 막혀 있음(멤버 공개 등)" : "본문이 보이지 않음";
}

async function readDirect(x) {
  return withTab(`${x.url}#bhcheck`, (tabId) => pollArticle(tabId)); // #bhcheck: 이 탭의 알림창은 bh-alert.js 가 막고 기록
}

function searchUrlFor(q) {
  return ($("#searchUrl").value.trim() || DEFAULT_SEARCH_URL).replace("{q}", encodeURIComponent(q));
}

// 네이버 검색 카페 탭에서 제목으로 같은 글을 찾아, 그 검색 화면에서 링크로 들어가 확인한다
async function readViaSearch(x) {
  const queries = [x.title, `"${x.title}"`].filter((q, i, a) => q && a.indexOf(q) === i);
  for (let qi = 0; qi < queries.length; qi++) {
    log(`  네이버 검색(카페 탭): ${queries[qi]}`);
    const res = await withTab(searchUrlFor(queries[qi]), async (tabId) => {
      let link = null;
      for (let i = 0; i < 8 && !link; i++) {
        const frames = await framesWithin(tabId, findArticleLinkInFrame, [x.articleId, x.slug || ""]);
        link = frames.flatMap((f) => f.hits)[0] || null;
        if (!link && frames.some((f) => f.noResult)) break;
        if (!link) await sleep(1500);
      }
      if (!link) return { notFound: true };
      log(`  검색 결과의 링크로 들어갑니다`);
      await sleep(randomBetween([1000, 2500]));
      const nav = waitForNavigation(tabId);
      await chrome.scripting
        .executeScript({ target: { tabId }, func: (href) => (location.href = href), args: [link.href.replace(/#.*$/, "") + "#bhcheck"] })
        .catch(() => {});
      await nav;
      await sleep(3000);
      return { ...(await pollArticle(tabId)), link: link.href };
    });
    if (res.author || !res.notFound) return res;
    if (qi < queries.length - 1) await sleep(randomBetween(CAFE_PAGE_DELAY));
  }
  return { notFound: true };
}

async function findAuthor(x) {
  let first = null;
  if (!isSearchFirst(x)) {
    log(`  글 열기: ${x.url}`);
    first = await readDirect(x);
    if (first.author) return { ...first, via: "direct" };
    if (first.deleted) return { deleted: true };
    log(`  ${failReason(first)} → 네이버 검색으로 찾습니다`);
    await sleep(randomBetween(CAFE_PAGE_DELAY));
  } else {
    log(`  처음부터 검색으로 들어가는 카페입니다`);
  }
  const s = await readViaSearch(x);
  if (s.author) return { ...s, via: "search" };
  if (s.deleted) return { deleted: true };
  // 처음부터 검색으로 들어간 카페인데 검색에서 못 찾으면, 지워진 글인지 글 주소로 한 번 확인한다
  if (!first && s.notFound) {
    log(`  검색에서 못 찾아 글이 지워졌는지 글 주소로 확인합니다`);
    await sleep(randomBetween(CAFE_PAGE_DELAY));
    const d = await readDirect(x);
    if (d.deleted) return { deleted: true };
    if (d.author) return { ...d, via: "direct" };
  }
  return { reason: s.notFound ? "검색에서 같은 글을 찾지 못함" : `검색 링크로도 ${failReason(s)}` };
}

// 글을 연 화면에서 영문 카페 주소를 알게 되면 URL 을 짧은 형식으로 바꾼다
async function learnSlug(x, hints) {
  if (x.slug || !hints?.length) return;
  const slug = pickSlug(hints);
  if (!slug) return;
  x.slug = slug;
  if (x.cafeId) {
    await saveCafeSlug(x.cafeId, slug);
    cafeSlugs[x.cafeId] = slug;
  }
  x.url = shortArticleUrl(slug, x.articleId);
  x.key = articleKey(x.url);
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
  if (ok) box.textContent = "✔ 네이버에 로그인되어 있습니다.";
  else
    box.innerHTML =
      '카페 글을 열어 보려면 네이버 로그인이 필요합니다. <a href="https://nid.naver.com/nidlogin.login" target="_blank">여기서 로그인</a>한 뒤 이 화면으로 돌아오세요.';
  return ok;
}

async function run() {
  if (running) return;
  const targets = items.filter((x) => x.state === "new" && !clean(x.author));
  if (!targets.length) return;
  running = true;
  stopRequested = false;
  $("#log").innerHTML = "";
  setHint("#saveInfo", "");
  renderItems();
  let ok = 0;
  let pass = 0;
  let removed = 0;
  for (let i = 0; i < targets.length; i++) {
    if (stopRequested) break;
    const x = targets[i];
    x.status = "run";
    x.note = "";
    renderItems();
    setSummary(`작성자 확인 중… ${i + 1}/${targets.length} - ${x.title}`);
    log(`[${i + 1}/${targets.length}] ${x.cafe} · ${x.title}`);
    let r;
    try {
      r = await findAuthor(x);
    } catch (e) {
      r = { reason: e.message };
    }
    if (r.deleted) {
      x.state = "deleted";
      x.status = "";
      x.note = "삭제된 게시물";
      removed++;
      log(`  삭제된 게시물 - 엑셀에 넣지 않습니다`);
    } else if (r.author) {
      x.author = r.author;
      x.status = r.via === "search" ? "search" : "ok";
      await learnSlug(x, r.hints);
      ok++;
      log(`  ✔ 작성자: ${r.author}`);
    } else {
      x.status = "pass";
      x.note = r.reason;
      pass++;
      log(`  패스 - ${r.reason}`);
    }
    renderItems();
    persist();
    if (i < targets.length - 1 && !stopRequested) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
  }
  for (const x of items) if (x.status === "run") x.status = "";
  running = false;
  renderItems();
  persist();
  setSummary(
    `${stopRequested ? "중지했습니다" : "작성자 확인을 마쳤습니다"} - 확인 ${ok}개 · 패스 ${pass}개${removed ? ` · 삭제된 게시물 ${removed}개(엑셀에서 뺌)` : ""}. '엑셀 받기'를 누르세요.`,
    pass ? "" : "ok",
  );
}

// ---------------------------------------------------------------------------
// 3. 엑셀 받기 (지난 보고서 아래 이어 쓰기 / 파일이 없으면 DB + 이번 글로 새 파일)
// ---------------------------------------------------------------------------

async function openTemplate() {
  const resp = await fetch(chrome.runtime.getURL("report-template.xlsx"));
  return XlsxTemplate.Workbook.open(new Uint8Array(await resp.arrayBuffer()));
}

function recordValues(r) {
  const d = toDate(r.date);
  return [r.no === "" ? "" : Number(r.no), r.channel || CHANNEL, r.cafe, d ? excelSerial(d) : "", r.title, r.author, r.url];
}

function sortRecords(list) {
  return [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Number(a.no) || 0) - (Number(b.no) || 0));
}

// 머리글 1행 + 서식 견본 2행짜리 양식에 records 를 채운다
async function buildFromTemplate(records) {
  const wb = await openTemplate();
  const sheet = pickReportSheet(wb);
  const values = records.map(recordValues);
  await wb.replaceRowsAfter(sheet, 1, values, 2);
  const links = {};
  values.forEach((v, i) => /^https?:\/\//.test(v[6]) && (links[`G${2 + i}`] = v[6]));
  await wb.addHyperlinks(sheet, links);
  return wb.save();
}

function newRecords() {
  assignNumbers();
  return items
    .filter((x) => x.state === "new" && clean(x.author))
    .map((x) => ({ no: x.no, channel: CHANNEL, cafe: x.cafe, date: dateText(x.date), title: x.title, author: clean(x.author), url: x.url }));
}

async function saveReport() {
  const fresh = newRecords();
  if (!fresh.length) return;
  const passed = items.filter((x) => x.state === "new" && !clean(x.author)).length;
  const removed = items.filter((x) => x.state === "deleted").length;
  try {
    let bytes;
    let all;
    if (report) {
      const wb = await XlsxTemplate.Workbook.open(report.bytes);
      const info = await analyzeReport(wb);
      const values = fresh.map(recordValues);
      await wb.replaceRowsAfter(info.sheet, info.lastRow, values, info.styleRow, { focusFirstNew: true });
      const links = {};
      values.forEach((v, i) => (links[`G${info.lastRow + 1 + i}`] = v[6]));
      await wb.addHyperlinks(info.sheet, links);
      bytes = await wb.save();
      all = [...info.records, ...fresh];
    } else {
      all = [...sortRecords(dbRecords()), ...fresh];
      bytes = await buildFromTemplate(all);
    }
    const name = datedFileName(report ? report.name : rememberedReportName());
    downloadBytes(bytes, name);
    await addToDb(all, name);
    history.unshift({ at: Date.now(), file: name, added: fresh.length, passed, deleted: removed, total: all.length });
    await chrome.storage.local.set({ bhHistory: history.slice(0, 200), bhLastReportDay: ymd(new Date()) }).catch(() => {});
    renderSchedule();
    renderDb();
    const nos = fresh.map((r) => r.no);
    setHint(
      "#saveInfo",
      `✔ ${name} - ${fresh.length}개 추가 (연번 ${nos[0]}~${nos[nos.length - 1]})` +
        (passed ? `, 패스 ${passed}개는 넣지 않았습니다` : "") +
        (removed ? `, 삭제된 게시물 ${removed}개는 넣지 않았습니다` : "") +
        `. 파일의 ${all.length.toLocaleString()}행을 DB 목록에 저장했습니다.`,
      "ok",
    );
  } catch (e) {
    setHint("#saveInfo", `엑셀을 만들지 못했습니다: ${e.message}`, "err");
  }
}

// ---------------------------------------------------------------------------
// 4. DB 목록
// ---------------------------------------------------------------------------

async function addToDb(records, file) {
  const now = Date.now();
  for (const r of records) {
    if (!clean(r.url) && !clean(r.title)) continue;
    const key = clean(r.url) ? articleKey(r.url) : `title:${r.date}/${r.title}`;
    const old = db[key];
    db[key] = { ...old, ...r, file: file || old?.file || "", savedAt: now };
  }
  await chrome.storage.local.set({ bhDb: db }).catch(() => {});
}

function dbFiltered() {
  const q = clean($("#dbQuery").value).toLowerCase();
  const from = $("#dbFrom").value;
  const to = $("#dbTo").value;
  return sortRecords(dbRecords()).filter((r) => {
    const day = String(r.date).slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (!q) return true;
    return [r.title, r.cafe, r.author, r.url].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function renderDb() {
  const list = dbFiltered();
  const tbody = $("#dbTable tbody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const r of list) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="nowrap"></td><td class="nowrap"></td><td></td><td></td><td></td><td class="url"><a target="_blank" rel="noopener"></a></td><td></td>';
    const td = tr.children;
    td[0].textContent = r.no;
    td[1].textContent = r.date;
    td[2].textContent = r.cafe;
    td[3].textContent = r.title;
    td[4].textContent = r.author;
    td[5].firstChild.textContent = r.url;
    if (/^https?:\/\//.test(r.url)) td[5].firstChild.href = r.url;
    td[6].textContent = r.file || "";
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  const total = dbRecords().length;
  $("#dbCount").textContent = total
    ? `DB 전체 ${total.toLocaleString()}행 중 ${list.length.toLocaleString()}행 표시`
    : "아직 DB 에 저장된 글이 없습니다. 보고서 엑셀을 받거나 '보고서 엑셀을 DB에 넣기'로 지난 파일을 넣어 보세요.";
  $("#dbExport").disabled = !list.length;

  const hb = $("#history tbody");
  hb.innerHTML = "";
  for (const h of history) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td class=nowrap></td><td></td><td></td><td></td><td></td><td></td>";
    tr.children[0].textContent = new Date(h.at).toLocaleString();
    tr.children[1].textContent = h.file;
    tr.children[2].textContent = h.added ?? "";
    tr.children[3].textContent = h.passed ?? "";
    tr.children[4].textContent = h.deleted ?? "";
    tr.children[5].textContent = h.total ?? "";
    hb.appendChild(tr);
  }
  if (!report) renderReportInfo();
}

async function exportDb() {
  const list = dbFiltered();
  if (!list.length) return;
  try {
    const bytes = await buildFromTemplate(list);
    const filtered = list.length !== dbRecords().length;
    const name = `${today()}_정비 예약 관련 DB 목록${filtered ? "_검색결과" : ""}.xlsx`;
    downloadBytes(bytes, name);
    setHint("#dbInfo", `✔ ${name} - ${list.length.toLocaleString()}행`, "ok");
  } catch (e) {
    setHint("#dbInfo", `엑셀을 만들지 못했습니다: ${e.message}`, "err");
  }
}

async function importDb(file) {
  if (!file) return;
  try {
    const info = await analyzeReport(await XlsxTemplate.Workbook.open(new Uint8Array(await file.arrayBuffer())));
    const before = dbRecords().length;
    await addToDb(info.records, file.name);
    renderDb();
    markDuplicates();
    setHint("#dbInfo", `✔ ${file.name} - ${info.records.length.toLocaleString()}행 읽음 (새로 들어간 글 ${dbRecords().length - before}개)`, "ok");
  } catch (e) {
    setHint("#dbInfo", `파일을 읽지 못했습니다: ${e.message}`, "err");
  }
  $("#dbImport").value = "";
}

async function clearDb() {
  if (!confirm(`DB 목록 ${dbRecords().length.toLocaleString()}행과 받은 보고서 기록을 모두 지울까요? (엑셀 파일은 지워지지 않습니다)`)) return;
  db = {};
  history = [];
  await chrome.storage.local.set({ bhDb: db, bhHistory: history }).catch(() => {});
  renderDb();
  markDuplicates();
  setHint("#dbInfo", "DB 를 비웠습니다.");
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

function showTab() {
  const tab = location.hash === "#db" ? "db" : "report";
  $("#tab-report").hidden = tab !== "report";
  $("#tab-db").hidden = tab !== "db";
  for (const a of document.querySelectorAll("nav.menu a")) a.classList.toggle("on", a.dataset.tab === tab);
  if (tab === "db") renderDb();
}

async function init() {
  await loadSettings();
  renderSchedule();
  showTab();
  window.addEventListener("hashchange", showTab);
  renderReportInfo();
  for (const id of ["searchFirst", "searchUrl", "keepGaps", "extraHolidays"]) {
    $(`#${id}`).addEventListener("change", async () => {
      await saveSettings();
      if (id === "extraHolidays") renderSchedule();
      renderItems();
    });
  }
  $("#resetSettings").addEventListener("click", async () => {
    $("#searchFirst").value = DEFAULT_SEARCH_FIRST;
    $("#searchUrl").value = DEFAULT_SEARCH_URL;
    $("#keepGaps").checked = true;
    await saveSettings();
    renderItems();
  });
  $("#listFile").addEventListener("change", (e) => loadListFile(e.target.files[0]));
  $("#reportFile").addEventListener("change", (e) => loadReportFile(e.target.files[0]));
  $("#start").addEventListener("click", run);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    setSummary("중지하는 중… (지금 보는 글까지 마칩니다)");
  });
  $("#save").addEventListener("click", saveReport);
  for (const id of ["dbQuery", "dbFrom", "dbTo"]) $(`#${id}`).addEventListener("input", renderDb);
  $("#dbExport").addEventListener("click", exportDb);
  $("#dbImport").addEventListener("change", (e) => importDb(e.target.files[0]));
  $("#dbClear").addEventListener("click", clearDb);
  window.addEventListener("focus", () => {
    checkLogin();
    renderSchedule();
  });
  checkLogin();
  await restoreLast();
}

init();
