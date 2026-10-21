// 자동차 커뮤니티(보배드림·클리앙·뽐뿌): 로그인이 필요 없는 공개 게시판이라 목록·게시글 화면을 직접 받아 읽는다.
// 게시판 목록을 최신 글부터 기간 끝까지 넘기며 제목에 키워드 조합이 있는 글을 고르고, 고른 글의 댓글을 읽는다.

const COMMUNITY_MAX_LIST_PAGES = 80;

function safeUrl(href, base) {
  try {
    return new URL(String(href).replace(/&amp;/g, "&"), base);
  } catch {
    return null;
  }
}

// 사이트별 읽는 방법 (게시판 주소로 어떤 사이트인지 고른다)
function communityAdapter(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^m\./, "www.");

  if (host.endsWith("bobaedream.co.kr")) {
    const code = u.searchParams.get("code") || "national";
    return {
      site: "보배드림",
      domain: "bobaedream.co.kr",
      listUrl: (p) => `https://www.bobaedream.co.kr/list?code=${encodeURIComponent(code)}&page=${p}`,
      articleId: (href) => {
        const a = safeUrl(href, "https://www.bobaedream.co.kr/");
        if (!a || !/bobaedream\.co\.kr$/.test(a.hostname) || a.pathname !== "/view") return null;
        const no = a.searchParams.get("No") || a.searchParams.get("no");
        return a.searchParams.get("code") === code && /^\d+$/.test(no || "") ? no : null;
      },
      articleUrl: (id) => `https://www.bobaedream.co.kr/view?code=${encodeURIComponent(code)}&No=${id}`,
      bodySelectors: [".bodyCont", ".content02", "#print_area .article-body"],
      dateSelectors: [".writerProfile .countGroup", ".writerProfile", ".countGroup"],
      commentItems: [".commentlistbox li", "#cmt_list li", ".cmt_list li", "ul.basiclist li"],
      commentText: ["dd[id^='small_cmt']", ".cmt_txt", ".txt", "dd"],
      commentDate: [".date", "dt .date", "dt"],
    };
  }

  if (host.endsWith("clien.net")) {
    const m = u.pathname.match(/\/service\/board\/([^/?#]+)/);
    const board = m ? m[1] : "cm_car";
    return {
      site: "클리앙",
      domain: "clien.net",
      listUrl: (p) => `https://www.clien.net/service/board/${board}?&od=T31&po=${p - 1}`,
      articleId: (href) => {
        const mm = String(href).match(new RegExp(`/service/board/${board}/(\\d+)`));
        return mm ? mm[1] : null;
      },
      articleUrl: (id) => `https://www.clien.net/service/board/${board}/${id}`,
      bodySelectors: [".post_article", ".post_content", ".post_view"],
      dateSelectors: [".post_author .view_count.date", ".post_author", ".post_information"],
      commentItems: [".comment_row", ".comment .comment_row"],
      commentText: [".comment_view", ".comment_content"],
      commentDate: [".timestamp", ".comment_time", ".comment_info"],
    };
  }

  if (host.endsWith("ppomppu.co.kr")) {
    const id = u.searchParams.get("id") || "car";
    return {
      site: "뽐뿌",
      domain: "ppomppu.co.kr",
      listUrl: (p) => `https://www.ppomppu.co.kr/zboard/zboard.php?id=${encodeURIComponent(id)}&page=${p}`,
      articleId: (href) => {
        if (!/view\.php/.test(href)) return null;
        const q = String(href).replace(/&amp;/g, "&");
        const idm = q.match(/[?&]id=([^&#]+)/);
        const nm = q.match(/[?&]no=(\d+)/);
        return idm && nm && idm[1] === id ? nm[1] : null;
      },
      articleUrl: (no) => `https://www.ppomppu.co.kr/zboard/view.php?id=${encodeURIComponent(id)}&no=${no}`,
      bodySelectors: [".board-contents", "td.board-contents", ".view-contents"],
      dateSelectors: [".sub-top-text-box", ".topTitle-mainbox", ".view_info", "td.han"],
      commentItems: [".comment_wrapper", "div[id^='comment_'] .comment_line", ".comment_line", ".cmAr .sect-cmt"],
      commentText: ["div[id^='commentContent']", ".comment_template .han", ".mid-text-area", ".han", ".ov"],
      commentDate: [".eng-day", ".comment_date", ".date"],
    };
  }

  // 그 밖의 사이트: 같은 주소의 숫자로 끝나는 링크를 글로 보는 일반 방식 (정확도 낮음)
  return {
    site: u.hostname,
    domain: u.hostname.replace(/^www\./, ""),
    generic: true,
    listUrl: (p) => {
      const x = new URL(url);
      if (p > 1) x.searchParams.set("page", p);
      return x.toString();
    },
    articleId: (href) => {
      const a = safeUrl(href, url);
      if (!a || a.hostname !== u.hostname) return null;
      return /(\d{4,})(?!.*\d{4,})/.test(a.pathname + a.search) ? `${a.pathname}${a.search}` : null;
    },
    articleUrl: (p) => new URL(p, url).toString(),
    bodySelectors: ["article", ".content", "#content", ".post", ".view"],
    dateSelectors: [],
    commentItems: ["[class*='comment'] li", "[class*='comment_row']", "[class*='reply'] li"],
    commentText: ["[class*='text']", "[class*='content']", "p"],
    commentDate: ["[class*='date']", "time"],
  };
}

// 글 링크가 들어 있는 한 줄에서 날짜·공지 여부를 읽는다
function rowInfo(a, title, ad) {
  let e = a.parentElement;
  let found = null;
  let rowEl = null;
  for (let depth = 0; e && depth < 8; depth++, e = e.parentElement) {
    const ids = new Set();
    for (const x of e.querySelectorAll("a[href]")) {
      const id = ad.articleId(x.getAttribute("href") || "");
      if (id) ids.add(id);
    }
    if (ids.size > 1) break;
    if (/^(TR|LI)$/.test(e.tagName) || /item|row|list/i.test(e.className || "")) rowEl = e;
    let parsed = null;
    for (const x of e.querySelectorAll("[title]")) {
      const p = parseKoreanDate(x.getAttribute("title"));
      if (p && p.exact) {
        parsed = p;
        break;
      }
    }
    if (!parsed) parsed = parseKoreanDate(spacedText(e).replace(title, " "));
    if (parsed) {
      found = parsed;
      rowEl = rowEl || e;
      if (parsed.exact) break;
    }
  }
  const r = rowEl || a.parentElement;
  const notice = r ? /공지|notice/i.test(`${r.className || ""} ${r.querySelector("img[alt]")?.getAttribute("alt") || ""}`) : false;
  // 댓글 수: [18] · 댓글 18 · 숫자만 든 댓글 칸(뽐뿌 list_comment2, 보배드림 totreply 등)
  let ccount = null;
  if (r) {
    for (const x of r.querySelectorAll("[class*='comment'],[class*='cmt'],[class*='reply'],[class*='Comment'],[class*='Reply']")) {
      const m = textOf(x).match(/^[\[(]?\s*(\d{1,5})\s*[\])]?$/);
      if (m) {
        ccount = +m[1];
        break;
      }
    }
    if (ccount == null) {
      const cm = spacedText(r).replace(title, " ").match(/\[(\d+)\]|댓글\s*(\d+)/);
      if (cm) ccount = +(cm[1] || cm[2]);
    }
  }
  return { parsed: found, notice, ccount };
}

class CommunityCollector {
  // ai: 화면 구조로 못 읽은 댓글을 화면 글자에서 골라내는 AI (AiClient, 없으면 null)
  constructor({ delays, log, isStopped, ai = null }) {
    this.ai = ai;
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

  // 429·503 이면 1분 쉬었다가 한 번 더
  async fetchDoc(url) {
    try {
      return await fetchDocument(url);
    } catch (e) {
      if (!/^(429|503) /.test(e.message)) throw e;
      this.log(`  · ${new URL(url).hostname}: 요청이 많다는 응답 → 1분 쉬고 다시 시도`, "err");
      await this.wait([60000, 75000]);
      return fetchDocument(url);
    }
  }

  // 게시판 목록에서 기간 안 + 제목에 키워드 조합이 있는 글
  async search(site, kw, range) {
    const ad = communityAdapter(site.url);
    const all = new Map();
    let prevIds = "";
    let scanned = 0;
    for (let page = 1; page <= COMMUNITY_MAX_LIST_PAGES; page++) {
      if (this.isStopped()) throw new StopError("중지됨");
      const doc = await this.fetchDoc(ad.listUrl(page));
      const items = new Map();
      for (const a of doc.querySelectorAll("a[href]")) {
        const id = ad.articleId(a.getAttribute("href") || "");
        if (!id) continue;
        const title = textOf(a).replace(/\s+/g, " ");
        const prev = items.get(id);
        if (prev) {
          if (title.length > prev.title.length && !/^\[?\d+\]?$/.test(title)) prev.title = title;
          continue;
        }
        items.set(id, { title, ...rowInfo(a, title, ad) });
      }
      const rows = [...items.entries()].filter(([, it]) => it.title.length >= 2 && !/^\[?\d+\]?$/.test(it.title));
      if (!rows.length) {
        if (page === 1) throw new Error("글 목록을 읽지 못했습니다 (게시판 주소나 화면 구조 확인 필요)");
        break;
      }
      const ids = rows.map(([id]) => id).join(",");
      if (ids === prevIds) break;
      prevIds = ids;
      const dated = rows.filter(([, it]) => it.parsed);
      if (!dated.length) {
        if (page === 1) throw new Error("목록에서 글 날짜를 읽지 못했습니다 (화면 구조 확인 필요)");
        break;
      }
      let older = 0;
      for (const [id, it] of dated) {
        const place = placeInRange(it.parsed, range);
        if (place === "older") older++;
        if (place === "older" || place === "newer" || it.notice) continue;
        scanned++;
        if (!matchesKeywords(it.title, kw)) continue;
        const key = `${ad.domain}:${id}`;
        if (!all.has(key)) {
          all.set(key, {
            key,
            channel: "community",
            source: site.name || ad.site,
            domain: ad.domain,
            siteUrl: site.url,
            url: ad.articleUrl(id),
            title: it.title,
            date: it.parsed.date.getTime(),
            exact: it.parsed.exact,
            snippet: "",
            ccount: it.ccount,
          });
        }
      }
      if (older * 2 >= dated.length || ad.generic) break;
      await this.wait(this.delays.community);
    }
    this.log(`  · ${site.name}: 기간 안 글 ${scanned}건 확인, 키워드 맞는 글 ${all.size}건`);
    return [...all.values()];
  }

  // 게시글: 본문·작성 시각·댓글. 댓글은 반드시 읽어 낸다:
  // 1) 받아 온 화면에서 (사이트별 칸 이름 → 몰라도 '댓글'이 반복되는 덩어리)
  // 2) 0개이거나 화면에 보이는 댓글 수보다 모자라면 → 실제 탭으로 열어 끝까지 내리고 '더보기'를 눌러 다 그린 뒤 다시
  // 3) 그래도 모자라면 → 탭 화면의 글자를 AI 가 읽어 댓글만 그대로 골라냄
  // 4) 그래도 댓글 수가 보이는데 하나도 못 읽었으면 → 실패로 돌려 '못 읽은 글만 다시' 대상이 되게 함 (0개로 끝내지 않음)
  async readArticle(post) {
    const ad = communityAdapter(post.siteUrl || post.url);
    const sel = { items: ad.commentItems, text: ad.commentText, date: ad.commentDate };
    const doc = await this.fetchDoc(post.url);
    let body = "";
    for (const s of ad.bodySelectors) {
      const e = doc.querySelector(s);
      if (e && textOf(e)) {
        body = textOf(e);
        break;
      }
    }
    let date = null;
    const dateTexts = ad.dateSelectors.map((s) => textOf(doc.querySelector(s))).filter(Boolean);
    for (const t of [...dateTexts, textOf(doc.body).slice(0, 6000)]) {
      const m = t.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})[^\d]{0,12}(\d{1,2}):(\d{2})/);
      if (m) {
        date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
        break;
      }
    }
    const fetched = findCommentsIn(doc, sel);
    let comments = fetched.comments;
    let how = fetched.how;
    let expected = Math.max(expectedCommentCount(doc), post.listCcount ?? post.ccount ?? 0);
    const enough = () => comments.length > 0 && comments.length >= Math.ceil(expected * 0.8);
    let live = null;
    let aiNone = false;
    if (!enough()) {
      live = await this.readInTab(post.url, sel, expected).catch((e) => {
        this.log(`  · 탭으로 열어 읽기 실패: ${korMsg(e.message)}`, "err");
        return null;
      });
      if (live) {
        expected = Math.max(expected, live.expected || 0);
        if (live.comments.length > comments.length) {
          comments = live.comments;
          how = "탭으로 열어 다시 읽음";
        }
      }
    }
    if (!enough() && (expected > 0 || comments.length === 0) && this.ai) {
      const pageText = live && live.text ? live.text : String(doc.body ? doc.body.innerText || doc.body.textContent : "");
      if (expected > 0 || /댓글|코멘트|comment/i.test(pageText)) {
        this.log(`  · 화면 구조로 댓글을 다 못 읽어 AI 가 화면 글자에서 댓글을 골라냅니다 (보이는 댓글 수 ${expected || "?"}개, 읽은 수 ${comments.length}개)`);
        const got = await this.ai.extractComments({ title: post.title, body, pageText, expected });
        if (got.length > comments.length) {
          comments = got;
          how = "AI 화면 판독";
        } else if (!got.length && !comments.length && !expected) aiNone = true; // 댓글 수도 안 보이고 AI 도 못 찾음 = 댓글 없는 글
      }
    }
    const diag = enough() ? null : { url: post.url, expected, got: comments.length, fetched: fetched.groups, live: live ? live.groups : null };
    if (expected > 0 && !comments.length)
      throw new Error(`화면에 댓글 ${expected}개가 보이는데 읽지 못했습니다${this.ai ? " (탭·AI 판독 모두 실패 — 잠시 뒤 '못 읽은 글만 다시')" : " (⚙ 설정에 API 키를 넣으면 AI 가 화면에서 댓글을 골라 읽습니다)"}`);
    const out = [];
    const seen = new Set();
    for (const c of comments) {
      const t = String(c.text || "").replace(/\s+/g, " ").trim();
      if (!t || /^(삭제된 댓글|삭제 된 댓글|블라인드)/.test(t) || seen.has(t)) continue;
      seen.add(t);
      const d = parseKoreanDate(c.dateText);
      out.push({ text: t, writtenAt: d ? fmtDateTime(d.date) : c.dateText || "", date: d ? d.date.getTime() : null, isReply: !!c.isReply, author: "" });
    }
    return { body: body.slice(0, 3000), date, comments: out, expected, how, diag, aiNone };
  }

  // 뒤쪽 탭으로 글을 열어 끝까지 내리고 댓글 '더보기'를 눌러 다 그린 뒤 화면에서 댓글 읽기
  // → { comments, groups, expected(화면의 댓글 수), text(화면 글자, AI 판독용) }
  async readInTab(url, sel, expected) {
    const tab = await chrome.tabs.create({ url, active: false });
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
      let best = { comments: [], groups: [], expected: 0, text: "" };
      let stable = 0;
      for (let round = 0; round < 8 && !this.isStopped(); round++) {
        const prep = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: expandCommentPage }).catch((e) => (this.log(`  · 탭 화면 펼치기 실패: ${e.message}`, "err"), []));
        await sleep(1500);
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: findCommentsIn, args: [null, sel] }).catch((e) => (this.log(`  · 탭 화면 읽기 실패: ${e.message}`, "err"), []));
        const before = best.comments.length;
        for (const r of res) if (r.result && r.result.comments.length > best.comments.length) best = { ...best, ...r.result };
        for (const r of prep) {
          if (!r.result) continue;
          best.expected = Math.max(best.expected, r.result.expected || 0);
          if ((r.result.text || "").length > best.text.length) best.text = r.result.text;
        }
        const want = Math.max(expected || 0, best.expected);
        const clicked = prep.some((r) => r.result && r.result.clicked);
        stable = best.comments.length === before && !clicked ? stable + 1 : 0;
        if (best.comments.length && best.comments.length >= want && !clicked) break;
        if (stable >= 2 && (best.comments.length || round >= 3)) break;
      }
      return best;
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

// (탭 화면 안에서 실행) 끝까지 내리고 댓글 '더보기'·다음 댓글 쪽을 한 번 누른다 → { clicked, expected, text }
function expandCommentPage() {
  const se = document.scrollingElement || document.documentElement;
  if (se) se.scrollTop = se.scrollHeight;
  window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
  let clicked = false;
  const MORE = /^(댓글\s*)?(더\s*보기|더보기|이전\s*댓글|댓글\s*더|more|load more)(\s*[\[(]?\d*[\])]?)?\s*[▼+]?$/i;
  for (const e of document.querySelectorAll("a, button, span[onclick], div[onclick]")) {
    const t = String(e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 30 || !MORE.test(t)) continue;
    const near = `${e.className || ""} ${e.id || ""} ${e.closest("[class*='comment'],[class*='cmt'],[class*='reply'],[id*='comment'],[id*='cmt']") ? "comment" : ""}`;
    if (!/comment|cmt|reply|댓글/i.test(near + t)) continue;
    if (e.dataset.imrClicked) continue;
    e.dataset.imrClicked = "1";
    try {
      e.click();
      clicked = true;
    } catch {}
  }
  const text = String((document.body && document.body.innerText) || "");
  let expected = 0;
  for (const m of text.replace(/\s+/g, " ").matchAll(/(?:댓글|코멘트|comment)s?\s*[\[(:：]?\s*(\d{1,4})\s*[\])]?(?:\s*개)?/gi)) expected = Math.max(expected, +m[1]);
  return { clicked, expected, text: text.slice(0, 60000) };
}

// 화면에 보이는 댓글 수 ("댓글 18", "댓글 [18]", "Comment 18")
function expectedCommentCount(doc) {
  const t = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ");
  let n = 0;
  for (const m of t.matchAll(/(?:댓글|코멘트|comment)s?\s*[\[(:：]?\s*(\d{1,4})\s*[\])]?(?:\s*개)?/gi)) n = Math.max(n, +m[1]);
  return n;
}

// 화면 구조를 몰라도 댓글 찾기 (받아 온 문서에도, 탭 화면 안에서도 쓰므로 혼자 동작해야 함)
// 이름(class·id)에 comment·cmt·reply·댓글 이 들어간 요소를 모양별로 묶어, 댓글처럼 반복되는 묶음을 고른다.
// sel: 사이트별 칸 이름 { items, text, date } — 있으면 먼저 써 본다
// → { comments: [{ text, dateText, isReply }], groups: [진단용 묶음 요약], how }
function findCommentsIn(root, sel) {
  const doc = root && root.querySelectorAll ? root : document;
  const T = (e) => String((e && (e.innerText || e.textContent)) || "").replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  // 1) 사이트별 칸 이름
  if (sel && sel.items) {
    for (const s of sel.items) {
      const out = [];
      for (const n of doc.querySelectorAll(s)) {
        let t = "";
        for (const ts of sel.text || []) {
          const e = n.querySelector(ts);
          if (e && T(e)) {
            t = T(e);
            break;
          }
        }
        if (!t) continue;
        let dateText = "";
        for (const ds of sel.date || []) {
          const e = n.querySelector(ds);
          if (e && /\d/.test(T(e))) {
            dateText = T(e);
            break;
          }
        }
        out.push({ text: t.slice(0, 2000), dateText, isReply: /re_|reply|depth|child|answer/i.test(String(n.className || "")) });
      }
      if (out.length) return { comments: out, groups: [{ sig: s, n: out.length }], how: "칸 이름" };
    }
  }
  const COMMENT = /comment|cmt|reply|댓글|memo/i;
  const TEXTY = /content|text|txt|memo|body|cont|desc|view/i;
  const NOISE = /^(답글|답변|댓글|추천|반대|신고|삭제|수정|더보기|접기|등록|취소|\d+|[\d\s:./-]+)$/;
  const DATE = /20\d{2}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}\.?\s*\d{1,2}:\d{2}(?::\d{2})?|\d{2}[.\-/]\d{2}[.\-/]\d{2}\s+\d{1,2}:\d{2}|\d+\s*(?:분|시간|일)\s*전|(?:^|\s)\d{1,2}:\d{2}(?::\d{2})?(?=\s|$)/;
  const sigOf = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).sort().join(".") : "";
    return `${el.tagName}.${cls}#${String(el.id || "").replace(/\d+/g, "N")}`;
  };
  const groups = new Map();
  for (const el of doc.querySelectorAll("[id],[class]")) {
    const sig = sigOf(el);
    if (!COMMENT.test(sig)) continue;
    if (/^(SCRIPT|STYLE|TEXTAREA|INPUT|BUTTON|FORM|SELECT|IMG)$/.test(el.tagName)) continue;
    if (el.querySelector("textarea, input[type=text]")) continue; // 댓글 쓰는 칸
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(el);
  }
  const cands = [];
  for (const [sig, els] of groups) {
    const items = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
    const texts = items.map(T).filter((t) => t.length >= 2 && !NOISE.test(t));
    if (!texts.length) continue;
    const avg = texts.reduce((a, t) => a + t.length, 0) / texts.length;
    if (avg < 3 || avg > 2000) continue;
    const texty = TEXTY.test(sig);
    const numbered = /#.*N/.test(sig);
    cands.push({ sig, items, n: texts.length, texty, numbered, avg, score: texts.length * (1 + (texty ? 0.6 : 0) + (numbered ? 0.6 : 0)) });
  }
  cands.sort((a, b) => b.score - a.score);
  const summary = cands.slice(0, 8).map((c) => ({ sig: c.sig, n: c.n, avg: Math.round(c.avg), sample: (c.items[0].outerHTML || "").slice(0, 600) }));
  const best = cands[0];
  if (!best) return { comments: [], groups: summary, how: "" };
  // 덩어리 안에서 댓글 글자: 내용·글자 이름이 붙은 칸 → 없으면 가장 긴 글 줄(닉네임·날짜·버튼 글자 제외)
  const pickText = (item) => {
    if (best.texty) return T(item);
    let bestT = "";
    for (const e of item.querySelectorAll("*")) {
      const sig = sigOf(e);
      if (TEXTY.test(sig) && !/date|time|nick|name|writer|btn|button/i.test(sig)) {
        const t = T(e);
        if (t.length > bestT.length && !NOISE.test(t)) bestT = t;
      }
    }
    if (bestT) return bestT;
    const lines = T(item)
      .split("\n")
      .map((l) => l.replace(DATE, " ").trim())
      .filter((l) => l.length >= 2 && !NOISE.test(l));
    return lines.sort((a, b) => b.length - a.length)[0] || "";
  };
  const comments = [];
  for (const item of best.items) {
    const text = pickText(item);
    if (!text || NOISE.test(text)) continue;
    // 날짜: 이 댓글만 담은 가까운 조상까지 올라가며 찾기
    let dateText = "";
    for (let e = item, k = 0; e && k < 4 && !dateText; k++, e = e.parentElement) {
      if (k > 0 && best.items.filter((x) => e.contains(x)).length > 1) break;
      const m = T(e).match(DATE);
      if (m) dateText = m[0].trim();
    }
    const cls = `${item.className || ""} ${item.parentElement ? item.parentElement.className || "" : ""}`;
    comments.push({ text: text.slice(0, 2000), dateText, isReply: /re_|reply|depth|child|answer/i.test(String(cls)) });
  }
  return { comments, groups: summary, how: comments.length ? "반복 덩어리" : "" };
}