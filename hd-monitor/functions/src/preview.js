// 글 주소만으로 제목 · 작성 일시 · 요약 읽기 ('글 직접 추가'에서 자동 입력)
// 서버 접속을 막는 사이트(뽐뿌 등)나 로그인이 필요한 글(네이버 카페 일부)은 못 읽음 → 화면에서 직접 입력
import * as cheerio from "cheerio";
import { decodeHtml, fetchHtml, fetchWithTimeout } from "./util.js";
import { rowDate } from "./collectors/community.js";

const clean = (s) => decodeHtml(String(s || "")).replace(/\s+/g, " ").trim();

export async function previewUrl(url, secrets = {}) {
  // 유튜브: API 로 정확하게
  const vid = (url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/) || [])[1];
  if (vid && /youtube\.com|youtu\.be/.test(url)) {
    const key = String(secrets.youtubeKeys || "").split(/\s+/).filter(Boolean)[0];
    if (key) {
      const r = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vid}&key=${encodeURIComponent(key)}`);
      const it = (await r.json().catch(() => ({}))).items?.[0]?.snippet;
      if (it) return { ok: true, title: clean(it.title), postedAt: it.publishedAt || null, desc: clean(it.description).slice(0, 300), source: clean(it.channelTitle) };
    }
  }
  let html;
  try { html = await fetchHtml(url); } catch (e) { return { ok: false, reason: /403|401/.test(e.message) ? "사이트가 서버 접속을 막음" : `페이지를 못 엶 (${e.message.slice(0, 40)})` }; }
  const $ = cheerio.load(html);
  const meta = (...names) => { for (const n of names) { const v = $(`meta[property="${n}"]`).attr("content") || $(`meta[name="${n}"]`).attr("content"); if (v) return clean(v); } return ""; };
  let title = meta("og:title", "twitter:title") || clean($("title").first().text());
  title = title.replace(/\s*[:|\-–]\s*(네이버\s*(카페|블로그|뉴스)|뽐뿌|보배드림|클리앙|NAVER).*$/i, "").trim();
  // 작성 일시: 메타 → JSON-LD → 화면의 날짜 글자
  let posted = meta("article:published_time", "og:article:published_time", "pubdate", "publishdate", "date", "datePublished");
  if (!posted) {
    $('script[type="application/ld+json"]').each((_, s) => { if (posted) return; const m = String($(s).html() || "").match(/"datePublished"\s*:\s*"([^"]+)"/); if (m) posted = m[1]; });
  }
  if (!posted) {
    const t = $("time[datetime]").first().attr("datetime") || $(".media_end_head_info_datestamp_time").first().attr("data-date-time") || "";
    if (t) posted = t;
  }
  // 시간대가 없는 날짜(예: '2026-11-28 14:05:00')는 한국 시간으로
  let ps = posted ? posted.trim().replace(/(\d{4})\.(\d{1,2})\.(\d{1,2})\.?/, (_, y, m, dd) => `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`).replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T") : "";
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(ps)) ps += "+09:00";
  let d = ps ? new Date(ps) : null;
  if (!d || isNaN(d)) { const g = rowDate($(".date, .view_date, .gall_date, .writer_info, .post_info, .se_publishDate, .se-date").first().text()); d = g || null; }
  const desc = meta("og:description", "description", "twitter:description").slice(0, 300);
  const source = meta("og:site_name");
  if (!title || /로그인|login/i.test(title)) return { ok: false, reason: "로그인이 필요한 글이라 못 읽음" };
  return { ok: true, title: title.slice(0, 300), postedAt: d && !isNaN(d) ? d.toISOString() : null, desc, source };
}
