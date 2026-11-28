// 대시보드: KPI 카운트업 · 채널별 추이 · 성향 도넛 · 부정 비율 · 시간대 히트맵 · 키워드 순위 · 실시간 피드
import { h, esc, countUp, dayKey, fmtNum, CH, CH_ORDER, SENT, SENT_ORDER, chIcon, sentBadge, ago, segmented, toast, busy, fmtTime } from "../ui.js";
import { stackedBars, lineChart, donut, sparkline, heat } from "../charts.js";

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
const add = (into, o) => { for (const [k, v] of Object.entries(o || {})) into[k] = (into[k] || 0) + v; return into; };
const days = (n, end = new Date()) => Array.from({ length: n }, (_, i) => dayKey(new Date(end.getTime() - (n - 1 - i) * 86400e3)));

export async function render(root, store) {
  let period = 7;
  root.innerHTML = `
    <div class="page-head">
      <div><h1>모니터링 <span class="grad">대시보드</span></h1><p id="sub">현대차·제네시스 온라인 이슈 현황</p></div>
      <div class="actions">
        <div class="seg" id="period"><button data-v="1">오늘</button><button data-v="7" class="on">7일</button><button data-v="30">30일</button></div>
        ${store.isAdmin() ? `<button class="btn" id="runNow">⚡ 지금 수집</button>` : ""}
      </div>
    </div>
    <div class="kpis stagger" id="kpis"></div>
    <div class="dash-grid stagger" id="grid">
      <div class="card span-8" style="--i:1"><h3>📈 채널별 이슈 게시물 <span class="sub" id="trendSub"></span></h3><div id="trend" style="min-height:260px"></div><div class="legend" id="trendLegend"></div></div>
      <div class="card span-4" style="--i:2;grid-row:span 2"><h3><span class="dot"></span> 실시간 수집 피드 <span class="sub">새 글이 들어오면 바로 표시</span></h3><div class="feed" id="feed"></div></div>
      <div class="card span-4" style="--i:3"><h3>🎭 성향 분포 <span class="sub">이슈 게시물</span></h3><div class="donut-wrap"><div id="donut"></div><div class="dlegend" id="dlegend"></div></div></div>
      <div class="card span-4" style="--i:4"><h3>🔑 많이 걸린 키워드</h3><div class="rank" id="kw"></div></div>
      <div class="card span-6" style="--i:5"><h3>📉 부정·단순비난 비율 <span class="sub">이슈 게시물 중</span></h3><div id="negline"></div></div>
      <div class="card span-6" style="--i:6"><h3>🕒 시간대별 수집량 <span class="sub" id="heatSub"></span></h3><div id="heat" style="padding-top:8px"></div><div class="legend" id="garbage" style="margin-top:18px"></div></div>
      <div class="card span-4" style="--i:7"><h3>📡 채널별 이슈</h3><div class="rank" id="chs"></div></div>
      <div class="card span-4" style="--i:8"><h3>☕ 관심 동호회 TOP</h3><div class="rank" id="favCafe"></div></div>
      <div class="card span-4" style="--i:9"><h3>▶️ 관심 유튜브 TOP</h3><div class="rank" id="favYt"></div></div>
      <div class="card span-12" style="--i:10"><h3>🛰 수집 상태 <span class="sub" id="runSub"></span></h3><div class="status-log" id="runlog"></div></div>
    </div>`;
  $q("#kpis").innerHTML = Array.from({ length: 6 }, () => `<div class="card kpi"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:30px;width:50%;margin-top:10px"></div></div>`).join("");
  function $q(s) { return root.querySelector(s); }

  let data = null;
  const hiddenSeries = new Set();

  async function load(first = true) {
    const n = Math.max(period, 7);
    const cur = days(n);
    const prevEnd = new Date(Date.now() - period * 86400e3);
    const prev = days(period, prevEnd);
    const all = await store.be.getStats(prev[0], cur[cur.length - 1]);
    const by = Object.fromEntries(all.map((s) => [s.day, s]));
    data = { by, cur, prev, inPeriod: cur.slice(-period) };
    draw(first);
  }

  function agg(list) {
    const a = { total: 0, issue: 0, garbage: 0, ch: {}, chIssue: {}, sent: {}, sentIssue: {}, hour: {}, kw: {}, cat: {}, favCafe: {}, favYt: {} };
    for (const k of list) {
      const s = data.by[k];
      if (!s) continue;
      a.total += s.total || 0; a.issue += s.issue || 0; a.garbage += s.garbage || 0;
      for (const f of ["ch", "chIssue", "sent", "sentIssue", "hour", "kw", "cat", "favCafe", "favYt"]) add(a[f], s[f]);
    }
    return a;
  }

  function draw(first = false) {
    if (!data) return;
    const A = agg(data.inPeriod);
    const P = agg(data.prev);
    const series = (f) => data.cur.map((k) => f(data.by[k] || {}));
    const neg = (s) => (s.sentIssue?.neg || 0) + (s.sentIssue?.abuse || 0);
    const kpis = [
      { label: "전체 수집", icon: "🗂", v: A.total, p: P.total, sp: series((s) => s.total || 0), color: "--s1", href: "#/posts/all" },
      { label: "이슈 게시물", icon: "🚨", v: A.issue, p: P.issue, sp: series((s) => s.issue || 0), color: "--s2", href: "#/posts/news" },
      { label: "부정·단순비난", icon: "😠", v: neg(A), p: neg(P), sp: series(neg), color: "--s8", suffix: A.issue ? `<small>${Math.round((neg(A) / A.issue) * 100)}%</small>` : "" },
      { label: "가비지", icon: "🗑", v: A.garbage, p: P.garbage, sp: series((s) => s.garbage || 0), color: "--s7", href: "#/posts/garbage", good: true },
      { label: "관심 동호회 이슈", icon: "⭐", v: A.cat.cafe_fav || 0, p: P.cat.cafe_fav || 0, sp: series((s) => s.cat?.cafe_fav || 0), color: "--s6", href: "#/posts/cafe_fav" },
      { label: "관심 유튜브", icon: "▶️", v: A.cat.youtube_fav || 0, p: P.cat.youtube_fav || 0, sp: series((s) => s.cat?.youtube_fav || 0), color: "--s5", href: "#/posts/youtube_fav" },
    ];
    const kEl = $q("#kpis");
    if (first || kEl.children.length !== kpis.length || kEl.querySelector(".skeleton")) {
      kEl.innerHTML = kpis.map((k, i) => `<a class="card kpi hover" style="--i:${i};--accent:var(${k.color})" href="${k.href || "#/dashboard"}">
        <div class="k-label">${k.icon} ${esc(k.label)}</div><div class="k-val"><span data-k="${i}">0</span>${k.suffix || ""}</div>
        <div class="k-delta" data-d="${i}"></div>${sparkline(k.sp.slice(-Math.max(period, 7)), k.color)}</a>`).join("");
    }
    kpis.forEach((k, i) => {
      countUp(kEl.querySelector(`[data-k="${i}"]`), k.v);
      const d = kEl.querySelector(`[data-d="${i}"]`);
      const diff = k.v - k.p;
      const pct = k.p ? Math.round((diff / k.p) * 100) : null;
      d.className = `k-delta ${diff > 0 ? "up" : diff < 0 ? "down" : "flat"}${k.good ? " good" : ""}`;
      d.innerHTML = `${diff > 0 ? "▲" : diff < 0 ? "▼" : "–"} ${fmtNum(Math.abs(diff))}${pct !== null ? ` (${Math.abs(pct)}%)` : ""}<small>${period === 1 ? "어제" : `이전 ${period}일`} 대비</small>`;
    });

    // 추이
    if (period === 1) {
      const hrs = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
      const today = data.by[dayKey()] || {};
      stackedBars($q("#trend"), { labels: hrs.map((x) => `${+x}시`), series: [{ key: "all", name: "수집", color: "--s1", values: hrs.map((x) => today.hour?.[x] || 0) }] });
      $q("#trendSub").textContent = "오늘 시간대별 (전체 수집)";
      $q("#trendLegend").innerHTML = "";
    } else {
      const labels = data.inPeriod.map((k) => k.slice(5).replace("-", "/"));
      const ser = CH_ORDER.filter((c) => A.chIssue[c] || A.ch[c]).map((c) => ({ key: c, name: CH[c].name, color: CH[c].color, values: data.inPeriod.map((k) => data.by[k]?.chIssue?.[c] || 0) }));
      stackedBars($q("#trend"), { labels, series: ser, hidden: hiddenSeries });
      $q("#trendSub").textContent = `최근 ${period}일 · 막대에 마우스를 올려 보세요`;
      $q("#trendLegend").innerHTML = ser.map((s) => `<span data-s="${s.key}" class="${hiddenSeries.has(s.key) ? "off" : ""}"><i style="background:var(${s.color})"></i>${esc(s.name)} ${fmtNum(A.chIssue[s.key] || 0)}</span>`).join("");
      $q("#trendLegend").querySelectorAll("[data-s]").forEach((sp) => sp.onclick = () => { hiddenSeries.has(sp.dataset.s) ? hiddenSeries.delete(sp.dataset.s) : hiddenSeries.add(sp.dataset.s); draw(); });
    }

    // 도넛
    const parts = SENT_ORDER.map((k) => ({ name: SENT[k].name, value: A.sentIssue[k] || 0, color: SENT[k].color }));
    const tot = parts.reduce((a, p) => a + p.value, 0);
    donut($q("#donut"), { parts, center: fmtNum(tot), sub: "이슈 게시물" });
    $q("#dlegend").innerHTML = parts.map((p, i) => `<div><div class="r"><span class="badge ${SENT[SENT_ORDER[i]].cls}">${p.name}</span><b>${fmtNum(p.value)}</b><span class="hint">${tot ? Math.round((p.value / tot) * 100) : 0}%</span></div>
      <div class="bar-bg"><div style="width:${tot ? (p.value / tot) * 100 : 0}%;background:var(${p.color});animation-delay:${i * 120}ms"></div></div></div>`).join("");

    // 키워드
    const kws = Object.entries(A.kw).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const kmax = kws[0]?.[1] || 1;
    $q("#kw").innerHTML = kws.length ? kws.map(([k, v], i) => `<a class="r" href="#/posts/all?q=${encodeURIComponent(k.replace(/\*/g, " "))}"><span class="n">${i + 1}</span><span class="name">${esc(k)}</span><b>${fmtNum(v)}</b><span class="track"><div style="width:${(v / kmax) * 100}%;animation-delay:${i * 70}ms"></div></span></a>`).join("") : `<div class="hint">아직 데이터가 없습니다</div>`;

    // 부정 비율
    const labels = data.inPeriod.map((k) => k.slice(5).replace("-", "/"));
    const ratio = data.inPeriod.map((k) => { const s = data.by[k] || {}; return s.issue ? (neg(s) / s.issue) * 100 : 0; });
    lineChart($q("#negline"), { labels: period === 1 ? data.cur.slice(-7).map((k) => k.slice(5).replace("-", "/")) : labels, series: [{ name: "부정·비난 비율", color: "--neg", values: period === 1 ? data.cur.slice(-7).map((k) => { const s = data.by[k] || {}; return s.issue ? (neg(s) / s.issue) * 100 : 0; }) : ratio }], unit: "%", max: 100 });

    // 히트맵
    heat($q("#heat"), Array.from({ length: 24 }, (_, i) => A.hour[String(i).padStart(2, "0")] || 0));
    $q("#heatSub").textContent = period === 1 ? "오늘" : `최근 ${period}일 합계`;
    $q("#garbage").innerHTML = `<span>전체 <b>${fmtNum(A.total)}</b></span><span>− 가비지 <b>${fmtNum(A.garbage)}</b></span><span>= 이슈 <b style="color:var(--brand)">${fmtNum(A.total - A.garbage)}</b></span><span class="hint">가비지 비율 ${A.total ? Math.round((A.garbage / A.total) * 100) : 0}%</span>`;

    // 채널·관심
    const rank = (el, entries, nameOf, hrefOf, icon) => {
      const max = entries[0]?.[1] || 1;
      el.innerHTML = entries.length ? entries.map(([k, v], i) => `<a class="r" href="${hrefOf(k)}"><span class="n">${icon ? icon(k) : i + 1}</span><span class="name">${esc(nameOf(k))}</span><b>${fmtNum(v)}</b><span class="track"><div style="width:${(v / max) * 100}%;animation-delay:${i * 70}ms"></div></span></a>`).join("") : `<div class="hint">아직 데이터가 없습니다</div>`;
    };
    const catOf = { news: "news", cafe: "cafe", blog: "blog", post: "blog", youtube: "youtube", bobae: "community", clien: "community", ppomppu: "community" };
    rank($q("#chs"), Object.entries(A.chIssue).sort((a, b) => b[1] - a[1]), (k) => CH[k]?.name || k, (k) => `#/posts/${catOf[k] || "all"}`, (k) => chIcon(k, true));
    const cafeName = Object.fromEntries((store.settings.favCafes || []).map((c) => [c.id.toLowerCase(), c.name]));
    const ytName = Object.fromEntries((store.settings.favYoutube || []).map((c) => [c.id, c.name]));
    rank($q("#favCafe"), Object.entries(A.favCafe).sort((a, b) => b[1] - a[1]).slice(0, 7), (k) => cafeName[k.toLowerCase()] || k, () => "#/posts/cafe_fav");
    rank($q("#favYt"), Object.entries(A.favYt).sort((a, b) => b[1] - a[1]).slice(0, 7), (k) => ytName[k] || k, () => "#/posts/youtube_fav");
    drawStatus();
  }

  function drawStatus() {
    const r = store.status?.lastRun;
    $q("#runSub").textContent = r ? `마지막 수집 ${fmtTime(r.at)} (${ago(r.at)}) · ${Math.round((r.ms || 0) / 1000)}초 · 받은 글 ${fmtNum(r.fetched)} · 새 글 ${fmtNum(r.created)} · 검색어 ${fmtNum(store.status.queries || 0)}개` : "아직 수집 기록이 없습니다";
    $q("#runlog").innerHTML = (r?.log || []).map((l) => `<div>› ${esc(l)}</div>`).join("") || `<div class="hint">설정 → API 키를 넣으면 5분마다 자동으로 수집합니다.</div>`;
  }

  // 실시간 피드
  const shown = new Set();
  function drawFeed(animateNew) {
    const items = store.live?.items || [];
    $q("#feed").innerHTML = items.length ? items.slice(0, 30).map((p) => `<a class="feed-item ${animateNew && !shown.has(p.id) ? "new" : ""}" href="${esc(p.url)}" target="_blank" rel="noopener">
      ${chIcon(p.channel)}<div style="min-width:0"><div class="t">${esc(p.title)}</div><div class="m">${sentBadge(p.sentiment)}${p.isIssue ? `<span class="badge b-warn">이슈</span>` : ""}<span>${esc(p.source || "")}</span><span>· ${ago(p.time)}</span></div></div></a>`).join("")
      : `<div class="empty"><div class="big">📡</div>수집을 기다리는 중…</div>`;
    items.forEach((p) => shown.add(p.id));
  }
  drawFeed(false);

  segmented($q("#period"), (v) => { period = +v; load(); });
  $q("#runNow")?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    try { const r = await store.be.runNow(); toast(`수집 완료 · 새 글 ${r.created}건`); load(); } catch (err) { toast(err.message, "err", 6000); }
  }));

  const onEv = (ev) => {
    if (ev.type === "live") { drawFeed(true); load(false); }
    if (ev.type === "status") drawStatus();
    if (ev.type === "theme") draw();
  };
  store.listeners.add(onEv);
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => draw(), 200); };
  window.addEventListener("resize", onResize);
  const tick = setInterval(() => drawFeed(false), 60000);
  await load();
  return { cleanup() { store.listeners.delete(onEv); window.removeEventListener("resize", onResize); clearInterval(tick); } };
}
