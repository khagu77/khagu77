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
  const cm = r ? spacedText(r).match(/\[(\d+)\]|댓글\s*(\d+)/) : null;
  return { parsed: found, notice, ccount: cm ? +(cm[1] || cm[2]) : null };
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

  // 게시글: 본문·작성 시각·댓글
  async readArticle(post) {
    const ad = communityAdapter(post.siteUrl || post.url);
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
    const comments = [];
    const seen = new Set();
    for (const sel of ad.commentItems) {
      const nodes = [...doc.querySelectorAll(sel)];
      if (!nodes.length) continue;
      for (const n of nodes) {
        let t = "";
        for (const ts of ad.commentText) {
          const e = n.querySelector(ts);
          if (e && textOf(e)) {
            t = textOf(e);
            break;
          }
        }
        t = t.replace(/\s+/g, " ").trim();
        if (!t || t.length < 1 || /^(삭제된 댓글|삭제 된 댓글|블라인드)/.test(t) || seen.has(t)) continue;
        seen.add(t);
        let dtext = "";
        for (const ds of ad.commentDate) {
          const e = n.querySelector(ds);
          if (e && /\d/.test(textOf(e))) {
            dtext = textOf(e);
            break;
          }
        }
        const d = parseKoreanDate(dtext);
        comments.push({ text: t, writtenAt: d ? fmtDateTime(d.date) : dtext, date: d ? d.date.getTime() : null, isReply: /re|reply|depth|child/i.test(n.className || ""), author: "" });
      }
      if (comments.length) break;
    }
    return { body: body.slice(0, 3000), date, comments };
  }
}
