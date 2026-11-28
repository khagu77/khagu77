// 게시물 목록: 카테고리별 · 기간/채널/성향/키워드/검색 필터 · 체크 → 엑셀 · AI 재분석 · 성향 지정 · 메모
import { h, esc, CH, CH_ORDER, SENT, SENT_ORDER, chIcon, sentBadge, srcPill, sourceName, isShorts, fmtTime, ago, toast, busy, segmented, highlight, cafeSearchUrl, fmtNum, toDate, modal } from "../ui.js";
import { exportExcel } from "../excel.js";

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
const PERIODS = [["today", "오늘"], ["24h", "24시간"], ["3d", "3일"], ["7d", "7일"], ["30d", "30일"], ["custom", "직접"]];

function rangeOf(p, from, to) {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "today") return [sod, null];
  if (p === "24h") return [new Date(now - 86400e3), null];
  if (p === "3d") return [new Date(sod - 2 * 86400e3), null];
  if (p === "7d") return [new Date(sod - 6 * 86400e3), null];
  if (p === "30d") return [new Date(sod - 29 * 86400e3), null];
  // 직접: 날짜·시·분까지 (끝 시각의 그 1분까지 포함)
  return [from ? new Date(from) : new Date(sod - 6 * 86400e3), to ? new Date(new Date(to).getTime() + 60e3) : null];
}

export async function render(root, store, { arg, qs }) {
  const catId = arg || "all";
  const cats = store.settings.categories || [];
  const cat = cats.find((c) => c.id === catId) || cats[0] || { id: "all", name: "전체", channels: ["*"] };
  const chList = cat.channels?.includes("*") ? CH_ORDER : CH_ORDER.filter((c) => cat.channels.includes(c));
  const groups = (store.settings.keywordGroups || []).filter((g) => g.role === "issue");
  const hasYt = (cat.channels || []).includes("youtube") || (cat.channels || []).includes("*");
  const st = {
    period: PERIODS.some(([v]) => v === qs.get("period")) ? qs.get("period") : qs.get("q") ? "30d" : "3d", from: "", to: "", sort: "time", q: qs.get("q") || "", alertedOnly: false,
    issueOnly: qs.get("issue") === "1",
    src: qs.get("src") || "",
    // 숏츠 보기: all 전체 · no 숏츠 제외 · only 숏츠만 (예전 '숏츠 제외' 켬 값도 이어받음)
    shorts: (() => { try { const v = localStorage.getItem("hdmon-shorts"); return v || (localStorage.getItem("hdmon-noshorts") === "1" ? "no" : "all"); } catch { return "all"; } })(),
    ch: new Set(), sent: new Set((qs.get("sent") || "").split(",").filter((s) => SENT[s])), grp: "", dedupe: catId === "news" || catId === "all", star: false, showHidden: false,
  };
  let all = [];
  let cursor = null;
  let done = false;
  let loading = false;
  let view = [];
  let shown = 0;
  const sel = new Set();
  let newestMs = 0;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(cat.name)}${st.src ? ` <span class="grad">· ${esc(st.src)}</span>` : ""}${st.sent.size ? ` <span class="grad">· ${[...st.sent].map((s) => SENT[s].name).join("·")}</span>` : ""}</h1><p>${cat.filter === "garbage" ? "현대차 관련 글 중 설정된 이슈 키워드에 걸리지 않은 글" : cat.filter === "issue" ? "품질·안전 등 이슈 키워드가 걸린 게시물" + (cat.fav ? " · 관심 목록만" : "") : "수집된 현대차 관련 게시물 전체 (가비지 포함)"}</p></div>
      <div class="actions"><button class="btn" id="xlsAll">📥 보이는 목록 엑셀</button></div>
    </div>
    <div class="card filters">
      <div class="frow"><span class="lbl">기간</span>
        <div class="seg" id="period">${PERIODS.map(([v, l]) => `<button data-v="${v}" class="${st.period === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <span id="custom" style="display:none;gap:6px;align-items:center;flex-wrap:wrap"><input type="datetime-local" class="input" id="from" step="60"> ~ <input type="datetime-local" class="input" id="to" step="60"><button class="btn sm" id="applyRange">조회</button></span>
        <div class="seg" id="sort" style="margin-left:auto"><button data-v="time" class="on">작성일 기준</button><button data-v="collectedAt">수집일 기준</button></div>
      </div>
      ${chList.length > 1 ? `<div class="frow"><span class="lbl">채널</span><div class="chips" id="chs">${chList.map((c) => `<button class="chip" data-v="${c}">${chIcon(c, true)} ${CH[c].name}</button>`).join("")}</div></div>` : ""}
      <div class="frow"><span class="lbl">성향</span><div class="chips" id="sents"><button class="chip ${st.sent.size ? "" : "on"}" data-all>전체</button>${SENT_ORDER.map((s) => `<button class="chip ${st.sent.has(s) ? "on" : ""}" data-v="${s}">${SENT[s].name}</button>`).join("")}</div>
        <select class="input" id="grp" style="margin-left:8px"><option value="">키워드 그룹 전체</option>${groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select>
      </div>
      <div class="frow"><span class="lbl">검색</span>
        <div class="qsteps" id="qsteps"></div>
        <div class="qhelp">💡 <b>검색 방법</b>
          <span><kbd>,</kbd> 쉼표 = 하나라도 <em>블루핸즈, 하이테크센터, 파란손</em></span>
          <span><kbd>␣</kbd> 띄어쓰기 = 모두 포함 <em>블루핸즈 불친절</em></span>
          <span><kbd>-</kbd> 빼기 = 제외 <em>-광고</em></span>
          <span><kbd>＋</kbd> 결과 내 검색 = 2차·3차로 좁히기</span></div>
        <label class="toggle-row"><span class="switch"><input type="checkbox" id="dedupe" ${st.dedupe ? "checked" : ""}><span></span></span>유사 기사 묶기</label>
        ${st.src ? `<button class="chip on" id="srcChip" title="눌러서 매체 조건 지우기">${esc(st.src)} ✕</button>` : ""}
        ${hasYt ? `<div class="seg" id="shortsSeg">${[["all", "전체"], ["no", "숏츠 제외"], ["only", "숏츠만"]].map(([v, l]) => `<button data-v="${v}" class="${st.shorts === v ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
        <label class="toggle-row"><span class="switch"><input type="checkbox" id="issueOnly" ${st.issueOnly ? "checked" : ""}><span></span></span>이슈 글만</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" id="alertedOnly"><span></span></span>💬 카톡 발송만</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" id="star"><span></span></span>중요만</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" id="showHidden"><span></span></span>숨긴 글</label>
      </div>
    </div>
    <div id="banner"></div>
    <div class="card" style="padding:0;overflow:hidden">
      <div class="list-head"><input type="checkbox" class="cbx" id="selAll" title="보이는 글 모두 선택"><span class="count" id="count">불러오는 중…</span><span class="hint" id="loaded" style="margin-left:auto"></span></div>
      <div class="posts" id="list"></div>
      <div class="loadmore" id="more"></div>
    </div>
    <div class="bulkbar" id="bulk"><span class="n" id="bn">0개 선택</span>
      <button class="btn sm primary" data-a="xls">📥 엑셀</button>
      ${store.isEditor() ? `<button class="btn sm kakao" data-a="kakao">💬 카톡 발송</button>` : ""}
      ${store.isEditor() ? `<button class="btn sm" data-a="ai">🤖 AI 성향 재분석</button>
      <select class="input" data-a="sent" style="height:30px"><option value="">성향 지정…</option>${SENT_ORDER.map((s) => `<option value="${s}">${SENT[s].name}</option>`).join("")}</select>
      <button class="btn sm" data-a="star">⭐ 중요</button><button class="btn sm" data-a="hide">🙈 숨김/해제</button>` : ""}
      <button class="btn sm ghost" data-a="clear">선택 해제</button></div>`;
  const $q = (s) => root.querySelector(s);
  const bulk = $q("#bulk");
  document.body.append(bulk); // 화면 아래 고정

  const localStr = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  segmented($q("#period"), (v) => {
    st.period = v;
    $q("#custom").style.display = v === "custom" ? "inline-flex" : "none";
    if (v === "custom") {
      // 처음 열면 '오늘 0시 ~ 지금' 으로 채워 둠
      if (!$q("#from").value) { const n = new Date(); $q("#from").value = localStr(new Date(n.getFullYear(), n.getMonth(), n.getDate())); $q("#to").value = localStr(n); }
      st.from = $q("#from").value; st.to = $q("#to").value;
    }
    reload();
  });
  segmented($q("#sort"), (v) => { st.sort = v; reload(); });
  $q("#applyRange").onclick = () => {
    st.from = $q("#from").value; st.to = $q("#to").value;
    if (st.from && st.to && st.from > st.to) return toast("시작 시각이 끝 시각보다 늦습니다", "err");
    reload();
  };
  const chipSet = (box, set) => box?.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v); b.classList.toggle("on"); apply(); });
  chipSet($q("#chs"), st.ch);
  // 성향: '전체' 를 누르면 모두 해제, 하나라도 고르면 '전체' 꺼짐
  $q("#sents").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    if (b.hasAttribute("data-all")) st.sent.clear();
    else st.sent.has(b.dataset.v) ? st.sent.delete(b.dataset.v) : st.sent.add(b.dataset.v);
    $q("#sents").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.hasAttribute("data-all") ? !st.sent.size : st.sent.has(c.dataset.v)));
    apply();
  });
  $q("#grp").onchange = (e) => { st.grp = e.target.value; apply(); };
  let qt;
  // 3단계 검색: 1차 검색 → 그 결과 안에서 2차 → 다시 그 안에서 3차
  st.qs = [st.q || ""];
  const Q_PH = ["제목·내용·매체명 (쉼표, = 하나라도 · 띄어쓰기 = 모두 포함 · -단어 = 제외)", "1차 결과 안에서 다시 검색", "2차 결과 안에서 다시 검색"];
  function drawQ() {
    $q("#qsteps").innerHTML = st.qs.map((v, i) => `${i ? `<span class="qarrow">›</span>` : ""}<div class="qstep" data-lv="${i}"><span class="qlv">${i + 1}차</span><input class="input" data-q="${i}" placeholder="${Q_PH[i]}" value="${esc(v)}">${i ? `<button type="button" class="qx" data-qx="${i}" title="이 단계 지우기">✕</button>` : ""}<span class="qcnt" data-qc="${i}"></span></div>`).join("")
      + (st.qs.length < 3 ? `<button type="button" class="btn sm" id="qAdd" ${st.qs[st.qs.length - 1].trim() ? "" : "disabled"} title="지금 결과 안에서 한 번 더 검색">＋ 결과 내 검색</button>` : "");
  }
  drawQ();
  $q("#qsteps").addEventListener("input", (e) => {
    const lv = e.target.dataset.q;
    if (lv == null) return;
    st.qs[+lv] = e.target.value;
    const add = $q("#qAdd");
    if (add) add.disabled = !st.qs[st.qs.length - 1].trim();
    clearTimeout(qt); qt = setTimeout(() => { apply(); ensureEnough(); }, 220);
  });
  $q("#qsteps").addEventListener("click", (e) => {
    if (e.target.closest("#qAdd")) { st.qs.push(""); drawQ(); $q(`[data-q="${st.qs.length - 1}"]`).focus(); apply(); return; }
    const x = e.target.closest("[data-qx]");
    if (x) { st.qs.splice(+x.dataset.qx); drawQ(); apply(); ensureEnough(); }
  });
  if ($q("#shortsSeg")) segmented($q("#shortsSeg"), (v) => { st.shorts = v; try { localStorage.setItem("hdmon-shorts", v); } catch {} apply(); });
  $q("#srcChip")?.addEventListener("click", () => { location.hash = `#/posts/${cat.id}`; });
  for (const k of ["dedupe", "star", "showHidden", "alertedOnly", "issueOnly"]) $q(`#${k}`).onchange = (e) => { st[k] = e.target.checked; apply(); };

  let totalCount = null;
  async function reload() {
    totalCount = null;
    const [cf, ct] = rangeOf(st.period, st.from, st.to);
    store.be.countPosts?.({ cat: cat.id, from: cf, to: ct, sort: st.sort }).then((n) => { totalCount = n; apply(); }).catch(() => {});
    all = []; cursor = null; done = false; sel.clear(); newestMs = 0;
    $q("#banner").innerHTML = "";
    $q("#list").innerHTML = Array.from({ length: 8 }, () => `<div class="post"><span></span><div class="skeleton" style="width:30px;height:30px"></div><div><div class="skeleton" style="height:14px;width:70%"></div><div class="skeleton" style="height:10px;width:40%;margin-top:8px"></div></div><div class="skeleton" style="height:12px"></div><div class="skeleton" style="height:12px"></div></div>`).join("");
    await fetchMore();
    ensureEnough();
  }
  async function fetchMore() {
    if (loading || done) return;
    loading = true;
    $q("#more").innerHTML = `<span class="hint">불러오는 중…</span>`;
    try {
      const [from, to] = rangeOf(st.period, st.from, st.to);
      const r = await store.be.listPosts({ cat: cat.id, from, to, sort: st.sort, pageSize: 300, cursor });
      all.push(...r.items);
      cursor = r.cursor; done = r.done;
      if (!newestMs && all[0]) newestMs = toDate(all[0].time)?.getTime() || 0;
    } catch (e) {
      toast(e.message, "err", 6000);
      done = true;
    } finally {
      loading = false;
    }
    apply();
  }
  // 검색·필터로 보이는 글이 적으면 기간 안의 글을 더 불러옴 (최대 3,000건)
  async function ensureEnough() {
    while (!done && view.length < 60 && all.length < 3000) await fetchMore();
  }

  // 검색어: 쉼표(,)로 나누면 '하나라도 포함'(OR) · 띄어쓰기는 '모두 포함'(AND) · -단어 는 제외
  // 예) 블루핸즈, 하이테크센터, 파란손, 멍든손  →  넷 중 하나라도 들어간 글
  //     블루핸즈 불친절, 파란손 -광고          →  (블루핸즈 그리고 불친절) 또는 파란손, 광고 들어간 글은 뺌
  function parseQ(q) {
    const groups = [], exc = [];
    for (const part of String(q).split(/[,，]/)) {
      const g = [];
      for (const w of part.trim().split(/\s+/).filter(Boolean)) {
        if (w.startsWith("-") && w.length > 1) exc.push(norm(w.slice(1)));
        else g.push(norm(w));
      }
      if (g.length) groups.push(g);
    }
    return { groups, exc, inc: groups.flat() };
  }
  const hit = (p, { groups, exc }) => {
    const t = norm(`${p.title} ${p.desc} ${p.source}`);
    return (!groups.length || groups.some((g) => g.every((w) => t.includes(w)))) && !exc.some((w) => t.includes(w));
  };
  function apply() {
    view = all.filter((p) => {
      if (!st.showHidden && p.hidden) return false;
      if (st.star && !p.star) return false;
      if (st.issueOnly && !(p.isIssue || p.must)) return false;
      if (st.shorts === "no" && isShorts(p)) return false;
      if (st.shorts === "only" && !isShorts(p)) return false;
      if (st.src && (sourceName(p) || p.source) !== st.src && p.source !== st.src) return false;
      if (st.alertedOnly && !p.alerted) return false;
      if (st.dedupe && p.dupOf) return false;
      if (st.ch.size && !st.ch.has(p.channel)) return false;
      if (st.sent.size && !st.sent.has(p.sentiment)) return false;
      if (st.grp && !(p.kwGroups || []).includes(st.grp)) return false;
      return true;
    });
    // 검색 단계마다 앞 단계 결과 안에서 다시 거름 · 단계별 남은 건수 표시
    st.qs.forEach((q, i) => {
      const pq = parseQ(q);
      if (pq.groups.length || pq.exc.length) view = view.filter((p) => hit(p, pq));
      const c = $q(`[data-qc="${i}"]`);
      if (c) c.textContent = q.trim() ? `${fmtNum(view.length)}건` : "";
    });
    shown = 0;
    $q("#list").innerHTML = "";
    renderMore();
    // 왼쪽: 기간 안 전체 건수(서버 집계) · 조건으로 거른 경우 그 건수 / 오른쪽: 불러온 글 수
    const total = totalCount ?? (done ? all.length : null);
    const filtered = view.length !== all.length;
    $q("#count").innerHTML = `<b>${total != null ? fmtNum(total) : `${fmtNum(all.length)}+`}</b>건${filtered ? ` <span class="hint">· 조건에 맞는 글 ${fmtNum(view.length)}건${done ? "" : " (불러온 글 중)"}</span>` : ""}`;
    $q("#loaded").textContent = `불러온 글 ${fmtNum(all.length)}건${done ? "" : " · 아래로 내리면 더 불러옴"}`;
    updateBulk();
  }

  function words(p) {
    const inc = st.qs.flatMap((q) => parseQ(q).inc);
    return [...(p.kw || []).flatMap((k) => k.split("*")), ...inc];
  }
  function rowHtml(p, i) {
    const cafeJoined = p.channel === "cafe" && (store.settings.favCafes || []).some((c) => c.id.toLowerCase() === String(p.sourceId).toLowerCase() && c.joined);
    const badges = [
      p.alerted ? `<span class="badge b-kakao" title="${esc(`카톡 발송 ${fmtTime(p.alertedAt)} · ${(p.alertedTo || []).join(", ")}`)}">💬 카톡 발송</span>` : "",
      sentBadge(p.sentiment, p.sentimentBy),
      isShorts(p) ? `<span class="badge b-shorts">숏츠</span>` : "",
      p.must ? `<span class="badge b-info">필수 수집</span>` : "",
      p.fav ? `<span class="badge b-info">⭐ 관심</span>` : "",
      p.dupCount ? `<span class="badge b-warn">유사 ${p.dupCount}건</span>` : "",
      p.channel === "cafe" && !cafeJoined ? `<a class="badge b-search" href="${esc(cafeSearchUrl(p.title))}" target="_blank" rel="noopener" title="가입하지 않은 카페 글은 네이버 검색으로 열어 보세요">🔍 검색</a>` : "",
      ...(p.kw || []).slice(0, 4).map((k) => `<span class="badge b-kw">#${esc(k)}</span>`),
      p.star ? `<span class="badge b-warn">⭐ 중요</span>` : "",
      p.memo ? `<span class="badge b-kw">📝 메모</span>` : "",
    ].join("");
    const w = words(p);
    const tm = p.postedAt || p.postedDay ? fmtTime(p.postedAt || p.time) : fmtTime(p.time);
    return `<div class="post ${sel.has(p.id) ? "sel" : ""} ${p.hidden ? "hid" : ""} ${p.alerted ? "alerted" : ""}" data-id="${esc(p.id)}" style="--i:${i}">
      <input type="checkbox" class="cbx" ${sel.has(p.id) ? "checked" : ""}>
      ${chIcon(p.channel, false, p)}
      <div style="min-width:0">${p.thumb ? `<img class="thumb" loading="lazy" src="${esc(p.thumb)}" alt="">` : ""}${srcPill(p)}<a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${highlight(p.title, w)}</a>
        ${p.desc ? `<div class="desc">${highlight(p.desc, w)}</div>` : ""}<div class="meta">${badges}</div></div>
      <div class="src">${esc(sourceName(p) || CH[p.channel]?.name || "")}<small>${esc(CH[p.channel]?.name || "")}</small></div>
      <div class="tm">${esc(tm)}<small>${ago(p.collectedAt)} 수집</small></div>
      <div class="more"></div>
    </div>`;
  }
  function renderMore() {
    const next = view.slice(shown, shown + 80);
    if (!next.length && !shown) {
      $q("#list").innerHTML = `<div class="empty"><div class="big">🔭</div>${loading ? "불러오는 중…" : "조건에 맞는 게시물이 없습니다"}</div>`;
    } else {
      $q("#list").insertAdjacentHTML("beforeend", next.map((p, i) => rowHtml(p, i)).join(""));
    }
    shown += next.length;
    $q("#more").innerHTML = shown < view.length || !done ? `<button class="btn" id="moreBtn">더 보기 ↓</button>` : `<span class="hint">끝 · ${fmtNum(view.length)}건</span>`;
    $q("#moreBtn")?.addEventListener("click", more);
  }
  async function more() {
    if (shown < view.length) return renderMore();
    await fetchMore();
  }
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: "400px" });
  io.observe($q("#more"));

  const byId = (id) => all.find((p) => p.id === id);
  function refreshRow(id) {
    const p = byId(id);
    const el = $q(`.post[data-id="${CSS.escape(id)}"]`);
    if (!p || !el) return;
    const open = el.classList.contains("open");
    const n = h(rowHtml(p, 0));
    n.style.animation = "none";
    el.replaceWith(n);
    if (open) toggleMore(n);
  }

  function toggleMore(el) {
    const p = byId(el.dataset.id);
    const box = el.querySelector(".more");
    if (el.classList.toggle("open")) {
      box.innerHTML = `
        <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:8px">
          ${p.sentimentReason ? `<div class="hint">🤖 ${esc(p.sentimentReason)}</div>` : ""}
          <div class="hint">검색어: ${esc(p.query || "-")} · 키워드 그룹: ${esc((p.kwGroups || []).join(", ") || "-")} · 작성 ${esc(fmtTime(p.postedAt, true) || p.postedDay || "-")} · 수집 ${esc(fmtTime(p.collectedAt, true))}</div>
          ${store.isEditor() ? `<input class="input" data-memo placeholder="메모 (Enter 로 저장)" value="${esc(p.memo || "")}">` : p.memo ? `<div>📝 ${esc(p.memo)}</div>` : ""}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${store.isEditor() ? `<select class="input" data-sent style="height:30px">${SENT_ORDER.map((s) => `<option value="${s}" ${p.sentiment === s ? "selected" : ""}>${SENT[s].name}</option>`).join("")}</select>
          <button class="btn sm" data-ai>🤖 AI 재분석</button><button class="btn sm" data-star>${p.star ? "중요 해제" : "⭐ 중요"}</button><button class="btn sm" data-hide>${p.hidden ? "숨김 해제" : "🙈 숨김"}</button>` : ""}
          <a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">원문 ↗</a>
        </div>`;
    } else box.innerHTML = "";
  }

  // 성향 지정: 서버가 게시물 · 통계 · 실시간 피드를 함께 바꿈
  async function setSent(ids, sentiment) {
    const r = await store.be.setSentiment(ids, sentiment);
    for (const id of ids) Object.assign(byId(id) || {}, { sentiment, sentimentBy: "manual", sentimentReason: r?.reason || `${store.me.name || "담당자"} 지정` });
  }
  async function patch(ids, data) {
    for (const id of ids) {
      await store.be.updatePost(id, data);
      Object.assign(byId(id) || {}, data);
    }
  }
  async function runAi(ids) {
    toast(`${ids.length}건 AI 분석 중… (Gemini → 한도 초과 시 Claude)`, "info");
    const r = await store.be.analyze(ids);
    for (const x of r.results) Object.assign(byId(x.id) || {}, { sentiment: x.sentiment, sentimentBy: x.by, sentimentReason: x.reason });
    toast(`AI 분석 완료 ${r.results.length}건 (${[...new Set(r.results.map((x) => x.by))].join(", ")})`);
    return r;
  }

  $q("#list").addEventListener("click", async (e) => {
    const row = e.target.closest(".post");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.matches(".cbx")) {
      e.target.checked ? sel.add(id) : sel.delete(id);
      row.classList.toggle("sel", e.target.checked);
      return updateBulk();
    }
    if (e.target.closest("a, input, select")) return;
    const b = e.target.closest("button");
    if (b) {
      const p = byId(id);
      try {
        if (b.matches("[data-ai]")) await busy(b, () => runAi([id]));
        if (b.matches("[data-star]")) await patch([id], { star: !p.star });
        if (b.matches("[data-hide]")) await patch([id], { hidden: !p.hidden });
        refreshRow(id);
      } catch (err) { toast(err.message, "err", 6000); }
      return;
    }
    toggleMore(row);
  });
  $q("#list").addEventListener("change", async (e) => {
    const row = e.target.closest(".post");
    if (row && e.target.matches("[data-sent]")) {
      await setSent([row.dataset.id], e.target.value);
      toast("성향을 바꿨습니다");
      refreshRow(row.dataset.id);
    }
  });
  $q("#list").addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.matches("[data-memo]")) {
      const id = e.target.closest(".post").dataset.id;
      await patch([id], { memo: e.target.value.slice(0, 500) });
      toast("메모를 저장했습니다");
      refreshRow(id);
    }
  });

  $q("#selAll").onchange = (e) => {
    view.slice(0, shown).forEach((p) => (e.target.checked ? sel.add(p.id) : sel.delete(p.id)));
    root.querySelectorAll(".post").forEach((r) => { r.classList.toggle("sel", sel.has(r.dataset.id)); r.querySelector(".cbx").checked = sel.has(r.dataset.id); });
    updateBulk();
  };
  function updateBulk() {
    bulk.classList.toggle("on", sel.size > 0);
    bulk.querySelector("#bn").textContent = `${sel.size}개 선택`;
    $q("#selAll").checked = shown > 0 && view.slice(0, shown).every((p) => sel.has(p.id));
  }
  const selected = () => all.filter((p) => sel.has(p.id));
  bulk.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const ids = [...sel];
    try {
      if (b.dataset.a === "xls") return exportExcel(selected(), cat.name, store);
      if (b.dataset.a === "clear") { sel.clear(); apply(); return; }
      if (b.dataset.a === "kakao") {
        if (ids.length > 20) return toast("카톡 발송은 한 번에 20건까지 고를 수 있습니다", "err");
        const body = await modal(`카톡 발송 · ${ids.length}건`, `<div style="display:flex;flex-direction:column;gap:10px">
          <label class="toggle-row"><input type="radio" name="kto" value="me" checked> 나에게만 보내기</label>
          <label class="toggle-row"><input type="radio" name="kto" value="all"> 알림 받는 모든 담당자에게 보내기 (카톡 연결 + 알림 켠 사람)</label>
          <p class="hint" style="margin:0">고른 글마다 한 통씩 보냅니다. 받은 글에는 '💬 카톡 발송' 표시가 붙습니다.</p></div>`, { ok: "보내기" });
        if (!body) return;
        const to = body.querySelector("input[name=kto]:checked").value;
        await busy(b, async () => {
          const r = await store.be.kakaoShare(ids, to);
          for (const p of selected()) Object.assign(p, { alerted: true, alertedAt: new Date(), alertedTo: [...new Set([...(p.alertedTo || []), ...r.people])] });
          toast(`카톡 ${r.sent}통 보냈습니다 (${r.people.join(", ")})${r.fails.length ? ` · 실패 ${r.fails.length}명` : ""}`, r.fails.length ? "err" : "ok", 6000);
        });
      }
      if (b.dataset.a === "ai") {
        if (ids.length > 100) return toast("AI 분석은 한 번에 100건까지 고를 수 있습니다", "err");
        await busy(b, () => runAi(ids));
      }
      if (b.dataset.a === "star") await busy(b, () => patch(ids, { star: !selected().every((p) => p.star) }));
      if (b.dataset.a === "hide") await busy(b, () => patch(ids, { hidden: !selected().every((p) => p.hidden) }));
      apply();
    } catch (err) { toast(err.message, "err", 6000); }
  });
  bulk.querySelector("select[data-a]")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await setSent([...sel], e.target.value);
    toast(`${sel.size}건 성향을 '${SENT[e.target.value].name}'(으)로 바꿨습니다`);
    e.target.value = "";
    apply();
  });
  $q("#xlsAll").onclick = () => {
    if (!view.length) return toast("내려받을 글이 없습니다", "err");
    exportExcel(view, cat.name, store);
  };

  // 새 글 알림 띠
  const matchCat = (it) => (cat.channels.includes("*") || cat.channels.includes(it.channel)) && (cat.filter !== "issue" || it.isIssue) && (cat.filter !== "garbage" || !it.isIssue);
  const onEv = (ev) => {
    if (ev.type !== "live" || st.period === "custom") return;
    const n = (ev.live.items || []).filter((it) => matchCat(it) && (toDate(it.time)?.getTime() || 0) > newestMs).length;
    if (!n) return;
    $q("#banner").innerHTML = `<div class="new-banner">↑ 새 게시물 ${n}건 · 눌러서 보기</div>`;
    $q("#banner .new-banner").onclick = () => reload();
  };
  store.listeners.add(onEv);

  await reload();
  return { cleanup() { store.listeners.delete(onEv); io.disconnect(); bulk.remove(); } };
}
