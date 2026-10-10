// 네이버 카페 댓글 수집기 - 수집 화면
// 크롬에 로그인된 네이버 세션(쿠키)으로 댓글 API를 호출하고,
// API가 안 되면 게시글을 백그라운드 탭으로 열어 화면에서 댓글을 읽는다.

const API_BASE = "https://apis.naver.com/cafe-web/cafe-articleapi/v2.1";
const REQUEST_DELAY = 500; // 요청 사이 대기(ms). 서버 부담을 줄이기 위해 너무 줄이지 마세요.
const MAX_PAGES = 1000;

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CollectError extends Error {}

// ---------------------------------------------------------------------------
// URL 해석
// ---------------------------------------------------------------------------

const CAFES_ARTICLES_RE = /\/cafes\/(\d+)\/articles\/(\d+)/;
const CLUBID_RE = /clubid=(\d+)/i;
const ARTICLEID_RE = /articleid=(\d+)/i;
const SHORT_RE = /^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9_\-]+)\/(\d+)(?:[/?#]|$)/;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// → { cafeId, articleId, cafeUrl } (모르는 값은 null)
function parseArticleUrl(url) {
  url = url.trim();
  let decoded = url;
  for (let i = 0; i < 3; i++) decoded = safeDecode(decoded);

  let m = decoded.match(CAFES_ARTICLES_RE);
  if (m) return { cafeId: m[1], articleId: m[2], cafeUrl: null };

  const club = decoded.match(CLUBID_RE);
  const art = decoded.match(ARTICLEID_RE);
  if (club && art) return { cafeId: club[1], articleId: art[1], cafeUrl: null };

  m = url.match(SHORT_RE);
  if (m) return { cafeId: null, articleId: m[2], cafeUrl: m[1] };

  return { cafeId: club ? club[1] : null, articleId: art ? art[1] : null, cafeUrl: null };
}

async function fetchJson(url) {
  let resp;
  try {
    resp = await fetch(url, { credentials: "include", headers: { Accept: "application/json, text/plain, */*" } });
  } catch (e) {
    throw new CollectError(`네트워크 오류: ${e.message}`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new CollectError(`접근 권한 없음(HTTP ${resp.status}) - 로그인 또는 카페 가입 여부를 확인하세요`);
  }
  if (!resp.ok) throw new CollectError(`HTTP ${resp.status}`);
  try {
    return await resp.json();
  } catch (e) {
    throw new CollectError("JSON 응답이 아님");
  }
}

// 카페 주소(영문 이름)로 카페ID 찾기
async function resolveCafeId(cafeUrl) {
  try {
    const data = await fetchJson(
      `https://apis.naver.com/cafe-web/cafe2/CafeGateInfo.json?cluburl=${encodeURIComponent(cafeUrl)}`
    );
    const id = data?.message?.result?.cafeInfoView?.cafeId ?? data?.result?.cafeInfoView?.cafeId;
    if (id) return String(id);
  } catch {
    /* 다음 방법 시도 */
  }
  try {
    const resp = await fetch(`https://cafe.naver.com/${encodeURIComponent(cafeUrl)}`, { credentials: "include" });
    const html = await resp.text();
    for (const re of [/g_sClubId\s*=\s*["'](\d+)["']/, /"cafeId"\s*:\s*"?(\d+)/, /clubid=(\d+)/i]) {
      const m = html.match(re);
      if (m) return m[1];
    }
  } catch {
    /* 다음 방법 시도 */
  }
  return null;
}

// ---------------------------------------------------------------------------
// 백그라운드 탭 도우미 (API로 안 될 때 실제 화면을 열어서 확인)
// ---------------------------------------------------------------------------

async function withTab(url, fn) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(done, 30000);
      function done() {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
      function listener(id, info) {
        if (id === tab.id && info.status === "complete") done();
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    await sleep(2500); // 카페 화면(iframe/스크립트)이 그려질 시간
    return await fn(tab.id);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// 각 프레임 안에서 실행: 현재 주소와 이 페이지가 호출한 게시글 API 주소를 돌려준다.
function inspectFrame() {
  const names = performance.getEntriesByType("resource").map((e) => e.name);
  return { href: location.href, resources: names.filter((n) => /\/cafes\/\d+\/articles\/\d+/.test(n)) };
}

async function resolveIdsViaTab(url) {
  return withTab(url, async (tabId) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: inspectFrame });
      for (const { result } of results) {
        if (!result) continue;
        for (const candidate of [result.href, ...result.resources]) {
          const ids = parseArticleUrl(candidate);
          if (ids.cafeId && ids.articleId) return ids;
        }
      }
      await sleep(1000);
    }
    return { cafeId: null, articleId: null };
  });
}

// 각 프레임 안에서 실행: 화면의 댓글을 읽고 댓글 페이지를 넘기며 모두 모은다.
async function scrapeCommentsInFrame() {
  if (!document.querySelector("li.CommentItem, .CommentBox")) return null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const titleEl = document.querySelector(".title_text");
  const authorEl = document.querySelector(".WriterInfo .nickname, .profile_info .nickname");
  const all = [];
  const seen = new Set();
  const visited = new Set();
  for (let guard = 0; guard < 500; guard++) {
    await wait(800);
    let lastParent = "";
    for (const li of document.querySelectorAll("li.CommentItem")) {
      const q = (sel) => li.querySelector(sel)?.innerText.trim() || "";
      const isReply = li.classList.contains("CommentItem--reply");
      if (!isReply) lastParent = li.id || "";
      const img = li.querySelector(".comment_image img, .CommentItemImage img, .comment_sticker img, .se-sticker-image");
      const row = {
        id: li.id || "",
        isReply,
        parentId: isReply ? lastParent : "",
        nickname: q(".comment_nickname"),
        content: q(".text_comment"),
        date: q(".comment_info_date"),
        deleted: !!li.querySelector(".comment_deleted, .comment_delete"),
        attachment: img ? img.getAttribute("src") || "" : "",
      };
      const key = row.id || `${row.nickname}|${row.date}|${row.content}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(row);
      }
    }
    const current = document.querySelector(".CommentBox .ArticlePaginate button[aria-pressed='true']");
    if (current) visited.add(current.innerText.trim());
    let next = null;
    for (const btn of document.querySelectorAll(".CommentBox .ArticlePaginate button")) {
      const label = btn.innerText.trim();
      if (/^\d+$/.test(label) && !visited.has(label)) {
        next = btn;
        visited.add(label);
        break;
      }
    }
    if (!next) break;
    next.click();
  }
  return {
    title: titleEl ? titleEl.innerText.trim() : "",
    author: authorEl ? authorEl.innerText.trim() : "",
    rows: all,
  };
}

async function collectViaTab(result) {
  const url =
    result.cafeId && result.articleId
      ? `https://cafe.naver.com/ca-fe/cafes/${result.cafeId}/articles/${result.articleId}`
      : result.url;
  const found = await withTab(url, async (tabId) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: scrapeCommentsInFrame,
      });
      const hit = results.map((r) => r.result).find((r) => r);
      if (hit) return hit;
      await sleep(1000);
    }
    return null;
  });
  if (!found) throw new CollectError("화면에서 댓글 영역을 찾지 못함 (권한이 없거나 댓글이 없는 글일 수 있음)");
  result.title = result.title || found.title;
  result.author = result.author || found.author;
  result.comments = found.rows.map((r) => ({
    commentId: r.id,
    isReply: r.isReply,
    parentId: r.parentId,
    nickname: r.nickname,
    writerId: "",
    content: r.content,
    writtenAt: r.date,
    isDeleted: r.deleted,
    attachment: r.attachment,
  }));
  result.method = "화면";
}

// ---------------------------------------------------------------------------
// API 수집
// ---------------------------------------------------------------------------

function first(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatTimestamp(v) {
  if (v === "" || v === null || v === undefined) return "";
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    let ms = Number(v);
    if (ms < 1e11) ms *= 1000;
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return String(v);
}

function parseCommentItem(item) {
  const writer = item.writer || {};
  const id = String(first(item, "id", "commentId", "commentNo"));
  const ref = String(first(item, "refId", "refCommentId", "parentCommentId"));
  const isReply = !!item.isRef || !!item.isReply || (ref !== "" && ref !== id);
  const attachments = [];
  if (item.image?.url) attachments.push(item.image.url);
  if (item.sticker?.url) attachments.push(item.sticker.url);
  return {
    commentId: id,
    isReply,
    parentId: isReply ? ref : "",
    nickname: String(first(writer, "nick", "nickname") || first(item, "writerNickname", "nickname")),
    writerId: String(first(writer, "id", "memberId") || first(item, "writerId", "memberId")),
    content: String(item.content || ""),
    writtenAt: formatTimestamp(first(item, "updateDate", "writeDate", "createDate")),
    isDeleted: !!(item.isDeleted || item.deleted),
    attachment: attachments.join(" "),
  };
}

function extractCommentItems(payload) {
  const result = payload?.result ?? payload;
  const comments = result?.comments;
  if (comments && Array.isArray(comments.items)) return comments.items;
  if (Array.isArray(comments)) return comments;
  if (Array.isArray(result?.items)) return result.items;
  return null;
}

async function collectViaApi(result, isStopped) {
  const { cafeId, articleId } = result;
  try {
    const art = await fetchJson(`${API_BASE}/cafes/${cafeId}/articles/${articleId}?useCafeId=true&requestFrom=A`);
    const article = art?.result?.article || {};
    result.title = String(article.subject || "");
    result.author = String(article.writer?.nick || "");
  } catch (e) {
    if (String(e.message).includes("권한")) throw e;
  }

  const seen = new Set();
  const comments = [];
  for (let page = 1; page <= MAX_PAGES && !isStopped(); page++) {
    const data = await fetchJson(
      `${API_BASE}/cafes/${cafeId}/articles/${articleId}/comments/pages/${page}?requestFrom=A&orderBy=asc`
    );
    const items = extractCommentItems(data);
    if (items === null) throw new CollectError("댓글 API 응답 형식을 인식하지 못함");
    let added = 0;
    for (const item of items) {
      const c = parseCommentItem(item);
      const key = c.commentId || `${c.nickname}|${c.writtenAt}|${c.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      comments.push(c);
      added++;
    }
    if (items.length === 0 || added === 0) break;
    await sleep(REQUEST_DELAY);
  }
  result.comments = comments;
  result.method = "API";
}

// ---------------------------------------------------------------------------
// 유튜브 수집 (로그인 불필요 - 유튜브 웹페이지가 쓰는 내부 API 사용)
// ---------------------------------------------------------------------------

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseYoutubeId(url) {
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") {
    id = u.pathname.split("/")[1];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    if (!id) {
      const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID_RE.test(id) ? id : null;
}

function isYoutubeUrl(url) {
  return parseYoutubeId(url) !== null;
}

// html 안에서 `marker = {...}` 형태의 JSON 객체를 괄호 짝을 맞춰 잘라낸다.
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
        } else if (ch === "{") {
          depth++;
        } else if (ch === "}") {
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

// 객체 트리를 돌며 fn(key, value, parentKey) 호출. fn 이 false 를 돌려주면 그 아래는 건너뛴다.
function walk(node, fn, parentKey = "") {
  if (Array.isArray(node)) {
    for (const v of node) walk(v, fn, parentKey);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (fn(k, v, parentKey) === false) continue;
      walk(v, fn, k);
    }
  }
}

function findCommentsToken(initialData) {
  let token = null;
  // 1) 영상 아래 댓글 영역
  walk(initialData, (k, v) => {
    if (token) return false;
    if (k === "itemSectionRenderer" && v?.sectionIdentifier === "comment-item-section") {
      walk(v, (k2, v2) => {
        if (!token && k2 === "continuationCommand" && v2?.token) token = v2.token;
      });
      return false;
    }
  });
  // 2) 쇼츠/모바일 등의 댓글 패널
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

function ytText(t) {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join("");
  if (t.content) return t.content;
  return "";
}

function ytComment(id, fields) {
  const isReply = id.includes(".");
  return {
    commentId: id,
    isReply,
    parentId: isReply ? id.split(".")[0] : "",
    nickname: fields.nickname || "",
    channelId: fields.channelId || "",
    content: fields.content || "",
    writtenAt: fields.writtenAt || "",
    likes: fields.likes || "",
    replyCount: fields.replyCount || "",
  };
}

// 응답에서 댓글들과 다음에 요청할 continuation 토큰들을 뽑는다.
function parseYoutubeResponse(data) {
  const comments = [];
  const tokens = [];
  walk(data, (k, v) => {
    // 정렬 메뉴(인기순/최신순)의 토큰은 같은 댓글을 다시 불러오므로 제외
    if (k === "commentsHeaderRenderer" || k === "sortFilterSubMenuRenderer") return false;
    if (k === "commentEntityPayload" && v?.properties?.commentId) {
      const p = v.properties;
      comments.push(
        ytComment(p.commentId, {
          nickname: v.author?.displayName,
          channelId: v.author?.channelId,
          content: ytText(p.content),
          writtenAt: p.publishedTime,
          likes: v.toolbar?.likeCountNotliked || v.toolbar?.likeCountLiked,
          replyCount: v.toolbar?.replyCount,
        })
      );
      return false;
    }
    if (k === "commentRenderer" && v?.commentId) {
      comments.push(
        ytComment(v.commentId, {
          nickname: ytText(v.authorText),
          channelId: v.authorEndpoint?.browseEndpoint?.browseId,
          content: ytText(v.contentText),
          writtenAt: ytText(v.publishedTimeText),
          likes: ytText(v.voteCount),
          replyCount: v.replyCount != null ? String(v.replyCount) : "",
        })
      );
      return false;
    }
    if (k === "continuationCommand" && v?.token) tokens.push(v.token);
  });
  return { comments, tokens };
}

// 답글이 부모 댓글 바로 아래 오도록 정렬
function orderThreads(comments) {
  const tops = [];
  const replies = new Map();
  for (const c of comments) {
    if (c.isReply) {
      if (!replies.has(c.parentId)) replies.set(c.parentId, []);
      replies.get(c.parentId).push(c);
    } else {
      tops.push(c);
    }
  }
  const out = [];
  for (const t of tops) {
    out.push(t, ...(replies.get(t.commentId) || []));
    replies.delete(t.commentId);
  }
  for (const rest of replies.values()) out.push(...rest);
  return out;
}

async function collectYoutube(result, isStopped, onProgress) {
  const videoId = parseYoutubeId(result.url);
  result.articleId = videoId;
  let html;
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko&gl=KR`, { credentials: "omit" });
    if (!resp.ok) throw new CollectError(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (e) {
    throw e instanceof CollectError ? e : new CollectError(`유튜브 접속 실패: ${e.message}`);
  }

  const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] || "2.20241001.00.00";
  const visitorData = html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1];
  const player = extractJsonAfter(html, "ytInitialPlayerResponse");
  const initialData = extractJsonAfter(html, "ytInitialData");
  result.title = player?.videoDetails?.title || "";
  result.author = player?.videoDetails?.author || "";
  if (!initialData) throw new CollectError("영상 정보를 읽지 못함 (삭제/비공개 영상일 수 있음)");

  const firstToken = findCommentsToken(initialData);
  if (!firstToken) throw new CollectError("댓글을 찾지 못함 (댓글이 꺼진 영상이거나 비공개 영상일 수 있음)");

  const context = { client: { clientName: "WEB", clientVersion, hl: "ko", gl: "KR" } };
  if (visitorData) context.client.visitorData = visitorData;
  const endpoint = `https://www.youtube.com/youtubei/v1/next?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`;

  const queue = [firstToken];
  const usedTokens = new Set(queue);
  const byId = new Map();
  let requests = 0;
  while (queue.length && !isStopped() && requests < MAX_PAGES * 5) {
    const token = queue.shift();
    requests++;
    let resp;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, continuation: token }),
      });
    } catch (e) {
      throw new CollectError(`네트워크 오류: ${e.message}`);
    }
    if (!resp.ok) {
      if (byId.size) break; // 이미 모은 것은 살린다
      throw new CollectError(`유튜브 댓글 요청 실패(HTTP ${resp.status})`);
    }
    const { comments, tokens } = parseYoutubeResponse(await resp.json());
    for (const c of comments) if (!byId.has(c.commentId)) byId.set(c.commentId, c);
    for (const t of tokens) {
      if (!usedTokens.has(t)) {
        usedTokens.add(t);
        queue.push(t);
      }
    }
    onProgress?.(byId.size);
    await sleep(300);
  }
  result.comments = orderThreads([...byId.values()]);
  result.method = "유튜브";
}

// ---------------------------------------------------------------------------
// 엑셀
// ---------------------------------------------------------------------------

const COMMENT_HEADERS = [
  "게시글URL", "카페ID", "게시글번호", "게시글제목", "게시글작성자",
  "순번", "구분", "댓글ID", "부모댓글ID", "작성자닉네임", "작성자ID",
  "댓글내용", "작성일시", "삭제여부", "첨부(이미지/스티커)",
];
const YOUTUBE_HEADERS = [
  "영상URL", "영상ID", "영상제목", "채널명",
  "순번", "구분", "댓글ID", "부모댓글ID", "작성자", "작성자채널ID",
  "댓글내용", "작성시점", "좋아요", "답글수",
];
const SUMMARY_HEADERS = ["사이트", "URL", "카페ID", "게시글번호/영상ID", "제목", "작성자/채널", "댓글수", "수집방식", "상태"];

// 숫자로 바꿀 수 있는 값은 숫자로(엑셀에서 정렬/합계가 되도록)
function num(v) {
  return /^\d+$/.test(String(v)) ? Number(v) : v;
}

function buildWorkbook(results) {
  const cafe = results.filter((r) => r.platform === "cafe");
  const yt = results.filter((r) => r.platform === "youtube");
  const sheets = [];

  if (cafe.length) {
    const rows = [COMMENT_HEADERS];
    for (const r of cafe) {
      r.comments.forEach((c, i) =>
        rows.push([
          r.url, r.cafeId, r.articleId, r.title, r.author,
          i + 1, c.isReply ? "답글" : "댓글", c.commentId, c.parentId,
          c.nickname, c.writerId, c.content, c.writtenAt,
          c.isDeleted ? "Y" : "", c.attachment,
        ])
      );
    }
    sheets.push({ name: "카페 댓글", rows, widths: { 1: 45, 4: 30, 10: 16, 12: 60, 13: 20, 15: 30 }, wrapCols: [12] });
  }

  if (yt.length) {
    const rows = [YOUTUBE_HEADERS];
    for (const r of yt) {
      r.comments.forEach((c, i) =>
        rows.push([
          r.url, r.articleId, r.title, r.author,
          i + 1, c.isReply ? "답글" : "댓글", c.commentId, c.parentId,
          c.nickname, c.channelId, c.content, c.writtenAt, num(c.likes), num(c.replyCount),
        ])
      );
    }
    sheets.push({ name: "유튜브 댓글", rows, widths: { 1: 45, 3: 30, 4: 16, 7: 28, 9: 18, 11: 60, 12: 12 }, wrapCols: [11] });
  }

  const summaryRows = [SUMMARY_HEADERS];
  for (const r of results) {
    summaryRows.push([
      r.platform === "youtube" ? "유튜브" : "네이버카페",
      r.url, r.cafeId, r.articleId, r.title, r.author, r.comments.length, r.method, r.error || "성공",
    ]);
  }
  sheets.push({ name: "요약", rows: summaryRows, widths: { 2: 45, 4: 16, 5: 40, 9: 40 } });
  return XlsxWriter.build(sheets);
}

function downloadWorkbook(bytes) {
  const d = new Date();
  const name =
    `네이버카페_댓글_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.xlsx`;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

let stopRequested = false;
let lastWorkbook = null;

async function checkLogin() {
  const box = $("#login");
  let ok = false;
  try {
    const cookie = await chrome.cookies.get({ url: "https://www.naver.com/", name: "NID_AUT" });
    ok = !!cookie;
  } catch {
    ok = false;
  }
  if (ok) {
    box.className = "login ok";
    box.textContent = "✔ 네이버에 로그인되어 있습니다. (유튜브는 로그인 없이 수집됩니다)";
  } else {
    box.className = "login bad";
    box.innerHTML =
      '네이버 카페를 수집하려면 로그인이 필요합니다. <a href="https://nid.naver.com/nidlogin.login" target="_blank">여기서 로그인</a>한 뒤 이 화면으로 돌아오세요. (유튜브만 수집할 때는 필요 없습니다)';
  }
  return ok;
}

function readUrls() {
  const lines = $("#urls")
    .value.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return [...new Set(lines)];
}

function addProgressRow(index, url) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${index}</td><td class="url"></td><td class="status">대기</td><td class="count"></td>`;
  tr.querySelector(".url").textContent = url;
  $("#progress tbody").appendChild(tr);
  return {
    status(text, cls = "") {
      const td = tr.querySelector(".status");
      td.textContent = text;
      td.className = `status ${cls}`;
    },
    done(result) {
      tr.querySelector(".count").textContent = result.error ? "" : String(result.comments.length);
      if (result.title) {
        const t = document.createElement("span");
        t.className = "title";
        t.textContent = result.title;
        tr.querySelector(".url").appendChild(t);
      }
    },
  };
}

async function collectOne(url, row) {
  const platform = isYoutubeUrl(url) ? "youtube" : "cafe";
  const result = { platform, url, cafeId: "", articleId: "", title: "", author: "", comments: [], method: "", error: "" };
  if (platform === "youtube") {
    try {
      row.status("유튜브 댓글 수집 중…");
      await collectYoutube(result, () => stopRequested, (n) => row.status(`유튜브 댓글 수집 중… ${n}개`));
      row.status(`완료 (${result.method})`, "ok");
    } catch (e) {
      result.error = e.message || String(e);
      row.status(`실패: ${result.error}`, "err");
    }
    row.done(result);
    return result;
  }
  try {
    row.status("주소 확인 중…");
    let ids = parseArticleUrl(url);
    if (!ids.cafeId && ids.cafeUrl) {
      const cafeId = await resolveCafeId(ids.cafeUrl);
      if (cafeId) ids = { ...ids, cafeId };
    }
    if (!ids.cafeId || !ids.articleId) ids = await resolveIdsViaTab(url);
    if (!ids.cafeId || !ids.articleId) throw new CollectError("URL에서 카페ID/게시글번호를 찾지 못함");
    result.cafeId = ids.cafeId;
    result.articleId = ids.articleId;

    row.status("댓글 수집 중…");
    try {
      await collectViaApi(result, () => stopRequested);
    } catch (apiErr) {
      if (stopRequested) throw apiErr;
      row.status("화면에서 수집 중…");
      await collectViaTab(result);
    }
    row.status(`완료 (${result.method})`, "ok");
  } catch (e) {
    result.error = e.message || String(e);
    row.status(`실패: ${result.error}`, "err");
  }
  row.done(result);
  return result;
}

async function start() {
  const urls = readUrls();
  if (!urls.length) {
    $("#summary").textContent = "게시글 URL을 입력하세요.";
    return;
  }
  await checkLogin();
  stopRequested = false;
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#download").disabled = true;
  $("#progress").hidden = false;
  $("#progress tbody").innerHTML = "";

  const results = [];
  for (let i = 0; i < urls.length && !stopRequested; i++) {
    $("#summary").textContent = `수집 중… (${i + 1}/${urls.length})`;
    const row = addProgressRow(i + 1, urls[i]);
    results.push(await collectOne(urls[i], row));
    await sleep(REQUEST_DELAY);
  }

  const total = results.reduce((s, r) => s + r.comments.length, 0);
  const failed = results.filter((r) => r.error).length;
  lastWorkbook = buildWorkbook(results);
  downloadWorkbook(lastWorkbook);
  $("#summary").textContent =
    `${stopRequested ? "중지됨 - " : ""}글 ${results.length}개, 댓글 ${total}개 수집` +
    `${failed ? ` (실패 ${failed}건)` : ""} · 엑셀 파일이 다운로드 폴더에 저장되었습니다.`;
  $("#start").disabled = false;
  $("#stop").disabled = true;
  $("#download").disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    $("#urls").value = localStorage.getItem("urls") || "";
  } catch {
    /* 저장된 값 없음 */
  }
  $("#urls").addEventListener("input", () => {
    try {
      localStorage.setItem("urls", $("#urls").value);
    } catch {
      /* 무시 */
    }
  });
  $("#start").addEventListener("click", start);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    $("#summary").textContent = "중지하는 중… (현재 글까지 저장합니다)";
  });
  $("#download").addEventListener("click", () => lastWorkbook && downloadWorkbook(lastWorkbook));
  window.addEventListener("focus", checkLogin);
  checkLogin();
});
