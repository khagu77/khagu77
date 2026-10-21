// 이슈 모니터링 보고서 작성 — 화면
// 1 목적·채널·키워드 → 2 게시글 수집(AI 관련성 판독) → 3 댓글 수집 → 4 성향 분석(AI) → 5 보고서(PPT)·최종 DB

const CH_NAME = { news: "언론", cafe: "동호회", youtube: "유튜브", community: "커뮤니티" };
const CH_ORDER = ["news", "cafe", "youtube", "community"];
const CH_DOMAIN = { news: "n.news.naver.com", cafe: "cafe.naver.com", youtube: "youtube.com" };
const PAGE_SIZE = 200;

let settings = null;
let job = null; // 작업 중인 보고서
let running = false;
let stopRequested = false;
const view = { postsFilter: "all", cmtChannel: "all", cmtSenti: "all", cmtPage: 0 };

// ---------------------------------------------------------------------------
// 작업(보고서) 상태
// ---------------------------------------------------------------------------

function newJob() {
  const to = new Date();
  to.setMinutes(0, 0, 0);
  const from = new Date(to.getTime() - 24 * 3600e3);
  return {
    id: `job_${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    purpose: "",
    issueName: "",
    keywords: "",
    from: from.getTime(),
    to: to.getTime(),
    channels: { news: true, cafe: true, youtube: true, community: true },
    newsAuto: true,
    cafes: [],
    youtube: settings.youtubeChannels.map((c) => c.id), // 모니터링 유튜브 채널 전체 선택
    communities: (settings.communities || []).filter((c) => c.on !== false).map((c) => c.url),
    urls: { news: "", cafe: "", youtube: "", community: "" },
    posts: [],
    comments: [],
    commentStatus: {},
    report: null,
    files: {},
    final: null,
    usd: 0,
  };
}

async function saveJob() {
  if (!job) return;
  await DB.putJob(job);
  await chrome.storage.local.set({ imrCurrentJob: job.id }).catch(() => {});
  renderJobBar();
}

function renderJobBar() {
  $("#jobTitle").textContent = job.issueName || "(새 보고서)";
  const parts = [];
  if (job.posts.length) parts.push(`게시글 ${job.posts.filter((p) => p.checked).length}/${job.posts.length}`);
  if (job.comments.length) parts.push(`댓글 ${numFmt(job.comments.length)}`);
  const done = job.comments.filter((c) => c.sentiment).length;
  if (done) parts.push(`성향 ${numFmt(done)}`);
  if (job.final) parts.push(`최종 DB 저장됨 ${fmtDateTime(job.final.savedAt)}`);
  $("#jobState").textContent = parts.length ? `· ${parts.join(" · ")}` : "";
  const steps = { posts: job.posts.length > 0, comments: job.comments.length > 0, sentiment: done > 0 && done === job.comments.length, report: !!job.files.pptx };
  for (const [k, v] of Object.entries(steps)) $(`nav .tab.work[data-tab="${k}"]`).classList.toggle("done", v);
}

function jobRange() {
  return { from: new Date(job.from), to: new Date(job.to) };
}

function chName(p) {
  return CH_NAME[p.channel] || p.channel;
}

function fileBase() {
  return `${ymd()}_${(job.issueName || "이슈").replace(/\s+/g, " ").trim()}`;
}

function aiReady() {
  return !!(settings.apiKey && typeof Anthropic !== "undefined");
}

function usdText(usd) {
  return `약 $${usd.toFixed(2)} (${numFmt(Math.round(usd * (Number(settings.usdKrw) || 1400)))}원)`;
}

function addUsage(ai) {
  job.usd = (job.usd || 0) + ai.costUsd();
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------

function showTab(name) {
  for (const s of $$("main > section")) s.hidden = s.id !== `tab-${name}`;
  for (const b of $$("nav .tab")) b.classList.toggle("active", b.dataset.tab === name);
  if (name === "posts") renderPosts();
  if (name === "comments") renderCommentPosts();
  if (name === "sentiment") renderSentiment();
  if (name === "report") renderReport();
  if (name === "db") renderDb();
  if (name === "prompt") renderPrompt();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}

function logTo(id) {
  return (text, cls = "") => {
    const box = $(id);
    const line = el("div", { class: cls, text: `[${new Date().toTimeString().slice(0, 8)}] ${text}` });
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    if (box.parentElement.tagName === "DETAILS" && cls === "err") box.parentElement.open = true;
  };
}

function setMsg(id, text, cls = "") {
  const e = $(id);
  e.textContent = text;
  e.className = `hint ${cls}`;
}

// ---------------------------------------------------------------------------
// 1. 목적·채널·키워드
// ---------------------------------------------------------------------------

function renderSetup() {
  $("#purpose").value = job.purpose;
  $("#issueName").value = job.issueName;
  $("#keywords").value = job.keywords;
  $("#rangeFrom").value = toLocalInput(new Date(job.from));
  $("#rangeTo").value = toLocalInput(new Date(job.to));
  $("#chNews").checked = job.channels.news;
  $("#chCafe").checked = job.channels.cafe;
  $("#chYoutube").checked = job.channels.youtube;
  $("#chCommunity").checked = job.channels.community;
  $("#newsAuto").checked = job.newsAuto !== false;
  $("#newsUrls").value = job.urls.news;
  $("#cafeUrls").value = job.urls.cafe;
  $("#ytUrls").value = job.urls.youtube;
  $("#commUrls").value = job.urls.community;
  renderCafeList();
  renderYtList();
  renderCommList();
  renderQueryPreview();
}

function readSetup() {
  job.purpose = $("#purpose").value.trim();
  job.issueName = $("#issueName").value.trim();
  job.keywords = $("#keywords").value;
  const f = new Date($("#rangeFrom").value);
  const t = new Date($("#rangeTo").value);
  if (!isNaN(f)) job.from = f.getTime();
  if (!isNaN(t)) job.to = t.getTime();
  job.channels = { news: $("#chNews").checked, cafe: $("#chCafe").checked, youtube: $("#chYoutube").checked, community: $("#chCommunity").checked };
  job.newsAuto = $("#newsAuto").checked;
  job.urls = { news: $("#newsUrls").value, cafe: $("#cafeUrls").value, youtube: $("#ytUrls").value, community: $("#commUrls").value };
  job.cafes = $$("#cafeList input[type=checkbox]:checked").map((x) => x.value);
  job.youtube = $$("#ytList input[type=checkbox]:checked").map((x) => x.value);
  job.communities = $$("#commList input[type=checkbox]:checked").map((x) => x.value);
}

function validateSetup() {
  if (!job.issueName) return "이슈명을 넣어 주세요.";
  if (!job.purpose) return "보고서 작성 목적을 넣어 주세요. (AI 가 이 목적에 맞춰 판독·분석·작성합니다)";
  if (!(job.to > job.from)) return "수집 기간의 시작·끝을 확인해 주세요.";
  if (!parseKeywords(job.keywords).groups.length) return "수집 키워드를 넣어 주세요.";
  if (!CH_ORDER.some((c) => job.channels[c])) return "채널을 하나 이상 고르세요.";
  if (job.channels.cafe && !job.cafes.length && !job.urls.cafe.trim()) return "동호회를 하나 이상 체크하거나 동호회 채널을 끄세요.";
  if (job.channels.youtube && !job.youtube.length && !job.urls.youtube.trim()) return "유튜브 채널을 하나 이상 체크하거나(채널 추가) 유튜브 채널을 끄세요.";
  if (job.channels.community && !job.communities.length && !job.urls.community.trim()) return "커뮤니티를 하나 이상 체크하세요.";
  return "";
}

function renderQueryPreview() {
  const kw = parseKeywords($("#keywords").value);
  const qs = searchQueries(kw);
  const cq = cafeQueries(kw);
  const total = totalQueries(kw);
  $("#queryPreview").replaceChildren(
    qs.length
      ? `뉴스 검색어 ${qs.length}개: ${qs.map((q) => `"${q}"`).join(", ")}${kw.exclude.length ? ` · 제외: ${kw.exclude.join(", ")}` : ""} / 동호회 검색어(카페마다): ${cq.map((q) => `"${q}"`).join(", ")} — 조합의 나머지 조건은 AI 판독으로 거릅니다`
      : "",
    total > qs.length
      ? el("div", { class: "err", text: `⚠ 조합을 펼치면 검색어가 ${total}개라 뉴스 검색은 ${qs.length}개만 씁니다(키워드 줄마다 골고루). 빠지는 조합이 걱정되면 줄을 나누거나 | 로 묶은 말을 줄여 주세요.` })
      : "",
  );
}

function renderCafeList() {
  const box = $("#cafeList");
  const filter = compactLower($("#cafeFilter").value);
  const selected = new Set(job.cafes);
  box.innerHTML = "";
  for (const c of settings.cafes) {
    const hay = compactLower(`${c.name} ${c.slug} ${c.car}`);
    const lab = el(
      "label",
      { title: `cafe.naver.com/${c.slug}`, hidden: !!filter && !hay.includes(filter) },
      el("input", { type: "checkbox", value: c.slug, checked: selected.has(c.slug), onchange: updateCafeCount }),
      el("span", { text: c.name }),
      c.car ? el("span", { class: "car", text: c.car }) : null,
      el("button", {
        class: "x",
        title: "목록에서 빼기",
        text: "✕",
        onclick: async (e) => {
          e.preventDefault();
          if (!confirm(`'${c.name}' 동호회를 목록에서 뺄까요?`)) return;
          readSetup();
          settings.cafes = settings.cafes.filter((x) => x !== c);
          await saveSettings(settings);
          renderCafeList();
        },
      }),
    );
    box.appendChild(lab);
  }
  updateCafeCount();
}

function updateCafeCount() {
  const n = $$("#cafeList input:checked").length;
  $("#cafeCount").textContent = `${n} / ${settings.cafes.length}곳 선택`;
}

function renderYtList() {
  const box = $("#ytList");
  const selected = new Set(job.youtube);
  box.innerHTML = "";
  if (!settings.youtubeChannels.length) box.appendChild(el("div", { class: "empty", text: "등록한 채널이 없습니다. 위 칸에 채널 ID(UC…)나 @핸들을 넣고 '채널 추가'를 누르세요." }));
  for (const c of settings.youtubeChannels) {
    box.appendChild(
      el(
        "label",
        { title: c.id },
        el("input", { type: "checkbox", value: c.id, checked: selected.has(c.id), onchange: updateYtCount }),
        el("span", { text: c.name || c.id }),
        el("button", {
          class: "x",
          text: "✕",
          title: "목록에서 빼기",
          onclick: async (e) => {
            e.preventDefault();
            if (!confirm(`'${c.name || c.id}' 채널을 목록에서 뺄까요?`)) return;
            readSetup();
            settings.youtubeChannels = settings.youtubeChannels.filter((x) => x !== c);
            await saveSettings(settings);
            renderYtList();
          },
        }),
      ),
    );
  }
  updateYtCount();
}

function updateYtCount() {
  $("#ytCount").textContent = `${$$("#ytList input:checked").length} / ${settings.youtubeChannels.length}개 채널 선택`;
}

async function addYoutubeChannels() {
  const inputs = $("#ytAdd").value.split(/[\s,]+/).filter(Boolean);
  if (!inputs.length) return;
  readSetup();
  $("#ytAddBtn").disabled = true;
  const errors = [];
  for (const input of inputs) {
    try {
      $("#ytCount").textContent = `채널 확인 중… ${input}`;
      const ch = await YoutubeCollector.resolveChannel(input);
      if (!settings.youtubeChannels.some((x) => x.id === ch.id)) settings.youtubeChannels.push({ ...ch });
      if (!job.youtube.includes(ch.id)) job.youtube.push(ch.id);
    } catch (e) {
      // 확인이 안 되어도 UC 로 시작하는 ID 는 그대로 등록
      const m = input.match(/UC[A-Za-z0-9_-]{22}/);
      if (m && !settings.youtubeChannels.some((x) => x.id === m[0])) {
        settings.youtubeChannels.push({ id: m[0], name: m[0] });
        job.youtube.push(m[0]);
      } else errors.push(`${input}: ${korMsg(e.message)}`);
    }
  }
  await saveSettings(settings);
  $("#ytAdd").value = errors.length ? inputs.filter((x) => errors.some((e) => e.startsWith(x))).join(" ") : "";
  $("#ytAddBtn").disabled = false;
  renderYtList();
  if (errors.length) alert(`추가하지 못한 채널:\n${errors.join("\n")}`);
}

function renderCommList() {
  const box = $("#commList");
  const selected = new Set(job.communities);
  box.innerHTML = "";
  for (const c of settings.communities) {
    box.appendChild(el("label", { title: c.url }, el("input", { type: "checkbox", value: c.url, checked: selected.has(c.url) }), el("span", { text: c.name }), el("span", { class: "car", text: c.url.replace(/^https?:\/\/(www\.)?/, "") })));
  }
}

async function checkLogin() {
  const box = $("#loginState");
  try {
    const c = await chrome.cookies?.get?.({ url: "https://www.naver.com", name: "NID_AUT" });
    if (c === undefined) throw new Error("no cookie api");
    if (c) {
      box.textContent = "✔ 네이버 로그인됨";
      box.className = "status ok";
    } else {
      box.innerHTML = '네이버에 로그인되어 있지 않습니다. <a href="https://nid.naver.com/nidlogin.login" target="_blank">네이버 로그인</a> 후 이 화면으로 돌아오세요.';
      box.className = "status bad";
    }
  } catch {
    box.textContent = "카페 글을 읽으려면 크롬에서 네이버에 로그인해 두세요.";
    box.className = "status";
  }
}

// 보고서 작성 목적 → AI 가 수집 키워드 추천
async function suggestKeywords() {
  if (running) return;
  readSetup();
  if (!job.purpose) return setMsg("#suggestMsg", "먼저 보고서 작성 목적을 적어 주세요.", "err");
  if (!aiReady()) return setMsg("#suggestMsg", "⚙ 설정에서 Anthropic API 키를 넣어 주세요.", "err");
  if (job.keywords.trim() && !confirm("지금 적힌 키워드를 AI 추천 키워드로 바꿀까요? (지금 키워드는 참고해서 보완합니다)")) return;
  running = true;
  $("#suggestKeywords").disabled = true;
  setMsg("#suggestMsg", "AI 가 목적을 읽고 키워드를 만드는 중…");
  const ai = new AiClient(settings);
  try {
    const r = await ai.suggestKeywords(job);
    if (!r.text) throw new Error("추천 키워드가 비어 있습니다");
    $("#keywords").value = r.text;
    readSetup();
    renderQueryPreview();
    addUsage(ai);
    await saveJob();
    setMsg("#suggestMsg", `✔ 추천 완료 — 검색어 ${searchQueries(parseKeywords(r.text)).length}개. ${r.note} 필요하면 고쳐 쓰세요.`, "ok");
  } catch (e) {
    setMsg("#suggestMsg", `추천 실패: ${korMsg(e.message)}`, "err");
  }
  running = false;
  $("#suggestKeywords").disabled = false;
}

// ---------------------------------------------------------------------------
// 2. 게시글 수집
// ---------------------------------------------------------------------------

function directUrls(text) {
  return String(text || "")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//.test(x));
}

function postText(p) {
  return [p.snippet, p.body].filter(Boolean).join("\n");
}

async function collectPosts() {
  if (running) return;
  const err = validateSetup();
  if (err) {
    showTab("setup");
    return setMsg("#setupMsg", err, "err");
  }
  // 이번에 수집할 채널 (2단계 화면에서 고름). 고르지 않은 채널의 게시글·댓글·성향 분석은 그대로 둔다
  const run = CH_ORDER.filter((c) => job.channels[c] && $(`#runChannels input[value="${c}"]`)?.checked !== false);
  if (!run.length) return setMsg("#postsMsg", "이번에 수집할 채널을 하나 이상 체크하세요.", "err");
  const all = run.length === CH_ORDER.filter((c) => job.channels[c]).length;
  const had = job.posts.filter((p) => run.includes(p.channel)).length;
  if (job.posts.length) {
    const names = run.map((c) => CH_NAME[c]).join("·");
    const msg = all
      ? `이미 찾은 게시글 ${job.posts.length}건이 있습니다. 모든 채널을 처음부터 다시 수집할까요?\n(지금까지 모은 댓글·성향 분석도 지워집니다)`
      : `${names}만 다시 수집합니다. (${names}의 기존 게시글 ${had}건과 그 댓글·성향 분석은 새로 모은 것으로 바뀌고, 다른 채널은 그대로 둡니다)`;
    if (!confirm(msg)) return;
  }
  running = true;
  stopRequested = false;
  $("#collectPosts").disabled = true;
  $("#stopPosts").disabled = false;
  $("#postsLog").innerHTML = "";
  const log = logTo("#postsLog");
  const isStopped = () => stopRequested;
  const delays = DELAYS[settings.speed] || DELAYS.normal;
  const range = jobRange();
  const kw = parseKeywords(job.keywords);
  const queries = searchQueries(kw);
  const kept = job.posts.filter((p) => !run.includes(p.channel));
  const keptKeys = new Set(kept.map((p) => p.key));
  job.posts = kept;
  job.comments = job.comments.filter((c) => keptKeys.has(c.postKey));
  for (const k of Object.keys(job.commentStatus)) if (!keptKeys.has(k)) delete job.commentStatus[k];
  if (all) job.report = null;
  job.files = {};
  job.final = null;
  const found = new Map();
  const add = (p) => {
    if (!found.has(p.key)) found.set(p.key, { checked: false, ai: null, ...p });
  };
  const errors = [];
  const tasks = run;
  if (!all) log(`이번 수집 채널: ${run.map((c) => CH_NAME[c]).join("·")} (다른 채널 게시글 ${kept.length}건은 그대로)`);
  try {
    // 언론
    if (run.includes("news") && !stopRequested) {
      const nc = new NewsCollector({ delays, log, isStopped, replies: settings.newsReplies });
      let cands = [];
      if (job.newsAuto) {
        showWork("언론: 네이버 뉴스 검색 중", 0, 0);
        log(`언론: 검색어 ${queries.length}개로 네이버 뉴스 검색`);
        cands = await nc.search(queries, range, Math.max(1, +settings.newsMaxPages || 10));
      }
      for (const u of directUrls(job.urls.news)) {
        const ids = newsIds(u);
        if (!ids) {
          // 언론사 자체 사이트 기사: 게시글 목록에는 넣고(네이버 댓글은 없음) 제목은 모르면 주소로
          const key = `newsx:${u.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
          if (!cands.some((c) => c.key === key)) cands.push({ key, channel: "news", external: true, url: u, title: "", press: new URL(u).hostname.replace(/^www\./, ""), direct: true });
          continue;
        }
        const key = `news:${ids.oid}/${ids.aid}`;
        if (!cands.some((c) => c.key === key)) cands.push({ key, channel: "news", ...ids, url: newsUrl(ids), title: "", direct: true });
      }
      log(`언론: 후보 기사 ${cands.length}건 → 기사 정보·댓글 수 확인`);
      let noComment = 0;
      let outRange = 0;
      let external = 0;
      for (let i = 0; i < cands.length && !stopRequested; i++) {
        const c = cands[i];
        showWork(`언론: 기사 확인 ${i + 1}/${cands.length}`, i, cands.length);
        if (c.external) {
          // 언론사 자체 사이트 기사: 검색 결과의 제목·언론사·날짜로 넣는다 (네이버 댓글 없음 → 댓글 수집 건너뜀)
          const parsed = parseKoreanDate(c.dateText);
          const place = placeInRange(parsed, range);
          if (!c.direct && (place === "older" || place === "newer")) {
            outRange++;
            continue;
          }
          external++;
          add({ ...c, source: c.press || new URL(c.url).hostname.replace(/^www\./, ""), date: parsed ? parsed.date.getTime() : null, exact: !!parsed?.exact, ccount: 0, snippet: "" });
          continue;
        }
        try {
          const n = await nc.commentCount(c);
          if (!n) noComment++;
          const a = await nc.readArticle(c);
          if (!c.direct && a.date && (a.date < job.from || a.date >= job.to)) {
            outRange++;
            continue;
          }
          add({ ...c, title: a.title || c.title, source: a.press || c.press || "네이버 뉴스", date: a.date, exact: a.exact, body: a.body, ccount: n });
        } catch (e) {
          if (e instanceof StopError) throw e;
          log(`  · 기사 확인 실패 ${c.url}: ${korMsg(e.message)}`, "err");
        }
        await sleep(randomBetween(delays.news));
      }
      log(`언론: 기사 ${[...found.values()].filter((p) => p.channel === "news").length}건 (네이버 뉴스 중 댓글 없는 기사 ${noComment}건 · 언론사 자체 사이트 기사 ${external}건 — 게시글 목록에는 넣고 댓글 수집은 건너뜀 · 기간 밖 ${outRange}건 제외)`);
    }

    // 동호회
    if (run.includes("cafe") && !stopRequested) {
      const cc = new CafeCollector({ delays, log, isStopped });
      const cafes = settings.cafes.filter((c) => job.cafes.includes(c.slug));
      const cq = cafeQueries(kw);
      log(`동호회: ${cafes.length}곳 · 카페 검색어 ${cq.map((q) => `"${q}"`).join(", ")} (조합의 나머지 조건은 AI 판독으로 거름)`);
      for (let i = 0; i < cafes.length && !stopRequested; i++) {
        const cafe = cafes[i];
        showWork(`동호회 검색 ${i + 1}/${cafes.length} · ${cafe.name}`, i, cafes.length);
        try {
          const list = await cc.search(cafe, cq, range, Math.max(1, +settings.cafeMaxPages || 5), (what) => showWork(`동호회 검색 ${i + 1}/${cafes.length} · ${cafe.name} · ${what}`, i, cafes.length));
          list.forEach(add);
          log(`동호회 ${cafe.name}: 기간 안 글 ${list.length}건`);
        } catch (e) {
          if (e instanceof StopError) throw e;
          errors.push(`${cafe.name}: ${korMsg(e.message)}`);
          log(`동호회 ${cafe.name}: ${korMsg(e.message)}`, "err");
          if (/로그인/.test(e.message)) break;
        }
        if (i + 1 < cafes.length) await cc.wait(delays.cafeGap);
      }
      for (const u of directUrls(job.urls.cafe)) {
        const m = u.match(/cafe\.naver\.com\/(?:f-e\/cafes\/(\d+)\/articles\/|ca-fe\/cafes\/(\d+)\/articles\/)?([A-Za-z0-9_-]+)?\/?(\d+)/);
        const cafeMatch = u.match(/cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/);
        const fe = u.match(/cafes\/(\d+)\/articles\/(\d+)/);
        const slug = cafeMatch && !/^(f-e|ca-fe)$/.test(cafeMatch[1]) ? cafeMatch[1] : "";
        const articleId = fe ? fe[2] : cafeMatch ? cafeMatch[2] : m?.[4];
        if (!articleId) continue;
        const known = settings.cafes.find((c) => c.slug === slug);
        add({ key: `cafe:${slug || fe?.[1]}/${articleId}`, channel: "cafe", source: known?.name || slug || "네이버 카페", cafeSlug: slug, clubId: fe ? fe[1] : "", articleId, url: u, title: "", date: null, exact: false, snippet: "", direct: true });
      }
    }

    // 유튜브
    if (run.includes("youtube") && !stopRequested) {
      const yc = new YoutubeCollector({ log, isStopped });
      const chs = settings.youtubeChannels.filter((c) => job.youtube.includes(c.id));
      for (let i = 0; i < chs.length && !stopRequested; i++) {
        const ch = chs[i];
        showWork(`유튜브 채널 확인 ${i + 1}/${chs.length} · ${ch.name}`, i, chs.length);
        try {
          const { posts, maybeMore } = await yc.listChannel(ch, range);
          posts.forEach(add);
          log(`유튜브 ${ch.name}: 기간 안 영상 ${posts.length}건${maybeMore ? " (최근 15개 영상까지만 확인 — 더 있을 수 있음)" : ""}`, maybeMore ? "err" : "");
        } catch (e) {
          errors.push(`${ch.name}: ${korMsg(e.message)}`);
          log(`유튜브 ${ch.name}: ${korMsg(e.message)}`, "err");
        }
        await sleep(randomBetween([600, 1200]));
      }
      for (const u of directUrls(job.urls.youtube)) {
        const id = parseYoutubeId(u);
        if (!id) continue;
        try {
          const v = await yc.videoPage(id);
          add({ key: `yt:${id}`, channel: "youtube", source: v.author, videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: v.title, date: v.date, exact: false, snippet: v.description, direct: true });
        } catch (e) {
          log(`유튜브 영상 확인 실패 ${u}: ${korMsg(e.message)}`, "err");
        }
      }
    }

    // 자동차 커뮤니티
    if (run.includes("community") && !stopRequested) {
      const mc = new CommunityCollector({ delays, log, isStopped });
      const sites = settings.communities.filter((c) => job.communities.includes(c.url));
      for (let i = 0; i < sites.length && !stopRequested; i++) {
        const site = sites[i];
        showWork(`커뮤니티 확인 ${i + 1}/${sites.length} · ${site.name}`, i, sites.length);
        try {
          (await mc.search(site, kw, range)).forEach(add);
        } catch (e) {
          if (e instanceof StopError) throw e;
          errors.push(`${site.name}: ${korMsg(e.message)}`);
          log(`커뮤니티 ${site.name}: ${korMsg(e.message)}`, "err");
        }
      }
      for (const u of directUrls(job.urls.community)) {
        const site = settings.communities.find((s) => new URL(s.url).hostname.replace(/^m\./, "www.") === new URL(u).hostname.replace(/^m\./, "www.")) || { name: new URL(u).hostname, url: u };
        const ad = communityAdapter(site.url);
        add({ key: `${ad.domain}:${u}`, channel: "community", source: site.name, domain: ad.domain, siteUrl: site.url, url: u, title: "", date: null, exact: false, snippet: "", direct: true });
      }
    }
  } catch (e) {
    if (!(e instanceof StopError)) log(`수집 중 오류: ${korMsg(e.message)}`, "err");
  }

  const fresh = [...found.values()];
  job.posts = sortPosts([...kept, ...fresh]);
  log(`찾은 후보 게시글 ${job.posts.length}건 (${tasks.map((c) => `${CH_NAME[c]} ${job.posts.filter((p) => p.channel === c).length}`).join(" · ")})`);
  await saveJob();

  // AI 관련성 판독
  if (!stopRequested) {
    await judgePosts(log, fresh);
    // 다시 수집하지 않은 채널의 글 중 게시글 성향이 빈 글(예전 버전으로 판독)은 체크는 그대로 두고 성향만 채운다
    const blank = kept.filter((p) => p.checked && !p.postSentiment);
    if (!stopRequested && blank.length && aiReady()) {
      log(`다른 채널 글 중 게시글 성향이 빈 ${blank.length}건의 성향을 채웁니다 (체크는 그대로)`);
      await judgePosts(log, blank, true);
    }
  } else for (const p of fresh) p.checked = p.direct || matchesKeywords(`${p.title} ${postText(p)}`, kw);

  hideWork();
  running = false;
  $("#collectPosts").disabled = false;
  $("#stopPosts").disabled = true;
  await saveJob();
  renderPosts();
  const checked = job.posts.filter((p) => p.checked).length;
  $("#postsSummary").textContent = `${stopRequested ? "중지됨 — " : ""}${all ? "" : `${run.map((c) => CH_NAME[c]).join("·")} 새로 수집 · `}후보 ${job.posts.length}건 중 관련 게시글 ${checked}건을 체크했습니다.${errors.length ? ` (못 읽은 곳 ${errors.length}곳 — 수집 기록 참고)` : ""} 필요 없는 글은 체크를 풀고 '다음'을 누르세요.`;
}

function sortPosts(list) {
  return list.sort((a, b) => CH_ORDER.indexOf(a.channel) - CH_ORDER.indexOf(b.channel) || (b.date || 0) - (a.date || 0));
}

async function judgePosts(log, list = job.posts, keepChecks = false) {
  const kw = parseKeywords(job.keywords);
  if (!list.length) return;
  if (!aiReady()) {
    log("API 키가 없어 AI 판독 없이 키워드로만 고릅니다 (설정에서 API 키를 넣으면 AI 가 관련성을 판독합니다)", "err");
    if (keepChecks) return;
    for (const p of list) {
      p.checked = p.direct || matchesKeywords(`${p.title} ${postText(p)}`, kw);
      p.ai = null;
    }
    return;
  }
  const ai = new AiClient(settings, log);
  log(`AI 관련성 판독: ${list.length}건 (${ai.model.label})`);
  try {
    const items = list.map((p) => ({ key: p.key, channelName: chName(p), source: p.source, title: p.title || "(제목 모름 — 주소로 직접 넣은 글)", text: postText(p), date: p.date }));
    const res = await ai.judgeRelevance(job, items, (done, total) => showWork(`AI 관련성 판독 ${done}/${total}`, done, total));
    for (const p of list) {
      const r = res.get(p.key);
      if (r?.s && !p.postSentimentManual) p.postSentiment = r.s;
      if (keepChecks) {
        if (r) p.ai = r;
        continue;
      }
      p.ai = r || null;
      p.checked = r ? r.relevant || (p.direct && !p.title) : p.direct || matchesKeywords(`${p.title} ${postText(p)}`, kw);
    }
    log(`AI 판독 완료: 관련 ${list.filter((p) => p.ai?.relevant).length}건 · 무관 ${list.filter((p) => p.ai && !p.ai.relevant).length}건 · 비용 ${usdText(ai.costUsd())}`);
  } catch (e) {
    log(`AI 판독 실패(${korMsg(e.message)}) → 키워드로 대신 고릅니다`, "err");
    if (!keepChecks) for (const p of list) if (!p.ai) p.checked = p.direct || matchesKeywords(`${p.title} ${postText(p)}`, kw);
  }
  addUsage(ai);
}

async function rejudge() {
  if (running || !job.posts.length) return;
  const keep = !confirm("체크(수집 여부)도 AI 판정대로 다시 정할까요?\n\n[확인] 체크를 AI 판정대로 다시 정함 (손으로 바꾼 체크는 바뀜)\n[취소] 지금 체크는 그대로 두고, AI 판독 이유·게시글 성향만 새로 채움");
  running = true;
  const log = logTo("#postsLog");
  await judgePosts(log, job.posts, keep);
  hideWork();
  running = false;
  await saveJob();
  renderPosts();
}

function renderRunChannels() {
  const box = $("#runChannels");
  const prev = new Map($$("#runChannels input").map((x) => [x.value, x.checked]));
  box.innerHTML = "";
  box.append(el("span", { class: "modelabel", text: "이번에 수집할 채널" }));
  for (const c of CH_ORDER.filter((x) => job.channels[x])) {
    const n = job.posts.filter((p) => p.channel === c).length;
    box.append(el("label", { class: "radio" }, el("input", { type: "checkbox", value: c, checked: prev.has(c) ? prev.get(c) : true }), ` ${CH_NAME[c]}`, n ? el("span", { class: "hint", text: ` (지금 ${n}건)` }) : null));
  }
  box.append(el("span", { class: "hint", text: "— 일부만 체크하면 그 채널만 새로 모으고, 다른 채널의 게시글·댓글·성향 분석은 그대로 둡니다" }));
}

// 예전 버전으로 읽은 언론 글(출처·제목에 '새 창 열림', 요약문이 제목) → 언론만 다시 수집하라고 안내
function renderOldNewsNotice() {
  const old = job.posts.filter((p) => p.channel === "news" && (/새\s*창\s*열림/.test(`${p.source} ${p.title}`) || (p.external && p.title.length > 110)));
  const box = $("#oldNewsNotice");
  box.hidden = !old.length || running;
  box.textContent = `⚠ 예전 버전으로 수집된 언론 글 ${old.length}건이 있습니다(제목에 요약문이 들어가고 작성시간이 빔). 아래 '이번에 수집할 채널'에서 언론만 체크하고 「게시글 수집 시작」을 누르면 새 방식으로 다시 모읍니다. 다른 채널은 그대로 두고, 성향이 빈 글은 함께 채웁니다.`;
}

function renderPosts() {
  renderRunChannels();
  renderOldNewsNotice();
  const info = [];
  info.push(`기간 ${fmtDateTime(job.from)} ~ ${fmtDateTime(job.to)}`);
  info.push(`채널 ${CH_ORDER.filter((c) => job.channels[c]).map((c) => CH_NAME[c]).join("·")}`);
  info.push(`검색어 ${searchQueries(parseKeywords(job.keywords)).length}개`);
  $("#postsInfo").textContent = info.join(" · ");
  const tbody = $("#postsTable tbody");
  tbody.innerHTML = "";
  const showUnrelated = $("#showUnrelated").checked;
  const list = job.posts.filter((p) => (view.postsFilter === "all" || p.channel === view.postsFilter) && (showUnrelated || p.checked || !p.ai || p.ai.relevant));
  for (const p of list) {
    const tr = el(
      "tr",
      { class: p.checked ? "" : "off" },
      el("td", { class: "c-chk" }, el("input", { type: "checkbox", checked: p.checked, onchange: (e) => togglePost(p, e.target.checked, tr) })),
      el("td", { text: chName(p) }),
      el("td", { text: p.source || "", title: p.source || "" }),
      el("td", { title: `${p.title}\n${String(postText(p)).slice(0, 300)}` }, el("a", { href: p.url, target: "_blank", text: p.title || p.url })),
      // 목록에 날짜만 보이는 글은 시각을 모른다 → '시간 확인 전' (동호회 글은 3단계에서 글을 열 때 정확한 시각으로 바뀜)
      p.date && p.exact === false
        ? el("td", { title: "목록에 날짜만 보여 시각을 아직 모릅니다. 동호회 글은 3단계 댓글 수집 때 글을 열어 정확한 작성 시각으로 바뀝니다." }, fmtDateTime(p.date).slice(0, 10), el("span", { class: "hint", text: " 시간 확인 전" }))
        : el("td", { text: p.date ? fmtDateTime(p.date) : "-" }),
      el("td", { class: "c-n", text: p.ccount != null ? numFmt(p.ccount) : "" }),
      el("td", {}, postSentimentSelect(p)),
      el(
        "td",
        { class: "ai", title: p.ai?.reason || "" },
        p.ai ? el("span", { class: p.ai.relevant ? "yes" : "no", text: p.ai.relevant ? "관련 " : "무관 " }) : el("span", { class: "no", text: p.direct ? "직접 입력 " : "키워드 " }),
        el("span", { class: "why", text: p.ai?.reason || "" }),
      ),
    );
    tbody.appendChild(tr);
  }
  if (!list.length) tbody.appendChild(el("tr", {}, el("td", { colspan: 8, class: "hint", text: job.posts.length ? "이 조건에 맞는 글이 없습니다." : "'게시글 수집 시작'을 누르세요." })));
  renderPostSentimentSummary();
  const by = CH_ORDER.map((c) => `${CH_NAME[c]} ${job.posts.filter((p) => p.channel === c && p.checked).length}`).join(" · ");
  if (job.posts.length && !running) $("#postsSummary").textContent = `체크한 게시글 ${job.posts.filter((p) => p.checked).length}건 / 후보 ${job.posts.length}건 (${by})`;
}

// 게시글 자체 성향 (AI 관련성 판독 때 함께 판정, 손으로 고칠 수 있음)
function postSentimentSelect(p) {
  const sel = el("select", { class: p.postSentiment ? `s-${p.postSentiment}` : "" }, el("option", { value: "", text: "-" }), ...SENTIMENTS.map((s) => el("option", { value: s, text: s, selected: p.postSentiment === s })));
  sel.addEventListener("change", () => {
    p.postSentiment = sel.value;
    p.postSentimentManual = true;
    sel.className = p.postSentiment ? `s-${p.postSentiment}` : "";
    saveJobSoon();
    renderPostSentimentSummary();
  });
  return sel;
}

// 게시글 성향이 빈 글만 판독해 채운다 (체크·손으로 고친 성향은 그대로)
async function fillPostSentiments() {
  if (running) return;
  if (!aiReady()) return setMsg("#postsMsg", "설정에서 Anthropic API 키를 넣어 주세요.", "err");
  const blank = job.posts.filter((p) => p.checked && !p.postSentiment);
  if (!blank.length) return;
  running = true;
  const log = logTo("#postsLog");
  log(`게시글 성향이 빈 ${blank.length}건의 성향을 채웁니다 (체크는 그대로)`);
  await judgePosts(log, blank, true);
  hideWork();
  running = false;
  await saveJob();
  renderPosts();
}

function renderPostSentimentSummary() {
  const checked = job.posts.filter((p) => p.checked);
  const rated = checked.filter((p) => p.postSentiment);
  const blank = checked.filter((p) => !p.postSentiment);
  const fill = $("#fillPostSenti");
  fill.hidden = !blank.length || running;
  fill.textContent = `체크한 글 중 성향이 비어 있는 ${blank.length}건 — 채우기`;
  if (!rated.length) return ($("#postsSentiment").textContent = "");
  // 성향별 건수는 굵게, 성향 색으로
  const parts = SENTIMENTS.flatMap((s, i) => {
    const n = rated.filter((p) => p.postSentiment === s).length;
    return [i ? " · " : "", el("b", { class: `s-${s}`, text: `${s} ${n}건(${((n / rated.length) * 100).toFixed(1)}%)` })];
  });
  const by = CH_ORDER.filter((c) => rated.some((p) => p.channel === c)).flatMap((c, i) => [
    i ? " · " : "",
    `${CH_NAME[c]}: `,
    ...SENTIMENTS.flatMap((s, k) => [k ? "/" : "", el("b", { class: `s-${s}`, text: String(rated.filter((p) => p.channel === c && p.postSentiment === s).length) })]),
  ]);
  $("#postsSentiment").replaceChildren(`게시글 자체 성향 (체크한 글 ${checked.length}건${rated.length < checked.length ? ` 중 판정된 ${rated.length}건` : ""}): `, ...parts, "  —  채널별 긍/중/부/단: ", ...by);
}

function togglePost(p, on, tr) {
  p.checked = on;
  tr.classList.toggle("off", !on);
  saveJobSoon();
  renderPostSentimentSummary();
}

let saveTimer = null;
function saveJobSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJob(), 600);
}

// 채널별 시트로 나눌 목록
function byChannel(list, getChannel) {
  return CH_ORDER.filter((c) => job.channels[c] || list.some((x) => getChannel(x) === c)).map((c) => ({ c, name: CH_NAME[c], items: list.filter((x) => getChannel(x) === c) }));
}

async function storeAndDownload(kind, name, bytes) {
  await DB.putFile(job.id, kind, name, bytes);
  job.files[kind] = { name, at: Date.now() };
  await saveJob();
  await downloadBytes(bytes, name, settings.saveFolder);
}

// withSentiment: 게시글 자체 성향 열 포함 (파일명 끝 '_성향분석 포함')
async function makePostsFile(withSentiment = false) {
  const posts = job.posts.filter((p) => p.checked);
  const sheets = byChannel(posts, (p) => p.channel).map((g) => ({
    name: g.name,
    rows: g.items.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).map((p) => ({ source: p.source, title: p.title, date: p.date, url: p.url, sentiment: p.postSentiment || "" })),
  }));
  return { name: `${fileBase()}_게시물 리스트${withSentiment ? "_성향분석 포함" : ""}.xlsx`, bytes: await buildPostsXlsx(sheets, withSentiment) };
}

async function downloadPostsSentiment() {
  const checked = job.posts.filter((p) => p.checked);
  if (!checked.length) return setMsg("#postsMsg", "체크한 게시글이 없습니다.", "err");
  const blank = checked.filter((p) => !p.postSentiment).length;
  if (blank && !confirm(`체크한 글 중 성향이 비어 있는 글이 ${blank}건 있습니다(성향 칸이 빈 채로 들어갑니다). 그래도 받을까요?\n(먼저 채우려면 [취소] 후 '채우기' 버튼)`)) return;
  const f = await makePostsFile(true);
  await storeAndDownload("postsSentiment", f.name, f.bytes);
  setMsg("#postsMsg", `✔ ${f.name} 저장 (보고서 DB 에도 보관)`, "ok");
}

async function downloadPosts() {
  if (!job.posts.some((p) => p.checked)) return setMsg("#postsMsg", "체크한 게시글이 없습니다.", "err");
  const f = await makePostsFile();
  await storeAndDownload("posts", f.name, f.bytes);
  setMsg("#postsMsg", `✔ ${f.name} 저장 (보고서 DB 에도 보관)`, "ok");
}

// ---------------------------------------------------------------------------
// 3. 댓글 수집
// ---------------------------------------------------------------------------

function checkedPosts() {
  return sortPosts(job.posts.filter((p) => p.checked));
}

// 3단계 표에서 고른 글 (선택해서 다시 수집)
const commentSel = new Set();

// mode: "new"(아직 안 읽은 글) | "failed"(못 읽은 글만) | "selected"(표에서 고른 글만 다시)
async function collectComments(mode = "new") {
  if (running) return;
  const posts = checkedPosts();
  if (!posts.length) return setMsg("#commentsMsg", "2단계에서 체크한 게시글이 없습니다.", "err");
  const todo = posts.filter((p) => {
    const st = job.commentStatus[p.key];
    if (mode === "selected") return commentSel.has(p.key);
    return mode === "failed" ? st && !st.ok : !st || !st.ok;
  });
  if (!todo.length)
    return setMsg(
      "#commentsMsg",
      mode === "selected" ? "다시 수집할 글을 표에서 체크하세요." : mode === "failed" ? "다시 읽을 글이 없습니다." : "모든 글의 댓글을 이미 모았습니다. 다시 모으려면 표에서 글을 골라 '선택한 글 다시 수집'을 누르세요.",
      mode === "selected" ? "err" : "ok",
    );
  if (mode === "selected") {
    const analyzed = job.comments.filter((c) => commentSel.has(c.postKey) && c.sentiment).length;
    if (!confirm(`고른 글 ${todo.length}건의 댓글을 다시 수집합니다.${analyzed ? `\n(이 글들의 기존 댓글 ${analyzed}개와 성향 분석은 새로 모은 댓글로 바뀌니, 4단계에서 'AI 성향 분석 시작'을 다시 눌러 주세요)` : ""}`)) return;
  }
  // 댓글 수가 0 으로 확인된 언론 기사는 열지 않고 건너뜀 (고른 글은 다시 확인)
  for (const p of todo.filter((x) => mode !== "selected" && x.channel === "news" && x.ccount === 0)) {
    job.commentStatus[p.key] = { ok: true, count: 0, note: p.external ? "언론사 자체 사이트 — 네이버 댓글 없음" : "댓글 없음 — 건너뜀" };
    job.comments = job.comments.filter((c) => c.postKey !== p.key);
  }
  todo.splice(0, todo.length, ...todo.filter((x) => mode === "selected" || !(x.channel === "news" && x.ccount === 0)));
  if (!todo.length) {
    await saveJob();
    renderCommentPosts();
    return setMsg("#commentsMsg", "댓글이 있는 글이 없습니다.", "ok");
  }
  const cafeCount = todo.filter((p) => p.channel === "cafe").length;
  if (cafeCount > 40 && !confirm(`네이버 카페 글 ${cafeCount}건의 댓글을 읽습니다. 글마다 10~20초씩 천천히 읽어 시간이 걸립니다. 계속할까요?`)) return;
  running = true;
  stopRequested = false;
  $("#collectComments").disabled = true;
  $("#retryComments").disabled = true;
  $("#stopComments").disabled = false;
  const log = logTo("#commentsLog");
  const isStopped = () => stopRequested;
  const delays = DELAYS[settings.speed] || DELAYS.normal;
  const nc = new NewsCollector({ delays, log, isStopped, replies: settings.newsReplies });
  const cc = new CafeCollector({ delays, log, isStopped });
  const yc = new YoutubeCollector({ log, isStopped });
  const mc = new CommunityCollector({ delays, log, isStopped, ai: aiReady() ? new AiClient(settings, log) : null });
  log(`댓글 수집: ${todo.length}건`);
  for (let i = 0; i < todo.length && !stopRequested; i++) {
    const p = todo[i];
    showWork(`댓글 수집 ${i + 1}/${todo.length} · ${chName(p)} · ${p.title.slice(0, 30)}`, i, todo.length);
    let note = "";
    try {
      let list = [];
      if (p.channel === "news") list = await nc.readComments(p);
      else if (p.channel === "cafe") {
        const a = await cc.readArticle(p, settings.cafes.find((c) => c.slug === p.cafeSlug) || {});
        if (a.via) log(`  · 바로 열면 안 보여 네이버 검색을 거쳐 읽음: ${p.title.slice(0, 40)}`);
        if (a.title && !p.title) p.title = a.title;
        if (a.source && (p.direct || !p.source)) p.source = a.source;
        if (a.date) {
          if ((p.exact === false || !p.date) && !p.direct && (a.date < job.from || a.date >= job.to)) {
            p.checked = false;
            p.note = "작성 시각이 기간 밖";
            job.commentStatus[p.key] = { ok: true, count: 0, note: "기간 밖이라 뺌" };
            log(`  · 기간 밖이라 뺌: ${p.title} (${fmtDateTime(a.date)})`);
            await cc.wait(delays.article);
            continue;
          }
          p.date = a.date;
          p.exact = a.exact;
        }
        if (a.body && !p.body) p.body = a.body;
        list = a.comments;
      } else if (p.channel === "youtube") {
        const r = await yc.readComments(p.videoId, (n) => showWork(`댓글 수집 ${i + 1}/${todo.length} · 유튜브 · ${n}개`, i, todo.length));
        if (!p.title) p.title = r.page.title;
        if (!p.date && r.page.date) p.date = r.page.date;
        list = r.comments;
      } else {
        const a = await mc.readArticle(p);
        // 목록에 날짜만 보였던 글은 글 화면의 정확한 작성 시각으로 바꾸고, 기간 밖이면 뺀다
        if (a.date && (!p.date || p.exact === false)) {
          if (!p.direct && (a.date < job.from || a.date >= job.to)) {
            p.checked = false;
            p.note = "작성 시각이 기간 밖";
            job.commentStatus[p.key] = { ok: true, count: 0, note: "기간 밖이라 뺌" };
            log(`  · 기간 밖이라 뺌: ${p.title} (${fmtDateTime(a.date)})`);
            await mc.wait(delays.community);
            continue;
          }
          p.date = a.date;
          p.exact = true;
        }
        if (!p.title) p.title = p.url;
        list = a.comments;
        if (a.how && a.how !== "칸 이름") log(`  · ${p.source}: 댓글을 '${a.how}' 방식으로 읽음`);
        if (a.how === "AI 화면 판독") note = "AI 가 화면에서 읽음";
        if (a.aiNone) note = "AI 확인: 댓글 없음";
        if (a.diag) {
          job.diag = [...(job.diag || []).filter((d) => d.url !== a.diag.url), { ...a.diag, site: p.source, at: Date.now() }].slice(-10);
          if (!a.aiNone && list.length) {
            note = `⚠ 화면엔 댓글 ${a.expected}개인데 ${list.length}개만 읽음`;
            log(`  · ${p.source} — ${p.title.slice(0, 40)}: ${note}`, "err");
          }
        }
      }
      job.comments = job.comments.filter((c) => c.postKey !== p.key);
      list.forEach((c, k) => job.comments.push({ id: `${p.key}#${k}`, postKey: p.key, channel: p.channel, text: c.text, writtenAt: c.writtenAt || "", date: c.date || null, isReply: !!c.isReply, sentiment: "" }));
      job.commentStatus[p.key] = { ok: true, count: list.length, ...(note ? { note } : {}) };
      if (p.channel === "community" && p.listCcount === undefined && p.ccount != null) p.listCcount = p.ccount; // 목록에 보이던 댓글 수 기억
      p.ccount = list.length;
      commentSel.delete(p.key);
      log(`  · ${chName(p)} ${p.source || ""} — ${p.title.slice(0, 40)}: 댓글 ${list.length}개`);
    } catch (e) {
      if (e instanceof StopError) break;
      job.commentStatus[p.key] = { ok: false, error: korMsg(e.message) };
      log(`  · ${chName(p)} ${p.title.slice(0, 40)}: ${korMsg(e.message)}`, "err");
      if (/로그인|보호조치/.test(e.message) && p.channel === "cafe") {
        log("네이버 로그인이 풀렸거나 보호조치 화면이 보여 수집을 멈춥니다. 확인 후 '못 읽은 글만 다시'를 누르세요.", "err");
        break;
      }
    }
    if (i % 3 === 2) await saveJob();
    renderCommentPosts();
    if (i + 1 < todo.length && !stopRequested) {
      if (p.channel === "cafe") await cc.wait(delays.article);
      else if (p.channel === "community") await mc.wait(delays.community);
      else await sleep(randomBetween(delays.news));
    }
  }
  hideWork();
  running = false;
  $("#collectComments").disabled = false;
  $("#retryComments").disabled = false;
  $("#stopComments").disabled = true;
  await saveJob();
  renderCommentPosts();
}

function renderCommentPosts() {
  const posts = checkedPosts();
  const keys = new Set(posts.map((p) => p.key));
  for (const k of [...commentSel]) if (!keys.has(k)) commentSel.delete(k);
  const tbody = $("#commentsTable tbody");
  tbody.innerHTML = "";
  for (const p of posts) {
    const st = job.commentStatus[p.key];
    const warn = st?.note && st.note.startsWith("⚠");
    tbody.appendChild(
      el(
        "tr",
        { class: st && !st.ok ? "off" : "" },
        el(
          "td",
          { class: "c-chk" },
          el("input", {
            type: "checkbox",
            checked: commentSel.has(p.key),
            onchange: (e) => {
              if (e.target.checked) commentSel.add(p.key);
              else commentSel.delete(p.key);
              updateCommentSel();
            },
          }),
        ),
        el("td", { text: chName(p) }),
        el("td", { text: p.source || "" }),
        el("td", {}, el("a", { href: p.url, target: "_blank", text: p.title || p.url })),
        el("td", { class: "c-n", text: st?.ok ? numFmt(st.count) : "" }),
        el("td", { class: (st && !st.ok) || warn ? "err" : "", text: !st ? "대기" : st.ok ? st.note || "완료" : st.error }),
      ),
    );
  }
  if (!posts.length) tbody.appendChild(el("tr", {}, el("td", { colspan: 6, class: "hint", text: "2단계에서 게시글을 수집·체크하세요." })));
  updateCommentSel();
  $("#copyDiag").hidden = !(job.diag || []).length;
  const done = posts.filter((p) => job.commentStatus[p.key]?.ok).length;
  const failed = posts.filter((p) => job.commentStatus[p.key] && !job.commentStatus[p.key].ok).length;
  const by = CH_ORDER.map((c) => `${CH_NAME[c]} ${numFmt(job.comments.filter((x) => x.channel === c).length)}`).join(" · ");
  $("#commentsInfo").textContent = `체크한 게시글 ${posts.length}건`;
  $("#commentsSummary").textContent = `댓글을 모은 글 ${done}/${posts.length}건${failed ? ` · 못 읽은 글 ${failed}건` : ""} · 댓글 ${numFmt(job.comments.length)}개 (${by})`;
}

function updateCommentSel() {
  $("#recollectSel").textContent = `선택한 글 댓글 다시 수집 (${commentSel.size})`;
  $("#recollectSel").disabled = !commentSel.size || running;
  const all = $("#commentsAll");
  const n = checkedPosts().length;
  all.checked = n > 0 && commentSel.size === n;
  all.indeterminate = commentSel.size > 0 && commentSel.size < n;
}

function postMap() {
  return new Map(job.posts.map((p) => [p.key, p]));
}

// 성향 분석 대상 댓글 (체크된 글의 댓글만)
function activeComments() {
  const keys = new Set(job.posts.filter((p) => p.checked).map((p) => p.key));
  return job.comments.filter((c) => keys.has(c.postKey));
}

async function makeCommentsFile(withSentiment) {
  const pm = postMap();
  const list = activeComments();
  const sheets = byChannel(list, (c) => c.channel).map((g) => ({
    name: g.name,
    title: `${(job.issueName || "이슈").replace(/\s+/g, "_")}_${g.name} 댓글`,
    rows: g.items.map((c) => {
      const p = pm.get(c.postKey) || {};
      return { domain: p.domain || CH_DOMAIN[c.channel] || "", text: c.text, sentiment: withSentiment ? c.sentiment : "", writtenAt: c.writtenAt, url: p.url || "" };
    }),
  }));
  const name = withSentiment ? `${fileBase()}_댓글 성향 분석.xlsx` : `${fileBase()}_댓글 raw data.xlsx`;
  return { name, bytes: await buildCommentsXlsx(sheets, withSentiment) };
}

async function downloadComments() {
  if (!activeComments().length) return setMsg("#commentsMsg", "모은 댓글이 없습니다.", "err");
  const f = await makeCommentsFile(false);
  await storeAndDownload("comments", f.name, f.bytes);
  setMsg("#commentsMsg", `✔ ${f.name} 저장 (보고서 DB 에도 보관)`, "ok");
}

// ---------------------------------------------------------------------------
// 4. 성향 분석
// ---------------------------------------------------------------------------

function computeStats() {
  const pm = postMap();
  const stats = {};
  const blank = () => ({ posts: 0, comments: 0, 미분석: 0, 긍정: 0, 중립: 0, 부정: 0, 단순비난: 0 });
  stats["전체"] = blank();
  for (const c of CH_ORDER) stats[CH_NAME[c]] = blank();
  for (const p of job.posts) {
    if (!p.checked) continue;
    stats[CH_NAME[p.channel]].posts++;
    stats["전체"].posts++;
  }
  for (const c of activeComments()) {
    if (!pm.get(c.postKey)) continue;
    for (const k of [CH_NAME[c.channel], "전체"]) {
      const st = stats[k];
      if (c.sentiment) {
        st.comments++;
        st[c.sentiment]++;
      } else st.미분석++;
    }
  }
  return stats;
}

function estimateCost(n) {
  const m = MODELS.find((x) => x.id === settings.model) || MODELS[0];
  const batches = Math.ceil(n / SENTIMENT_BATCH);
  const inTok = n * 70 + batches * 2500;
  const outTok = n * 14 + batches * 800;
  return (inTok * m.price[0] + outTok * m.price[1]) / 1e6;
}

async function runSentiment(all = false, re = null) {
  if (running) return;
  if (!aiReady()) return setMsg("#sentimentMsg", "설정에서 Anthropic API 키를 넣어 주세요.", "err");
  const list = activeComments();
  if (all) {
    if (!confirm(`댓글 ${numFmt(list.length)}개를 처음부터 다시 분석합니다. (손으로 고친 판정도 다시 정해집니다) 계속할까요?`)) return;
    for (const c of list) c.sentiment = "";
  }
  const todo = re ? re.targets : list.filter((c) => !c.sentiment);
  if (!todo.length) return setMsg("#sentimentMsg", "분석할 댓글이 없습니다.", "ok");
  if (todo.length > 300 && !confirm(`댓글 ${numFmt(todo.length)}개를 분석합니다. 예상 요금 ${usdText(estimateCost(todo.length))} 안팎. 계속할까요?`)) return;
  running = true;
  stopRequested = false;
  $("#runSentiment").disabled = true;
  $("#rerunSentiment").disabled = true;
  $("#stopSentiment").disabled = false;
  const log = logTo("#sentimentLog");
  const ai = new AiClient(settings, log);
  const pm = postMap();
  log(`성향 분석: 댓글 ${numFmt(todo.length)}개 (${ai.model.label})`);
  // 같은 글의 댓글끼리 묶어서 보낸다 (문맥 판단). 묶음마다 저장해 중간에 멈춰도 이어서 할 수 있게
  const ordered = todo.slice().sort((a, b) => (a.postKey < b.postKey ? -1 : a.postKey > b.postKey ? 1 : 0));
  const CHUNK = SENTIMENT_BATCH * 5;
  try {
    for (let i = 0; i < ordered.length && !stopRequested; i += CHUNK) {
      const part = ordered.slice(i, i + CHUNK);
      const items = part.map((c) => ({ id: c.id, postTitle: pm.get(c.postKey)?.title || "", channelName: CH_NAME[c.channel], text: c.text, isReply: c.isReply }));
      const res = await ai.classifySentiments(job, items, (done) => showWork(`AI ${re ? "재" : "성향 "}분석 ${numFmt(i + done)}/${numFmt(ordered.length)}`, i + done, ordered.length), re?.extra || "");
      for (const c of part) {
        if (!res.has(c.id)) continue;
        c.sentiment = res.get(c.id);
        c.aiSentiment = c.sentiment;
        c.manual = false;
      }
      await saveJob();
      renderSentimentStats();
    }
  } catch (e) {
    log(`성향 분석 오류: ${korMsg(e.message)} — 다시 누르면 남은 댓글부터 이어서 분석합니다`, "err");
  }
  addUsage(ai);
  log(`이번 분석 비용 ${usdText(ai.costUsd())} · 이 보고서 누적 ${usdText(job.usd)}`);
  hideWork();
  running = false;
  $("#runSentiment").disabled = false;
  $("#rerunSentiment").disabled = false;
  $("#stopSentiment").disabled = true;
  if (re) {
    // 판정이 바뀐 댓글 수 (예: 중립→부정 12개)
    const moves = new Map();
    let changed = 0;
    let left = 0;
    for (const c of re.targets) {
      const before = re.prev.get(c.id);
      if (!c.sentiment) {
        c.sentiment = before; // 중지·오류로 다시 못 한 댓글은 원래 판정으로 되돌림
        left++;
        continue;
      }
      if (c.sentiment !== before) {
        changed++;
        const k = `${before}→${c.sentiment}`;
        moves.set(k, (moves.get(k) || 0) + 1);
      }
    }
    const detail = [...moves.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}개`).join(", ");
    const msg = `✔ 재분석 ${numFmt(re.targets.length - left)}개 중 판정이 바뀐 댓글 ${numFmt(changed)}개${detail ? ` (${detail})` : ""}${left ? ` · 다시 못 한 ${left}개는 원래 판정 유지` : ""}${re.saved ? " · 지시사항을 명령 규칙 메모리에 저장했습니다" : ""}`;
    $("#reResult").textContent = msg;
    log(msg);
  }
  await saveJob();
  renderSentiment();
}

// 아래 표에 지금 보이는 댓글 (채널·성향·검색 필터)
function viewComments() {
  const q = compactLower($("#cmtSearch").value);
  return activeComments().filter(
    (c) => (view.cmtChannel === "all" || c.channel === view.cmtChannel) && (view.cmtSenti === "all" || (c.sentiment || "") === view.cmtSenti) && (!q || compactLower(c.text).includes(q)),
  );
}

// 지시사항을 주고 재분석 (지시사항은 메모리에 저장해 다음 보고서에도 적용할 수 있다)
async function reanalyze() {
  if (running) return;
  if (!aiReady()) return setMsg("#sentimentMsg", "설정에서 Anthropic API 키를 넣어 주세요.", "err");
  const instr = $("#reInstr").value.trim();
  const scope = $("#reScope").value;
  const keepManual = $("#reKeepManual").checked;
  let targets = scope === "view" ? viewComments() : activeComments();
  if (SENTIMENTS.includes(scope)) targets = targets.filter((c) => c.sentiment === scope);
  targets = targets.filter((c) => c.sentiment && !(keepManual && c.manual));
  if (!targets.length) return ($("#reResult").textContent = "재분석할 댓글이 없습니다 (아직 분석하지 않았거나, 범위에 맞는 댓글이 없음).");
  if (!instr && !confirm("재분석 지시사항이 비어 있습니다. 지금 규칙(메모리·교정 사례 포함) 그대로 다시 분석할까요?")) return;
  if (!confirm(`댓글 ${numFmt(targets.length)}개를 다시 분석합니다. 예상 요금 ${usdText(estimateCost(targets.length))} 안팎. 계속할까요?`)) return;
  let saved = false;
  if (instr && $("#reSave").checked) {
    const d = new Date();
    settings.memoryMd = appendMemory(settings.memoryMd, "성향 분석 규칙", `- ${instr.replace(/\s*\n\s*/g, " ")} _(${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}, ${job.issueName || "이슈"})_`);
    await saveSettings(settings);
    saved = true;
  }
  const prev = new Map(targets.map((c) => [c.id, c.sentiment]));
  for (const c of targets) c.sentiment = "";
  // 메모리에 저장했으면 메모리로 들어가므로, 저장하지 않은 지시사항만 이번 분석에 따로 붙인다
  await runSentiment(false, { targets, prev, extra: saved ? "" : instr, saved });
}

// 손으로 고친 판정 → 교정 사례로 기록 (다음 성향 분석 때 AI 가 참고)
async function recordCorrection(c, before) {
  if (!c.sentiment || c.sentiment === before) return;
  const text = String(c.text).replace(/\s+/g, " ").trim().slice(0, 200);
  settings.corrections = [{ text, ai: c.aiSentiment || before || "", to: c.sentiment, issue: job.issueName || "", at: Date.now() }, ...(settings.corrections || []).filter((x) => x.text !== text)].slice(0, 200);
  await saveSettings(settings);
}

function renderSentimentStats() {
  const stats = computeStats();
  const tbody = $("#statTable tbody");
  tbody.innerHTML = "";
  for (const k of ["전체", ...CH_ORDER.map((c) => CH_NAME[c])]) {
    const st = stats[k];
    const p = (s) => (st.comments ? `${((st[s] / st.comments) * 100).toFixed(1)}% (${numFmt(st[s])})` : "-");
    tbody.appendChild(
      el(
        "tr",
        { class: k === "전체" ? "total" : "" },
        el("td", { text: k }),
        el("td", { text: numFmt(st.posts) }),
        el("td", { text: numFmt(st.comments) }),
        ...SENTIMENTS.map((s) => el("td", { class: `s-${s}`, text: p(s) })),
        el("td", { text: st.미분석 ? numFmt(st.미분석) : "" }),
      ),
    );
  }
  const all = stats["전체"];
  const neg = all.comments ? ((all.부정 + all.단순비난) / all.comments) * 100 : 0;
  $("#sentimentSummary").textContent = all.comments ? `분석한 댓글 ${numFmt(all.comments)}개 · 부정 여론(부정+단순비난) ${neg.toFixed(1)}% vs 긍정 ${((all.긍정 / all.comments) * 100).toFixed(1)}%${all.미분석 ? ` · 미분석 ${numFmt(all.미분석)}개` : ""}` : "";
  const todo = activeComments().filter((c) => !c.sentiment).length;
  $("#costEstimate").textContent = todo ? `미분석 ${numFmt(todo)}개 · 예상 요금 ${usdText(estimateCost(todo))} 안팎` : "";
}

function renderSentiment() {
  $("#sentimentInfo").textContent = `성향 기준: 긍정 / 중립 / 부정 / 단순비난 — 보고서 작성 목적(이슈 대상)에 대한 태도로 판정합니다. ${aiReady() ? "" : "⚠ 설정에서 API 키를 넣어야 분석할 수 있습니다."}`;
  renderSentimentStats();
  renderCommentRows();
}

function renderCommentRows() {
  const pm = postMap();
  const q = compactLower($("#cmtSearch").value);
  const list = activeComments().filter(
    (c) => (view.cmtChannel === "all" || c.channel === view.cmtChannel) && (view.cmtSenti === "all" || (c.sentiment || "") === view.cmtSenti) && (!q || compactLower(c.text).includes(q)),
  );
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  view.cmtPage = Math.min(view.cmtPage, pages - 1);
  const tbody = $("#cmtTable tbody");
  tbody.innerHTML = "";
  for (const c of list.slice(view.cmtPage * PAGE_SIZE, (view.cmtPage + 1) * PAGE_SIZE)) {
    const p = pm.get(c.postKey) || {};
    const sel = el("select", { class: c.sentiment ? `s-${c.sentiment}` : "" }, el("option", { value: "", text: "(미분석)" }), ...SENTIMENTS.map((s) => el("option", { value: s, text: s, selected: c.sentiment === s })));
    sel.addEventListener("change", () => {
      const before = c.sentiment;
      c.sentiment = sel.value;
      c.manual = true;
      recordCorrection(c, before);
      sel.className = c.sentiment ? `s-${c.sentiment}` : "";
      saveJobSoon();
      renderSentimentStats();
    });
    tbody.appendChild(el("tr", {}, el("td", { text: CH_NAME[c.channel] }), el("td", { text: `${c.isReply ? "└ " : ""}${c.text}` }), el("td", { title: p.title || "" }, el("a", { href: p.url, target: "_blank", text: p.title || "" })), el("td", {}, sel)));
  }
  if (!list.length) tbody.appendChild(el("tr", {}, el("td", { colspan: 4, class: "hint", text: "댓글이 없습니다." })));
  const pager = $("#cmtPager");
  pager.innerHTML = "";
  if (pages > 1) {
    pager.append(el("span", { class: "hint", text: `${numFmt(list.length)}개 중 ${view.cmtPage * PAGE_SIZE + 1}~${Math.min(list.length, (view.cmtPage + 1) * PAGE_SIZE)}` }));
    pager.append(el("button", { text: "◀ 이전", disabled: view.cmtPage === 0, onclick: () => ((view.cmtPage -= 1), renderCommentRows()) }));
    pager.append(el("button", { text: "다음 ▶", disabled: view.cmtPage >= pages - 1, onclick: () => ((view.cmtPage += 1), renderCommentRows()) }));
  }
}

async function downloadSentiment() {
  const list = activeComments();
  if (!list.length) return setMsg("#sentimentMsg", "모은 댓글이 없습니다.", "err");
  const todo = list.filter((c) => !c.sentiment).length;
  if (todo && !confirm(`아직 분석하지 않은 댓글이 ${numFmt(todo)}개 있습니다(성향 칸이 빈 채로 들어갑니다). 그래도 받을까요?`)) return;
  const f = await makeCommentsFile(true);
  await storeAndDownload("sentiment", f.name, f.bytes);
  setMsg("#sentimentMsg", `✔ ${f.name} 저장 (보고서 DB 에도 보관)`, "ok");
}

// ---------------------------------------------------------------------------
// 5. 보고서
// ---------------------------------------------------------------------------

function defaultChannelsLabel() {
  const parts = [];
  if (job.channels.news) parts.push("언론");
  if (job.channels.cafe) parts.push("주요 모니터링 동호회");
  if (job.channels.community) parts.push("주요 모니터링 커뮤니티");
  if (job.channels.youtube) parts.push("주요 모니터링 유튜브");
  return parts.join(", ");
}

function statsText(stats) {
  const lines = ["[통계 — 성향 비율은 분석한 댓글 기준]"];
  for (const k of ["전체", ...CH_ORDER.map((c) => CH_NAME[c])]) {
    const st = stats[k];
    if (!st.posts && !st.comments) continue;
    const r = (s) => (st.comments ? `${((st[s] / st.comments) * 100).toFixed(1)}%` : "-");
    lines.push(`${k}: 게시글 ${st.posts} · 댓글 ${st.comments} · 긍정 ${r("긍정")} · 중립 ${r("중립")} · 부정 ${r("부정")} · 단순비난 ${r("단순비난")}`);
  }
  const titles = job.posts.filter((p) => p.checked).slice(0, 40).map((p) => `- (${chName(p)}) ${p.title}`);
  lines.push("", "[수집 게시글 제목 일부]", ...titles);
  return lines.join("\n");
}

// 성향마다 후보 댓글 (채널 골고루, 너무 짧은 것 제외)
// 댓글이 얼마나 자극적인지 대강 점수 (AI 에 보낼 후보를 고를 때 센 댓글이 빠지지 않게)
const STRONG_RE = /시발|씨발|ㅅㅂ|ㅆㅂ|개같|개빡|개념|미친|ㅁㅊ|호구|사기|쓰레기|양아치|도둑|강도|날강도|현기|흉기|노조|불매|망해|망했|역겹|실화|미쳤|어이없|빡치|열받|최악|양심|배짱|바가지|폭리|장난|꼼수|기만|헛소리|답이 없|그돈씨|탈출|다신|절대/g;
function intensity(text) {
  const t = String(text || "");
  let sc = (t.match(STRONG_RE) || []).length * 3;
  sc += Math.min(4, (t.match(/[!?]{1,}/g) || []).length);
  sc += Math.min(3, (t.match(/ㅋ{2,}|ㅎ{2,}|ㅠ{2,}|ㅡㅡ|;;/g) || []).length);
  sc += Math.min(4, (t.match(/\d[\d,.]*\s*(?:만원|만|원|%)/g) || []).length * 2);
  const len = t.replace(/\s+/g, "").length;
  if (len >= 15 && len <= 160) sc += 2;
  if (len < 8) sc -= 3;
  return sc;
}

function quotePool(per = 110) {
  const pool = {};
  const list = activeComments().filter((c) => c.sentiment && c.text.replace(/\s+/g, "").length >= 6);
  for (const s of SENTIMENTS) {
    const mine = list.filter((c) => c.sentiment === s);
    // 채널마다 센 댓글부터 (같은 점수면 무작위) → 채널을 돌아가며 담아 채널이 고루 섞이게
    const byCh = CH_ORDER.map((ch) =>
      mine
        .filter((c) => c.channel === ch)
        .map((c) => ({ c, k: intensity(c.text) + Math.random() }))
        .sort((a, b) => b.k - a.k)
        .map((x) => x.c),
    );
    const out = [];
    for (let i = 0; out.length < per && byCh.some((a) => a.length > i); i++) for (const a of byCh) if (a[i] && out.length < per) out.push(a[i]);
    pool[s] = out.map((c) => ({ id: c.id.replace(/[^\w#:/.-]/g, ""), realId: c.id, text: c.text, channelName: CH_NAME[c.channel] }));
  }
  return pool;
}

async function writeReport() {
  if (running) return;
  if (!aiReady()) return setMsg("#reportMsg", "설정에서 Anthropic API 키를 넣어 주세요.", "err");
  const stats = computeStats();
  if (!stats["전체"].comments) return setMsg("#reportMsg", "4단계 성향 분석을 먼저 해 주세요.", "err");
  running = true;
  $("#writeReport").disabled = true;
  showWork("AI 보고서 초안 작성 중", 0, 0);
  const ai = new AiClient(settings);
  try {
    const pool = quotePool();
    // id 는 짧은 번호로 바꿔 보낸다
    const idMap = new Map();
    let n = 0;
    const shortPool = {};
    for (const s of SENTIMENTS) shortPool[s] = pool[s].map((c) => {
      const id = `c${++n}`;
      idMap.set(id, c.text);
      return { ...c, id };
    });
    const res = await ai.writeReport(job, statsText(stats), shortPool);
    // AI 가 id 대신 'c12 (언론) …'·댓글 글 자체로 돌려줘도 후보 댓글을 찾아 넣는다
    const norm = (t) => String(t || "").replace(/\s+/g, "");
    const texts = [...idMap.values()];
    const find = (v) => {
      const raw = String(v || "").trim();
      const idm = raw.match(/^\[?(c\d+)\]?(?![\d])/i);
      if (idm && idMap.has(idm[1].toLowerCase())) return idMap.get(idm[1].toLowerCase());
      const t = norm(raw.replace(/^\[?c\d+\]?\s*/i, "").replace(/^\((언론|동호회|유튜브|커뮤니티)\)\s*/, "").replace(/^["“'‘]|["”'’]$/g, ""));
      if (t.length < 4) return null;
      return texts.find((x) => norm(x) === t) || texts.find((x) => norm(x).startsWith(t) || t.startsWith(norm(x).slice(0, 300))) || texts.find((x) => norm(x).includes(t)) || null;
    };
    const pick = (list) => [...new Set((list || []).map(find).filter(Boolean))];
    // 그래도 비면 강도 순 후보로 채움 (후보는 이미 센 댓글부터 채널을 섞어 정렬돼 있음)
    const filled = [];
    const quotes = (key, n) =>
      Object.fromEntries(
        SENTIMENTS.map((s) => {
          let got = pick(res[key]?.[s]);
          if (!got.length && pool[s].length) {
            got = pool[s].slice(0, n).map((c) => c.text);
            filled.push(s);
          }
          return [s, got];
        }),
      );
    job.report = {
      title: res.title || `${job.issueName} 관련 여론 동향`,
      summary: (res.summary || []).slice(0, 3),
      headline: job.report?.headline || "",
      channelsLabel: job.report?.channelsLabel || defaultChannelsLabel(),
      short: quotes("quotes_short", 5),
      long: quotes("quotes_long", 20),
    };
    addUsage(ai);
    await saveJob();
    renderReport();
    const fillNote = filled.length ? ` · AI 가 고른 댓글을 찾지 못한 ${[...new Set(filled)].join("·")} 칸은 센 댓글 순으로 채웠습니다` : "";
    setMsg("#reportMsg", `✔ 초안을 만들었습니다 (비용 ${usdText(ai.costUsd())})${fillNote}. 고친 뒤 'PPT 보고서 받기'를 누르세요.`, "ok");
  } catch (e) {
    setMsg("#reportMsg", `초안 작성 실패: ${korMsg(e.message)}`, "err");
  }
  hideWork();
  running = false;
  $("#writeReport").disabled = false;
}

function ensureReport() {
  if (!job.report) {
    job.report = { title: `${job.issueName || "이슈"} 관련 여론 동향`, summary: [], headline: "", channelsLabel: defaultChannelsLabel(), short: {}, long: {} };
  }
  return job.report;
}

// 보고서 요약: 작성 기준 일시·수집 키워드·채널별 게시글/댓글/성향
function renderReportSummary() {
  const box = $("#reportSummary");
  box.innerHTML = "";
  const kw = parseKeywords(job.keywords);
  // | 조합을 풀어 실제로 검색한 검색어로 보여 준다 (키워드 줄마다 골고루, 상한까지)
  const words = searchQueries(kw);
  const total = totalQueries(kw);
  const stats = computeStats();
  const now = job.final ? new Date(job.final.savedAt) : new Date();
  box.append(
    el("div", { class: "rsum-title", text: `📋 ${job.issueName || "보고서"} — 보고서 요약` }),
    el(
      "div",
      { class: "rsum-row" },
      el("span", { class: "rsum-label", text: "작성 기준 일시" }),
      el("span", {}, el("b", { text: `${fmtDateTime(job.from)} ~ ${fmtDateTime(job.to)}` }), el("span", { class: "hint", text: `  (모니터링 기간 · ${job.final ? "최종 저장" : "지금"} ${fmtDateTime(now)})` })),
    ),
    el(
      "div",
      { class: "rsum-row" },
      el("span", { class: "rsum-label", text: "수집 키워드" }),
      el(
        "span",
        { class: "rsum-kw" },
        ...words.flatMap((w, i) => [i ? ", " : "", el("b", { text: w })]),
        el("span", { class: "hint", text: `  (검색어 ${words.length}개${total > words.length ? ` · 전체 조합 ${total}개 중` : ""}${kw.exclude.length ? ` · 제외: ${kw.exclude.join(", ")}` : ""})` }),
      ),
    ),
    el(
      "div",
      { class: "rsum-row" },
      el("span", { class: "rsum-label", text: "수집 결과" }),
      el(
        "span",
        {},
        "후보 ",
        el("b", { text: `${numFmt(job.posts.length)}건` }),
        " 중 관련 게시글 ",
        el("b", { class: "rsum-hit", text: `${numFmt(job.posts.filter((p) => p.checked).length)}건` }),
        " 확인",
        el("span", {
          class: "hint",
          text: `  (${CH_ORDER.filter((c) => job.posts.some((p) => p.channel === c))
            .map((c) => `${CH_NAME[c]} ${job.posts.filter((p) => p.channel === c && p.checked).length}/${job.posts.filter((p) => p.channel === c).length}`)
            .join(" · ")})`,
        }),
      ),
    ),
    job.purpose ? el("div", { class: "rsum-row" }, el("span", { class: "rsum-label", text: "작성 목적" }), el("span", { class: "rsum-purpose", text: job.purpose })) : null,
  );
  // 제목 칸도 성향 색으로
  const head = el(
    "tr",
    {},
    ...["채널", "수집 게시글", "댓글"].map((t) => el("th", { text: t })),
    ...SENTIMENTS.map((s) => el("th", { class: `s-${s}`, text: s })),
    el("th", {}, el("span", { class: "s-부정", text: "부정" }), "+", el("span", { class: "s-단순비난", text: "단순비난" })),
    el("th", {}, "게시글 성향 (", ...SENTIMENTS.flatMap((s, i) => [i ? "/" : "", el("span", { class: `s-${s}`, text: s[0] })]), ")"),
  );
  const tbody = el("tbody");
  const checked = job.posts.filter((p) => p.checked);
  for (const k of ["전체", ...CH_ORDER.filter((c) => job.channels[c] || checked.some((p) => p.channel === c)).map((c) => CH_NAME[c])]) {
    const st = stats[k];
    const ch = CH_ORDER.find((c) => CH_NAME[c] === k);
    const posts = checked.filter((p) => !ch || p.channel === ch);
    const pct1 = (n) => (st.comments ? `${((n / st.comments) * 100).toFixed(1)}%` : "-");
    // 게시글 성향 건수: 성향별 색으로 굵게 (긍/중/부/단)
    const ps = SENTIMENTS.flatMap((s, i) => [i ? " / " : "", el("b", { class: `s-${s}`, text: String(posts.filter((p) => p.postSentiment === s).length) })]);
    tbody.append(
      el(
        "tr",
        { class: k === "전체" ? "total" : "" },
        el("td", { text: k }),
        el("td", { text: numFmt(st.posts) }),
        el("td", { text: `${numFmt(st.comments)}${st.미분석 ? ` (+미분석 ${numFmt(st.미분석)})` : ""}` }),
        ...SENTIMENTS.map((s) => el("td", { class: `s-${s}`, text: pct1(st[s]) })),
        el("td", { class: "s-부정", text: pct1(st.부정 + st.단순비난) }),
        posts.some((p) => p.postSentiment) ? el("td", {}, ...ps) : el("td", { text: "-" }),
      ),
    );
  }
  box.append(el("table", { class: "grid stat rsum-table" }, el("thead", {}, head), tbody));
}

function renderReport() {
  renderReportSummary();
  const r = ensureReport();
  $("#rTitle").value = r.title;
  $("#rChannels").value = r.channelsLabel || defaultChannelsLabel();
  $("#rSummary").value = (r.summary || []).join("\n");
  $("#rHeadline").value = r.headline || "";
  for (const col of $$(".qcol")) {
    const s = col.dataset.s;
    col.querySelector('[data-k="short"]').value = (r.short[s] || []).join("\n");
    col.querySelector('[data-k="long"]').value = (r.long[s] || []).join("\n");
  }
  renderHeadPreview();
  $("#finalMsg").textContent = job.final ? `최종 DB 저장됨: ${fmtDateTime(job.final.savedAt)}` : "";
}

function readReport() {
  const r = ensureReport();
  r.title = $("#rTitle").value.trim();
  r.channelsLabel = $("#rChannels").value.trim();
  r.summary = $("#rSummary").value.split("\n").map((x) => x.trim()).filter(Boolean);
  r.headline = $("#rHeadline").value.trim();
  for (const col of $$(".qcol")) {
    const s = col.dataset.s;
    r.short[s] = col.querySelector('[data-k="short"]').value.split("\n").map((x) => x.trim()).filter(Boolean);
    r.long[s] = col.querySelector('[data-k="long"]').value.split("\n").map((x) => x.trim()).filter(Boolean);
  }
  return r;
}

function renderHeadPreview() {
  const all = computeStats()["전체"];
  if (!all.comments) return ($("#rHeadPreview").textContent = "");
  const neg = (all.부정 + all.단순비난) / all.comments;
  const pos = all.긍정 / all.comments;
  const phrase = $("#rHeadline").value.trim() || headlinePhrase(neg, pos);
  $("#rHeadPreview").textContent =
    neg >= pos
      ? `미리보기: 부정 여론(부정+단순비난)이 긍정 여론 比 ${phrase} (${pct(neg)} vs ${pct(pos)})`
      : `미리보기: 긍정 여론이 부정 여론(부정+단순비난) 比 ${phrase} (${pct(pos)} vs ${pct(neg)})`;
}

async function makePptxFile() {
  const r = readReport();
  const bytes = await buildReportPptx({
    title: r.title || `${job.issueName} 관련 여론 동향`,
    summary: r.summary,
    headline: r.headline,
    from: job.from,
    to: job.to,
    channelsLabel: r.channelsLabel || defaultChannelsLabel(),
    stats: computeStats(),
    short: r.short,
    long: r.long,
  });
  return { name: `${fileBase()}_여론 동향 보고서.pptx`, bytes };
}

async function downloadPptx() {
  if (!computeStats()["전체"].comments && !confirm("성향 분석한 댓글이 없어 표·차트가 비어 있습니다. 그래도 받을까요?")) return;
  try {
    const f = await makePptxFile();
    await storeAndDownload("pptx", f.name, f.bytes);
    setMsg("#finalMsg", `✔ ${f.name} 저장 (보고서 DB 에도 보관)`, "ok");
  } catch (e) {
    setMsg("#finalMsg", `PPT 만들기 실패: ${korMsg(e.message)}`, "err");
  }
}

// 최종 DB 저장: 아직 안 만든 파일까지 모두 만들어 함께 보관
async function saveFinal() {
  if (running) return;
  if (!job.posts.some((p) => p.checked)) return setMsg("#finalMsg", "수집한 게시글이 없습니다.", "err");
  readReport();
  running = true;
  showWork("최종 DB 저장: 파일 만드는 중", 0, 0);
  try {
    const made = [];
    const put = async (kind, f) => {
      await DB.putFile(job.id, kind, f.name, f.bytes);
      job.files[kind] = { name: f.name, at: Date.now() };
      made.push(f.name);
    };
    await put("posts", await makePostsFile());
    await put("postsSentiment", await makePostsFile(true));
    if (activeComments().length) {
      await put("comments", await makeCommentsFile(false));
      await put("sentiment", await makeCommentsFile(true));
    }
    await put("pptx", await makePptxFile());
    job.final = { savedAt: Date.now(), stats: computeStats() };
    await saveJob();
    setMsg("#finalMsg", `✔ 최종 DB 저장 완료 — 파일 ${made.length}개 함께 보관 (보고서 DB 메뉴에서 다시 받을 수 있습니다)`, "ok");
  } catch (e) {
    setMsg("#finalMsg", `저장 실패: ${korMsg(e.message)}`, "err");
  }
  hideWork();
  running = false;
}

// ---------------------------------------------------------------------------
// 보고서 DB
// ---------------------------------------------------------------------------

const FILE_LABEL = { posts: "게시글", postsSentiment: "게시글+성향", comments: "댓글", sentiment: "성향", pptx: "PPT" };

async function renderDb() {
  const tbody = $("#dbTable tbody");
  tbody.innerHTML = "";
  const jobs = await DB.listJobs();
  for (const j of jobs) {
    const files = await DB.listFiles(j.id);
    const st = j.final?.stats?.["전체"];
    const negRate = st && st.comments ? `${(((st.부정 + st.단순비난) / st.comments) * 100).toFixed(1)}%` : "";
    const filesTd = el("td", { class: "files" });
    for (const k of ["posts", "postsSentiment", "comments", "sentiment", "pptx"]) {
      const f = files.find((x) => x.kind === k);
      if (f) filesTd.append(el("button", { text: `⬇ ${FILE_LABEL[k]}`, title: f.name, onclick: async () => downloadBytes(new Uint8Array(await f.bytes.arrayBuffer()), f.name, settings.saveFolder) }));
    }
    tbody.appendChild(
      el(
        "tr",
        {},
        el("td", {}, el("span", { class: `badge ${j.final ? "final" : "work"}`, text: j.final ? "최종" : "작업 중" }), j.id === job.id ? el("span", { class: "hint", text: " (지금)" }) : null),
        el("td", { title: j.purpose || "", text: j.issueName || "(이름 없음)" }),
        el("td", { text: `${fmtDateTime(j.from)} ~ ${fmtDateTime(j.to)}` }),
        el("td", { text: numFmt((j.posts || []).filter((p) => p.checked).length) }),
        el("td", { text: numFmt((j.comments || []).length) }),
        el("td", { text: negRate }),
        filesTd,
        el("td", { text: fmtDateTime(j.final?.savedAt || j.updatedAt) }),
        el(
          "td",
          { class: "actions" },
          el("button", { text: "열기", onclick: () => openJob(j.id) }),
          el("button", {
            text: "백업",
            onclick: async () => {
              const bytes = await DB.exportZip([j.id]);
              await downloadBytes(bytes, `${ymd()}_이슈보고서_백업_${j.issueName || j.id}.zip`, settings.saveFolder);
            },
          }),
          el("button", {
            text: "삭제",
            class: "danger",
            onclick: async () => {
              if (!confirm(`'${j.issueName || j.id}' 보고서와 보관한 파일을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
              await DB.deleteJob(j.id);
              if (j.id === job.id) {
                job = newJob();
                renderSetup();
                await saveJob();
              }
              renderDb();
            },
          }),
        ),
      ),
    );
  }
  if (!jobs.length) tbody.appendChild(el("tr", {}, el("td", { colspan: 9, class: "hint", text: "보관한 보고서가 없습니다." })));
}

async function openJob(id) {
  if (running) return;
  const j = await DB.getJob(id);
  if (!j) return;
  job = j;
  await saveJob();
  renderSetup();
  renderJobBar();
  showTab(job.final ? "report" : "setup");
}

// ---------------------------------------------------------------------------
// 명령 프롬프트 · 설정
// ---------------------------------------------------------------------------

function renderCorrections() {
  const box = $("#corrList");
  box.innerHTML = "";
  if (!settings.corrections.length) box.appendChild(el("div", { class: "hint", text: "아직 없습니다. 4단계 '댓글별 성향'에서 판정을 고치면 여기에 쌓입니다." }));
  for (const c of settings.corrections) {
    box.appendChild(
      el(
        "div",
        { class: "item" },
        el("span", { class: "t", title: c.text, text: `“${c.text}”` }),
        el("span", { class: "hint", text: c.ai ? `${c.ai} →` : "" }),
        el("b", { class: `s-${c.to}`, text: c.to }),
        el("span", { class: "hint", text: c.issue || "" }),
        el("button", {
          text: "삭제",
          onclick: async () => {
            settings.corrections = settings.corrections.filter((x) => x !== c);
            await saveSettings(settings);
            renderPrompt();
          },
        }),
      ),
    );
  }
}

function renderPrompt() {
  $("#promptBuilt").textContent = PROMPT_BUILT_AT;
  $("#memoryMd").value = settings.memoryMd || DEFAULT_MEMORY;
  renderCorrections();
  readSetup();
  const box = $("#promptView");
  box.innerHTML = "";
  box.appendChild(el("div", { class: "promptblock" }, el("h3", { text: "수집 기본 규칙 (동호회)" }), el("pre", { class: "prompt", text: COLLECT_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n") })));
  for (const [title, text] of promptPreview(job, settings)) {
    box.appendChild(el("div", { class: "promptblock" }, el("h3", { text: title }), el("pre", { class: "prompt", text })));
  }
}

function renderSettings() {
  $("#apiKey").value = settings.apiKey || "";
  const sel = $("#model");
  sel.innerHTML = "";
  for (const m of MODELS) sel.append(el("option", { value: m.id, text: `${m.label} — 100만 토큰당 입력 $${m.price[0]} / 출력 $${m.price[1]}`, selected: m.id === settings.model }));
  $("#speed").value = settings.speed;
  $("#cafeMaxPages").value = settings.cafeMaxPages;
  $("#newsMaxPages").value = settings.newsMaxPages;
  $("#newsReplies").checked = !!settings.newsReplies;
  $("#commBoards").value = settings.communities.map((c) => `${c.name} | ${c.url}`).join("\n");
  $("#saveFolder").value = settings.saveFolder || "";
  $("#usdKrw").value = settings.usdKrw;
}

async function saveSettingsFromForm() {
  settings.apiKey = $("#apiKey").value.trim();
  settings.model = $("#model").value;
  settings.speed = $("#speed").value;
  settings.cafeMaxPages = Math.max(1, Math.min(30, +$("#cafeMaxPages").value || 5));
  settings.newsMaxPages = Math.max(1, Math.min(40, +$("#newsMaxPages").value || 10));
  settings.newsReplies = $("#newsReplies").checked;
  const boards = [];
  for (const line of $("#commBoards").value.split("\n")) {
    const [name, url] = line.split("|").map((x) => x.trim());
    if (url && /^https?:\/\//.test(url)) boards.push({ name: name || new URL(url).hostname, url, on: true });
  }
  if (boards.length) settings.communities = boards;
  settings.saveFolder = cleanFolder($("#saveFolder").value);
  settings.usdKrw = +$("#usdKrw").value || 1400;
  await saveSettings(settings);
  renderSettings();
  renderCommList();
  setMsg("#settingsMsg", "✔ 저장했습니다", "ok");
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

async function init() {
  isWorking = () => running || workActive;
  $("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  settings = await loadSettings();
  const { imrCurrentJob } = await chrome.storage.local.get("imrCurrentJob").catch(() => ({}));
  job = (imrCurrentJob && (await DB.getJob(imrCurrentJob).catch(() => null))) || newJob();
  renderSetup();
  renderJobBar();
  checkLogin();
  if (job.posts.length) {
    const box = $("#resumeBox");
    box.hidden = false;
    box.textContent = `지난번 작업(${job.issueName || "이름 없음"})을 이어서 합니다. 새 보고서는 오른쪽 위 '＋ 새 보고서 시작'을 누르세요.`;
    setTimeout(() => (box.hidden = true), 8000);
  }

  for (const b of $$("nav .tab")) b.addEventListener("click", () => {
    if (running) return;
    if ($("#tab-setup").hidden === false) readSetup();
    if ($("#tab-report").hidden === false) readReport();
    saveJob();
    showTab(b.dataset.tab);
  });
  $("#newJob").addEventListener("click", async () => {
    if (running) return;
    if (!confirm("새 보고서를 시작할까요? 지금 작업은 보고서 DB 에 그대로 남아 있어 나중에 다시 열 수 있습니다.")) return;
    readSetup();
    await saveJob();
    const keep = { purpose: "", cafes: job.cafes, youtube: job.youtube, communities: job.communities, channels: job.channels };
    job = { ...newJob(), ...keep };
    renderSetup();
    await saveJob();
    showTab("setup");
  });

  // 1단계
  for (const id of ["#purpose", "#issueName", "#keywords", "#rangeFrom", "#rangeTo", "#newsUrls", "#cafeUrls", "#ytUrls", "#commUrls"]) $(id).addEventListener("change", () => (readSetup(), saveJobSoon()));
  for (const id of ["#chNews", "#chCafe", "#chYoutube", "#chCommunity", "#newsAuto"]) $(id).addEventListener("change", () => (readSetup(), saveJobSoon()));
  $("#keywords").addEventListener("input", renderQueryPreview);
  $("#suggestKeywords").addEventListener("click", suggestKeywords);
  for (const b of $$("[data-range]")) b.addEventListener("click", () => {
    const to = new Date();
    to.setSeconds(0, 0);
    $("#rangeTo").value = toLocalInput(to);
    $("#rangeFrom").value = toLocalInput(new Date(to.getTime() - +b.dataset.range * 3600e3));
    readSetup();
    saveJobSoon();
  });
  $("#cafeFilter").addEventListener("input", () => (readSetup(), renderCafeList()));
  $("#cafeAll").addEventListener("click", () => ($$("#cafeList label:not([hidden]) input").forEach((x) => (x.checked = true)), updateCafeCount(), readSetup(), saveJobSoon()));
  $("#cafeNone").addEventListener("click", () => ($$("#cafeList input").forEach((x) => (x.checked = false)), updateCafeCount(), readSetup(), saveJobSoon()));
  $("#cafeList").addEventListener("change", () => (readSetup(), saveJobSoon()));
  $("#cafeAdd").addEventListener("click", async () => {
    const name = $("#cafeAddName").value.trim();
    const slug = $("#cafeAddSlug").value.trim().replace(/^https?:\/\/(m\.)?cafe\.naver\.com\//, "").replace(/[/?#].*$/, "");
    if (!name || !/^[A-Za-z0-9_-]+$/.test(slug)) return alert("동호회 이름과 카페 주소(cafe.naver.com/ 뒤 영문 또는 숫자)를 넣어 주세요.");
    readSetup();
    if (!settings.cafes.some((c) => c.slug === slug)) settings.cafes.push({ name, slug, car: $("#cafeAddCar").value.trim(), on: false });
    if (!job.cafes.includes(slug)) job.cafes.push(slug);
    await saveSettings(settings);
    $("#cafeAddName").value = $("#cafeAddSlug").value = $("#cafeAddCar").value = "";
    renderCafeList();
    saveJobSoon();
  });
  $("#ytAddBtn").addEventListener("click", addYoutubeChannels);
  $("#ytAll").addEventListener("click", () => ($$("#ytList input").forEach((x) => (x.checked = true)), updateYtCount(), readSetup(), saveJobSoon()));
  $("#ytNone").addEventListener("click", () => ($$("#ytList input").forEach((x) => (x.checked = false)), updateYtCount(), readSetup(), saveJobSoon()));
  $("#ytList").addEventListener("change", () => (readSetup(), saveJobSoon()));
  $("#commList").addEventListener("change", () => (readSetup(), saveJobSoon()));
  $("#saveSetup").addEventListener("click", async () => {
    readSetup();
    await saveJob();
    const err = validateSetup();
    setMsg("#setupMsg", err || "✔ 저장했습니다", err ? "err" : "ok");
  });
  $("#goCollect").addEventListener("click", async () => {
    readSetup();
    await saveJob();
    const err = validateSetup();
    if (err) return setMsg("#setupMsg", err, "err");
    setMsg("#setupMsg", "");
    showTab("posts");
  });

  // 2단계
  $("#collectPosts").addEventListener("click", collectPosts);
  $("#rejudge").addEventListener("click", rejudge);
  $("#fillPostSenti").addEventListener("click", fillPostSentiments);
  $("#stopPosts").addEventListener("click", () => (stopRequested = true));
  for (const b of $$("#postsFilter button")) b.addEventListener("click", () => {
    view.postsFilter = b.dataset.f;
    $$("#postsFilter button").forEach((x) => x.classList.toggle("on", x === b));
    renderPosts();
  });
  $("#showUnrelated").addEventListener("change", renderPosts);
  $("#checkAll").addEventListener("click", () => {
    for (const p of job.posts) if (view.postsFilter === "all" || p.channel === view.postsFilter) if ($("#showUnrelated").checked || !p.ai || p.ai.relevant) p.checked = true;
    saveJobSoon();
    renderPosts();
  });
  $("#uncheckAll").addEventListener("click", () => {
    for (const p of job.posts) if (view.postsFilter === "all" || p.channel === view.postsFilter) p.checked = false;
    saveJobSoon();
    renderPosts();
  });
  $("#dlPosts").addEventListener("click", downloadPosts);
  $("#dlPostsSenti").addEventListener("click", downloadPostsSentiment);
  $("#goComments").addEventListener("click", () => showTab("comments"));

  // 3단계
  $("#collectComments").addEventListener("click", () => collectComments("new"));
  $("#retryComments").addEventListener("click", () => collectComments("failed"));
  $("#recollectSel").addEventListener("click", () => collectComments("selected"));
  $("#commentsAll").addEventListener("change", (e) => {
    for (const p of checkedPosts()) e.target.checked ? commentSel.add(p.key) : commentSel.delete(p.key);
    renderCommentPosts();
  });
  $("#selZero").addEventListener("click", () => {
    for (const p of checkedPosts()) {
      const st = job.commentStatus[p.key];
      if ((st?.ok && st.count === 0 && !/언론사 자체 사이트/.test(st.note || "")) || (st && !st.ok) || /^⚠/.test(st?.note || "")) commentSel.add(p.key);
    }
    renderCommentPosts();
  });
  $("#selNone").addEventListener("click", () => (commentSel.clear(), renderCommentPosts()));
  $("#copyDiag").addEventListener("click", async () => {
    const text = JSON.stringify({ version: chrome.runtime.getManifest().version, diag: job.diag || [] }, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      setMsg("#commentsMsg", "✔ 진단 정보를 복사했습니다 — 채팅에 붙여 넣어 보내 주세요", "ok");
    } catch {
      await downloadBytes(new TextEncoder().encode(text), `${ymd()}_댓글 진단 정보.txt`, settings.saveFolder);
    }
  });
  $("#stopComments").addEventListener("click", () => (stopRequested = true));
  $("#dlComments").addEventListener("click", downloadComments);
  $("#goSentiment").addEventListener("click", () => showTab("sentiment"));

  // 4단계
  $("#runSentiment").addEventListener("click", () => runSentiment(false));
  $("#rerunSentiment").addEventListener("click", () => runSentiment(true));
  $("#reRun").addEventListener("click", reanalyze);
  $("#stopSentiment").addEventListener("click", () => (stopRequested = true));
  for (const [seg, key] of [["#cmtChannel", "cmtChannel"], ["#cmtSenti", "cmtSenti"]]) {
    for (const b of $$(`${seg} button`)) b.addEventListener("click", () => {
      view[key] = b.dataset.f;
      view.cmtPage = 0;
      $$(`${seg} button`).forEach((x) => x.classList.toggle("on", x === b));
      renderCommentRows();
    });
  }
  $("#cmtSearch").addEventListener("input", () => ((view.cmtPage = 0), renderCommentRows()));
  $("#dlSentiment").addEventListener("click", downloadSentiment);
  $("#goReport").addEventListener("click", () => showTab("report"));

  // 5단계
  $("#writeReport").addEventListener("click", writeReport);
  $("#rHeadline").addEventListener("input", renderHeadPreview);
  for (const id of ["#rTitle", "#rChannels", "#rSummary", "#rHeadline"]) $(id).addEventListener("change", () => (readReport(), saveJobSoon()));
  for (const t of $$(".qcol textarea")) t.addEventListener("change", () => (readReport(), saveJobSoon()));
  $("#dlPptx").addEventListener("click", downloadPptx);
  $("#saveFinal").addEventListener("click", saveFinal);

  // DB
  $("#dbExport").addEventListener("click", async () => {
    const bytes = await DB.exportZip();
    await downloadBytes(bytes, `${ymd()}_이슈보고서_전체백업.zip`, settings.saveFolder);
    setMsg("#dbMsg", "✔ 백업 파일을 저장했습니다", "ok");
  });
  $("#dbImport").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const r = await DB.importZip(new Uint8Array(await f.arrayBuffer()));
      setMsg("#dbMsg", `✔ 보고서 ${r.jobs}건 · 파일 ${r.files}개를 가져왔습니다 (같은 보고서는 덮어씀)`, "ok");
      renderDb();
    } catch (err) {
      setMsg("#dbMsg", `가져오기 실패: ${korMsg(err.message)}`, "err");
    }
  });

  // 명령 프롬프트 · 설정
  $("#savePrompt").addEventListener("click", async () => {
    settings.memoryMd = $("#memoryMd").value;
    settings.customPrompt = "";
    await saveSettings(settings);
    renderPrompt();
    setMsg("#promptMsg", "✔ 저장했습니다 — 다음 AI 작업부터 적용됩니다", "ok");
  });
  $("#dlMemory").addEventListener("click", async () => {
    settings.memoryMd = $("#memoryMd").value;
    await saveSettings(settings);
    let md = settings.memoryMd.replace(/\s+$/, "");
    if (settings.corrections.length) md += `\n\n## 성향 교정 사례 (자동 기록)\n${settings.corrections.map((c) => `- “${c.text}” → ${c.to}${c.ai ? ` (AI: ${c.ai})` : ""}${c.issue ? ` _[${c.issue}]_` : ""}`).join("\n")}`;
    await downloadBytes(new TextEncoder().encode(`${md}\n`), `${ymd()}_명령 규칙 메모리.md`, settings.saveFolder);
  });
  $("#ulMemory").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    let text = await f.text();
    // 받았던 파일의 '성향 교정 사례' 부분은 교정 목록으로 되돌린다
    const m = text.match(/\n## 성향 교정 사례 \(자동 기록\)\n([\s\S]*)$/);
    if (m) {
      text = text.slice(0, m.index);
      const back = [...m[1].matchAll(/^- “(.*)” → (긍정|중립|부정|단순비난)(?: \(AI: (긍정|중립|부정|단순비난)\))?(?: _\[(.*)\]_)?$/gm)].map((x) => ({ text: x[1], to: x[2], ai: x[3] || "", issue: x[4] || "", at: Date.now() }));
      const have = new Set(settings.corrections.map((c) => c.text));
      settings.corrections = [...settings.corrections, ...back.filter((c) => !have.has(c.text))].slice(0, 200);
    }
    if (!confirm("불러온 파일 내용으로 지금 메모리를 바꿀까요?")) return;
    settings.memoryMd = text;
    await saveSettings(settings);
    renderPrompt();
    setMsg("#promptMsg", "✔ 메모리를 불러왔습니다", "ok");
  });
  $("#saveSettings").addEventListener("click", saveSettingsFromForm);
  $("#testKey").addEventListener("click", async () => {
    await saveSettingsFromForm();
    setMsg("#keyMsg", "확인 중…");
    try {
      await new AiClient(settings).ping();
      setMsg("#keyMsg", "✔ API 키와 모델이 정상입니다", "ok");
    } catch (e) {
      setMsg("#keyMsg", `✖ ${korMsg(e.message)}`, "err");
    }
  });

  if (!settings.apiKey) setMsg("#setupMsg", "ⓘ AI 판독·성향 분석을 하려면 ⚙ 설정에서 Anthropic API 키를 먼저 넣으세요.");
}

init();
