// 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등) 수집
// 로그인이 필요 없는 공개 게시판이라 목록/게시글 페이지를 직접 받아(fetch) 읽는다. 페이지 사이에 잠깐씩 쉰다.

// 사이트별 읽는 방법. 설정에 넣은 게시판 주소로 어떤 사이트인지 고른다.
function communityAdapter(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^m\./, "www.");

  if (host.endsWith("bobaedream.co.kr")) {
    const code = u.searchParams.get("code") || "national";
    return {
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
      viewSelectors: [".writerProfile .countGroup", ".countGroup"],
      commentCountSelectors: [".commentWrap .cmtTit em", ".cmtTit strong", "#cmt_reply_count", ".commentCount", ".cmt_num"],
      commentItemSelectors: [".commentlistbox li", "#cmt_list li", ".commentList li", ".cmt_list > li"],
    };
  }

  if (host.endsWith("clien.net")) {
    const m = u.pathname.match(/\/service\/board\/([^/?#]+)/);
    const board = m ? m[1] : "cm_car";
    return {
      listUrl: (p) => `https://www.clien.net/service/board/${board}?&od=T31&po=${p - 1}`,
      articleId: (href) => {
        const mm = href.match(new RegExp(`/service/board/${board}/(\\d+)`));
        return mm ? mm[1] : null;
      },
      articleUrl: (id) => `https://www.clien.net/service/board/${board}/${id}`,
      bodySelectors: [".post_article", ".post_content", ".post_view"],
      dateSelectors: [".post_author .view_count.date", ".post_author", ".post_information"],
      // 클리앙: 조회수는 '조회' 글자 없이 눈 아이콘 + 숫자로만 나옴
      viewSelectors: [".post_author .view_count:not(.date)", ".view_info .view_count", ".post_view .view_count"],
      commentCountSelectors: [".post_reply .reply_count", ".comment_head .comment_count", ".comment_head strong", ".post_comment .reply_count"],
      commentItemSelectors: [".comment_row:not(.blocked)", ".comment .comment_row"],
    };
  }

  if (host.endsWith("ppomppu.co.kr")) {
    const id = u.searchParams.get("id") || "car";
    return {
      listUrl: (p) => `https://www.ppomppu.co.kr/zboard/zboard.php?id=${encodeURIComponent(id)}&page=${p}`,
      articleId: (href) => {
        if (!/view\.php/.test(href)) return null;
        const q = href.replace(/&amp;/g, "&");
        const idm = q.match(/[?&]id=([^&#]+)/);
        const nm = q.match(/[?&]no=(\d+)/);
        return idm && nm && idm[1] === id ? nm[1] : null;
      },
      articleUrl: (no) => `https://www.ppomppu.co.kr/zboard/view.php?id=${encodeURIComponent(id)}&no=${no}`,
      bodySelectors: [".board-contents", "td.board-contents", ".view-contents"],
      dateSelectors: [".sub-top-text-box", ".topTitle-mainbox", ".view_info", "td.han"],
      viewSelectors: [],
      commentCountSelectors: [".sub-top-text-box .list_comment2", ".topTitle-mainbox .list_comment2", "#comment_count", ".comment_count"],
      commentItemSelectors: ["#quote .comment_line", ".comment_wrapper .comment_line", "div[id^='commentContent_']", ".comment_line"],
    };
  }

  // 그 밖의 사이트: 같은 주소의 링크 중 번호로 끝나는 글 링크를 찾는 일반 방식 (정확도 낮음)
  return {
    generic: true,
    listUrl: (p) => {
      const x = new URL(url);
      if (p > 1) x.searchParams.set("page", p);
      return x.toString();
    },
    articleId: (href) => {
      let a;
      try {
        a = new URL(href, url);
      } catch {
        return null;
      }
      if (a.hostname !== u.hostname) return null;
      const m = (a.pathname + a.search).match(/(\d{4,})(?!.*\d{4,})/);
      return m ? `${a.pathname}${a.search}`.replace(/&amp;/g, "&") : null;
    },
    articleUrl: (pathAndQuery) => new URL(pathAndQuery, url).toString(),
    bodySelectors: ["article", ".content", "#content", ".post", ".view"],
    dateSelectors: [],
  };
}

function safeUrl(href, base) {
  try {
    return new URL(String(href).replace(/&amp;/g, "&"), base);
  } catch {
    return null;
  }
}

async function fetchDocument(url) {
  const res = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} 응답 (${url})`);
  const buf = await res.arrayBuffer();
  const ctype = res.headers.get("content-type") || "";
  let charset = (ctype.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  }
  let html;
  try {
    html = new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    html = new TextDecoder("utf-8").decode(buf);
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc;
}

// 칸(td)마다 글자가 붙어 "홍길동06:211234" 처럼 되지 않도록 글자 조각 사이에 공백을 넣어 읽는다
function spacedText(el) {
  if (!el) return "";
  const parts = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

// 눈에 보이는 글자만 (script·style 안의 글자는 빼고) — 조회수·댓글 수 찾기용
function visibleText(el) {
  if (!el) return "";
  const parts = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest("script, style, noscript, template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

function textOf(el) {
  return (el ? el.textContent : "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// 글 링크가 들어 있는 '한 줄'(행)을 찾아 날짜·공지 여부를 읽는다.
// 링크에서 위로 올라가며, 이 글 하나만 담고 있는 가장 큰 덩어리 안에서 날짜를 찾는다(표 안에 표가 있는 사이트 대비).
function rowInfo(a, title, ad) {
  let el = a.parentElement;
  let found = null;
  let rowEl = null;
  for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
    const ids = new Set();
    for (const x of el.querySelectorAll("a[href]")) {
      const id = ad.articleId(x.getAttribute("href") || "");
      if (id) ids.add(id);
    }
    if (ids.size > 1) break; // 다른 글까지 담기 시작함 → 그만
    if (/^(TR|LI)$/.test(el.tagName) || /item|row|list/i.test(el.className || "")) rowEl = el;
    // 마우스를 올리면 보이는 전체 날짜(title 속성)를 먼저, 그다음 화면 글자
    // (title 속성은 글 제목일 수도 있어 시각까지 있는 날짜만 믿는다)
    let parsed = null;
    for (const x of el.querySelectorAll("[title]")) {
      const p = parseKoreanDate(x.getAttribute("title"));
      if (p && p.exact) {
        parsed = p;
        break;
      }
    }
    if (!parsed) parsed = parseKoreanDate(spacedText(el).replace(title, " "));
    if (parsed) {
      found = parsed;
      rowEl = rowEl || el;
      if (parsed.exact) break;
    }
  }
  const r = rowEl || a.parentElement;
  const notice = r ? /공지|notice/i.test(`${r.className || ""} ${r.querySelector("img[alt]")?.getAttribute("alt") || ""}`) : false;
  return { parsed: found, notice };
}

class CommunityCollector {
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

  // 목록에서 기간 안의 글 → [{articleId, title, ts|null, exact, url}]
  // 429(요청이 너무 많음)·503 이면 1분 쉬었다가 한 번 더
  async fetchDoc(url) {
    try {
      return await fetchDocument(url);
    } catch (e) {
      if (!/^(429|503) /.test(e.message)) throw e;
      this.log(`${new URL(url).hostname}: 요청이 많다는 응답(${e.message.slice(0, 3)}) → 1분 쉬고 다시 시도`, "err");
      await this.wait([60000, 75000]);
      return fetchDocument(url);
    }
  }

  // 목록에서 기간 안의 글 → [{articleId, title, ts, exact, url}]
  async list(site, range) {
    const ad = communityAdapter(site.url);
    const all = new Map();
    let prevIds = "";
    for (let page = 1; page <= COMMUNITY_MAX_LIST_PAGES; page++) {
      if (this.isStopped()) throw new StopError("중지됨");
      const doc = await this.fetchDoc(ad.listUrl(page));
      const items = new Map(); // 이 페이지의 글 (id → {title, parsed, notice})
      for (const a of doc.querySelectorAll("a[href]")) {
        const id = ad.articleId(a.getAttribute("href") || "");
        if (!id) continue;
        const title = textOf(a).replace(/\s+/g, " ");
        const prev = items.get(id);
        if (prev) {
          if (title.length > prev.title.length && !/^\[?\d+\]?$/.test(title)) prev.title = title;
          continue;
        }
        const { parsed, notice } = rowInfo(a, title, ad);
        items.set(id, { title, parsed, notice });
      }
      const rows = [...items.entries()].filter(([, it]) => it.title.length >= 2 && !/^\[?\d+\]?$/.test(it.title));
      if (!rows.length) {
        if (page === 1) throw new Error("글 목록을 읽지 못했습니다 (게시판 주소나 화면 구조 확인 필요)");
        break;
      }
      const ids = rows.map(([id]) => id).join(",");
      if (ids === prevIds) break; // 페이지를 넘겨도 같은 글 → 마지막 페이지
      prevIds = ids;
      const dated = rows.filter(([, it]) => it.parsed);
      if (!dated.length) {
        if (page === 1) throw new Error("목록에서 글 날짜를 읽지 못했습니다 (화면 구조 확인 필요)");
        break;
      }
      for (const [id, it] of dated) {
        if (!mayBeInRange(it.parsed, range)) continue;
        if (it.notice && !inRange(it.parsed.date, range)) continue;
        if (!all.has(id)) all.set(id, { articleId: id, title: it.title, ts: it.parsed.date.getTime(), exact: it.parsed.exact, url: ad.articleUrl(id) });
      }
      const forStop = dated.map(([, it]) => ({ ts: it.parsed.date.getTime(), exact: it.parsed.exact, notice: it.notice }));
      if (pageIsPastRange(forStop, range) || ad.generic) break;
      await this.wait(this.delays.community);
    }
    return [...all.values()];
  }

  async readArticle(site, post) {
    const ad = communityAdapter(site.url);
    const doc = await this.fetchDoc(post.url);
    let body = "";
    for (const s of ad.bodySelectors) {
      const el = doc.querySelector(s);
      if (el && textOf(el)) {
        body = textOf(el);
        break;
      }
    }
    if (!body) {
      // 가장 글자가 많고 링크가 적은 덩어리
      let best = "";
      for (const el of doc.querySelectorAll("div, td, article, section")) {
        const t = textOf(el);
        if (t.length > best.length && t.length < 20000 && el.querySelectorAll("a").length < 15) best = t;
      }
      body = best;
    }
    let ts = null;
    const dateTexts = ad.dateSelectors.map((s) => textOf(doc.querySelector(s))).filter(Boolean);
    for (const t of [...dateTexts, textOf(doc.body).slice(0, 6000)]) {
      const m = t.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})[^\d]{0,12}(\d{1,2}):(\d{2})/);
      if (m) {
        ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
        break;
      }
    }
    const titleEl = doc.querySelector("h1, h2, h3, .post_subject, .subject, title");
    // 댓글: 본문에 차종이 없을 때 댓글로 유추 (사이트마다 다른 이름을 차례로 시도, 최대 1500자)
    let comments = "";
    for (const sel of [".comment_view", ".comment-content", ".comment_content", ".comment_line", ".commentCont", ".cmt_txt", "[class*='comment'] [class*='text']"]) {
      const els = [...doc.querySelectorAll(sel)].slice(0, 30);
      if (els.length) {
        comments = els.map((e) => textOf(e).replace(/\s+/g, " ").slice(0, 200)).filter(Boolean).join("\n").slice(0, 1500);
        if (comments) break;
      }
    }
    // 조회수·댓글 수 (담당자 지적 2026-10-22: 커뮤니티 글은 조회수·댓글이 잘 안 나옴)
    // ① 사이트별 자리 → ② 글 제목 근처 글자에서 '조회 1,234' '댓글 [12]' 같은 표현 → ③ 댓글 줄 수 세기
    const numIn = (t) => {
      const m = String(t || "").match(/(\d[\d,]*)/);
      return m ? +m[1].replace(/,/g, "") : null;
    };
    const pickNum = (sels) => {
      for (const sel of sels || []) {
        const v = numIn(textOf(doc.querySelector(sel)));
        if (v != null) return v;
      }
      return null;
    };
    const full = visibleText(doc.body);
    const t0 = post.title ? full.indexOf(post.title.slice(0, 12)) : -1;
    const near = t0 >= 0 ? full.slice(Math.max(0, t0 - 300), t0 + 3000) : full.slice(0, 8000);
    const vMatch = (s) => s.match(/조회(?:수)?\s*[:：]?\s*(\d[\d,]*)/);
    const cMatch = (s) => s.match(/댓글(?:수)?\s*[:：(\[]?\s*(\d[\d,]*)/) || s.match(/코멘트\s*[:：(\[]?\s*(\d[\d,]*)/);
    let views = null;
    for (const sel of ad.viewSelectors || []) {
      const t = textOf(doc.querySelector(sel));
      if (!t) continue;
      const m = /조회/.test(t) ? vMatch(t) : null;
      views = m ? +m[1].replace(/,/g, "") : numIn(t);
      if (views != null) break;
    }
    if (views == null) {
      const m = vMatch(near) || vMatch(full);
      views = m ? +m[1].replace(/,/g, "") : null;
    }
    let ccount = pickNum(ad.commentCountSelectors);
    if (ccount == null) {
      const m = cMatch(near);
      ccount = m ? +m[1].replace(/,/g, "") : null;
    }
    if (ccount == null) {
      for (const sel of ad.commentItemSelectors || []) {
        const n = doc.querySelectorAll(sel).length;
        if (n) {
          ccount = n;
          break;
        }
      }
    }
    if (ccount == null && /댓글이\s*없|첫\s*댓글|등록된\s*댓글이\s*없/.test(full)) ccount = 0;
    return { title: post.title || textOf(titleEl), body, ts, comments, views, ccount };
  }
}
