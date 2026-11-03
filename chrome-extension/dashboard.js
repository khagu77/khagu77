// 최종 DB 화면 맨 위 '오늘의 대시보드': 그날의 게시물·댓글 건수와 전일 대비, 누적을 한눈에.
// 메일 본문에 그대로 붙여 넣을 수 있게 표 구조 + 직접 지정한 서식(인라인 스타일)으로 만들고, 화면에도 같은 것을 보여 준다.

const DASH_FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";
const DASH_CH = [
  { label: "언론", color: "#002c5f" },
  { label: "동호회", color: "#03c75a" },
  { label: "유튜브", color: "#ff0000" },
  { label: "자동차 커뮤니티", color: "#7b3fe4" },
];

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (n) => Number(n || 0).toLocaleString();

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${prettyDate(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`).slice(5, 10)} 12:00`; // 보고 기준 시각은 항상 12:00 으로 표시
};

// 대시보드에 쓸 숫자 모으기 (게시물 리스트의 가장 최근 날짜 기준)
async function dashData() {
  const buzz = await dbList("buzz").catch(() => []);
  const raw = await dbList("raw").catch(() => []);
  if (!buzz.length && !raw.length) return null;
  const date = buzz[0]?.date || raw[0]?.date;
  const bi = buzz.findIndex((r) => r.date === date);
  const ri = raw.findIndex((r) => r.date === date);
  const b = bi >= 0 ? statDiffs("buzz", buzz, bi) : { total: null, channels: [] };
  const r = ri >= 0 ? statDiffs("raw", raw, ri) : { total: null, channels: [] };
  const cur = buzz[bi];
  const prevEnd = buzz.slice(bi + 1).find((x) => x.rangeEnd)?.rangeEnd;
  const lastSerial = (cur?.summary || "").match(/마지막 순번 ([\d,]+)/)?.[1] || "";
  const rawLast = (raw[ri >= 0 ? ri : 0]?.summary || "").split("\n").slice(1).join(" · ");
  const detail = await dashDetail(cur, raw[ri >= 0 ? ri : -1]).catch(() => null);
  // 유튜브 신규 댓글: 그날 파일과 전날 파일의 유튜브 시트를 비교해 전날에 없던 댓글 수 (전일 대비용으로 전날 것도)
  const ytNew = ri >= 0 ? await dashYtNew(raw[ri], raw[ri + 1]).catch(() => null) : null;
  const ytNewPrev = ri >= 0 && ytNew != null ? await dashYtNew(raw[ri + 1], raw[ri + 2]).catch(() => null) : null;
  return {
    date,
    detail,
    ytNew,
    ytNewPrev,
    period: cur?.rangeEnd && prevEnd ? `${hhmm(prevEnd)} ~ ${hhmm(cur.rangeEnd)}` : "",
    posts: b,
    comments: r,
    lastSerial,
    rawLast,
  };
}

// 유튜브 시트의 댓글 열쇠 (영상 주소 | 작성일 | 내용)
async function dashYtKeys(rec) {
  const wb = await XlsxTemplate.Workbook.open(rec.bytes);
  if (!wb.sheetNames().includes("유튜브")) return null;
  const keys = new Set();
  for (const r of await wb.readRows("유튜브")) {
    if (r.r <= 1 || !r.cells.E) continue;
    keys.add(`${dashUrlKey(r.cells.E)}|${String(r.cells.C ?? "").trim()}|${String(r.cells.D ?? "").trim()}`);
  }
  return keys;
}

// rec 날의 유튜브 신규 댓글 수 = rec 유튜브 시트 중 prev 날 시트에 없던 댓글 (비교할 전날 파일이 없으면 null)
async function dashYtNew(rec, prev) {
  if (!rec?.bytes || !prev?.bytes) return null;
  const [a, b] = [await dashYtKeys(rec), await dashYtKeys(prev)];
  if (!a || !b) return null;
  let n = 0;
  for (const k of a) if (!b.has(k)) n++;
  return n;
}

// ── 채널 상세: 그날 엑셀을 직접 읽어 출처(동호회·유튜브 채널·언론사·커뮤니티 사이트)별 게시글·댓글 수 ──
const DASH_SHEETS = { 동호회: "comments", 언론: "news", "자동차 커뮤니티": "community" };

// 같은 글인지 비교하는 열쇠 (유튜브 영상 ID · 카페 글 번호 · 그 밖은 주소)
function dashUrlKey(u) {
  u = String(u || "").trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([\w-]{11})(?![\w-])/);
  if (yt) return `yt:${yt[1]}`;
  if (/cafe\.naver\.com/.test(u)) {
    const a = parseArticleUrl(u).articleId;
    if (a) return `cafe:${a}`;
  }
  return u.toLowerCase().replace(/^https?:\/\//, "").replace(/^(www|m)\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

async function dashDetail(buzzRec, rawRec) {
  const out = Object.fromEntries(DASH_CH.map(({ label }) => [label, new Map()]));
  const bump = (ch, name, field, n = 1) => {
    if (!out[ch]) return;
    const k = String(name || "기타").trim() || "기타";
    const v = out[ch].get(k) || { posts: 0, comments: 0, vids: new Set() };
    v[field] += n;
    out[ch].set(k, v);
    return v;
  };
  const where = new Map(); // 글 열쇠 → { ch, name } (게시물 리스트 전체에서)
  let hasPosts = false;
  if (buzzRec?.bytes) {
    const wb = await XlsxTemplate.Workbook.open(buzzRec.bytes);
    const names = wb.sheetNames();
    const sheet = names.includes("채널별 버즈량 현황") ? "채널별 버즈량 현황" : names[0];
    const rows = (await wb.readRows(sheet)).filter((r) => r.r > 3 && r.cells.G);
    for (const r of rows) where.set(dashUrlKey(r.cells.G), { ch: String(r.cells.C || "동호회").trim(), name: r.cells.D });
    // 그날 새로 넣은 글 = 마지막 순번부터 그날 건수만큼
    const posts = buzzRec.stats?.posts;
    if (posts != null) {
      hasPosts = true;
      const serials = rows.map((r) => Number(r.cells.B)).filter(Number.isFinite);
      const last = Math.max(0, ...serials);
      for (const r of rows) if (Number(r.cells.B) > last - posts) {
        const v = bump(String(r.cells.C || "동호회").trim(), r.cells.D, "posts");
        if (v && String(r.cells.C || "").trim() === "유튜브") v.vids.add(dashUrlKey(r.cells.G));
      }
    }
  }
  let hasComments = false;
  if (rawRec?.bytes) {
    const wb = await XlsxTemplate.Workbook.open(rawRec.bytes);
    const names = wb.sheetNames();
    const has = (r) => Object.values(r.cells).some((v) => v !== undefined && v !== "");
    const nameOf = (url, fallback) => where.get(dashUrlKey(url))?.name || fallback;
    for (const [ch, field] of Object.entries(DASH_SHEETS)) {
      const n = rawRec.stats?.[field];
      if (!n || !names.includes(ch)) continue;
      hasComments = true;
      const rows = (await wb.readRows(ch)).filter((r) => r.r > 1 && has(r)).sort((a, b) => a.r - b.r).slice(-n);
      for (const r of rows) bump(ch, nameOf(r.cells.E, ch === "자동차 커뮤니티" ? r.cells.B : "기타"), "comments");
    }
    if (names.includes("유튜브")) {
      const rows = (await wb.readRows("유튜브")).filter((r) => r.r > 1 && has(r));
      if (rows.length) hasComments = true;
      // 유튜브: 지켜보는 영상(시트에 있는 영상 전체) 수도 채널별로
      for (const r of rows) bump("유튜브", nameOf(r.cells.E, "기타 영상"), "comments").vids.add(dashUrlKey(r.cells.E));
    }
  }
  if (!hasPosts && !hasComments) return null;
  return Object.fromEntries(
    Object.entries(out).map(([ch, m]) => [ch, [...m.entries()].map(([name, { vids, ...v }]) => ({ name, ...v, videos: vids.size })).sort((a, b) => b.posts + b.comments - (a.posts + a.comments) || a.name.localeCompare(b.name))]),
  );
}

// 메일 프로그램이 칸 폭을 멋대로 바꾸지 않게 폭을 픽셀로 고정 (전체 960 = 왼쪽 200 + 오른쪽 760)
const DASH_CELL = 216; // 네 칸 모두 같은 폭

// 이름을 정해진 폭(대략 글자 수, 영문·숫자는 0.6자)에 맞게 미리 줄임 — 메일에서는 자동 줄임이 안 됨
// (그룹웨어 메일 편집기가 '…' 문자·title 속성이 든 붙여 넣기를 거부해서 '..' 만 씀)
function dashClip(name, em) {
  let w = 0;
  let out = "";
  for (const ch of String(name)) {
    const cw = /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef★☆]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.7 : ch === " " ? 0.35 : 0.55;
    if (w + cw > em) return out.trimEnd() + "..";
    w += cw;
    out += ch;
  }
  return out;
}

const DASH_TOP = Infinity; // 출처는 모두 표시 (묶지 않음)

const dashSmallBadge = (d) => {
  if (!d || d.diff == null) return `<span style="color:#a0a5ad;font-size:10px;">전일 없음</span>`;
  if (d.diff > 0) return `<span style="color:#d93025;font-size:11px;font-weight:700;">▲${num(d.diff)}</span>`;
  if (d.diff < 0) return `<span style="color:#1a5fd0;font-size:11px;font-weight:700;">▼${num(-d.diff)}</span>`;
  return `<span style="color:#a0a5ad;font-size:11px;">-</span>`;
};

// 채널 한 칸: 위에 게시글·댓글 건수(전일 대비), 아래에 출처별 상세(많은 순)
function dashChannelCell({ label, color }, data, fluid = false) {
  const yt = label === "유튜브";
  const p = data.posts.channels.find((x) => x.label === label);
  const c = data.comments.channels.find((x) => x.label === label);
  const list = data.detail?.[label] || [];
  const unitName = yt ? "채널" : label === "언론" ? "언론사" : label === "동호회" ? "동호회" : "사이트";
  const stat = (title, x) =>
    `<td width="50%" style="width:50%;padding:4px 6px;background:#f6f8fa;border-radius:6px;white-space:nowrap;">` +
    `<div style="font-size:10px;color:#6b7079;font-weight:600;white-space:nowrap;">${title}</div>` +
    `<div style="white-space:nowrap;"><b style="font-size:17px;color:#1b1d21;white-space:nowrap;">${x ? num(x.d.today) : "-"}</b>` +
    `<span style="font-size:11px;color:#6b7079;">건</span></div>` +
    `<div style="white-space:nowrap;line-height:1.2;">${x ? dashSmallBadge(x.d) : "&nbsp;"}</div></td>`;
  const cellStyle = "padding:2px 3px;font-size:11px;border-top:1px solid #eef0f3;";
  const n0 = (v) => (v ? num(v) : `<span style="color:#c4c8ce;">0</span>`);
  // 유튜브는 지켜보는 영상 전체 수 (오늘 새로 넣은 영상은 +n)
  const plus = (n) => (n ? `<span style="color:#d93025;font-size:10px;font-weight:700;"> +${num(n)}</span>` : "");
  const first = (x) => (yt ? `${n0(x.videos)}${plus(x.posts)}` : n0(x.posts));
  const W1 = yt ? 34 : 24; // 글(영상) 칸 폭
  const W2 = 36; // 댓글 칸 폭
  const cw = DASH_CELL;
  const pct = "25%";
  // 이름 칸에 들어가는 글자 수 (한글 1자 ≈ 11.6px; 칸 폭 − 여백 − 숫자 칸)
  const nameEm = Math.max(4, (cw - 34 - W1 - W2) / 11);
  const row = (x) =>
    `<tr><td style="${cellStyle}color:#1b1d21;white-space:nowrap;overflow:hidden;line-height:1.3;">${fluid ? `<a data-alias="${esc(x.name)}" style="color:inherit;text-decoration:none;cursor:pointer;">` : ""}${esc(dashClip(dashShort(x.name), nameEm))}${fluid ? "</a>" : ""}` +
    `</td>` +
    `<td width="${W1}" style="${cellStyle}width:${W1}px;text-align:right;font-weight:700;color:#1b1d21;white-space:nowrap;">${first(x)}</td>` +
    `<td width="${W2}" style="${cellStyle}width:${W2}px;text-align:right;font-weight:700;color:${color};white-space:nowrap;">${n0(x.comments)}</td></tr>`;
  const rest = list.slice(DASH_TOP);
  const sum = (arr, f) => arr.reduce((s, x) => s + x[f], 0);
  const head = (t, w) => `<td width="${w}" style="width:${w}px;padding:2px 3px;font-size:10px;color:#8a8f98;text-align:right;white-space:nowrap;">${t}</td>`;
  const detail = data.detail
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6px;">` +
      `<tr><td style="padding:2px 3px;font-size:10px;color:#8a8f98;white-space:nowrap;">${unitName}별 (${list.length})</td>${head(yt ? "영상" : "글", W1)}${head("댓글", W2)}</tr>` +
      (list.length ? list.slice(0, DASH_TOP).map(row).join("") : `<tr><td colspan="3" style="${cellStyle}color:#a0a5ad;">해당 없음</td></tr>`) +
      (rest.length
        ? `<tr><td style="${cellStyle}color:#8a8f98;">외 ${rest.length}곳</td><td style="${cellStyle}text-align:right;color:#8a8f98;">${num(sum(rest, yt ? "videos" : "posts"))}${yt && sum(rest, "posts") ? ` +${num(sum(rest, "posts"))}` : ""}</td>` +
          `<td style="${cellStyle}text-align:right;color:#8a8f98;">${num(sum(rest, "comments"))}</td></tr>`
        : "") +
      `</table>`
    : "";
  return (
    `<td width="${fluid ? pct : cw}" style="width:${fluid ? pct : `${cw}px`};padding:0;vertical-align:top;">` +
    `<div style="margin:0 4px;border:1px solid #e3e6eb;border-top:3px solid ${color};border-radius:8px;padding:6px 7px;background:#ffffff;">` +
    `<div style="display:inline-block;background:${color};color:#fff;font-weight:700;font-size:11px;padding:1px 8px;border-radius:999px;">${esc(label)}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="3" style="width:100%;border-collapse:separate;table-layout:fixed;margin-top:3px;"><tr>` +
    stat(yt ? "새 영상" : "게시글", p) +
    stat(yt ? "댓글(전체)" : "댓글", c) +
    `</tr></table>` +
    detail +
    `</div></td>`
  );
}

// 메일·화면 공통 대시보드 HTML (carSrc: 차량 이미지 주소 — 화면은 확장 안 주소, 메일 복사는 그림을 글자로 담은 주소)
// 왼쪽: 차량 이미지와 제목 · 날짜 · 합계 · 누적 / 오른쪽: 네 채널 칸
function dashHtml(data, carSrc, fluid = false) {
  const total = data.posts.total;
  const cTotal = dashCommentTotal(data);
  const ytC = data.comments.channels.find((x) => x.label === "유튜브");
  const yellow = (d) => (!d || d.diff == null ? "" : d.diff > 0 ? `▲${num(d.diff)}` : d.diff < 0 ? `▼${num(-d.diff)}` : "변동 없음");
  const W = (px) => (fluid ? "100%" : px); // 화면은 꽉 채우고, 메일은 픽셀 고정 (메일 프로그램이 칸 폭을 바꾸지 않게)
  const Wcss = (px) => (fluid ? "100%" : `${px}px`);
  // 메일용: 바깥 표는 너비를 정하지 않고 내용에 맞춰 늘어나게 (메일마다 여백을 너비에 넣고 빼는 방식이 달라 어긋나지 않게)
  // 너비를 정한 칸에는 여백을 두지 않고, 여백은 안쪽 상자에
  // 테두리·둥근 모서리는 표가 아니라 감싸는 상자에 (메일 프로그램마다 표의 둥근 테두리를 다르게 그림)
  // 안쪽 표는 바탕을 투명하게 — 네이버 메일은 넘침 자르기를 지워서, 네모난 흰 바탕이 둥근 모서리를 덮어 버림
  return `<div style="${fluid ? "display:block;" : "display:inline-block;"}border:1px solid #d9dde3;border-radius:12px;overflow:hidden;background:#ffffff;">
<table${fluid ? ' width="100%"' : ""} cellpadding="0" cellspacing="0" style="${fluid ? "width:100%;" : ""}border-collapse:collapse;border:0;font-family:${DASH_FONT};background:transparent;background-color:transparent;">
  <tr>
  <td width="228" rowspan="2" bgcolor="#002c5f" style="width:228px;vertical-align:top;background:#002c5f;background-color:#002c5f;padding:0;color:#ffffff;border-radius:11px 0 0 11px;">
    <div style="padding:14px 14px 12px;${fluid ? "" : "width:200px;"}">
    <div style="font-size:11px;color:#c3cfdd;line-height:1.35;">팰리세이드(LX3) 전동 시트<br>관련 온라인 동향</div>
    <div style="color:#ffffff;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:900;line-height:1.05;margin-top:4px;letter-spacing:0.3px;">DASHBOARD</div>
    ${carSrc ? `<div align="center" style="text-align:center;margin:8px 0 6px;"><img src="${carSrc}" width="138" alt="PALISADE" style="display:inline-block;border:0;"></div>` : `<div style="height:8px;line-height:8px;font-size:1px;">&nbsp;</div>`}
    <div style="font-size:13px;font-weight:700;color:#ffffff;">${esc(prettyDate(data.date))}</div>
    ${data.period ? `<div style="font-size:10px;color:#c3cfdd;margin-top:1px;">수집 ${esc(data.period)}</div>` : ""}
    <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#002c5f" style="margin-top:8px;border-top:1px solid #4d6b8f;background:#002c5f;background-color:#002c5f;"><tr>
      <td width="50%" bgcolor="#002c5f" style="padding-top:6px;color:#ffffff;vertical-align:top;background-color:#002c5f;"><div style="font-size:10px;color:#c3cfdd;line-height:1.3;">오늘의 신규<br>게시물 수</div>
        <div style="font-size:20px;font-weight:800;color:#ffffff;">${total ? num(total.today) : "-"}<span style="font-size:11px;color:#ffffff;">건</span></div>
        <div style="font-size:11px;font-weight:700;color:#ffd166;">${yellow(total)}</div></td>
      <td width="50%" bgcolor="#002c5f" style="padding-top:6px;color:#ffffff;vertical-align:top;background-color:#002c5f;"><div style="font-size:10px;color:#c3cfdd;line-height:1.3;">오늘의 신규<br>댓글 수</div>
        <div style="font-size:20px;font-weight:800;color:#ffffff;">${cTotal ? num(cTotal.today) : "-"}<span style="font-size:11px;color:#ffffff;">건</span></div>
        <div style="font-size:11px;font-weight:700;color:#ffd166;">${yellow(cTotal)}</div>
        ${ytC ? `<div style="font-size:10px;color:#c3cfdd;line-height:1.35;white-space:nowrap;">${data.ytNew != null ? `유튜브 신규 ${num(data.ytNew)} 포함` : "유튜브 신규 미포함"}<br>유튜브 전체 ${num(ytC.d.today)}</div>` : ""}</td>
    </tr></table>
    <div style="font-size:10px;color:#b8c5d6;margin-top:6px;line-height:1.5;">누적 게시물 순번 ${esc(data.lastSerial || "-")}${data.rawLast ? `<br>댓글 연번 ${esc(data.rawLast)}` : ""}</div>
    </div>
  </td>
  <td style="vertical-align:top;padding:10px 8px 0 6px;height:1px;background:transparent;border-radius:0 11px 0 0;">
    <table width="${W(DASH_CELL * 4)}" cellpadding="0" cellspacing="0" style="width:${Wcss(DASH_CELL * 4)};${fluid ? "" : `min-width:${DASH_CELL * 4}px;`}border-collapse:collapse;table-layout:fixed;"><tr>
      ${DASH_CH.map((ch) => dashChannelCell(ch, data, fluid)).join("")}
    </tr></table>
  </td>
  </tr>
  <tr><td align="right" style="vertical-align:bottom;text-align:right;padding:6px 12px 8px 6px;background:transparent;border-radius:0 0 11px 0;">
    <div align="right" style="font-size:10px;color:#4a4f57;text-align:right;">※ <span style="color:#d93025;font-weight:700;">▲</span><span style="color:#1a5fd0;font-weight:700;">▼</span> 전일 대비 · 댓글은 그날 새로 모은 건수(유튜브는 시트 전체) · 출처별은 많은 순</div>
  </td></tr>
</table></div>`;
}

// 오늘의 신규 댓글 수와 전일 대비: 언론·동호회·자동차 커뮤니티는 그날 새로 모은 댓글
// 유튜브는 전날 파일과 비교한 신규 댓글 수를 더함 (전날 파일이 없으면 유튜브는 빼고)
function dashCommentTotal(data) {
  const ch = data.comments.channels.filter((x) => x.label !== "유튜브");
  if (!ch.length && data.ytNew == null) return null;
  const today = ch.reduce((s, x) => s + (x.d.today || 0), 0) + (data.ytNew || 0);
  if (ch.every((x) => x.d.prev == null) || (data.ytNew != null && data.ytNewPrev == null)) return { today, diff: null };
  const prev = ch.reduce((s, x) => s + (x.d.prev || 0), 0) + (data.ytNew != null ? data.ytNewPrev : 0);
  return { today, diff: today - prev };
}

// 메일에 그냥 글로 붙여 넣을 때 (서식 없는 곳)
function dashText(data) {
  const line = (label, c, unit = "건") => {
    if (!c) return "";
    const d = c.d || c;
    const diff = d.diff == null ? "전일 기록 없음" : d.diff > 0 ? `▲${num(d.diff)}` : d.diff < 0 ? `▼${num(-d.diff)}` : "변동 없음";
    return `${label} ${num(d.today)}${unit} (${diff})`;
  };
  const posts = data.posts.channels.map((c) => line(c.label, c)).join(" / ");
  const comments = data.comments.channels.map((c) => line(c.label, c)).join(" / ");
  return [
    `[팰리세이드(LX3) 전동 시트 관련 온라인 동향] DASHBOARD - ${prettyDate(data.date)}${data.period ? ` (수집 기간 ${data.period})` : ""}`,
    `■ 게시물: ${data.posts.total ? line("오늘의 신규 게시물 수", data.posts.total) : "기록 없음"}${posts ? ` | ${posts}` : ""}`,
    `■ 댓글: ${dashCommentTotal(data) ? `${line("오늘의 신규 댓글 수", dashCommentTotal(data))}${data.ytNew != null ? ` (유튜브 신규 ${num(data.ytNew)} 포함)` : ""} | ` : ""}${comments || "기록 없음"}`,
    ...(data.detail
      ? ["■ 채널 상세 (게시글/댓글)"].concat(DASH_CH.map(({ label }) => {
          const list = data.detail[label] || [];
          const items = list.slice(0, DASH_TOP).map((x) =>
            label === "유튜브" ? `${dashShort(x.name)} 영상 ${num(x.videos)}${x.posts ? `(+${num(x.posts)})` : ""}/${num(x.comments)}` : `${dashShort(x.name)} ${num(x.posts)}/${num(x.comments)}`,
          );
          if (list.length > DASH_TOP) items.push(`외 ${list.length - DASH_TOP}곳`);
          return `  - ${label}: ${items.join(", ") || "해당 없음"}`;
        }))
      : []),
    `■ 누적: 게시물 마지막 순번 ${data.lastSerial || "-"}${data.rawLast ? ` / 댓글 마지막 연번 ${data.rawLast}` : ""}`,
  ].join("\n");
}

async function carDataUrl() {
  // 메일용 그림: 색 수를 줄여 용량 1/5 (큰 그림이 있으면 그룹웨어 편집기가 붙여 넣기를 거부)
  const blob = await (await fetch(chrome.runtime.getURL("icons/logo-car-mail.png"))).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

let dashCache = null;

// 대시보드에 쓰는 짧은 이름: 직접 정한 이름(대시보드에서 이름을 눌러 지정) → 없으면 자동으로 줄임
let dashAlias = {};
function dashShort(name) {
  const full = String(name || "").trim();
  if (dashAlias[full]) return dashAlias[full];
  let t = full
    .replace(/[★☆♥♡◆◇■□●○▶▷♣♠※]/g, " ")
    .replace(/\s+-\s+.*$/, "") // '이름 - 부제' 의 부제
    .replace(/\[[^\]]*\]?/g, " ") // [대괄호]
    .replace(/풀\s*체인지/g, " ")
    .replace(/공식\s*(동호회|카페|클럽)/g, " 클럽")
    .replace(/공식/g, " ")
    .replace(/([가-힣])([A-Z]{1,4}\d)/g, "$1 $2") // 팰리세이드LX3 → 팰리세이드 LX3
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^현대\s+/, "") // 맨 앞 '현대 '
    .replace(/([A-Z]+\d+)\s+클럽$/, "$1클럽"); // LX3 클럽 → LX3클럽
  return t || full;
}

$("#dashBody")?.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-alias]");
  if (!a) return;
  const full = a.dataset.alias;
  const v = prompt(`'${full}'\n대시보드에 보일 짧은 이름 (비우면 자동으로 줄임):`, dashShort(full));
  if (v === null) return;
  const st = await chrome.storage.local.get("lx3NameAlias").catch(() => ({}));
  const map = st.lx3NameAlias || {};
  if (v.trim() && v.trim() !== full) map[full] = v.trim();
  else delete map[full];
  await chrome.storage.local.set({ lx3NameAlias: map });
  renderDash();
});

async function renderDash() {
  const box = $("#dash");
  if (!box) return;
  const st = await chrome.storage.local.get("lx3NameAlias").catch(() => ({}));
  dashAlias = st.lx3NameAlias || {};
  dashCache = await dashData();
  $("#dashCopy").disabled = !dashCache;
  if ($("#dashCopyLite")) $("#dashCopyLite").disabled = !dashCache;
  if ($("#dashCopyCode")) $("#dashCopyCode").disabled = !dashCache;
  $("#dashBody").innerHTML = dashCache
    ? dashHtml(dashCache, chrome.runtime.getURL("icons/logo-car.png"), true)
    : `<div class="hint">아직 최종 DB에 기록이 없습니다. 게시물 엑셀을 만들거나 파일을 등록하면 여기에 그날의 건수가 보입니다.</div>`;
}

// 차량 이미지는 미리 글자(data 주소)로 바꿔 둔다 → 버튼을 누르는 순간 기다림 없이 바로 복사
let dashCar = null;
carDataUrl().then((d) => (dashCar = d)).catch(() => {});

function dashCopied(ok, withCar = true, why = "") {
  $("#dashInfo").textContent = ok
    ? `✔ ${withCar ? "" : "이미지 없이 "}복사했습니다. 메일 본문에 붙여 넣으세요 (⌘V).${withCar ? " 붙여 넣기가 안 되면 '이미지 없이 복사'를 눌러 보세요." : ""}`
    : `복사하지 못했습니다${why ? `: ${why}` : ""}. 다시 눌러 주세요.`;
  $("#dashInfo").className = ok ? "hint ok" : "hint err";
}

// 메일 붙여 넣기용 차량 그림은 인터넷 주소로 (그림을 글자로 담으면 그룹웨어 편집기가 서버에 올리다 실패해 붙여 넣기가 취소됨)
// 커밋 번호로 고정한 주소라 파일이 나중에 바뀌어도 보낸 메일의 그림은 그대로
const DASH_CAR_URL = "https://raw.githubusercontent.com/khagu77/khagu77/164d8a3326b9f1be53709a6a120e7d8b1c9f98a5/chrome-extension/icons/logo-car-mail.png";

// withCar=false: 차량 이미지 없이 (그룹웨어 메일 편집기 중에는 글자로 담은 그림이 있으면 붙여 넣기를 통째로 거부하는 곳이 있음)
function copyDash(withCar = true) {
  if (!dashCache) return;
  const body = dashHtml(dashCache, withCar ? DASH_CAR_URL : "");
  const html = `<html><body>${body}</body></html>`;
  const text = dashText(dashCache);
  // 1) ⌘C 와 같은 순간에 복사 이벤트로 서식·글자를 직접 담음 (전에 붙여 넣기가 됐던 방식)
  let done = false;
  const onCopy = (e) => {
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    document.execCommand("copy");
  } catch {}
  document.removeEventListener("copy", onCopy);
  if (done) return dashCopied(true, withCar);
  // 2) 안 되면 클립보드 API
  navigator.clipboard
    .write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })])
    .then(() => dashCopied(true, withCar))
    .catch((e) => dashCopied(false, withCar, e.message));
}

// 메일 편집기의 'HTML' 탭에 붙여 넣을 코드(글자)로 복사 — 서식 붙여 넣기를 거부하는 편집기에서도 확실히 들어감
function copyDashCode() {
  if (!dashCache) return;
  const code = dashHtml(dashCache, dashCar || chrome.runtime.getURL("icons/logo-car.png"));
  let done = false;
  const onCopy = (e) => {
    e.clipboardData.setData("text/plain", code);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    document.execCommand("copy");
  } catch {}
  document.removeEventListener("copy", onCopy);
  const ok = () => {
    $("#dashInfo").textContent = "✔ HTML 코드를 복사했습니다. 메일 편집기 아래 'HTML' 탭 → 넣을 자리에 ⌘V → 다시 '디자인' 탭으로 돌아오면 대시보드가 보입니다.";
    $("#dashInfo").className = "hint ok";
  };
  if (done) return ok();
  navigator.clipboard.writeText(code).then(ok).catch((e) => dashCopied(false, true, e.message));
}

$("#dashCopy")?.addEventListener("click", () => copyDash(true));
$("#dashCopyCode")?.addEventListener("click", copyDashCode);
$("#dashCopyLite")?.addEventListener("click", () => copyDash(false));

