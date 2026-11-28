// 네이버 검색 결과 화면(HTML) → 글 목록. 서버의 functions/src/collectors/naverweb.js 를 DOM 으로 옮긴 것 (offscreen 문서에서 실행)
(function (root) {
  const isNaverHost = (h) => /(^|\.)(naver\.com|naver\.net|pstatic\.net|naver\.me|navercorp\.com)$/i.test(h);

  function searchUrl(kind, q, page = 1) {
    const p = new URLSearchParams({ query: q, nso: "so:dd,p:1d", sort: "1" });
    if (kind === "news") { p.set("where", "news"); p.set("start", String((page - 1) * 10 + 1)); }
    if (kind === "blog") { p.set("ssc", "tab.blog.all"); p.set("start", String((page - 1) * 30 + 1)); }
    if (kind === "cafe") { p.set("ssc", "tab.cafe.all"); p.set("start", String((page - 1) * 30 + 1)); }
    return `https://search.naver.com/search.naver?${p}`;
  }

  function linkKey(kind, href) {
    const u = String(href || "").replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(u)) return null;
    let url;
    try { url = new URL(u); } catch { return null; }
    if (kind === "news") {
      const m = u.match(/(?:n\.news|news|m\.news)\.naver\.com\/(?:mnews\/)?article\/(?:comment\/)?(\d{3})\/(\d{6,})/);
      if (m) return { key: `n:${m[1]}/${m[2]}`, naver: true, url: `https://n.news.naver.com/mnews/article/${m[1]}/${m[2]}` };
      if (isNaverHost(url.hostname) || url.pathname === "/" || !url.pathname) return null;
      if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname)) return null;
      return { key: `x:${(url.hostname + url.pathname).toLowerCase().replace(/\/$/, "")}${url.search}`, naver: false, url: u };
    }
    if (kind === "blog") {
      let m = u.match(/(?:m\.)?blog\.naver\.com\/([\w-]+)\/(\d{9,})/);
      if (!m) { const id = u.match(/[?&]blogId=([\w-]+)/); const no = u.match(/[?&]logNo=(\d{9,})/); if (id && no && /blog\.naver\.com/.test(u)) m = [0, id[1], no[1]]; }
      if (m) return { key: `b:${m[1]}/${m[2]}`, url: `https://blog.naver.com/${m[1]}/${m[2]}`, owner: m[1] };
      return null;
    }
    if (kind === "cafe") {
      let m = u.match(/(?:m\.)?cafe\.naver\.com\/([\w-]+)\/(\d+)(?:[?#]|$)/);
      if (m && m[1] !== "ca-fe" && m[1] !== "f-e") return { key: `c:${m[1].toLowerCase()}/${m[2]}`, url: `https://cafe.naver.com/${m[1]}/${m[2]}`, club: m[1] };
      m = u.match(/cafe\.naver\.com\/(ca-fe|f-e)\/cafes\/(\d+)\/articles\/(\d+)/);
      if (m) return { key: `c:#${m[2]}/${m[3]}`, url: `https://cafe.naver.com/${m[1]}/cafes/${m[2]}/articles/${m[3]}`, club: "" };
    }
    return null;
  }

  function relTime(text, now = new Date()) {
    const t = String(text || "");
    let m = t.match(/(\d+)\s*(초|분|시간|일|주)\s*전/);
    if (m) return new Date(now.getTime() - +m[1] * { 초: 1e3, 분: 60e3, 시간: 3600e3, 일: 86400e3, 주: 7 * 86400e3 }[m[2]]);
    if (/방금/.test(t)) return now;
    m = t.match(/(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 9, +m[5] || 0));
    if (/어제/.test(t)) return new Date(now.getTime() - 86400e3);
    return null;
  }

  const titleScore = (a, text) => {
    const cls = `${a.className || ""} ${[...a.querySelectorAll("*")].map((x) => (typeof x.className === "string" ? x.className : "")).join(" ")} ${a.parentElement?.className || ""}`;
    let sc = 0;
    if (/tit|headline|subject|title/i.test(cls)) sc += 4;
    if (/dsc|desc|body|summary|txt_lines|content|detail/i.test(cls)) sc -= 4;
    if (a.closest("h1,h2,h3,h4,strong,b")) sc += 2;
    if (text.length >= 8 && text.length <= 100) sc += 2;
    if (text.length > 120) sc -= 3;
    if (/(\.\.\.|…)$/.test(text)) sc -= 2;
    if (/[다요죠]\.\s/.test(text)) sc -= 2;
    return sc;
  };

  function parseSearchDoc(doc, kind) {
    for (const e of doc.querySelectorAll("script, style, noscript, .blind, .sr-only, [aria-hidden='true']")) e.remove();
    const clean = (e) => String(e.textContent || "").replace(/새\s*창\s*열림|새창열림/g, " ").replace(/\s+/g, " ").trim();
    const links = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      const k = linkKey(kind, a.getAttribute("href"));
      if (k) links.push({ a, ...k });
    }
    const fits = (el) => {
      const nav = new Set();
      const ext = new Set();
      for (const l of links) if (el.contains(l.a)) (l.naver === false ? ext : nav).add(l.key);
      return nav.size <= 1 && ext.size <= 1;
    };
    const boxes = new Map();
    const boxOf = new Map();
    for (const l of links) {
      let it = boxOf.get(l.key);
      if (!it) {
        let box = l.a;
        while (box.parentElement && box.parentElement !== doc.body && fits(box.parentElement)) box = box.parentElement;
        it = boxes.get(box);
        if (!it) { it = { box, url: "", extUrl: "", texts: [], meta: l }; boxes.set(box, it); }
        boxOf.set(l.key, it);
      }
      if (l.naver === false) it.extUrl ||= l.url; else it.url ||= l.url;
      if (l.club !== undefined && !it.meta.club) it.meta = l;
      const text = clean(l.a);
      if (text.length >= 6 && !/^(네이버뉴스|언론사 선정|관련뉴스|더보기|카페 바로가기|블로그 바로가기)/.test(text)) it.texts.push({ text, sc: titleScore(l.a, text) });
    }
    const out = [];
    const seen = new Set();
    for (const it of boxes.values()) {
      if (!it.texts.length) continue;
      const title = [...it.texts].sort((a, b) => b.sc - a.sc || a.text.length - b.text.length)[0].text.slice(0, 200);
      const snippet = (it.texts.filter((x) => x.text !== title).sort((a, b) => b.text.length - a.text.length)[0]?.text || "").slice(0, 300);
      const url = it.url || it.extUrl;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      let source = "";
      for (const a of it.box.querySelectorAll("a[href]")) {
        if (source) break;
        const href = String(a.getAttribute("href") || "").replace(/&amp;/g, "&");
        const t = clean(a);
        if (t.length < 2 || t.length > 30 || t === title) continue;
        if (kind === "cafe" && (/cafe\.naver\.com\/(?!ca-fe\/|f-e\/)[\w-]+\/?(?:[?#]|$)/.test(href) || /cafe\.naver\.com\/(?:ca-fe|f-e)\/cafes\/\d+\/?(?:[?#]|$)/.test(href))) source = t;
        if (kind === "blog" && /blog\.naver\.com\/[\w-]+\/?(?:[?#]|$)/.test(href)) source = t;
      }
      if ((kind === "cafe" || kind === "blog") && !source) {
        for (const e of it.box.querySelectorAll("[class*='name'], [class*='cafe'], [class*='user'], [class*='writer'], [class*='source'], [class*='sub_txt']")) {
          const t = clean(e);
          if (t.length >= 2 && t.length <= 30 && t !== title && !snippet.startsWith(t) && !/^\d|전$|\d{4}\.|^카페$|^블로그$/.test(t)) { source = t; break; }
        }
      }
      if (kind === "news" && !source) {
        for (const e of it.box.querySelectorAll("[class*='press'], [class*='Press'], [class*='profile-info-title'], [class*='source']")) {
          const t = clean(e);
          if (t.length >= 2 && t.length <= 30 && !/네이버뉴스|\d{4}\./.test(t) && t !== title) { source = t.replace(/\s*언론사\s*선정.*$/, ""); break; }
        }
      }
      const d = relTime(clean(it.box));
      out.push({ title, snippet, url, extUrl: it.extUrl, source, club: it.meta.club || "", owner: it.meta.owner || "", date: d ? d.toISOString() : null });
    }
    return out;
  }

  const isBlocked = (html, status) => status === 403 || status === 429 || /자동입력\s*방지|비정상적인\s*(접근|트래픽)|보안\s*문자를\s*입력/.test(String(html).replace(/<script[\s\S]*?<\/script>/gi, " "));

  root.HDNaver = { searchUrl, linkKey, relTime, parseSearchDoc, isBlocked };
})(typeof self !== "undefined" ? self : globalThis);
