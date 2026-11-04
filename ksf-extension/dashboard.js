// 데이터 DB 화면 맨 위 '코세페 반응 대시보드': 기간 · 게시글·댓글·반응 수(전 기록 대비) · 전체 성향 막대 ·
// 차종별(아반떼·그랜저·싼타페) 성향 비율과 긍정/부정 주요 내용(많이 이야기된 이슈 순).
// LX3 대시보드처럼 메일 본문에 그대로 붙여 넣을 수 있게 표 구조 + 인라인 서식으로 만들고, 화면에도 같은 것을 보여 준다.
// 숫자는 수집 화면이 [엑셀 만들기] 때 데이터 DB '차종별 반응 요약' 파일에 함께 저장한 것(stats) - 저장 전이면 지금 작업 중인 값.

const DASH_FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";
const DASH_TONES = [
  ["긍정", "#0070c0"],
  ["중립", "#00b050"],
  ["부정", "#e00000"],
  ["단순비난", "#bf8f00"],
];
const DASH_CELL = 236; // 차종 칸 폭 (메일용 고정 px)
const DASH_TOP = 5;
// 메일 붙여 넣기용 차량 그림은 인터넷 주소로 (그림을 글자로 담으면 그룹웨어 편집기가 붙여 넣기를 거부하는 곳이 있음)
// 커밋 번호로 고정한 주소라 파일이 나중에 바뀌어도 보낸 메일의 그림은 그대로
const DASH_BANNER_URL = "https://raw.githubusercontent.com/khagu77/khagu77/525c7d1bf7d4902f5586c98206510f2a88015e56/ksf-extension/icons/dash-banner.jpg";

const desc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dnum = (n) => Number(n || 0).toLocaleString();
const dpct = (v) => `${(Math.round((v || 0) * 1000) / 10).toFixed(1)}%`;

// 전 기록 대비 (▲ 빨강 · ▼ 파랑)
function dashDiff(cur, prev, onDark = false) {
  if (prev === null || prev === undefined) return "";
  const d = cur - prev;
  if (!d) return `<span style="font-size:10px;color:${onDark ? "#c3cfdd" : "#8a8f98"};">변동 없음</span>`;
  const up = d > 0;
  const color = onDark ? "#ffd166" : up ? "#d93025" : "#1a5fd0";
  return `<span style="font-size:10px;font-weight:700;color:${color};">${up ? "▲" : "▼"}${dnum(Math.abs(d))}</span>`;
}

// 성향 막대 (메일에서도 보이게 표 칸 바탕색으로)
function dashBar(tone, total, height = 10) {
  if (!total) return `<div style="height:${height}px;line-height:${height}px;background:#e9ecef;border-radius:4px;font-size:1px;">&nbsp;</div>`;
  const cells = DASH_TONES.filter(([t]) => tone[t])
    .map(([t, c]) => `<td width="${Math.max(1, Math.round((tone[t] / total) * 100))}%" bgcolor="${c}" style="background:${c};background-color:${c};height:${height}px;line-height:${height}px;font-size:1px;">&nbsp;</td>`)
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>${cells}</tr></table>`;
}

function dashLegend(s, size = 11, onDark = false) {
  return DASH_TONES.map(([t, c]) =>
    `<span style="white-space:nowrap;font-size:${size}px;color:${onDark ? "#ffffff" : "#1b1d21"};"><span style="color:${onDark && t === "부정" ? "#ff8a80" : onDark && t === "긍정" ? "#7cc4ff" : onDark && t === "중립" ? "#7be0a4" : onDark ? "#ffd166" : c};font-weight:800;">●</span> ${t} <b>${s.reactions || s.n ? dpct(s.ratio[t]) : "-"}</b></span>`,
  ).join("&nbsp; ");
}

// 보고서 1페이지 요지 문구: "부정 여론(부정+단순비난)이 긍정 여론 比 높은 편 (59.1% vs 18.2%)"
function dashVerdict(s) {
  const neg = (s.ratio["부정"] || 0) + (s.ratio["단순비난"] || 0);
  const pos = s.ratio["긍정"] || 0;
  const word = Math.abs(neg - pos) < 0.05 ? "비슷한 편" : neg > pos ? "높은 편" : "낮은 편";
  return { neg, pos, text: `부정 여론(부정+단순비난)이 긍정 여론 比 ${word} (${dpct(neg)} vs ${dpct(pos)})`, negHigh: neg > pos };
}

// 차종 한 칸: 이름 · 게시글/댓글/반응 · 성향 막대·비율 · 긍정/부정 주요 내용
function dashCarCell(c, prev, fluid) {
  const p = prev?.cars?.find((x) => x.car === c.car);
  const stat = (label, v, pv) =>
    `<td width="33%" style="width:33%;padding:4px 5px;background:#f6f8fa;border-radius:6px;white-space:nowrap;">` +
    `<div style="font-size:10px;color:#6b7079;font-weight:600;">${label}</div>` +
    `<div style="white-space:nowrap;"><b style="font-size:16px;color:#1b1d21;">${dnum(v)}</b><span style="font-size:10px;color:#6b7079;padding-left:3px;">건</span></div>` +
    `<div style="line-height:1.2;">${p ? dashDiff(v, pv) : "&nbsp;"}</div></td>`;
  const list = (title, rows, total, color) => {
    const head = `<tr><td colspan="3" style="padding:6px 2px 2px;font-size:11px;font-weight:800;color:${color};border-bottom:1px solid ${color};">${title} <span style="font-weight:400;color:#8a8f98;">(${dnum(total)})</span></td></tr>`;
    if (!rows.length) return `${head}<tr><td colspan="3" style="padding:3px 2px;font-size:11px;color:#a0a5ad;">해당 없음</td></tr>`;
    return head + rows.map((r, i) =>
      `<tr><td width="14" style="width:14px;padding:3px 2px;font-size:10px;color:#8a8f98;vertical-align:top;">${i + 1}</td>` +
      `<td style="padding:3px 2px;font-size:11px;color:#1b1d21;line-height:1.35;vertical-align:top;border-top:${i ? "1px solid #eef0f3" : "0"};">${desc(r.label)}</td>` +
      `<td width="58" style="width:58px;padding:3px 2px;font-size:11px;text-align:right;white-space:nowrap;vertical-align:top;border-top:${i ? "1px solid #eef0f3" : "0"};"><b style="color:${color};">${dnum(r.count)}</b><span style="color:#8a8f98;font-size:10px;"> ${dpct(r.ratio)}</span></td></tr>`,
    ).join("");
  };
  return (
    `<td width="${fluid ? "33%" : DASH_CELL}" style="width:${fluid ? "33%" : `${DASH_CELL}px`};padding:0;vertical-align:top;">` +
    `<div style="margin:0 4px;border:1px solid #e3e6eb;border-top:3px solid ${c.color};border-radius:8px;padding:7px 8px;background:#ffffff;">` +
    `<div><span style="display:inline-block;background:${c.color};color:#fff;font-weight:800;font-size:12px;padding:1px 10px;border-radius:999px;">${desc(c.car)}</span>` +
    `<span style="font-size:10px;color:#8a8f98;"> 동호회 ${dnum(c.cafes)}곳</span></div>` +
    // 동호회 이름 줄은 늘 2줄 높이 → 세 차종 칸의 게시글·댓글·반응 상자 높이가 나란히 맞음
    `<div style="font-size:9.5px;color:#8a8f98;margin-top:2px;line-height:13px;height:26px;max-height:26px;overflow:hidden;">${desc((c.cafeNames || []).join(" · "))}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="3" style="width:100%;border-collapse:separate;table-layout:fixed;margin-top:3px;"><tr>` +
    stat("게시글", c.posts, p?.posts) + stat("댓글", c.comments, p?.comments) + stat("반응", c.n, p?.n) +
    `</tr></table>` +
    `<div style="margin:5px 0 3px;">${dashBar(c.tone, c.n)}</div>` +
    `<div style="line-height:1.6;">${dashLegend(c, 10)}</div>` +
    (c.n ? `<div style="margin-top:3px;padding:3px 6px;border-radius:5px;background:${dashVerdict(c).negHigh ? "#fdecea" : "#e8f1fb"};font-size:10.5px;font-weight:700;color:${dashVerdict(c).negHigh ? "#c00000" : "#0b5394"};line-height:1.35;">${desc(dashVerdict(c).text)}</div>` : "") +
    `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:2px;">` +
    // 첫 줄이 칸 합침(제목)이라 열 너비를 따로 정해 둔다 (순위 · 내용 · 건수)
    `<colgroup><col width="14" style="width:14px;"><col><col width="58" style="width:58px;"></colgroup>` +
    list("긍정 주요 내용", c.pos.slice(0, DASH_TOP), c.posN, "#0070c0") +
    list("부정 주요 내용", c.neg.slice(0, DASH_TOP), c.negN, "#e00000") +
    `</table></div></td>`
  );
}

// 메일·화면 공통 대시보드 HTML (banner: 차량 그림 주소 - 없으면 그림 없이)
function dashHtml(d, prev, banner, fluid = false) {
  const asOf = new Date(d.at);
  const asOfText = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}-${String(asOf.getDate()).padStart(2, "0")} ${String(asOf.getHours()).padStart(2, "0")}:${String(asOf.getMinutes()).padStart(2, "0")}`;
  const big = (label, v, pv) =>
    `<td bgcolor="#002c5f" style="padding-top:6px;color:#ffffff;vertical-align:top;background:#002c5f;background-color:#002c5f;"><div style="font-size:10px;color:#c3cfdd;">${label}</div>` +
    // 숫자 흰 글씨: 네이버 메일 편집기가 글자색을 지우는 경우가 있어 <font color> 와 글자마다 흰색을 함께 지정
    `<div style="font-size:19px;font-weight:800;color:#ffffff;white-space:nowrap;"><font color="#ffffff" style="color:#ffffff;"><b style="font-weight:800;color:#ffffff;">${dnum(v)}</b><span style="font-size:10px;font-weight:400;color:#ffffff;padding-left:3px;">건</span></font></div>` +
    `<div>${prev ? dashDiff(v, pv, true) : "&nbsp;"}</div></td>`;
  const W = DASH_CELL * d.cars.length;
  return `<div style="${fluid ? "display:block;" : "display:inline-block;"}border:1px solid #d9dde3;border-radius:12px;overflow:hidden;background:#ffffff;">
<table${fluid ? ' width="100%"' : ""} cellpadding="0" cellspacing="0" style="${fluid ? "width:100%;" : ""}border-collapse:collapse;border:0;font-family:${DASH_FONT};background:transparent;">
  <tr>
  <td width="230" bgcolor="#002c5f" style="width:230px;vertical-align:top;background:#002c5f;background-color:#002c5f;padding:0;color:#ffffff;border-radius:11px 0 0 0;">
    <div style="padding:14px 14px 12px;${fluid ? "" : "width:202px;"}">
    <div style="font-size:10.5px;color:#c3cfdd;line-height:1.35;letter-spacing:-0.7px;white-space:nowrap;">${desc(d.title || "코리아 세일 페스타 차종별 동호회 반응")}</div>
    <div style="color:#ffffff;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:900;line-height:1.05;margin-top:4px;letter-spacing:0.3px;">DASHBOARD</div>
    <div style="font-size:10px;color:#c3cfdd;margin-top:8px;">모니터링 기간</div>
    <div style="font-size:12.5px;font-weight:700;color:#ffffff;line-height:1.35;">${desc(d.period)}</div>
    <div style="font-size:10px;color:#c3cfdd;margin-top:1px;">${asOfText} 기준${prev ? ` · ${desc(prev.dateText)} 대비` : ""}</div>
    <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#002c5f" style="margin-top:8px;border-top:1px solid #4d6b8f;background:#002c5f;background-color:#002c5f;"><tr>
      ${big("게시글", d.posts, prev?.posts)}${big("댓글", d.comments, prev?.comments)}${big("반응", d.reactions, prev?.reactions)}
    </tr></table>
    <div style="font-size:10px;color:#c3cfdd;margin:10px 0 4px;">전체 성향 (반응 ${dnum(d.reactions)}건)</div>
    ${dashBar(d.tone, d.reactions, 12)}
    <div style="margin-top:5px;line-height:1.7;">${dashLegend(d, 11, true)}</div>
    ${d.reactions ? `<div style="font-size:11px;color:#ffd166;font-weight:700;margin-top:8px;line-height:1.45;">${desc(dashVerdict(d).text)}</div>` : ""}
    <div style="font-size:10px;color:#b8c5d6;margin-top:8px;line-height:1.5;">모니터링 채널: ${desc(d.channels || `주요 모니터링 동호회 ${d.cafes.length}곳`)}${d.unjudged ? `<br><span style="color:#ffd166;">※ 잠정치: ${dnum(d.unjudged)}건은 AI 판단 전</span>` : ""}</div>
    </div>
  </td>
  <td bgcolor="#ffffff" style="vertical-align:top;padding:10px 8px 0 6px;background:#ffffff;background-color:#ffffff;border-radius:0 11px 0 0;">
    ${banner ? `<div style="margin:0 4px 8px;"><img src="${banner}" width="${fluid ? "" : W - 8}" alt="AVANTE · SANTA FE · GRANDEUR" style="display:block;border:0;border-radius:8px;${fluid ? "width:100%;max-width:100%;height:auto;" : ""}"></div>` : ""}
    ${(d.summary || []).length ? `<div style="margin:0 4px 8px;padding:8px 10px;border:1px solid #d9dde3;border-left:4px solid #002c5f;border-radius:6px;background:#f8fafc;${fluid ? "" : boxW(W, 25)}">${d.summary.map((t) => `<div style="font-size:12.5px;font-weight:700;color:#1b1d21;line-height:1.5;">• ${desc(t)}</div>`).join("")}</div>` : ""}
    <table width="${fluid ? "100%" : W}" cellpadding="0" cellspacing="0" style="width:${fluid ? "100%" : `${W}px`};border-collapse:collapse;table-layout:fixed;"><tr>
      ${d.cars.map((c) => dashCarCell(c, prev, fluid)).join("")}
    </tr></table>
    ${dashTypes(d, fluid ? "100%" : W)}
    ${dashQuotes(d, fluid ? "100%" : W)}
  </td>
  </tr>
  <tr><td width="230" bgcolor="#002c5f" valign="bottom" style="width:230px;vertical-align:bottom;background:#002c5f;background-color:#002c5f;padding:0 14px 9px;border-radius:0 0 0 11px;"><div style="font-size:9px;line-height:1.2;color:#ffffff;letter-spacing:-0.1px;opacity:0.85;font-family:Arial,Helvetica,sans-serif;">By <b style="font-weight:800;font-style:italic;color:#ffffff;"><i style="font-style:italic;">LINESQUARE</i></b></div></td>
  <td align="right" bgcolor="#ffffff" style="vertical-align:bottom;text-align:right;padding:6px 12px 8px 6px;background:#ffffff;background-color:#ffffff;border-radius:0 0 11px 0;">
    <div align="right" style="font-size:10px;color:#4a4f57;text-align:right;">※ 반응 = 게시글·댓글 × 언급 차종 · 성향은 코세페에 대한 반응 기준 · 주요 내용은 많이 이야기된 이슈 순(건수 · 해당 차종 긍정/부정 중 비중)${prev ? ` · <span style="color:#d93025;font-weight:700;">▲</span><span style="color:#1a5fd0;font-weight:700;">▼</span> ${desc(prev.dateText)} 대비` : ""}</div>
  </td></tr>
</table></div>`;
}

// 메일용: 상자 폭 고정 (차종 칸 3개 합 − 좌우 여백 8px · 테두리 포함 · 메일 프로그램이 폭 없는 상자를 화면 끝까지 늘리지 않게) / 화면: 꽉 채움
// extra: 상자의 좌우 여백+테두리 (폭은 테두리·여백을 뺀 안쪽 폭으로 - 메일 편집기가 box-sizing 을 지워도 어긋나지 않게)
const boxW = (width, extra = 2) => (typeof width === "number" ? `width:${width - 8 - extra}px;` : "");

// 성향별 주요 내용 (보고서 1페이지와 같은 대표 댓글 · 원문)
function dashQuotes(d, width) {
  const has = d.short && DASH_TONES.some(([t]) => (d.short[t] || []).length);
  if (!has) return "";
  const clip = (t) => {
    const a = Array.from(String(t || "").replace(/\s+/g, " ").trim());
    return a.length > 80 ? `${a.slice(0, 79).join("")}…` : a.join("");
  };
  const rows = DASH_TONES.map(([t, c]) =>
    `<tr><td width="58" style="width:58px;padding:5px 6px;border-top:1px solid #eef0f3;vertical-align:top;white-space:nowrap;"><b style="font-size:11px;color:${c};">${t}</b><div style="font-size:10px;color:#6b7079;">${dpct(d.ratio[t])}</div></td>` +
    `<td style="padding:5px 6px;border-top:1px solid #eef0f3;font-size:11px;color:#1b1d21;line-height:1.5;vertical-align:top;">${(d.short[t] || []).map((q) => `‘${desc(clip(q))}’`).join(", ") || '<span style="color:#a0a5ad;">-</span>'}</td></tr>`,
  ).join("");
  return `<div style="margin:8px 4px 0;border:1px solid #e3e6eb;border-radius:8px;background:#ffffff;background-color:#ffffff;overflow:hidden;padding:0 0 6px;${boxW(width)}">` +
    `<div style="padding:5px 8px;font-size:11px;font-weight:800;color:#002c5f;background:#f6f8fa;background-color:#f6f8fa;border-radius:7px 7px 0 0;">성향별 주요 댓글 여론 (전 차종)</div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;background:transparent;">${rows}</table></div>`;
}

// 유형 구분 (글쓴이 유형) - 엑셀과 같은 보라 계열 5가지 + 유형 구분 외(회색)
const DASH_TYPES = [
  ["일반", "#9a8cc2", "기존 이전 오너 및 일반적인 의견 개진"],
  ["기존 출고자", "#6f4fbf", "혜택 미적용자"],
  ["출고 대기자", "#3f2196", "혜택 미적용자"],
  ["행사 기간 내 계약자", "#8e44ad", "혜택 적용자"],
  ["계약 예정자", "#c060d2", "혜택 적용, 미적용 미정인자"],
  ["유형 구분 외", "#8a8f98", "구분이 안 되거나 위 5가지에 해당하지 않는 경우"],
];

// 유형 구분별 반응: 반응 수·비중 · 성향 막대·긍정/부정 비율 · 가장 많이 나온 여론 1개
function dashTypes(d, width) {
  if (!(d.types || []).length) return "";
  const toneColor = Object.fromEntries(DASH_TONES);
  const td = (inner, w, extra = "") => `<td${w ? ` width="${w}"` : ""} bgcolor="#ffffff" style="${w ? `width:${w}px;` : ""}padding:5px 6px;border-top:1px solid #eef0f3;vertical-align:middle;background:#ffffff;background-color:#ffffff;${extra}">${inner}</td>`;
  const rows = DASH_TYPES.map(([type, color, note]) => {
    const t = d.types.find((x) => x.type === type) || { n: 0, share: 0, tone: {}, ratio: {} };
    const top = t.top
      ? `${t.top.quote ? "" : `<b style="color:${toneColor[t.top.tone] || "#1b1d21"};">[${t.top.tone}]</b> `}<span style="color:#1b1d21;">${desc(t.top.label)}</span>${t.top.quote ? "" : ` <span style="color:#8a8f98;">${dnum(t.top.count)}건</span>`}`
      : '<span style="color:#a0a5ad;">-</span>';
    return `<tr>${td(`<b style="font-size:11px;color:${color};white-space:nowrap;" title="${desc(note)}">${type}</b>`, 112)}` +
      td(`<b style="font-size:12px;color:#1b1d21;">${dnum(t.n)}</b><span style="font-size:10px;color:#6b7079;padding-left:3px;">건 ${t.n ? dpct(t.share) : ""}</span>`, 74, "white-space:nowrap;") +
      td(`${dashBar(t.tone, t.n, 7)}<div style="font-size:9.5px;color:#6b7079;margin-top:2px;white-space:nowrap;">${t.n ? `<span style="color:#0070c0;">긍 ${dpct(t.ratio["긍정"])}</span> · <span style="color:#e00000;">부 ${dpct((t.ratio["부정"] || 0) + (t.ratio["단순비난"] || 0))}</span>` : "&nbsp;"}</div>`, 120) +
      td(`<span style="font-size:11px;line-height:1.45;">${top}</span>`) + "</tr>";
  }).join("");
  const notes = DASH_TYPES.map(([t, c, n]) => `<span style="white-space:nowrap;"><b style="color:${c};">${t}</b>: ${desc(n)}</span>`).join(" · ");
  return `<div style="margin:8px 4px 0;border:1px solid #e3e6eb;border-radius:8px;background:#ffffff;background-color:#ffffff;overflow:hidden;padding:0 0 6px;${boxW(width)}">` +
    `<div style="padding:5px 8px;font-size:11px;font-weight:800;color:#002c5f;background:#f6f8fa;background-color:#f6f8fa;border-radius:7px 7px 0 0;">유형 구분별 반응 <span style="font-weight:400;color:#6b7079;">(글쓴이 유형 · 반응 기준 · 가장 많이 나온 여론)</span></div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;background:transparent;">${rows}</table>` +
    `<div style="padding:5px 8px;font-size:9.5px;color:#6b7079;line-height:1.6;background:#ffffff;">※ ${notes}</div></div>`;
}

// 서식 없는 곳에 붙여 넣을 때 (글자만)
function dashText(d, prev) {
  const diff = (v, pv) => (pv === null || pv === undefined ? "" : v - pv > 0 ? ` (▲${dnum(v - pv)})` : v - pv < 0 ? ` (▼${dnum(pv - v)})` : " (변동 없음)");
  const tones = (s) => DASH_TONES.map(([t]) => `${t} ${dpct(s.ratio[t])}`).join(" · ");
  const lines = [
    `[${d.title || "코리아 세일 페스타 차종별 동호회 반응"}] DASHBOARD - ${d.period} (${new Date(d.at).toLocaleString()} 기준)`,
    ...(d.summary || []).map((t) => `• ${t}`),
    `■ 전체: 게시글 ${dnum(d.posts)}${diff(d.posts, prev?.posts)} / 댓글 ${dnum(d.comments)}${diff(d.comments, prev?.comments)} / 반응 ${dnum(d.reactions)} · ${tones(d)}`,
    ...(d.reactions ? [`  → ${dashVerdict(d).text}`] : []),
  ];
  for (const c of d.cars) {
    const p = prev?.cars?.find((x) => x.car === c.car);
    lines.push(`■ ${c.car}: 게시글 ${dnum(c.posts)}${diff(c.posts, p?.posts)} / 댓글 ${dnum(c.comments)}${diff(c.comments, p?.comments)} / 반응 ${dnum(c.n)} · ${tones(c)}`);
    if (c.n) lines.push(`  → ${dashVerdict(c).text}`);
    lines.push(`  - 긍정: ${c.pos.slice(0, DASH_TOP).map((r, i) => `${i + 1}) ${r.label} ${dnum(r.count)}건(${dpct(r.ratio)})`).join(", ") || "해당 없음"}`);
    lines.push(`  - 부정: ${c.neg.slice(0, DASH_TOP).map((r, i) => `${i + 1}) ${r.label} ${dnum(r.count)}건(${dpct(r.ratio)})`).join(", ") || "해당 없음"}`);
  }
  if (d.types) {
    lines.push("■ 유형 구분별 반응");
    for (const t of d.types) lines.push(`  - ${t.type}: ${dnum(t.n)}건${t.n ? ` (${dpct(t.share)})` : ""}${t.top ? ` · ${t.top.quote ? "" : `[${t.top.tone}] `}${t.top.label}${t.top.quote ? "" : ` ${dnum(t.top.count)}건`}` : ""}`);
  }
  if (d.short) for (const [t] of DASH_TONES) if ((d.short[t] || []).length) lines.push(`■ ${t} 주요 댓글: ${d.short[t].map((q) => `‘${String(q).replace(/\s+/g, " ").slice(0, 80)}’`).join(", ")}`);
  if (d.unjudged) lines.push(`※ 잠정치: ${dnum(d.unjudged)}건은 AI 판단 전`);
  return lines.join("\n");
}

// 보여줄 숫자: 데이터 DB '차종별 반응 요약' 최근 기록(과 그 전 기록) · 기록이 없거나 '지금 작업 중인 값' 을 고르면 수집 화면의 지금 값
let dashMode = "db"; // "db" | "live"
let dashCache = null; // { d, prev }

async function dashData() {
  const rows = (await dbList("summary").catch(() => [])).filter((r) => r.stats?.kind === "dash");
  const { ksfDashLive } = await chrome.storage.local.get("ksfDashLive").catch(() => ({}));
  const withDate = (rec) => (rec ? { ...rec.stats, dateText: prettyDate(rec.date).slice(5) } : null);
  if (dashMode === "live" || !rows.length) {
    if (!ksfDashLive) return rows.length ? { d: withDate(rows[0]), prev: withDate(rows[1]), src: "db" } : null;
    return { d: ksfDashLive, prev: withDate(rows.find((r) => r.date < today()) || rows[0]), src: "live" };
  }
  return { d: withDate(rows[0]), prev: withDate(rows[1]), src: "db", rec: rows[0], live: ksfDashLive };
}

async function renderDash() {
  dashCache = await dashData();
  for (const id of ["dashCopy", "dashCopyLite", "dashCopyCode"]) $(`#${id}`).disabled = !dashCache;
  const src = $("#dashSrc");
  if (!dashCache) {
    $("#dashBody").innerHTML = `<div class="hint">아직 보여줄 숫자가 없습니다. 수집 화면에서 글을 찾고 본문·댓글을 읽은 뒤 [엑셀 만들기]를 누르면 여기에 대시보드가 보입니다.</div>`;
    src.textContent = "";
    return;
  }
  $("#dashBody").innerHTML = dashHtml(dashCache.d, dashCache.prev, chrome.runtime.getURL("icons/dash-banner.jpg"), true);
  const newer = dashCache.live && dashCache.rec && dashCache.live.at > dashCache.rec.savedAt + 5000;
  src.textContent = dashCache.src === "live"
    ? "지금 수집 화면에서 작업 중인 값입니다 (아직 엑셀로 만들지 않았을 수 있음)."
    : `데이터 DB ${prettyDate(dashCache.rec.date)} '차종별 반응 요약' 기준${newer ? " · 그 뒤 수집 화면에서 바뀐 값이 있습니다 ('지금 작업 중인 값 보기' 또는 수집 화면에서 [엑셀 만들기])" : ""}.`;
  // 버튼 이름은 지금 보이는 값의 반대쪽으로 · 데이터 DB 기록이 없으면 바꿔 볼 것이 없으니 숨김
  $("#dashLive").hidden = !(await dbList("summary").catch(() => [])).some((r) => r.stats?.kind === "dash");
  $("#dashLive").textContent = dashCache.src === "live" ? "데이터 DB 저장 값 보기" : "지금 작업 중인 값 보기";
}

function dashCopied(ok, withImg = true, why = "") {
  $("#dashInfo").textContent = ok
    ? `✔ ${withImg ? "" : "이미지 없이 "}복사했습니다. 메일 본문에 붙여 넣으세요 (Ctrl+V / ⌘V).${withImg ? " 붙여 넣기가 안 되면 '이미지 없이 복사'를 눌러 보세요." : ""}`
    : `복사하지 못했습니다${why ? `: ${why}` : ""}. 다시 눌러 주세요.`;
  $("#dashInfo").className = ok ? "hint ok" : "hint err";
}

// 서식(HTML)과 글자를 함께 복사 (복사 이벤트로 담고, 안 되면 클립보드 API)
function copyDash(withImg = true) {
  if (!dashCache) return;
  const html = `<html><body>${dashHtml(dashCache.d, dashCache.prev, withImg ? DASH_BANNER_URL : "")}</body></html>`;
  const text = dashText(dashCache.d, dashCache.prev);
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
  } catch {
    /* 아래 클립보드 API 로 */
  }
  document.removeEventListener("copy", onCopy);
  if (done) return dashCopied(true, withImg);
  navigator.clipboard
    .write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })])
    .then(() => dashCopied(true, withImg))
    .catch((e) => dashCopied(false, withImg, e.message));
}

// 메일 편집기의 'HTML' 탭에 붙여 넣을 코드(글자)로 복사 — 서식 붙여 넣기를 거부하는 편집기에서도 확실히 들어감
function copyDashCode() {
  if (!dashCache) return;
  const code = dashHtml(dashCache.d, dashCache.prev, DASH_BANNER_URL);
  let done = false;
  const onCopy = (e) => {
    e.clipboardData.setData("text/plain", code);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    document.execCommand("copy");
  } catch {
    /* 아래 클립보드 API 로 */
  }
  document.removeEventListener("copy", onCopy);
  const ok = () => {
    $("#dashInfo").textContent = "✔ HTML 코드를 복사했습니다. 메일 편집기 아래 'HTML' 탭 → 넣을 자리에 붙여 넣기 → 다시 '디자인' 탭으로 돌아오면 대시보드가 보입니다.";
    $("#dashInfo").className = "hint ok";
  };
  if (done) return ok();
  navigator.clipboard.writeText(code).then(ok).catch((e) => dashCopied(false, true, e.message));
}

$("#dashCopy")?.addEventListener("click", () => copyDash(true));
$("#dashCopyLite")?.addEventListener("click", () => copyDash(false));
$("#dashCopyCode")?.addEventListener("click", copyDashCode);
$("#dashLive")?.addEventListener("click", () => {
  dashMode = dashMode === "live" ? "db" : "live";
  renderDash();
});
