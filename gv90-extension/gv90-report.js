// GV90 보고용 대시보드 (메일·문서에 복사해 붙여 넣기)
// 모양: 왼쪽 남색 칸(제목 · 모니터링 기간 · 게시글/댓글/반응 · 전체 성향 막대 · 부정 vs 긍정 한 줄 · 모니터링 채널)
//      오른쪽(배너 그림 · 요약 2줄(직접 고칠 수 있음) · 채널별 카드(게시글·댓글·반응 · 성향 막대 · 긍정/부정 주요 내용 5개) · 구분(이슈)별 반응)
// 메일 편집기에서도 깨지지 않게 표(table)와 글자에 직접 준 서식(inline style)만 쓴다.
// 성향은 게시물 기준(댓글 성향을 모으면 반응=게시물+댓글 기준으로 자동으로 바뀜)

const RP_COLOR = { 긍정: "#1f6fd1", 중립: "#16a34a", 부정: "#e0201b", 단순비난: "#d9a400" };
const RP_DOT = { 긍정: "#1f6fd1", 중립: "#16a34a", 부정: "#e0201b", 단순비난: "#d9a400" };
const RP_TEXT = { 긍정: "#1f6fd1", 중립: "#16a34a", 부정: "#e0201b", 단순비난: "#b8860b" }; // 글자색 (단순비난은 진한 노랑)
const RP_NAVY = "#002c5f";
const RP_CARD = { 언론: "#002c5f", 동호회: "#0a7f86", 유튜브: "#b5651d", "자동차 커뮤니티": "#6b4fa8" };
const RP_FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";
// 메일 붙여 넣기용 배너는 인터넷 주소로 (그림을 글자로 담으면 그룹웨어 편집기가 붙여 넣기를 거부하는 경우가 있음)
// 커밋 번호로 고정한 주소라 파일이 나중에 바뀌어도 보낸 메일의 그림은 그대로
const RP_BANNER_URL = "https://raw.githubusercontent.com/khagu77/khagu77/8b4909439d2f199aeb9ecbdfa55df5837d221cda/gv90-extension/icons/report-banner.jpg";

const rpEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0.0%");
const WD = "일월화수목금토";
const mdw = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 보고 자료: days(고른 보고일들) · posts · comments → 집계
function reportData(days, allPosts, allComments) {
  const set = new Set(days.map((d) => d.day));
  const posts = allPosts.filter((p) => set.has(p.day));
  // 댓글: 이 보고 범위 게시글에 달린 댓글 (댓글을 모은 날이 아니라 게시글 기준)
  const postKeys = new Set(posts.map((p) => p.key));
  const comments = allComments.filter((c) => postKeys.has(c.postKey));
  const from = Math.min(...days.map((d) => d.from || new Date(+d.day.slice(0, 4), +d.day.slice(4, 6) - 1, +d.day.slice(6, 8)).getTime() - 86400000));
  const to = Math.max(...days.map((d) => d.to || new Date(+d.day.slice(0, 4), +d.day.slice(4, 6) - 1, +d.day.slice(6, 8)).getTime()));
  // 반응 = 게시물 + (성향을 판정한) 댓글 · 댓글은 댓글마다 자기 구분('모두 포함(…)' 포함)
  const reacts = [...posts.map((p) => ({ ...p, kind: "post" })), ...comments.filter((c) => c.sentiment).map((c) => ({ ...c, kind: "comment", summary: c.summary || c.text }))];
  // 댓글 수: 게시글마다 '사이트에 보이는 댓글 수'와 '모은 댓글 수' 중 큰 쪽 → 채널별 합 · 전체 합 (전체 = 채널 합계와 꼭 같게)
  const got = new Map();
  for (const c of comments) got.set(c.postKey, (got.get(c.postKey) || 0) + 1);
  const ccOf = (p) => Math.max(p.ccount || 0, got.get(p.key) || 0);
  const ccount = (list) => list.reduce((s, p) => s + ccOf(p), 0);
  const channels = CHANNELS.map((ch) => {
    const ps = posts.filter((p) => p.channel === ch);
    const rs = reacts.filter((r) => r.channel === ch);
    const media = [...new Set(ps.map((p) => p.media).filter(Boolean))];
    return { ch, posts: ps.length, comments: ccount(ps), reacts: rs, media };
  }).filter((c) => c.posts);
  const categories = CATEGORIES.map((cat) => ({ cat, reacts: reacts.filter((r) => catList(r.category).includes(cat)) })).filter((c) => c.reacts.length);
  return { days, from, to, posts, comments, reacts, totalComments: ccount(posts), channels, categories };
}

const sentCount = (list) => Object.fromEntries(SENTIMENTS.map((s) => [s, list.filter((r) => (r.sentiment || "중립") === s).length]));

// 주요 내용 상위 n개 (같은 내용끼리 묶어 건수 · 같으면 반응(댓글·조회) 많은 순)
function topOpinions(list, n = 5) {
  const m = new Map();
  for (const r of list) {
    const k = String(r.summary || r.title || "").replace(/\s+/g, " ").trim();
    if (!k) continue;
    const g = m.get(k) || { text: k, n: 0, weight: 0, url: r.url };
    g.n++;
    g.weight += (r.ccount || 0) * 50 + (r.views || 0);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.weight - a.weight).slice(0, n);
}

// 성향 막대 (표 칸 너비 비율 · 메일에서도 보이게)
function rpBar(sc, total, height = 10) {
  if (!total) return `<div style="height:${height}px;background:#e5e7eb;font-size:0;line-height:0">&nbsp;</div>`;
  const cells = SENTIMENTS.filter((s) => sc[s])
    .map((s) => `<td style="width:${((sc[s] / total) * 100).toFixed(2)}%;background:${RP_COLOR[s]};height:${height}px;font-size:0;line-height:0;padding:0">&nbsp;</td>`)
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>${cells}</tr></table>`;
}

function rpLegend(sc, total, color = "#1f2937", size = 13) {
  return SENTIMENTS.map((s) => `<span style="white-space:nowrap;margin-right:10px;color:${color};font-size:${size}px"><span style="color:${RP_DOT[s]}">●</span> ${s} <b>${pct(sc[s], total)}</b></span>`).join(" ");
}

function rpVerdict(sc, total, size = 13) {
  const neg = (sc.부정 || 0) + (sc.단순비난 || 0);
  const pos = sc.긍정 || 0;
  const hi = neg > pos;
  const same = neg === pos;
  const text = `부정 여론(부정+단순비난)이 긍정 여론 ${same ? "과 비슷한" : `比 ${hi ? "높은" : "낮은"}`} 편 (${pct(neg, total)} vs ${pct(pos, total)})`;
  return { hi, text, html: `<div style="background:${same ? "#f3f4f6" : hi ? "#fdecec" : "#e8f1fc"};color:${same ? "#374151" : hi ? "#d0021b" : "#1f5fbf"};font-weight:700;font-size:${size}px;padding:7px 10px;border-radius:4px;line-height:1.45">${rpEsc(text)}</div>` };
}

// 자동 요약 2줄 (화면에서 직접 고칠 수 있음)
function rpAutoSummary(d) {
  const sc = sentCount(d.reacts);
  const total = d.reacts.length;
  const neg = (sc.부정 || 0) + (sc.단순비난 || 0);
  const topCh = [...d.channels].sort((a, b) => b.posts - a.posts)[0];
  const negTop = topOpinions(d.reacts.filter((r) => r.sentiment === "부정" || r.sentiment === "단순비난"), 2).map((o) => o.text);
  const posTop = topOpinions(d.reacts.filter((r) => r.sentiment === "긍정"), 1).map((o) => o.text);
  const negCat = [...d.categories].sort((a, b) => sentCount(b.reacts).부정 + sentCount(b.reacts).단순비난 - (sentCount(a.reacts).부정 + sentCount(a.reacts).단순비난))[0];
  return [
    `GV90 관련 게시글 ${d.posts.length.toLocaleString()}건 중 ${topCh ? `${topCh.ch} 비중이 가장 높고(${pct(topCh.posts, d.posts.length)})` : ""}, 부정 여론 ${pct(neg, total)} · 긍정 ${pct(sc.긍정, total)}${negCat ? ` · 부정은 '${negCat.cat}' 이슈 중심` : ""}`,
    `${negTop.length ? `부정: ${negTop.join(", ")}` : "특이 부정 이슈 없음"}${posTop.length ? ` / 긍정: ${posTop[0]}` : ""}`,
  ];
}

function rpOpinionRows(list, color) {
  if (!list.length) return `<tr><td colspan="3" style="padding:6px 4px;color:#9ca3af;font-size:13px">해당 없음</td></tr>`;
  const total = list.total;
  return list
    .map(
      (o, i) =>
        `<tr><td style="width:18px;padding:6px 4px;color:#9ca3af;font-size:12px;border-bottom:1px solid #eef0f3;vertical-align:top">${i + 1}</td>` +
        `<td style="padding:6px 4px;font-size:11px;letter-spacing:-0.4px;color:#111827;border-bottom:1px solid #eef0f3;line-height:1.45">${rpEsc(o.text)}</td>` +
        `<td style="padding:6px 4px;text-align:right;white-space:nowrap;border-bottom:1px solid #eef0f3;vertical-align:top"><b style="color:${color};font-size:13px">${o.n}</b> <span style="color:#9ca3af;font-size:12px">${pct(o.n, total)}</span></td></tr>`,
    )
    .join("");
}

// 출처(커뮤니티명) 한 줄: 들어가는 만큼 'A · B 외 N곳' (12px 글자 폭 어림: 한글 12 · 그 밖 6.6)
function rpTextW(t) {
  let w = 0;
  for (const ch of String(t)) w += /[가-힣ㄱ-ㅎㅏ-ㅣ一-龥■★●◆▶]/.test(ch) ? 12 : 6.6;
  return w;
}
function rpOneLine(names, maxW, unit = "곳") {
  const list = (names || []).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const rest = list.length - i - 1;
    const tail = rest ? ` 외 ${rest}${unit}` : "";
    const cand = [...out, list[i]].join(" · ");
    if (rpTextW(cand + tail) <= maxW) {
      out.push(list[i]);
      continue;
    }
    if (!out.length) {
      // 첫 이름이 길면 줄여서 '…'
      let t = list[i];
      while (t.length > 1 && rpTextW(`${t}… 외 ${list.length - 1}${unit}`) > maxW) t = t.slice(0, -1);
      return `${t}…${list.length > 1 ? ` 외 ${list.length - 1}${unit}` : ""}`;
    }
    return `${out.join(" · ")} 외 ${list.length - out.length}${unit}`;
  }
  return out.join(" · ");
}

function rpCard(c, cardPx = 330) {
  const inW = cardPx - 12;
  const tdOpen = `<td width="${cardPx}" style="width:${inW}px;min-width:${inW}px;padding:6px;vertical-align:top"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${inW}" style="width:${inW}px;min-width:${inW}px;border-collapse:collapse"><tr><td>`;
  const tdClose = `</td></tr></table></td>`;
  const color0 = RP_CARD[c.ch] || RP_NAVY;
  if (!c.posts) {
    // 그날 글이 없는 채널도 자리는 잡아 두고 0건 · 관련 게시글 없음 (후보를 확인했으면 왜 0건인지)
    const ex = c.excluded;
    const stat0 = (k) => `<td style="width:33%;padding:0 3px"><div style="background:#f3f4f6;border-radius:6px;padding:8px 10px"><div style="font-size:12px;color:#6b7280">${k}</div><div style="font-size:21px;font-weight:800;color:#9ca3af">0<span style="font-size:12px;font-weight:400;color:#6b7280"> 건</span></div></div></td>`;
    const why = ex && ex.n ? Object.entries(ex.why).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}건`).join(", ") : "";
    const note = ex && ex.n
      ? `수집 후보 <b>${ex.n}건</b>을 확인했으나, 분석 결과 보고 대상(GV90 관련 게시글)이 아니어서 <b>0건</b>으로 집계함<br><span style="color:#9ca3af">사유: ${rpEsc(why)}</span>`
      : "모니터링 기간에 GV90 관련 게시글이 올라오지 않음";
    return (
      tdOpen +
      `<div style="border:1px solid #e5e7eb;border-top:4px solid ${color0};border-radius:8px;padding:10px 12px;background:#fff">` +
      `<div><span style="display:inline-block;background:${color0};color:#fff;font-weight:800;font-size:15px;padding:3px 12px;border-radius:999px">${rpEsc(c.ch === "자동차 커뮤니티" ? "커뮤니티" : c.ch)}</span></div>` +
      `<div style="color:#6b7280;font-size:12px;margin:4px 0 8px;line-height:1.4">&nbsp;</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>${stat0("게시글")}${stat0("댓글")}${stat0("반응")}</tr></table>` +
      `<div style="margin:6px 0;padding:22px 14px;background:#f9fafb;border:1px dashed #d1d5db;border-radius:8px;text-align:center">` +
      `<div style="color:#374151;font-size:15px;font-weight:800;margin-bottom:6px">해당일에 관련 게시글 없음</div>` +
      `<div style="color:#6b7280;font-size:12.5px;line-height:1.6">${note}</div></div>` +
      `</div>` + tdClose
    );
  }
  const sc = sentCount(c.reacts);
  const total = c.reacts.length;
  const pos = c.reacts.filter((r) => r.sentiment === "긍정");
  const neg = c.reacts.filter((r) => r.sentiment === "부정" || r.sentiment === "단순비난");
  const posTop = Object.assign(topOpinions(pos), { total: pos.length });
  const negTop = Object.assign(topOpinions(neg), { total: neg.length });
  const color = RP_CARD[c.ch] || RP_NAVY;
  const stat = (k, v) => `<td style="width:33%;padding:0 3px"><div style="background:#f3f4f6;border-radius:6px;padding:8px 10px"><div style="font-size:12px;color:#6b7280">${k}</div><div style="font-size:21px;font-weight:800;color:#111827">${v.toLocaleString()}<span style="font-size:12px;font-weight:400;color:#6b7280"> 건</span></div></div></td>`;
  const media = rpOneLine(c.media, inW - 26, c.ch === "유튜브" ? "개" : "곳");
  return (
    tdOpen +
    `<div style="border:1px solid #e5e7eb;border-top:4px solid ${color};border-radius:8px;padding:10px 12px;background:#fff">` +
    `<div><span style="display:inline-block;background:${color};color:#fff;font-weight:800;font-size:15px;padding:3px 12px;border-radius:999px">${rpEsc(c.ch === "자동차 커뮤니티" ? "커뮤니티" : c.ch)}</span> <span style="color:#6b7280;font-size:12px">${c.media.length}곳</span></div>` +
    `<div style="color:#6b7280;font-size:12px;margin:4px 0 8px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${rpEsc(c.media.join(" · "))}">${rpEsc(media)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>${stat("게시글", c.posts)}${stat("댓글", c.comments)}${stat("반응", c.posts + c.comments)}</tr></table>` +
    rpBar(sc, total, 10) +
    `<div style="margin:6px 0">${rpLegend(sc, total, "#1f2937", 12)}</div>` +
    rpVerdict(sc, total, 12).html +
    `<div style="margin-top:8px;font-weight:800;color:#1f5fbf;font-size:13px;border-bottom:2px solid #1f5fbf;padding-bottom:3px">긍정 주요 내용 <span style="font-weight:400;color:#6b7280">(${pos.length})</span></div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${rpOpinionRows(posTop, "#1f5fbf")}</table>` +
    `<div style="margin-top:8px;font-weight:800;color:#d0021b;font-size:13px;border-bottom:2px solid #d0021b;padding-bottom:3px">부정 주요 내용 <span style="font-weight:400;color:#6b7280">(${neg.length})</span></div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${rpOpinionRows(negTop, "#d0021b")}</table>` +
    `</div>` + tdClose
  );
}

// 모니터링 채널: 그날 글이 나온 곳이 아니라 설정에서 모니터링하는 전체 (켜 둔 채널 · 카페 · 유튜브 채널 · 커뮤니티)
function monitorText(s) {
  const on = s.channels || {};
  const parts = [];
  if (on.news) parts.push("언론 네이버 뉴스 전체");
  if (on.youtube) parts.push(`유튜브 ${(s.youtubeChannels || []).filter((c) => c.on !== false).length}개 채널${s.youtubeSearch ? " + 검색" : ""}`);
  if (on.cafe) parts.push(`동호회 ${(s.cafes || []).filter((c) => c.on).length}곳`);
  if (on.community) parts.push(`커뮤니티 ${(s.communities || []).filter((c) => c.on).length}곳`);
  return parts.join(" · ");
}

// 대시보드 폭: 채널 카드 4개가 한 줄에 들어가게 넓게 (왼쪽 남색 칸 300 + 오른쪽)
const RP_WIDTH = 1680;
const RP_BANNER_W = 640;
const RP_R = 14; // 바깥 모서리 둥글기
const RP_RIGHT_W = RP_WIDTH - 2 - 300 - 32; // 오른쪽 칸 안쪽 폭 (메일에 붙여도 칸 폭이 그대로 되게 px 로 고정)

// 전체 보고 대시보드 HTML. banner: 그림 주소("" 이면 그림 없이) · summary: [줄1, 줄2] · editable: 화면에서 요약을 고칠 수 있게
function reportHtml(d, { banner = "", summary = null, editable = false, now = new Date() } = {}) {
  const sc = sentCount(d.reacts);
  const total = d.reacts.length;
  const v = rpVerdict(sc, total, 15);
  const lines = summary || rpAutoSummary(d);
  const chNames = { 언론: "언론", 동호회: "동호회", 유튜브: "유튜브", "자동차 커뮤니티": "커뮤니티" };
  const chText = d.channels.map((c) => `${chNames[c.ch]} ${c.media.length}${c.ch === "유튜브" ? "개 채널" : "곳"}`).join(" · ");
  const ed = editable ? ' contenteditable="true" data-summary' : "";
  // 채널 카드는 한 줄에 모두 (언론 · 유튜브 · 동호회 · 커뮤니티)
  //  그날 글이 없는 채널(예: 유튜브)도 자리를 잡고 '해당일에 관련 게시글 없음'
  const chOrder = typeof CHANNELS !== "undefined" ? CHANNELS : ["언론", "유튜브", "동호회", "자동차 커뮤니티"];
  const allCh = chOrder.filter((ch) => !d.channelsOn || d.channelsOn.includes(ch)).map((ch) => d.channels.find((c) => c.ch === ch) || { ch, posts: 0, comments: 0, reacts: [], media: [], excluded: d.excluded?.[ch] });
  const cardPx = Math.floor(RP_RIGHT_W / Math.max(1, allCh.length));
  const cards = [`<tr>${allCh.map((c) => rpCard(c, cardPx)).join("")}</tr>`];
  const catRows = d.categories
    .sort((a, b) => b.reacts.length - a.reacts.length)
    .map((c) => {
      const s = sentCount(c.reacts);
      const n = c.reacts.length;
      const top = topOpinions(c.reacts, 1)[0];
      const topSent = top ? (c.reacts.find((r) => (r.summary || r.title || "").replace(/\s+/g, " ").trim() === top.text)?.sentiment || "중립") : "";
      const tc = topSent === "긍정" ? "#1f5fbf" : topSent === "부정" || topSent === "단순비난" ? "#d0021b" : "#374151";
      return (
        `<tr><td style="padding:9px 10px;border-bottom:1px solid #eef0f3;color:#4b3fa8;font-weight:800;font-size:14px;white-space:nowrap">${rpEsc(c.cat)}</td>` +
        `<td style="padding:9px 6px;border-bottom:1px solid #eef0f3;white-space:nowrap;font-size:13px"><b style="font-size:16px">${n}</b> 건 <span style="color:#6b7280">${pct(n, total)}</span></td>` +
        `<td style="padding:9px 6px;border-bottom:1px solid #eef0f3;width:170px">${rpBar(s, n, 9)}<div style="font-size:12px;margin-top:3px"><span style="color:#1f5fbf">긍 ${pct(s.긍정, n)}</span> · <span style="color:#d0021b">부 ${pct(s.부정 + s.단순비난, n)}</span></div></td>` +
        `<td style="padding:9px 10px;border-bottom:1px solid #eef0f3;font-size:11px;letter-spacing:-0.4px">${top ? `<b style="color:${tc}">[${rpEsc(topSent)}]</b> ${rpEsc(top.text)} <span style="color:#9ca3af">${top.n}건</span>` : ""}</td></tr>`
      );
    })
    .join("");
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${RP_WIDTH}" style="width:${RP_WIDTH}px;table-layout:fixed;border-collapse:separate;border-spacing:0;font-family:${RP_FONT};background:#ffffff;border:1px solid #e5e7eb;border-radius:${RP_R}px"><tr>` +
    // 왼쪽 남색 칸
    `<td width="300" bgcolor="${RP_NAVY}" style="width:256px;background:${RP_NAVY};color:#ffffff;vertical-align:top;padding:22px 22px 0;border-radius:${RP_R}px 0 0 0;min-width:256px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="256" bgcolor="${RP_NAVY}" style="width:256px;min-width:256px;max-width:256px;border-collapse:collapse;color:#ffffff;background:${RP_NAVY}"><tr><td bgcolor="${RP_NAVY}" style="background:${RP_NAVY};color:#ffffff;padding:0">` +
    `<div style="color:#ffffff;font-size:14px;opacity:.9">GV90(JG1) 관련 여론 동향</div>` +
    `<div style="color:#ffffff;font-size:34px;font-weight:900;letter-spacing:.5px;margin:2px 0 14px">DASHBOARD</div>` +
    `<div style="color:#ffffff;font-size:13px;opacity:.85">모니터링 기간</div>` +
    `<div style="color:#ffffff;font-size:16px;font-weight:800;margin:2px 0">${mdw(d.from)} ~ ${mdw(d.to)}</div>` +
    `<div style="color:#ffffff;font-size:12px;opacity:.8">${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} 기준</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="256" bgcolor="${RP_NAVY}" style="width:256px;border-collapse:collapse;margin:16px 0 14px;background:${RP_NAVY}"><tr><td height="1" style="height:1px;padding:0;background:#4a6390;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td></tr></table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${RP_NAVY}" style="border-collapse:collapse;color:#ffffff;background:${RP_NAVY}"><tr>` +
    [["게시글", d.posts.length], ["댓글", d.totalComments], ["반응", d.posts.length + d.totalComments]]
      .map(([k, n]) => `<td bgcolor="${RP_NAVY}" style="padding:0 18px 0 0;vertical-align:top;background:${RP_NAVY};color:#ffffff"><div style="color:#ffffff;font-size:13px;opacity:.85">${k}</div><div style="color:#ffffff;font-size:26px;font-weight:900">${n.toLocaleString()}<span style="color:#ffffff;font-size:13px;font-weight:400"> 건</span></div></td>`)
      .join("") +
    `</tr></table>` +
    `<div style="color:#ffffff;font-size:13px;opacity:.9;margin:22px 0 8px">전체 성향 (${d.comments.some((c) => c.sentiment) ? "성향을 분석한 반응" : "게시글"} ${total.toLocaleString()}건)</div>` +
    rpBar(sc, total, 14) +
    `<div style="margin:10px 0;line-height:2">${rpLegend(sc, total, "#ffffff", 14)}</div>` +
    `<div style="color:${v.hi ? "#ffcf3f" : "#9fd0ff"};font-weight:800;font-size:15px;line-height:1.5;margin:10px 0">${rpEsc(v.text)}</div>` +
    `<div style="color:#ffffff;font-size:13px;opacity:.85;line-height:1.5;margin-top:14px">모니터링 채널: ${rpEsc(d.monitor || chText || "-")}</div>` +
    `</td></tr></table></td>` +
    // 오른쪽 (왼쪽 남색 칸 두 줄 높이)
    `<td rowspan="2" width="${RP_WIDTH - 300}" style="width:${RP_RIGHT_W}px;vertical-align:top;padding:16px 16px 12px">` +
    // 위: 그림(왼쪽) + 요약 두 줄(오른쪽) — 넓은 화면에서 그림이 너무 커지지 않게 나란히
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${RP_RIGHT_W}" style="width:${RP_RIGHT_W}px;table-layout:fixed;border-collapse:collapse;margin-bottom:6px"><tr>` +
    (banner ? `<td width="${RP_BANNER_W + 6}" style="width:${RP_BANNER_W}px;padding:0 6px 0 0;vertical-align:top"><img src="${rpEsc(banner)}" width="${RP_BANNER_W}" alt="GV90" style="display:block;width:${RP_BANNER_W}px;height:auto;border-radius:8px"></td>` : "") +
    `<td style="vertical-align:middle;padding:0 6px">` +
    `<div style="border:1px solid #e5e7eb;border-left:5px solid ${RP_NAVY};border-radius:6px;padding:12px 16px;background:#f9fafb">` +
    lines.map((l, i) => `<div style="font-size:16px;font-weight:800;color:#111827;line-height:1.7"${ed}${editable ? `="${i}"` : ""}>• ${rpEsc(String(l).replace(/^•\s*/, ""))}</div>`).join("") +
    `</div></td></tr></table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${RP_RIGHT_W}" style="width:${RP_RIGHT_W}px;table-layout:fixed;border-collapse:collapse">${cards.join("")}</table>` +
    (catRows
      ? `<div style="border:1px solid #e5e7eb;border-radius:8px;margin:10px 6px 0;overflow:hidden">` +
        `<div style="background:#f3f4f6;padding:8px 12px;font-size:14px"><b style="color:${RP_NAVY}">구분(이슈)별 반응</b> <span style="color:#6b7280">(${d.comments.some((c) => c.sentiment) ? "반응" : "게시글"} 기준 · 가장 많이 나온 내용)</span></div>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${catRows}</table></div>`
      : "") +
    `</td></tr>` +
    // 왼쪽 남색 칸 맨 아래: 서명 (By LINESQUARE) · 아래 모서리 둥글게
    `<tr><td width="300" bgcolor="${RP_NAVY}" style="width:256px;height:56px;background:${RP_NAVY};color:#ffffff;vertical-align:bottom;padding:0 22px 20px;border-radius:0 0 0 ${RP_R}px;font-size:14px;color:#ffffff"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="256" bgcolor="${RP_NAVY}" style="width:256px;border-collapse:collapse;background:${RP_NAVY}"><tr><td bgcolor="${RP_NAVY}" style="color:#ffffff;font-size:14px;background:${RP_NAVY};padding:0">By <b><i style="letter-spacing:.3px">LINESQUARE</i></b></td></tr></table></td></tr></table>`
  );
}

// 붙여 넣기용 글자(서식 없는 곳)
function reportText(d, lines) {
  const sc = sentCount(d.reacts);
  const total = d.reacts.length;
  const out = [
    `GV90(JG1) 관련 여론 동향 (${mdw(d.from)} ~ ${mdw(d.to)})`,
    `게시글 ${d.posts.length}건 · 댓글 ${d.totalComments}건 · 반응 ${d.posts.length + d.totalComments}건`,
    `전체 성향: ${SENTIMENTS.map((s) => `${s} ${pct(sc[s], total)}`).join(" · ")}`,
    ...lines.map((l) => `• ${String(l).replace(/^•\s*/, "")}`),
  ];
  for (const c of d.channels) {
    const s = sentCount(c.reacts);
    out.push(`[${c.ch}] 게시글 ${c.posts} · 댓글 ${c.comments} · ${SENTIMENTS.map((x) => `${x} ${pct(s[x], c.reacts.length)}`).join(" · ")}`);
  }
  return out.join("\n");
}
