// 언론(네이버 뉴스): 키워드로 네이버 뉴스를 검색하고(기간 지정), 직접 넣은 기사 주소도 함께 모은다.
// 댓글이 있는 네이버 뉴스 기사만 수집한다 (댓글은 네이버 뉴스 댓글 상자에서 읽음).

// 기사 주소 → { oid, aid } (네이버 뉴스·스포츠·연예 기사 주소 모두)
function newsIds(url) {
  const u = String(url || "").replace(/&amp;/g, "&");
  let m = u.match(/(?:n\.news|news)\.naver\.com\/(?:mnews\/)?article\/(?:comment\/)?(\d{3})\/(\d{6,})/);
  if (m) return { oid: m[1], aid: m[2] };
  m = u.match(/(?:sports|entertain)\.naver\.com\/(?:[\w]+\/)?article\/(\d{3})\/(\d{6,})/);
  if (m) return { oid: m[1], aid: m[2] };
  const oid = u.match(/[?&]oid=(\d{3})/);
  const aid = u.match(/[?&]aid=(\d{6,})/);
  if (oid && aid && /naver\.com/.test(u)) return { oid: oid[1], aid: aid[1] };
  return null;
}

function newsUrl({ oid, aid }) {
  return `https://n.news.naver.com/mnews/article/${oid}/${aid}`;
}

const dotDate = (d) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;

class NewsCollector {
  constructor({ delays, log, isStopped, replies }) {
    this.delays = delays;
    this.log = log;
    this.isStopped = isStopped;
    this.replies = replies;
  }

  async wait(range) {
    const end = Date.now() + randomBetween(range);
    while (Date.now() < end) {
      if (this.isStopped()) throw new StopError("중지됨");
      await sleep(Math.min(500, end - Date.now()));
    }
  }

  searchUrl(q, range, page) {
    const from = range.from;
    const to = new Date(range.to.getTime() - 1);
    const p = `from${ymd(from)}to${ymd(to)}`;
    return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1&pd=3&ds=${dotDate(from)}&de=${dotDate(to)}&nso=so:dd,p:${p},a:all&start=${(page - 1) * 10 + 1}`;
  }

  // 검색 결과 화면 → 기사 목록. 네이버 뉴스 기사(oid/aid)뿐 아니라 언론사 자체 사이트 기사(「네이버뉴스」 링크 없음)도 모두.
  // → [{ oid, aid, title, press, dateText, extUrl }]  (oid 가 없으면 언론사 자체 사이트 기사)
  parseSearch(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const isNaverHost = (h) => /(^|\.)(naver\.com|naver\.net|pstatic\.net|naver\.me)$/i.test(h);
    const titleOk = (t) => t.length >= 10 && !/^(\d|언론사|네이버뉴스|관련뉴스|더보기|이전|다음|Keep)/.test(t);
    const titleAnchors = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) continue;
      const text = textOf(a).replace(/\s+/g, " ");
      if (!titleOk(text)) continue;
      let host = "";
      try {
        host = new URL(href).hostname;
      } catch {
        continue;
      }
      const ids = newsIds(href);
      if (ids || !isNaverHost(host)) titleAnchors.push({ a, href, text, ids });
    }
    const norm = (t) => t.replace(/\s+/g, "");
    const titlesIn = (e) => new Set(titleAnchors.filter((x) => e.contains(x.a)).map((x) => norm(x.text)));
    const out = new Map();
    for (const t of titleAnchors) {
      // 이 기사 제목 하나만 담은 가장 큰 덩어리 + 다른 기사 제목이 없는 형제 덩어리(언론사·날짜 줄)
      let box = t.a;
      while (box.parentElement && box.parentElement !== doc.body && titlesIn(box.parentElement).size <= 1) box = box.parentElement;
      const parts = [box];
      if (box.parentElement) for (const sib of box.parentElement.children) if (sib !== box && titlesIn(sib).size === 0) parts.push(sib);
      const ctxText = parts.map((e) => spacedText(e)).join(" ");
      let ids = t.ids;
      for (const e of parts) for (const x of e.querySelectorAll("a[href]")) ids = ids || newsIds(x.getAttribute("href"));
      let press = "";
      for (const e of parts) {
        const pe = e.querySelector("[class*='press'], [class*='Press'], [class*='source']");
        if (pe && textOf(pe)) {
          press = textOf(pe);
          break;
        }
      }
      if (!press) {
        for (const e of parts) for (const x of e.querySelectorAll("a, span")) {
          const tx = textOf(x);
          if (!press && tx.length >= 2 && tx.length <= 20 && !/네이버뉴스|전$|\d{4}\.|^\d/.test(tx) && norm(tx) !== norm(t.text)) press = tx;
        }
      }
      press = press.replace(/\s*언론사\s*선정.*$/, "").replace(/\s+/g, " ").trim();
      const dm = ctxText.match(/\d+\s*(?:분|시간|일|주)\s*전|20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?(?:\s*\d{1,2}:\d{2})?/);
      const extUrl = t.ids ? "" : t.href;
      const key = ids ? `${ids.oid}/${ids.aid}` : `x:${extUrl.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
      const prev = out.get(key);
      if (prev) {
        if (!prev.extUrl && extUrl) prev.extUrl = extUrl;
        if (t.text.length > prev.title.length) prev.title = t.text.slice(0, 200);
        continue;
      }
      out.set(key, { oid: ids?.oid || "", aid: ids?.aid || "", title: t.text.slice(0, 200), press, dateText: dm ? dm[0] : "", extUrl });
    }
    // 링크 모양이 바뀌어도 주소 글자에서 네이버 뉴스 기사 번호를 찾는다
    for (const m of html.matchAll(/n\.news\.naver\.com\\?\/mnews\\?\/article\\?\/(\d{3})\\?\/(\d{6,})/g)) {
      const key = `${m[1]}/${m[2]}`;
      if (!out.has(key)) out.set(key, { oid: m[1], aid: m[2], title: "", press: "", dateText: "", extUrl: "" });
    }
    return [...out.values()];
  }

  async search(queries, range, maxPages) {
    const found = new Map();
    for (const q of queries) {
      let prev = "";
      for (let page = 1; page <= maxPages; page++) {
        if (this.isStopped()) throw new StopError("중지됨");
        let html;
        try {
          html = await fetchText(this.searchUrl(q, range, page), { credentials: "include" });
        } catch (e) {
          this.log(`  · 뉴스 검색 "${q}" ${page}페이지 실패: ${korMsg(e.message)}`, "err");
          break;
        }
        const items = this.parseSearch(html);
        const keys = items.map((x) => x.aid || x.extUrl).join(",");
        if (!items.length || keys === prev) break;
        prev = keys;
        let added = 0;
        for (const it of items) {
          const key = it.aid ? `news:${it.oid}/${it.aid}` : `newsx:${it.extUrl.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
          if (found.has(key)) continue;
          found.set(key, it.aid
            ? { key, channel: "news", oid: it.oid, aid: it.aid, url: newsUrl(it), title: it.title, press: it.press, extUrl: it.extUrl, query: q }
            : { key, channel: "news", external: true, url: it.extUrl, title: it.title, press: it.press, dateText: it.dateText, query: q });
          added++;
        }
        this.log(`  · 뉴스 "${q}" ${page}페이지: 기사 ${items.length}건 (새 ${added}건, 언론사 자체 사이트 ${items.filter((x) => !x.aid).length}건)`);
        if (items.length < 5) break;
        await this.wait(this.delays.news);
      }
    }
    return [...found.values()];
  }

  // 기사 화면: 제목·언론사·작성 시각·본문 앞부분
  async readArticle(post) {
    const doc = await fetchDocument(newsUrl(post), { credentials: "include" });
    const meta = (p) => doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
    const title = textOf(doc.querySelector("#title_area, .media_end_head_headline, h2#title_area")) || meta("og:title");
    const press = (doc.querySelector(".media_end_head_top_logo img")?.getAttribute("title") || doc.querySelector(".media_end_head_top_logo img")?.getAttribute("alt") || meta("og:article:author") || meta("twitter:creator")).replace(/\s*\|\s*네이버.*$/, "").trim();
    const dateEl = doc.querySelector("[data-date-time], ._ARTICLE_DATE_TIME");
    const dateText = dateEl?.getAttribute("data-date-time") || textOf(dateEl) || meta("article:published_time");
    const parsed = parseKoreanDate(dateText);
    const body = textOf(doc.querySelector("#dic_area, #newsct_article, #articeBody, ._article_content")).slice(0, 3000);
    return { title, press, date: parsed ? parsed.date.getTime() : null, exact: !!parsed?.exact, body };
  }

  // 댓글 상자 API (JSONP) 한 번 부르기
  async cbox(post, page, parentCommentNo = null) {
    const params = new URLSearchParams({
      ticket: "news",
      templateId: "default_society",
      pool: "cbox5",
      _callback: "cb",
      lang: "ko",
      country: "KR",
      objectId: `news${post.oid},${post.aid}`,
      pageSize: "100",
      indexSize: "10",
      listType: "OBJECT",
      pageType: "more",
      page: String(page),
      initialize: "true",
      useAltSort: "true",
      replyPageSize: "100",
      sort: "new",
    });
    if (parentCommentNo) params.set("parentCommentNo", String(parentCommentNo));
    const res = await fetch(`https://apis.naver.com/commentBox/cbox/web_naver_list_jsonp.json?${params}`, { credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} 응답 (댓글)`);
    const text = await res.text();
    const json = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
    const data = JSON.parse(json);
    if (data.success === false) throw new Error(data.message || "댓글을 읽지 못함");
    return data.result || {};
  }

  // 댓글 수만 확인 (댓글 있는 기사만 고르기)
  async commentCount(post) {
    const r = await this.cbox(post, 1);
    const c = r.count || {};
    return c.comment ?? c.total ?? r.pageModel?.totalRows ?? (r.commentList || []).length;
  }

  async readComments(post, onProgress) {
    const out = [];
    const seen = new Set();
    const push = (c, isReply) => {
      if (!c || c.deleted || c.blindReport || c.secret || !c.contents || seen.has(c.commentNo)) return;
      seen.add(c.commentNo);
      const d = parseKoreanDate(String(c.regTime || "").replace("T", " "));
      out.push({ text: c.contents, writtenAt: fmtDateTime(d?.date) || c.regTime || "", date: d ? d.date.getTime() : null, isReply, author: c.userName || "" });
    };
    for (let page = 1; page <= 100; page++) {
      if (this.isStopped()) throw new StopError("중지됨");
      const r = await this.cbox(post, page);
      const list = r.commentList || [];
      for (const c of list) {
        push(c, false);
        if (this.replies && c.replyCount > 0) {
          await this.wait(this.delays.news);
          try {
            const rr = await this.cbox(post, 1, c.commentNo);
            for (const x of rr.commentList || []) if (x.commentNo !== c.commentNo) push(x, true);
          } catch {
            /* 답글은 못 읽어도 넘어감 */
          }
        }
      }
      onProgress?.(out.length);
      const total = r.pageModel?.totalPages || r.pageModel?.lastPage;
      if (!list.length || (total && page >= total)) break;
      await this.wait(this.delays.news);
    }
    return out;
  }
}
