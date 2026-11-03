// 최종 DB 화면 맨 위 '오늘의 대시보드': 그날의 게시물·댓글 건수와 전일 대비, 누적을 한눈에.
// 메일 본문에 그대로 붙여 넣을 수 있게 표 구조 + 직접 지정한 서식(인라인 스타일)으로 만들고, 화면에도 같은 것을 보여 준다.

const DASH_FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";
const DASH_CH = [
  { label: "언론", color: "#002c5f" },
  { label: "유튜브", color: "#ff0000" },
  { label: "동호회", color: "#03c75a" },
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
  return {
    date,
    detail,
    period: cur?.rangeEnd && prevEnd ? `${hhmm(prevEnd)} ~ ${hhmm(cur.rangeEnd)}` : "",
    posts: b,
    comments: r,
    lastSerial,
    rawLast,
  };
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

const DASH_TOP = Infinity; // 출처는 모두 표시 (묶지 않음)

const dashSmallBadge = (d) => {
  if (!d || d.diff == null) return `<span style="color:#a0a5ad;font-size:10px;">전일 없음</span>`;
  if (d.diff > 0) return `<span style="color:#d93025;font-size:11px;font-weight:700;">▲${num(d.diff)}</span>`;
  if (d.diff < 0) return `<span style="color:#1a5fd0;font-size:11px;font-weight:700;">▼${num(-d.diff)}</span>`;
  return `<span style="color:#a0a5ad;font-size:11px;">-</span>`;
};

// 채널 한 칸: 위에 게시글·댓글 건수(전일 대비), 아래에 출처별 상세(많은 순)
function dashChannelCell({ label, color }, data) {
  const yt = label === "유튜브";
  const p = data.posts.channels.find((x) => x.label === label);
  const c = data.comments.channels.find((x) => x.label === label);
  const list = data.detail?.[label] || [];
  const unitName = yt ? "채널" : label === "언론" ? "언론사" : label === "동호회" ? "동호회" : "사이트";
  const stat = (title, x) =>
    `<td width="50%" style="padding:4px 6px;background:#f6f8fa;border-radius:6px;">` +
    `<div style="font-size:10px;color:#6b7079;font-weight:600;">${title}</div>` +
    `<div style="white-space:nowrap;"><b style="font-size:18px;color:#1b1d21;">${x ? num(x.d.today) : "-"}</b>` +
    `<span style="font-size:11px;color:#6b7079;">건</span> ${x ? dashSmallBadge(x.d) : ""}</div></td>`;
  const cellStyle = "padding:2px 3px;font-size:11px;border-top:1px solid #eef0f3;";
  const n0 = (v) => (v ? num(v) : `<span style="color:#c4c8ce;">0</span>`);
  // 유튜브는 지켜보는 영상 전체 수 (오늘 새로 넣은 영상은 +n)
  const plus = (n) => (n ? `<span style="color:#d93025;font-size:10px;font-weight:700;"> +${num(n)}</span>` : "");
  const first = (x) => (yt ? `${n0(x.videos)}${plus(x.posts)}` : n0(x.posts));
  const row = (x) =>
    `<tr><td style="${cellStyle}color:#1b1d21;"><div style="max-width:118px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(x.name)}</div></td>` +
    `<td style="${cellStyle}text-align:right;font-weight:700;color:#1b1d21;white-space:nowrap;">${first(x)}</td>` +
    `<td style="${cellStyle}text-align:right;font-weight:700;color:${color};">${n0(x.comments)}</td></tr>`;
  const rest = list.slice(DASH_TOP);
  const sum = (arr, f) => arr.reduce((s, x) => s + x[f], 0);
  const head = (t) => `<td style="padding:2px 3px;font-size:10px;color:#8a8f98;text-align:right;white-space:nowrap;">${t}</td>`;
  const detail = data.detail
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px;">` +
      `<tr><td style="padding:2px 3px;font-size:10px;color:#8a8f98;">${unitName}별 (${list.length})</td>${head(yt ? "영상(전체)" : "글")}${head("댓글")}</tr>` +
      (list.length ? list.slice(0, DASH_TOP).map(row).join("") : `<tr><td colspan="3" style="${cellStyle}color:#a0a5ad;">해당 없음</td></tr>`) +
      (rest.length
        ? `<tr><td style="${cellStyle}color:#8a8f98;">외 ${rest.length}곳</td><td style="${cellStyle}text-align:right;color:#8a8f98;">${num(sum(rest, yt ? "videos" : "posts"))}${yt && sum(rest, "posts") ? ` +${num(sum(rest, "posts"))}` : ""}</td>` +
          `<td style="${cellStyle}text-align:right;color:#8a8f98;">${num(sum(rest, "comments"))}</td></tr>`
        : "") +
      `</table>`
    : "";
  return (
    `<td width="25%" style="padding:0 4px;vertical-align:top;">` +
    `<div style="border:1px solid #e3e6eb;border-top:3px solid ${color};border-radius:8px;padding:6px 7px;background:#ffffff;">` +
    `<div style="display:inline-block;background:${color};color:#fff;font-weight:700;font-size:11px;padding:1px 8px;border-radius:999px;">${esc(label)}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="3" style="border-collapse:separate;margin-top:3px;"><tr>` +
    stat(yt ? "새 영상" : "게시글", p) +
    stat(yt ? "댓글(전체)" : "댓글", c) +
    `</tr></table>` +
    detail +
    `</div></td>`
  );
}

// 메일·화면 공통 대시보드 HTML (carSrc: 차량 이미지 주소 — 화면은 확장 안 주소, 메일 복사는 그림을 글자로 담은 주소)
// 왼쪽: 차량 이미지와 제목 · 날짜 · 합계 · 누적 / 오른쪽: 네 채널 칸
function dashHtml(data, carSrc) {
  const total = data.posts.total;
  const cSum = data.comments.channels.reduce((s, x) => s + (x.d.today || 0), 0);
  const cTotal = dashCommentTotal(data);
  const yellow = (d) => (!d || d.diff == null ? "" : d.diff > 0 ? `▲${num(d.diff)}` : d.diff < 0 ? `▼${num(-d.diff)}` : "변동 없음");
  return `<table width="960" cellpadding="0" cellspacing="0" style="border-collapse:separate;font-family:${DASH_FONT};background:#ffffff;border:1px solid #d9dde3;border-radius:12px;max-width:100%;">
  <tr>
  <td width="200" style="width:200px;vertical-align:top;background:#002c5f;background-image:linear-gradient(160deg,#001a3a 0%,#002c5f 50%,#0b5aa8 100%);padding:14px 14px 12px;color:#ffffff;border-radius:12px 0 0 12px;">
    <div style="font-size:11px;opacity:0.8;line-height:1.35;">팰리세이드(LX3) 전동 시트<br>관련 온라인 동향</div>
    <div style="font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:900;line-height:1.05;margin-top:4px;letter-spacing:0.3px;">DASHBOARD</div>
    <div align="center" style="text-align:center;margin:8px 0 6px;"><img src="${carSrc}" width="138" alt="PALISADE" style="display:inline-block;border:0;"></div>
    <div style="font-size:13px;font-weight:700;">${esc(prettyDate(data.date))}</div>
    ${data.period ? `<div style="font-size:10px;opacity:0.8;margin-top:1px;">수집 ${esc(data.period)}</div>` : ""}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.25);"><tr>
      <td width="50%" style="padding-top:6px;color:#ffffff;vertical-align:top;"><div style="font-size:10px;opacity:0.8;">게시물 합계</div>
        <div style="font-size:20px;font-weight:800;">${total ? num(total.today) : "-"}<span style="font-size:11px;">건</span></div>
        <div style="font-size:11px;font-weight:700;color:#ffd166;">${yellow(total)}</div></td>
      <td width="50%" style="padding-top:6px;color:#ffffff;vertical-align:top;"><div style="font-size:10px;opacity:0.8;">댓글 합계</div>
        <div style="font-size:20px;font-weight:800;">${data.comments.channels.length ? num(cSum) : "-"}<span style="font-size:11px;">건</span></div>
        <div style="font-size:11px;font-weight:700;color:#ffd166;">${yellow(cTotal)}</div>
        <div style="font-size:10px;opacity:0.8;">유튜브 전체 포함</div></td>
    </tr></table>
    <div style="font-size:10px;opacity:0.75;margin-top:6px;line-height:1.5;">누적 게시물 순번 ${esc(data.lastSerial || "-")}${data.rawLast ? `<br>댓글 연번 ${esc(data.rawLast)}` : ""}</div>
  </td>
  <td style="vertical-align:top;padding:10px 8px 10px 6px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;"><tr>
      ${DASH_CH.map((ch) => dashChannelCell(ch, data)).join("")}
    </tr></table>
    <div style="font-size:10px;color:#a0a5ad;padding:5px 4px 0;">▲▼ 전일 대비 · 댓글은 그날 새로 모은 건수(유튜브는 시트 전체) · 출처별은 많은 순</div>
  </td>
  </tr>
</table>`;
}

// 댓글 합계와 전일 대비 (전일 기록이 있는 채널만 비교)
function dashCommentTotal(data) {
  const ch = data.comments.channels;
  if (!ch.length) return null;
  const today = ch.reduce((s, x) => s + (x.d.today || 0), 0);
  if (ch.every((x) => x.d.prev == null)) return { today, diff: null };
  const prev = ch.reduce((s, x) => s + (x.d.prev || 0), 0);
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
    `■ 게시물: ${data.posts.total ? line("합계", data.posts.total) : "기록 없음"}${posts ? ` | ${posts}` : ""}`,
    `■ 댓글: ${dashCommentTotal(data) ? `${line("합계", dashCommentTotal(data))} | ` : ""}${comments || "기록 없음"}`,
    ...(data.detail
      ? ["■ 채널 상세 (게시글/댓글)"].concat(DASH_CH.map(({ label }) => {
          const list = data.detail[label] || [];
          const items = list.slice(0, DASH_TOP).map((x) =>
            label === "유튜브" ? `${x.name} 영상 ${num(x.videos)}${x.posts ? `(+${num(x.posts)})` : ""}/${num(x.comments)}` : `${x.name} ${num(x.posts)}/${num(x.comments)}`,
          );
          if (list.length > DASH_TOP) items.push(`외 ${list.length - DASH_TOP}곳`);
          return `  - ${label}: ${items.join(", ") || "해당 없음"}`;
        }))
      : []),
    `■ 누적: 게시물 마지막 순번 ${data.lastSerial || "-"}${data.rawLast ? ` / 댓글 마지막 연번 ${data.rawLast}` : ""}`,
  ].join("\n");
}

async function carDataUrl() {
  const blob = await (await fetch(chrome.runtime.getURL("icons/logo-car.png"))).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

let dashCache = null;

async function renderDash() {
  const box = $("#dash");
  if (!box) return;
  dashCache = await dashData();
  $("#dashCopy").disabled = !dashCache;
  $("#dashBody").innerHTML = dashCache
    ? dashHtml(dashCache, chrome.runtime.getURL("icons/logo-car.png"))
    : `<div class="hint">아직 최종 DB에 기록이 없습니다. 게시물 엑셀을 만들거나 파일을 등록하면 여기에 그날의 건수가 보입니다.</div>`;
}

async function copyDash() {
  if (!dashCache) return;
  const html = dashHtml(dashCache, await carDataUrl());
  const text = dashText(dashCache);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
    ]);
    $("#dashInfo").textContent = "✔ 복사했습니다. 메일 본문에 붙여 넣으세요 (⌘V).";
    $("#dashInfo").className = "hint ok";
  } catch (e) {
    $("#dashInfo").textContent = `복사하지 못했습니다: ${e.message}`;
    $("#dashInfo").className = "hint err";
  }
}

$("#dashCopy")?.addEventListener("click", copyDash);
