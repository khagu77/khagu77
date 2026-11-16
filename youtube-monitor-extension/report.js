// 통계 계산 · 대시보드 HTML(화면·메일 공통, 인라인 서식) · 엑셀(썸네일·꺾은선 차트 포함)

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const num = (n) => (n == null || isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
function parseYmd(s) {
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function shortNum(n) {
  if (n == null) return "-";
  // 천 단위 콤마: 2,016만 · 1.2억 · 12,345만
  const f = (x, d) => x.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (n >= 1e8) return `${f(n / 1e8, n >= 1e9 ? 0 : 1)}억`;
  if (n >= 1e4) return `${f(n / 1e4, n >= 1e5 ? 0 : 1)}만`;
  return num(n);
}
const escH = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function fmtDT(d) {
  d = new Date(d);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 기간 안의 '포함' 영상으로 대시보드·엑셀용 숫자 계산
function computeStats(videos, { start, end, group = "all", all = false } = {}) {
  const s = parseYmd(start) || new Date(2026, 8, 1);
  const e = parseYmd(end) || new Date(new Date().setHours(0, 0, 0, 0));
  const eNext = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
  const list = videos
    .filter((v) => (all || v.include) && v.published && (group === "all" || v.group === group))
    .filter((v) => {
      const t = new Date(v.published).getTime();
      return t >= s.getTime() && t < eNext.getTime();
    })
    .sort((a, b) => new Date(a.published) - new Date(b.published));
  const days = [];
  for (let d = new Date(s); d <= e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
    days.push({ date: new Date(d), key: ymd(d), count: 0, views: 0, comments: 0, managed: 0, econ: 0, other: 0 });
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const v of list) {
    const d = byKey.get(ymd(new Date(v.published)));
    if (!d) continue;
    d.count++;
    d.views += v.views || 0;
    d.comments += v.comments || 0;
    d[v.group || "other"]++;
  }
  let cum = 0;
  days.forEach((d, i) => {
    cum += d.count;
    d.cum = cum;
    const w = days.slice(Math.max(0, i - 6), i + 1);
    d.ma7 = i >= 6 ? w.reduce((a, x) => a + x.count, 0) / 7 : null;
  });
  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  // 주간 (월요일 시작)
  const weeks = [];
  for (const d of days) {
    const mon = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate() - ((d.date.getDay() + 6) % 7));
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== ymd(mon)) weeks.push((w = { key: ymd(mon), from: d.date, to: d.date, count: 0, views: 0, comments: 0 }));
    w.to = d.date;
    w.count += d.count;
    w.views += d.views;
    w.comments += d.comments;
  }
  weeks.forEach((w, i) => (w.diff = i ? w.count - weeks[i - 1].count : null));
  // 채널별
  const chMap = new Map();
  for (const v of list) {
    const k = v.channelId || v.channelName;
    let c = chMap.get(k);
    if (!c) chMap.set(k, (c = { name: v.channelName, id: v.channelId, url: v.channelUrl, group: v.group || "other", count: 0, views: 0, comments: 0, first: v.published, last: v.published }));
    c.count++;
    c.views += v.views || 0;
    c.comments += v.comments || 0;
    if (new Date(v.published) > new Date(c.last)) c.last = v.published;
    if (new Date(v.published) < new Date(c.first)) c.first = v.published;
  }
  const channels = [...chMap.values()].sort((a, b) => b.count - a.count || b.views - a.views);
  // 프레임(AI) · 부정 단어
  const frames = new Map();
  const words = new Map();
  for (const v of list) {
    if (v.ai?.frame) frames.set(v.ai.frame, (frames.get(v.ai.frame) || 0) + 1);
    for (const w of v.negHits || []) words.set(w, (words.get(w) || 0) + 1);
  }
  const groups = { managed: 0, econ: 0, other: 0 };
  for (const v of list) groups[v.group || "other"]++;
  return {
    start: s,
    end: e,
    list,
    days,
    weeks,
    channels,
    groups,
    frames: [...frames.entries()].sort((a, b) => b[1] - a[1]),
    words: [...words.entries()].sort((a, b) => b[1] - a[1]),
    total: list.length,
    views: sum(list, "views"),
    comments: sum(list, "comments"),
    likes: sum(list, "likes"),
    last7: sum(last7, "count"),
    prev7: sum(prev7, "count"),
    lastDay: days[days.length - 1]?.count || 0,
    prevDay: days[days.length - 2]?.count || 0,
    peak: days.reduce((m, d) => (d.count > (m?.count || 0) ? d : m), null),
    top: [...list].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5),
    recent: [...list].reverse().slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// 일자별 발행 꺾은선 (SVG — 메일에서도 보이게 직접 그림)
// ---------------------------------------------------------------------------
const C_LINE = "#2a78d6"; // 일자별 발행 수
const C_MA = "#eb6834"; // 7일 평균
const DASH_FONT = "'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif";

function dailyChartSvg(days, W = 912, H = 230, interactive = false) {
  const L = 34, R = 14, T = 18, B = 26;
  const n = days.length;
  if (!n) return "";
  const max = Math.max(4, ...days.map((d) => d.count));
  const step = max <= 8 ? 2 : max <= 20 ? 5 : max <= 40 ? 10 : Math.ceil(max / 4 / 10) * 10;
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%;height:auto;" font-family="${DASH_FONT.replace(/'/g, "")}">`;
  for (let v = 0; v <= top; v += step) {
    s += `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="${v ? "#eceef2" : "#bfc5cd"}" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" font-size="10" text-anchor="end" fill="#8a8f98">${v}</text>`;
  }
  // x 축: 월요일마다 날짜 (첫 날도)
  days.forEach((d, i) => {
    const mon = d.date.getDay() === 1;
    if (i === 0 || mon || i === n - 1) {
      if (i !== 0 && i !== n - 1 && (i < 3 || i > n - 4)) return;
      s += `<line x1="${x(i).toFixed(1)}" y1="${H - B}" x2="${x(i).toFixed(1)}" y2="${H - B + 4}" stroke="#bfc5cd"/>`;
      s += `<text x="${x(i).toFixed(1)}" y="${H - B + 15}" font-size="10" text-anchor="middle" fill="${i === n - 1 ? "#1b1d21" : "#8a8f98"}"${i === n - 1 ? ' font-weight="700"' : ""}>${md(d.date)}</text>`;
    }
  });
  // 7일 평균 (점선)
  const ma = days.map((d, i) => (d.ma7 == null ? null : `${x(i).toFixed(1)},${y(d.ma7).toFixed(1)}`)).filter(Boolean);
  if (ma.length > 1) s += `<polyline points="${ma.join(" ")}" fill="none" stroke="${C_MA}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>`;
  // 일자별 발행 수
  s += `<polyline points="${days.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(" ")}" fill="none" stroke="${C_LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  days.forEach((d, i) => {
    if (d.count) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(d.count).toFixed(1)}" r="2.6" fill="${C_LINE}" stroke="#ffffff" stroke-width="1"/>`;
  });
  // 직접 표시: 최고점 · 마지막 날
  const peakI = days.reduce((m, d, i) => (d.count > days[m].count ? i : m), 0);
  const label = (i, txt, bold) => {
    // 글자 폭(대략: 한글 11px · 숫자·기호 6.5px)만큼 그래프 안쪽으로 → 양 끝에서 잘리지 않게
    const tw = [...txt].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 11 : 6.5), 0);
    const tx = Math.min(Math.max(x(i), L + tw / 2 + 2), W - tw / 2 - 2);
    s += `<text x="${tx.toFixed(1)}" y="${(y(days[i].count) - 8).toFixed(1)}" font-size="11" font-weight="${bold ? 800 : 700}" text-anchor="middle" fill="#1b1d21">${txt}</text>`;
  };
  if (days[peakI].count) label(peakI, `최고 ${days[peakI].count}건 (${md(days[peakI].date)})`, true);
  if (n - 1 !== peakI) label(n - 1, `${days[n - 1].count}건`, false);
  if (interactive) {
    // 화면에서만: 날짜마다 마우스 올리면 수치 (메일에는 넣지 않음)
    const cw = (W - L - R) / Math.max(1, n - 1);
    days.forEach((d, i) => {
      s += `<rect class="hit" data-i="${i}" x="${(x(i) - cw / 2).toFixed(1)}" y="${T}" width="${cw.toFixed(1)}" height="${H - T - B}" fill="transparent"/>`;
    });
    s += `<line class="cross" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="#1b1d21" stroke-width="1" stroke-dasharray="2 2" visibility="hidden"/>`;
  }
  return s + "</svg>";
}

// ---------------------------------------------------------------------------
// 대시보드 HTML — 메일 본문에 그대로 붙일 수 있게 표 + 인라인 서식 (fluid=true 면 화면용으로 꽉 차게)
// ---------------------------------------------------------------------------
// 메일에 붙여 넣는 그림은 인터넷 주소로 (커밋 번호로 고정 — 파일이 나중에 바뀌어도 보낸 메일의 그림은 그대로)
const BANNER_URL = "https://raw.githubusercontent.com/khagu77/khagu77/a7d91020bcceb8593d835ba34fc06bf6e9261323/youtube-monitor-extension/icons/banner-blend.jpg";
const LOGO_URL = "https://raw.githubusercontent.com/khagu77/khagu77/c12e53781afc278422ed10e8490113aab9db8ae5/youtube-monitor-extension/icons/logo.png";

function diffPill(d, unit = "") {
  if (d == null) return "";
  const [t, c] = d > 0 ? [`▲${num(d)}${unit}`, "#d93025"] : d < 0 ? [`▼${num(-d)}${unit}`, "#1a5fd0"] : ["변동 없음", "#6b7280"];
  return `<span style="display:inline-block;color:${c};font-size:11px;font-weight:800;white-space:nowrap;">${t}</span>`;
}

function dashHtml(st, { fluid = false, banner = BANNER_URL, logo = LOGO_URL, chartInteractive = false, stamp = new Date(), channelCount = 0 } = {}) {
  const W = 960;
  const box = (inner, extra = "") => `<div style="border:1px solid #d9dde3;border-radius:10px;background:#ffffff;padding:12px 14px;${extra}">${inner}</div>`;
  const h3 = (t, sub = "") => `<div style="font-size:14px;font-weight:800;color:#1b1d21;margin:0 0 8px;">${t}${sub ? ` <span style="font-size:11px;font-weight:400;color:#6b7280;">${sub}</span>` : ""}</div>`;
  const period = `'${String(st.start.getFullYear()).slice(2)}. ${st.start.getMonth() + 1}. ${st.start.getDate()}. ~ ${st.end.getMonth() + 1}. ${st.end.getDate()}.`;
  const kpi = (label, value, sub) =>
    `<td width="20%" style="width:20%;padding:0 4px;vertical-align:top;">${box(
      `<div style="font-size:11px;color:#6b7280;white-space:nowrap;">${label}</div><div style="font-size:24px;font-weight:900;color:#1b1d21;line-height:1.2;margin-top:2px;white-space:nowrap;">${value}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;white-space:nowrap;">${sub}</div>`,
      "padding:10px 12px;",
    )}</td>`;
  const groupBadge = (g) =>
    `<span style="display:inline-block;font-size:10px;font-weight:700;color:#ffffff;background:${GROUP_COLOR[g] || "#6b7280"};border-radius:4px;padding:0 5px;line-height:16px;white-space:nowrap;">${(GROUPS[g] || "기타").replace(" 채널", "")}</span>`;
  const clip = (s, n) => {
    s = String(s || "");
    return s.length > n ? `${s.slice(0, n - 1)}..` : s;
  };

  // 머리: 왼쪽 남색 제목, 오른쪽 배너 그림
  const head = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
  <td bgcolor="#002c5f" style="background:#002c5f;background-color:#002c5f;color:#ffffff;padding:16px 18px;vertical-align:middle;">
    <div style="font-size:11px;color:#c3cfdd;letter-spacing:0.3px;">YOUTUBE MONITORING · ${period}</div>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px;"><tr>
      ${logo ? `<td style="padding:0 12px 0 0;vertical-align:middle;"><img src="${logo}" width="70" height="54" alt="" style="display:block;width:70px;height:54px;border:0;"></td>` : ""}
      <td style="vertical-align:middle;color:#ffffff;font-size:21px;font-weight:900;line-height:1.3;">'현대차 위기론' 관련<br>부정적 프레임 유튜브 콘텐츠 모니터링</td>
    </tr></table>
    <div style="font-size:11px;color:#c3cfdd;margin-top:6px;">기준 ${fmtDT(stamp)} · 대상: 관리 채널 + 주요 경제 채널 + 유튜브 전체 검색${channelCount ? ` (지정 채널 ${channelCount}곳)` : ""}</div>
  </td>
  ${banner ? `<td width="340" bgcolor="#002c5f" style="width:340px;background:#002c5f;background-color:#002c5f;padding:0;vertical-align:middle;"><img src="${banner}" width="340" height="155" alt="" style="display:block;width:340px;height:155px;border:0;"></td>` : ""}
  </tr></table>`;

  const d7 = st.last7 - st.prev7;
  const avg = st.days.length ? st.total / st.days.length : 0;
  const kpis = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0 0;"><tr>
  ${kpi("부정 프레임 콘텐츠", `${num(st.total)}<span style="font-size:13px;font-weight:700;">건</span>`, `일 평균 ${avg.toFixed(1)}건`)}
  ${kpi("최근 7일 발행", `${num(st.last7)}<span style="font-size:13px;font-weight:700;">건</span>`, `직전 7일 ${num(st.prev7)}건 ${diffPill(d7)}`)}
  ${kpi(`${md(st.end)}(${WD[st.end.getDay()]}) 발행`, `${num(st.lastDay)}<span style="font-size:13px;font-weight:700;">건</span>`, `전일 ${num(st.prevDay)}건 ${diffPill(st.lastDay - st.prevDay)}`)}
  ${kpi("누적 조회수", `${num(st.views)}<span style="font-size:13px;font-weight:700;">회</span>`, `댓글 ${num(st.comments)}개 · 좋아요 ${num(st.likes)}개`)}
  ${kpi("관련 채널", `${num(st.channels.length)}<span style="font-size:13px;font-weight:700;">곳</span>`, `콘텐츠 관리 ${st.groups.managed} · 경제 ${st.groups.econ} · 기타 ${st.groups.other}`)}
  </tr></table>`;

  const legend = `<span style="display:inline-block;width:14px;height:0;border-top:2px solid ${C_LINE};vertical-align:middle;"></span> <span style="font-size:11px;color:#1b1d21;">일자별 발행 수</span>&nbsp;&nbsp;&nbsp;<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ${C_MA};vertical-align:middle;"></span> <span style="font-size:11px;color:#1b1d21;">7일 평균</span>`;
  const chart = `<div style="margin:12px 4px 0;">${box(
    `<table width="100%" cellpadding="0" cellspacing="0"><tr><td>${h3("일자별 발행 추이", `${period} · 단위: 건`)}</td><td align="right" style="text-align:right;">${legend}</td></tr></table>` +
      `<div class="chart-wrap" style="position:relative;">${dailyChartSvg(st.days, fluid ? 1100 : 912, 230, chartInteractive)}</div>`,
  )}</div>`;

  // 주간 추이 (표)
  const weeks = st.weeks.slice(-12);
  const weekTable = `<div style="margin:12px 4px 0;">${box(
    h3("주간 발행 수", "월~일 기준 · 전주 대비") +
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;"><tr>${weeks
        .map(
          (w, i) =>
            `<td style="text-align:center;padding:4px 2px;border-left:${i ? "1px solid #eceef2" : "0"};"><div style="font-size:9.5px;color:#6b7280;white-space:nowrap;letter-spacing:-0.3px;">${md(w.from)}~${md(w.to)}</div><div style="font-size:17px;font-weight:900;color:#1b1d21;">${w.count}</div><div style="font-size:10px;">${i ? diffPill(w.diff) : "&nbsp;"}</div></td>`,
        )
        .join("")}</tr></table>`,
  )}</div>`;

  // 채널별 TOP 20 · 조회수 TOP 5 — 두 상자의 높이가 같게 행 높이를 고정 (TOP 20: 14px × 20 = TOP 5: 56px × 5 = 280px)
  const ROW_S = 14;
  const ROW_L = 56;
  const chTop = st.channels.slice(0, 20);
  const maxC = Math.max(1, ...chTop.map((c) => c.count));
  const smallBadge = (g) =>
    `<span style="display:inline-block;font-size:9px;font-weight:700;color:#ffffff;background:${GROUP_COLOR[g] || "#6b7280"};border-radius:3px;padding:0 4px;line-height:12px;white-space:nowrap;">${(GROUPS[g] || "기타").replace(" 채널", "")}</span>`;
  const tdS = (extra = "") => `<td height="${ROW_S}" style="height:${ROW_S}px;line-height:${ROW_S}px;padding:0 4px;white-space:nowrap;${extra}">`;
  const chTable = box(
    h3("채널별 발행 TOP 20", "건수순 · 조회수 합") +
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px;">` +
      chTop
        .map(
          (c, i) =>
            `<tr>${tdS("padding-left:0;color:#6b7280;width:16px;")}${i + 1}</td>${tdS("width:30px;")}${smallBadge(c.group)}</td>${tdS("color:#1b1d21;")}${escH(clip(c.name, 16))}</td>` +
            `${tdS("width:84px;")}<div style="height:6px;line-height:6px;font-size:1px;width:${Math.max(4, Math.round((c.count / maxC) * 80))}px;background:${GROUP_COLOR[c.group] || "#6b7280"};border-radius:0 3px 3px 0;">&nbsp;</div></td>` +
            `${tdS("text-align:right;font-weight:800;")}${num(c.count)}건</td>${tdS("padding-right:0;text-align:right;color:#6b7280;width:44px;")}${shortNum(c.views)}</td></tr>`,
        )
        .join("") +
      (chTop.length ? "" : `<tr><td style="color:#6b7280;padding:6px 0;">아직 없습니다</td></tr>`) +
      "</table>",
  );

  const topTable = box(
    h3("조회수 TOP 5 콘텐츠", "조회수순") +
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;table-layout:fixed;">` +
      st.top
        .map(
          (v) =>
            `<tr><td width="88" height="${ROW_L}" style="width:88px;height:${ROW_L}px;padding:0 8px 0 0;vertical-align:middle;"><a href="https://www.youtube.com/watch?v=${v.id}"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" width="80" height="45" alt="" style="display:block;width:80px;height:45px;border:0;border-radius:4px;"></a></td>` +
            `<td height="${ROW_L}" style="height:${ROW_L}px;padding:0;vertical-align:middle;overflow:hidden;">` +
            `<div style="white-space:nowrap;overflow:hidden;line-height:16px;"><a href="https://www.youtube.com/watch?v=${v.id}" style="color:#1b1d21;text-decoration:none;font-weight:700;">${escH(clip(v.title, 34))}</a></div>` +
            `<div style="font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;line-height:15px;">${escH(clip(v.channelName, 14))} · ${md(new Date(v.published))} · 조회 ${num(v.views)} · 댓글 ${num(v.comments)}</div>` +
            `<div style="font-size:11px;color:#3c4043;white-space:nowrap;overflow:hidden;line-height:15px;">${escH(clip(v.summary || "", 40))}</div>` +
            `</td></tr>`,
        )
        .join("") +
      (st.top.length ? "" : `<tr><td style="color:#6b7280;padding:6px 0;">아직 없습니다</td></tr>`) +
      "</table>",
  );

  // 프레임 유형 · 부정 키워드
  const chips = (arr, color) =>
    arr
      .slice(0, 12)
      .map(
        ([k, n]) =>
          `<span style="display:inline-block;border:1px solid #d9dde3;border-radius:999px;padding:1px 8px;margin:0 4px 5px 0;font-size:11px;color:#1b1d21;white-space:nowrap;">${escH(k)} <b style="color:${color};">${n}</b></span>`,
      )
      .join("");
  const frameBox = box(
    (st.frames.length ? h3("위기론 프레임 유형", "건수") + `<div>${chips(st.frames, "#d93025")}</div>` : "") +
      h3("자주 쓰인 부정 표현", "제목·설명 · 건수") +
      `<div>${chips(st.words, "#d93025") || '<span style="font-size:12px;color:#6b7280;">아직 없습니다</span>'}</div>`,
  );

  const recent = box(
    h3("최근 발행 콘텐츠") +
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">` +
      st.recent
        .map(
          (v) =>
            `<tr><td style="padding:3px 6px 3px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${md(new Date(v.published))}</td><td style="padding:3px 6px 3px 0;white-space:nowrap;vertical-align:top;">${groupBadge(v.group)}</td>` +
            `<td style="padding:3px 0;vertical-align:top;"><a href="https://www.youtube.com/watch?v=${v.id}" style="color:#1b1d21;text-decoration:none;">${escH(clip(v.title, 40))}</a> <span style="color:#6b7280;font-size:11px;">${escH(clip(v.channelName, 12))}</span></td></tr>`,
        )
        .join("") +
      "</table>",
  );

  const two = (a, b) =>
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0 0;"><tr><td width="50%" style="width:50%;padding:0 4px;vertical-align:top;">${a}</td><td width="50%" style="width:50%;padding:0 4px;vertical-align:top;">${b}</td></tr></table>`;

  return `<div style="${fluid ? "" : `width:${W}px;`}font-family:${DASH_FONT};color:#1b1d21;background:#f6f7f9;border:1px solid #d9dde3;border-radius:12px;overflow:hidden;">
${head}
<div style="padding:4px 10px 14px;">
${kpis}
${chart}
${weekTable}
${two(chTable, topTable)}
${two(frameBox, recent)}
<div style="font-size:10px;color:#8a8f98;margin:10px 6px 0;">※ 발행 수는 '현대차 위기론' 부정 프레임으로 분류된 콘텐츠 기준(제목·설명 내용 검토). 조회수·댓글 수는 기준 시각 값.</div>
</div></div>`;
}

// 서식 없이 붙여 넣을 때의 글
function dashText(st) {
  const lines = [
    `■ '현대차 위기론' 관련 부정적 프레임 유튜브 콘텐츠 모니터링 (${ymd(st.start)} ~ ${ymd(st.end)})`,
    `- 부정 프레임 콘텐츠 ${st.total}건 (일 평균 ${(st.total / Math.max(1, st.days.length)).toFixed(1)}건)`,
    `- 최근 7일 ${st.last7}건 (직전 7일 ${st.prev7}건, ${st.last7 - st.prev7 >= 0 ? "▲" : "▼"}${Math.abs(st.last7 - st.prev7)})`,
    `- 누적 조회수 ${num(st.views)} · 댓글 ${num(st.comments)}개 · 관련 채널 ${st.channels.length}곳`,
    `- 주간: ${st.weeks.slice(-6).map((w) => `${md(w.from)}~ ${w.count}건`).join(" / ")}`,
    `- 채널 TOP: ${st.channels.slice(0, 5).map((c) => `${c.name} ${c.count}건`).join(", ")}`,
    `- 조회수 TOP: ${st.top.slice(0, 3).map((v) => `${v.title} (${v.channelName}, ${shortNum(v.views)})`).join(" / ")}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 엑셀
// ---------------------------------------------------------------------------
const THUMB_W = 96; // 엑셀 안 썸네일 크기(픽셀) — 작게
const THUMB_H = 54;

// 썸네일을 작은 JPEG 로 (엑셀 용량을 줄이려고 2배 해상도 192×108 로 저장)
async function thumbBytes(id) {
  const cached = await DB.get(id, "thumbs").catch(() => null);
  if (cached?.bytes) return cached.bytes;
  for (const name of ["mqdefault.jpg", "hqdefault.jpg", "default.jpg"]) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}`, { credentials: "omit" });
      if (!res.ok) continue;
      const bmp = await createImageBitmap(await res.blob());
      const cw = THUMB_W * 2;
      const ch = THUMB_H * 2;
      const cv = new OffscreenCanvas(cw, ch);
      const ctx = cv.getContext("2d");
      // 16:9 로 가운데를 잘라 맞춤 (4:3 썸네일의 검은 띠 제거)
      const r = Math.max(cw / bmp.width, ch / bmp.height);
      let sw = cw / r;
      let sh = ch / r;
      if (name === "hqdefault.jpg" || name === "default.jpg") sh = Math.min(sh, bmp.height * 0.75);
      ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, cw, ch);
      const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.82 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await DB.put({ id, bytes }, "thumbs").catch(() => {});
      return bytes;
    } catch {}
  }
  return null;
}

async function buildExcel(st, { stamp = new Date(), onProgress } = {}) {
  const list = st.list;
  const period = `${ymd(st.start)} ~ ${ymd(st.end)}`;
  // 1) 모니터링 리스트
  // 요청서 순서: 발행일 / 썸네일 / 제목 / URL / 조회수 / 댓글 수 … + 내용 요약
  const cols1 = [5.5, 15.5, 15, 17, 8.5, 46, 44, 12, 9, 9, 46, 7.5, 15, 20];
  const head1 = ["No.", "발행일", "썸네일", "채널명", "구분", "제목", "URL", "조회수", "좋아요", "댓글 수", "내용 요약", "논조", "프레임 유형", "부정 표현"];
  const rows1 = [
    { h: 28, cells: [{ v: "'현대차 위기론' 관련 부정적 프레임의 유튜브 콘텐츠 모니터링", s: "title" }] },
    { h: 18, cells: [{ v: `기간 ${period} · 총 ${list.length}건 · 조회수·댓글 수 기준 ${fmtDT(stamp)} · 대상: 관리 채널 + 주요 경제 채널 + 유튜브 전체 검색`, s: "sub" }] },
    { h: 30, cells: head1.map((v) => ({ v, s: "head" })) },
  ];
  const images = [];
  const links = [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const r = rows1.length;
    const tone = v.ai?.tone || v.frame || "";
    rows1.push({
      h: 46,
      cells: [
        { v: i + 1, s: "textC" },
        { v: new Date(v.published), s: v.hasTime ? "datetime" : "date" },
        { v: "", s: "thumb" },
        { v: v.channelName, s: "wrap" },
        { v: (GROUPS[v.group] || "기타").replace(" 채널", ""), s: "textC" },
        { v: v.title, s: "wrap" },
        { v: `https://www.youtube.com/watch?v=${v.id}`, s: "link" },
        { v: v.views ?? "", s: "num" },
        { v: v.likes ?? "", s: "num" },
        { v: v.comments ?? "", s: "num" },
        { v: v.summary || "", s: "small" },
        { v: tone, s: tone === "부정" ? "neg" : "gray" },
        { v: v.ai?.frame || "", s: "small" },
        { v: (v.negHits || []).join(", "), s: "small" },
      ],
    });
    links.push({ r, c: 6, url: `https://www.youtube.com/watch?v=${v.id}` });
    const bytes = await thumbBytes(v.id);
    if (bytes) images.push({ r, c: 2, bytes, type: "jpeg", w: THUMB_W, h: THUMB_H, dx: 7, dy: 4, descr: v.title });
    onProgress?.(i + 1, list.length);
  }
  if (list.length)
    rows1.push({
      h: 22,
      cells: [
        { v: "합계", s: "totalL" }, { v: `${list.length}건`, s: "totalL" }, { v: "", s: "totalL" }, { v: `${st.channels.length}개 채널`, s: "totalL" },
        { v: "", s: "totalL" }, { v: "", s: "totalL" }, { v: "", s: "totalL" },
        { v: st.views, s: "totalN" }, { v: st.likes, s: "totalN" }, { v: st.comments, s: "totalN" }, { v: "", s: "totalL" }, { v: "", s: "totalL" }, { v: "", s: "totalL" }, { v: "", s: "totalL" },
      ],
    });

  // 2) 일자별 발행 추이 (+ 꺾은선 차트)
  const head2 = ["No.", "날짜", "요일", "발행 수", "7일 평균", "누적", "관리 채널", "경제 채널", "기타 채널", "조회수 합", "댓글 수 합"];
  const kpiRow = [
    ["총 콘텐츠", st.total], ["최근 7일", st.last7], ["직전 7일", st.prev7], ["7일 증감", st.last7 - st.prev7], ["누적 조회수", st.views], ["누적 댓글", st.comments],
  ];
  const rows2 = [
    { h: 28, cells: [{ v: "일자별 부정 프레임 콘텐츠 발행 추이", s: "title" }] },
    { h: 18, cells: [{ v: `기간 ${period} · 발행일(유튜브 게시 시각) 기준`, s: "sub" }] },
    { h: 30, cells: kpiRow.map(([k]) => ({ v: k, s: "kpiLabel" })) },
    { h: 26, cells: kpiRow.map(([k, v]) => ({ v, s: k === "7일 증감" ? "diff" : "kpi" })) },
    { h: 8, cells: [] },
    { h: 24, cells: head2.map((v) => ({ v, s: "head" })) },
  ];
  const d0 = rows2.length;
  st.days.forEach((d, di) =>
    rows2.push({
      cells: [
        { v: di + 1, s: "textC" }, { v: d.date, s: "date" }, { v: WD[d.date.getDay()], s: "textC" }, { v: d.count, s: d.count ? "numB" : "num" }, { v: d.ma7 == null ? "" : Math.round(d.ma7 * 10) / 10, s: "num" }, { v: d.cum, s: "num" },
        { v: d.managed, s: "num" }, { v: d.econ, s: "num" }, { v: d.other, s: "num" }, { v: d.views, s: "num" }, { v: d.comments, s: "num" },
      ],
    }),
  );
  const d1 = rows2.length - 1;
  rows2.push({
    h: 22,
    cells: [
      { v: "합계", s: "totalL" }, { v: "", s: "totalL" }, { v: "", s: "totalL" }, { v: st.total, s: "totalN" }, { v: "", s: "totalL" }, { v: st.total, s: "totalN" },
      { v: st.groups.managed, s: "totalN" }, { v: st.groups.econ, s: "totalN" }, { v: st.groups.other, s: "totalN" }, { v: st.views, s: "totalN" }, { v: st.comments, s: "totalN" },
    ],
  });
  const chart = {
    from: { r: 2, c: 12 },
    to: { r: 26, c: 26 },
    title: "일자별 발행 수 (건)",
    fmt: "m/d",
    skip: 7,
    cat: { r1: d0, r2: d1, c: 1, values: st.days.map((d) => XlsxPro.serial(d.date)) },
    series: [
      { name: "일자별 발행 수", r1: d0, r2: d1, c: 3, color: C_LINE, marker: true, width: 2, values: st.days.map((d) => d.count) },
      { name: "7일 평균", r1: d0, r2: d1, c: 4, color: C_MA, dash: true, width: 2, values: st.days.map((d) => (d.ma7 == null ? null : Math.round(d.ma7 * 10) / 10)) },
    ],
  };
  const chart2 = {
    from: { r: 28, c: 12 },
    to: { r: 50, c: 26 },
    title: "누적 콘텐츠 수 (건)",
    fmt: "m/d",
    skip: 7,
    cat: chart.cat,
    series: [{ name: "누적", r1: d0, r2: d1, c: 5, color: "#d93025", width: 2, values: st.days.map((d) => d.cum) }],
  };

  // 3) 주간 추이
  const rows3 = [
    { h: 28, cells: [{ v: "주간 발행 추이 (월~일)", s: "title" }] },
    { h: 18, cells: [{ v: `기간 ${period}`, s: "sub" }] },
    { h: 24, cells: ["No.", "시작", "끝", "발행 수", "전주 대비", "조회수 합", "댓글 수 합"].map((v) => ({ v, s: "head" })) },
    ...st.weeks.map((w, i) => ({
      cells: [
        { v: i + 1, s: "textC" }, { v: w.from, s: "date" }, { v: w.to, s: "date" }, { v: w.count, s: "numB" },
        { v: w.diff ?? "", s: "diff" }, { v: w.views, s: "num" }, { v: w.comments, s: "num" },
      ],
    })),
  ];

  // 4) 채널별 현황
  const rows4 = [
    { h: 28, cells: [{ v: "채널별 현황", s: "title" }] },
    { h: 18, cells: [{ v: `기간 ${period} · 건수순`, s: "sub" }] },
    { h: 24, cells: ["No.", "채널명", "구분", "콘텐츠 수", "조회수 합", "댓글 수 합", "평균 조회수", "첫 발행", "최근 발행", "채널 URL"].map((v) => ({ v, s: "head" })) },
  ];
  const links4 = [];
  st.channels.forEach((c, i) => {
    const url = c.url || (c.id ? `https://www.youtube.com/channel/${c.id}` : "");
    rows4.push({
      cells: [
        { v: i + 1, s: "textC" }, { v: c.name, s: "bold" }, { v: (GROUPS[c.group] || "기타").replace(" 채널", ""), s: "textC" }, { v: c.count, s: "numB" },
        { v: c.views, s: "num" }, { v: c.comments, s: "num" }, { v: c.count ? Math.round(c.views / c.count) : 0, s: "num" },
        { v: new Date(c.first), s: "date" }, { v: new Date(c.last), s: "date" }, { v: url, s: "link" },
      ],
    });
    if (url) links4.push({ r: rows4.length - 1, c: 9, url });
  });

  const last1 = rows1.length;
  return XlsxPro.build({
    sheets: [
      {
        name: "모니터링 리스트",
        tab: "#d93025",
        cols: cols1,
        rows: rows1,
        merges: ["A1:N1", "A2:N2"],
        freeze: { row: 3, col: 0 },
        filter: list.length ? `A3:N${3 + list.length}` : null,
        links,
        images,
        zoom: 90,
      },
      {
        name: "일자별 발행 추이",
        tab: "#2a78d6",
        cols: [6, 12, 6, 10, 10, 13, 13, 10, 10, 13, 12, 2],
        rows: rows2,
        merges: ["A1:K1", "A2:K2"],
        freeze: { row: d0, col: 0 },
        charts: [chart, chart2],
      },
      { name: "주간 추이", tab: "#eb6834", cols: [8, 12, 12, 10, 11, 13, 12], rows: rows3, merges: ["A1:G1", "A2:G2"], freeze: { row: 3, col: 0 } },
      { name: "채널별 현황", tab: "#1baf7a", cols: [5.5, 28, 8.5, 10, 13, 12, 12, 12, 12, 42], rows: rows4, merges: ["A1:J1", "A2:J2"], freeze: { row: 3, col: 0 }, links: links4 },
    ],
  }).then((bytes) => (void last1, bytes));
}
