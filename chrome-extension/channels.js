// 언론(네이버 뉴스 검색)·자동차 커뮤니티(보배드림·클리앙·뽐뿌 게시판) 게시물 찾기와 댓글 읽기.
// LX3 화면(게시물 찾기)과 댓글 수집 화면이 함께 쓴다. cafe-common.js 다음에 불러온다.
// - 언론: 메인 키워드 × 서브 키워드 조합으로 네이버 뉴스를 기간 지정 검색. 네이버 뉴스 기사의 댓글은 네이버 댓글 상자에서 읽는다.
// - 커뮤니티: 로그인이 필요 없는 공개 게시판이라 목록·게시글 화면을 직접 받아(fetch) 읽는다(뽐뿌 등 EUC-KR 자동 판별).
//   목록을 최신 글부터 기간 끝까지 넘기며 제목에 메인 키워드와 서브 키워드가 함께 있는 글을 고른다.

const DEFAULT_MAIN_KEYWORDS = "펠리세이드, 팰리세이드, LX3, 아이오닉9, 싼타페, MX5";
const DEFAULT_SUB_KEYWORDS = "전동시트, 시트, 결함, 리콜, 시트리콜, 시트 결함, 시트 사망 사고";
const DEFAULT_BOARDS = [
  "https://www.bobaedream.co.kr/list?code=national",
  "https://www.clien.net/service/board/cm_car",
  "https://www.clien.net/service/board/news",
  "https://www.ppomppu.co.kr/zboard/zboard.php?id=car",
];
const DEFAULT_NEWS_PAGES = 2;
const COMMUNITY_MAX_LIST_PAGES = 40;
const NEWS_DELAY = [700, 1500];
const COMMUNITY_DELAY = [1500, 3000];

// ---------------------------------------------------------------------------
// 키워드 조합
// ---------------------------------------------------------------------------

function keywordList(text) {
  return [...new Set(String(text || "").split(/[,\n]/).map((w) => w.trim()).filter(Boolean))];
}

// 검색어: 메인 × 서브 ("팰리세이드 전동시트" …)
function keywordQueries(main, sub) {
  const m = keywordList(main);
  const s = keywordList(sub);
  if (!s.length) return m;
  return m.flatMap((a) => s.map((b) => `${a} ${b}`));
}

// 제목(·요약)에 메인 키워드와 서브 키워드가 모두 있는지 (띄어쓰기 무시)
function matchesCombo(text, main, sub) {
  const t = String(text || "").replace(/\s+/g, "").toLowerCase();
  const has = (w) => t.includes(w.replace(/\s+/g, "").toLowerCase());
  const m = keywordList(main);
  const s = keywordList(sub);
  return m.some(has) && (!s.length || s.some(has));
}

// ---------------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------------

// 화면의 날짜 글자 → { date, hasTime, approxMs } 또는 null
// "2026.10.11. 15:22" · "2026-10-11 15:22:01" · "26.10.11" · "15:22"(오늘) · "3시간 전"(±1시간) · "1일 전" · "어제" · "10/11"
function parseKoreanDate(text, now = new Date()) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  let m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]*\))?\s*(?:(오전|오후)\s*)?(?:(\d{1,2}):(\d{2}))?/);
  if (m) {
    let h = m[5] !== undefined ? +m[5] : 0;
    if (m[4] === "오후" && h < 12) h += 12;
    if (m[4] === "오전" && h === 12) h = 0;
    const hasTime = m[5] !== undefined;
    return { date: new Date(+m[1], +m[2] - 1, +m[3], h, hasTime ? +m[6] : 0), hasTime };
  }
  m = s.match(/(?:^|[^\d])(\d{2})[./-](\d{2})[./-](\d{2})(?:\.?\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const hasTime = m[4] !== undefined;
    return { date: new Date(2000 + +m[1], +m[2] - 1, +m[3], hasTime ? +m[4] : 0, hasTime ? +m[5] : 0), hasTime };
  }
  m = s.match(/(\d+)\s*(분|시간)\s*전/);
  if (m) {
    const unit = m[2] === "분" ? 60e3 : 3600e3;
    return { date: new Date(now.getTime() - +m[1] * unit), hasTime: true, approxMs: unit };
  }
  if (/방금|초\s*전/.test(s)) return { date: new Date(now), hasTime: true };
  m = s.match(/(\d+)\s*일\s*전/);
  if (m) return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - +m[1]), hasTime: false };
  if (/어제/.test(s)) return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), hasTime: false };
  m = s.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d])/);
  if (m) {
    let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
    if (d.getTime() > now.getTime() + 10 * 60000) d = new Date(d.getTime() - 86400000);
    return { date: d, hasTime: true };
  }
  m = s.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})(?![\d./-])/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
    if (d.getTime() > now.getTime() + 86400000) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2]);
    return { date: d, hasTime: false };
  }
  return null;
}

// 기간 안인지 ("in" / "older" / "newer" / "ambiguous"). '3시간 전'처럼 대략인 시각은 그 폭까지 따진다
function placeApprox(parsed, { from, to }) {
  if (!parsed) return "ambiguous";
  if (!parsed.hasTime) {
    const d = parsed.date;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (dayEnd <= from) return "older";
    if (dayStart >= to) return "newer";
    if (dayStart >= from && dayEnd <= to) return "in";
    return "ambiguous";
  }
  const latest = parsed.date.getTime();
  const earliest = latest - (parsed.approxMs || 0);
  if (latest < from.getTime()) return "older";
  if (earliest >= to.getTime()) return "newer";
  if (earliest >= from.getTime() && latest < to.getTime()) return "in";
  return "ambiguous";
}

// 엑셀 작성일 칸 ("2026.03.14. 06:48", 동호회 시트와 같은 모양)
function sheetDateTime(d) {
  if (!d) return "";
  d = new Date(d);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 웹 문서 받기 (사이트 글자 인코딩 자동 판별: 뽐뿌 등 EUC-KR)
// ---------------------------------------------------------------------------

async function fetchText(url, { credentials = "omit" } = {}) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { credentials, cache: "no-store" });
    // 요청이 많다는 응답이면 1분 쉬고 한 번 더
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      await sleep(60000);
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`${res.status} 응답`);
  const buf = await res.arrayBuffer();
  let charset = ((res.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  }
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function fetchDocument(url, opts) {
  return new DOMParser().parseFromString(await fetchText(url, opts), "text/html");
}

function textOf(e) {
  return (e ? e.textContent : "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// 칸마다 글자가 붙지 않도록 글자 조각 사이에 공백을 넣어 읽는다
function spacedText(e) {
  if (!e) return "";
  const parts = [];
  const walker = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

function safeUrl(href, base) {
  try {
    return new URL(String(href).replace(/&amp;/g, "&"), base);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 같은 글인지 비교하는 열쇠 (엑셀에 이미 있는 글 빼기)
// ---------------------------------------------------------------------------

// 기사 주소 → { oid, aid } (네이버 뉴스·스포츠·연예 기사 주소 모두)
function newsIds(url) {
  const u = String(url || "").replace(/&amp;/g, "&");
  let m = u.match(/(?:n\.news|news|m\.news)\.naver\.com\/(?:mnews\/)?article\/(?:comment\/)?(\d{3})\/(\d{6,})/);
  if (m) return { oid: m[1], aid: m[2] };
  m = u.match(/(?:sports|entertain|m\.sports|m\.entertain)\.naver\.com\/(?:[\w]+\/)?article\/(\d{3})\/(\d{6,})/);
  if (m) return { oid: m[1], aid: m[2] };
  const oid = u.match(/[?&]oid=(\d{3})/);
  const aid = u.match(/[?&]aid=(\d{6,})/);
  if (oid && aid && /naver\.com/.test(u)) return { oid: oid[1], aid: aid[1] };
  return null;
}

function newsUrl({ oid, aid }) {
  return `https://n.news.naver.com/mnews/article/${oid}/${aid}`;
}

function isNewsUrl(url) {
  return !!newsIds(url);
}

// 언론·커뮤니티 글 주소의 비교 열쇠 (같은 글이면 주소 모양이 달라도 같은 열쇠)
function channelKey(url) {
  const s = String(url || "").trim().replace(/&amp;/g, "&");
  const n = newsIds(s);
  if (n) return `news:${n.oid}/${n.aid}`;
  const u = safeUrl(s);
  if (!u) return s.toLowerCase();
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host.endsWith("clien.net")) {
    const m = u.pathname.match(/\/service\/board\/([^/?#]+)\/(\d+)/);
    if (m) return `clien:${m[1]}/${m[2]}`;
  }
  if (host.endsWith("ppomppu.co.kr")) {
    const no = u.searchParams.get("no");
    if (no) return `ppomppu:${u.searchParams.get("id") || ""}/${no}`;
  }
  if (host.endsWith("bobaedream.co.kr")) {
    const no = u.searchParams.get("No") || u.searchParams.get("no");
    if (no) return `bobae:${u.searchParams.get("code") || ""}/${no}`;
  }
  // 언론사 기사: 추적용 꼬리표(iqfrm·utm 등)는 빼고 비교
  for (const k of [...u.searchParams.keys()]) if (/^(iqfrm|utm_\w+|sid|ref|from|fbclid|gclid)$/i.test(k)) u.searchParams.delete(k);
  return `${host}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// 언론 (네이버 뉴스)
// ---------------------------------------------------------------------------

const dotDate = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
const ymd8 = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// 기간 지정 · 최신순 뉴스 검색 주소
function newsSearchUrl(q, { from, to }, page) {
  const end = new Date(to.getTime() - 1);
  const p = `from${ymd8(from)}to${ymd8(end)}`;
  return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1&pd=3&ds=${dotDate(from)}&de=${dotDate(end)}&nso=so:dd,p:${p},a:all&start=${(page - 1) * 10 + 1}`;
}

// 검색 결과 화면 → 기사 목록 [{ oid, aid, title, press, dateText, extUrl, snippet }]
// 네이버 뉴스 기사(「네이버뉴스」 링크)뿐 아니라 언론사 자체 사이트 기사도 모두. 기사는 주소로 묶고 제목은 제목다운 링크를 고른다.
function parseNewsSearch(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const b of doc.querySelectorAll(".blind, .sr-only, [class*='blind'], [class*='a11y'], [aria-hidden='true']")) b.remove();
  const clean = (e) => textOf(e).replace(/새\s*창\s*열림|새창열림/g, " ").replace(/\s+/g, " ").trim();
  const isNaverHost = (h) => /(^|\.)(naver\.com|naver\.net|pstatic\.net|naver\.me)$/i.test(h);
  const normExt = (u) => u.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
  const links = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) continue;
    const url = safeUrl(href);
    if (!url) continue;
    const ids = newsIds(href);
    if (!ids && isNaverHost(url.hostname)) continue;
    if (!ids && (url.pathname === "/" || url.pathname === "")) continue; // 언론사 첫 화면(언론사 이름 링크)
    links.push({ a, href, ids, key: ids ? `${ids.oid}/${ids.aid}` : `x:${normExt(href)}` });
  }
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
  links.sort((x, y) => Number(!!x.ids) - Number(!!y.ids)); // 언론사 주소 먼저 묶고 「네이버뉴스」 링크를 붙인다
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
      it = [...items.values()].find((x) => !x.ids && x.parts.some((e) => e.contains(l.a)));
      if (it) {
        it.ids = l.ids;
        items.set(l.key, it);
      }
    }
    if (!it) {
      let box = l.a;
      while (box.parentElement && box.parentElement !== doc.body && fits(box.parentElement)) box = box.parentElement;
      const parts = [box];
      if (box.parentElement) for (const sib of box.parentElement.children) if (sib !== box && countIn(sib).all === 0) parts.push(sib);
      it = { key: l.key, ids: l.ids, extUrl: l.ids ? "" : l.href, parts, title: "", score: -99, snippet: "" };
      items.set(l.key, it);
    }
    if (!it.ids && l.ids) it.ids = l.ids;
    if (!it.extUrl && !l.ids) it.extUrl = l.href;
    if (text.length < 6 || /^(네이버뉴스|언론사 선정|관련뉴스|더보기)/.test(text)) continue;
    const sc = titleScore(l.a, text);
    if (sc > it.score || (sc === it.score && text.length < it.title.length)) {
      if (it.title && it.title.length > it.snippet.length) it.snippet = it.title;
      it.title = text.slice(0, 200);
      it.score = sc;
    } else if (text.length > it.snippet.length) it.snippet = text.slice(0, 300);
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
      for (const e of it.parts) for (const x of e.querySelectorAll("a[href]")) {
        const u = safeUrl(x.getAttribute("href") || "");
        const t = clean(x);
        if (!press && u && (u.pathname === "/" || u.pathname === "") && t.length >= 2 && t.length <= 30) press = t;
      }
    }
    press = press.replace(/\s*언론사\s*선정.*$/, "").trim();
    const dm = ctxText.match(/\d+\s*(?:분|시간|일|주)\s*전|20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?(?:\s*\d{1,2}:\d{2})?/);
    const key = it.ids ? `${it.ids.oid}/${it.ids.aid}` : it.key;
    if (out.has(key)) continue;
    out.set(key, { oid: it.ids?.oid || "", aid: it.ids?.aid || "", title: it.title, press, dateText: dm ? dm[0] : "", extUrl: it.extUrl, snippet: it.snippet });
  }
  return [...out.values()];
}

// 네이버 뉴스 기사 화면: 언론사·작성 시각
async function readNewsArticle(url) {
  const doc = await fetchDocument(newsUrl(newsIds(url)), { credentials: "include" });
  const meta = (p) => doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
  const logo = doc.querySelector(".media_end_head_top_logo img");
  const press = (logo?.getAttribute("title") || logo?.getAttribute("alt") || meta("og:article:author") || meta("twitter:creator")).replace(/\s*\|\s*네이버.*$/, "").trim();
  const dateEl = doc.querySelector("[data-date-time], ._ARTICLE_DATE_TIME");
  const parsed = parseKoreanDate(dateEl?.getAttribute("data-date-time") || textOf(dateEl) || meta("article:published_time"));
  const title = textOf(doc.querySelector("#title_area, .media_end_head_headline")) || meta("og:title");
  return { press, title, parsed };
}

// 네이버 뉴스 댓글 상자 (JSONP) 한 번 부르기 (Referer 는 background.js 규칙이 붙임)
async function newsCbox({ oid, aid }, page, parentCommentNo = null) {
  const params = new URLSearchParams({
    ticket: "news", templateId: "default_society", pool: "cbox5", _callback: "cb", lang: "ko", country: "KR",
    objectId: `news${oid},${aid}`, pageSize: "100", indexSize: "10", listType: "OBJECT", pageType: "more",
    page: String(page), initialize: "true", useAltSort: "true", replyPageSize: "100", sort: "new",
  });
  if (parentCommentNo) params.set("parentCommentNo", String(parentCommentNo));
  const res = await fetch(`https://apis.naver.com/commentBox/cbox/web_naver_list_jsonp.json?${params}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`네이버 뉴스 댓글 ${res.status} 응답`);
  const text = await res.text();
  const data = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
  if (data.success === false) throw new Error(data.message || "네이버 뉴스 댓글을 읽지 못함");
  return data.result || {};
}

// 네이버 뉴스 기사 댓글 전부 (답글 포함, 삭제·블라인드 제외) → [{ content, writtenAt, isReply }]
async function readNewsComments(url, { isStopped = () => false, onProgress } = {}) {
  const ids = newsIds(url);
  const out = [];
  const seen = new Set();
  const push = (c, isReply) => {
    if (!c || c.deleted || c.blindReport || c.secret || !c.contents || seen.has(c.commentNo)) return;
    seen.add(c.commentNo);
    const p = parseKoreanDate(String(c.regTime || "").replace("T", " "));
    out.push({ content: c.contents, writtenAt: p ? sheetDateTime(p.date) : c.regTime || "", isReply });
  };
  let title = "";
  for (let page = 1; page <= 200 && !isStopped(); page++) {
    const r = await newsCbox(ids, page);
    title = title || r.objectTitle || "";
    const list = r.commentList || [];
    for (const c of list) {
      push(c, false);
      if (c.replyCount > 0) {
        await sleep(randomBetween(NEWS_DELAY));
        try {
          const rr = await newsCbox(ids, 1, c.commentNo);
          for (const x of rr.commentList || []) if (x.commentNo !== c.commentNo) push(x, true);
        } catch {
          /* 답글은 못 읽어도 넘어감 */
        }
      }
    }
    onProgress?.(out.length);
    const total = r.pageModel?.totalPages || r.pageModel?.lastPage;
    if (!list.length || (total && page >= total)) break;
    await sleep(randomBetween(NEWS_DELAY));
  }
  return { comments: out, title };
}

// ---------------------------------------------------------------------------
// 자동차 커뮤니티 (보배드림 · 클리앙 · 뽐뿌)
// ---------------------------------------------------------------------------

// 사이트별 읽는 방법 (게시판 주소나 글 주소로 고른다). 모르는 사이트면 null
function communityAdapter(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^m\./, "www.");

  if (host.endsWith("bobaedream.co.kr")) {
    const code = u.searchParams.get("code") || "national";
    return {
      site: "보배드림",
      listUrl: (p) => `https://www.bobaedream.co.kr/list?code=${encodeURIComponent(code)}&page=${p}`,
      articleId: (href) => {
        const a = safeUrl(href, "https://www.bobaedream.co.kr/");
        if (!a || !/bobaedream\.co\.kr$/.test(a.hostname) || a.pathname !== "/view") return null;
        const no = a.searchParams.get("No") || a.searchParams.get("no");
        return a.searchParams.get("code") === code && /^\d+$/.test(no || "") ? no : null;
      },
      articleUrl: (id) => `https://www.bobaedream.co.kr/view?code=${encodeURIComponent(code)}&No=${id}`,
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
      listUrl: (p) => `https://www.clien.net/service/board/${board}?&od=T31&po=${p - 1}`,
      articleId: (href) => {
        const mm = String(href).match(new RegExp(`/service/board/${board}/(\\d+)`));
        return mm ? mm[1] : null;
      },
      articleUrl: (id) => `https://www.clien.net/service/board/${board}/${id}`,
      dateSelectors: [".post_author .view_count.date", ".post_author", ".post_information"],
      commentItems: [".comment_row:not(.blocked)", ".comment .comment_row"],
      commentText: [".comment_view", ".comment_content"],
      commentDate: [".timestamp", ".comment_time", ".comment_info"],
    };
  }

  if (host.endsWith("ppomppu.co.kr")) {
    const id = u.searchParams.get("id") || "car";
    return {
      site: "뽐뿌",
      listUrl: (p) => `https://www.ppomppu.co.kr/zboard/zboard.php?id=${encodeURIComponent(id)}&page=${p}`,
      articleId: (href) => {
        if (!/view\.php/.test(href)) return null;
        const q = String(href).replace(/&amp;/g, "&");
        const idm = q.match(/[?&]id=([^&#]+)/);
        const nm = q.match(/[?&]no=(\d+)/);
        return idm && nm && idm[1] === id ? nm[1] : null;
      },
      articleUrl: (no) => `https://www.ppomppu.co.kr/zboard/view.php?id=${encodeURIComponent(id)}&no=${no}`,
      dateSelectors: [".sub-top-text-box", ".topTitle-mainbox", ".view_info", "td.han"],
      commentItems: [".comment_wrapper", "div[id^='comment_'] .comment_line", ".comment_line", ".cmAr .sect-cmt"],
      commentText: ["div[id^='commentContent']", ".comment_template .han", ".mid-text-area", ".han", ".ov"],
      commentDate: [".eng-day", ".comment_date", ".date"],
    };
  }
  return null;
}

function isCommunityUrl(url) {
  return !!communityAdapter(url);
}

// 글 주소를 엑셀에 쓰는 모양으로 (게시판 번호·글 번호만 남김)
function communityArticleUrl(url) {
  const ad = communityAdapter(url);
  const id = ad && ad.articleId(url);
  return id ? ad.articleUrl(id) : url;
}

// 목록의 글 링크가 든 한 줄에서 날짜·공지 여부·댓글 수를 읽는다
function boardRowInfo(a, title, ad) {
  let e = a.parentElement;
  let found = null;
  let rowEl = null;
  for (let depth = 0; e && depth < 8; depth++, e = e.parentElement) {
    const ids = new Set();
    for (const x of e.querySelectorAll("a[href]")) {
      const id = ad.articleId(x.getAttribute("href") || "");
      if (id) ids.add(id);
    }
    if (ids.size > 1) break; // 다른 글까지 담기 시작함
    if (/^(TR|LI)$/.test(e.tagName) || /item|row|list/i.test(e.className || "")) rowEl = e;
    // 마우스를 올리면 보이는 전체 날짜(title 속성)를 먼저, 그다음 화면 글자
    let parsed = null;
    for (const x of e.querySelectorAll("[title]")) {
      const p = parseKoreanDate(x.getAttribute("title"));
      if (p && p.hasTime) {
        parsed = p;
        break;
      }
    }
    if (!parsed) parsed = parseKoreanDate(spacedText(e).replace(title, " "));
    if (parsed) {
      found = parsed;
      rowEl = rowEl || e;
      if (parsed.hasTime) break;
    }
  }
  const r = rowEl || a.parentElement;
  const notice = r ? /공지|notice/i.test(`${r.className || ""} ${r.querySelector("img[alt]")?.getAttribute("alt") || ""}`) : false;
  let ccount = null; // 목록의 댓글 수 (뽐뿌 list_comment2 등)
  if (r) {
    for (const x of r.querySelectorAll("[class*='comment'],[class*='cmt'],[class*='reply'],[class*='Comment'],[class*='Reply']")) {
      const m = textOf(x).match(/^[\[(]?\s*(\d{1,5})\s*[\])]?$/);
      if (m) {
        ccount = +m[1];
        break;
      }
    }
  }
  return { parsed: found, notice, ccount };
}

// 게시판 목록 한 페이지 → [{ id, title, parsed, notice, ccount }]
async function readBoardPage(ad, page) {
  const doc = await fetchDocument(ad.listUrl(page));
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
    items.set(id, { id, title, ...boardRowInfo(a, title, ad) });
  }
  return [...items.values()].filter((it) => it.title.length >= 2 && !/^\[?\d+\]?$/.test(it.title));
}

// 게시글 화면에서 작성 시각
async function readCommunityTime(url) {
  const ad = communityAdapter(url);
  const doc = await fetchDocument(url);
  for (const t of [...(ad?.dateSelectors || []).map((s) => textOf(doc.querySelector(s))).filter(Boolean), textOf(doc.body).slice(0, 6000)]) {
    const m = t.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})[^\d]{0,12}(\d{1,2}):(\d{2})/);
    if (m) return { date: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), hasTime: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 커뮤니티 댓글 (받아 온 문서에서도, 보이지 않는 틀·탭 화면 안에서도 쓰므로 함수들은 혼자 동작해야 함)
// ---------------------------------------------------------------------------

// 화면에 보이는 댓글 수 ("댓글 18", "댓글 [18]", "코멘트 18")
function expectedCommentCount(doc) {
  const t = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ");
  let n = 0;
  for (const m of t.matchAll(/(?:댓글|코멘트|comment)s?\s*[\[(:：]?\s*(\d{1,4})\s*[\])]?(?:\s*개)?/gi)) n = Math.max(n, +m[1]);
  return n;
}

// 댓글 찾기. sel: 사이트별 칸 이름 { items, text, date } — 먼저 써 보고, 없으면
// 이름(class·id)에 comment·cmt·reply·댓글 이 들어간 요소를 모양별로 묶어 댓글처럼 반복되는 묶음을 고른다.
// → { comments: [{ text, dateText, isReply }], groups: [진단용 묶음 요약], how }
function findCommentsIn(root, sel) {
  const doc = root && root.querySelectorAll ? root : document;
  const T = (e) => String((e && (e.innerText || e.textContent)) || "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
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

// (화면 안에서 실행) 끝까지 내리고 댓글 '더보기'·다음 댓글 쪽을 한 번 누른다 → { clicked, expected }
function expandCommentPage() {
  const se = document.scrollingElement || document.documentElement;
  if (se) se.scrollTop = se.scrollHeight;
  let clicked = false;
  const MORE = /^(댓글\s*)?(더\s*보기|더보기|이전\s*댓글|댓글\s*더|다음\s*댓글|more|load more)(\s*[\[(]?\d*[\])]?)?\s*[▼+>]?$/i;
  const inComment = (e) => /comment|cmt|reply|댓글/i.test(`${e.className || ""} ${e.id || ""} ${e.closest("[class*='comment'],[class*='cmt'],[class*='reply'],[id*='comment'],[id*='cmt']") ? "comment" : ""}`);
  for (const e of document.querySelectorAll("a, button, span[onclick], div[onclick]")) {
    const t = String(e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 30 || e.dataset.lx3Clicked) continue;
    // '더보기' 버튼, 또는 댓글 영역 안의 댓글 쪽 번호(2, 3, …) — 한 번에 하나씩 눌러 쌓는다
    const isMore = MORE.test(t) && (inComment(e) || /댓글/.test(t));
    const isPage = /^\d{1,3}$/.test(t) && +t > 1 && inComment(e) && !e.closest("[aria-current], .on, .active, .current, strong");
    if (!isMore && !isPage) continue;
    e.dataset.lx3Clicked = "1";
    try {
      e.click();
      clicked = true;
    } catch {
      /* 무시 */
    }
    if (isPage) break;
  }
  const text = String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
  let expected = 0;
  for (const m of text.matchAll(/(?:댓글|코멘트|comment)s?\s*[\[(:：]?\s*(\d{1,4})\s*[\])]?(?:\s*개)?/gi)) expected = Math.max(expected, +m[1]);
  return { clicked, expected };
}

// 받아 온 화면에서 댓글 쪽(페이지) 링크 찾기 (댓글 영역 안의 숫자 링크, 같은 글 주소)
function commentPageLinks(doc, url) {
  const base = safeUrl(url);
  const key = channelKey(url);
  const out = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const t = textOf(a);
    if (!/^\d{1,3}$/.test(t) || +t < 2) continue;
    const host = a.closest("[class*='comment' i],[class*='cmt' i],[id*='comment' i],[id*='cmt' i],[class*='reply' i]");
    if (!host) continue;
    const href = a.getAttribute("href") || "";
    if (/^(#|javascript:)/i.test(href)) continue;
    const u = safeUrl(href, base);
    if (u && channelKey(u.toString()) === key && u.toString() !== base.toString()) out.add(u.toString());
  }
  return [...out].slice(0, 50);
}

const DELETED_COMMENT = /^(삭제된\s*댓글|삭제\s*된\s*댓글|블라인드|관리자에\s*의해|신고에\s*의해|비밀\s*댓글)/;

// 커뮤니티 게시글 댓글 모두 읽기 → { comments: [{ content, writtenAt, isReply }], expected, how, title, diag }
// 1) 받아 온 화면 (+ 댓글 쪽 링크가 있으면 쪽마다)
// 2) 화면에 보이는 댓글 수보다 모자라면 → 보이지 않는 틀(설정 시 뒤쪽 탭)로 열어 끝까지 내리고 '더보기'·댓글 쪽을 눌러 가며 다시
// 3) 그래도 댓글 수가 보이는데 하나도 못 읽었으면 실패 (다시 수집 대상)
async function readCommunityComments(url, { isStopped = () => false, onStatus, tabFallback = false } = {}) {
  const ad = communityAdapter(url);
  const sel = { items: ad.commentItems, text: ad.commentText, date: ad.commentDate };
  const doc = await fetchDocument(url);
  const title = textOf(doc.querySelector(".post_subject, .view_subject, .topTitle h1, h1, h2, h3, title")).replace(/\s+/g, " ").slice(0, 200);
  let all = findCommentsIn(doc, sel);
  let comments = all.comments;
  let how = all.how;
  let expected = expectedCommentCount(doc);
  const merge = (list) => {
    const seen = new Set(comments.map((c) => `${c.text}|${c.dateText}`));
    for (const c of list) {
      const k = `${c.text}|${c.dateText}`;
      if (!seen.has(k)) {
        seen.add(k);
        comments.push(c);
      }
    }
  };
  for (const pageUrl of commentPageLinks(doc, url)) {
    if (isStopped()) break;
    onStatus?.(`댓글 다음 쪽 읽는 중… (${comments.length}개)`);
    await sleep(randomBetween([800, 1600]));
    const more = findCommentsIn(await fetchDocument(pageUrl), sel);
    merge(more.comments);
    how = "댓글 쪽 넘김";
  }
  const enough = () => comments.length > 0 && comments.length >= Math.ceil(expected * 0.8);
  let live = null;
  if (!enough() && !isStopped()) {
    onStatus?.(`화면을 열어 댓글을 끝까지 펼쳐 읽는 중… (보이는 댓글 수 ${expected || "?"}개)`);
    live = await readCommentsLive(url, sel, expected, { isStopped, mode: "frame" }).catch(() => null);
    if ((!live || live.comments.length < Math.ceil(expected * 0.8)) && tabFallback && !isStopped()) {
      onStatus?.("숨긴 화면에서 다 못 읽어 뒤쪽 탭으로 다시 읽는 중…");
      const t = await readCommentsLive(url, sel, expected, { isStopped, mode: "tab" }).catch(() => null);
      if (t && (!live || t.comments.length > live.comments.length)) live = t;
    }
    if (live) {
      expected = Math.max(expected, live.expected || 0);
      if (live.comments.length > comments.length) {
        comments = live.comments;
        how = "화면을 열어 다시 읽음";
      }
    }
  }
  if (expected > 0 && !comments.length) throw new Error(`화면에 댓글 ${expected}개가 보이는데 읽지 못했습니다`);
  const out = [];
  const seen = new Set();
  for (const c of comments) {
    const t = String(c.text || "").replace(/\s+/g, " ").trim();
    if (!t || DELETED_COMMENT.test(t)) continue;
    const p = parseKoreanDate(c.dateText);
    const writtenAt = p ? (p.hasTime ? sheetDateTime(p.date) : sheetDateTime(p.date).slice(0, 12)) : c.dateText || "";
    const k = `${t}|${writtenAt}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ content: t, writtenAt, isReply: !!c.isReply });
  }
  const diag = enough() ? null : { url, expected, got: comments.length, fetched: all.groups, live: live ? live.groups : null };
  return { comments: out, expected, how, title, diag };
}

// 이 탭(수집 화면) 안의 보이지 않는 틀에 커뮤니티 화면을 넣을 수 있게, 이 탭에서 여는 그 틀에만 '틀 안 표시 금지' 머리글을 뗀다
// (카페용 규칙 10번은 cafe-common.js — 다른 확장과 같이 쓰는 파일이라 커뮤니티는 여기서 따로 11번)
async function allowCommunityFrames() {
  const me = await chrome.tabs.getCurrent();
  if (!me) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [11],
    addRules: [{
      id: 11,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition: { tabIds: [me.id], resourceTypes: ["sub_frame"], requestDomains: ["bobaedream.co.kr", "clien.net", "ppomppu.co.kr"] },
    }],
  });
}

// 화면을 열어(보이지 않는 틀 또는 뒤쪽 탭) 끝까지 내리고 '더보기'·댓글 쪽을 눌러 가며 댓글을 모은다
async function readCommentsLive(url, sel, expected, { isStopped, mode }) {
  if (mode === "frame") await allowCommunityFrames();
  return withTab(url, async (where) => {
    await sleep(1500);
    let best = { comments: [], groups: [], expected: 0 };
    const seen = new Set();
    let stable = 0;
    for (let round = 0; round < 30 && !isStopped(); round++) {
      const found = await runInFrames(where, findCommentsIn, [null, sel]);
      let added = 0;
      for (const r of found) {
        if (!r) continue;
        if ((r.groups || []).length > best.groups.length) best.groups = r.groups;
        for (const c of r.comments || []) {
          const k = `${c.text}|${c.dateText}`;
          if (seen.has(k)) continue;
          seen.add(k);
          best.comments.push(c);
          added++;
        }
      }
      const prep = await runInFrames(where, expandCommentPage);
      for (const r of prep) if (r) best.expected = Math.max(best.expected, r.expected || 0);
      const clicked = prep.some((r) => r && r.clicked);
      const want = Math.max(expected || 0, best.expected);
      stable = !added && !clicked ? stable + 1 : 0;
      if (best.comments.length && best.comments.length >= want && !clicked) break;
      if (stable >= 2 && (best.comments.length || round >= 3)) break;
      await sleep(1500);
    }
    return best;
  }, { mode });
}
