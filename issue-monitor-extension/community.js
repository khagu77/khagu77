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

function textOf(el) {
  return (el ? el.textContent : "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
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
  async list(site, range) {
    const ad = communityAdapter(site.url);
    const all = new Map();
    for (let page = 1; page <= COMMUNITY_MAX_LIST_PAGES; page++) {
      if (this.isStopped()) throw new StopError("중지됨");
      const doc = await fetchDocument(ad.listUrl(page));
      let rows = 0;
      let olderSeen = 0;
      let added = 0;
      for (const a of doc.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href") || "";
        const id = ad.articleId(href);
        if (!id) continue;
        const title = textOf(a).replace(/\s+/g, " ");
        if (title.length < 2 || /^\[?\d+\]?$/.test(title)) continue;
        const row = a.closest("tr, li, .list_item, [class*='item']") || a.parentElement;
        const rowText = row
          ? [textOf(row), ...[...row.querySelectorAll("[title]")].map((x) => x.getAttribute("title"))].join(" ")
          : "";
        const isNotice = row ? /공지|notice/i.test(row.className + " " + (row.querySelector("img[alt]")?.getAttribute("alt") || "")) : false;
        // 제목 안의 숫자(차량 연식 등)를 날짜로 읽지 않도록 제목을 빼고 본다
        const parsed = parseKoreanDate(rowText.replace(title, " "));
        rows++;
        if (parsed && !isNotice && parsed.date.getTime() < range.start.getTime() && (parsed.exact || parsed.date.getTime() + 86400000 <= range.start.getTime())) olderSeen++;
        if (!mayBeInRange(parsed, range)) continue;
        if (all.has(id)) {
          if (title.length > all.get(id).title.length) all.get(id).title = title;
          continue;
        }
        all.set(id, {
          articleId: id,
          title,
          ts: parsed ? parsed.date.getTime() : null,
          exact: parsed ? parsed.exact : false,
          url: ad.articleUrl(id),
        });
        added++;
      }
      if (!rows) {
        if (page === 1) throw new Error("글 목록을 읽지 못했습니다 (게시판 주소나 화면 구조 확인 필요)");
        break;
      }
      if (olderSeen >= 3 || (page > 1 && added === 0) || ad.generic) break;
      await this.wait(this.delays.community);
    }
    return [...all.values()];
  }

  async readArticle(site, post) {
    const ad = communityAdapter(site.url);
    const doc = await fetchDocument(post.url);
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
    return { title: post.title || textOf(titleEl), body, ts };
  }
}
