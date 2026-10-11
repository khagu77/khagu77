// 부정 이슈 모니터링 - 수집/설정 화면

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const AUTO = params.get("auto") === "1";

const state = {
  settings: null,
  running: false,
  stopRequested: false,
  rows: [], // 보고서 행
  range: null,
  costUsd: 0,
};

// ---------------------------------------------------------------------------
// 공통 화면 도구
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function log(msg, cls = "") {
  const now = new Date();
  const line = `[${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}] ${msg}`;
  const pre = $("#log");
  pre.append(cls === "err" ? el("span", { class: "err", text: line + "\n" }) : line + "\n");
  pre.scrollTop = pre.scrollHeight;
  console.log(line);
}

function setSummary(text) {
  $("#summary").textContent = text;
}

for (const btn of document.querySelectorAll("nav .tab")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll("nav .tab")) b.classList.toggle("active", b === btn);
    $("#tab-collect").hidden = btn.dataset.tab !== "collect";
    $("#tab-settings").hidden = btn.dataset.tab !== "settings";
  });
}

// ---------------------------------------------------------------------------
// 네이버 로그인 상태
// ---------------------------------------------------------------------------

async function checkLogin() {
  const box = $("#login");
  try {
    const c = await chrome.cookies.get({ url: "https://www.naver.com", name: "NID_AUT" });
    if (c) {
      box.className = "status ok";
      box.textContent = "네이버 로그인됨 ✓";
      return true;
    }
  } catch {
    // 무시
  }
  box.className = "status bad";
  box.textContent = "";
  box.append("네이버에 로그인돼 있지 않습니다. 카페 수집 전에 ", el("a", { href: "https://nid.naver.com/nidlogin.login", target: "_blank", text: "네이버 로그인" }), " 해 주세요. (커뮤니티는 로그인 없이 수집됩니다)");
  return false;
}

// ---------------------------------------------------------------------------
// 수집 기간 / 수집할 곳 고르기
// ---------------------------------------------------------------------------

function setRange(start, end) {
  $("#rangeStart").value = toLocalInputValue(start);
  $("#rangeEnd").value = toLocalInputValue(end);
}

function readRange() {
  const start = new Date($("#rangeStart").value);
  const end = new Date($("#rangeEnd").value);
  if (isNaN(start) || isNaN(end) || start >= end) throw new Error("수집 기간을 확인해 주세요 (시작이 끝보다 앞이어야 합니다)");
  return { start, end };
}

$("#rangeDefault").addEventListener("click", () => {
  const r = defaultRange();
  setRange(r.start, r.end);
});
$("#range3h").addEventListener("click", () => {
  const end = new Date();
  setRange(new Date(end.getTime() - 3 * 3600 * 1000), end);
});

function renderPickList() {
  const box = $("#pickList");
  box.textContent = "";
  const s = state.settings;
  box.append(el("div", { class: "group", text: "네이버 카페" }));
  s.cafes.forEach((c, i) => {
    if (!c.on || !c.id) return;
    box.append(el("label", {}, el("input", { type: "checkbox", "data-kind": "cafe", "data-i": i, checked: true, onchange: updatePickCount }), c.name || c.id));
  });
  box.append(el("div", { class: "group", text: "자동차 커뮤니티" }));
  s.communities.forEach((c, i) => {
    if (!c.on || !c.url) return;
    box.append(el("label", {}, el("input", { type: "checkbox", "data-kind": "community", "data-i": i, checked: true, onchange: updatePickCount }), c.name || c.url));
  });
  updatePickCount();
}

function pickedSources() {
  const cafes = [];
  const communities = [];
  for (const cb of document.querySelectorAll("#pickList input:checked")) {
    const i = +cb.dataset.i;
    if (cb.dataset.kind === "cafe") cafes.push(state.settings.cafes[i]);
    else communities.push(state.settings.communities[i]);
  }
  return { cafes, communities };
}

function updatePickCount() {
  const { cafes, communities } = pickedSources();
  $("#sourceCount").textContent = `— 카페 ${cafes.length}곳, 커뮤니티 ${communities.length}곳`;
}

function setAllPicks(fn) {
  [...document.querySelectorAll("#pickList input")].forEach((cb, idx) => (cb.checked = fn(cb, idx)));
  updatePickCount();
}
$("#pickAll").addEventListener("click", () => setAllPicks(() => true));
$("#pickNone").addEventListener("click", () => setAllPicks(() => false));
$("#pickTest").addEventListener("click", () => {
  let cafes = 0;
  let comms = 0;
  setAllPicks((cb) => (cb.dataset.kind === "cafe" ? cafes++ < 2 : comms++ < 1));
});

function updateAiInfo() {
  const s = state.settings;
  const m = MODELS.find((x) => x.id === s.model) || MODELS[0];
  if (!s.apiKey) {
    $("#useAi").checked = false;
    $("#aiInfo").textContent = "— API 키가 없어 키워드로만 고릅니다 (무료 시험 모드). 설정에서 키를 넣으면 AI 를 쓸 수 있습니다.";
  } else {
    $("#aiInfo").textContent = `— ${m.label}. 끄면 키워드로만 고르고 '주요 내용'에 제목이 들어갑니다 (무료).`;
  }
  $("#useAi").disabled = !s.apiKey;
}

function updateAutoInfo() {
  const s = state.settings;
  $("#autoInfo").textContent = s.autoRun ? `자동 수집: 매일 ${s.autoRunTime} (설정에서 바꿀 수 있습니다)` : "자동 수집: 꺼짐";
}

// ---------------------------------------------------------------------------
// 출처별 진행 표
// ---------------------------------------------------------------------------

const sourceRows = new Map();

function initSourceTable(sources) {
  const tbody = $("#sources tbody");
  tbody.textContent = "";
  sourceRows.clear();
  for (const src of sources) {
    const tr = el("tr", {}, el("td", { text: src.name }), el("td"), el("td"), el("td"), el("td"), el("td", { text: "대기" }));
    tbody.append(tr);
    sourceRows.set(src.key, tr);
  }
  $("#sources").hidden = false;
}

function updateSource(key, { listed, candidates, read, issues, status, error } = {}) {
  const tr = sourceRows.get(key);
  if (!tr) return;
  const td = tr.children;
  if (listed !== undefined) td[1].textContent = listed;
  if (candidates !== undefined) td[2].textContent = candidates;
  if (read !== undefined) td[3].textContent = read;
  if (issues !== undefined) td[4].textContent = issues;
  if (status !== undefined) {
    td[5].textContent = status;
    td[5].className = error ? "err" : "";
  }
}

// ---------------------------------------------------------------------------
// 결과 표 (받기 전에 고치기)
// ---------------------------------------------------------------------------

function fmtMonthDay(d) {
  return d ? `${pad2(d.getMonth() + 1)}월 ${pad2(d.getDate())}일` : "";
}

function renderResults() {
  const tbody = $("#results tbody");
  tbody.textContent = "";
  state.rows.forEach((r, i) => {
    const sum = el("input", { type: "text", value: r.summary, oninput: (e) => (r.summary = e.target.value, saveLastResult()) });
    const tr = el(
      "tr",
      { class: r.highlight ? "yellow" : "" },
      el("td", { text: r.community }),
      el("td", {}, el("input", { type: "text", value: r.car, size: 7, oninput: (e) => (r.car = e.target.value, saveLastResult()) })),
      el("td", { text: fmtMonthDay(r.date) }),
      el(
        "td",
        {},
        (() => {
          const sel = el("select", { onchange: (e) => (r.category = e.target.value, saveLastResult()) });
          for (const c of ["품질", "응대", "결품"]) sel.append(el("option", { value: c, text: c, selected: r.category === c }));
          return sel;
        })()
      ),
      el("td", { class: "url" }, el("a", { href: r.url, target: "_blank", text: r.url })),
      el("td", { class: "sum" }, sum),
      el(
        "td",
        {},
        el("input", {
          type: "checkbox",
          checked: !!r.highlight,
          onchange: (e) => {
            r.highlight = e.target.checked;
            tr.classList.toggle("yellow", r.highlight);
            saveLastResult();
          },
        })
      ),
      el(
        "td",
        {},
        el("button", {
          class: "del",
          text: "삭제",
          onclick: () => {
            state.rows.splice(i, 1);
            renderResults();
            saveLastResult();
          },
        })
      )
    );
    tbody.append(tr);
  });
  $("#results").hidden = !state.rows.length;
  $("#resultsTitle").hidden = !state.rows.length;
  $("#download").disabled = !state.rows.length && !state.range;
}

async function saveLastResult() {
  await chrome.storage.local.set({
    lastResult: {
      range: state.range ? { start: state.range.start.getTime(), end: state.range.end.getTime() } : null,
      rows: state.rows.map((r) => ({ ...r, date: r.date ? r.date.getTime() : null })),
      savedAt: Date.now(),
    },
  });
}

async function loadLastResult() {
  const { lastResult } = await chrome.storage.local.get("lastResult");
  if (!lastResult) return;
  state.rows = lastResult.rows.map((r) => ({ ...r, date: r.date ? new Date(r.date) : null }));
  state.range = lastResult.range ? { start: new Date(lastResult.range.start), end: new Date(lastResult.range.end) } : null;
  if (state.rows.length || state.range) {
    renderResults();
    if (state.range) setSummary(`지난 수집 결과 (${fmtDateTime(state.range.start)} ~ ${fmtDateTime(state.range.end)}): ${state.rows.length}건`);
  }
}

function reportFilename(range, ascii = false) {
  const d = range ? range.end : new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  return ascii ? `${ymd}_HMG_community_issues.xlsx` : `${ymd}_현대차 제네시스 커뮤니티 부정이슈.xlsx`;
}

async function downloadReport() {
  const bytes = ReportXlsx.build(state.rows);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  try {
    try {
      await chrome.downloads.download({ url, filename: reportFilename(state.range), conflictAction: "uniquify", saveAs: false });
    } catch {
      // 한글 파일명을 못 쓰는 환경이면 영문 이름으로
      await chrome.downloads.download({ url, filename: reportFilename(state.range, true), conflictAction: "uniquify", saveAs: false });
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
$("#download").addEventListener("click", () => downloadReport().catch((e) => log(`엑셀 저장 실패: ${e.message}`, "err")));

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "GN7 PE / GN7" 처럼 여러 개면 가장 흔한 앞쪽
function firstHint(hint) {
  return String(hint || "").split("/")[0].trim();
}

// 키워드만으로 노란색 항목 판단 (AI 를 안 쓸 때)
function keywordHighlight(car, text, highlights) {
  const generic = new Set(["관련", "불만", "고장", "의견", "포함", "작동", "오류", "문의", "이상", "전체"]);
  for (const h of highlights || []) {
    if (h.car && !String(car).startsWith(h.car)) continue;
    const words = String(h.topic || "")
      .split(/[^가-힣A-Za-z0-9]+/)
      .map((w) => w.replace(/(관련|등|의)$/, ""))
      .filter((w) => w.length >= 2 && !generic.has(w));
    if (words.some((w) => text.includes(w))) return true;
  }
  return false;
}

// 한 출처(카페 하나 또는 커뮤니티 하나)의 글 목록 → 후보 고르기 → 본문 읽기 → 판정 → 보고서 행
async function processSource(src, posts, readBody, ctx) {
  const { ai, range, settings, delays } = ctx;
  updateSource(src.key, { listed: posts.length, status: "후보 고르는 중" });
  if (!posts.length) {
    updateSource(src.key, { candidates: 0, read: 0, issues: 0, status: "완료 (기간 내 글 없음)" });
    return;
  }

  let candidates;
  if (ai) {
    const picked = await ai.triage(posts.map((p) => ({ key: p.articleId, source: src.name, title: p.title })));
    candidates = posts.filter((p) => picked.has(p.articleId));
  } else {
    candidates = posts.filter((p) => !excluded(p.title) && keywordHits(p.title).length && (src.kind === "cafe" || mentionsBrand(p.title)));
  }
  updateSource(src.key, { candidates: candidates.length, status: `본문 확인 중 0/${candidates.length}` });

  const items = [];
  let read = 0;
  for (const post of candidates) {
    if (state.stopRequested) throw new StopError("중지됨");
    try {
      const info = await readBody(post);
      read++;
      const ts = info.ts || (post.exact ? post.ts : null);
      if (ts && !inRange(new Date(ts), range)) continue; // 날짜만 알던 글이 실제로는 기간 밖
      items.push({
        key: post.articleId,
        source: src.name,
        carHint: src.car || "",
        title: info.title || post.title,
        body: info.body || "",
        url: post.url,
        ts: ts || post.ts,
      });
    } catch (e) {
      if (e instanceof StopError || e instanceof BlockedError) throw e;
      log(`${src.name} ${post.url} 본문 읽기 실패: ${e.message}`, "err");
    }
    updateSource(src.key, { read, status: `본문 확인 중 ${read}/${candidates.length}` });
    if (src.kind === "cafe") await ctx.naverWait(delays.article);
    else await ctx.communityWait(delays.community);
  }

  updateSource(src.key, { status: "판정 중" });
  let added = 0;
  if (ai) {
    let judged = new Map();
    try {
      judged = await ai.classify(items);
    } catch (e) {
      log(`${src.name} AI 판정 실패(${e.message}) → 키워드로 대신 판정`, "err");
    }
    for (const it of items) {
      const j = judged.get(it.key);
      let row;
      if (j) {
        if (!j.relevant) continue;
        row = { car: j.car_code || firstHint(it.carHint) || "-", category: j.category, summary: j.summary, highlight: !!j.highlight };
      } else {
        const text = `${it.title}\n${it.body}`;
        const cat = keywordCategory(text);
        if (!cat) continue;
        const car = guessCarCode(text, parseCarCodes(settings.carCodes)) || firstHint(it.carHint) || "-";
        row = { car, category: cat, summary: it.title, highlight: keywordHighlight(car, text, settings.highlights) };
      }
      state.rows.push({ community: src.name, date: it.ts ? new Date(it.ts) : null, url: it.url, order: src.order, ts: it.ts || 0, ...row });
      added++;
    }
  } else {
    const codes = parseCarCodes(settings.carCodes);
    for (const it of items) {
      const text = `${it.title}\n${it.body}`;
      const cat = keywordCategory(text);
      if (!cat) continue;
      if (src.kind !== "cafe" && !mentionsBrand(text)) continue;
      const car = guessCarCode(text, codes) || firstHint(it.carHint) || "-";
      state.rows.push({
        community: src.name,
        car,
        date: it.ts ? new Date(it.ts) : null,
        category: cat,
        url: it.url,
        summary: it.title,
        highlight: keywordHighlight(car, text, settings.highlights),
        order: src.order,
        ts: it.ts || 0,
      });
      added++;
    }
  }
  sortRows();
  renderResults();
  saveLastResult();
  updateSource(src.key, { issues: added, status: "완료" });
}

function sortRows() {
  state.rows.sort((a, b) => a.order - b.order || a.ts - b.ts);
}

async function runCollection() {
  if (state.running) return;
  const settings = state.settings;
  let range;
  try {
    range = readRange();
  } catch (e) {
    setSummary(e.message);
    return;
  }
  const { cafes, communities } = pickedSources();
  if (!cafes.length && !communities.length) {
    setSummary("수집할 곳을 하나 이상 골라 주세요.");
    return;
  }
  const useAi = $("#useAi").checked && !!settings.apiKey;

  state.running = true;
  state.stopRequested = false;
  state.rows = [];
  state.range = range;
  renderResults();
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#download").disabled = true;
  $("#log").textContent = "";
  const startedAt = Date.now();
  log(`수집 시작: ${fmtDateTime(range.start)} ~ ${fmtDateTime(range.end)}, 카페 ${cafes.length}곳, 커뮤니티 ${communities.length}곳, ${useAi ? `AI(${settings.model})` : "키워드 모드"}`);
  setSummary("수집 중…");

  const delays = DELAYS[settings.speed] || DELAYS.normal;
  const ai = useAi ? new AiClassifier(settings, log) : null;
  const isStopped = () => state.stopRequested;

  // 엑셀 행 순서: 설정에 적힌 카페 순서 → 커뮤니티 순서
  const cafeSources = cafes.map((c) => ({ kind: "cafe", key: `cafe:${c.id}`, name: c.name || c.id, car: c.car, cafe: c, order: settings.cafes.indexOf(c) }));
  const commSources = communities.map((c) => ({ kind: "community", key: `comm:${c.url}`, name: c.name || c.url, site: c, order: 1000 + settings.communities.indexOf(c) }));
  initSourceTable([...cafeSources, ...commSources]);

  const naver = new NaverCollector({ delays, log, isStopped });
  const community = new CommunityCollector({ delays, log, isStopped });
  const ctx = {
    ai,
    range,
    settings,
    delays,
    naverWait: (r) => naver.wait(r),
    communityWait: (r) => community.wait(r),
  };

  const naverTask = async () => {
    if (!cafeSources.length) return;
    if (!(await checkLogin())) {
      for (const s of cafeSources) updateSource(s.key, { status: "건너뜀 (네이버 로그인 필요)", error: true });
      log("네이버 로그인이 안 돼 있어 카페 수집을 건너뜁니다", "err");
      return;
    }
    await naver.start();
    // 매일 같은 순서로 열지 않도록 카페 순서를 섞는다
    const order = shuffle(cafeSources);
    try {
      for (let i = 0; i < order.length; i++) {
        const src = order[i];
        updateSource(src.key, { status: "글 목록 읽는 중" });
        try {
          const posts = await naver.listCafe(src.cafe, range);
          log(`${src.name}: 기간 내 글 ${posts.length}개`);
          await processSource(src, posts, (post) => naver.readArticle(post), ctx);
        } catch (e) {
          if (e instanceof StopError || e instanceof BlockedError) throw e;
          updateSource(src.key, { status: `실패: ${e.message}`, error: true });
          log(`${src.name} 실패: ${e.message}`, "err");
        }
        if (i < order.length - 1) {
          await naver.wait(delays.cafeGap);
          if ((i + 1) % delays.restEvery === 0) {
            log("잠깐 쉬는 중 (네이버 계정 보호)");
            await naver.wait(delays.rest);
          }
        }
      }
    } catch (e) {
      if (e instanceof BlockedError) {
        log(`⚠ ${e.message}`, "err");
        for (const s of cafeSources) {
          const st = sourceRows.get(s.key).children[5].textContent;
          if (!/^완료|^실패/.test(st)) updateSource(s.key, { status: "건너뜀 (네이버 수집 중단)", error: true });
        }
        state.naverBlocked = e.message;
      } else if (!(e instanceof StopError)) {
        throw e;
      }
    } finally {
      await naver.finish();
    }
  };

  const communityTask = async () => {
    for (const src of commSources) {
      if (state.stopRequested) return;
      updateSource(src.key, { status: "글 목록 읽는 중" });
      try {
        const posts = await community.list(src.site, range);
        log(`${src.name}: 기간 내 글 ${posts.length}개`);
        await processSource(src, posts, (post) => community.readArticle(src.site, post), ctx);
      } catch (e) {
        if (e instanceof StopError) return;
        updateSource(src.key, { status: `실패: ${e.message}`, error: true });
        log(`${src.name} 실패: ${e.message}`, "err");
      }
    }
  };

  state.naverBlocked = null;
  const results = await Promise.allSettled([naverTask(), communityTask()]);
  for (const r of results) if (r.status === "rejected") log(`오류: ${r.reason && r.reason.message}`, "err");

  for (const [key, tr] of sourceRows) {
    const st = tr.children[5].textContent;
    if (!/^완료|^실패|^건너뜀/.test(st)) updateSource(key, { status: state.stopRequested ? "중지됨" : st });
  }

  sortRows();
  renderResults();
  await saveLastResult();
  state.costUsd = ai ? ai.costUsd() : 0;
  const mins = Math.round((Date.now() - startedAt) / 60000);
  const costText = ai ? ` · AI 비용 약 $${state.costUsd.toFixed(2)} (입력 ${ai.usage.input + ai.usage.cacheRead + ai.usage.cacheWrite} / 출력 ${ai.usage.output} 토큰)` : "";
  const msg = `${state.stopRequested ? "중지됨" : "완료"}: 부정 이슈 ${state.rows.length}건 · ${mins}분${costText}${state.naverBlocked ? ` · ⚠ ${state.naverBlocked}` : ""}`;
  setSummary(msg);
  log(msg);
  await chrome.storage.local.set({
    lastRun: { at: Date.now(), count: state.rows.length, costUsd: state.costUsd, blocked: state.naverBlocked, stopped: state.stopRequested },
  });

  state.running = false;
  $("#start").disabled = false;
  $("#stop").disabled = true;
  $("#download").disabled = false;

  if (AUTO) {
    if (!state.stopRequested) await chrome.storage.local.set({ lastAutoRangeEnd: range.end.getTime() });
    try {
      await downloadReport();
      log("엑셀을 다운로드 폴더에 저장했습니다");
    } catch (e) {
      log(`엑셀 저장 실패: ${e.message}`, "err");
    }
    chrome.runtime.sendMessage({ type: "autoRunDone", count: state.rows.length, blocked: state.naverBlocked }).catch(() => {});
  }
}

$("#start").addEventListener("click", () => {
  const { cafes } = pickedSources();
  if (cafes.length > 25 && !AUTO) {
    // 전체 수집은 시간이 오래 걸린다는 안내만
    log(`카페 ${cafes.length}곳 수집은 30~60분 정도 걸립니다. 이 탭을 닫지 마세요.`);
  }
  runCollection().catch((e) => {
    log(`오류: ${e.message}`, "err");
    state.running = false;
    $("#start").disabled = false;
    $("#stop").disabled = true;
  });
});
$("#stop").addEventListener("click", () => {
  state.stopRequested = true;
  $("#stop").disabled = true;
  setSummary("중지하는 중… (지금까지 모은 결과로 정리합니다)");
});

window.addEventListener("beforeunload", (e) => {
  if (state.running) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------------------
// 설정 화면
// ---------------------------------------------------------------------------

function textInput(obj, key, placeholder = "") {
  return el("input", { type: "text", value: obj[key] || "", placeholder, oninput: (e) => (obj[key] = e.target.value.trim()) });
}

function delButton(list, i, rerender) {
  return el("button", {
    class: "del",
    text: "삭제",
    onclick: () => {
      list.splice(i, 1);
      rerender();
    },
  });
}

let draft = null; // 저장 전 설정

function renderSettings() {
  const s = draft;
  $("#apiKey").value = s.apiKey || "";
  const sel = $("#model");
  sel.textContent = "";
  for (const m of MODELS) sel.append(el("option", { value: m.id, text: `${m.label} — 100만 토큰당 입력 $${m.price[0]} / 출력 $${m.price[1]}`, selected: m.id === s.model }));
  $("#autoRun").checked = !!s.autoRun;
  $("#autoRunTime").value = s.autoRunTime || "06:00";
  $("#speed").value = s.speed || "normal";
  $("#carCodes").value = s.carCodes || "";
  $("#keywords").value = s.keywords || "";
  renderCafeTable();
  renderCommunityTable();
  renderHighlightTable();
}

function renderCafeTable() {
  const tbody = $("#cafeTable tbody");
  tbody.textContent = "";
  draft.cafes.forEach((c, i) => {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, el("input", { type: "checkbox", checked: c.on !== false, onchange: (e) => (c.on = e.target.checked) })),
        el("td", {}, textInput(c, "name", "예: 팰리세이드 피플")),
        el("td", {}, textInput(c, "id", "예: allumpc")),
        el("td", {}, textInput(c, "car", "예: LX3 (여러 차종이면 비움)")),
        el("td", {}, delButton(draft.cafes, i, renderCafeTable))
      )
    );
  });
}

function renderCommunityTable() {
  const tbody = $("#communityTable tbody");
  tbody.textContent = "";
  draft.communities.forEach((c, i) => {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, el("input", { type: "checkbox", checked: c.on !== false, onchange: (e) => (c.on = e.target.checked) })),
        el("td", {}, textInput(c, "name", "예: 보배드림")),
        el("td", {}, textInput(c, "url", "https://…")),
        el("td", {}, delButton(draft.communities, i, renderCommunityTable))
      )
    );
  });
}

function renderHighlightTable() {
  const tbody = $("#highlightTable tbody");
  tbody.textContent = "";
  draft.highlights.forEach((h, i) => {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, textInput(h, "car", "예: LX3")),
        el("td", {}, textInput(h, "topic", "예: 전동 시트 관련 불만")),
        el("td", {}, delButton(draft.highlights, i, renderHighlightTable))
      )
    );
  });
}

$("#addCafe").addEventListener("click", () => {
  draft.cafes.push({ name: "", id: "", car: "", on: true });
  renderCafeTable();
});
$("#addCommunity").addEventListener("click", () => {
  draft.communities.push({ name: "", url: "", on: true });
  renderCommunityTable();
});
$("#addHighlight").addEventListener("click", () => {
  draft.highlights.push({ car: "", topic: "" });
  renderHighlightTable();
});

function readSettingsForm() {
  draft.apiKey = $("#apiKey").value.trim();
  draft.model = $("#model").value;
  draft.autoRun = $("#autoRun").checked;
  draft.autoRunTime = $("#autoRunTime").value || "06:00";
  draft.speed = $("#speed").value;
  draft.carCodes = $("#carCodes").value;
  draft.keywords = $("#keywords").value;
  // 카페 ID 에 주소 전체를 붙여넣은 경우 ID 만 남긴다
  for (const c of draft.cafes) {
    const m = String(c.id || "").match(/cafe\.naver\.com\/([A-Za-z0-9_\-]+)/);
    if (m) c.id = m[1];
  }
  draft.cafes = draft.cafes.filter((c) => c.id || c.name);
  draft.communities = draft.communities.filter((c) => c.url || c.name);
  draft.highlights = draft.highlights.filter((h) => h.car || h.topic);
}

async function ensureHostPermissions(communities) {
  const known = /(^|\.)(bobaedream\.co\.kr|clien\.net|ppomppu\.co\.kr)$/;
  const origins = [];
  for (const c of communities) {
    try {
      const u = new URL(c.url);
      if (!known.test(u.hostname)) origins.push(`${u.protocol}//${u.hostname}/*`);
    } catch {
      throw new Error(`커뮤니티 주소가 올바르지 않습니다: ${c.url}`);
    }
  }
  if (origins.length) {
    const ok = await chrome.permissions.request({ origins });
    if (!ok) throw new Error("새 커뮤니티 사이트 접근 권한을 허용해야 수집할 수 있습니다");
  }
}

$("#saveSettings").addEventListener("click", async () => {
  try {
    readSettingsForm();
    await ensureHostPermissions(draft.communities.filter((c) => c.on !== false));
    await saveSettings(draft);
    state.settings = structuredClone(draft);
    setIssueKeywords(state.settings.keywords);
    renderSettings();
    renderPickList();
    updateAiInfo();
    updateAutoInfo();
    $("#saveResult").textContent = "저장했습니다 ✓";
    $("#saveResult").className = "hint ok";
  } catch (e) {
    $("#saveResult").textContent = e.message;
    $("#saveResult").className = "hint err";
  }
});

$("#resetSettings").addEventListener("click", () => {
  if (!confirm("카페·커뮤니티 목록, 키워드, 코드표, 노란색 항목을 처음 기본값으로 되돌릴까요? (API 키는 유지)")) return;
  const key = $("#apiKey").value.trim();
  draft = structuredClone(DEFAULT_SETTINGS);
  draft.apiKey = key;
  renderSettings();
  $("#saveResult").textContent = "기본값을 불러왔습니다. '설정 저장'을 눌러야 적용됩니다.";
  $("#saveResult").className = "hint";
});

$("#testKey").addEventListener("click", async () => {
  const out = $("#keyResult");
  out.textContent = "확인 중…";
  out.className = "hint";
  try {
    const key = $("#apiKey").value.trim();
    if (!key) throw new Error("API 키를 넣어 주세요");
    await new AiClassifier({ ...draft, apiKey: key, model: $("#model").value }, () => {}).ping();
    out.textContent = "정상입니다 ✓ ('설정 저장'을 눌러 주세요)";
    out.className = "hint ok";
  } catch (e) {
    let msg = e.message;
    if (e instanceof Anthropic.AuthenticationError) msg = "키가 올바르지 않습니다";
    else if (e instanceof Anthropic.PermissionDeniedError) msg = "이 키로는 사용할 수 없습니다 (권한 확인)";
    else if (e instanceof Anthropic.RateLimitError) msg = "요청 한도 초과 — 잠시 후 다시 시도";
    else if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) msg = "크레딧이 부족합니다 (Billing 에서 충전)";
    out.textContent = `실패: ${msg}`;
    out.className = "hint err";
  }
});

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

(async function init() {
  state.settings = await loadSettings();
  setIssueKeywords(state.settings.keywords);
  draft = structuredClone(state.settings);
  renderSettings();
  renderPickList();
  updateAiInfo();
  updateAutoInfo();
  const r = defaultRange();
  setRange(r.start, r.end);
  await checkLogin();
  if (AUTO) {
    const end = new Date();
    end.setSeconds(0, 0);
    const { lastAutoRangeEnd } = await chrome.storage.local.get("lastAutoRangeEnd");
    const prev = lastAutoRangeEnd ? new Date(lastAutoRangeEnd) : null;
    // 지난 자동 수집이 끝난 시각부터 이어서 (사흘 넘게 비었으면 최근 24시간)
    const start = prev && end - prev < 3 * 86400000 && prev < end ? prev : new Date(end.getTime() - 86400000);
    setRange(start, end);
    log(`자동 수집을 시작합니다 (${fmtDateTime(start)} ~ ${fmtDateTime(end)}: 지난 자동 수집에 이어서)`);
    await sleep(3000);
    $("#start").click();
  } else {
    await loadLastResult();
  }
})();
