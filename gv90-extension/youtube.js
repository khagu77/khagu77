// (이슈 모니터링 보고서 작성 확장 issue-report-extension 에서 가져옴 · 제목 글자만 GV90 용)
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
    // var ytInitialData = {…} 뿐 아니라 window["ytInitialData"] = {…} 모양도 (유튜브가 번갈아 씀)
    if (start !== -1 && /^\s*(?:["']\])?\s*=\s*$/.test(html.slice(idx + marker.length, start))) {
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

// 화면·응답 글자에서 댓글 수 찾기 (유튜브가 칸 이름을 바꿔도 되게 여러 모양)
function ytCountFromText(t) {
  const pats = [
    /"commentsHeaderRenderer":\{"countText":\{"runs":\[\{"text":"([\d.,]+\s*[천만]?)/,
    /"commentsCount":\{"simpleText":"([\d.,]+\s*[천만]?)/,
    /"commentCount":\{"simpleText":"([\d.,]+\s*[천만]?)/,
    /"commentsEntryPointHeaderRenderer":\{.{0,400}?"commentCount":\{"simpleText":"([\d.,]+\s*[천만]?)/,
    /"engagementPanelTitleHeaderRenderer":\{"title":\{"runs":\[\{"text":"댓글"\}\]\},"contextualInfo":\{"runs":\[\{"text":"([\d.,]+\s*[천만]?)/,
    /"text":"댓글\s*([\d.,]+\s*[천만]?)\s*개"/,
    /"commentCount":"(\d+)"/,
  ];
  for (const re of pats) {
    const m = String(t || "").match(re);
    if (m) return m[1];
  }
  return "";
}

// 댓글 정렬 메뉴(인기 댓글 / 최신순)에서 '최신순' 토큰 (이름을 못 알아보면 두 번째 항목)
function newestSortToken(data) {
  let items = null;
  walk(data, (k, v) => {
    if (!items && k === "sortFilterSubMenuRenderer") {
      items = v.subMenuItems || [];
      return false;
    }
  });
  if (!items || !items.length) return null;
  const tok = (it) => it?.serviceEndpoint?.continuationCommand?.token || it?.continuation?.reloadContinuationData?.continuation || null;
  const named = items.find((it) => /최신|newest/i.test(ytText(it.title) || it.title || ""));
  return tok(named || items[1]) || null;
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
  // 쇼츠인지: youtube.com/shorts/ID 가 그대로 열리면 쇼츠, 일반 영상이면 watch 로 넘겨 줌
  async isShort(videoId) {
    try {
      const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, { method: "HEAD", redirect: "manual", credentials: "omit" });
      return r.type !== "opaqueredirect" && r.status === 200;
    } catch {
      return false;
    }
  }

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
      // 쇼츠는 빼고 (피드의 영상 주소가 /shorts/…)
      const href = [...e.getElementsByTagName("link")].map((l) => l.getAttribute("href") || "").join(" ");
      if (/\/shorts\//.test(href)) continue;
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
      // 요즘 영상 화면: 댓글 칸(engagement panel) 머리글의 숫자 (contextualInfo)
      if (k === "engagementPanelSectionListRenderer" && /comment/i.test(v?.panelIdentifier || v?.targetId || "")) {
        const t = ytText(v?.header?.engagementPanelTitleHeaderRenderer?.contextualInfo);
        if (t) ccount = t;
        return false;
      }
    });
    if (ccount === null) ccount = ytCountFromText(html) || null;
    return {
      html,
      player,
      initialData,
      title: player?.videoDetails?.title || "",
      author: player?.videoDetails?.author || "",
      description: (player?.videoDetails?.shortDescription || "").slice(0, 800),
      date: mf.publishDate ? new Date(mf.publishDate).getTime() : null,
      ccount,
      views: player?.videoDetails?.viewCount != null ? +player.videoDetails.viewCount : null, // GV90: 조회수
    };
  }

  // 댓글 수: 요즘 영상 화면(HTML)에는 댓글 수가 없어 댓글 첫 묶음을 한 번 받아 머리글('댓글 1,234개')에서 읽음
  async commentCount(page) {
    const token = page?.initialData && findCommentsToken(page.initialData);
    if (!token) return null; // 댓글이 꺼진 영상
    const apiKey = page.html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
    const clientVersion = page.html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] || "2.20241001.00.00";
    const visitorData = page.html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1];
    const context = { client: { clientName: "WEB", clientVersion, hl: "ko", gl: "KR" } };
    if (visitorData) context.client.visitorData = visitorData;
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/next?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, continuation: token }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    let count = null;
    walk(data, (k, v) => {
      if (count !== null) return false;
      if (k === "commentsHeaderRenderer") {
        const t = ytText(v.countText || v.commentsCount);
        if (t) count = t;
        return false;
      }
      if (k === "engagementPanelTitleHeaderRenderer" && v?.contextualInfo) {
        const t = ytText(v.contextualInfo);
        if (t) count = t;
        return false;
      }
    });
    // 칸 이름이 바뀌었을 때: 응답 글자에서 '댓글 수' 모양을 직접 찾음
    if (!count) count = ytCountFromText(JSON.stringify(data));
    // 그래도 없으면 댓글을 끝까지 세어 봄 (댓글이 적은 영상 · 요청 40번까지만)
    if (!count) {
      const r = await this.readComments(null, null, { page, maxRequests: 40 }).catch(() => null);
      if (r?.complete) count = String(r.comments.length);
    }
    return count;
  }

  // opts.page: 이미 받은 영상 화면 · opts.maxRequests: 요청 수 한도 (넘으면 complete=false)
  async readComments(videoId, onProgress, opts = {}) {
    // 영상 화면을 가끔 덜 받아 오는 때가 있어 두 번 더 시도 (실제로 삭제·비공개면 세 번 다 실패)
    let page = opts.page || (await this.videoPage(videoId));
    for (let i = 0; i < 2 && !page.initialData && !opts.page; i++) {
      await sleep(2000 + i * 2000);
      page = await this.videoPage(videoId);
    }
    if (!page.initialData) throw new Error("영상 정보를 읽지 못함 (세 번 시도 · 삭제/비공개 영상이거나 유튜브가 잠시 막음 → '수집 전·0개·실패 글만 선택'으로 다시 수집)");
    const first = findCommentsToken(page.initialData);
    if (!first) return { page, comments: [], complete: true }; // 댓글이 꺼진 영상
    const apiKey = page.html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
    const clientVersion = page.html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] || "2.20241001.00.00";
    const visitorData = page.html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1];
    const context = { client: { clientName: "WEB", clientVersion, hl: "ko", gl: "KR" } };
    if (visitorData) context.client.visitorData = visitorData;
    const endpoint = `https://www.youtube.com/youtubei/v1/next?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`;
    const maxReq = opts.maxRequests || 3000;
    // 한 쪽(continuation) 요청: 네트워크·HTTP 오류면 2초·5초 쉬고 다시 (최대 3번)
    const fetchPage = async (token) => {
      let last = null;
      for (const wait of [0, 2000, 5000]) {
        if (wait) await sleep(wait);
        if (this.isStopped()) throw new StopError("중지됨");
        try {
          const resp = await fetch(endpoint, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, continuation: token }) });
          if (resp.ok) return await resp.json();
          last = `HTTP ${resp.status}`;
        } catch (e) {
          last = e.message || String(e);
        }
      }
      throw new Error(last || "응답 없음");
    };
    let expected = null; // 유튜브가 알려 주는 영상 댓글 수 ('댓글 1,554개')
    // 처음부터 끝까지 한 번 모으기 · 인기순은 유튜브가 일부 댓글을 빼고 보여 줘서 첫 응답에서 '최신순'으로 바꿔 처음부터
    const collectAll = async () => {
      const queue = [first];
      const used = new Set(queue);
      const byId = new Map();
      let sortSwitched = false;
      let n = 0;
      for (; queue.length && n < maxReq; n++) {
        if (this.isStopped()) throw new StopError("중지됨");
        const token = queue.shift();
        let data;
        try {
          data = await fetchPage(token);
        } catch (e) {
          if (e instanceof StopError) throw e;
          if (opts.maxRequests) return { byId, complete: false }; // 댓글 수 세기용: 실패면 '모름'
          throw new Error(byId.size ? `댓글 일부만 읽고 끊김 (${byId.size}개까지 읽은 뒤 유튜브 응답 실패: ${e.message}) — 잠시 뒤 다시 수집` : `유튜브 댓글 요청 실패 (${e.message}) — 잠시 뒤 다시 수집`);
        }
        if (expected == null) {
          let t = "";
          walk(data, (k, v) => {
            if (!t && k === "commentsHeaderRenderer") t = ytText(v.countText || v.commentsCount);
            if (t) return false;
          });
          if (!/\d/.test(t)) t = ytCountFromText(JSON.stringify(data));
          if (/\d/.test(t)) expected = typeof parseCount === "function" ? parseCount(t) : +String(t).replace(/[^\d]/g, "");
        }
        if (!sortSwitched) {
          sortSwitched = true;
          const newest = newestSortToken(data);
          if (newest && !used.has(newest)) {
            used.add(newest);
            queue.length = 0;
            queue.push(newest);
            continue; // 인기순 첫 쪽 댓글은 버리고 최신순으로 처음부터
          }
        }
        const { comments, tokens } = parseYoutubeComments(data);
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
      return { byId, complete: !queue.length };
    };
    let { byId, complete } = await collectAll();
    // 다 돌았는데 0건: 유튜브가 가끔 댓글 없이 빈 응답을 줌 → 5초 쉬고 처음부터 한 번 더
    if (!byId.size && !opts.maxRequests) {
      await sleep(5000);
      ({ byId, complete } = await collectAll());
      // 유튜브가 '댓글 0개'라고 알려 주는 영상만 0건 정상
      if (!byId.size && expected !== 0)
        throw new Error(`댓글을 하나도 읽지 못함 (유튜브가 빈 응답 · 영상 댓글 ${expected != null ? `${expected.toLocaleString()}개` : "수 모름"}) — 잠시 뒤 다시 수집`);
    }
    const now = new Date();
    const comments = [...byId.values()]
      .filter((c) => c.text)
      .map((c) => {
        const d = parseKoreanDate(c.writtenAt, now);
        return { text: c.text, writtenAt: c.writtenAt, date: d ? d.date.getTime() : null, isReply: c.id.includes("."), author: c.author };
      });
    return { page, comments, complete, expected };
  }
}
