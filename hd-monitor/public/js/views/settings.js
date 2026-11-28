// 설정 (관리자): 키워드 그룹 · 카테고리 · 관심 동호회/유튜브 · 커뮤니티 게시판 · 성향 사전 · 수집/알림 · API 키 · 수집 현황
import { h, esc, toast, busy, tabsIndicator, confirmBox, CH, CH_ORDER, SENT, sentBadge, fmtTime, fmtNum } from "../ui.js";
import { parseRules, compileGroups, collectQueries } from "../shared/keywords.js";
import { buildContext, classify } from "../shared/classify.js";

const TABS = [
  ["keywords", "🔑 키워드"], ["categories", "🗂 카테고리"], ["cafes", "☕ 관심 동호회"], ["youtube", "▶️ 관심 유튜브"],
  ["boards", "🚗 커뮤니티 게시판"], ["lexicon", "🎭 성향 사전"], ["collect", "⚙️ 수집·알림·AI"], ["keys", "🔐 API 키"], ["status", "🛰 수집 현황"],
];
const ROLES = { target: "현대차 관련 기본어", issue: "이슈 키워드", other: "참고(분류 안 함)", exclude: "제외어" };
const uid = () => Math.random().toString(36).slice(2, 8);

export async function render(root, store, { arg }) {
  let tab = TABS.some((t) => t[0] === arg) ? arg : "keywords";
  let draft = structuredClone(store.settings);
  const dirty = new Set();

  root.innerHTML = `
    <div class="page-head"><div><h1>설정</h1><p>바꾼 내용은 다음 수집(5분 이내)부터 적용됩니다. 키워드·카테고리를 바꾼 뒤에는 '최근 글 다시 분류'로 지난 글에도 적용할 수 있어요.</p></div></div>
    <div class="tabs" id="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="pane"></div>
    <div class="savebar" id="savebar"><span class="hint" id="dirtyTxt"></span><button class="btn" id="discard">되돌리기</button><button class="btn primary" id="save">💾 저장</button></div>`;
  const $q = (s) => root.querySelector(s);
  const tabs = $q("#tabs");
  requestAnimationFrame(() => tabsIndicator(tabs));
  tabs.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    tab = b.dataset.t;
    tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    tabsIndicator(tabs);
    history.replaceState(null, "", `#/settings/${tab}`);
    draw();
  };
  const mark = (key) => {
    dirty.add(key);
    $q("#savebar").classList.add("on");
    $q("#dirtyTxt").textContent = `저장하지 않은 변경: ${[...dirty].map((k) => ({ keywordGroups: "키워드", categories: "카테고리", favCafes: "관심 동호회", favYoutube: "관심 유튜브", boards: "게시판", lexicon: "성향 사전", collect: "수집", alert: "알림", ai: "AI", instagram: "인스타그램" }[k] || k)).join(", ")}`;
  };
  $q("#discard").onclick = () => { draft = structuredClone(store.settings); dirty.clear(); $q("#savebar").classList.remove("on"); draw(); };
  $q("#save").onclick = (e) => busy(e.currentTarget, async () => {
    const patch = {};
    for (const k of dirty) patch[k] = draft[k];
    try {
      await store.be.saveSettings(patch);
      Object.assign(store.settings, patch);
      const needRe = dirty.has("keywordGroups") || dirty.has("categories") || dirty.has("favCafes") || dirty.has("favYoutube");
      dirty.clear();
      $q("#savebar").classList.remove("on");
      toast("저장했습니다");
      if (needRe && (await confirmBox("최근 3일 글을 바뀐 키워드·카테고리로 다시 분류할까요? (통계도 다시 계산)", "다시 분류"))) {
        const r = await store.be.reclassify(3);
        toast(`다시 분류: ${fmtNum(r.scanned)}건 확인, ${fmtNum(r.changed)}건 바뀜`);
      }
    } catch (err) { toast(err.message, "err", 6000); }
  });

  function draw() {
    const pane = $q("#pane");
    pane.innerHTML = "";
    const v = h(`<div class="view"></div>`);
    pane.append(v);
    ({ keywords, categories, cafes, youtube, boards, lexicon, collect, keys, status })[tab](v);
  }

  // ── 키워드 ──
  function keywords(v) {
    const ctxOf = () => buildContext(draft);
    v.innerHTML = `
      <div class="card" style="margin-bottom:14px"><h3>🧪 키워드 시험해 보기 <span class="sub">제목을 넣으면 어떻게 분류되는지 바로 보여 줍니다 (저장 전 설정 기준)</span></h3>
        <div class="tester"><div class="frow"><select class="input" id="tch">${CH_ORDER.map((c) => `<option value="${c}">${CH[c].name}</option>`).join("")}</select>
        <input class="input" id="tt" style="flex:1" placeholder="예) 팰리세이드 2열 전동시트 끼임 사고 무섭네요" value="현대차 아이오닉5 ICCU 결함 무상수리 확대"></div><div class="res" id="tres"></div></div></div>
      <div class="hint" style="margin-bottom:10px">문법: <b>+</b> 또는 <b>,</b> 또는 줄바꿈 = 또는 · <b>*</b> = 그리고 (예: <code>팰리세이드*끼임</code>) · 띄어쓰기·대소문자는 무시하고 비교 · <span id="qcount"></span></div>
      <div class="form-grid" id="groups" style="grid-template-columns:repeat(auto-fill,minmax(420px,1fr))"></div>
      <div style="margin-top:14px"><button class="btn" id="addG">＋ 키워드 그룹 추가</button> <button class="btn ghost" id="resetG">기본값으로</button></div>`;
    const test = () => {
      const t = v.querySelector("#tt").value;
      const c = classify({ channel: v.querySelector("#tch").value, title: t, desc: "", sourceId: "" }, ctxOf());
      const names = Object.fromEntries((draft.categories || []).map((x) => [x.id, x.name]));
      v.querySelector("#tres").innerHTML = !c ? `<span class="badge b-abuse">제외어에 걸려 저장 안 함</span>`
        : `${sentBadge(c.sentiment)} ${c.isIssue ? `<span class="badge b-warn">이슈</span>` : `<span class="badge b-neu">가비지</span>`} ${c.alert ? `<span class="badge b-info">🔔 카톡 알림</span>` : ""}
          ${c.targets.map((k) => `<span class="badge b-kw">현대차: ${esc(k)}</span>`).join("")} ${c.kw.map((k) => `<span class="badge b-kw">#${esc(k)}</span>`).join("")}
          <span class="hint">→ 카테고리: ${c.cats.map((x) => esc(names[x] || x)).join(", ")}</span>`;
      v.querySelector("#qcount").textContent = `수집 검색어 ${collectQueries(compileGroups(draft)).length}개`;
    };
    v.querySelector("#tt").oninput = test;
    v.querySelector("#tch").onchange = test;
    const box = v.querySelector("#groups");
    const drawGroups = () => {
      box.innerHTML = draft.keywordGroups.map((g, i) => `
        <div class="card group-card" data-i="${i}" style="animation:rise .5s ${i * 40}ms var(--ease) both">
          <div class="gh"><input class="input" data-f="name" value="${esc(g.name)}">
            <select class="input" data-f="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${g.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button class="btn sm ghost danger" data-del title="그룹 삭제">✕</button></div>
          <div class="flags">
            <label class="toggle-row" title="이 그룹의 단어로 네이버 검색을 해서 글을 모읍니다"><span class="switch"><input type="checkbox" data-f="collect" ${g.collect ? "checked" : ""}><span></span></span>수집 검색어</label>
            ${g.role === "issue" ? `<label class="toggle-row"><span class="switch"><input type="checkbox" data-f="alert" ${g.alert ? "checked" : ""}><span></span></span>카톡 알림</label>
            <label class="toggle-row" title="현대차 관련 기본어가 함께 있을 때만 걸림"><span class="switch"><input type="checkbox" data-f="requireTarget" ${g.requireTarget ? "checked" : ""}><span></span></span>현대차 단어 필요</label>` : ""}
          </div>
          <textarea class="input" data-f="rules" rows="6">${esc(g.rules)}</textarea>
          <span class="kw-count">${parseRules(g.rules).length}개 규칙</span>
        </div>`).join("");
    };
    drawGroups();
    box.addEventListener("input", (e) => {
      const c = e.target.closest("[data-i]");
      const f = e.target.dataset.f;
      if (!c || !f) return;
      const g = draft.keywordGroups[+c.dataset.i];
      g[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (f === "role") { g.issue = g.role === "issue"; drawGroups(); }
      if (f === "rules") c.querySelector(".kw-count").textContent = `${parseRules(g.rules).length}개 규칙`;
      mark("keywordGroups");
      test();
    });
    box.addEventListener("click", async (e) => {
      if (!e.target.closest("[data-del]")) return;
      const i = +e.target.closest("[data-i]").dataset.i;
      if (!(await confirmBox(`'${draft.keywordGroups[i].name}' 그룹을 지울까요?`, "삭제", true))) return;
      draft.keywordGroups.splice(i, 1);
      mark("keywordGroups"); drawGroups(); test();
    });
    v.querySelector("#addG").onclick = () => { draft.keywordGroups.push({ id: `g${uid()}`, name: "새 키워드 그룹", role: "issue", collect: false, issue: true, alert: false, requireTarget: true, rules: "" }); mark("keywordGroups"); drawGroups(); };
    v.querySelector("#resetG").onclick = async () => { if (await confirmBox("키워드 그룹을 처음 기본값으로 되돌릴까요?")) { await store.be.resetSettings("keywordGroups"); toast("기본값으로 되돌렸습니다"); draft.keywordGroups = structuredClone((await store.be.getSettings()).keywordGroups); drawGroups(); test(); } };
    test();
  }

  // ── 카테고리 ──
  function categories(v) {
    const draw2 = () => {
      const cats = draft.categories;
      v.innerHTML = `<div class="card"><h3>카테고리 <span class="sub">사이드바 순서대로 · 하위 카테고리는 상위를 고르세요</span></h3>
        <div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>이름</th><th>상위</th><th>채널</th><th>조건</th><th>관심 목록만</th><th></th></tr></thead><tbody>
        ${cats.map((c, i) => `<tr data-i="${i}"><td style="white-space:nowrap"><button class="btn sm ghost" data-up>▲</button><button class="btn sm ghost" data-down>▼</button></td>
          <td><input class="input" data-f="name" value="${esc(c.name)}" ${c.id === "all" ? "" : ""}></td>
          <td><select class="input" data-f="parent"><option value="">(없음)</option>${cats.filter((x) => x.id !== c.id && !x.parent).map((x) => `<option value="${esc(x.id)}" ${c.parent === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></td>
          <td><div class="chips">${["*", ...CH_ORDER].map((ch) => `<button class="chip ${c.channels.includes(ch) ? "on" : ""}" data-ch="${ch}" style="height:26px;padding:0 9px">${ch === "*" ? "모두" : CH[ch].name}</button>`).join("")}</div></td>
          <td><select class="input" data-f="filter"><option value="all" ${c.filter === "all" ? "selected" : ""}>모든 글</option><option value="issue" ${c.filter === "issue" ? "selected" : ""}>이슈 글</option><option value="garbage" ${c.filter === "garbage" ? "selected" : ""}>가비지</option></select></td>
          <td><select class="input" data-f="fav"><option value="">아니오</option><option value="cafe" ${c.fav === "cafe" ? "selected" : ""}>관심 동호회</option><option value="youtube" ${c.fav === "youtube" ? "selected" : ""}>관심 유튜브</option></select></td>
          <td>${c.id === "all" ? "" : `<button class="btn sm ghost danger" data-del>✕</button>`}</td></tr>`).join("")}
        </tbody></table></div><div style="margin-top:12px"><button class="btn" id="addC">＋ 카테고리 추가</button> <button class="btn ghost" id="resetC">기본값으로</button></div></div>`;
      v.querySelector("#addC").onclick = () => { draft.categories.splice(draft.categories.length - 1, 0, { id: `c${uid()}`, name: "새 카테고리", parent: null, channels: ["*"], filter: "issue", fav: null }); mark("categories"); draw2(); };
      v.querySelector("#resetC").onclick = async () => { if (await confirmBox("카테고리를 기본값으로 되돌릴까요?")) { await store.be.resetSettings("categories"); draft.categories = structuredClone((await store.be.getSettings()).categories); draw2(); } };
    };
    draw2();
    v.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-i]");
      if (!tr || !e.target.dataset.f) return;
      const c = draft.categories[+tr.dataset.i];
      c[e.target.dataset.f] = e.target.value || null;
      if (e.target.dataset.f === "name") c.name = e.target.value;
      mark("categories");
    });
    v.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr[data-i]");
      if (!tr) return;
      const i = +tr.dataset.i;
      const cats = draft.categories;
      const chip = e.target.closest("[data-ch]");
      if (chip) {
        const ch = chip.dataset.ch;
        let s = new Set(cats[i].channels);
        if (ch === "*") s = new Set(["*"]);
        else { s.delete("*"); s.has(ch) ? s.delete(ch) : s.add(ch); if (!s.size) s.add("*"); }
        cats[i].channels = [...s];
      } else if (e.target.closest("[data-up]") && i > 0) [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
      else if (e.target.closest("[data-down]") && i < cats.length - 1) [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
      else if (e.target.closest("[data-del]")) { if (!(await confirmBox(`'${cats[i].name}' 카테고리를 지울까요?`, "삭제", true))) return; cats.splice(i, 1); }
      else return;
      mark("categories"); draw2();
    });
  }

  // ── 관심 동호회 / 유튜브 (표 + 붙여넣기) ──
  function listEditor(v, key, { title, idLabel, flag, flagLabel, flagHint, link }) {
    const drawL = () => {
      const list = draft[key];
      v.innerHTML = `<div class="dash-grid"><div class="card span-8"><h3>${title} <span class="sub">${list.length}곳</span></h3>
        <div style="overflow-x:auto;max-height:640px"><table class="tbl"><thead><tr><th>#</th><th>이름</th><th>${idLabel}</th><th title="${esc(flagHint)}">${flagLabel}</th><th></th></tr></thead><tbody>
        ${list.map((c, i) => `<tr data-i="${i}"><td class="hint">${i + 1}</td><td><input class="input" data-f="name" value="${esc(c.name)}"></td><td><input class="input" data-f="id" value="${esc(c.id)}"></td>
          <td><label class="switch"><input type="checkbox" data-f="${flag}" ${c[flag] ? "checked" : ""}><span></span></label></td>
          <td style="white-space:nowrap"><a class="btn sm ghost" href="${esc(link(c.id))}" target="_blank" rel="noopener">↗</a><button class="btn sm ghost danger" data-del>✕</button></td></tr>`).join("")}</tbody></table></div>
        <button class="btn" id="addL" style="margin-top:10px">＋ 추가</button></div>
        <div class="card span-4"><h3>📋 한꺼번에 넣기</h3><p class="hint">한 줄에 <b>이름:${idLabel}</b> 형식으로 붙여 넣으세요. 같은 ${idLabel}는 이름만 바뀝니다.</p>
        <textarea class="input" id="bulkTxt" rows="12" placeholder="LX3 클럽:gamewinds"></textarea><div class="frow" style="margin-top:8px"><button class="btn" id="bulkAdd">추가</button><button class="btn ghost" id="bulkReplace">목록 전체 바꾸기</button></div>
        <p class="hint" style="margin-top:12px">${flagHint}</p></div></div>`;
      v.querySelector("#addL").onclick = () => { draft[key].push({ name: "", id: "", [flag]: false }); mark(key); drawL(); };
      const parse = () => v.querySelector("#bulkTxt").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.lastIndexOf(":"); return i > 0 ? { name: l.slice(0, i).trim(), id: l.slice(i + 1).trim(), [flag]: false } : null; }).filter((x) => x && x.id);
      v.querySelector("#bulkAdd").onclick = () => {
        const add = parse();
        for (const a of add) { const ex = draft[key].find((c) => c.id.toLowerCase() === a.id.toLowerCase()); ex ? (ex.name = a.name) : draft[key].push(a); }
        mark(key); drawL(); toast(`${add.length}개 반영`);
      };
      v.querySelector("#bulkReplace").onclick = async () => { const add = parse(); if (!add.length) return; if (await confirmBox(`목록을 ${add.length}개로 바꿀까요?`)) { draft[key] = add; mark(key); drawL(); } };
    };
    drawL();
    v.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-i]");
      if (!tr || !e.target.dataset.f) return;
      const c = draft[key][+tr.dataset.i];
      c[e.target.dataset.f] = e.target.type === "checkbox" ? e.target.checked : e.target.value.trim();
      mark(key);
    });
    v.addEventListener("click", (e) => {
      if (!e.target.closest("[data-del]")) return;
      draft[key].splice(+e.target.closest("tr").dataset.i, 1);
      mark(key); drawL();
    });
  }
  const cafes = (v) => listEditor(v, "favCafes", { title: "☕ 관심 동호회 (네이버 카페)", idLabel: "카페 주소 ID", flag: "joined", flagLabel: "가입됨", flagHint: "가입된 카페는 목록에서 '🔍 검색' 뱃지를 숨깁니다. 가입하지 않은 카페 글은 '검색' 뱃지로 네이버 검색 결과에서 열어 볼 수 있어요.", link: (id) => `https://cafe.naver.com/${id}` });
  const youtube = (v) => listEditor(v, "favYoutube", { title: "▶️ 관심 유튜브 채널", idLabel: "채널 ID", flag: "must", flagLabel: "필수 수집", flagHint: "필수 수집을 켠 채널(예: 인싸케이)은 키워드와 관계없이 모든 새 영상을 수집하고 카톡 알림도 보냅니다. 채널 ID 는 UC 로 시작하는 24자입니다.", link: (id) => `https://www.youtube.com/channel/${id}` });

  function boards(v) {
    const drawB = () => {
      v.innerHTML = `<div class="card"><h3>🚗 자동차 커뮤니티 게시판 <span class="sub">보배드림 · 클리앙 · 뽐뿌 게시판 목록 주소 · 5분마다 1~2쪽 확인</span></h3>
        <table class="tbl"><thead><tr><th>이름</th><th>게시판 목록 주소</th><th></th></tr></thead><tbody>
        ${draft.boards.map((b, i) => `<tr data-i="${i}"><td style="width:220px"><input class="input" data-f="name" value="${esc(b.name)}"></td><td><input class="input" data-f="url" value="${esc(b.url)}"></td><td><button class="btn sm ghost danger" data-del>✕</button></td></tr>`).join("")}
        </tbody></table><button class="btn" id="addB" style="margin-top:10px">＋ 게시판 추가</button>
        <p class="hint">제목에 현대차 관련어나 이슈 키워드가 있는 글만 저장합니다. 지원: bobaedream.co.kr/list?code=… · clien.net/service/board/… · ppomppu.co.kr/zboard/zboard.php?id=…</p></div>`;
      v.querySelector("#addB").onclick = () => { draft.boards.push({ name: "", url: "" }); mark("boards"); drawB(); };
    };
    drawB();
    v.addEventListener("input", (e) => { const tr = e.target.closest("tr[data-i]"); if (!tr) return; draft.boards[+tr.dataset.i][e.target.dataset.f] = e.target.value.trim(); mark("boards"); });
    v.addEventListener("click", (e) => { if (!e.target.closest("[data-del]")) return; draft.boards.splice(+e.target.closest("tr").dataset.i, 1); mark("boards"); drawB(); });
  }

  function lexicon(v) {
    v.innerHTML = `<div class="hint" style="margin-bottom:10px">수집할 때 붙는 기본 성향입니다. 욕·비아냥 단어만 있고 구체적인 문제 단어가 없으면 '단순비난', 부정 단어가 더 많으면 '부정', 긍정 단어가 더 많으면 '긍정'. 더 정확한 판단은 목록에서 'AI 성향 재분석'을 쓰세요.</div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${[["abuse", "단순비난"], ["negative", "부정"], ["positive", "긍정"]].map(([k, l]) => `
      <div class="card"><h3>${sentBadge(k === "negative" ? "neg" : k === "positive" ? "pos" : "abuse")} ${l} 단어</h3><textarea class="input" data-k="${k}" rows="12" style="width:100%">${esc(draft.lexicon[k])}</textarea></div>`).join("")}</div>`;
    v.addEventListener("input", (e) => { if (e.target.dataset.k) { draft.lexicon[e.target.dataset.k] = e.target.value; mark("lexicon"); } });
  }

  function collect(v) {
    const c = draft.collect;
    const qn = collectQueries(compileGroups(draft)).length;
    const srcN = Object.values(c.naver).filter(Boolean).length;
    v.innerHTML = `<div class="dash-grid">
      <div class="card span-6"><h3>📡 수집</h3><div style="display:flex;flex-direction:column;gap:12px">
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="enabled" ${c.enabled ? "checked" : ""}><span></span></span><b>자동 수집 (5분마다)</b></label>
        <div class="frow"><span class="lbl">네이버</span>${[["news", "뉴스"], ["blog", "블로그"], ["cafe", "카페글"], ["post", "포스트(웹문서)"]].map(([k, l]) => `<label class="toggle-row"><span class="switch"><input type="checkbox" data-n="${k}" ${c.naver[k] ? "checked" : ""}><span></span></span>${l}</label>`).join("")}</div>
        <div class="field">설치 없이 서버만으로 (네이버·뽐뿌가 서버 접속을 막아 공식 경로로 대신)</div>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="googleNews" ${c.googleNews !== false ? "checked" : ""}><span></span></span>언론: Google 뉴스 RSS (5분마다 검색어 ${c.googleNewsPerTick ?? 20}개씩)</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="daumBlog" ${c.daumBlog !== false ? "checked" : ""}><span></span></span>블로그: 다음(카카오) 블로그 검색 (카카오 REST API 키 사용)</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="naverServerCafe" ${c.naverServerCafe !== false ? "checked" : ""}><span></span></span>네이버 카페: 서버가 아주 천천히 검색 (5분마다 ${c.naverServerCafePerTick ?? 6}번 · 막히면 자동으로 쉼)</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="ppomppuRss" ${c.ppomppuRss !== false ? "checked" : ""}><span></span></span>뽐뿌: 게시판 RSS (10분마다)</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="naverByExtension" ${c.naverByExtension !== false ? "checked" : ""}><span></span></span><b>네이버 검색(카페 포함)은 크롬 수집 도우미가</b> — 선택 사항, 설치한 PC가 있을 때만 (끄면 서버가 시도하지만 네이버가 막음)</label>
        <label class="field">수집 도우미가 5분마다 하는 네이버 검색 수 (12 = 시간당 144회 · 너무 크면 네이버가 잠시 막을 수 있음)<input class="input" type="number" min="3" max="30" data-c="extNaverPerRun" value="${c.extNaverPerRun ?? 12}"></label>
        <label class="field">(서버가 시도할 때) 네이버 검색 화면 읽기 — 5분마다 읽을 검색 수 (API 키가 없을 때 · 너무 크면 네이버가 잠시 막을 수 있음)<input class="input" type="number" min="6" max="80" data-c="naverWebPerTick" value="${c.naverWebPerTick ?? 36}"></label>
        <label class="field">(API 키를 넣은 경우) 네이버 API 하루 사용량 (앱 1개당, 최대 25,000)<input class="input" type="number" data-c="naverDailyBudget" value="${c.naverDailyBudget}"></label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="youtubeRss" ${c.youtubeRss ? "checked" : ""}><span></span></span>관심 유튜브 새 영상 (RSS · 무료 · 10분마다)</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="youtubeSearch" ${c.youtubeSearch ? "checked" : ""}><span></span></span>유튜브 전체 검색 (YouTube API)</label>
        <label class="field">YouTube API 하루 사용 단위 (검색 1회 = 100 · 프로젝트 전체 10,000단위를 기존 유튜브 모니터링 시스템과 나눠 씀 → 기본 3,000)<input class="input" type="number" data-c="youtubeDailyUnits" value="${c.youtubeDailyUnits}"></label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-c="community" ${c.community ? "checked" : ""}><span></span></span>자동차 커뮤니티 게시판</label>
        <label class="field">언론 유사 기사 묶기 기준 (0.8 = 80%)<input class="input" type="number" step="0.05" min="0.5" max="1" data-c="newsDupThreshold" value="${c.newsDupThreshold}"></label>
        <label class="field">🗑 가비지 보관 기간 (이 기간이 지난 가비지 글은 매일 새벽 자동 삭제 · 일별 가비지 건수 통계는 남음)
          <select class="input" data-c="garbageRetentionDays">${[[30, "1개월"], [90, "3개월 (기본)"], [180, "6개월"], [365, "1년"], [0, "지우지 않음"]].map(([d, l]) => `<option value="${d}" ${Number(c.garbageRetentionDays ?? 90) === d ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <p class="hint" style="margin-top:-6px">⭐ 중요 표시나 📝 메모를 단 가비지 글은 지우지 않습니다.</p>
        <div class="card" style="background:var(--panel-2);box-shadow:none"><b>⏱ 예상 수집 주기</b><div class="hint" id="est"></div></div>
      </div></div>
      <div class="card span-6"><h3>🔔 카카오톡 알림</h3><div style="display:flex;flex-direction:column;gap:12px">
        <label class="field">알림 제목 유사도 기준 (이 이상 비슷하면 대표 1건만)<input class="input" type="number" step="0.05" min="0.5" max="1" data-a="dupThreshold" value="${draft.alert.dupThreshold}"></label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-fav="cafe" ${draft.alert.favOnly?.cafe !== false ? "checked" : ""}><span></span></span>동호회는 <b>관심 동호회</b> 글만 알림</label>
        <label class="toggle-row"><span class="switch"><input type="checkbox" data-fav="youtube" ${draft.alert.favOnly?.youtube !== false ? "checked" : ""}><span></span></span>유튜브는 <b>관심 유튜브</b> 영상만 알림</label>
        <label class="field">알림 보내지 않을 제목 단어 (가입인사·등업 신청 등 · 글은 목록에 그대로 저장)<textarea class="input" data-a="excludeTitle" rows="3">${esc(draft.alert.excludeTitle ?? "")}</textarea></label>
        <label class="field">유사 알림을 막는 시간 (시간)<input class="input" type="number" data-a="dupHours" value="${draft.alert.dupHours}"></label>
        <label class="field">한 번 수집에 한 사람에게 보낼 최대 알림 (넘으면 요약 1통)<input class="input" type="number" data-a="maxPerRun" value="${draft.alert.maxPerRun}"></label>
        <p class="hint">어떤 키워드에 알림을 보낼지는 '키워드' 탭의 그룹별 <b>카톡 알림</b> 스위치로 정합니다. 받는 사람은 각자 '내 알림'에서 카카오톡을 연결합니다.</p>
      </div>
      <h3 style="margin-top:20px">🤖 AI 성향 분석</h3><div style="display:flex;flex-direction:column;gap:12px">
        <label class="field">Gemini 모델 (먼저 사용 · 무료 한도)<input class="input" data-ai="geminiModel" value="${esc(draft.ai.geminiModel)}"></label>
        <label class="field">Claude 모델 (Gemini 한도 초과·오류 시)<input class="input" data-ai="claudeModel" value="${esc(draft.ai.claudeModel)}"></label>
        <label class="field">Claude 생각 깊이 (low 가 가장 빠르고 저렴)<select class="input" data-ai="claudeEffort">${["low", "medium", "high"].map((x) => `<option ${draft.ai.claudeEffort === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <div class="field">새 글 자동 AI 성향 분석 (Gemini 무료 한도로만 · 한도가 차면 건너뛰고 규칙 성향 유지)</div>
        <div class="chips" id="autoCh">${CH_ORDER.map((ch) => `<button class="chip ${(draft.ai.autoChannels || ["ppomppu"]).includes(ch) ? "on" : ""}" data-ch="${ch}">${CH[ch].name}</button>`).join("")}</div>
        <p class="hint">Claude 비용을 더 줄이려면 모델을 <code>claude-haiku-5-5</code> 로 바꿀 수 있어요.</p>
      </div></div></div>`;
    const est = () => {
      const calls = qn * Object.values(c.naver).filter(Boolean).length;
      const perTick = store._naverKeys ? Math.max(10, Math.floor((c.naverDailyBudget * store._naverKeys) / 288)) : Math.max(6, Number(c.naverWebPerTick) || 36);
      const cycle = Math.ceil(calls / perTick) * 5;
      v.querySelector("#est").innerHTML = `검색어 ${qn}개 × 네이버 ${Object.values(c.naver).filter(Boolean).length}곳 = ${fmtNum(calls)}회 / 5분마다 ${fmtNum(perTick)}회 → 모든 검색어를 한 바퀴 도는 데 약 <b>${cycle}분</b> ${store._naverKeys ? `(네이버 API 앱 ${store._naverKeys}개 기준)` : "(네이버 검색 화면 읽기 기준 · 검색어를 줄이면 빨라짐)"}<br>유튜브 관심 채널 10분마다 · 커뮤니티 5분마다`;
    };
    void srcN;
    est();
    v.querySelector("#autoCh").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const s = new Set(draft.ai.autoChannels || ["ppomppu"]);
      s.has(b.dataset.ch) ? s.delete(b.dataset.ch) : s.add(b.dataset.ch);
      draft.ai.autoChannels = [...s];
      b.classList.toggle("on");
      mark("ai");
    });
    v.addEventListener("input", (e) => {
      const t = e.target;
      const val = t.type === "checkbox" ? t.checked : t.type === "number" || t.dataset.c === "garbageRetentionDays" ? Number(t.value) : t.value;
      if (t.dataset.c) { c[t.dataset.c] = val; mark("collect"); }
      if (t.dataset.n) { c.naver[t.dataset.n] = val; mark("collect"); }
      if (t.dataset.a) { draft.alert[t.dataset.a] = val; mark("alert"); }
      if (t.dataset.fav) { draft.alert.favOnly = { cafe: true, youtube: true, ...(draft.alert.favOnly || {}), [t.dataset.fav]: t.checked }; mark("alert"); }
      if (t.dataset.ai) { draft.ai[t.dataset.ai] = val; mark("ai"); }
      est();
    });
  }

  async function keys(v) {
    const origin = location.origin;
    v.innerHTML = `<div class="card" style="margin-bottom:14px"><h3>🔐 API 키 <span class="sub">서버 전용 저장소에 보관 · 화면에서는 다시 볼 수 없고 '설정됨'만 표시</span></h3><div id="ks" class="chips"><span class="skeleton" style="width:300px;height:26px"></span></div></div>
      <div class="dash-grid">
        <div class="card span-6"><h3>네이버 검색 API <span class="badge b-info">선택</span></h3><p class="hint"><b>넣지 않아도 됩니다.</b> 키가 없으면 네이버 검색 결과 화면(뉴스·블로그·카페)을 직접 읽어 모읍니다. 예전에 만든 앱에 '검색' API 가 있는 경우에만 넣으세요. developers.naver.com → Application → 애플리케이션 등록 → 사용 API '검색' → Client ID · Client Secret. <b>앱을 여러 개</b> 만들어 줄마다 넣으면 수집이 그만큼 빨라집니다 (앱당 하루 25,000회 무료).</p>
          <textarea class="input" id="naverKeys" rows="4" style="width:100%" placeholder="ClientID:ClientSecret&#10;ClientID2:ClientSecret2"></textarea></div>
        <div class="card span-6"><h3>YouTube Data API</h3><p class="hint">Google Cloud 콘솔(linesquare--monitor) → API 및 서비스 → 사용자 인증 정보 → API 키 만들기 → API 제한사항 'YouTube Data API v3'. 하루 할당량은 키가 아니라 프로젝트 단위라 기존 유튜브 모니터링 시스템과 나눠 씁니다.</p>
          <textarea class="input" id="youtubeKeys" rows="2" style="width:100%" placeholder="AIza..."></textarea></div>
        <div class="card span-6"><h3>Google Gemini (AI 1순위)</h3><p class="hint">aistudio.google.com → Get API key</p><input class="input" id="geminiKey" style="width:100%" placeholder="AIza..."></div>
        <div class="card span-6"><h3>Claude API (AI 2순위)</h3><p class="hint">platform.claude.com → API Keys</p><input class="input" id="claudeKey" style="width:100%" placeholder="sk-ant-..."></div>
        <div class="card span-12"><h3>카카오톡 (나에게 보내기 · 무료)</h3>
          <ol class="hint" style="line-height:1.9;margin:0 0 12px;padding-left:18px">
            <li>developers.kakao.com → 내 애플리케이션 → 앱 만들기 (예: 현대차 이슈 알림)</li>
            <li>[앱 키] REST API 키 복사 · [보안] 클라이언트 시크릿 코드 생성(사용함)</li>
            <li>[카카오 로그인] 사용 설정 ON · Redirect URI 에 <code id="redir">${esc(origin)}/kakao.html</code> <button class="btn sm" id="copyR">복사</button> 등록</li>
            <li>[카카오 로그인 → 동의항목] '카카오톡 메시지 전송' 을 선택 동의로</li>
            <li>[플랫폼 → Web] 사이트 도메인에 <code>${esc(origin)}</code> 등록 (알림의 '게시물 보기' 버튼 주소)</li>
            <li>다른 담당자가 연결할 때 권한 오류가 나면 [앱 → 팀 관리]에서 그 담당자를 팀원으로 초대해 주세요</li>
          </ol>
          <div class="frow"><input class="input" id="kakaoRestKey" style="flex:1" placeholder="REST API 키"><input class="input" id="kakaoSecret" style="flex:1" placeholder="클라이언트 시크릿"></div></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>📷 인스타그램 (Meta 공식 API · 해시태그 검색) <span class="sub" id="igSt"></span></h3>
        <ol class="hint" style="line-height:1.9;margin:0 0 12px;padding-left:18px">
          <li>developers.facebook.com 에서 만든 앱의 <b>앱 ID</b>와 <b>앱 시크릿 코드</b>를 아래에 넣고 '입력한 키 저장'</li>
          <li>Meta 앱 → 이용 사례 → 'Facebook 로그인이 포함된 API 설정' → 리디렉션 URI 에 <code>${esc(origin)}/instagram.html</code> 등록</li>
          <li><b>Instagram 연결</b> → 인스타그램 비즈니스 계정이 연결된 페이스북으로 로그인 → 페이지 선택·허용</li>
        </ol>
        <div class="frow"><input class="input" id="metaAppId" style="flex:1" placeholder="Meta 앱 ID"><input class="input" id="metaAppSecret" style="flex:1" placeholder="앱 시크릿 코드"><button class="btn" id="igConnect">📷 Instagram 연결</button></div>
        <label class="toggle-row" style="margin-top:12px"><span class="switch"><input type="checkbox" id="igOn" ${draft.instagram?.on !== false ? "checked" : ""}><span></span></span>인스타그램 수집 (5분마다 해시태그 ${draft.instagram?.perTick ?? 4}개씩 돌아가며)</label>
        <label class="field" style="margin-top:8px">해시태그 (띄어쓰기로 구분 · <b>7일에 서로 다른 해시태그 30개까지</b> — 자주 바꾸면 한도에 걸림)<textarea class="input" id="igTags" rows="3">${esc(draft.instagram?.hashtags || "")}</textarea></label>
      </div>
      <div class="card" style="margin-top:14px"><h3>🧩 크롬 수집 도우미 (네이버 검색·뽐뿌) <span class="sub" id="extSt"></span></h3>
        <p class="hint">네이버 검색과 뽐뿌는 서버 접속을 막아서, 담당자 PC의 크롬이 5분마다 사람이 보는 속도로 읽어 이 시스템으로 보냅니다. <b>이미 설치했다면 새로 내려받아 폴더를 덮어쓰고 chrome://extensions 에서 새로고침(↻)</b> 해 주세요 (버전 1.1.0). 크롬이 켜져 있는 PC 한 대 이상에 설치해 두세요 (여러 대여도 같은 글은 한 번만 저장).</p>
        <ol class="hint" style="line-height:1.9;margin:0 0 12px;padding-left:18px">
          <li><b>토큰 만들기</b>로 수집 토큰을 만들고 복사합니다 (만들 때 한 번만 보입니다 · 다시 만들면 예전 토큰은 못 씀)</li>
          <li><a class="btn sm" href="/download/hd-collector-extension.zip" download>📦 확장 내려받기</a> → 압축 풀기 → 크롬 <code>chrome://extensions</code> → 개발자 모드 켜기 → '압축해제된 확장 프로그램을 로드합니다' → 푼 폴더 선택</li>
          <li>크롬 오른쪽 위 퍼즐 아이콘 → 수집 도우미 → 토큰 붙여넣기 → 저장 → 지금 수집</li>
        </ol>
        <div class="frow"><button class="btn" id="mkToken">🔑 토큰 만들기</button><input class="input" id="tokenOut" readonly style="flex:1;font-family:ui-monospace,monospace" placeholder="토큰 만들기를 누르면 여기에 나옵니다"><button class="btn sm" id="copyToken">복사</button></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" id="saveKeys">🔐 입력한 키 저장</button><span class="hint" style="align-self:center">빈 칸은 그대로 둡니다.</span></div>`;
    const showStatus = (s) => {
      store._naverKeys = s.naverKeys;
      const item = (ok, l) => `<span class="badge ${ok ? "b-pos" : "b-neu"}">${ok ? "✓" : "✕"} ${l}</span>`;
      v.querySelector("#extSt").textContent = s.ingestToken ? "토큰 있음" : "토큰 없음";
      v.querySelector("#igSt").textContent = s.instagram ? `연결됨 · @${s.instagram.username} (${s.instagram.page})${s.instagram.expiresAt ? ` · 로그인 유효 ${new Date(s.instagram.expiresAt).toLocaleDateString("ko-KR")}까지(자동 연장)` : ""}` : s.metaAppId ? "앱 키 있음 · 연결 전" : "연결 전";
      v.querySelector("#ks").innerHTML = [item(s.naverKeys, `네이버 ${s.naverKeys}개`), item(s.youtubeKeys, `유튜브 ${s.youtubeKeys}개`), item(s.geminiKey, "Gemini"), item(s.claudeKey, "Claude"), item(s.kakaoRestKey, "카카오 REST"), item(s.kakaoSecret, "카카오 시크릿")].join("");
    };
    v.querySelector("#igConnect").onclick = () => {
      const appId = store.settings.metaAppId;
      if (!appId) return toast("Meta 앱 ID 를 먼저 넣고 '입력한 키 저장'을 눌러 주세요", "err", 5000);
      location.href = `https://www.facebook.com/dialog/oauth?${new URLSearchParams({ client_id: appId, redirect_uri: `${origin}/instagram.html`, response_type: "code", scope: "instagram_basic,pages_show_list,pages_read_engagement,business_management" })}`;
    };
    v.querySelector("#igOn").onchange = (e) => { draft.instagram = { ...(draft.instagram || {}), on: e.target.checked }; mark("instagram"); };
    v.querySelector("#igTags").oninput = (e) => { draft.instagram = { ...(draft.instagram || {}), hashtags: e.target.value }; mark("instagram"); };
    v.querySelector("#mkToken").onclick = (e) => busy(e.currentTarget, async () => {
      if (v.querySelector("#extSt").textContent === "토큰 있음" && !(await confirmBox("새 토큰을 만들면 이미 설치한 수집 도우미에도 새 토큰을 다시 넣어야 합니다. 만들까요?"))) return;
      try { const r = await store.be.makeIngestToken(); v.querySelector("#tokenOut").value = r.token; v.querySelector("#extSt").textContent = "토큰 있음"; toast("토큰을 만들었습니다. 복사해서 수집 도우미에 넣어 주세요"); } catch (err) { toast(err.message, "err"); }
    });
    v.querySelector("#copyToken").onclick = () => { const t = v.querySelector("#tokenOut").value; if (t) navigator.clipboard.writeText(t).then(() => toast("복사했습니다")); };
    v.querySelector("#copyR").onclick = () => navigator.clipboard.writeText(`${origin}/kakao.html`).then(() => toast("복사했습니다"));
    v.querySelector("#saveKeys").onclick = (e) => busy(e.currentTarget, async () => {
      const patch = {};
      for (const k of ["naverKeys", "youtubeKeys", "geminiKey", "claudeKey", "kakaoRestKey", "kakaoSecret", "metaAppId", "metaAppSecret"]) { const val = v.querySelector(`#${k}`).value.trim(); if (val) patch[k] = val; }
      if (!Object.keys(patch).length) return toast("넣은 키가 없습니다", "err");
      try { showStatus(await store.be.saveSecrets(patch)); v.querySelectorAll("textarea, input").forEach((x) => (x.value = "")); toast("키를 저장했습니다"); } catch (err) { toast(err.message, "err", 6000); }
    });
    try { showStatus(await store.be.secretsStatus()); } catch (err) { toast(err.message, "err"); }
  }

  async function status(v) {
    v.innerHTML = `<div class="dash-grid"><div class="card span-12"><h3>🛰 최근 수집 기록 <span class="sub">5분마다 자동 실행</span></h3>
      <div class="frow" style="margin-bottom:12px"><button class="btn primary" id="run">⚡ 지금 수집</button>
      <select class="input" id="reDays">${[1, 3, 7, 14, 31].map((d) => `<option value="${d}" ${d === 3 ? "selected" : ""}>최근 ${d}일</option>`).join("")}</select><button class="btn" id="re">🔄 다시 분류 · 통계 다시 계산</button></div>
      <div id="runs"><div class="skeleton" style="height:120px"></div></div></div></div>`;
    const drawRuns = async () => {
      const runs = await store.be.getRuns();
      v.querySelector("#runs").innerHTML = runs.length ? `<table class="tbl"><thead><tr><th>시각</th><th>걸린 시간</th><th>받은 글</th><th>새 글</th><th>기록</th></tr></thead><tbody>${runs.map((r) => `<tr><td style="white-space:nowrap">${esc(fmtTime(r.at))}</td><td>${Math.round(r.ms / 1000)}초</td><td>${fmtNum(r.fetched)}</td><td><b>${fmtNum(r.created)}</b></td><td class="status-log" style="max-height:none">${(r.log || []).map((l) => `<div>› ${esc(l)}</div>`).join("")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty"><div class="big">🛰</div>아직 수집 기록이 없습니다</div>`;
    };
    v.querySelector("#run").onclick = (e) => busy(e.currentTarget, async () => { try { const r = await store.be.runNow(); toast(`수집 완료 · 새 글 ${r.created}건`); drawRuns(); } catch (err) { toast(err.message, "err", 6000); } });
    v.querySelector("#re").onclick = (e) => busy(e.currentTarget, async () => { try { const r = await store.be.reclassify(+v.querySelector("#reDays").value); toast(`다시 분류: ${fmtNum(r.scanned)}건 확인, ${fmtNum(r.changed)}건 바뀜`); } catch (err) { toast(err.message, "err", 6000); } });
    drawRuns().catch((e) => toast(e.message, "err"));
  }

  draw();
  if (!store._naverKeys) store.be.secretsStatus().then((s) => (store._naverKeys = s.naverKeys)).catch(() => {});
  const onEv = (ev) => { if (ev.type === "settings" && !dirty.size) { draft = structuredClone(store.settings); } };
  store.listeners.add(onEv);
  return { cleanup() { store.listeners.delete(onEv); } };
}
