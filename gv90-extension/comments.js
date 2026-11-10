// GV90 댓글 수집 화면
//  데일리 DB 에 저장한 게시글 중 고른 글의 댓글을 채널별로 모은다 (이슈 모니터링 보고서와 같은 수집 모듈)
//   · 언론: 네이버 뉴스 댓글 상자(답글 포함) · 언론사 자체 사이트 기사는 네이버 댓글이 없어 건너뜀
//   · 동호회: 카페 글을 사람처럼 천천히 열어 읽음 (안 보이면 네이버 검색 경유 · 그래도 안 보이면 패스)
//   · 유튜브: 댓글·답글
//   · 자동차 커뮤니티: 받아 온 화면 → 모자라면 뒤쪽 탭으로 열어 '더보기'까지 · 뽐뿌는 댓글 목록(comment.php) 전체읽기
//  댓글 성향은 무료 분석(단어 사전)이 기본, 필요하면 Claude AI 로 추가 분석. 데일리 DB 에 바로 저장.

let settings = null;
let posts = []; // 화면에 보이는 게시글 (DB 게시물 + checked)
let comments = []; // 화면에 보이는 게시글들의 댓글 (DB)
let running = false;
let stopRequested = false;
let pendingXlsx = null;
let heartbeat = null;
isWorking = () => running;

function log(text, cls = "") {
  const box = $("#log");
  box.hidden = false;
  box.append(el("div", { class: cls, text: `${fmtDateTime(new Date()).slice(11)} ${korMsg(text)}` }));
  box.scrollTop = box.scrollHeight;
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

function markRunning(on) {
  clearInterval(heartbeat);
  if (on) {
    const beat = () => chrome.storage.local.set({ gvRunHeartbeat: { at: Date.now() } }).catch(() => {});
    beat();
    heartbeat = setInterval(beat, 30000);
  } else chrome.storage.local.remove("gvRunHeartbeat").catch(() => {});
}

async function checkLogin() {
  let ok = false;
  try {
    ok = !!(await chrome.cookies.get({ url: "https://www.naver.com/", name: "NID_AUT" }));
  } catch {}
  const box = $("#login");
  box.textContent = "";
  if (ok) box.append(el("span", { class: "hint ok", text: "✔ 네이버 로그인됨" }));
  else box.append("⚠ 네이버에 로그인돼 있지 않습니다. 카페 댓글 수집 전에 ", el("a", { href: "https://nid.naver.com/nidlogin.login", target: "_blank", text: "네이버 로그인" }), " 해 주세요.");
  return ok;
}

// ---------------------------------------------------------------------------
// 게시글 목록
// ---------------------------------------------------------------------------

async function loadPosts() {
  const n = +$("#scope").value;
  const days = (await listDays()).map((d) => d.day); // 최신순
  const pick = new Set(n ? days.slice(0, n) : days);
  const ch = $("#chFilter").value;
  const only = $("#onlyWithComments").checked;
  const prev = new Map(posts.map((p) => [p.key, p.checked]));
  posts = (await allPosts())
    .filter((p) => pick.has(p.day) && (!ch || p.channel === ch) && (!only || p.ccount == null || p.ccount > 0 || p.commentStatus?.n > 0))
    .sort((a, b) => b.day.localeCompare(a.day) || CH_ORDER_C.indexOf(a.channel) - CH_ORDER_C.indexOf(b.channel) || (a.date || 0) - (b.date || 0))
    .map((p) => ({ ...p, checked: prev.has(p.key) ? prev.get(p.key) : canCollect(p) && !p.commentStatus?.ok }));
  const keys = new Set(posts.map((p) => p.key));
  comments = (await allComments()).filter((c) => keys.has(c.postKey));
  renderPosts();
  renderComments();
}

const CH_ORDER_C = ["언론", "유튜브", "동호회", "자동차 커뮤니티"];

// 이 글의 댓글을 읽을 수 있는지 (언론사 자체 사이트 기사는 네이버 댓글이 없음)
function canCollect(p) {
  if (p.channel === "언론") return !!newsIds(p.url);
  return true;
}

function statusText(p) {
  const st = p.commentStatus;
  if (!canCollect(p)) return el("span", { class: "hint", text: "언론사 사이트 기사 (네이버 댓글 없음)" });
  if (!st) return el("span", { class: "hint", text: "수집 전" });
  if (!st.ok) return el("span", { class: "hint err", text: `✖ ${st.msg || "실패"}`, title: fmtDateTime(st.at) });
  return el("span", { class: "hint ok", text: `✔ ${st.n}개${st.how ? ` · ${st.how}` : ""}`, title: `${fmtDateTime(st.at)} 수집` });
}

function miniSenti(list) {
  if (!list.length) return null;
  const n = list.length;
  const box = el("div", { style: "display:flex;gap:2px;height:9px;width:120px;border-radius:3px;overflow:hidden", title: SENTIMENTS.map((s) => `${s} ${list.filter((c) => c.sentiment === s).length}`).join(" · ") });
  const color = { 긍정: "var(--pos)", 중립: "var(--neu)", 부정: "var(--neg)", 단순비난: "var(--blame)" };
  for (const s of SENTIMENTS) {
    const k = list.filter((c) => c.sentiment === s).length;
    if (k) box.append(el("div", { style: `flex:${k};background:${color[s]}` }));
  }
  const bad = list.filter((c) => c.sentiment === "부정" || c.sentiment === "단순비난").length;
  return el("div", {}, box, el("div", { class: "hint", text: `부정+단순비난 ${Math.round((bad / n) * 100)}%` }));
}

function renderPosts() {
  const tb = $("#postTable tbody");
  tb.textContent = "";
  for (const p of posts) {
    const mine = comments.filter((c) => c.postKey === p.key);
    const cb = el("input", { type: "checkbox", checked: p.checked, disabled: !canCollect(p), onchange: (e) => { p.checked = e.target.checked; updatePostCount(); } });
    tb.append(
      el("tr", { class: p.checked ? "" : "off" },
        el("td", {}, cb),
        el("td", { class: "nowrap", text: prettyDay(p.day).slice(5) }),
        el("td", {}, chChip(p.channel)),
        el("td", { class: "nowrap", text: p.media }),
        el("td", { class: "url" }, countsBadge(p), el("a", { href: p.url, target: "_blank", text: p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 44) })),
        el("td", { text: p.summary || p.title }),
        el("td", { class: "nowrap" }, statusText(p)),
        el("td", {}, miniSenti(mine)),
      ),
    );
  }
  updatePostCount();
  const sel = $("#postFilter");
  const cur = sel.value;
  sel.textContent = "";
  sel.add(new Option("전체", ""));
  for (const p of posts) if (comments.some((c) => c.postKey === p.key)) sel.add(new Option(`[${p.media}] ${(p.summary || p.title).slice(0, 40)}`, p.key));
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
}

// 댓글 수집 예상 시간(초): 채널별 글 하나에 걸리는 시간 (카페는 사람 속도로 천천히) + 댓글 많은 글은 조금 더
function estimateCommentsSec(list) {
  const d = DELAYS[settings?.speed] || DELAYS.normal;
  const avg = (r) => (r[0] + r[1]) / 2000;
  const per = { 동호회: 10 + avg(d.article), 언론: 2 + avg(d.news), 유튜브: 4, "자동차 커뮤니티": 3 + avg(d.community) };
  return list.reduce((t, p) => t + (per[p.channel] || 5) + Math.min(60, (p.ccount || 0) / 40), 0);
}

function updatePostCount() {
  const c = posts.filter((p) => p.checked);
  $("#postCount").textContent = `게시글 ${posts.length}건 · 체크 ${c.length}건 (${CH_ORDER_C.map((ch) => `${ch} ${c.filter((p) => p.channel === ch).length}`).join(" · ")}) · 예상 댓글 약 ${c.reduce((s, p) => s + (p.ccount || 0), 0).toLocaleString()}개${c.length ? ` · ⏱ 예상 소요 시간 ${fmtDur(estimateCommentsSec(c))}` : ""}`;
  $("#start").disabled = running || !c.length;
}

// ---------------------------------------------------------------------------
// 댓글 수집
// ---------------------------------------------------------------------------

// DB 게시물 → 채널 수집기가 쓰는 모양
function cafePost(p) {
  const u = p.url || "";
  const fe = u.match(/cafes\/(\d+)\/articles\/(\d+)/);
  const sm = u.match(/cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/);
  const slug = p.src?.cafeSlug || (sm && !/^(f-e|ca-fe)$/.test(sm[1]) ? sm[1] : "");
  const articleId = p.src?.articleId || (fe ? fe[2] : sm ? sm[2] : "");
  const clubId = p.src?.clubId || (fe ? fe[1] : "");
  const cafe = settings.cafes.find((c) => c.slug === slug) || { name: p.media, slug, viaSearch: false };
  return { post: { key: p.key, url: u, title: p.title || "", cafeSlug: slug, clubId, articleId }, cafe };
}

async function collectOne(p, tools) {
  const { nc, cc, yc, mc, delays } = tools;
  if (p.channel === "언론") {
    const ids = newsIds(p.url);
    if (!ids) return { list: [], how: "언론사 사이트 기사" };
    const list = await nc.readComments({ ...ids, url: p.url }, (n) => showWork(`언론 댓글 읽는 중 · ${n}개`, 0, 0));
    await sleep(randomBetween(delays.news));
    return { list, how: "네이버 뉴스 댓글" };
  }
  if (p.channel === "유튜브") {
    const id = p.src?.videoId || parseYoutubeId(p.url) || String(p.key).replace(/^yt:/, "");
    const r = await yc.readComments(id, (n) => showWork(`유튜브 댓글 읽는 중 · ${n}개`, 0, 0));
    return { list: r.comments || [], how: "유튜브 댓글" };
  }
  if (p.channel === "동호회") {
    const { post, cafe } = cafePost(p);
    await cc.wait(delays.article);
    const a = await cc.readArticle(post, cafe);
    return { list: a.comments, how: a.via === "검색" ? "네이버 검색 경유" : "카페 화면", views: a.views, ccount: a.ccount };
  }
  // 자동차 커뮤니티 (뽐뿌는 댓글 목록 전체읽기)
  const a = await mc.readArticle({ key: p.key, url: p.url, siteUrl: p.src?.siteUrl || p.url, title: p.title || "", ccount: p.ccount || 0 });
  await mc.wait(delays.community);
  return { list: a.comments, how: a.how || "", views: a.views, ccount: a.ccount };
}

async function collect() {
  if (running) return;
  settings = await loadSettings();
  setExtraLexicon(settings.lexicon);
  const targets = posts.filter((p) => p.checked && canCollect(p));
  if (!targets.length) return;
  if (targets.some((p) => p.channel === "동호회")) await checkLogin();
  const cafeN = targets.filter((p) => p.channel === "동호회").length;
  if (cafeN > 30 && !confirm(`카페 글 ${cafeN}개의 댓글을 읽습니다 (글 하나에 10~20초 · 약 ${Math.ceil((cafeN * 15) / 60)}분).\n네이버 계정 보호를 위해 가능하면 나눠서 수집하세요. 계속할까요?`)) return;
  running = true;
  stopRequested = false;
  markRunning(true);
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#log").textContent = "";
  readyButton($("#getXlsx"), false);
  const isStopped = () => stopRequested;
  const delays = DELAYS[settings.speed] || DELAYS.normal;
  const tools = {
    delays,
    nc: new NewsCollector({ delays, log, isStopped, replies: $("#newsReplies").checked }),
    cc: new CafeCollector({ delays, log, isStopped }),
    yc: new YoutubeCollector({ log, isStopped }),
    mc: new CommunityCollector({ delays, log, isStopped, ai: null }),
  };
  const day = todayKey();
  let total = 0;
  let failed = 0;
  const planSec = estimateCommentsSec(targets);
  startWorkClock(planSec);
  log(`댓글 수집 시작: 게시글 ${targets.length}건 · 예상 소요 시간 ${fmtDur(planSec)} (진행하면서 위쪽 막대에 남은 시간이 보입니다)`);
  for (let i = 0; i < targets.length && !stopRequested; i++) {
    const p = targets[i];
    showWork(`댓글 수집 ${i + 1}/${targets.length} · ${p.channel} · ${p.media}`, i, targets.length);
    try {
      const r = await collectOne(p, tools);
      const list = r.list
        .filter((c) => c && String(c.text || "").trim())
        .map((c) => ({
          text: String(c.text).replace(/\s+/g, " ").trim(),
          writtenAt: c.writtenAt || "",
          date: c.date || null,
          isReply: !!c.isReply,
          author: c.author || "",
          url: p.url,
          channel: p.channel,
          media: p.media,
          car: p.car || CAR_NAME,
          category: p.category || "",
          postTitle: p.title || p.summary || "",
          sentiment: ruleSentiment(c.text),
          by: "rule",
        }));
      const res = await replacePostComments(p.key, list, day);
      const st = { at: Date.now(), ok: true, n: res.total, how: r.how || "" };
      // 댓글 수: 이번에 글 화면에서 다시 읽은 수가 있으면 그것으로 (예전에 잘못 읽은 수를 남기지 않게), 없으면 모은 개수와 저장된 수 중 큰 쪽
      const patch = { commentStatus: st, ccount: r.ccount != null ? Math.max(res.total, r.ccount) : Math.max(res.total, p.ccount || 0) };
      if (r.views != null) patch.views = r.views;
      await updatePost(p.key, patch);
      Object.assign(p, patch);
      p.checked = false;
      total += res.total;
      log(`· ${p.channel} ${p.media}: 댓글 ${res.total}개 (새 댓글 ${res.added}개${r.how ? ` · ${r.how}` : ""})`);
    } catch (e) {
      if (e instanceof StopError) break;
      failed++;
      const st = { at: Date.now(), ok: false, n: 0, msg: korMsg(e.message).slice(0, 80) };
      await updatePost(p.key, { commentStatus: st });
      p.commentStatus = st;
      log(`✖ ${p.channel} ${p.media} ${p.url}: ${korMsg(e.message)}`, "err");
      if (/로그인|보호조치/.test(e.message)) {
        log("네이버 로그인·보호조치 문제로 카페 댓글 수집을 멈춥니다. 다른 채널은 계속합니다.", "err");
        for (const q of targets.slice(i + 1)) if (q.channel === "동호회") q.checked = false;
        targets.splice(i + 1, targets.length, ...targets.slice(i + 1).filter((q) => q.channel !== "동호회"));
      }
    }
  }
  await refreshDay(day, { keepEmpty: true });
  hideWork();
  running = false;
  markRunning(false);
  $("#stop").disabled = true;
  await loadPosts();
  setSummary(`${stopRequested ? "중지됨 — " : ""}댓글 ${total.toLocaleString()}개를 모아 데일리 DB 에 저장했습니다${failed ? ` · 못 읽은 글 ${failed}건 ('수집 전·0개·실패 글만 선택' → 다시 수집)` : ""}. 성향은 무료 분석으로 채웠습니다.`, failed ? "err" : "ok");
  if (!stopRequested) celebrate(null);
}

// ---------------------------------------------------------------------------
// 댓글 표 · 성향
// ---------------------------------------------------------------------------

function visibleComments() {
  const pk = $("#postFilter").value;
  const sf = $("#sentFilter").value;
  return comments.filter((c) => (!pk || c.postKey === pk) && (!sf || c.sentiment === sf));
}

function renderComments() {
  $("#commentBox").hidden = !comments.length;
  const tb = $("#commentTable tbody");
  tb.textContent = "";
  const list = visibleComments();
  const postOf = new Map(posts.map((p) => [p.key, p]));
  for (const c of list.slice(0, 2000)) {
    const sen = el("select", { class: `senti ${SENTI_CLASS[c.sentiment] || "neu"}`, onchange: async (e) => {
      c.sentiment = e.target.value;
      c.edited = [...new Set([...(c.edited || []), "sentiment"])];
      c.by = "edit";
      sen.className = `senti ${SENTI_CLASS[c.sentiment]}`;
      await updateComment(c.key, { sentiment: c.sentiment, edited: c.edited, by: c.by });
      updateCommentCount();
    } });
    for (const v of SENTIMENTS) sen.add(new Option(v, v));
    sen.value = c.sentiment || "중립";
    const p = postOf.get(c.postKey);
    tb.append(
      el("tr", {},
        el("td", {}, chChip(c.channel)),
        el("td", { class: "nowrap", text: c.media }),
        el("td", {}, el("a", { href: c.url, target: "_blank", text: (p?.summary || p?.title || c.postTitle || "").slice(0, 30) })),
        el("td", { class: "nowrap hint", text: c.writtenAt || (c.date ? fmtDateTime(c.date) : "") }),
        el("td", {}, c.isReply ? el("span", { class: "hint", text: "↳ " }) : null, c.text, c.by === "ai" ? el("span", { class: "badge ai", text: " AI" }) : null),
        el("td", {}, sen),
      ),
    );
  }
  if (list.length > 2000) tb.append(el("tr", {}, el("td", { colspan: 6, class: "hint", text: `… 2,000개까지만 보입니다 (전체 ${list.length.toLocaleString()}개는 엑셀에)` })));
  updateCommentCount();
}

function updateCommentCount() {
  const n = comments.length;
  const cnt = (s) => comments.filter((c) => c.sentiment === s).length;
  const txt = SENTIMENTS.map((s) => `${s} ${n ? ((cnt(s) / n) * 100).toFixed(1) : 0}%`).join(" · ");
  $("#commentSummary").textContent = `(댓글 ${n.toLocaleString()}개 · ${txt})`;
  $("#commentCount").textContent = `표에 보이는 댓글 ${visibleComments().length.toLocaleString()}개`;
}

async function reanalyzeRule() {
  settings = await loadSettings();
  setExtraLexicon(settings.lexicon);
  const changed = [];
  for (const c of comments) {
    if ((c.edited || []).includes("sentiment")) continue;
    const s = ruleSentiment(c.text);
    if (s !== c.sentiment || c.by !== "rule") {
      c.sentiment = s;
      c.by = "rule";
      changed.push(c);
    }
  }
  await putComments(changed);
  renderComments();
  setSummary(`무료 분석으로 다시 정했습니다 (바뀐 댓글 ${changed.length}개 · 직접 고친 성향은 그대로).`, "ok");
}

async function analyzeAi() {
  settings = await loadSettings();
  if (!settings.apiKey) return setSummary("⚙ 설정의 'Claude AI 판독'에 API 키를 넣어 주세요.", "err");
  const list = visibleComments().filter((c) => !(c.edited || []).includes("sentiment"));
  if (!list.length) return;
  const items = list.map((c) => ({ ...c, body: c.text, title: "" }));
  const est = aiEstimate(items, settings.model);
  if (!confirm(`표에 보이는 댓글 ${list.length.toLocaleString()}개의 성향을 Claude AI 로 다시 정합니다 (원글 제목 참고).\n예상 비용 ${fmtWon(est)} · 예상 소요 시간 ${fmtDur(Math.ceil(list.length / AI_BATCH / AI_PARALLEL) * 30)} · ${AI_MODELS.find(([id]) => id === settings.model)?.[1] || settings.model}\n\n계속할까요?`)) return;
  running = true;
  stopRequested = false;
  $("#analyzeAi").disabled = true;
  startWorkClock(Math.ceil(items.length / AI_BATCH / AI_PARALLEL) * 30);
  const byKey = new Map(list.map((c) => [c.key, c]));
  const res = await aiAnalyze(items, {
    apiKey: settings.apiKey,
    model: settings.model,
    kind: "comment",
    isStopped: () => stopRequested,
    onProgress: (d, t) => showWork(`AI 댓글 성향 분석 중 (${d}/${t}묶음)`, d, t),
    onResult: (x, r) => {
      const c = byKey.get(x.key);
      c.sentiment = r.sentiment;
      c.by = "ai";
    },
  });
  await putComments(list);
  hideWork();
  running = false;
  $("#analyzeAi").disabled = false;
  renderComments();
  renderPosts();
  setSummary(res.fatal ? `AI 분석 실패: ${res.fatal} (무료 분석 결과로 둡니다)` : `AI 댓글 성향 분석 완료 · 비용 ${fmtWon(res.usage.won)}${res.failed ? ` · 실패 ${res.failed}개(무료 분석 결과)` : ""}`, res.fatal ? "err" : "ok");
  if (!res.fatal) celebrate(null);
}

async function makeXlsx() {
  const s = await loadSettings();
  const name = reportFileName({ ...s, fileName: String(s.fileName || "").replace(/raw data/i, "").trim() + " 댓글 raw data" }, new Date());
  const allPostList = await allPosts();
  const bytes = Gv90Xlsx.buildComments({ comments, posts: allPostList });
  pendingXlsx = { bytes, name };
  try {
    const where = await saveFile(bytes, name);
    $("#saveInfo").textContent = `✔ 댓글 ${comments.length.toLocaleString()}개를 ${where} 바로 저장했습니다.`;
    $("#saveInfo").className = "hint ok";
  } catch (e) {
    $("#saveInfo").textContent = `엑셀은 만들었지만 저장하지 못했습니다 (${e.message}) → '📥 댓글 엑셀 받기'를 눌러 주세요`;
    $("#saveInfo").className = "hint err";
  }
  readyButton($("#getXlsx"), true);
  celebrate($("#getXlsx"));
}

// ---------------------------------------------------------------------------

$("#scope").addEventListener("change", loadPosts);
$("#chFilter").addEventListener("change", loadPosts);
$("#onlyWithComments").addEventListener("change", loadPosts);
$("#selAll").addEventListener("click", () => { posts.forEach((p) => (p.checked = canCollect(p))); renderPosts(); });
$("#selNone").addEventListener("click", () => { posts.forEach((p) => (p.checked = false)); renderPosts(); });
$("#checkAll").addEventListener("change", (e) => { posts.forEach((p) => (p.checked = e.target.checked && canCollect(p))); renderPosts(); });
$("#selRetry").addEventListener("click", () => { posts.forEach((p) => (p.checked = canCollect(p) && (!p.commentStatus || !p.commentStatus.ok || !p.commentStatus.n))); renderPosts(); });
$("#start").addEventListener("click", () => collect().catch((e) => {
  log(`오류: ${e.message}`, "err");
  running = false;
  markRunning(false);
  hideWork();
  $("#start").disabled = false;
  $("#stop").disabled = true;
}));
$("#stop").addEventListener("click", () => {
  stopRequested = true;
  $("#stop").disabled = true;
  setSummary("중지하는 중… (지금 읽는 글까지 저장합니다)");
});
$("#postFilter").addEventListener("change", renderComments);
$("#sentFilter").addEventListener("change", renderComments);
$("#analyzeRule").addEventListener("click", reanalyzeRule);
$("#analyzeAi").addEventListener("click", () => analyzeAi().catch((e) => { running = false; hideWork(); $("#analyzeAi").disabled = false; setSummary(`AI 분석 오류: ${e.message}`, "err"); }));
$("#makeXlsx").addEventListener("click", makeXlsx);
$("#getXlsx").addEventListener("click", async () => {
  if (!pendingXlsx) return;
  readyButton($("#getXlsx"), false);
  const where = await saveFile(pendingXlsx.bytes, pendingXlsx.name);
  $("#saveInfo").textContent = `✔ ${where} 저장했습니다.`;
  Celebrate.done($("#getXlsx"));
});

async function init() {
  settings = await loadSettings();
  setExtraLexicon(settings.lexicon);
  await checkLogin();
  await loadPosts();
  if (!posts.length) setSummary("데일리 DB 에 게시글이 없습니다. '1 게시물 수집'에서 엑셀 만들기(데일리 DB 저장)를 먼저 하세요.");
}
const commentsInit = init();
