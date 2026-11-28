// 네이버 검색 결과 화면 읽기 (검색 API 키 없이) — 뉴스 · 블로그 · 카페글, 최신순 · 최근 1일
// 네이버가 새 앱에 검색 API 를 주지 않아 LX3 수집기의 언론 검색과 같은 방식으로 화면을 직접 읽는다.
// 화면 구조(클래스 이름)가 자주 바뀌므로 링크 주소 모양으로 글을 찾고, 글마다 감싼 상자에서 제목·요약·출처·시각을 고른다.
import * as cheerio from "cheerio";
import { decodeHtml, fetchWithTimeout, hash, kstParts, sleep, UA } from "../util.js";
import { getState, setState } from "../db.js";
import { pressName } from "./naver.js";

const isNaverHost = (h) => /(^|\.)(naver\.com|naver\.net|pstatic\.net|naver\.me|navercorp\.com)$/i.test(h);

export function searchUrl(kind, q, page = 1) {
  const p = new URLSearchParams({ query: q, nso: "so:dd,p:1d", sort: "1" });
  if (kind === "news") { p.set("where", "news"); p.set("start", String((page - 1) * 10 + 1)); }
  if (kind === "blog") { p.set("ssc", "tab.blog.all"); p.set("start", String((page - 1) * 30 + 1)); }
  if (kind === "cafe") { p.set("ssc", "tab.cafe.all"); p.set("start", String((page - 1) * 30 + 1)); }
  return `https://search.naver.com/search.naver?${p}`;
}

// 링크 주소 → 글 식별
export function linkKey(kind, href) {
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
    return null;
  }
  return null;
}

// "3시간 전" · "2026.11.27." · "11.27." → 시각
export function relTime(text, now = new Date()) {
  const t = String(text || "");
  let m = t.match(/(\d+)\s*(초|분|시간|일|주)\s*전/);
  if (m) return new Date(now.getTime() - +m[1] * { 초: 1e3, 분: 60e3, 시간: 3600e3, 일: 86400e3, 주: 7 * 86400e3 }[m[2]]);
  if (/방금/.test(t)) return now;
  m = t.match(/(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 9, +m[5] || 0));
  if (/어제/.test(t)) return new Date(now.getTime() - 86400e3);
  return null;
}

const titleScore = ($, a, text) => {
  const cls = `${$(a).attr("class") || ""} ${$(a).find("*").map((_, x) => $(x).attr("class") || "").get().join(" ")} ${$(a).parent().attr("class") || ""}`;
  let sc = 0;
  if (/tit|headline|subject|title/i.test(cls)) sc += 4;
  if (/dsc|desc|body|summary|txt_lines|content|detail/i.test(cls)) sc -= 4;
  if ($(a).closest("h1,h2,h3,h4,strong,b").length) sc += 2;
  if (text.length >= 8 && text.length <= 100) sc += 2;
  if (text.length > 120) sc -= 3;
  if (/(\.\.\.|…)$/.test(text)) sc -= 2;
  if (/[다요죠]\.\s/.test(text)) sc -= 2;
  return sc;
};

export function parseSearchPage(html, kind) {
  const $ = cheerio.load(html);
  $("script, style, noscript, .blind, .sr-only, [aria-hidden='true']").remove();
  const clean = (e) => decodeHtml($(e).text()).replace(/새\s*창\s*열림|새창열림/g, " ").replace(/\s+/g, " ").trim();
  const links = [];
  $("a[href]").each((_, a) => {
    const k = linkKey(kind, $(a).attr("href"));
    if (k) links.push({ a, ...k });
  });
  const counts = (el) => {
    const nav = new Set();
    const ext = new Set();
    for (const l of links) if (el === l.a || $.contains(el, l.a)) (l.naver === false ? ext : nav).add(l.key);
    return { nav: nav.size, ext: ext.size };
  };
  const fits = (el) => { const c = counts(el); return c.nav <= 1 && c.ext <= 1; };
  const boxes = new Map(); // 상자 요소 → 글
  const boxOf = new Map(); // 링크 key → 글
  for (const l of links) {
    let it = boxOf.get(l.key);
    if (!it) {
      let box = l.a;
      while (box.parent && box.parent.type === "tag" && box.parent.name !== "body" && fits(box.parent)) box = box.parent;
      it = boxes.get(box);
      if (!it) { it = { box, keys: new Set(), url: "", extUrl: "", texts: [], meta: l }; boxes.set(box, it); }
      boxOf.set(l.key, it);
    }
    it.keys.add(l.key);
    if (l.naver === false) it.extUrl ||= l.url; else it.url ||= l.url;
    if (l.club !== undefined && !it.meta.club) it.meta = l;
    const text = clean(l.a);
    if (text.length >= 6 && !/^(네이버뉴스|언론사 선정|관련뉴스|더보기|카페 바로가기|블로그 바로가기)/.test(text)) it.texts.push({ text, sc: titleScore($, l.a, text) });
  }
  const out = [];
  const seen = new Set();
  for (const it of boxes.values()) {
    if (!it.texts.length) continue;
    const sorted = [...it.texts].sort((a, b) => b.sc - a.sc || a.text.length - b.text.length);
    const title = sorted[0].text.slice(0, 200);
    const snippet = it.texts.filter((x) => x.text !== title).sort((a, b) => b.text.length - a.text.length)[0]?.text.slice(0, 300) || "";
    const url = it.url || it.extUrl;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const boxText = clean(it.box);
    // 출처 이름: 링크 주소가 글이 아닌 카페·블로그·언론사 첫 화면 링크의 글자
    let source = "";
    $(it.box).find("a[href]").each((_, a) => {
      if (source) return;
      const href = String($(a).attr("href") || "").replace(/&amp;/g, "&");
      const t = clean(a);
      if (t.length < 2 || t.length > 30 || t === title) return;
      if (kind === "cafe" && /cafe\.naver\.com\/[\w-]+\/?(?:[?#]|$)/.test(href)) source = t;
      if (kind === "blog" && /blog\.naver\.com\/[\w-]+\/?(?:[?#]|$)/.test(href)) source = t;
    });
    if (kind === "news" && !source) {
      $(it.box).find("[class*='press'], [class*='Press'], [class*='profile-info-title'], [class*='source']").each((_, e) => {
        const t = clean(e);
        if (!source && t.length >= 2 && t.length <= 30 && !/네이버뉴스|\d{4}\./.test(t) && t !== title) source = t.replace(/\s*언론사\s*선정.*$/, "");
      });
      if (!source && it.extUrl) source = pressName(it.extUrl);
    }
    out.push({
      title, snippet, url, extUrl: it.extUrl, source,
      club: it.meta.club || "", owner: it.meta.owner || "",
      date: relTime(boxText),
    });
  }
  return out;
}

export function isBlockedPage(html, status) {
  return status === 403 || status === 429 || /자동입력\s*방지|비정상적인\s*접근|captcha/i.test(String(html).slice(0, 20000));
}

// 이번 5분 차례의 검색만 실행
export async function collectNaverWeb({ queries, settings, log }) {
  const kinds = ["news", "blog", "cafe"].filter((k) => settings.collect.naver?.[k]);
  if (!kinds.length || !queries.length) return [];
  const st = await getState("naverweb");
  const now = Date.now();
  if (st.blockedUntil > now) { log.push(`네이버 검색 화면: 잠시 쉬는 중 (${Math.ceil((st.blockedUntil - now) / 60000)}분 뒤 다시)`); return []; }
  const calls = [];
  for (const q of queries) for (const k of kinds) calls.push({ q, k });
  const perTick = Math.max(6, Number(settings.collect.naverWebPerTick) || 36);
  let i = (st.i || 0) % calls.length;
  const todo = [];
  for (let n = 0; n < Math.min(perTick, calls.length); n++) { todo.push(calls[i]); i = (i + 1) % calls.length; }
  const seenDoc = await getState("naverweb_seen");
  const out = [];
  let used = 0;
  let blocked = false;
  let fail = 0;
  const work = async ({ q, k }) => {
    const sk = `${k}|${q}`;
    const seen = new Set(seenDoc[sk] || []);
    const first = [];
    for (let page = 1; page <= 3 && !blocked; page++) {
      used++;
      let html, status;
      try {
        const r = await fetchWithTimeout(searchUrl(k, q, page), { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: "https://www.naver.com/" } });
        status = r.status;
        html = await r.text();
      } catch (e) { fail++; if (fail <= 2) log.push(`네이버 ${k} "${q}": ${e.message}`); return; }
      if (isBlockedPage(html, status)) { blocked = true; return; }
      if (status >= 400) { fail++; return; }
      const rows = parseSearchPage(html, k);
      let fresh = 0;
      for (const r of rows) {
        const h = hash(r.url, 10);
        if (page === 1) first.push(h);
        if (seen.has(h)) continue;
        fresh++;
        if (k === "news") out.push({ channel: "news", title: r.title, desc: r.snippet, url: r.url, source: r.source || pressName(r.extUrl || r.url), sourceId: "", postedAt: r.date, via: "naverweb:news", query: q });
        if (k === "blog") out.push({ channel: "blog", title: r.title, desc: r.snippet, url: r.url, source: r.source, sourceId: r.owner, postedAt: r.date, via: "naverweb:blog", query: q });
        if (k === "cafe") out.push({ channel: "cafe", title: r.title, desc: r.snippet, url: r.url, source: r.source, sourceId: r.club, postedAt: r.date, via: "naverweb:cafe", query: q });
      }
      if (!seenDoc[sk] || !rows.length || fresh < rows.length) break;
      await sleep(500 + Math.random() * 700);
    }
    if (first.length) seenDoc[sk] = first.slice(0, 60);
  };
  // 동시에 3개씩 · 사이사이 쉬어 가며 (사람이 보는 속도에 가깝게)
  for (let n = 0; n < todo.length && !blocked; n += 3) {
    await Promise.all(todo.slice(n, n + 3).map(work));
    await sleep(400 + Math.random() * 800);
  }
  if (blocked) {
    st.blocks = (st.blocks || 0) + 1;
    st.blockedUntil = now + Math.min(120, 15 * st.blocks) * 60e3; // 막히면 15분 → 30분 … 최대 2시간 쉼
    log.push(`네이버 검색 화면: 접근 제한 감지 → ${Math.min(120, 15 * st.blocks)}분 쉼`);
  } else st.blocks = 0;
  st.i = i;
  st.day = kstParts().day;
  await Promise.all([setState("naverweb", st), setState("naverweb_seen", seenDoc)]);
  log.push(`네이버 검색 화면: ${used}쪽 읽음 (전체 ${calls.length}개 중 ${todo.length}개 차례), 받은 글 ${out.length}건`);
  return out;
}
