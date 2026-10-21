// 동호회(네이버 카페): 카페마다 키워드로 검색한 화면을 읽어 기간 안의 글을 찾고, 고른 글의 댓글을 읽는다.
// 네이버 API 를 직접 반복 호출하면 계정 보호조치가 걸릴 수 있어, 사람이 보듯 화면을 열어서만 읽는다.
// (LX3 팰리세이드 수집기와 같은 방식: 수집 화면 안의 보이지 않는 틀 → 못 읽으면 뒤쪽 탭)

// 이 확장이 연 카페 화면 표시(#imrbg): bg-render.js 가 이 화면만 '보이는 탭'처럼 그리게 한다
function markUrl(url) {
  return /^https?:\/\/(?:[\w-]+\.)?(?:cafe\.naver\.com|naver\.me)\//.test(url) && !url.includes("#") ? `${url}#imrbg` : url;
}

async function withTab(url, fn, { mode = "frame" } = {}) {
  if (mode === "frame") return withFrame(url, fn);
  const tab = await chrome.tabs.create({ url: markUrl(url), active: false });
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(done, 30000);
      function done() {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
      function listener(id, info) {
        if (id === tab.id && info.status === "complete") done();
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    await sleep(3000);
    return await fn({ tabId: tab.id });
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// 이 탭(수집 화면) 안의 틀에 카페 화면을 넣을 수 있게, 이 탭에서 여는 카페 틀에만 '틀 안 표시 금지' 머리글을 뗀다
async function allowCafeFrames(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [10],
    addRules: [{
      id: 10,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition: { tabIds: [tabId], resourceTypes: ["sub_frame"], requestDomains: ["cafe.naver.com", "m.cafe.naver.com", "naver.me", "nid.naver.com"] },
    }],
  });
}

async function withFrame(url, fn) {
  const me = await chrome.tabs.getCurrent();
  if (!me) throw new Error("수집 화면 탭을 찾지 못했습니다");
  await allowCafeFrames(me.id);
  const before = new Set(((await chrome.webNavigation.getAllFrames({ tabId: me.id })) || []).map((f) => f.frameId));
  const frame = document.createElement("iframe");
  // 화면 뒤에 투명하게 (화면 밖에 두면 크롬이 그리기를 멈출 수 있음). 크기는 실제 화면처럼 줘야 카페 화면이 목록을 그린다
  frame.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none;z-index:-1";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
  frame.src = markUrl(url);
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 30000);
      frame.addEventListener("load", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      document.body.appendChild(frame);
    });
    await sleep(3000);
    const frames = (await chrome.webNavigation.getAllFrames({ tabId: me.id })) || [];
    const root = frames.find((f) => f.parentFrameId === 0 && !before.has(f.frameId));
    if (!root) throw new Error("카페 화면 틀을 찾지 못했습니다");
    return await fn({ tabId: me.id, rootId: root.frameId });
  } finally {
    frame.remove();
  }
}

async function frameTarget(where) {
  if (where.rootId === undefined) return { tabId: where.tabId, allFrames: true };
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: where.tabId }).catch(() => [])) || [];
  const ids = new Set([where.rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of frames) {
      if (!ids.has(f.frameId) && ids.has(f.parentFrameId)) {
        ids.add(f.frameId);
        grew = true;
      }
    }
  }
  return { tabId: where.tabId, frameIds: [...ids] };
}

async function runInFrames(where, func, args = []) {
  try {
    const res = await chrome.scripting.executeScript({ target: await frameTarget(where), func, args });
    return res.map((r) => r.result).filter(Boolean);
  } catch {
    return [];
  }
}

// 틀에서 못 읽으면 뒤쪽 탭으로 한 번 더
async function readPage(url, reader, isDone) {
  let res = await withTab(url, reader).catch(() => null);
  if (!isDone(res)) res = await withTab(url, reader, { mode: "tab" }).catch(() => res);
  return res;
}

// ---------------------------------------------------------------------------
// 화면 안에서 실행되는 함수들 (확장 바깥 함수·변수는 쓸 수 없다)
// ---------------------------------------------------------------------------

// 카페 숫자 번호(clubid)·이름
function cafeInfoInFrame() {
  const top = window === window.top || window.parent === window.top;
  let id = null;
  const fromUrl = location.href.match(/\/cafes\/(\d+)/) || location.href.match(/clubid=(\d+)/i);
  if (fromUrl) id = fromUrl[1];
  else if (window.g_sClubId) id = String(window.g_sClubId);
  else {
    const html = document.documentElement ? document.documentElement.innerHTML : "";
    const m = html.match(/g_sClubId\s*=\s*["']?(\d+)/) || html.match(/"cafeId"\s*:\s*"?(\d+)/) || html.match(/\/f-e\/cafes\/(\d+)/) || html.match(/clubid=(\d+)/i);
    if (m) id = m[1];
  }
  return { id, href: location.href, title: top ? document.title : "", login: location.hostname === "nid.naver.com" };
}

// 검색 결과 화면: 글 링크마다 제목·날짜·미리보기 (LX3 수집기와 같은 방식)
function scanSearchInFrame() {
  const body = document.body;
  const top = window === window.top || window.parent === window.top;
  if (!body) return { items: [], noResult: false, href: location.href, top, title: top ? document.title : "" };
  const pageText = body.innerText || "";
  const noResult = /검색\s*결과가\s*없|검색된\s*(?:게시물|게시글|글)이\s*없|등록된\s*(?:게시물|게시글)이\s*없/.test(pageText);
  const idOf = (href) => {
    href = String(href || "");
    let m = href.match(/\/cafes\/(\d+)\/articles\/(\d+)/);
    if (m) return { cafeId: m[1], articleId: m[2], slug: "" };
    m = href.match(/\/cafes\/([A-Za-z][\w-]*)\/articles\/(\d+)/);
    if (m) return { cafeId: "", articleId: m[2], slug: m[1] };
    m = href.match(/[?&]articleid=(\d+)/i);
    if (m) {
      const c = href.match(/[?&]clubid=(\d+)/i);
      return { cafeId: c ? c[1] : "", articleId: m[1], slug: "" };
    }
    m = href.match(/^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9][\w-]*)\/(\d+)(?:[?#/]|$)/);
    if (m && !/^(f-e|ca-fe|cafes)$/.test(m[1])) return { cafeId: "", articleId: m[2], slug: m[1] };
    return null;
  };
  const anchors = [];
  for (const a of document.querySelectorAll("a, [href], [data-href], [data-url], [data-article-id], [data-articleid], [onclick]")) {
    const cands = [a.href, a.getAttribute("href"), a.getAttribute("onclick")];
    for (const at of a.attributes) if (at.name.startsWith("data-")) cands.push(/article.?id$/i.test(at.name) ? `articleid=${at.value}` : at.value);
    for (const c of cands) {
      const id = c && idOf(c);
      if (id) {
        anchors.push({ a, ...id });
        break;
      }
    }
  }
  const idsIn = (e) => {
    const s = new Set();
    for (const x of anchors) if (e.contains(x.a)) s.add(x.articleId);
    return s;
  };
  const groups = new Map();
  for (const x of anchors) {
    let e = x.a;
    while (e.parentElement && e.parentElement !== body && idsIn(e.parentElement).size <= 1) e = e.parentElement;
    if (!groups.has(x.articleId)) groups.set(x.articleId, { ...x, box: e, anchors: [] });
    const g = groups.get(x.articleId);
    if (e.contains(g.box)) g.box = e;
    g.anchors.push(x.a);
    if (!g.cafeId && x.cafeId) g.cafeId = x.cafeId;
    if (!g.slug && x.slug) g.slug = x.slug;
  }
  const clean = (t) => String(t || "").replace(/\s+/g, " ").replace(/\s*\[\d+\]\s*$/, "").replace(/\s*(?:new|N)\s*$/i, "").trim();
  const items = [];
  for (const g of groups.values()) {
    let best = null;
    let bestScore = -1;
    for (const a of g.anchors) {
      const titleEl = a.querySelector("[class*='title'], [class*='tit'], [class*='subject'], strong");
      const t = clean((titleEl || a).innerText);
      if (!t || /^\[?\d+\]?$/.test(t) || /^댓글/.test(t)) continue;
      const cls = `${a.className} ${a.parentElement?.className || ""}`;
      const score = (/title|tit|subject|article/i.test(cls) ? 2 : 0) + (best === null ? 1 : 0) + (t.length <= 120 ? 1 : 0);
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    if (!best) continue;
    const dateEl = g.box.querySelector('[class*="date"], [class*="Date"], time, .td_date');
    const cm = String(g.box.innerText || "").match(/댓글\s*([\d,]+)|\[(\d+)\]/);
    items.push({
      cafeId: g.cafeId,
      articleId: g.articleId,
      slug: g.slug,
      title: best,
      dateText: dateEl ? dateEl.innerText : g.box.innerText,
      text: String(g.box.innerText || "").replace(/\s+/g, " ").slice(0, 600),
      ccount: cm ? +(cm[1] || cm[2]).replace(/,/g, "") : null,
    });
  }
  return { items, noResult, href: location.href, top, title: top ? document.title : "" };
}

// 게시글 화면: 제목·작성 시각·본문 앞부분·댓글 전체 (댓글 페이지 버튼을 사람처럼 천천히 눌러 가며)
async function readArticleInFrame(pageDelay) {
  if (!document.querySelector(".ArticleContentBox, .article_container, li.CommentItem, .CommentBox, .title_text")) return { found: false, href: location.href };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (sels) => {
    for (const s of sels) {
      const e = document.querySelector(s);
      if (e && e.innerText && e.innerText.trim()) return e.innerText.trim();
    }
    return "";
  };
  const comments = [];
  const seen = new Set();
  const visited = new Set();
  for (let guard = 0; guard < 300; guard++) {
    for (const li of document.querySelectorAll("li.CommentItem")) {
      const q = (sel) => li.querySelector(sel)?.innerText.trim() || "";
      const row = {
        id: li.id || "",
        isReply: li.classList.contains("CommentItem--reply"),
        nickname: q(".comment_nickname"),
        content: q(".text_comment"),
        date: q(".comment_info_date"),
        deleted: !!li.querySelector(".comment_deleted, .comment_delete"),
      };
      const key = row.id || `${row.nickname}|${row.date}|${row.content}`;
      if (!seen.has(key)) {
        seen.add(key);
        comments.push(row);
      }
    }
    const current = document.querySelector(".CommentBox .ArticlePaginate button[aria-pressed='true']");
    if (current) visited.add(current.innerText.trim());
    let next = null;
    for (const btn of document.querySelectorAll(".CommentBox .ArticlePaginate button")) {
      const label = btn.innerText.trim();
      if (/^\d+$/.test(label) && !visited.has(label)) {
        next = btn;
        visited.add(label);
        break;
      }
    }
    if (!next) break;
    next.click();
    await wait(pageDelay[0] + Math.floor(Math.random() * (pageDelay[1] - pageDelay[0])));
  }
  const canonical = [];
  for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]']) {
    const e = document.querySelector(sel);
    const v = e && (e.getAttribute("content") || e.getAttribute("href"));
    if (v) canonical.push(v);
  }
  return {
    found: true,
    href: location.href,
    pageTitle: window === window.top || window.parent === window.top ? document.title : "",
    canonical,
    title: pick([".title_text", ".ArticleTitle .title_text", "h3.title_text"]),
    date: pick([".article_info .date", ".WriterInfo .date", ".ArticleWriterProfile .date"]),
    body: pick([".se-main-container", ".ContentRenderer", ".article_viewer", ".article_container .content"]).slice(0, 3000),
    comments,
  };
}

// 카페 화면 제목 → 동호회 이름 ('… : 네이버 카페', 앞에 붙은 메뉴 이름 떼기)
function cafeTitle(title) {
  const t = String(title || "")
    .replace(/\s*[:|-]\s*네이버\s*카페\s*$/, "")
    .replace(/^\s*(?:전체글보기|전체\s*글|검색\s*결과|인기글)\s*[,:|]\s*/, "")
    .trim();
  return /^네이버\s*카페$/.test(t) ? "" : t;
}

// ---------------------------------------------------------------------------
// 수집기
// ---------------------------------------------------------------------------

class CafeCollector {
  constructor({ delays, log, isStopped }) {
    this.delays = delays;
    this.log = log;
    this.isStopped = isStopped;
  }

  async wait(range) {
    const end = Date.now() + randomBetween(range);
    while (Date.now() < end) {
      if (this.isStopped()) throw new StopError("중지됨");
      await sleep(Math.min(500, end - Date.now()));
    }
  }

  // 카페 주소(영문) → 숫자 번호. 한 번 알아낸 번호는 기억해 둔다
  async clubId(cafe) {
    if (/^\d+$/.test(cafe.slug)) return cafe.slug;
    const { imrClubIds = {} } = await chrome.storage.local.get("imrClubIds").catch(() => ({}));
    if (imrClubIds[cafe.slug]) return imrClubIds[cafe.slug];
    const res = await readPage(
      `https://cafe.naver.com/${cafe.slug}`,
      async (where) => {
        for (let i = 0; i < 6; i++) {
          const infos = await runInFrames(where, cafeInfoInFrame);
          const hit = infos.find((x) => x.id);
          if (hit) return hit;
          if (infos.some((x) => x.login)) return { login: true };
          await sleep(1500);
        }
        return null;
      },
      (r) => r && (r.id || r.login),
    );
    if (res?.login) throw new Error("네이버 로그인이 필요합니다");
    if (!res?.id) throw new Error("카페 번호를 찾지 못했습니다 (카페 주소 확인)");
    imrClubIds[cafe.slug] = res.id;
    await chrome.storage.local.set({ imrClubIds }).catch(() => {});
    return res.id;
  }

  searchUrl(clubId, q, page) {
    return `https://cafe.naver.com/f-e/cafes/${clubId}/menus/0?viewType=L&ta=ARTICLE_COMMENT&page=${page}&q=${encodeURIComponent(q)}`;
  }

  async scanSearch(url) {
    return readPage(
      url,
      async (where) => {
        let last = { items: [], noResult: false, login: false, title: "" };
        let emptyInRow = 0;
        for (let i = 0; i < 14; i++) {
          const frames = await runInFrames(where, scanSearchInFrame);
          last = {
            items: frames.flatMap((f) => f.items || []),
            noResult: frames.some((f) => f.noResult),
            login: frames.some((f) => /nid\.naver\.com/.test(f.href || "")),
            title: frames.find((f) => f.top)?.title || "",
          };
          if (last.items.length || last.login) break;
          emptyInRow = last.noResult ? emptyInRow + 1 : 0;
          if (emptyInRow >= 4) break;
          await sleep(1500);
        }
        return last;
      },
      (r) => r && (r.items.length || r.noResult || r.login),
    );
  }

  // 한 카페에서 검색어들로 기간 안의 글 찾기 → [{key, url, title, date, exact, snippet, ccount}]
  async search(cafe, queries, range, maxPages) {
    const clubId = await this.clubId(cafe);
    const found = new Map();
    for (const q of queries) {
      let prevKeys = "";
      for (let page = 1; page <= maxPages; page++) {
        if (this.isStopped()) throw new StopError("중지됨");
        const res = await this.scanSearch(this.searchUrl(clubId, q, page));
        if (!res) {
          this.log(`  · ${cafe.name} "${q}" ${page}페이지: 화면을 읽지 못함`, "err");
          break;
        }
        if (res.login) throw new Error("네이버 로그인이 필요합니다");
        const full = cafeTitle(res.title);
        if (full) cafe.fullName = full;
        const items = res.items.filter((x) => !x.cafeId || x.cafeId === clubId);
        const keys = items.map((x) => x.articleId).join(",");
        if (!items.length || keys === prevKeys) break;
        prevKeys = keys;
        let older = 0;
        let dated = 0;
        for (const x of items) {
          const parsed = parseKoreanDate(x.dateText);
          const place = placeInRange(parsed, range);
          if (parsed) dated++;
          if (place === "older") older++;
          if (place === "older" || place === "newer") continue;
          const key = `cafe:${cafe.slug}/${x.articleId}`;
          if (found.has(key)) continue;
          found.set(key, {
            key,
            channel: "cafe",
            source: cafe.fullName || cafe.name,
            cafeSlug: cafe.slug,
            clubId,
            articleId: x.articleId,
            url: `https://cafe.naver.com/${/^\d+$/.test(cafe.slug) ? `f-e/cafes/${clubId}/articles` : cafe.slug}/${x.articleId}`,
            title: x.title,
            date: parsed ? parsed.date.getTime() : null,
            exact: !!parsed?.exact,
            snippet: x.text,
            ccount: x.ccount,
          });
        }
        if (dated && older === dated) break; // 이 페이지가 모두 기간 이전
        if (page < maxPages) await this.wait(this.delays.page);
      }
      await this.wait(this.delays.page);
    }
    return [...found.values()];
  }

  // 글 열어서 읽기 (작성 시각 확인·본문·댓글)
  async readArticle(post) {
    const url = post.clubId ? `https://cafe.naver.com/f-e/cafes/${post.clubId}/articles/${post.articleId}` : post.url;
    const res = await readPage(
      url,
      async (where) => {
        for (let i = 0; i < 8; i++) {
          const answers = await runInFrames(where, readArticleInFrame, [[2000, 4000]]);
          const hit = answers.find((r) => r.found && (r.title || r.comments.length));
          if (hit) return hit;
          if (answers.some((r) => /nid\.naver\.com/.test(r.href || ""))) return { found: false, login: true };
          await sleep(1500);
        }
        return { found: false };
      },
      (r) => r && (r.found || r.login),
    );
    if (res?.login) throw new Error("네이버 로그인이 필요합니다");
    if (!res?.found) throw new Error("글을 읽지 못함 (카페 가입이 필요하거나, 삭제됐거나, 댓글을 막은 글일 수 있음)");
    const parsed = parseKoreanDate(res.date);
    return {
      title: res.title,
      source: cafeTitle(res.pageTitle),
      date: parsed ? parsed.date.getTime() : null,
      exact: !!parsed?.exact,
      body: res.body,
      comments: res.comments
        .filter((c) => !c.deleted && c.content)
        .map((c) => {
          const d = parseKoreanDate(c.date);
          return { text: c.content, writtenAt: c.date, date: d ? d.date.getTime() : null, isReply: c.isReply, author: c.nickname };
        }),
    };
  }
}
