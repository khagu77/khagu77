// 서버에서 공식 경로로 수집 (설치 없이 서버만으로)
// - 언론: Google 뉴스 RSS 검색 (무료·공식 · 국내 언론사 대부분)
// - 블로그: 다음(카카오) 블로그 검색 API (무료·공식 · 카카오 REST API 키 사용)
// - 뽐뿌: 뽐뿌가 제공하는 게시판 RSS (화면 대신 구독용 주소)
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { decodeHtml, fetchWithTimeout, hash, pool, UA } from "../util.js";
import { getState, setState } from "../db.js";

const TICKS_PER_DAY = 288;

// 돌아가며 이번 차례 검색어 고르기
async function pickQueries(stateId, queries, perTick) {
  const st = await getState(stateId);
  let i = (st.i || 0) % Math.max(1, queries.length);
  const todo = [];
  for (let n = 0; n < Math.min(perTick, queries.length); n++) { todo.push(queries[i]); i = (i + 1) % queries.length; }
  return { st, todo, next: i };
}

export function parseGoogleNewsRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $("item").each((_, e) => {
    const el = $(e);
    const source = el.find("source").text().trim();
    const sourceUrl = el.find("source").attr("url") || "";
    let title = decodeHtml(el.find("title").text());
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const d = new Date(el.find("pubDate").text());
    out.push({ title, url: el.find("link").text().trim(), source, sourceUrl, postedAt: isNaN(d) ? null : d });
  });
  return out;
}

export async function collectGoogleNews({ queries, settings, log }) {
  if (!settings.collect.googleNews || !queries.length) return [];
  const perTick = Math.max(5, Number(settings.collect.googleNewsPerTick) || 20);
  const { todo, next } = await pickQueries("gnews", queries, perTick);
  const seenDoc = await getState("gnews_seen");
  const out = [];
  let fail = 0;
  await pool(todo, 4, async (q) => {
    const u = `https://news.google.com/rss/search?${new URLSearchParams({ q: `${q} when:1d`, hl: "ko", gl: "KR", ceid: "KR:ko" })}`;
    const r = await fetchWithTimeout(u, { headers: { "User-Agent": UA } });
    if (!r.ok) { fail++; if (fail <= 2) log.push(`Google 뉴스 "${q}": HTTP ${r.status}`); return; }
    const rows = parseGoogleNewsRss(await r.text());
    const seen = new Set(seenDoc[q] || []);
    for (const it of rows) {
      const h = hash(it.url, 10);
      if (seen.has(h)) continue;
      let site = null;
      try { site = it.sourceUrl ? new URL(it.sourceUrl).hostname.replace(/^www\./, "") : null; } catch {}
      out.push({ channel: "news", title: it.title, desc: "", url: it.url, source: it.source, sourceId: "", site, postedAt: it.postedAt, via: "gnews", query: q });
    }
    seenDoc[q] = rows.map((x) => hash(x.url, 10)).slice(0, 100);
  });
  await Promise.all([setState("gnews", { i: next, at: new Date() }), setState("gnews_seen", seenDoc)]);
  log.push(`Google 뉴스: 검색 ${todo.length}회 (전체 ${queries.length}개 중), 받은 기사 ${out.length}건${fail ? `, 실패 ${fail}` : ""}`);
  return out;
}

export async function collectDaumBlog({ queries, settings, secrets, log }) {
  if (!settings.collect.daumBlog || !queries.length) return [];
  if (!secrets.kakaoRestKey) { log.push("다음 블로그: 카카오 REST API 키 없음"); return []; }
  const perTick = Math.max(5, Number(settings.collect.daumBlogPerTick) || 20);
  const { todo, next } = await pickQueries("daumblog", queries, perTick);
  const seenDoc = await getState("daumblog_seen");
  const out = [];
  let fail = 0;
  await pool(todo, 4, async (q) => {
    const r = await fetchWithTimeout(`https://dapi.kakao.com/v2/search/blog?${new URLSearchParams({ query: q, sort: "recency", size: "50" })}`, { headers: { Authorization: `KakaoAK ${secrets.kakaoRestKey}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { fail++; if (fail <= 2) log.push(`다음 블로그 "${q}": ${j.message || j.msg || `HTTP ${r.status}`}`); return; }
    const seen = new Set(seenDoc[q] || []);
    const docs = j.documents || [];
    for (const d of docs) {
      const h = hash(d.url, 10);
      if (seen.has(h)) continue;
      const owner = (String(d.url).match(/blog\.naver\.com\/([\w-]+)/) || [])[1] || "";
      const dt = new Date(d.datetime);
      out.push({ channel: "blog", title: decodeHtml(d.title), desc: decodeHtml(d.contents).slice(0, 400), url: d.url, source: decodeHtml(d.blogname), sourceId: owner, postedAt: isNaN(dt) ? null : dt, via: "daum:blog", query: q });
    }
    seenDoc[q] = docs.map((d) => hash(d.url, 10)).slice(0, 100);
  });
  await Promise.all([setState("daumblog", { i: next, at: new Date() }), setState("daumblog_seen", seenDoc)]);
  log.push(`다음 블로그: 검색 ${todo.length}회, 받은 글 ${out.length}건${fail ? `, 실패 ${fail}` : ""}`);
  return out;
}

export function parseBoardRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $("item").each((_, e) => {
    const el = $(e);
    const d = new Date(el.find("pubDate").text());
    out.push({ title: decodeHtml(el.find("title").text()), url: el.find("link").text().trim().replace(/^http:/, "https:"), postedAt: isNaN(d) ? null : d });
  });
  return out;
}

// 뽐뿌 게시판 RSS
export async function collectPpomppuRss({ settings, log }) {
  if (!settings.collect.ppomppuRss) return [];
  const boards = (settings.boards || []).map((b) => ({ ...b, id: (String(b.url).match(/ppomppu\.co\.kr\/zboard\/zboard\.php\?id=([\w-]+)/) || [])[1] })).filter((b) => b.id);
  if (!boards.length) return [];
  const seenDoc = await getState("ppomppu_rss_seen");
  const out = [];
  const errs = [];
  await pool(boards, 2, async (b) => {
    const r = await fetchWithTimeout(`https://www.ppomppu.co.kr/rss.php?id=${encodeURIComponent(b.id)}`, { headers: { "User-Agent": UA } });
    if (!r.ok) { errs.push(`${b.id} HTTP ${r.status}`); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    const head = buf.slice(0, 200).toString("latin1");
    const xml = /euc-kr/i.test(head) ? iconv.decode(buf, "cp949") : buf.toString("utf8");
    const rows = parseBoardRss(xml);
    const seen = new Set(seenDoc[b.id] || []);
    for (const it of rows) {
      const no = (it.url.match(/[?&]no=(\d+)/) || [])[1];
      if (!no || seen.has(no)) continue;
      out.push({ channel: "ppomppu", title: it.title, desc: "", url: `https://www.ppomppu.co.kr/zboard/view.php?id=${b.id}&no=${no}`, source: b.name || "뽐뿌", sourceId: `ppomppu:${b.id}`, postedAt: it.postedAt, requireMatch: true, via: "ppomppu:rss" });
    }
    seenDoc[b.id] = rows.map((it) => (it.url.match(/[?&]no=(\d+)/) || [])[1]).filter(Boolean).slice(0, 200);
  });
  await setState("ppomppu_rss_seen", seenDoc);
  log.push(`뽐뿌 RSS: 게시판 ${boards.length}곳, 새 글 ${out.length}건${errs.length ? ` (막힘: ${errs.join(", ")})` : ""}`);
  return out;
}
void TICKS_PER_DAY;
