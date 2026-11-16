// 유튜브 화면(공개 페이지)에서 영상 목록·영상 정보를 읽는다. 로그인 정보는 보내지 않는다(credentials: "omit").
// - 검색: /results?search_query=…&sp=CAI%3D (업로드 날짜순) · 기간을 잘라 after:/before: 로 여러 번
// - 채널: /@채널/search?query=… (채널 안 검색) · /@채널/videos (최신 영상)
// - 영상: /watch?v=… (정확한 게시 시각·조회수·좋아요·댓글 수·설명)
(function (global) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => sleep(a + Math.random() * (b - a));

  function withLang(url) {
    const u = new URL(url, "https://www.youtube.com");
    u.searchParams.set("hl", "ko");
    u.searchParams.set("gl", "KR");
    return u.toString();
  }

  async function getHtml(url) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(withLang(url), { credentials: "omit", cache: "no-store" });
        if (!res.ok) throw new Error(`유튜브 ${res.status} 응답`);
        return await res.text();
      } catch (e) {
        lastErr = e;
        await sleep(3000);
      }
    }
    throw lastErr;
  }

  // html 안의 `marker = {...}` JSON 을 괄호 짝을 맞춰 잘라낸다
  function extractJson(html, marker) {
    let idx = html.indexOf(marker);
    while (idx !== -1) {
      const start = html.indexOf("{", idx + marker.length);
      if (start !== -1 && /^\s*=\s*$/.test(html.slice(idx + marker.length, start))) {
        let depth = 0;
        let inStr = false;
        let quote = "";
        for (let i = start; i < html.length; i++) {
          const ch = html[i];
          if (inStr) {
            if (ch === "\\") i++;
            else if (ch === quote) inStr = false;
          } else if (ch === '"' || ch === "'") {
            inStr = true;
            quote = ch;
          } else if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              try {
                return JSON.parse(html.slice(start, i + 1));
              } catch {
                break;
              }
            }
          }
        }
      }
      idx = html.indexOf(marker, idx + marker.length);
    }
    return null;
  }

  // 객체 전체를 돌며 fn(key, value) — fn 이 false 를 돌려주면 그 아래로는 내려가지 않음
  function walk(o, fn) {
    if (Array.isArray(o)) {
      for (const v of o) walk(v, fn);
    } else if (o && typeof o === "object") {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (fn(k, v) === false) continue;
        if (v && typeof v === "object") walk(v, fn);
      }
    }
  }

  function txt(t) {
    if (!t) return "";
    if (typeof t === "string") return t;
    if (t.simpleText != null) return t.simpleText;
    if (t.content != null) return t.content;
    if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || "").join("");
    return "";
  }

  // "조회수 172,654회" · "35만" · "1.2천" · "2.7억" · "1.2K" · "조회수 없음" → 숫자
  function parseCount(s) {
    s = String(s ?? "").replace(/\s+/g, "");
    if (!s) return null;
    if (/없음|^No/i.test(s)) return 0;
    const m = s.match(/([\d.,]+)(천|만|억|[KMB])?/i);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(n)) return null;
    const mul = { 천: 1e3, 만: 1e4, 억: 1e8, k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
    return Math.round(n * mul);
  }

  // "18시간 전" · "2일 전" · "3주 전" · "1개월 전" · "스트리밍 시간: 3주 전" → 대략의 게시 시각 (now 기준)
  function parseAgo(s, now = new Date()) {
    s = String(s || "");
    const m = s.match(/(\d+)\s*(초|분|시간|일|주|개월|달|년)\s*전/) || s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
    if (!m) return null;
    const n = +m[1];
    const unit = m[2].toLowerCase();
    const day = 86400000;
    const ms = {
      초: 1000, second: 1000, 분: 60000, minute: 60000, 시간: 3600000, hour: 3600000,
      일: day, day, 주: 7 * day, week: 7 * day, 개월: 30.4 * day, 달: 30.4 * day, month: 30.4 * day, 년: 365 * day, year: 365 * day,
    }[unit];
    // 단위가 클수록 오차가 큼 → slack(그 정도의 오차 범위)도 함께
    const slack = { 주: 7 * day, week: 7 * day, 개월: 31 * day, 달: 31 * day, month: 31 * day, 년: 365 * day, year: 365 * day }[unit] || day;
    return { date: new Date(now.getTime() - n * ms), slack };
  }

  const ID_RE = /^[\w-]{11}$/;

  // 목록 화면(검색·채널) 한 개 항목 → { id, title, agoText, views, channelName, channelId, isShort, snippet }
  function fromVideoRenderer(v) {
    if (!ID_RE.test(v?.videoId || "")) return null;
    const owner = v.longBylineText || v.ownerText || v.shortBylineText;
    let channelId = "";
    let channelName = txt(owner);
    walk(owner, (k, x) => {
      if (!channelId && k === "browseEndpoint" && /^UC[\w-]{22}$/.test(x?.browseId || "")) channelId = x.browseId;
    });
    if (!channelId) channelId = JSON.stringify(owner || {}).match(/\/channel\/(UC[\w-]{22})/)?.[1] || "";
    // 공동 작업 영상: "A 및 B" → 첫 채널 이름
    let collab = "";
    walk(owner, (k, x) => {
      if (!collab && k === "listItemViewModel" && x?.title?.content) collab = x.title.content;
    });
    if (collab) channelName = collab;
    const snippet = (v.detailedMetadataSnippets || []).map((s) => txt(s.snippetText)).join(" ") || txt(v.descriptionSnippet);
    const isShort = /\/shorts\//.test(JSON.stringify(v.navigationEndpoint || {}));
    return {
      id: v.videoId,
      title: txt(v.title),
      agoText: txt(v.publishedTimeText),
      views: parseCount(txt(v.viewCountText)),
      channelName,
      channelId,
      isShort,
      snippet,
      lengthText: txt(v.lengthText),
    };
  }

  function fromLockup(v) {
    if (v?.contentType && v.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
    const id = v?.contentId;
    if (!ID_RE.test(id || "")) return null;
    const meta = v.metadata?.lockupMetadataViewModel || {};
    const parts = [];
    walk(meta.metadata, (k, x) => {
      if (k === "metadataParts" && Array.isArray(x)) for (const p of x) parts.push({ t: txt(p.text), a: p.accessibilityLabel || "" });
    });
    let views = null;
    let agoText = "";
    let channelName = "";
    for (const p of parts) {
      const both = `${p.a} ${p.t}`;
      if (/조회수|views?/i.test(both)) views = parseCount(p.a.replace(/조회수/, "") || p.t);
      else if (/전$|ago$/.test(p.t.trim())) agoText = p.t;
      else if (!channelName && p.t && !/^\d/.test(p.t)) channelName = p.t;
    }
    let channelId = "";
    walk(meta, (k, x) => {
      if (!channelId && k === "browseEndpoint" && /^UC[\w-]{22}$/.test(x?.browseId || "")) channelId = x.browseId;
    });
    return { id, title: txt(meta.title), agoText, views, channelName, channelId, isShort: false, snippet: "" };
  }

  function fromShorts(v) {
    let id = "";
    walk(v, (k, x) => {
      if (!id && k === "reelWatchEndpoint" && ID_RE.test(x?.videoId || "")) id = x.videoId;
    });
    if (!id && ID_RE.test(v?.videoId || "")) id = v.videoId;
    if (!id) return null;
    const second = txt(v.overlayMetadata?.secondaryText) || v.accessibilityText || "";
    const title = txt(v.overlayMetadata?.primaryText) || txt(v.headline) || String(v.accessibilityText || "").split(",")[0];
    return {
      id,
      title,
      agoText: second.match(/\d+\s*(초|분|시간|일|주|개월|달|년)\s*전/)?.[0] || "",
      views: parseCount((second.match(/조회수\s*([\d.,]+\s*[천만억]?)/) || [])[1] || txt(v.viewCountText)),
      channelName: "",
      channelId: "",
      isShort: true,
      snippet: "",
    };
  }

  // ytInitialData(또는 다음 쪽 응답)에서 영상 목록과 다음 쪽 열쇠
  function listItems(data) {
    const items = [];
    const seen = new Set();
    const tokens = [];
    walk(data, (k, v) => {
      let it = null;
      if (k === "videoRenderer" || k === "gridVideoRenderer" || k === "compactVideoRenderer") it = fromVideoRenderer(v);
      else if (k === "lockupViewModel") it = fromLockup(v);
      else if (k === "shortsLockupViewModel" || k === "reelItemRenderer") it = fromShorts(v);
      else if (k === "continuationItemRenderer") {
        const t = v?.continuationEndpoint?.continuationCommand?.token;
        if (t) tokens.push(t);
        return false;
      } else return;
      if (it && !seen.has(it.id)) {
        seen.add(it.id);
        items.push(it);
      }
      return false;
    });
    return { items, token: tokens[tokens.length - 1] || null };
  }

  // 검색 화면 한 쪽 (업로드 날짜순)
  async function searchPage(q) {
    const html = await getHtml(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAI%253D`);
    return listItems(extractJson(html, "ytInitialData") || {}).items;
  }

  // 전체 유튜브 검색: 다음 쪽 요청(유튜브 내부 API)은 확장에서 막히므로 쓰지 않고,
  // 기간을 windowDays 일씩 잘라 'after:날짜 before:날짜' 로 검색 화면(첫 쪽)을 여러 번 연다.
  // 한 구간의 결과가 꽉 차면(일반 영상 16개 이상) 구간을 반으로 나눠 다시 (최소 1일).
  // onPage(items, label) 가 구간마다 불림. 반환: 모든 항목
  async function search(query, { since, until = new Date(), windowDays = 7, stopped = () => false, onPage } = {}) {
    const day = 86400000;
    const d0 = new Date(since.getFullYear(), since.getMonth(), since.getDate());
    const dEnd = new Date(until.getFullYear(), until.getMonth(), until.getDate());
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const queue = [];
    for (let t = d0.getTime(); t <= dEnd.getTime(); t += windowDays * day) queue.push([new Date(t), new Date(Math.min(t + (windowDays - 1) * day, dEnd.getTime()))]);
    queue.reverse(); // 최근 구간부터
    const all = [];
    let first = true;
    while (queue.length && !stopped()) {
      const [a, b] = queue.shift();
      if (!first) await jitter(600, 1300);
      first = false;
      // after 는 그 날을 빼고, before 도 그 날을 빼는 경우가 있어 앞뒤 하루씩 넓힘 (정확한 날짜는 영상 화면에서 다시 확인)
      const q = `${query} after:${fmt(new Date(a.getTime() - day))} before:${fmt(new Date(b.getTime() + day))}`;
      const items = await searchPage(q);
      all.push(...items);
      onPage?.(items, `${fmt(a)}~${fmt(b)}`);
      const full = items.filter((x) => !x.isShort).length >= 16;
      const span = Math.round((b - a) / day) + 1;
      if (full && span > 1) {
        const mid = new Date(a.getTime() + Math.floor(span / 2) * day);
        queue.unshift([a, new Date(mid.getTime() - day)], [mid, b]);
      }
    }
    // 마지막으로 기간 지정 없이 최신순 한 번 (오늘 올라온 영상)
    if (!stopped()) {
      await jitter(600, 1300);
      const items = await searchPage(query);
      all.push(...items);
      onPage?.(items, "최신");
    }
    return all;
  }

  // 채널 주소 → 기본 주소 (https://www.youtube.com/@핸들 또는 /channel/UC…)
  function channelBase(url) {
    const s = String(url || "").trim();
    const m = s.match(/youtube\.com\/(@[^/?#\s]+|channel\/UC[\w-]{22}|c\/[^/?#\s]+|user\/[^/?#\s]+)/i);
    if (!m) return null;
    let part = m[1];
    if (part.startsWith("@")) part = "@" + encodeURIComponent(decodeURIComponent(part.slice(1)));
    return `https://www.youtube.com/${part}`;
  }

  function channelMeta(data) {
    const md = data?.metadata?.channelMetadataRenderer;
    if (!md) return null;
    return { id: md.externalId || "", name: md.title || "", url: md.vanityChannelUrl ? md.vanityChannelUrl.replace(/^http:/, "https:") : md.channelUrl || "" };
  }

  // 채널 안 검색 (/@채널/search?query=…) — 채널 이름·ID 도 함께
  async function channelSearch(base, query) {
    const html = await getHtml(`${base}/search?query=${encodeURIComponent(query)}`);
    const data = extractJson(html, "ytInitialData") || {};
    const ch = channelMeta(data);
    const { items } = listItems(data);
    for (const it of items) {
      if (!it.channelId && ch) it.channelId = ch.id;
      if (!it.channelName && ch) it.channelName = ch.name;
    }
    return { channel: ch, items };
  }

  // 채널의 최신 영상 (/videos 첫 화면, 약 30개)
  async function channelLatest(base) {
    const html = await getHtml(`${base}/videos`);
    const data = extractJson(html, "ytInitialData") || {};
    const ch = channelMeta(data);
    const { items } = listItems(data);
    for (const it of items) {
      it.channelId = it.channelId || ch?.id || "";
      it.channelName = it.channelName || ch?.name || "";
    }
    return { channel: ch, items };
  }

  const GONE = /비공개|삭제|존재하지|이용할 수 없|사용할 수 없|private|removed|deleted|unavailable|terminated|does not exist/i;

  // 영상 화면 → 정확한 게시 시각·조회수·좋아요·댓글 수·설명·채널
  async function video(id) {
    const html = await getHtml(`https://www.youtube.com/watch?v=${id}`);
    const player = extractJson(html, "ytInitialPlayerResponse");
    const data = extractJson(html, "ytInitialData") || {};
    const ps = player?.playabilityStatus;
    const v = player?.videoDetails;
    if (!v?.title) {
      const reason = `${ps?.reason || ""} ${(ps?.messages || []).join(" ")}`.trim();
      const e = new Error(reason ? `영상을 열 수 없음 (${reason})` : "영상 정보를 읽지 못함");
      e.gone = ps?.status === "ERROR" || GONE.test(reason);
      throw e;
    }
    const mf = player.microformat?.playerMicroformatRenderer || {};
    const when = String(mf.publishDate || mf.uploadDate || mf.liveBroadcastDetails?.startTimestamp || "");
    let published = null;
    let hasTime = false;
    if (/T\d{2}:\d{2}/.test(when)) {
      published = new Date(when);
      hasTime = !isNaN(published);
    } else {
      const m = when.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) published = new Date(+m[1], +m[2] - 1, +m[3]);
    }
    const handle = String(mf.ownerProfileUrl || "").match(/youtube\.com\/(@[^/?#]+)/)?.[1] || "";
    return {
      id,
      title: v.title,
      channelName: v.author || mf.ownerChannelName || "",
      channelId: v.channelId || mf.externalChannelId || "",
      channelUrl: handle ? `https://www.youtube.com/${handle}` : v.channelId ? `https://www.youtube.com/channel/${v.channelId}` : "",
      published: published && !isNaN(published) ? published : null,
      hasTime,
      views: v.viewCount != null ? +v.viewCount : null,
      likes: likeCount(data),
      comments: await commentCount(html, data),
      desc: String(v.shortDescription || mf.description?.simpleText || "").slice(0, 3000),
      lengthSec: +v.lengthSeconds || 0,
      isShort: /\/shorts\//.test(html.slice(0, 200000)) && (+v.lengthSeconds || 0) <= 180 ? true : undefined,
      isLive: !!v.isLiveContent,
      category: mf.category || "",
    };
  }

  function likeCount(data) {
    let n = null;
    walk(data, (k, v) => {
      if (n != null) return false;
      if (k === "likeButtonViewModel") {
        const s = JSON.stringify(v);
        const a = s.match(/"accessibilityText":"[^"]*?([\d,]+)\s*명[^"]*좋아요/) || s.match(/"accessibilityText":"[^"]*?좋아요[^"\d]*([\d,]+)/) || s.match(/along with ([\d,]+) other/);
        if (a) n = parseCount(a[1]);
        else {
          const t = s.match(/"title":"([\d.,]+\s*[천만억KMB]?)"/i);
          if (t) n = parseCount(t[1]);
        }
        return false;
      }
    });
    if (n == null) {
      const s = JSON.stringify(data);
      const m = s.match(/"likeCountIfIndifferentNumber":"(\d+)"/) || s.match(/"likeCount":"?(\d+)/);
      if (m) n = +m[1];
    }
    return n;
  }

  // 댓글 수: 영상 화면의 댓글 패널 머리글 · 댓글 입구의 개수 (유튜브 내부 API 는 확장에서 막혀 쓰지 않음)
  async function commentCount(html, data) {
    let n = null;
    let off = false;
    walk(data, (k, v) => {
      if (k === "engagementPanelSectionListRenderer" && /comment/i.test(v?.panelIdentifier || "")) {
        const h = v.header?.engagementPanelTitleHeaderRenderer;
        const c = txt(h?.contextualInfo);
        if (c) n = parseCount(c);
        return false;
      }
      if (k === "commentsEntryPointHeaderRenderer" && n == null) {
        const c = txt(v?.commentCount);
        if (c) n = parseCount(c);
      }
      if (k === "messageRenderer" && /댓글.*(사용 중지|사용하지 않|꺼져)|comments are turned off/i.test(txt(v?.text))) off = true;
    });
    if (n != null) return n;
    if (off) return 0;
    return null;
  }

  function videoId(url) {
    const s = String(url || "").trim();
    if (ID_RE.test(s)) return s;
    return s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([\w-]{11})(?![\w-])/)?.[1] || null;
  }

  global.YT = { getHtml, extractJson, walk, txt, parseCount, parseAgo, listItems, search, channelBase, channelSearch, channelLatest, video, videoId, sleep, jitter };
  if (typeof module !== "undefined") module.exports = global.YT;
})(typeof window !== "undefined" ? window : globalThis);
