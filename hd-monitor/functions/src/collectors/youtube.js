// 유튜브
// - 관심 채널: 채널 RSS(무료·무제한·차단 없음)로 새 영상을 10분마다 확인. 인싸케이처럼 must 채널은 키워드와 관계없이 저장
// - 유튜브 전체: YouTube Data API 검색(검색 1회 = 100단위, 키 1개당 하루 10,000단위) — 하루 예산을 5분 단위로 나눠 씀
import * as cheerio from "cheerio";
import { decodeHtml, fetchWithTimeout, kstParts, pool } from "../util.js";
import { getState, setState } from "../db.js";

const TICKS_PER_DAY = 288;

export function parseRss(xml, fallbackChannelId) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const channelName = $("feed > author > name").first().text() || $("feed > title").first().text();
  const out = [];
  $("entry").each((_, e) => {
    const el = $(e);
    const vid = el.find("yt\\:videoId").text();
    if (!vid) return;
    const d = new Date(el.find("published").text());
    out.push({
      channel: "youtube",
      title: decodeHtml(el.find("title").first().text()),
      desc: decodeHtml(el.find("media\\:description").text()).slice(0, 500),
      url: `https://www.youtube.com/watch?v=${vid}`,
      source: channelName,
      sourceId: el.find("yt\\:channelId").text() || fallbackChannelId,
      postedAt: isNaN(d) ? null : d,
      thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
      vid,
      // RSS 는 쇼츠(릴스) 영상의 링크를 /shorts/ 주소로 줌
      short: /\/shorts\//.test(el.find("link").attr("href") || ""),
    });
  });
  return out;
}

export async function collectYoutubeRss({ settings, log }) {
  const chans = settings.favYoutube || [];
  if (!chans.length) return [];
  const seenDoc = await getState("yt_rss_seen");
  const out = [];
  let fail = 0;
  let read = 0;
  const res = await pool(chans, 6, async (c) => {
    const r = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(c.id)}`);
    if (!r.ok) throw new Error(`${c.name} RSS ${r.status}`);
    const items = parseRss(await r.text(), c.id);
    if (!items.length) throw new Error(`${c.name} RSS 비어 있음`);
    read += items.length;
    const seen = new Set(seenDoc[c.id] || []);
    for (const it of items) if (!seen.has(it.vid)) out.push({ ...it, source: c.name || it.source, requireMatch: true, via: "yt:rss" });
    seenDoc[c.id] = items.map((x) => x.vid);
  });
  for (const r of res) if (!r.ok) { fail++; if (fail <= 2) log.push(`유튜브 RSS: ${r.error.message}`); }
  await setState("yt_rss_seen", seenDoc);
  log.push(`유튜브 관심 채널 ${chans.length}곳 확인 (영상 ${read}개 읽음), 새 영상 ${out.length}건${fail ? `, 실패 ${fail}` : ""}`);
  return out;
}

export async function collectYoutubeSearch({ queries, settings, secrets, log }) {
  const keys = String(secrets.youtubeKeys || "").split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (!keys.length || !queries.length) return [];
  const { day } = kstParts();
  const st = await getState("yt_search");
  if (st.day !== day) { st.day = day; st.used = {}; st.dead = {}; }
  // 할당량은 키가 아니라 Google Cloud 프로젝트 단위 (같은 프로젝트의 유튜브 모니터링 시스템과 하루 10,000단위를 나눠 씀)
  const unitsPerKey = Math.max(100, Number(settings.collect.youtubeDailyUnits) || 3000);
  const perDay = Math.floor(unitsPerKey / 100);
  st.credit = (st.credit || 0) + perDay / TICKS_PER_DAY;
  const n = Math.min(Math.floor(st.credit), 5);
  if (n < 1) { await setState("yt_search", st); return []; }
  st.credit -= n;
  const after = new Date(Date.now() - 3 * 86400e3).toISOString();
  const out = [];
  let i = (st.i || 0) % queries.length;
  for (let k = 0; k < n; k++) {
    const q = queries[i];
    i = (i + 1) % queries.length;
    const ki = keys.findIndex((_, x) => !st.dead[x] && (st.used[x] || 0) + 100 <= unitsPerKey);
    if (ki < 0) break;
    st.used[ki] = (st.used[ki] || 0) + 100;
    const u = `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
      part: "snippet", type: "video", order: "date", q, maxResults: "50", regionCode: "KR", relevanceLanguage: "ko", publishedAfter: after, key: keys[ki],
    })}`;
    try {
      const r = await fetchWithTimeout(u);
      const j = await r.json();
      if (!r.ok) {
        if (r.status === 403) st.dead[ki] = true;
        throw new Error(j.error?.message || r.status);
      }
      for (const it of j.items || []) {
        const vid = it.id?.videoId;
        if (!vid) continue;
        const sn = it.snippet || {};
        out.push({
          channel: "youtube", title: decodeHtml(sn.title), desc: decodeHtml(sn.description), url: `https://www.youtube.com/watch?v=${vid}`,
          source: decodeHtml(sn.channelTitle), sourceId: sn.channelId, postedAt: sn.publishedAt ? new Date(sn.publishedAt) : null,
          thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`, vid, via: "yt:search", query: q,
        });
      }
    } catch (e) {
      log.push(`유튜브 검색 "${q}": ${e.message}`);
    }
  }
  st.i = i;
  await markShorts(out);
  await setState("yt_search", st);
  log.push(`유튜브 검색 ${n}회, 받은 영상 ${out.length}건`);
  return out;
}

// 쇼츠(릴스) 여부: youtube.com/shorts/ID 가 그대로 열리면(200) 쇼츠, 일반 영상이면 보통 영상 주소로 넘김(303)
export async function isShort(vid) {
  try {
    const r = await fetchWithTimeout(`https://www.youtube.com/shorts/${encodeURIComponent(vid)}`, { method: "HEAD", redirect: "manual" }, 8000);
    if (r.status === 200) return true;
    if (r.status >= 300 && r.status < 400) return false;
  } catch {}
  return null; // 모름
}

export async function markShorts(items) {
  const todo = items.filter((it) => it.channel === "youtube" && it.short === undefined && it.vid).slice(0, 60);
  await pool(todo, 5, async (it) => { const v = await isShort(it.vid); if (v !== null) it.short = v; });
}
