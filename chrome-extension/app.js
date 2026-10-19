// 팰리세이드(LX3) 전동 시트 관련 카페·유튜브 게시물 및 댓글 수집기 - 댓글 수집 화면
// 네이버 카페: 사람이 글을 보는 것과 같이 게시글을 탭으로 열어 화면에 보이는 댓글을 읽는다.
//   (네이버 API 를 직접 반복 호출하면 계정 보호조치가 걸릴 수 있어 사용하지 않는다)
// 유튜브: 로그인 없이 유튜브 웹페이지가 쓰는 내부 API 로 댓글을 가져온다.

const CAFE_WARN_COUNT = 30; // 한 번에 이보다 많은 카페 글을 넣으면 확인을 받는다
const MAX_PAGES = 1000;

class CollectError extends Error {}

// ---------------------------------------------------------------------------
// 네이버 카페 수집 (게시글 화면을 열어서 읽기)
// ---------------------------------------------------------------------------

// 각 프레임 안에서 실행: 화면의 댓글을 읽고, 댓글 페이지 버튼을 사람처럼 천천히 눌러 가며 모두 모은다.
// (확장 바깥 함수는 쓸 수 없으므로 필요한 값은 인자로 받는다)
async function scrapeCommentsInFrame(pageDelay) {
  if (!document.querySelector("li.CommentItem, .CommentBox")) return { found: false, href: location.href };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const randomWait = () => wait(pageDelay[0] + Math.floor(Math.random() * (pageDelay[1] - pageDelay[0])));
  const titleEl = document.querySelector(".title_text");
  const authorEl = document.querySelector(".WriterInfo .nickname, .profile_info .nickname");
  const all = [];
  const seen = new Set();
  const visited = new Set();
  for (let guard = 0; guard < 500; guard++) {
    let lastParent = "";
    for (const li of document.querySelectorAll("li.CommentItem")) {
      const q = (sel) => li.querySelector(sel)?.innerText.trim() || "";
      const isReply = li.classList.contains("CommentItem--reply");
      if (!isReply) lastParent = li.id || "";
      const row = {
        id: li.id || "",
        isReply,
        parentId: isReply ? lastParent : "",
        nickname: q(".comment_nickname"),
        content: q(".text_comment"),
        date: q(".comment_info_date"),
        deleted: !!li.querySelector(".comment_deleted, .comment_delete"),
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
    await randomWait();
  }
  return {
    found: true,
    href: location.href,
    title: titleEl ? titleEl.innerText.trim() : "",
    author: authorEl ? authorEl.innerText.trim() : "",
    rows: all,
  };
}

// 각 프레임 안에서 실행: 페이지가 알려주는 대표 주소(https://cafe.naver.com/카페주소/글번호)
function pageCanonicalUrls() {
  const urls = [];
  for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]']) {
    const el = document.querySelector(sel);
    const v = el && (el.getAttribute("content") || el.getAttribute("href"));
    if (v) urls.push(v);
  }
  return urls;
}

async function collectCafe(result) {
  const found = await withTab(result.url, async (tabId) => {
    let hrefs = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: scrapeCommentsInFrame,
        args: [CAFE_PAGE_DELAY],
      });
      const answers = results.map((r) => r.result).filter(Boolean);
      const hit = answers.find((r) => r.found);
      if (hit) {
        const canon = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: pageCanonicalUrls });
        hit.canonical = canon.flatMap((r) => r.result || []);
        hit.hints = await runInFrames(tabId, cafeSlugHintsInFrame);
        return hit;
      }
      hrefs = answers.map((r) => r.href);
      if (hrefs.some((h) => h.includes("nid.naver.com"))) break; // 로그인 화면으로 넘어감
      await sleep(1500);
    }
    return { found: false, hrefs };
  });
  if (!found.found) {
    if ((found.hrefs || []).some((h) => h.includes("nid.naver.com"))) {
      throw new CollectError("네이버 로그인이 필요합니다");
    }
    throw new CollectError("댓글 영역을 찾지 못함 (카페 가입이 필요하거나, 삭제됐거나, 댓글을 막은 글일 수 있음)");
  }
  // 짧은 주소(naver.me 등)로 넣은 글도 열린 화면 주소에서 카페 번호·글 번호를 알아낸다
  for (const u of [found.href, ...(found.hints || []).map((h) => h.href)]) {
    const ids = parseArticleUrl(u);
    if (!result.articleId && ids.articleId) result.articleId = ids.articleId;
    if (!result.cafeId && ids.cafeId && (!ids.articleId || ids.articleId === result.articleId)) result.cafeId = ids.cafeId;
    if (!result.cafeUrl && ids.cafeUrl && (!ids.articleId || ids.articleId === result.articleId)) result.cafeUrl = ids.cafeUrl;
  }
  // 엑셀 url 칸을 https://cafe.naver.com/카페주소/글번호 로 쓰기 위해 카페주소(영문)를 알아낸다.
  for (const u of found.canonical || []) {
    const ids = parseArticleUrl(u);
    if (ids.cafeUrl && (!result.articleId || ids.articleId === result.articleId)) {
      result.cafeUrl = result.cafeUrl || ids.cafeUrl;
      result.articleId = result.articleId || ids.articleId;
      break;
    }
  }
  const slugs = await loadCafeSlugs();
  if (!result.cafeUrl && result.cafeId && slugs[result.cafeId]) result.cafeUrl = slugs[result.cafeId];
  if (!result.cafeUrl) result.cafeUrl = pickSlug(found.hints || []);
  if (result.cafeId && result.cafeUrl) await saveCafeSlug(result.cafeId, result.cafeUrl);
  result.title = found.title;
  result.author = found.author;
  result.comments = found.rows.map((r) => ({
    commentId: r.id,
    isReply: r.isReply,
    parentId: r.parentId,
    nickname: r.nickname,
    content: r.content,
    writtenAt: r.date,
    isDeleted: r.deleted,
  }));
  result.method = "화면";
}

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
// 엑셀 (raw data 양식: 언론 / 동호회 / 유튜브 / 자동차 커뮤니티 시트, 열: 연번·채널·작성일·댓글·url)
// ---------------------------------------------------------------------------

const SHEET_CAFE = "동호회";
const SHEET_YT = "유튜브";
const BLANK_SHEETS = ["언론", "동호회", "유튜브", "자동차 커뮤니티"];
const HEADERS = ["연번", "채널", "작성일", "댓글", "url"];
const DEFAULT_FILE_NAME = "raw_data.xlsx";

const compact = (s) => String(s ?? "").replace(/\s+/g, "");

// 같은 댓글인지 판단하는 키: 게시글번호 + 작성일 + 내용(공백 무시)
function cafeKey(url, date, content) {
  const { articleId } = parseArticleUrl(String(url || ""));
  return `${articleId || compact(url)}|${compact(date)}|${compact(content)}`;
}

function rowHasData(row) {
  return ["A", "B", "C", "D", "E"].some((c) => row.cells[c] !== undefined && row.cells[c] !== "");
}

// 올린 엑셀에서 이어쓰기에 필요한 정보를 읽는다.
async function analyzeTemplate(wb) {
  const names = wb.sheetNames();
  for (const need of [SHEET_CAFE, SHEET_YT]) {
    if (!names.includes(need)) throw new Error(`'${need}' 시트가 없습니다. (시트 목록: ${names.join(", ")})`);
  }
  const cafeRows = (await wb.readRows(SHEET_CAFE)).filter((r) => r.r > 1 && rowHasData(r));
  const cafeLastRow = cafeRows.reduce((m, r) => Math.max(m, r.r), 1);
  let cafeLastSerial = 0;
  const cafeKeys = new Set();
  for (const r of cafeRows) {
    const n = parseInt(r.cells.A, 10);
    if (!isNaN(n)) cafeLastSerial = Math.max(cafeLastSerial, n);
    cafeKeys.add(cafeKey(r.cells.E, r.cells.C, r.cells.D));
  }

  const ytRows = (await wb.readRows(SHEET_YT)).filter((r) => r.r > 1 && rowHasData(r));
  const ytVideos = new Map(); // 영상ID → 기존 행들 [[채널, 작성일, 댓글, url]]
  for (const r of ytRows) {
    const id = parseYoutubeId(String(r.cells.E || ""));
    if (!id) continue;
    if (!ytVideos.has(id)) ytVideos.set(id, []);
    ytVideos.get(id).push([r.cells.B ?? "유튜브", r.cells.C ?? "", r.cells.D ?? "", r.cells.E ?? ""]);
  }
  return { cafeLastRow, cafeLastSerial, cafeKeys, cafeCount: cafeRows.length, ytVideos, ytCount: ytRows.length };
}

function youtubeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

// 수집 결과 → 동호회/유튜브 시트에 들어갈 행
function buildRows(results, info) {
  const keys = new Set(info ? info.cafeKeys : []);
  let serial = info ? info.cafeLastSerial : 0;
  const cafe = [];
  let duplicates = 0;
  for (const r of results.filter((x) => x.platform === "cafe" && !x.error)) {
    for (const c of r.comments) {
      if (c.isDeleted || !c.content) continue;
      const key = cafeKey(r.sheetUrl, c.writtenAt, c.content);
      if (keys.has(key)) {
        duplicates++;
        continue;
      }
      keys.add(key);
      cafe.push([++serial, "동호회", c.writtenAt, c.content, r.sheetUrl]);
    }
  }

  // 유튜브: 오늘 입력한 영상들의 댓글로 시트 전체를 교체한다(입력 순서대로).
  // 수집에 실패한 영상이 파일에 있던 영상이면 그 영상의 기존 행만 남긴다.
  const ytResults = results.filter((x) => x.platform === "youtube");
  const yt = [];
  const keptOld = [];
  for (const r of ytResults) {
    if (!r.error) {
      for (const c of r.comments) yt.push(["유튜브", c.writtenAt, c.content, youtubeWatchUrl(r.articleId)]);
    } else if (info?.ytVideos.has(r.articleId)) {
      keptOld.push(r.articleId);
      yt.push(...info.ytVideos.get(r.articleId));
    }
  }
  return {
    cafe,
    duplicates,
    yt: yt.map((row, i) => [i + 1, ...row]),
    ytTouched: ytResults.length > 0,
    keptOld,
  };
}

// 파일명 맨 앞 날짜(YYYYMMDD)를 오늘 날짜로 바꾼다.
function outputFileName(baseName) {
  return datedFileName(baseName || DEFAULT_FILE_NAME);
}

async function buildOutput(results, tpl) {
  if (tpl) {
    const wb = await XlsxTemplate.Workbook.open(tpl.bytes);
    const info = await analyzeTemplate(wb);
    const rows = buildRows(results, info);
    if (rows.cafe.length) {
      await wb.replaceRowsAfter(SHEET_CAFE, info.cafeLastRow, rows.cafe, info.cafeLastRow, { focusFirstNew: true });
    }
    if (rows.ytTouched) await wb.replaceRowsAfter(SHEET_YT, 1, rows.yt, 2);
    return { bytes: await wb.save(), rows, info };
  }
  const rows = buildRows(results, null);
  const widths = { 1: 7, 2: 10, 3: 17, 4: 100, 5: 45 };
  const bytes = XlsxWriter.build(
    BLANK_SHEETS.map((name) => ({
      name,
      rows: [HEADERS, ...(name === SHEET_CAFE ? rows.cafe : name === SHEET_YT ? rows.yt : [])],
      widths,
    }))
  );
  return { bytes, rows, info: null };
}

function downloadWorkbook(bytes, name) {
  return downloadBytes(bytes, name);
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

let stopRequested = false;
let lastWorkbook = null; // { bytes, name }
let template = null; // 직접 고른 파일 { name, bytes, info }
let dbBase = null; // 최종 DB 의 가장 최근 댓글 raw data { name, bytes, info, date }

// 이어 쓸 파일: 직접 고른 파일 > 최종 DB 파일 ('별도 파일로 작성'이면 없음 → 새 파일)
function separateFile() {
  return !!$("#separate")?.checked;
}

function baseTemplate() {
  return separateFile() ? null : template || dbBase;
}

async function loadDbBase() {
  dbBase = null;
  try {
    const rec = await dbLatest("raw");
    if (rec) dbBase = { name: rec.name, bytes: rec.bytes, info: await analyzeTemplate(await XlsxTemplate.Workbook.open(rec.bytes)), date: rec.date };
  } catch {
    dbBase = null;
  }
}

function showBaseInfo() {
  const box = $("#templateInfo");
  const base = baseTemplate();
  if (separateFile()) {
    box.className = "hint";
    box.textContent = "'별도 파일로 작성': 그날 수집한 댓글만 담은 새 파일(4개 시트)로 받고, 최종 DB에는 넣지 않습니다.";
  } else if (base) {
    const info = base.info;
    box.className = "hint ok";
    box.textContent =
      `✔ ${base === dbBase ? `최종 DB 파일(${prettyDate(base.date)} · ${base.name})` : base.name} — 동호회 ${info.cafeCount.toLocaleString()}행(마지막 연번 ${info.cafeLastSerial.toLocaleString()}) 다음부터 이어 씁니다. ` +
      `유튜브 시트(현재 ${info.ytCount.toLocaleString()}행)는 오늘 수집한 영상 댓글로 교체됩니다. 저장 파일명: ${outputFileName(base.name)}` +
      (base === dbBase ? " (엑셀에서 고친 파일이 있으면 '최종 DB' 메뉴에서 그 날짜에 수정본을 올리세요)" : "");
  } else {
    box.className = "hint";
    box.textContent = "최종 DB에 파일이 없습니다. 지금까지의 최종 raw data 파일을 고르면 이어 쓰고(최종 DB에도 저장), 고르지 않으면 그날 수집한 댓글만 담은 새 파일로 저장됩니다.";
  }
}

function rememberedName() {
  try {
    return localStorage.getItem("templateName") || "";
  } catch {
    return "";
  }
}

async function loadTemplate(file) {
  const box = $("#templateInfo");
  if (!file) {
    template = null;
    showBaseInfo();
    return;
  }
  box.className = "hint";
  box.textContent = "파일 읽는 중…";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = await XlsxTemplate.Workbook.open(bytes);
    const info = await analyzeTemplate(wb);
    template = { name: file.name, bytes, info };
    try {
      localStorage.setItem("templateName", file.name);
    } catch {
      /* 무시 */
    }
    showBaseInfo();
  } catch (e) {
    template = null;
    box.className = "hint err";
    box.textContent = `파일을 읽지 못했습니다: ${e.message}`;
  }
}

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
  const result = {
    platform, url, sheetUrl: url, cafeId: "", cafeUrl: "", articleId: "",
    title: "", author: "", comments: [], method: "", error: "",
  };
  if (platform === "youtube") {
    result.articleId = parseYoutubeId(url);
    result.sheetUrl = youtubeWatchUrl(result.articleId);
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
    const ids = parseArticleUrl(url);
    result.cafeId = ids.cafeId || "";
    result.articleId = ids.articleId || "";
    result.cafeUrl = ids.cafeUrl || "";
    row.status("게시글 열어서 댓글 읽는 중…");
    await collectCafe(result);
    row.status("완료", "ok");
  } catch (e) {
    result.error = e.message || String(e);
    row.status(`실패: ${result.error}`, "err");
  }
  // 엑셀 url 칸은 기존처럼 https://cafe.naver.com/카페주소/글번호 형식으로
  if (result.cafeUrl && result.articleId) result.sheetUrl = `https://cafe.naver.com/${result.cafeUrl}/${result.articleId}`;
  row.done(result);
  return result;
}

async function start() {
  const urls = readUrls();
  if (!urls.length) {
    $("#summary").textContent = "URL을 입력하세요.";
    return;
  }
  const cafeCount = urls.filter((u) => !isYoutubeUrl(u)).length;
  if (cafeCount > CAFE_WARN_COUNT) {
    const ok = confirm(
      `네이버 카페 글이 ${cafeCount}개입니다. 한 번에 많이 수집하면 네이버 계정 보호조치가 걸릴 수 있습니다.\n` +
        `${CAFE_WARN_COUNT}개 이하로 나눠서, 시간 간격을 두고 수집하는 것을 권장합니다.\n\n그래도 계속할까요?`
    );
    if (!ok) return;
  }
  if (!baseTemplate() && !separateFile()) {
    const go = confirm(
      "기존 raw data 엑셀 파일을 고르지 않았고 최종 DB에도 파일이 없습니다.\n\n" +
        "· [확인]: 파일 없이 진행 (그날 수집한 댓글만 담은 새 파일로 저장)\n" +
        "· [취소]: 기존 파일을 먼저 고르기 (이어 쓰기·중복 제외)",
    );
    if (!go) {
      $("#templateFile").scrollIntoView({ block: "center" });
      $("#templateFile").click();
      return;
    }
  }
  if (cafeCount) await checkLogin();
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
    const result = await collectOne(urls[i], row);
    results.push(result);
    const nextIsCafe = i + 1 < urls.length && !isYoutubeUrl(urls[i + 1]);
    if (nextIsCafe) {
      $("#summary").textContent = `다음 글을 열기 전에 잠시 기다리는 중… (${i + 1}/${urls.length} 완료)`;
      await sleep(randomBetween(CAFE_ARTICLE_DELAY));
    } else {
      await sleep(300);
    }
  }

  const failed = results.filter((r) => r.error).length;
  try {
    $("#summary").textContent = "엑셀 만드는 중…";
    const base = baseTemplate();
    const out = await buildOutput(results, base);
    const name = outputFileName(base ? base.name : rememberedName());
    lastWorkbook = { bytes: out.bytes, name };
    await downloadWorkbook(out.bytes, name);
    let dbNote = "";
    if (!separateFile()) {
      // 오늘의 최종 파일로 최종 DB 에 저장하고, 다음 수집은 이 파일에 이어 쓴다
      const last = out.rows.cafe.length ? out.rows.cafe[out.rows.cafe.length - 1][0] : out.info?.cafeLastSerial || 0;
      await dbSaveDay("raw", today(), name, out.bytes, "auto", `동호회 마지막 연번 ${Number(last).toLocaleString()}`);
      template = null;
      $("#templateFile").value = "";
      await loadDbBase();
      showBaseInfo();
      dbNote = " · 최종 DB에 오늘 파일로 저장했습니다";
    }
    const { rows, info } = out;
    const parts = [];
    if (rows.cafe.length) {
      const from = rows.cafe[0][0];
      const to = rows.cafe[rows.cafe.length - 1][0];
      parts.push(`동호회 ${rows.cafe.length.toLocaleString()}개 추가(연번 ${from}~${to})`);
    } else if (results.some((r) => r.platform === "cafe")) {
      parts.push("동호회 추가된 댓글 없음");
    }
    if (rows.duplicates) parts.push(`이미 있던 댓글 ${rows.duplicates.toLocaleString()}개 제외`);
    if (rows.ytTouched || !info) parts.push(`유튜브 ${rows.yt.length.toLocaleString()}개로 교체`);
    if (rows.keptOld.length) parts.push(`수집 실패한 유튜브 영상 ${rows.keptOld.length}개는 기존 댓글 유지`);
    $("#summary").textContent =
      `${stopRequested ? "중지됨 - " : ""}${parts.join(", ")}` +
      `${failed ? ` (실패 ${failed}건)` : ""} · ${name} 파일이 다운로드 폴더에 저장되었습니다${dbNote}.`;
  } catch (e) {
    $("#summary").textContent = `엑셀 저장 실패: ${e.message}`;
  }
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
  // LX3 메뉴에서 넘겨받은 URL 안내
  let handoff = "";
  try {
    handoff = sessionStorage.getItem("handoff") || "";
    sessionStorage.removeItem("handoff");
  } catch {
    /* 무시 */
  }
  if (handoff) {
    $("#handoff").hidden = false;
    $("#handoff").textContent = handoff;
  }
  $("#start").addEventListener("click", start);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    $("#stop").disabled = true;
    $("#summary").textContent = "중지하는 중… (현재 글까지 저장합니다)";
  });
  $("#download").addEventListener("click", () => lastWorkbook && downloadWorkbook(lastWorkbook.bytes, lastWorkbook.name));
  $("#templateFile").addEventListener("change", (e) => loadTemplate(e.target.files[0]));
  loadDbBase().then(() => loadTemplate(null));
  $("#separate").addEventListener("change", showBaseInfo);
  saveOptions().then((o) => ($("#saveWhere").textContent = `저장 위치: ${saveWhereText(o)} (LX3 화면의 설정에서 바꿀 수 있음)`));
  window.addEventListener("focus", checkLogin);
  checkLogin();
});
