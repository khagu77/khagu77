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
      views: el.find("media\\:statistics").attr("views") ?? null,
      likes: el.find("media\\:starRating").attr("count") ?? null,
    });
  });
  return out;
}

// RSS 가 막힐 때: 유튜브 API 로 채널의 최근 업로드 (채널당 1시간에 한 번 · 1단위)
async function channelUploadsApi(c, key) {
  const pl = `UU${String(c.id).slice(2)}`;
  const r = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/playlistItems?${new URLSearchParams({ part: "snippet,contentDetails", playlistId: pl, maxResults: "8", key })}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${c.name} API ${r.status} ${j.error?.message || ""}`.slice(0, 120));
  return (j.items || []).map((it) => {
    const sn = it.snippet || {};
    const vid = it.contentDetails?.videoId || sn.resourceId?.videoId;
    const d = new Date(it.contentDetails?.videoPublishedAt || sn.publishedAt);
    return vid && {
      channel: "youtube", title: decodeHtml(sn.title || ""), desc: decodeHtml(sn.description || "").slice(0, 500), url: `https://www.youtube.com/watch?v=${vid}`,
      source: c.name || sn.channelTitle, sourceId: c.id, postedAt: isNaN(d) ? null : d, thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`, vid,
    };
  }).filter(Boolean);
}

export async function collectYoutubeRss({ settings, secrets = {}, log }) {
  const chans = settings.favYoutube || [];
  if (!chans.length) return [];
  const seenDoc = await getState("yt_rss_seen");
  const apiAt = seenDoc._apiAt || {};
  const key = String(secrets.youtubeKeys || "").split(/\s+/).filter(Boolean)[0];
  const out = [];
  let fail = 0;
  let read = 0;
  let viaApi = 0;
  const res = await pool(chans, 6, async (c) => {
    let items = [];
    let via = "yt:rss";
    try {
      const r = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(c.id)}`);
      if (!r.ok) throw new Error(`${c.name} RSS ${r.status}`);
      items = parseRss(await r.text(), c.id);
      if (!items.length) throw new Error(`${c.name} RSS 비어 있음`);
    } catch (e) {
      // RSS 실패 → API 로 대신 (채널당 1시간에 한 번)
      if (!key || Date.now() - (apiAt[c.id] || 0) < 60 * 60e3) throw e;
      apiAt[c.id] = Date.now();
      items = await channelUploadsApi(c, key);
      via = "yt:api";
      viaApi++;
    }
    read += items.length;
    const seen = new Set(seenDoc[c.id] || []);
    const oldMs = Date.now() - (Number(settings.collect.youtubeRssMaxDays) || 3) * 86400e3;
    for (const it of items) if (!seen.has(it.vid) && !(it.postedAt && it.postedAt.getTime() < oldMs)) out.push({ ...it, source: c.name || it.source, requireMatch: true, via });
    seenDoc[c.id] = [...new Set([...items.map((x) => x.vid), ...seen])].slice(0, 40);
  });
  seenDoc._apiAt = apiAt;
  await markShorts(out.filter((x) => x.via === "yt:api"));
  for (const r of res) if (!r.ok) { fail++; if (fail <= 2) log.push(`유튜브 RSS: ${r.error.message}`); }
  await setState("yt_rss_seen", seenDoc);
  log.push(`유튜브 관심 채널 ${chans.length}곳 확인 (영상 ${read}개 읽음${viaApi ? `, RSS 대신 API ${viaApi}곳` : ""}), 새 영상 ${out.length}건${fail ? `, 실패 ${fail}` : ""}`);
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

// 영상 통계 (조회수 · 좋아요 · 댓글수): videos.list 한 번에 50개 = 할당량 1단위
export async function videoStats(vids, secrets) {
  const keys = String(secrets.youtubeKeys || "").split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const out = new Map();
  if (!keys.length) return out;
  const ids = [...new Set(vids.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (const key of keys) {
      try {
        const r = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "statistics", id: chunk.join(","), key })}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { videoStats.lastError = `${r.status} ${j.error?.message || ""}`.slice(0, 120); continue; }
        for (const it of j.items || []) {
          const s = it.statistics || {};
          out.set(it.id, { views: s.viewCount ?? null, likes: s.likeCount ?? null, comments: s.commentCount ?? null });
        }
        break;
      } catch (e) { videoStats.lastError = e.message; }
    }
  }
  return out;
}

// 새로 수집한 영상에 통계 붙이기
export async function addVideoStats(items, secrets) {
  const yt = items.filter((it) => it && it.channel === "youtube" && it.vid);
  if (!yt.length) return 0;
  const m = await videoStats(yt.map((it) => it.vid), secrets);
  for (const it of yt) { const s = m.get(it.vid); if (s) Object.assign(it, s); }
  return m.size;
}
