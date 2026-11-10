// GV90 대시보드: 데일리 DB(게시물·댓글·보고일) 기준
//  - 숫자 칸: 최근 보고일 게시물(전일 대비 ▲▼) · 부정+단순비난 비율 · 누적 · 주목 게시물
//  - 보고일별 성향 누적 막대(마우스를 올리면 그날 숫자), 채널·구분·커뮤니티별 막대, 주목 게시물·최근 부정 게시물 표
//  - 색: 성향 4가지(긍정 파랑 · 중립 회색 · 부정 빨강 · 단순비난 보라)만 쓰고, 글자는 글자색으로 (색만으로 구분하지 않게 숫자·이름 함께)

const SENT_VAR = { 긍정: "--pos", 중립: "--neu", 부정: "--neg", 단순비난: "--blame" };
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const tip = () => $("#tip");
function showTip(e, title, rows) {
  const t = tip();
  t.textContent = "";
  t.append(el("b", { text: title }), ...rows.map(([k, v, color]) => el("div", { class: "r" }, el("span", {}, color ? el("i", { style: `display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:${color}` }) : null, k), el("span", { text: v }))));
  t.hidden = false;
  const x = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14);
  t.style.left = `${x}px`;
  t.style.top = `${e.clientY + 14}px`;
}
const hideTip = () => (tip().hidden = true);

let data = null;

async function load() {
  const days = (await listDays()).slice().reverse(); // 오래된 날 → 최근
  const posts = await allPosts();
  const comments = await allComments();
  const runs = await listRuns().catch(() => []);
  data = { days, posts, comments, runs };
  render();
  await renderReport();
}

// ---------------------------------------------------------------------------
// 보고용 대시보드 (gv90-report.js) · 복사
// ---------------------------------------------------------------------------

let rpData = null;
let rpKey = "";

// 그날 수집 후보였지만 보고에 넣지 않은 글: 채널별 건수와 사유 (카드가 0건일 때 '왜 0건인지' 적음)
function excludedByChannel(d, runs, posts) {
  const inDb = new Set(posts.map((p) => p.key));
  const from = d.from || 0;
  const to = d.to || Date.now();
  const out = {};
  const seen = new Set();
  for (const r of runs) {
    const end = r.range?.end || r.finishedAt;
    if (!(end > from && end <= to + 3600e3)) continue;
    for (const x of r.items || []) {
      if (!x.key || seen.has(x.key) || inDb.has(x.key)) continue;
      seen.add(x.key);
      const ch = x.channel;
      const why = x.dup ? "이전 보고에 이미 포함된 글" : /열지 못함/.test(x.note || "") ? "본문을 확인할 수 없는 글(회원 전용·삭제)" : !x.related && !x.direct ? "GV90 관련 내용이 아닌 글(다른 차종 이야기·단순 언급)" : "검토 후 보고 대상에서 제외한 글";
      const o = (out[ch] ||= { n: 0, why: {} });
      o.n++;
      o.why[why] = (o.why[why] || 0) + 1;
    }
  }
  return out;
}

async function renderReport() {
  const n = +$("#rpPeriod").value;
  const days = n ? data.days.slice(-n) : data.days;
  const box = $("#reportBody");
  if (!days.length) {
    rpData = null;
    box.innerHTML = '<div class="empty">데일리 DB 에 보고일이 없습니다. 수집 화면에서 \'엑셀 만들기\'를 누르면 쌓입니다.</div>';
    return;
  }
  rpData = reportData(days, data.posts, data.comments);
  const st = await loadSettings();
  rpData.monitor = monitorText(st);
  // 설정에서 켠 채널은 그날 글이 없어도 카드 자리를 잡음
  rpData.excluded = excludedByChannel(rpData, data.runs || [], data.posts);
  rpData.channelsOn = CHANNELS.filter((ch) => st.channels?.[{ 언론: "news", 유튜브: "youtube", 동호회: "cafe", "자동차 커뮤니티": "community" }[ch]]);
  rpKey = `${days[0].day}-${days[days.length - 1].day}`;
  const { gvReportSummary = {} } = await chrome.storage.local.get("gvReportSummary").catch(() => ({}));
  const saved = gvReportSummary[rpKey];
  box.innerHTML = reportHtml(rpData, { banner: chrome.runtime.getURL("icons/report-banner.jpg"), summary: saved || null, editable: true });
  // 요약 줄을 고치면 그 보고 범위에 저장
  box.querySelectorAll("[data-summary]").forEach((e) => e.addEventListener("input", saveSummary));
}

function summaryLines() {
  return [...$("#reportBody").querySelectorAll("[data-summary]")].map((e) => e.innerText.replace(/^\s*•\s*/, "").trim()).filter(Boolean);
}

async function saveSummary() {
  const { gvReportSummary = {} } = await chrome.storage.local.get("gvReportSummary").catch(() => ({}));
  gvReportSummary[rpKey] = summaryLines();
  await chrome.storage.local.set({ gvReportSummary }).catch(() => {});
}

function rpCopied(ok, msg) {
  $("#rpInfo").textContent = ok ? `✔ ${msg}` : `복사하지 못했습니다${msg ? `: ${msg}` : ""}. 다시 눌러 주세요.`;
  $("#rpInfo").className = ok ? "hint ok" : "hint err";
}

// 복사 이벤트로 서식(html)·글자를 함께 담는다 (안 되면 클립보드 API)
function copyRich(html, text, okMsg, btn) {
  let done = false;
  const onCopy = (e) => {
    if (html) e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    document.execCommand("copy");
  } catch {}
  document.removeEventListener("copy", onCopy);
  const ok = () => {
    rpCopied(true, okMsg);
    celebrate(btn, "✔ 복사!");
  };
  if (done) return ok();
  const items = { "text/plain": new Blob([text], { type: "text/plain" }) };
  if (html) items["text/html"] = new Blob([html], { type: "text/html" });
  navigator.clipboard.write([new ClipboardItem(items)]).then(ok).catch((e) => rpCopied(false, e.message));
}

function copyReport(withImage, btn) {
  if (!rpData) return;
  const lines = summaryLines();
  const body = reportHtml(rpData, { banner: withImage ? RP_BANNER_URL : "", summary: lines });
  copyRich(`<html><body>${body}</body></html>`, reportText(rpData, lines), `${withImage ? "" : "이미지 없이 "}복사했습니다. 메일 본문에 붙여 넣으세요 (⌘V / Ctrl+V).${withImage ? " 붙여 넣기가 안 되면 '이미지 없이 복사'를 눌러 보세요." : ""}`, btn);
}

// 메일 편집기 'HTML' 탭에 붙여 넣을 코드 (서식 붙여 넣기를 거부하는 편집기용)
function copyReportCode(btn) {
  if (!rpData) return;
  const code = reportHtml(rpData, { banner: RP_BANNER_URL, summary: summaryLines() });
  copyRich("", code, "HTML 코드를 복사했습니다. 메일 편집기의 'HTML' 탭 → 넣을 자리에 붙여 넣기 → 다시 '디자인' 탭으로 돌아오면 대시보드가 보입니다.", btn);
}

$("#rpPeriod").addEventListener("change", renderReport);
$("#rpCopy").addEventListener("click", (e) => copyReport(true, e.currentTarget));
$("#rpCopyLite").addEventListener("click", (e) => copyReport(false, e.currentTarget));
$("#rpCopyCode").addEventListener("click", (e) => copyReportCode(e.currentTarget));
$("#rpResetSummary").addEventListener("click", async () => {
  const { gvReportSummary = {} } = await chrome.storage.local.get("gvReportSummary").catch(() => ({}));
  delete gvReportSummary[rpKey];
  await chrome.storage.local.set({ gvReportSummary }).catch(() => {});
  renderReport();
});

function render() {
  const n = +$("#period").value;
  const ch = $("#chFilter").value;
  const days = n ? data.days.slice(-n) : data.days;
  const daySet = new Set(days.map((d) => d.day));
  const posts = data.posts.filter((p) => daySet.has(p.day) && (!ch || p.channel === ch));
  const comments = data.comments.filter((c) => daySet.has(c.day));
  $("#asof").textContent = days.length ? `${prettyDay(days[0].day)} ~ ${prettyDay(days[days.length - 1].day)} · 보고일 ${days.length}일 · 게시물 ${posts.length.toLocaleString()}건` : "데일리 DB 에 보고일이 없습니다";
  renderTiles(days, posts, ch);
  renderTrend(days, posts);
  renderBars("#byChannel", group(posts, (p) => p.channel), CHANNELS);
  renderBars("#byCategory", group(posts.flatMap((p) => catList(p.category).map((c) => ({ ...p, category: c }))), (p) => p.category), CATEGORIES);
  renderBars("#byCommunity", group(posts, (p) => p.media || "-"), null, 12);
  renderComments(comments);
  renderTable("#hotTable", posts.filter((p) => p.views != null || p.ccount != null).sort((a, b) => (b.ccount || 0) * 50 + (b.views || 0) - ((a.ccount || 0) * 50 + (a.views || 0))).slice(0, 15));
  renderTable("#negTable", posts.filter((p) => p.sentiment === "부정" || p.sentiment === "단순비난").sort((a, b) => b.day.localeCompare(a.day) || (b.date || 0) - (a.date || 0)).slice(0, 20));
}

function group(list, keyFn) {
  const m = new Map();
  for (const p of list) {
    const k = keyFn(p);
    if (!m.has(k)) m.set(k, Object.fromEntries(SENTIMENTS.map((s) => [s, 0])));
    const g = m.get(k);
    g[p.sentiment || "중립"] = (g[p.sentiment || "중립"] || 0) + 1;
  }
  return m;
}

const total = (g) => SENTIMENTS.reduce((s, x) => s + (g[x] || 0), 0);
const badOf = (g) => (g.부정 || 0) + (g.단순비난 || 0);

function tile(k, v, d, cls = "") {
  return el("div", { class: `tile ${cls}` }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }), d ? el("div", { class: "d" }, d) : null);
}

function diffEl(now, before) {
  if (before == null) return el("span", { class: "diff none", text: "전 기록 없음" });
  const d = now - before;
  return el("span", { class: `diff ${d > 0 ? "up" : d < 0 ? "down" : "none"}`, text: `${d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : "– 0"} (전 보고일 대비)` });
}

function renderTiles(days, posts, ch) {
  const box = $("#tiles");
  box.textContent = "";
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const cnt = (d) => (d ? (ch ? d.stats?.byChannel?.[ch] || 0 : d.stats?.posts || 0) : null);
  const lastPosts = last ? posts.filter((p) => p.day === last.day) : [];
  const g = Object.fromEntries(SENTIMENTS.map((s) => [s, posts.filter((p) => p.sentiment === s).length]));
  const lastBad = lastPosts.filter((p) => p.sentiment === "부정" || p.sentiment === "단순비난").length;
  const prevBad = prev ? data.posts.filter((p) => p.day === prev.day && (!ch || p.channel === ch) && (p.sentiment === "부정" || p.sentiment === "단순비난")).length : null;
  box.append(
    tile(last ? `${prettyDay(last.day)} 보고 게시물` : "최근 보고 게시물", last ? `${cnt(last).toLocaleString()}건` : "-", last ? diffEl(cnt(last), cnt(prev)) : null),
    tile("그날 부정 + 단순비난", last ? `${lastBad}건` : "-", last ? diffEl(lastBad, prevBad) : null),
    tile("기간 부정 + 단순비난 비율", posts.length ? `${Math.round((badOf(g) / posts.length) * 100)}%` : "-", el("span", { text: `부정 ${g.부정} · 단순비난 ${g.단순비난} / ${posts.length}건` })),
    tile("기간 긍정 비율", posts.length ? `${Math.round((g.긍정 / posts.length) * 100)}%` : "-", el("span", { text: `긍정 ${g.긍정}건 · 중립 ${g.중립}건` })),
    tile("🔥 주목 게시물", `${posts.filter(isHot).length}건`, el("span", { text: "조회 1,000↑ · 댓글 20↑ · 강한 비판" })),
    tile("누적 게시물 (데일리 DB 전체)", `${data.posts.length.toLocaleString()}건`, el("span", { text: `보고일 ${data.days.length}일` })),
  );
}

// 보고일별 성향 누적 막대 (막대 사이 2px · 위쪽 끝만 둥글게 · 마우스를 올리면 그날 숫자)
function renderTrend(days, posts) {
  const leg = $("#trendLegend");
  leg.textContent = "";
  for (const s of SENTIMENTS) leg.append(el("span", {}, el("i", { style: `background:var(${SENT_VAR[s]})` }), s));
  const box = $("#trend");
  box.textContent = "";
  if (!days.length) return box.append(el("div", { class: "empty", text: "데일리 DB 에 보고일이 없습니다. 수집 화면에서 '엑셀 만들기'를 누르면 쌓입니다." }));
  const byDay = new Map(days.map((d) => [d.day, Object.fromEntries(SENTIMENTS.map((s) => [s, 0]))]));
  for (const p of posts) if (byDay.has(p.day)) byDay.get(p.day)[p.sentiment || "중립"]++;
  const W = 960;
  const H = 260;
  const pad = { l: 36, r: 8, t: 12, b: 28 };
  const max = Math.max(1, ...[...byDay.values()].map(total));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = Math.max(4, Math.min(36, iw / days.length - 4));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "보고일별 게시물 성향 막대 차트" });
  const grid = svgEl("g", { class: "grid" });
  for (let v = 0; v <= top; v += step) {
    const y = pad.t + ih - (v / top) * ih;
    grid.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, "stroke-width": 1 }));
    const t = svgEl("text", { x: pad.l - 6, y: y + 4, "text-anchor": "end" });
    t.textContent = v;
    grid.append(t);
  }
  svg.append(grid);
  const labelEvery = Math.ceil(days.length / 12);
  days.forEach((d, i) => {
    const g = byDay.get(d.day);
    const cx = pad.l + (iw / days.length) * (i + 0.5);
    let y = pad.t + ih;
    const segs = SENTIMENTS.filter((s) => g[s]);
    segs.forEach((s, j) => {
      const h = (g[s] / top) * ih;
      const last = j === segs.length - 1;
      const rect = svgEl(last ? "path" : "rect", last ? { d: roundTop(cx - bw / 2, y - h, bw, Math.max(0, h - (j ? 2 : 0)), Math.min(4, bw / 2)), fill: `var(${SENT_VAR[s]})` } : { x: cx - bw / 2, y: y - h + (j ? 0 : 0), width: bw, height: Math.max(0, h - 2), fill: `var(${SENT_VAR[s]})` });
      svg.append(rect);
      y -= h;
    });
    if (i % labelEvery === 0 || i === days.length - 1) {
      const t = svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "axis" });
      t.textContent = `${+d.day.slice(4, 6)}/${+d.day.slice(6, 8)}`;
      svg.append(t);
    }
    // 마우스 영역 (막대보다 넓게)
    const hit = svgEl("rect", { x: pad.l + (iw / days.length) * i, y: pad.t, width: iw / days.length, height: ih, fill: "transparent" });
    hit.addEventListener("mousemove", (e) => showTip(e, `${prettyDay(d.day)} 보고 · ${total(g)}건`, SENTIMENTS.map((s) => [s, `${g[s]}건`, cssVar(SENT_VAR[s])])));
    hit.addEventListener("mouseleave", hideTip);
    svg.append(hit);
  });
  // 마지막 날 합계 글자
  const lastG = byDay.get(days[days.length - 1].day);
  const lx = pad.l + (iw / days.length) * (days.length - 0.5);
  const lt = svgEl("text", { x: lx, y: pad.t + ih - (total(lastG) / top) * ih - 6, "text-anchor": "middle", style: "font-weight:700" });
  lt.textContent = total(lastG);
  svg.append(lt);
  box.append(svg);
}

function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

// 위쪽 모서리만 둥근 막대
function roundTop(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// 가로 막대 (성향별 조각 · 조각 사이 2px · 이름·건수 글자)
function renderBars(sel, groups, order, limit = 0) {
  const box = $(sel);
  box.textContent = "";
  let keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()];
  if (!order) keys.sort((a, b) => total(groups.get(b)) - total(groups.get(a)));
  if (limit) keys = keys.slice(0, limit);
  if (!keys.length) return box.append(el("div", { class: "empty", text: "자료 없음" }));
  const max = Math.max(...keys.map((k) => total(groups.get(k))));
  for (const k of keys) {
    const g = groups.get(k);
    const n = total(g);
    const track = el("div", { class: "track" });
    const inner = el("div", { style: `display:flex;gap:2px;height:100%;width:${(n / max) * 100}%` });
    for (const s of SENTIMENTS) if (g[s]) inner.append(el("div", { class: "seg", style: `flex:${g[s]};background:var(${SENT_VAR[s]})` }));
    track.append(inner);
    const row = el("div", { class: "bar-row" }, el("div", { class: "name", title: k, text: k }), track, el("div", { class: "n", text: n.toLocaleString() }));
    row.addEventListener("mousemove", (e) => showTip(e, `${k} · ${n}건 (부정+단순비난 ${Math.round((badOf(g) / n) * 100)}%)`, SENTIMENTS.map((s) => [s, `${g[s]}건`, cssVar(SENT_VAR[s])])));
    row.addEventListener("mouseleave", hideTip);
    box.append(row);
  }
}

function renderComments(comments) {
  const box = $("#commentBox");
  box.textContent = "";
  if (!comments.length) {
    box.append(el("div", { class: "empty" }, "댓글 수집은 준비 중입니다.", el("br"), el("span", { class: "hint", text: "데일리 DB·엑셀('댓글' 시트)·이 칸은 이미 준비되어 있어, 댓글 수집을 붙이면 댓글 수와 댓글 성향이 여기에 바로 나옵니다." })));
    return;
  }
  // ① 전체 댓글 성향: 큰 막대 + 성향별 건수·비율
  const g = group(comments, () => "all").get("all");
  const n = total(g);
  const bad = badOf(g);
  const big = el("div", { class: "cbig" });
  for (const x of SENTIMENTS) if (g[x]) big.append(el("div", { class: "seg", style: `flex:${g[x]};background:var(${SENT_VAR[x]})`, title: `${x} ${g[x]}개` }));
  box.append(
    el("div", { class: "chead" },
      el("div", {}, el("span", { class: "cnum", text: n.toLocaleString() }), el("span", { class: "hint", text: " 개 댓글" })),
      el("div", { class: `cbad${bad / n >= 0.3 ? " hot" : ""}`, text: `부정+단순비난 ${Math.round((bad / n) * 100)}%` }),
    ),
    big,
    el("div", { class: "clegend" }, ...SENTIMENTS.map((x) => el("span", {}, sentiChip(x), el("b", { text: ` ${(g[x] || 0).toLocaleString()}` }), el("span", { class: "hint", text: ` (${n ? Math.round(((g[x] || 0) / n) * 100) : 0}%)` })))),
  );
  // ② 채널별 댓글 성향
  box.append(el("h3", { class: "csub", text: "채널별 댓글 성향" }));
  const bars = el("div", { class: "bars", id: "commentBars" });
  box.append(bars);
  renderBars("#commentBars", group(comments, (c) => c.channel || "-"), CHANNELS);
  // ③ 부정 댓글이 많은 게시글 (상위 5)
  const byPost = new Map();
  for (const c of comments) {
    const k = c.postKey || c.url;
    if (!byPost.has(k)) byPost.set(k, { url: c.url, title: c.postTitle || c.url, channel: c.channel, media: c.media, n: 0, bad: 0 });
    const o = byPost.get(k);
    o.n++;
    if (c.sentiment === "부정" || c.sentiment === "단순비난") o.bad++;
  }
  const top = [...byPost.values()].filter((o) => o.bad).sort((a, b) => b.bad - a.bad || b.n - a.n).slice(0, 5);
  box.append(el("h3", { class: "csub", text: "부정 댓글이 많은 게시글" }));
  if (!top.length) box.append(el("div", { class: "hint", text: "부정·단순비난 댓글이 있는 게시글이 없습니다." }));
  for (const o of top) {
    box.append(
      el("div", { class: "ctop" },
        chChip(o.channel),
        el("a", { href: o.url, target: "_blank", text: o.title, title: `${o.media || ""} · ${o.title}` }),
        el("span", { class: "cbadn", text: `부정 ${o.bad}` }),
        el("span", { class: "hint", text: ` / ${o.n}개` }),
      ),
    );
  }
}

function renderTable(sel, list) {
  const tb = $(`${sel} tbody`);
  tb.textContent = "";
  if (!list.length) return tb.append(el("tr", {}, el("td", { colspan: 7, class: "empty", text: "해당 게시물 없음" })));
  for (const p of list) {
    tb.append(
      el("tr", {},
        el("td", { class: "nowrap", text: prettyDay(p.day).slice(5) }),
        el("td", {}, chChip(p.channel)),
        el("td", { class: "nowrap", text: p.media }),
        el("td", { class: "url" }, countsBadge(p), el("a", { href: p.url, target: "_blank", text: p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40) })),
        el("td", { text: p.summary || p.title }),
        el("td", { class: "nowrap", text: p.category || "" }),
        el("td", {}, sentiChip(p.sentiment)),
      ),
    );
  }
}

$("#period").addEventListener("change", render);
$("#chFilter").addEventListener("change", render);
const dashInit = load();
