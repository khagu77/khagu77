// 유튜브: 등록한 채널(채널 ID)에서 기간 안에 올라온 영상을 찾고, 고른 영상의 댓글을 모은다.
// 로그인 없이 유튜브 웹페이지가 쓰는 공개 정보(채널 RSS·영상 화면·댓글 API)만 읽는다.

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseYoutubeId(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com") {
    id = u.searchParams.get("v");
    if (!id) {
      const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID_RE.test(id) ? id : null;
}

// html 안에서 `marker = {...}` JSON 객체를 괄호 짝을 맞춰 잘라낸다
function extractJsonAfter(html, marker) {
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

function walk(node, fn, parentKey = "") {
  if (Array.isArray(node)) for (const v of node) walk(v, fn, parentKey);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (fn(k, v, parentKey) === false) continue;
      walk(v, fn, k);
    }
  }
}

function ytText(t) {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join("");
  if (t.content) return t.content;
  return "";
}

function findCommentsToken(initialData) {
  let token = null;
  walk(initialData, (k, v) => {
    if (token) return false;
    if (k === "itemSectionRenderer" && v?.sectionIdentifier === "comment-item-section") {
      walk(v, (k2, v2) => {
        if (!token && k2 === "continuationCommand" && v2?.token) token = v2.token;
      });
      return false;
    }
  });
  if (!token) {
    walk(initialData, (k, v) => {
      if (token) return false;
      if (k === "engagementPanelSectionListRenderer" && /comment/i.test(v?.panelIdentifier || "")) {
        walk(v, (k2, v2) => {
          if (!token && k2 === "continuationCommand" && v2?.token) token = v2.token;
        });
        return false;
      }
    });
  }
  return token;
}

function parseYoutubeComments(data) {
  const comments = [];
  const tokens = [];
  walk(data, (k, v) => {
    if (k === "commentsHeaderRenderer" || k === "sortFilterSubMenuRenderer") return false;
    if (k === "commentEntityPayload" && v?.properties?.commentId) {
      const p = v.properties;
      comments.push({ id: p.commentId, author: v.author?.displayName || "", text: ytText(p.content), writtenAt: p.publishedTime || "" });
      return false;
    }
    if (k === "commentRenderer" && v?.commentId) {
      comments.push({ id: v.commentId, author: ytText(v.authorText), text: ytText(v.contentText), writtenAt: ytText(v.publishedTimeText) });
      return false;
    }
    if (k === "continuationCommand" && v?.token) tokens.push(v.token);
  });
  return { comments, tokens };
}

class YoutubeCollector {
  constructor({ log, isStopped }) {
    this.log = log;
    this.isStopped = isStopped;
  }

  // 채널 입력(UC… ID, @핸들, 채널 주소) → { id, name }
  static async resolveChannel(input) {
    const s = String(input || "").trim();
    let m = s.match(/(UC[A-Za-z0-9_-]{22})/);
    let url;
    if (m) url = `https://www.youtube.com/channel/${m[1]}`;
    else if ((m = s.match(/@([\w.\-가-힣]+)/))) url = `https://www.youtube.com/@${encodeURIComponent(m[1])}`;
    else if (/^https?:\/\//.test(s)) url = s;
    else throw new Error("채널 ID(UC로 시작) 또는 @핸들을 넣어 주세요");
    const html = await fetchText(`${url}${url.includes("?") ? "&" : "?"}hl=ko`);
    const id = (html.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || html.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/) || [])[1];
    if (!id) throw new Error("채널을 찾지 못했습니다");
    const name = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || id;
    return { id, name: new DOMParser().parseFromString(name, "text/html").body.textContent };
  }

  // 채널 RSS: 최근 영상 15개 (제목·설명·게시 시각)
  async listChannel(channel, range) {
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`);
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const out = [];
    const entries = [...doc.getElementsByTagName("entry")];
    for (const e of entries) {
      const get = (tag) => e.getElementsByTagName(tag)[0]?.textContent || "";
      const id = get("yt:videoId");
      const date = new Date(get("published"));
      if (!id || isNaN(date)) continue;
      if (date < range.from || date >= range.to) continue;
      out.push({
        key: `yt:${id}`,
        channel: "youtube",
        source: get("name") || channel.name,
        videoId: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: get("title"),
        date: date.getTime(),
        exact: true,
        snippet: (get("media:description") || "").slice(0, 800),
        ccount: null,
      });
    }
    const oldest = entries.length ? new Date(entries[entries.length - 1].getElementsByTagName("published")[0]?.textContent) : null;
    const maybeMore = entries.length >= 15 && oldest && oldest >= range.from;
    return { posts: out, maybeMore };
  }

  // 영상 화면: 제목·채널·게시일·설명·댓글 수·댓글 토큰
  async videoPage(videoId) {
    const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=ko&gl=KR`);
    const player = extractJsonAfter(html, "ytInitialPlayerResponse");
    const initialData = extractJsonAfter(html, "ytInitialData");
    const mf = player?.microformat?.playerMicroformatRenderer || {};
    let ccount = null;
    walk(initialData, (k, v) => {
      if (ccount !== null) return false;
      if (k === "commentsEntryPointHeaderRenderer" || k === "commentsHeaderRenderer") {
        const t = ytText(v.commentCount || v.countText);
        if (t) ccount = t;
      }
    });
    return {
      html,
      player,
      initialData,
      title: player?.videoDetails?.title || "",
      author: player?.videoDetails?.author || "",
      description: (player?.videoDetails?.shortDescription || "").slice(0, 800),
      date: mf.publishDate ? new Date(mf.publishDate).getTime() : null,
      ccount,
    };
  }

  async readComments(videoId, onProgress) {
    const page = await this.videoPage(videoId);
    if (!page.initialData) throw new Error("영상 정보를 읽지 못함 (삭제/비공개 영상일 수 있음)");
    const first = findCommentsToken(page.initialData);
    if (!first) return { page, comments: [] }; // 댓글이 꺼진 영상
    const apiKey = page.html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
    const clientVersion = page.html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] || "2.20241001.00.00";
    const visitorData = page.html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1];
    const context = { client: { clientName: "WEB", clientVersion, hl: "ko", gl: "KR" } };
    if (visitorData) context.client.visitorData = visitorData;
    const endpoint = `https://www.youtube.com/youtubei/v1/next?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`;
    const queue = [first];
    const used = new Set(queue);
    const byId = new Map();
    for (let n = 0; queue.length && n < 3000; n++) {
      if (this.isStopped()) throw new StopError("중지됨");
      const token = queue.shift();
      let resp;
      try {
        resp = await fetch(endpoint, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, continuation: token }) });
      } catch (e) {
        if (byId.size) break;
        throw e;
      }
      if (!resp.ok) {
        if (byId.size) break;
        throw new Error(`유튜브 댓글 요청 실패(HTTP ${resp.status})`);
      }
      const { comments, tokens } = parseYoutubeComments(await resp.json());
      for (const c of comments) if (!byId.has(c.id)) byId.set(c.id, c);
      for (const t of tokens) {
        if (!used.has(t)) {
          used.add(t);
          queue.push(t);
        }
      }
      onProgress?.(byId.size);
      await sleep(300);
    }
    const now = new Date();
    const comments = [...byId.values()]
      .filter((c) => c.text)
      .map((c) => {
        const d = parseKoreanDate(c.writtenAt, now);
        return { text: c.text, writtenAt: c.writtenAt, date: d ? d.date.getTime() : null, isReply: c.id.includes("."), author: c.author };
      });
    return { page, comments };
  }
}
