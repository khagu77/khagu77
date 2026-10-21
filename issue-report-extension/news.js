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
  // 한 기사에 같은 주소 링크가 여러 개(제목·요약문·사진) 걸려 있어, 기사는 '주소'로 묶고 제목은 제목다운 링크를 고른다.
  // 링크 안의 화면낭독용 숨은 글자('새 창 열림' 등)는 뺀다.
  parseSearch(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const b of doc.querySelectorAll(".blind, .sr-only, [class*='blind'], [class*='a11y'], [aria-hidden='true']")) b.remove();
    const clean = (e) => textOf(e).replace(/새\s*창\s*열림|새창열림/g, " ").replace(/\s+/g, " ").trim();
    const isNaverHost = (h) => /(^|\.)(naver\.com|naver\.net|pstatic\.net|naver\.me)$/i.test(h);
    const normUrl = (u) => u.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
    // 기사 링크: 네이버 뉴스 기사 주소 또는 네이버 밖(언론사) 주소
    const links = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) continue;
      let host = "";
      try {
        host = new URL(href).hostname;
      } catch {
        continue;
      }
      const ids = newsIds(href);
      if (!ids && isNaverHost(host)) continue;
      const path = new URL(href).pathname;
      if (!ids && (path === "/" || path === "")) continue; // 언론사 첫 화면 링크(언론사 이름)는 기사 아님
      links.push({ a, href, ids, key: ids ? `${ids.oid}/${ids.aid}` : `x:${normUrl(href)}` });
    }
    // 한 기사 묶음 = 언론사 주소(제목·요약문·사진 링크) 하나 + 그 기사의 「네이버뉴스」 링크 하나까지
    const countIn = (e) => {
      const ext = new Set();
      const nav = new Set();
      for (const x of links) if (e.contains(x.a)) (x.ids ? nav : ext).add(x.key);
      return { ext: ext.size, nav: nav.size, all: ext.size + nav.size };
    };
    const fits = (e) => {
      const c = countIn(e);
      return c.ext <= 1 && c.nav <= 1;
    };
    // 언론사 주소 링크를 먼저 묶고, 「네이버뉴스」 링크는 그 묶음 안에 있으면 그 기사에 붙인다
    links.sort((x, y) => Number(!!x.ids) - Number(!!y.ids));
    // 제목다운 링크 점수: 제목 칸·굵은 글씨 → +, 요약문 칸·긴 글·말줄임 → −
    const titleScore = (a, text) => {
      const cls = `${a.className || ""} ${[...a.querySelectorAll("*")].map((x) => x.className || "").join(" ")} ${a.parentElement?.className || ""}`;
      let sc = 0;
      if (/tit|headline|subject|title/i.test(cls)) sc += 4;
      if (/dsc|desc|body|summary|txt_lines|content/i.test(cls)) sc -= 4;
      if (a.closest("h1,h2,h3,h4,strong,b")) sc += 2;
      if (text.length >= 10 && text.length <= 100) sc += 2;
      if (text.length > 120) sc -= 3;
      if (/(\.\.\.|…)$/.test(text)) sc -= 2;
      if (/[다요죠]\.\s/.test(text)) sc -= 2; // 문장이 여러 개 = 요약문
      return sc;
    };
    const items = new Map();
    for (const l of links) {
      const text = clean(l.a);
      let it = items.get(l.key);
      if (!it && l.ids) {
        // 이미 묶은 언론사 기사 덩어리 안의 「네이버뉴스」 링크 → 그 기사
        it = [...items.values()].find((x) => !x.ids && x.parts.some((e) => e.contains(l.a)));
        if (it) {
          it.ids = l.ids;
          items.set(l.key, it);
        }
      }
      if (!it) {
        // 이 기사만 담은 가장 큰 덩어리 + 다른 기사 링크가 없는 형제 덩어리(언론사·날짜 줄)
        let box = l.a;
        while (box.parentElement && box.parentElement !== doc.body && fits(box.parentElement)) box = box.parentElement;
        const parts = [box];
        if (box.parentElement) for (const sib of box.parentElement.children) if (sib !== box && countIn(sib).all === 0) parts.push(sib);
        it = { key: l.key, ids: l.ids, extUrl: l.ids ? "" : l.href, parts, title: "", score: -99 };
        items.set(l.key, it);
      }
      if (!it.ids && l.ids) it.ids = l.ids;
      if (!it.extUrl && !l.ids) it.extUrl = l.href;
      if (text.length < 6 || /^(네이버뉴스|언론사 선정|관련뉴스|더보기)/.test(text)) continue;
      const sc = titleScore(l.a, text);
      if (sc > it.score || (sc === it.score && text.length < it.title.length)) {
        it.title = text.slice(0, 200);
        it.score = sc;
      }
    }
    const out = new Map();
    for (const it of new Set(items.values())) {
      if (!it.title) continue;
      const ctxText = it.parts.map((e) => clean(e)).join(" ");
      let press = "";
      for (const e of it.parts) {
        for (const pe of e.querySelectorAll("[class*='press'], [class*='Press'], [class*='profile-info-title'], [class*='source'], [class*='info_group'] a")) {
          const t = clean(pe);
          if (t.length >= 2 && t.length <= 30 && !/네이버뉴스|전$|\d{4}\./.test(t) && t !== it.title) {
            press = t;
            break;
          }
        }
        if (press) break;
      }
      if (!press) {
        // 언론사 첫 화면 링크의 글자
        for (const e of it.parts) for (const x of e.querySelectorAll("a[href]")) {
          const h = x.getAttribute("href") || "";
          let path = "";
          try {
            path = new URL(h).pathname;
          } catch {
            continue;
          }
          const t = clean(x);
          if (!press && (path === "/" || path === "") && t.length >= 2 && t.length <= 30) press = t;
        }
      }
      press = press.replace(/\s*언론사\s*선정.*$/, "").trim();
      const dm = ctxText.match(/\d+\s*(?:분|시간|일|주)\s*전|20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?(?:\s*\d{1,2}:\d{2})?/);
      const ids = it.ids;
      const key = ids ? `${ids.oid}/${ids.aid}` : it.key;
      if (out.has(key)) continue;
      out.set(key, { oid: ids?.oid || "", aid: ids?.aid || "", title: it.title, press, dateText: dm ? dm[0] : "", extUrl: it.extUrl });
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
