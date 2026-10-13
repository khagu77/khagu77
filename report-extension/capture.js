// 네이버 카페 게시물 캡처.
// 로그인된 내 크롬에서 게시글을 작은 창으로 열고(사람이 글을 보는 것과 같음), 크롬 개발자 도구 기능(chrome.debugger)으로
// 제목 영역 · 본문(첨부 이미지는 가린 채) · 댓글 · 본문 첨부 이미지를 각각 잘라 찍는다.
// 네이버 API 를 직접 부르지 않는다.

const CAPTURE_DPR = 2; // 캡처 해상도 배율 (선명하게 찍고 나중에 150ppi 로 줄인다)
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 1000;
const MAX_COMMENTS = 20; // 미리보기에서 고를 수 있도록 찍어 두는 댓글 수
const MAX_IMAGES = 8; // 본문 첨부 이미지 최대 개수
const LIST_LIMIT = 50; // 작성자 작성글 · 게시판 목록에서 읽는 글 제목 수

class CaptureError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 게시글 화면 안에서 실행되는 함수 (확장 바깥 변수는 쓸 수 없음)
// mode: "info" → 글 정보 + 요소 표시, "rect" → 요소 위치(문서 좌표), "restore" → 숨김 해제
// ---------------------------------------------------------------------------
async function cafePageProbe(mode, target, maxComments, maxImages, knownBoilerplates) {
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

  // 요소와 그 안의 모든 하위 요소를 덮는 범위 (칸 밖으로 튀어나온 하트·… 버튼·프로필 아이콘도 잘리지 않게)
  function unionRect(els) {
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    for (const root of els) {
      for (const e of [root, ...root.querySelectorAll("*")]) {
        if (e.closest("[data-rpt-hide]") || e.closest("[data-rpt-fixed]")) continue;
        const st = win.getComputedStyle(e);
        if (st.visibility === "hidden" || st.display === "none") continue;
        const rc = e.getBoundingClientRect();
        if (rc.width < 1 || rc.height < 1) continue;
        l = Math.min(l, rc.left);
        t = Math.min(t, rc.top);
        r = Math.max(r, rc.right);
        b = Math.max(b, rc.bottom);
      }
    }
    return { left: l, top: t, width: r - l, height: b - t };
  }

  function toPage(el, pad = 2) {
    const own = el.getBoundingClientRect();
    const u = unionRect([el]);
    if (!Number.isFinite(u.left)) return null;
    const M = 40; // 칸 밖으로 튀어나온 아이콘·버튼은 이 정도까지만 포함
    const l = Math.max(u.left, own.left - M);
    const t = Math.max(u.top, own.top - M);
    const rr = Math.min(u.left + u.width, own.right + M);
    const bb = Math.min(u.top + u.height, own.bottom + M);
    const r = { left: Math.min(l, own.left), top: Math.min(t, own.top), width: 0, height: 0 };
    r.width = Math.max(rr, own.right) - r.left;
    r.height = Math.max(bb, own.bottom) - r.top;
    let x = r.left + window.scrollX - pad;
    let y = r.top + window.scrollY - pad;
    if (doc !== document) {
      const fr = frame.getBoundingClientRect();
      x += fr.left + frame.clientLeft;
      y += fr.top + frame.clientTop;
    }
    return { x: Math.max(0, x), y: Math.max(0, y), width: r.width + pad * 2, height: r.height + pad * 2 };
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
    doc.querySelectorAll("[data-rpt-hide]").forEach((m) => {
      m.style.visibility = m.dataset.rptHide === "-" ? "" : m.dataset.rptHide;
      delete m.dataset.rptHide;
    });
    const hide = (m) => {
      if (m.dataset.rptHide == null) m.dataset.rptHide = m.style.visibility || "-";
      m.style.visibility = "hidden";
    };
    if (target === "body") {
      // 본문 글자만 찍기 위해 첨부 이미지·영상·스티커를 가린다 (빈 공간은 나중에 줄여 붙임)
      el.querySelectorAll("img, video, iframe, canvas, .se-image, .se-sticker, .se-video, .se-oglink, .se-map, .se-file").forEach(hide);
      // 카페 게시판 양식으로 자동으로 들어간 맨 위 안내 문구도 가린다 (작성자가 쓴 본문만)
      el.querySelectorAll("[data-rpt-boiler]").forEach(hide);
    } else if (target.startsWith("comment")) {
      // 댓글: 작성자 아이콘·하트·… 버튼은 그대로 두고 이모티콘(스티커)만 가린다 → 빈 자리는 줄여 붙여 작성일시가 글 바로 밑에 붙음
      el.querySelectorAll("[class*='sticker' i]").forEach(hide);
    }
    el.scrollIntoView({ block: "center" });
    // 늦게 불러오는 그림(프로필 아이콘 등)이 다 그려질 때까지 기다린다 (최대 3초)
    for (let t = 0; t < 30; t++) {
      const pending = [...el.querySelectorAll("img")].filter(
        (im) => im.style.visibility !== "hidden" && (!im.complete || im.naturalWidth === 0) && im.getAttribute("src"),
      );
      if (!pending.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    // 본문은 여유 없이(바로 아래 영역이 섞이지 않게), 나머지는 2px 여유
    const rect = toPage(el, target === "body" ? 0 : 2);
    // 아주 긴 본문은 캡처 크기 한계를 넘지 않게 위쪽 일부만 (슬라이드에도 다 들어가지 않음)
    if (rect && target === "body") rect.height = Math.min(rect.height, 6000);
    return rect;
  }

  // ---- mode === "info" ----
  if (/nid\.naver\.com/.test(location.href)) return { error: "login" };
  const body = pick(doc, SEL.body);
  if (!body) {
    const pageText = `${document.body?.innerText || ""} ${doc.body?.innerText || ""}`;
    if (/삭제되었거나|존재하지 않는 게시글|삭제된 게시글|삭제된 게시물/.test(pageText)) return { error: "deleted" };
    return { error: "nobody", href: location.href };
  }

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

  // ---- 카페 공통 안내 문구(게시판 글쓰기 양식) 찾기: 본문 맨 위에 자동으로 들어가는 운영 안내·빈 질문 양식 ----
  // 카페마다 화면 구조가 달라(문단으로 나뉘거나, 한 문단 안에서 줄바꿈으로만 이어지거나) '화면에 보이는 줄' 단위로 본다.
  // 비교용: 글자·숫자만 (띄어쓰기·이모지·문장부호 차이는 무시)
  const norm = (t) => (t || "").replace(/[^\p{L}\p{N}]/gu, "");
  const BLOCK = /^(P|DIV|LI|UL|OL|TABLE|TBODY|TR|TD|H[1-6]|SECTION|BLOCKQUOTE|FIGURE)$/;
  const lines = [];
  let cur = { nodes: [], els: [], text: "" };
  const flush = () => {
    if (cur.nodes.length) lines.push(cur);
    cur = { nodes: [], els: [], text: "" };
  };
  const walk = (n) => {
    if (n.nodeType === 3) {
      if (n.nodeValue.trim()) {
        cur.nodes.push(n);
        cur.text += n.nodeValue;
      }
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n;
    if (el.tagName === "BR") return flush();
    if (el.tagName === "HR" || el.classList.contains("se-horizontalLine")) {
      flush();
      lines.push({ nodes: [], els: [el], text: "", divider: true });
      return;
    }
    // 작은 그림(이모지·아이콘)은 글자 줄의 일부로 본다
    if (el.tagName === "IMG") {
      const r = el.getBoundingClientRect();
      if (r.width < 40 && r.height < 40) {
        cur.els.push(el);
        return;
      }
    }
    if (/^(IMG|VIDEO|IFRAME|CANVAS)$/.test(el.tagName) || el.classList.contains("se-video") || el.classList.contains("se-image")) {
      flush();
      lines.push({ nodes: [], els: [el], text: "", media: true });
      return;
    }
    if (win.getComputedStyle(el).display === "none") return;
    const block = BLOCK.test(el.tagName) || el.classList.contains("se-component");
    if (block) flush();
    for (const c of el.childNodes) walk(c);
    if (block) flush();
  };
  walk(body);
  flush();

  const KW = /카페|게시판|등업|회칙|예의|공지|이용해\s*주세요|작성해\s*주세요|지켜\s*주세요|말머리|탈퇴|활동\s*정지|양식|규칙|운영진|매니저|필독|작성\s*요령|글쓰기|강퇴|친목/g;
  const hits = (t) => ((t || "").match(KW) || []).length;
  const text = (l) => (l.text || "").trim();
  const isDivider = (l) => !!l.divider || /^[\s_\-─━=~—＿]{3,}$/.test(text(l));
  // 빈 질문 양식 줄: "1. 구동방식:", "색상 :" 처럼 항목 이름만 있고 값이 없는 줄
  const isEmptyFormLine = (t) => /^(\d+\s*[.)]\s*)?[^:：]{1,12}[:：]\s*$/.test(t);
  const isBoilerSegment = (seg) => {
    const ls = seg.map(text).filter(Boolean);
    if (!ls.length) return true;
    const formLines = ls.filter(isEmptyFormLine).length;
    if (formLines >= 2 && formLines >= ls.length - 1) return true; // 빈 질문 양식 (+ 안내 한 줄)
    return hits(ls.join(" ")) >= 1 && ls.every((l) => l.length <= 120);
  };
  const LIMIT = Math.min(40, lines.length);
  let cut = -1;
  // ① 전에 찾아 둔(또는 미리 알려 준) 안내 문구와 같은 글로 시작하면
  for (const k0 of knownBoilerplates || []) {
    const k = norm(k0);
    if (k.length < 10) continue;
    let acc = "";
    for (let i = 0; i < LIMIT && cut < 0; i++) {
      if (lines[i].media) break;
      if (isDivider(lines[i])) continue;
      acc += norm(text(lines[i]));
      if (acc.length >= k.length) {
        if (acc.startsWith(k)) cut = i;
        break;
      }
    }
    if (cut >= 0) break;
  }
  // ② 앞부분 구분선들: 맨 앞부터 이어지는 '안내 문구/빈 양식' 구간의 마지막 구분선까지
  if (cut < 0) {
    let segStart = 0;
    let first = true;
    for (let i = 0; i < LIMIT; i++) {
      if (lines[i].media) break;
      if (!isDivider(lines[i])) continue;
      const seg = lines.slice(segStart, i);
      const ok = first ? hits(seg.map(text).join(" ")) >= 2 && isBoilerSegment(seg) : isBoilerSegment(seg);
      if (!ok) break;
      cut = i;
      segStart = i + 1;
      first = false;
    }
  }
  // ③ 구분선이 없어도 맨 앞 짧은 줄들이 운영 안내 말(또는 빈 양식)로만 되어 있으면
  if (cut < 0) {
    let total = 0;
    let last = -1;
    for (let i = 0; i < LIMIT; i++) {
      const t = text(lines[i]);
      if (lines[i].media) break;
      if (!t || isDivider(lines[i])) continue;
      if (isEmptyFormLine(t)) {
        last = i;
        continue;
      }
      if (t.length > 120 || !hits(t)) break;
      total += hits(t);
      last = i;
    }
    if (last >= 1 && total >= 3) cut = last;
  }
  let boilerplateText = "";
  if (cut >= 0 && lines.slice(cut + 1).some((l) => text(l) && !isDivider(l))) {
    // 바로 뒤에 이어지는 구분선·빈 질문 양식(과 그 안내 한 줄)까지
    for (;;) {
      const nx = lines[cut + 1];
      if (!nx || nx.media) break;
      if (isDivider(nx) || !text(nx) || isEmptyFormLine(text(nx))) {
        cut++;
        continue;
      }
      // "질문에 필요할 경우 작성해주세요." 처럼 짧은 안내 줄은 바로 뒤가 구분선·빈 양식일 때만
      const after = lines.slice(cut + 2).find((l) => text(l) || l.divider);
      if (hits(text(nx)) && text(nx).length <= 60 && after && (isDivider(after) || isEmptyFormLine(text(after)))) {
        cut++;
        continue;
      }
      break;
    }
    const boiler = lines.slice(0, cut + 1);
    const hiddenNodes = new Set();
    for (const l of boiler) {
      for (const el of l.els) el.setAttribute("data-rpt-boiler", "");
      for (const tn of l.nodes) {
        // 글자 조각을 감싸서 가린다 (같은 문단 안 작성자 글은 그대로)
        const span = doc.createElement("span");
        span.setAttribute("data-rpt-boiler", "");
        tn.parentNode.insertBefore(span, tn);
        span.appendChild(tn);
        hiddenNodes.add(tn);
      }
    }
    // 안내 문구만 들어 있는 상자는 통째로 가린다 (밑줄·테두리·배경까지)
    for (const el of body.querySelectorAll("p, div, li, blockquote, table")) {
      if (el.hasAttribute("data-rpt-boiler")) continue;
      const tw = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let any = false;
      let onlyBoiler = true;
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        any = true;
        if (!hiddenNodes.has(t)) {
          onlyBoiler = false;
          break;
        }
      }
      if (any && onlyBoiler && !el.querySelector("img, video, iframe")) el.setAttribute("data-rpt-boiler", "");
    }
    boilerplateText = norm(boiler.filter((l) => !isDivider(l)).map(text).join("")).slice(0, 300);
  }
  const bodyText = lines
    .filter((l, i) => !(i <= cut && boilerplateText) && !l.media)
    .map((l) => l.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  // 보고서에 쓰는 댓글: 대댓글·게시글 작성자 댓글·삭제 댓글은 뺀다
  const author = authorEl ? authorEl.innerText.trim() : "";
  const comments = [];
  let ci = 0;
  for (const li of doc.querySelectorAll(SEL.commentItem.join(","))) {
    if (li.querySelector(".comment_deleted, .comment_delete")) continue;
    if (li.classList.contains("CommentItem--reply")) continue;
    const nickname = pick(li, SEL.nickname)?.innerText.trim() || "";
    const byAuthor =
      (author && nickname === author) ||
      [...li.querySelectorAll("span, em, i, strong, a")].some((e) => e.innerText && e.innerText.trim() === "작성자");
    if (byAuthor) continue;
    const text = pick(li, SEL.commentText)?.innerText.trim() || "";
    if (!text) continue;
    if (comments.length >= maxComments) break;
    const hasSticker = !!li.querySelector("[class*='sticker' i]");
    li.setAttribute("data-rpt", `comment${ci}`);
    comments.push({ index: ci, nickname, text, hasSticker });
    ci++;
  }
  if (!commentCount) commentCount = String(doc.querySelectorAll(SEL.commentItem.join(",")).length);

  // 첨부 사진과 영상(플레이어 화면)을 글에 나온 순서대로
  const images = [];
  const VIDEO_SEL = ".se-component.se-video, .se-component.se-oembed, .se-module-video, video";
  const media = [...body.querySelectorAll(`img, ${VIDEO_SEL}`)].filter((el) => {
    if (el.closest("[data-rpt-boiler]")) return false;
    if (el.tagName === "IMG") return !el.closest(`.se-sticker, .se-oglink, .se-map, ${VIDEO_SEL}`);
    return !el.parentElement.closest(VIDEO_SEL); // 영상은 가장 바깥 영상 칸 하나만
  });
  for (const img of media) {
    if (images.length >= maxImages) break;
    const r = img.getBoundingClientRect();
    if (img.tagName !== "IMG") {
      if (r.width < 80 || r.height < 60) continue;
      img.setAttribute("data-rpt", `image${images.length}`);
      images.push({ index: images.length, width: r.width, height: r.height, src: "", video: true });
      continue;
    }
    if (r.width < 80 || r.height < 60 || img.naturalWidth < 80) continue;
    img.setAttribute("data-rpt", `image${images.length}`);
    // 원본 주소: 늦게 불러오기 전 흐린 미리보기(type=w80_blur 등) 대신 큰 이미지로
    let src = img.getAttribute("data-lazy-src") || img.getAttribute("data-src") || img.currentSrc || img.src || "";
    if (/pstatic\.net/.test(src)) src = src.replace(/([?&])type=[^&]*/, "$1type=w966");
    images.push({ index: images.length, width: r.width, height: r.height, src });
  }

  // 게시글 주소를 https://cafe.naver.com/카페주소/글번호 로 통일 (naver.me 단축 주소 등)
  const SHORT = /^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9_\-]+)\/(\d+)(?:[/?#]|$)/;
  let canonicalUrl = "";
  for (const d of [doc, document]) {
    for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]']) {
      const el = d.querySelector(sel);
      const v = el && (el.getAttribute("content") || el.getAttribute("href"));
      const m = v && v.match(SHORT);
      if (m && !canonicalUrl) canonicalUrl = `https://cafe.naver.com/${m[1]}/${m[2]}`;
    }
  }
  if (!canonicalUrl) {
    const m = location.href.match(SHORT);
    if (m && !/^(ca-fe|f-e)$/.test(m[1])) canonicalUrl = `https://cafe.naver.com/${m[1]}/${m[2]}`;
  }
  if (!canonicalUrl) {
    const hrefs = [location.href, ...(doc !== document ? [doc.location.href] : [])].join(" ");
    const articleId = (hrefs.match(/articles\/(\d+)/) || hrefs.match(/articleid=(\d+)/i) || [])[1];
    const RESERVED = new Set(["ca-fe", "f-e", "section", "cafesearch", "mycafeintro", "joincafe", "ca-fe-mobile"]);
    const count = {};
    for (const a of [...document.links, ...(doc !== document ? doc.links : [])]) {
      const m = a.href.match(/^https?:\/\/cafe\.naver\.com\/([A-Za-z][A-Za-z0-9_\-]{2,})\/?(?:[?#].*)?$/);
      if (m && !RESERVED.has(m[1].toLowerCase())) count[m[1]] = (count[m[1]] || 0) + 1;
    }
    const name = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (articleId && name) canonicalUrl = `https://cafe.naver.com/${name}/${articleId}`;
  }

  // 작성자의 '작성글 보기' 와 이 글이 있는 게시판 목록 주소 (지역·중복 판단용)
  const abs = (a) => (a ? new URL(a.getAttribute("href"), doc.baseURI).href : "");
  const articleBox = (header && header.closest(".ArticleContentBox, .article_wrap, .ArticleContent")) || header || doc;
  const authorLink = abs(
    articleBox.querySelector("a[href*='/members/'], a[href*='MemberArticleList'], a[href*='memberid='], a[href*='search.writerId']"),
  );
  const boardLink = abs(
    articleBox.querySelector("a.link_board, a[href*='/menus/'], a[href*='ArticleList.nhn'], a[href*='search.menuid']"),
  );
  const postDate = (headText.match(/(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})/) || []).slice(1, 4).join("-");

  return {
    href: location.href,
    canonicalUrl,
    authorLink,
    boardLink,
    postDate,
    title: titleEl ? titleEl.innerText.trim() : "",
    author,
    views,
    commentCount,
    bodyText: bodyText.slice(0, 6000),
    boilerplateText,
    comments,
    images,
  };
}

// 게시글의 'URL 복사' 버튼을 눌러 복사되는 주소(https://cafe.naver.com/카페주소/글번호)를 가로챈다.
// 실제 클립보드에는 아무것도 넣지 않는다. (페이지 자체 스크립트 영역에서 실행)
async function copyUrlProbe() {
  const wins = [window];
  const fr = document.querySelector("iframe#cafe_main");
  try {
    if (fr && fr.contentWindow && fr.contentWindow.document) wins.push(fr.contentWindow);
  } catch {
    /* 다른 도메인 틀 */
  }
  let copied = "";
  const restores = [];
  for (const w of wins) {
    const d = w.document;
    const grab = () => {
      const ae = d.activeElement;
      return (d.getSelection && d.getSelection().toString()) || (ae && "value" in ae ? ae.value : "") || "";
    };
    const clip = w.navigator.clipboard;
    if (clip) {
      const orig = clip.writeText;
      try {
        clip.writeText = (t) => {
          copied = copied || String(t);
          return Promise.resolve();
        };
        restores.push(() => {
          clip.writeText = orig;
        });
      } catch {
        /* 바꿀 수 없음 */
      }
    }
    const origExec = d.execCommand;
    d.execCommand = function (cmd, ...rest) {
      if (String(cmd).toLowerCase() === "copy") {
        copied = copied || grab();
        return true;
      }
      return origExec.call(this, cmd, ...rest);
    };
    restores.push(() => {
      d.execCommand = origExec;
    });
  }
  let btn = null;
  for (const w of wins) {
    for (const el of w.document.querySelectorAll("button, a, span")) {
      if (el.innerText && el.innerText.replace(/\s+/g, "") === "URL복사") {
        btn = el.closest("button, a") || el;
        break;
      }
    }
    if (btn) break;
  }
  if (btn) {
    btn.click();
    for (let i = 0; i < 15 && !copied; i++) await new Promise((r) => setTimeout(r, 100));
  }
  restores.forEach((f) => {
    try {
      f();
    } catch {
      /* 무시 */
    }
  });
  return copied;
}

// 글 목록 화면(작성자의 작성글 / 게시판 목록) 안에서 실행: 보이는 글 제목과 날짜를 모은다
async function cafeListProbe(limit) {
  const ARTICLE = /articles\/\d+|articleid=\d+|cafe\.naver\.com\/[A-Za-z0-9_\-]+\/\d+/i;
  const DATE = /(\d{4}\.\s?\d{1,2}\.\s?\d{1,2})|(\d{2}\.\d{2}\.\d{2})|(\d{1,2}:\d{2})/;
  const collect = () => {
    const frame = document.querySelector("iframe#cafe_main");
    let doc = document;
    try {
      if (frame && frame.contentDocument && frame.contentDocument.body) doc = frame.contentDocument;
    } catch {
      /* 다른 도메인 틀 */
    }
    const seen = new Set();
    const out = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      if (!ARTICLE.test(a.getAttribute("href"))) continue;
      const title = a.innerText.replace(/\s+/g, " ").trim();
      if (title.length < 4 || seen.has(title)) continue;
      seen.add(title);
      const row = a.closest("tr, li, [class*='item'], [class*='Item']") || a.parentElement;
      const date = ((row && row.innerText.match(DATE)) || [""])[0];
      out.push({ title: title.slice(0, 80), date, href: a.href });
      if (out.length >= limit) break;
    }
    return out;
  };
  let rows = [];
  for (let t = 0; t < 12 && rows.length < 3; t++) {
    rows = collect();
    if (rows.length < 3) await new Promise((r) => setTimeout(r, 500));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 창 열기 / 디버거 / 캡처
// ---------------------------------------------------------------------------

function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// 창을 열고 바로 크롬 디버거를 붙인다: 화면 배율 고정 + 삭제 안내 같은 알림창(alert)을 자동으로 닫고 문구를 기록
async function openWindow(url) {
  const win = await chrome.windows.create({
    url: "about:blank",
    focused: false,
    type: "normal",
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
  });
  const tabId = win.tabs[0].id;
  const dialogs = [];
  const onEvent = (src, method, params) => {
    if (src.tabId !== tabId || method !== "Page.javascriptDialogOpening") return;
    dialogs.push(params.message || "");
    cdp(tabId, "Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  };
  chrome.debugger.onEvent.addListener(onEvent);
  await chrome.debugger.attach({ tabId }, "1.3");
  await cdp(tabId, "Page.enable");
  await cdp(tabId, "Emulation.setDeviceMetricsOverride", {
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    deviceScaleFactor: CAPTURE_DPR,
    mobile: false,
  });
  await gotoAndWait(tabId, url);
  const close = async () => {
    chrome.debugger.onEvent.removeListener(onEvent);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    await chrome.windows.remove(win.id).catch(() => {});
  };
  return { tabId, dialogs, close };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("시간 초과")), ms))]);

async function gotoAndWait(tabId, url) {
  await new Promise((resolve) => {
    const timer = setTimeout(done, 30000);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id, info) {
      if (id === tabId && info.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(done);
  });
  await sleep(2000);
}

async function readList(tabId, url) {
  if (!url) return [];
  try {
    await gotoAndWait(tabId, url);
    const [res] = await withTimeout(
      chrome.scripting.executeScript({ target: { tabId }, func: cafeListProbe, args: [LIST_LIMIT] }),
      20000,
    );
    return (res && res.result) || [];
  } catch {
    return [];
  }
}

// 게시글 본문 글자만 읽기 (작성자의 계약·출고 인증 글에서 제원 확인용)
async function articleTextProbe() {
  const frame = document.querySelector("iframe#cafe_main");
  let doc = document;
  try {
    if (frame && frame.contentDocument && frame.contentDocument.body) doc = frame.contentDocument;
  } catch {
    /* 다른 도메인 틀 */
  }
  for (let t = 0; t < 10; t++) {
    const el = doc.querySelector(".se-main-container, .ContentRenderer, .article_viewer, #tbody, #postContent");
    if (el && el.innerText.trim()) return el.innerText.replace(/\s+/g, " ").trim().slice(0, 1500);
    await new Promise((r) => setTimeout(r, 500));
  }
  return "";
}

async function readArticleText(tabId, url) {
  try {
    await gotoAndWait(tabId, url);
    const [res] = await withTimeout(chrome.scripting.executeScript({ target: { tabId }, func: articleTextProbe }), 15000);
    return (res && res.result) || "";
  } catch {
    return "";
  }
}

const CERT_RE = /계약|출고|인수|인증|구매|탁송/;
const MAX_CERT_POSTS = 2;

// 담당자가 알려 준 카페 공통 안내 문구 (빈칸 없이 이어 붙인 글자). 이 글로 시작하면 바로 뺀다.
const SEED_BOILERPLATES = [
  // 아이오닉9 오너스 자유게시판
  "📍함께하는[아이오닉9오너스]카페질문은질문답변게시판이용해주세요.글쓰기에서해당게시판이안보이면등업이필요합니다.(글2개,댓글5개,방문5회,좋아요10회)카페활동예의를지켜주세요.경우에따라카페운영회칙에의거활동정지또는탈퇴처리될수있습니다.",
  // 아이오닉9 오너스 질문 게시판 (뒤에 빈 질문 양식이 붙음)
  "📍함께하는[아이오닉9오너스]카페카페활동예의를지켜주세요.경우에따라카페운영회칙에의거활동정지또는탈퇴처리될수있습니다.",
];
// 전에 찾아 둔 카페 안내 문구 (다음 글에서도 바로 빼기 위해 기억)
let knownBoilerplates = [];

async function probe(tabId, mode, target) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: cafePageProbe,
    args: [mode, target || null, MAX_COMMENTS, MAX_IMAGES, knownBoilerplates],
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

async function fetchImage(src) {
  if (!src || !/^(https:|data:image\/(png|jpe?g|gif|webp))/i.test(src)) return null;
  try {
    const res = await fetch(src, { credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob); // 그림으로 열리는지 확인
    if (bmp.width < 80 || bmp.height < 60) return null;
    blob.isOriginal = true;
    return blob;
  } catch {
    return null;
  }
}

// → { info, header, body, comments: [Blob|null], images: [Blob|null], dpr }
class DeletedPostError extends CaptureError {}
const DELETED_RE = /삭제되었거나|존재하지 않는 게시글|삭제된 게시글|삭제된 게시물/;

// → { info, header, body, comments: [Blob|null], images: [Blob|null], dpr }
async function captureCafePost(url, onStep = () => {}) {
  const saved = await chrome.storage.local.get(["boilerplates"]).catch(() => ({}));
  knownBoilerplates = [...SEED_BOILERPLATES, ...(saved.boilerplates || []).filter((k) => !SEED_BOILERPLATES.includes(k))];
  onStep("게시글 여는 중");
  const { tabId, dialogs, close } = await openWindow(url);
  try {
    let info = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (dialogs.some((m) => DELETED_RE.test(m))) break;
      info = await withTimeout(probe(tabId, "info"), 40000).catch(() => null);
      if (info && (!info.error || info.error === "login" || info.error === "deleted")) break;
      await sleep(1500);
    }
    if (dialogs.some((m) => DELETED_RE.test(m)) || (info && info.error === "deleted")) {
      throw new DeletedPostError("삭제된 게시물");
    }
    if (!info) throw new CaptureError(dialogs.length ? `게시글을 열 수 없음: ${dialogs[0]}` : "게시글 화면을 읽지 못했습니다");
    if (info.error === "login") throw new CaptureError("네이버 로그인이 필요합니다");
    if (info.error) throw new CaptureError("본문을 찾지 못함 (카페 가입이 필요한 글일 수 있음)");

    // 새로 찾은 안내 문구는 기억해 두었다가 다음 글에서도 뺀다 (최근 50개)
    if (info.boilerplateText && info.boilerplateText.length >= 15 && !knownBoilerplates.includes(info.boilerplateText)) {
      const learned = [info.boilerplateText, ...knownBoilerplates.filter((k) => !SEED_BOILERPLATES.includes(k))].slice(0, 50);
      knownBoilerplates = [...SEED_BOILERPLATES, ...learned];
      await chrome.storage.local.set({ boilerplates: learned }).catch(() => {});
    }

    // 게시글 위치: 'URL 복사' 버튼이 주는 주소를 우선 사용
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: copyUrlProbe });
      const m = String((res && res.result) || "").match(/https?:\/\/cafe\.naver\.com\/([A-Za-z0-9_\-]+)\/(\d+)/);
      if (m && !/^(ca-fe|f-e)$/.test(m[1])) info.canonicalUrl = `https://cafe.naver.com/${m[1]}/${m[2]}`;
    } catch {
      /* 링크에서 찾은 주소 사용 */
    }

    onStep("캡처 중");
    const take = async (target) => shot(tabId, await withTimeout(probe(tabId, "rect", target), 20000).catch(() => null));
    const out = { info, dpr: CAPTURE_DPR, comments: [], images: [] };
    out.header = await take("header");
    // 본문 사진은 원본 파일을 직접 받는다 (선명하고 여백·비율 왜곡 없음). 못 받으면 화면 캡처로 대신.
    for (const im of info.images) out.images.push((await fetchImage(im.src)) || (await take(`image${im.index}`)));
    for (const c of info.comments) out.comments.push(await take(`comment${c.index}`));
    out.body = await take("body"); // 마지막: 본문 이미지를 가린 상태로 찍음
    await probe(tabId, "restore").catch(() => {});

    // 지역(작성자의 다른 글)·중복(같은 게시판 최근 글) 판단용 목록. 사람처럼 잠깐씩 쉬며 같은 창에서 연다.
    onStep("작성글·게시판 목록 확인 중");
    await sleep(1000 + Math.random() * 1500);
    info.authorPosts = await readList(tabId, info.authorLink);
    // 제원(2.5T·1.6T·HEV 등) 확인용: 작성자의 계약·출고 인증 글을 최대 2개 열어 본문을 읽는다
    info.authorCertPosts = [];
    for (const p of info.authorPosts.filter((p) => CERT_RE.test(p.title) && p.href).slice(0, MAX_CERT_POSTS)) {
      await sleep(1000 + Math.random() * 1500);
      const text = await readArticleText(tabId, p.href);
      if (text) info.authorCertPosts.push({ title: p.title, text });
    }
    if (info.boardLink) await sleep(1000 + Math.random() * 1500);
    info.boardPosts = await readList(tabId, info.boardLink);
    return out;
  } finally {
    await close();
  }
}
