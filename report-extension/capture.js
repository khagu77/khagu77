// 네이버 카페 게시물 캡처.
// 로그인된 내 크롬에서 게시글을 작은 창으로 열고(사람이 글을 보는 것과 같음), 크롬 개발자 도구 기능(chrome.debugger)으로
// 제목 영역 · 본문(첨부 이미지는 가린 채) · 댓글 · 본문 첨부 이미지를 각각 잘라 찍는다.
// 네이버 API 를 직접 부르지 않는다.

const CAPTURE_DPR = 2; // 캡처 해상도 배율 (선명하게 찍고 나중에 150ppi 로 줄인다)
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 1000;
const MAX_COMMENTS = 20; // 미리보기에서 고를 수 있도록 찍어 두는 댓글 수
const MAX_IMAGES = 8; // 본문 첨부 이미지 최대 개수

class CaptureError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 게시글 화면 안에서 실행되는 함수 (확장 바깥 변수는 쓸 수 없음)
// mode: "info" → 글 정보 + 요소 표시, "rect" → 요소 위치(문서 좌표), "restore" → 숨김 해제
// ---------------------------------------------------------------------------
async function cafePageProbe(mode, target, maxComments, maxImages) {
  const SEL = {
    header: [".article_header", ".ArticleContentBox .ArticleTitle", ".ArticleTitle", ".tit-box"],
    title: [".title_text", ".ArticleTitle h3", ".tit-box .b"],
    body: [".se-main-container", ".article_viewer .ContentRenderer", ".ContentRenderer", ".article_viewer", "#tbody", "#postContent"],
    commentItem: ["li.CommentItem"],
    commentText: [".text_comment", ".comment_text_view"],
    nickname: [".comment_nickname"],
    author: [".WriterInfo .nickname", ".profile_info .nickname", ".nick_box .nickname"],
  };
  const pick = (root, list) => {
    for (const s of list) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  // 예전 카페 화면은 본문이 cafe_main 틀(iframe) 안에 있다 (같은 도메인이라 바로 읽을 수 있음)
  const frame = document.querySelector("iframe#cafe_main");
  let doc = document;
  try {
    if (frame && frame.contentDocument && frame.contentDocument.body) doc = frame.contentDocument;
  } catch {
    /* 다른 도메인 틀 */
  }
  const win = doc.defaultView;

  function toPage(el) {
    const r = el.getBoundingClientRect();
    let x = r.left + window.scrollX;
    let y = r.top + window.scrollY;
    if (doc !== document) {
      const fr = frame.getBoundingClientRect();
      x += fr.left + frame.clientLeft;
      y += fr.top + frame.clientTop;
    }
    return { x: Math.max(0, x), y: Math.max(0, y), width: r.width, height: r.height };
  }

  if (mode === "restore") {
    for (const d of [document, doc]) d.getElementById("__rpt_style")?.remove();
    doc.querySelectorAll("[data-rpt-hide]").forEach((el) => {
      el.style.visibility = el.dataset.rptHide === "-" ? "" : el.dataset.rptHide;
      delete el.dataset.rptHide;
    });
    return true;
  }

  if (mode === "rect") {
    // 떠 있는 머리줄·버튼(고정 위치)이 캡처를 가리지 않게 숨긴다
    for (const d of [document, doc]) {
      if (d.getElementById("__rpt_style")) continue;
      const st = d.createElement("style");
      st.id = "__rpt_style";
      st.textContent = "[data-rpt-fixed]{visibility:hidden !important}";
      d.head.appendChild(st);
      for (const el of d.querySelectorAll("body *")) {
        const pos = d.defaultView.getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") el.setAttribute("data-rpt-fixed", "");
      }
    }
    const el = doc.querySelector(`[data-rpt="${target}"]`);
    if (!el) return null;
    if (target === "body") {
      // 본문 글자만 찍기 위해 첨부 이미지·영상·스티커를 가린다 (빈 공간은 나중에 줄여 붙임)
      for (const m of el.querySelectorAll("img, video, iframe, canvas, .se-image, .se-sticker, .se-video, .se-oglink, .se-map, .se-file")) {
        if (m.dataset.rptHide == null) m.dataset.rptHide = m.style.visibility || "-";
        m.style.visibility = "hidden";
      }
    } else {
      doc.querySelectorAll("[data-rpt-hide]").forEach((m) => {
        m.style.visibility = m.dataset.rptHide === "-" ? "" : m.dataset.rptHide;
        delete m.dataset.rptHide;
      });
    }
    el.scrollIntoView({ block: "center" });
    await new Promise((r) => setTimeout(r, 400));
    return toPage(el);
  }

  // ---- mode === "info" ----
  if (/nid\.naver\.com/.test(location.href)) return { error: "login" };
  const body = pick(doc, SEL.body);
  if (!body) return { error: "nobody", href: location.href };

  // 늦게 불러오는 그림·댓글이 나오도록 끝까지 천천히 내렸다가 올린다
  const total = Math.max(document.body.scrollHeight, doc.body.scrollHeight);
  for (let y = 0; y < total; y += 700) {
    window.scrollTo(0, y);
    if (doc !== document) win.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 800));
  window.scrollTo(0, 0);
  if (doc !== document) win.scrollTo(0, 0);

  const header = pick(doc, SEL.header);
  const titleEl = pick(doc, SEL.title);
  const authorEl = pick(doc, SEL.author);
  body.setAttribute("data-rpt", "body");
  if (header) header.setAttribute("data-rpt", "header");

  const headText = (header ? header.innerText : "") + " " + (doc.querySelector(".article_info")?.innerText || "");
  const views = (headText.match(/조회\s*([\d,]+)/) || [])[1] || "";
  let commentCount = "";
  for (const el of doc.querySelectorAll(".ArticleTool, .CommentBox .comment_option, .CommentBox .comment_title, .button_comment")) {
    const m = el.innerText.match(/댓글\s*([\d,]+)/);
    if (m) {
      commentCount = m[1];
      break;
    }
  }

  const comments = [];
  let ci = 0;
  for (const li of doc.querySelectorAll(SEL.commentItem.join(","))) {
    if (li.querySelector(".comment_deleted, .comment_delete")) continue;
    const text = pick(li, SEL.commentText)?.innerText.trim() || "";
    if (!text) continue;
    if (comments.length >= maxComments) break;
    li.setAttribute("data-rpt", `comment${ci}`);
    comments.push({
      index: ci,
      nickname: pick(li, SEL.nickname)?.innerText.trim() || "",
      text,
      isReply: li.classList.contains("CommentItem--reply"),
    });
    ci++;
  }
  if (!commentCount) commentCount = String(doc.querySelectorAll(SEL.commentItem.join(",")).length);

  const images = [];
  for (const img of body.querySelectorAll("img")) {
    if (images.length >= maxImages) break;
    if (img.closest(".se-sticker, .se-oglink, .se-video, .se-map")) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 80 || r.height < 60 || img.naturalWidth < 80) continue;
    img.setAttribute("data-rpt", `image${images.length}`);
    images.push({ index: images.length, width: r.width, height: r.height });
  }

  return {
    href: location.href,
    title: titleEl ? titleEl.innerText.trim() : "",
    author: authorEl ? authorEl.innerText.trim() : "",
    views,
    commentCount,
    bodyText: body.innerText.replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000),
    comments,
    images,
  };
}

// ---------------------------------------------------------------------------
// 창 열기 / 디버거 / 캡처
// ---------------------------------------------------------------------------

function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function openWindow(url) {
  const win = await chrome.windows.create({
    url,
    focused: false,
    type: "normal",
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
  });
  const tab = win.tabs[0];
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
  return { windowId: win.id, tabId: tab.id };
}

async function probe(tabId, mode, target) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: cafePageProbe,
    args: [mode, target || null, MAX_COMMENTS, MAX_IMAGES],
  });
  return res ? res.result : null;
}

async function shot(tabId, rect) {
  if (!rect || rect.width < 4 || rect.height < 4) return null;
  const res = await cdp(tabId, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 },
  });
  const bin = atob(res.data);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: "image/png" });
}

// → { info, header, body, comments: [Blob|null], images: [Blob|null], dpr }
async function captureCafePost(url, onStep = () => {}) {
  onStep("게시글 여는 중");
  const { windowId, tabId } = await openWindow(url);
  let attached = false;
  try {
    await sleep(2500); // 카페 화면(틀·스크립트)이 그려질 시간
    let info = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      info = await probe(tabId, "info").catch(() => null);
      if (info && !info.error) break;
      if (info && info.error === "login") break;
      await sleep(1500);
    }
    if (!info) throw new CaptureError("게시글 화면을 읽지 못했습니다");
    if (info.error === "login") throw new CaptureError("네이버 로그인이 필요합니다");
    if (info.error) throw new CaptureError("본문을 찾지 못함 (카페 가입이 필요하거나 삭제된 글일 수 있음)");

    onStep("캡처 중");
    await chrome.debugger.attach({ tabId }, "1.3");
    attached = true;
    await cdp(tabId, "Emulation.setDeviceMetricsOverride", {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      deviceScaleFactor: CAPTURE_DPR,
      mobile: false,
    });
    await sleep(600);

    const take = async (target) => shot(tabId, await probe(tabId, "rect", target));
    const out = { info, dpr: CAPTURE_DPR, comments: [], images: [] };
    out.header = await take("header");
    for (const im of info.images) out.images.push(await take(`image${im.index}`));
    for (const c of info.comments) out.comments.push(await take(`comment${c.index}`));
    out.body = await take("body"); // 마지막: 본문 이미지를 가린 상태로 찍음
    await probe(tabId, "restore");
    return out;
  } finally {
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
    await chrome.windows.remove(windowId).catch(() => {});
  }
}
