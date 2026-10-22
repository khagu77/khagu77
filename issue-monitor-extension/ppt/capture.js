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
const BODY_CHUNK = 3000; // 긴 본문은 이 높이(화면 px)씩 나눠 찍는다

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

  // 댓글에 붙은 사진·영상 (작성자 프로필 아이콘·등급 표시 같은 작은 그림은 빼고). 그림만 담은 감싸개까지 돌려준다
  function commentMedia(li) {
    const out = [];
    const PROFILE = "[class*='thumb' i], [class*='profile' i], [class*='nick' i], [class*='badge' i], [class*='level' i], [class*='icon' i]";
    for (const m of li.querySelectorAll("img, video, iframe, canvas")) {
      if (m.closest(PROFILE) && !m.closest("[class*='attach' i], [class*='comment_image' i]")) continue;
      const r = m.getBoundingClientRect();
      const w = r.width || m.width || 0;
      const h = r.height || m.height || 0;
      if (w && h && w < 40 && h < 40) continue; // 작은 아이콘
      let box = m;
      while (box.parentElement && box.parentElement !== li && !box.parentElement.innerText.trim() && !box.parentElement.querySelector("button")) {
        box = box.parentElement;
      }
      out.push(box);
    }
    return out;
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

  const unhideAll = () => {
    doc.querySelectorAll("[data-rpt-hide]").forEach((m) => {
      m.style.visibility = m.dataset.rptHide === "-" ? "" : m.dataset.rptHide;
      delete m.dataset.rptHide;
    });
    doc.querySelectorAll("[data-rpt-disp]").forEach((m) => {
      m.style.display = m.dataset.rptDisp === "-" ? "" : m.dataset.rptDisp;
      delete m.dataset.rptDisp;
    });
  };

  if (mode === "restore") {
    unhideAll();
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
    unhideAll();
    // 자리까지 없애기 (본문: 사진·영상·안내 문구가 차지하던 높이도 없애 글자만 이어지게)
    const remove = (m) => {
      if (m.dataset.rptDisp == null) m.dataset.rptDisp = m.style.display || "-";
      m.style.display = "none";
    };
    const hide = (m) => {
      if (m.dataset.rptHide == null) m.dataset.rptHide = m.style.visibility || "-";
      m.style.visibility = "hidden";
    };
    if (target === "body") {
      // 본문 글자만 찍기 위해 첨부 사진·영상·스티커와 맨 위 카페 안내 문구를 자리까지 없앤다
      // (가리기만 하면 사진이 많은 긴 글은 빈자리 때문에 캡처가 너무 길어짐)
      el.querySelectorAll(
        ".se-component.se-image, .se-component.se-video, .se-component.se-oembed, .se-component.se-sticker, .se-component.se-oglink, .se-component.se-map, .se-component.se-file",
      ).forEach(remove);
      el.querySelectorAll("img, video, iframe, canvas, .se-image, .se-sticker, .se-video, .se-oglink, .se-map, .se-file").forEach(remove);
      el.querySelectorAll("[data-rpt-boiler]").forEach(remove);
    } else if (target.startsWith("comment")) {
      // 댓글: 작성자 아이콘·하트·… 버튼은 그대로 두고, 댓글에 붙은 사진·이모티콘(스티커)·영상은 자리까지 없앤다
      // → 댓글 글자 바로 밑에 작성일시가 이어 붙는다
      el.querySelectorAll("[class*='sticker' i]").forEach(remove);
      for (const m of commentMedia(el)) remove(m);
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
    // 영상 + 아래 글자: 영상 화면과 그 아래 글자만 딱 맞게 (칸 전체 폭의 빈 여백은 빼고) (담당자 수정 2026-10-21)
    if (el.hasAttribute("data-rpt-vcap")) {
      const scrEl = el.querySelector("[data-rpt-vscreen]") || el;
      const sr = scrEl.getBoundingClientRect();
      let L = sr.left;
      let T = sr.top;
      let R = sr.right;
      let B = sr.bottom;
      const tw = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.textContent.trim() || (n.parentElement && n.parentElement.closest("video, iframe"))) continue;
        const rg = doc.createRange();
        rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        if (r.height <= 0 || r.top < sr.bottom - 2) continue; // 영상 위에 겹친 글자(재생 수 등)는 화면 캡처에 이미 들어감
        L = Math.min(L, r.left);
        R = Math.max(R, r.right);
        B = Math.max(B, r.bottom);
      }
      const pad = 2;
      let x = L + window.scrollX - pad;
      let y = T + window.scrollY - pad;
      if (doc !== document) {
        const fr = frame.getBoundingClientRect();
        x += fr.left + frame.clientLeft;
        y += fr.top + frame.clientTop;
      }
      return { x: Math.max(0, x), y: Math.max(0, y), width: R - L + pad * 2, height: B - T + pad * 2 + 4 };
    }
    // 본문은 여유 없이(바로 아래 영역이 섞이지 않게), 나머지는 2px 여유
    const rect = toPage(el, target === "body" ? 0 : 2);
    // 아주 긴 본문은 여러 번 나눠 찍어 이어 붙인다 (captureBody). 이어 붙인 그림 크기 한계 때문에 최대 16000px
    if (rect && target === "body") rect.height = Math.min(rect.height, 16000);
    return rect;
  }

  // ---- mode === "info" ----
  if (/nid\.naver\.com/.test(location.href)) return { error: "login" };
  const body = pick(doc, SEL.body);
  if (!body) {
    const pageText = `${document.body?.innerText || ""} ${doc.body?.innerText || ""}`;
    if (/삭제되었거나|존재하지 않는 게시글|삭제된 게시글|삭제된 게시물/.test(pageText)) return { error: "deleted" };
    const t = pick(doc, SEL.title);
    return { error: "nobody", href: location.href, title: t ? t.innerText.trim() : "" };
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
  // ④ 카페 글쓰기 양식 줄 (담당자 확인 2026-10-19): 맨 앞이 양식 항목·안내로만 이어지면 그 끝까지
  //    CN8 클럽 "제목 : 올뉴 아반떼 cn7 (간단한결함/불만내용)", "※ no1. … 팁!", "(예시 : …)", "… 결함/불만 내용 :"
  //    전기차 동호회 "* 관련된 주제에 대해 미리 카페내 검색해 보셨습니까? : (네/아니오)", "* 전기차 종류, 지역 : …" ("* 질문 내용 : …" 은 남김)
  if (cut < 0) {
    const FORM = [
      /^제목\s*[:：]/,
      /^※\s*no\.?\s*\d/i,
      /님들도\s*확인하기\s*편하/,
      /^\(?\s*예시\s*[:：]/,
      /(결함|불만)[\s/]*(결함|불만)?\s*내용\s*[:：]\s*$/,
      /^[*·•\-]?\s*관련된\s*주제에\s*대해/,
      /^[*·•\-]?\s*전기차\s*종류/,
      /^[*·•\-]?\s*(차종|차량\s*종류|연식|구입\s*시기|출고\s*시기|주행\s*거리|지역)\s*[,/]?\s*[^:：]{0,10}[:：]/,
    ];
    let last = -1;
    for (let i = 0; i < LIMIT; i++) {
      const t = text(lines[i]);
      if (lines[i].media) break;
      if (!t || isDivider(lines[i])) continue;
      if (FORM.some((r) => r.test(t))) {
        last = i;
        continue;
      }
      break;
    }
    if (last >= 0) cut = last;
  }
  // ⑤ 안내 문구가 없어도 맨 앞에 구분선만 있으면 그 구분선은 뺀다
  if (cut < 0) {
    let i = 0;
    while (i < LIMIT && !lines[i].media && (isDivider(lines[i]) || !text(lines[i]))) i++;
    if (i > 0 && lines.slice(0, i).some((l) => isDivider(l))) cut = i - 1;
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
  // ⑥ 본문 어디에 있든 빼는 카페 글쓰기 양식·고정 안내문 (담당자 수정 2026-10-21: 넥쏘 카페 nexocafe/306247)
  //    넥쏘 카페 양식: 위 "A. 차량에 이상이 생겼을 경우 / (당일, 주말 공휴일 경우 불가능) / 1. 차주명 : / 2. 마지막 수소 충전소 : / 3. 차량 문제점 :"
  //    아래 "B. 수리후, 후기 작성시 / 1. 방문일 : … 4. 서비스 센터 담당자 성함 :" + 카페 고정 안내문(수소전기차 실제 오너만 … 수소전담서비스 조회)
  //    → 작성자가 쓴 글만 남긴다. 양식 칸에 값을 적었으면 그 줄은 남기되, 차주명(개인정보) 줄은 항상 뺀다.
  const FORM_ANY = [
    /^A\.\s*차량에\s*이상이\s*생겼을\s*경우/,
    /^\(?\s*당일\s*,?\s*주말\s*(및\s*)?공휴일/,
    /^B\.\s*수리\s*후\s*,?\s*후기\s*작성/,
    /^\d+\s*[.)]\s*(차주명|마지막\s*수소\s*충전소|차량\s*문제점|방문일|서비스\s*센터명|사업소\s*또는\s*블루핸즈|서비스\s*센터\s*담당자\s*성함)[^:：]{0,20}[:：]\s*$/,
    /^\d+\s*[.)]\s*차주명\s*[:：]/,
    /수소전기차\s*실제\s*오너만\s*등록이\s*가능/,
    /개인\s*정보\s*노출되는\s*동호회\s*커뮤니티/,
    /^마시기\s*바라며\s*참고하여\s*불이익/,
    /^주의할\s*사항은\s*차량에\s*문제\s*발생/,
    /^마치\s*모든\s*문제가\s*해결\s*될\s*것\s*처럼/,
    /^절대\s*현혹\s*되지\s*마시기/,
    /커뮤니티는\s*인터넷\s*실명제\s*동호회/,
    /^그\s*어떠한\s*부분도\s*어떠한\s*형태/,
    /^위반시\s*내보내기\s*처리/,
    /수소전담\s*서비스\s*조회/,
  ];
  const extraBoiler = new Set();
  lines.forEach((l, i) => {
    if (i <= cut && boilerplateText) return;
    const t = text(l);
    if (!l.media && t && FORM_ANY.some((r) => r.test(t))) extraBoiler.add(i);
  });
  if (extraBoiler.size) {
    const hidden = new Set();
    for (const i of extraBoiler) {
      const l = lines[i];
      for (const el of l.els) el.setAttribute("data-rpt-boiler", "");
      for (const tn of l.nodes) {
        if (!tn.parentNode) continue;
        const span = doc.createElement("span");
        span.setAttribute("data-rpt-boiler", "");
        tn.parentNode.insertBefore(span, tn);
        span.appendChild(tn);
        hidden.add(tn);
      }
    }
    // 양식·안내문만 들어 있는 문단·상자는 자리까지 뺀다
    for (const el of body.querySelectorAll("p, div, li, blockquote, table")) {
      if (el.hasAttribute("data-rpt-boiler")) continue;
      const tw = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let any = false;
      let only = true;
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        any = true;
        if (!hidden.has(t)) {
          only = false;
          break;
        }
      }
      if (any && only && !el.querySelector("img, video, iframe")) el.setAttribute("data-rpt-boiler", "");
    }
  }
  const bodyText = lines
    .filter((l, i) => !(i <= cut && boilerplateText) && !extraBoiler.has(i) && !l.media)
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
    const hasImage = commentMedia(li).length > 0;
    li.setAttribute("data-rpt", `comment${ci}`);
    comments.push({ index: ci, nickname, text, hasSticker, hasImage });
    ci++;
  }
  if (!commentCount) commentCount = String(doc.querySelectorAll(SEL.commentItem.join(",")).length);

  // 영상 칸 안에서 실제 영상 화면: <video> → <iframe> → 가장 큰 미리보기 그림 → 가장 큰 플레이어 칸
  function videoScreen(box) {
    const area = (x) => x.r.width * x.r.height;
    const cands = [...box.querySelectorAll("video, iframe, img, canvas, [class*='player' i], [class*='thumb' i], .pzp")]
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width >= 80 && x.r.height >= 60)
      .sort((a, b) => area(b) - area(a));
    for (const tag of ["VIDEO", "IFRAME", "IMG", "CANVAS"]) {
      const c = cands.find((x) => x.e.tagName === tag);
      if (c) return c.e;
    }
    return cands.length ? cands[0].e : box;
  }

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
      // 영상 아래에 글(설명 캡션·영상 제목 등)이 있으면 영상 칸 전체(화면 + 아래 글)를 찍는다
      // (담당자 수정 2026-10-19 "모니터 먹통ㅋㅋ", 2026-10-21 넥쏘 카페 "경고등" — 영상 화면만 찍으면 안 됨)
      const comp = img.closest(".se-component") || img;
      const scr = videoScreen(img).getBoundingClientRect();
      let capText = "";
      const capEl = comp.querySelector(".se-caption, .se-module-text, figcaption, [class*='caption' i], [class*='title' i], [class*='desc' i]");
      if (capEl && (capEl.innerText || "").trim()) capText = capEl.innerText.trim();
      if (!capText) {
        // 클래스 이름과 상관없이 영상 화면 아래쪽에 보이는 글자가 있으면 캡션으로 본다
        const walker = doc.createTreeWalker(comp, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = n.textContent.trim();
          if (!t || !n.parentElement || n.parentElement.closest("video, iframe")) continue;
          const tr = n.parentElement.getBoundingClientRect();
          if (tr.height > 0 && tr.top >= scr.bottom - 2) {
            capText = t;
            break;
          }
        }
      }
      if (capText) {
        const cr = comp.getBoundingClientRect();
        comp.setAttribute("data-rpt", `image${images.length}`);
        comp.setAttribute("data-rpt-vcap", "");
        videoScreen(img).setAttribute("data-rpt-vscreen", "");
        images.push({ index: images.length, width: cr.width, height: cr.height, src: "", video: true, caption: capText });
        continue;
      }
      // 영상: 흰 여백·영상 제목 줄이 들어간 바깥 칸이 아니라 영상 화면(플레이어) 자체를 찍는다 → 영상 폭에 딱 맞게
      const screen = videoScreen(img);
      const sr = screen.getBoundingClientRect();
      screen.setAttribute("data-rpt", `image${images.length}`);
      images.push({ index: images.length, width: sr.width, height: sr.height, src: "", video: true });
      continue;
    }
    if (r.width < 80 || r.height < 60 || img.naturalWidth < 80) continue;
    img.setAttribute("data-rpt", `image${images.length}`);
    // 원본 주소: 늦게 불러오기 전 흐린 미리보기(type=w80_blur 등) 대신 큰 이미지로
    let src = img.getAttribute("data-lazy-src") || img.getAttribute("data-src") || img.currentSrc || img.src || "";
    // 스마트에디터 사진은 링크 정보(data-linkdata)에 원본 주소가 있다 — 묶음 사진·작은 미리보기 대신 원본으로
    // (담당자 지적 2026-10-22: gruu/1756933 첨부 사진이 106~219px 작은 그림으로 들어가 화질이 낮았음)
    try {
      const holder = img.closest("[data-linkdata]") || (img.closest(".se-component, .se-module") || img).querySelector("[data-linkdata]");
      const ld = holder ? JSON.parse(holder.getAttribute("data-linkdata") || "{}") : null;
      if (ld && ld.src && /^https?:/.test(ld.src)) src = ld.src;
    } catch {}
    // dthumb 같은 썸네일 중계 주소면 원래 그림 주소(src=)로
    try {
      const u = new URL(src, location.href);
      if (/dthumb|thumb-phinf\.pstatic\.net\/\?/.test(u.href) && u.searchParams.get("src")) src = u.searchParams.get("src").replace(/^"|"$/g, "");
    } catch {}
    if (/pstatic\.net/.test(src)) src = /[?&]type=/.test(src) ? src.replace(/([?&])type=[^&]*/, "$1type=w966") : `${src}${src.includes("?") ? "&" : "?"}type=w966`;
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
  const boardEl = articleBox.querySelector("a.link_board, a[href*='/menus/'], a[href*='ArticleList.nhn'], a[href*='search.menuid']");
  const boardLink = abs(boardEl);
  // 게시판명 (예: "GV70 2.5T 결함/정비" → 제원 2.5T 를 알 수 있음)
  const boardName = boardEl ? boardEl.innerText.replace(/\s+/g, " ").replace(/[>›]\s*$/, "").trim() : "";
  const postDate = (headText.match(/(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})/) || []).slice(1, 4).join("-");

  return {
    href: location.href,
    canonicalUrl,
    authorLink,
    boardLink,
    boardName,
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
// 네이버 검색으로 들어가기
// 영운모·넥쏘카페처럼 카페 가입 없이는 글 주소로 바로 열리지 않는 동호회는 네이버에서 글 제목을 검색해
// 검색 결과의 글 링크로 들어가야 열린다 (검색 결과 링크로 들어오면 비회원도 볼 수 있게 열어 둔 카페).
// ---------------------------------------------------------------------------
const SEARCH_ENTRY_CAFES = [/영운모/, /넥쏘/, /truckerking/i]; // 처음부터 검색으로 들어가는 동호회 (이름 또는 카페 주소)
const ARTICLE_URL = /^https?:\/\/(?:m\.)?cafe\.naver\.com\/([A-Za-z0-9_\-]+)\/(\d+)(?:[/?#]|$)/;

function needsSearchEntry(url, cafeName) {
  const slug = (String(url).match(ARTICLE_URL) || [])[1] || "";
  return SEARCH_ENTRY_CAFES.some((re) => re.test(cafeName || "") || re.test(slug));
}

// 검색 결과 화면 안에서 실행: 이 글(카페 주소·글번호)로 가는 링크를 찾아 돌려준다
async function searchResultProbe(slug, articleId, clubId) {
  const match = (h) =>
    h.includes(`cafe.naver.com/${slug}/${articleId}`) ||
    new RegExp(`articleid=${articleId}(?!\\d)`, "i").test(h) ||
    (clubId && h.includes(`/cafes/${clubId}/articles/${articleId}`));
  for (let t = 0; t < 16; t++) {
    const a = [...document.querySelectorAll("a[href]")].find((x) => match(x.href));
    if (a) return a.href;
    await new Promise((r) => setTimeout(r, 500));
  }
  return "";
}

// 카페 첫 화면 안에서 실행: 카페 번호(clubid)
function clubIdProbe() {
  const html = document.documentElement.outerHTML;
  const m =
    html.match(/clubid=(\d+)/i) || html.match(/\/cafes\/(\d+)\//) || html.match(/g_sClubId\s*=\s*["']?(\d+)/) || html.match(/"clubId"\s*:\s*"?(\d+)/);
  return m ? m[1] : "";
}

async function runProbe(tabId, func, args = []) {
  const [res] = await withTimeout(chrome.scripting.executeScript({ target: { tabId }, func, args }), 20000);
  return res && res.result;
}

// 글 제목 찾기: 엑셀 제목 → 막힌 화면에 보이는 제목 → 카페 전체글 목록에서 글번호로
async function findTitle(tabId, slug, articleId, known) {
  if (known && known.title) return { title: known.title, clubId: "" };
  let clubId = "";
  try {
    await gotoAndWait(tabId, `https://cafe.naver.com/${slug}`);
    clubId = (await runProbe(tabId, clubIdProbe)) || "";
  } catch {
    /* 목록에서 못 찾음 */
  }
  if (!clubId) return { title: "", clubId };
  const same = (h) => h.includes(`/articles/${articleId}`) || new RegExp(`articleid=${articleId}(?!\\d)`, "i").test(h) || h.includes(`/${slug}/${articleId}`);
  for (let page = 1; page <= 4; page++) {
    for (const u of [
      `https://cafe.naver.com/f-e/cafes/${clubId}/menus/0?viewType=L&size=50&page=${page}`,
      `https://cafe.naver.com/ArticleList.nhn?search.clubid=${clubId}&search.boardtype=L&search.page=${page}&userDisplay=50`,
    ]) {
      const rows = await readList(tabId, u);
      const hit = rows.find((r) => same(r.href || ""));
      if (hit) return { title: hit.title, clubId };
      if (rows.length) break; // 이 주소 형식이 통하면 다음 쪽으로
    }
    await sleep(800 + Math.random() * 800);
  }
  return { title: "", clubId };
}

// 네이버에서 제목을 검색해 검색 결과의 글 링크로 들어간다. 성공하면 true
async function enterViaSearch(tabId, url, known, onStep) {
  const m = String(url).match(ARTICLE_URL);
  if (!m) return false;
  const [, slug, articleId] = m;
  onStep("네이버 검색으로 들어가는 중");
  const { title, clubId } = await findTitle(tabId, slug, articleId, known);
  if (!title) return false;
  const clean = title.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || title;
  const queries = [`"${title}"`, title, `${clean} ${known.cafe || ""}`.trim()];
  for (const q of [...new Set(queries)]) {
    for (const base of ["https://search.naver.com/search.naver?ssc=tab.cafe.all&query=", "https://search.naver.com/search.naver?where=article&query="]) {
      await gotoAndWait(tabId, base + encodeURIComponent(q));
      const href = await runProbe(tabId, searchResultProbe, [slug, articleId, clubId]).catch(() => "");
      if (href) {
        // 검색 결과 화면에서 링크를 누른 것처럼 이동 (검색에서 들어온 것으로 열림)
        await waitLoad(tabId, () => chrome.scripting.executeScript({ target: { tabId }, func: (h) => { location.href = h; }, args: [href] }));
        return true;
      }
      await sleep(600 + Math.random() * 600);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 창 열기 / 디버거 / 캡처
// ---------------------------------------------------------------------------

function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// 캡처용 창 (담당자 요청 2026-10-20: 큰 창이 떴다 사라지며 실수로 닫는 일 방지)
// 맥 크롬은 최소화했거나 다른 창에 완전히 가려진 창은 화면을 그리지 않아 캡처가 안 된다 (2026-10-21 담당자 맥에서 확인:
// 최소화 시험이 실패해 큰 창이 그대로 떴음). 그래서 PC 마다 되는 방법을 한 번 시험해 기억해 두고 쓴다:
//   ① min    : 최소화 창 (화면에 전혀 안 보임 — 되는 PC 에서만)
//   ② corner : 화면 오른쪽 아래 구석에 절반쯤 화면 밖으로 걸쳐 둔 작은 창 (구석에 작게만 보임)
// 작은 창은 작업 화면을 가리지 않고, 캡처 순간에 다른 창에 완전히 가려져 있으면 그때만 맨 앞으로 올린다.
// 한 창을 계속 다시 쓰고(글마다 열고 닫지 않음), 담당자가 닫아 버리면 다음 글에서 새로 연다. 30초 동안 안 쓰면 저절로 닫힌다.
const CAPTURE_MODES = ["min", "corner"];
let capWin = null; // { winId, tabId, mode }
let capIdleTimer = null;
let capChecked = false;

function capBounds() {
  const sc = window.screen;
  const L = sc.availLeft || 0;
  const T = sc.availTop || 0;
  const W = sc.availWidth || 1440;
  const H = sc.availHeight || 900;
  // 크롬은 창의 절반 이상이 화면 안에 있어야 해서, 작은 창을 오른쪽 아래 구석에 절반만 걸쳐 둔다
  const w = 320;
  const h = 220;
  return { left: Math.round(L + W - w * 0.6), top: Math.round(T + H - h * 0.6), width: w, height: h };
}

async function raiseCapWindow() {
  if (capWin) await chrome.windows.update(capWin.winId, { focused: true, state: "normal" }).catch(() => {});
}

async function placeCapWindow(mode) {
  if (!capWin) return;
  capWin.mode = mode;
  if (mode === "min") {
    await chrome.windows.update(capWin.winId, { state: "minimized" }).catch(() => {});
    return;
  }
  await chrome.windows.update(capWin.winId, { state: "normal" }).catch(() => {});
  await chrome.windows.update(capWin.winId, { ...capBounds(), focused: false }).catch(() => {});
}

async function captureWindow() {
  clearTimeout(capIdleTimer);
  if (capWin) {
    try {
      await chrome.tabs.get(capWin.tabId);
      return capWin;
    } catch {
      capWin = null; // 담당자가 닫음 → 새로 연다
    }
  }
  const { captureMode, captureWinId } = await chrome.storage.local.get(["captureMode", "captureWinId"]).catch(() => ({}));
  if (captureWinId) await chrome.windows.remove(captureWinId).catch(() => {}); // 지난번에 끊겨 남은 캡처 창
  const mode = CAPTURE_MODES.includes(captureMode) ? captureMode : "min";
  const win = await chrome.windows
    .create(mode === "min" ? { url: "about:blank", state: "minimized" } : { url: "about:blank", focused: false, type: "normal", ...capBounds() })
    .catch(() => chrome.windows.create({ url: "about:blank", focused: false, type: "normal", width: 320, height: 220 }));
  capWin = { winId: win.id, tabId: win.tabs[0].id, mode };
  await chrome.storage.local.set({ captureWinId: win.id }).catch(() => {});
  return capWin;
}

async function closeCaptureWindow() {
  clearTimeout(capIdleTimer);
  if (!capWin) return;
  const id = capWin.winId;
  capWin = null;
  await chrome.windows.remove(id).catch(() => {});
  await chrome.storage.local.remove("captureWinId").catch(() => {});
}

const testShot = (tabId) =>
  withTimeout(cdp(tabId, "Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 10, height: 10, scale: 1 } }), 5000)
    .then((r) => !!(r && r.data))
    .catch(() => false);

// 지금 방식으로 화면 캡처가 되는지 한 번 시험하고, 안 되면 다음 방식으로 옮긴다 (되는 방식을 기억)
async function ensureCapturable(tabId) {
  if (!capWin || capChecked) return;
  capChecked = true;
  if (capWin.mode === "min") {
    await sleep(300);
    if (await testShot(tabId)) return chrome.storage.local.set({ captureMode: "min" }).catch(() => {});
    await placeCapWindow("corner");
  }
  await chrome.storage.local.set({ captureMode: "corner" }).catch(() => {});
}

// 캡처 창에서 글을 열고 크롬 디버거를 붙인다: 화면 배율 고정 + 삭제 안내 같은 알림창(alert)을 자동으로 닫고 문구를 기록
async function openWindow(url) {
  const { tabId } = await captureWindow();
  const dialogs = [];
  const onEvent = (src, method, params) => {
    if (src.tabId !== tabId || method !== "Page.javascriptDialogOpening") return;
    dialogs.push(params.message || "");
    cdp(tabId, "Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  };
  chrome.debugger.onEvent.addListener(onEvent);
  await chrome.debugger.detach({ tabId }).catch(() => {}); // 지난 글에서 붙은 채 남았으면
  await chrome.debugger.attach({ tabId }, "1.3");
  await cdp(tabId, "Page.enable");
  await cdp(tabId, "Emulation.setDeviceMetricsOverride", {
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    deviceScaleFactor: CAPTURE_DPR,
    mobile: false,
  });
  await cdp(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await ensureCapturable(tabId);
  await gotoAndWait(tabId, url);
  const close = async () => {
    chrome.debugger.onEvent.removeListener(onEvent);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    await chrome.tabs.update(tabId, { url: "about:blank" }).catch(() => {}); // 창은 다음 글에 다시 씀
    clearTimeout(capIdleTimer);
    capIdleTimer = setTimeout(closeCaptureWindow, 30000);
  };
  return { tabId, dialogs, close };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("시간 초과")), ms))]);

async function gotoAndWait(tabId, url) {
  await waitLoad(tabId, () => chrome.tabs.update(tabId, { url }));
}

// trigger() 로 이동을 시작하고 화면을 다 불러올 때까지 기다린다
async function waitLoad(tabId, trigger) {
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
    Promise.resolve().then(trigger).catch(done);
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
    if (el && el.innerText.trim()) {
      // 본문 + 댓글 (댓글에서 "2.0 인스퍼 타요" 처럼 제원을 밝히는 경우도 있음)
      const cm = [...doc.querySelectorAll(".comment_text_view, .CommentItem .text_comment, .comment_box .text_comment")].map((c) => c.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 15).join(" / ");
      return (el.innerText.replace(/\s+/g, " ").trim().slice(0, 1500) + (cm ? ` [댓글] ${cm.slice(0, 600)}` : "")).trim();
    }
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
// 제원이 본문에 없으면 더 열어 볼 작성자 글 수 (작성자 게시글 보기: 제목에 제원·트림·시승·연비 등이 보이는 글부터, 없으면 최근 글)
const MAX_SPEC_POSTS = 4;
const SPEC_TITLE_RE = /\d\.\d|터보|하이브리드|HEV|LPG|LPI|디젤|가솔린|트림|인스퍼|모던|스마트|프리미엄|익스클루시브|캘리그래피|N\s?라인|시승|연비|옵션|엔진오일|정비|후기|AWD|HTRAC|2WD|4WD/i;

// 글에서 제원 후보 찾기 → [{ spec, from, snippet }]
// 숫자 배기량(2.0 등)은 주변에 차·엔진·트림 낱말이 있을 때만 (버전 2.0, 1.6km 같은 오탐 방지)
const SPEC_NEAR_RE = /아반떼|소나타|쏘나타|그랜저|싼타페|투싼|팰리세이드|코나|캐스퍼|스타리아|베뉴|제네시스|G70|G80|G90|GV60|GV70|GV80|CN\d|DN\d|GN\d|NX\d|MX\d|SX\d|LX\d|US\d|RG\d|JX\d|가솔린|엔진|트림|인스퍼|모던|스마트|프리미엄|익스클루시브|캘리그래피|N\s?라인|계약|출고|모델|AWD|2WD|4WD|HTRAC|자연흡기|MPI|GDI|오너|차주|타는|탑니다|몰고/i;
function specCandidates(sources) {
  const out = [];
  const add = (spec, from, text, i) => out.push({ spec, from, snippet: text.slice(Math.max(0, i - 25), i + 25).trim() });
  for (const { from, text: raw } of sources) {
    const text = String(raw || "");
    if (!text) continue;
    let m;
    const turbo = /(\d\.\d)\s*(?:T(?![a-z])|터보)/gi;
    while ((m = turbo.exec(text))) add(`${m[1]}T`, from, text, m.index);
    const hev = /하이브리드|HEV|(?<![A-Z])HV(?![A-Z])/g;
    while ((m = hev.exec(text))) add("HEV", from, text, m.index);
    // 디젤: 배기량이 붙어 있으면 "3.0D" 처럼 (2026-10-20 담당자 지정)
    // 화물차 톤수 (엑시언트 25t 등, 앱에서 "25t" 로 맞춤) — 화물차 글에서만 쓰임
    const ton = /(?<![\d.])(\d{1,2}(?:\.\d)?)\s*톤|(?<![\d.])(\d{1,2})\s*t(?:on)?(?![a-z\d])/gi;
    while ((m = ton.exec(text))) add(`${m[1] || m[2]}톤`, from, text, m.index); // 후보 표시용 "톤", 보고서에는 "25t"
    // LPI 는 배기량 없이 "LPI" 만
    const lpi = /LPG|LPI/gi;
    while ((m = lpi.exec(text))) add("LPI", from, text, m.index);
    let hasN = false;
    const dslN = /(\d\.\d)\s*(?:D(?![a-z])|디젤)|디젤\s*(\d\.\d)/gi;
    hasN = false;
    while ((m = dslN.exec(text))) (hasN = true), add(`${m[1] || m[2]}D`, from, text, m.index);
    const dsl = /디젤/g;
    if (!hasN) while ((m = dsl.exec(text))) add("디젤", from, text, m.index);
    const cc = /(?<![\d.]|디젤\s*|LPG\s*|LPI\s*)(1\.6|2\.0|2\.2|2\.5|3\.0|3\.3|3\.5|3\.8)(?![\d.%]|\s*(?:T(?![a-z])|터보|D(?![a-z])|디젤|LPG|LPI|km|키로|만|배|버전|ver|v\b|초|L\/|리터))/gi;
    while ((m = cc.exec(text))) {
      const near = text.slice(Math.max(0, m.index - 20), m.index + 25);
      if (SPEC_NEAR_RE.test(near)) add(m[1], from, text, m.index);
    }
  }
  return out;
}

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
  const params = {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 },
  };
  let res = await withTimeout(cdp(tabId, "Page.captureScreenshot", params), 8000).catch(() => null);
  if (!res) {
    // 캡처 창이 다른 창에 완전히 가려져 화면이 안 그려지는 경우: 그 작은 창만 잠깐 맨 앞으로 올려서 다시
    await raiseCapWindow();
    await sleep(500);
    res = await cdp(tabId, "Page.captureScreenshot", params);
  }
  const bin = atob(res.data);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: "image/png" });
}

// 원본 사진 받기: w966 → 주소 그대로(type 없이) 순서로. 받은 그림이 화면에 보이던 크기보다 작으면(썸네일) 화면 캡처가 더 낫다
async function fetchImage(src, shownCss = null) {
  if (!src || !/^(https:|data:image\/(png|jpe?g|gif|webp))/i.test(src)) return null;
  const tries = [src];
  if (/pstatic\.net/.test(src)) tries.push(src.replace(/([?&])type=[^&]*&?/, "$1").replace(/[?&]$/, ""));
  for (const u of tries) {
    try {
      const res = await fetch(u, { credentials: "omit" });
      if (!res.ok) continue;
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob); // 그림으로 열리는지 확인
      if (bmp.width < 80 || bmp.height < 60) continue;
      if (shownCss && bmp.width < shownCss.width * CAPTURE_DPR * 0.9) continue; // 화면 캡처(2배)보다 작은 썸네일이면 쓰지 않음
      blob.isOriginal = true;
      return blob;
    } catch {}
  }
  return null;
}

// → { info, header, body, comments: [Blob|null], images: [Blob|null], dpr }
class DeletedPostError extends CaptureError {}
const DELETED_RE = /삭제되었거나|존재하지 않는 게시글|삭제된 게시글|삭제된 게시물/;

// → { info, header, body, comments: [Blob|null], images: [Blob|null], dpr }
// known: { cafe: 동호회명, title: 엑셀에 적힌 글 제목 }
// 캡처 중에 담당자가 캡처 창을 닫아 버리면 새 창으로 한 번 더 시도한다
async function captureCafePost(url, onStep = () => {}, known = {}) {
  try {
    return await captureCafePostOnce(url, onStep, known);
  } catch (e) {
    let gone = !capWin;
    if (capWin) await chrome.tabs.get(capWin.tabId).catch(() => (gone = true));
    if (!gone && !/No tab|No window|not attached|Detached|closed/i.test(String(e && e.message))) throw e;
    capWin = null;
    onStep("캡처 창이 닫혀 다시 여는 중");
    return captureCafePostOnce(url, onStep, known);
  }
}

// 주간 보고서: 지금 시점의 조회수·댓글 수만 다시 읽는다 (캡처·작성자 글 확인 없이, 같은 작은 캡처 창으로)
async function readPostCounts(url, known = {}) {
  const searchFirst = needsSearchEntry(url, known.cafe);
  const { tabId, dialogs, close } = await openWindow(searchFirst ? "about:blank" : url);
  try {
    const readInfo = async (tries) => {
      let got = null;
      for (let attempt = 0; attempt < tries; attempt++) {
        if (dialogs.some((m) => DELETED_RE.test(m))) break;
        got = await withTimeout(probe(tabId, "info"), 40000).catch(() => null);
        if (got && (!got.error || got.error === "login" || got.error === "deleted")) break;
        await sleep(1500);
      }
      return got;
    };
    let info = searchFirst ? null : await readInfo(4);
    if (searchFirst || (info && info.error === "nobody")) {
      if (await enterViaSearch(tabId, url, { ...known }, () => {}).catch(() => false)) info = await readInfo(4);
    }
    if (dialogs.some((m) => DELETED_RE.test(m)) || (info && info.error === "deleted")) return { deleted: true };
    if (!info || info.error) return null;
    return { views: info.views || "", commentCount: info.commentCount || "" };
  } finally {
    await close();
  }
}

async function captureCafePostOnce(url, onStep = () => {}, known = {}) {
  const saved = await chrome.storage.local.get(["boilerplates"]).catch(() => ({}));
  knownBoilerplates = [...SEED_BOILERPLATES, ...(saved.boilerplates || []).filter((k) => !SEED_BOILERPLATES.includes(k))];
  onStep("게시글 여는 중");
  // 영운모·넥쏘카페: 글 주소로 바로 열지 않고 처음부터 네이버 검색으로 들어간다
  const searchFirst = needsSearchEntry(url, known.cafe);
  const { tabId, dialogs, close } = await openWindow(searchFirst ? "about:blank" : url);
  try {
    const readInfo = async (tries) => {
      let got = null;
      for (let attempt = 0; attempt < tries; attempt++) {
        if (dialogs.some((m) => DELETED_RE.test(m))) break;
        got = await withTimeout(probe(tabId, "info"), 40000).catch(() => null);
        if (got && (!got.error || got.error === "login" || got.error === "deleted")) break;
        await sleep(1500);
      }
      return got;
    };
    let info = searchFirst ? null : await readInfo(6);
    // 가입해야 보이는 글: 네이버에서 제목을 검색해 검색 결과 링크로 다시 들어간다
    if (searchFirst || (info && info.error === "nobody")) {
      const seen = { ...known, title: known.title || (info && info.title) || "" };
      if (await enterViaSearch(tabId, url, seen, onStep).catch(() => false)) info = await readInfo(6);
      else if (searchFirst) {
        await gotoAndWait(tabId, url);
        info = await readInfo(3);
      }
      if (info && info.error === "nobody") info.error = "nobody-search";
    }
    if (dialogs.some((m) => DELETED_RE.test(m)) || (info && info.error === "deleted")) {
      throw new DeletedPostError("삭제된 게시물");
    }
    if (!info) throw new CaptureError(dialogs.length ? `게시글을 열 수 없음: ${dialogs[0]}` : "게시글 화면을 읽지 못했습니다");
    if (info.error === "login") throw new CaptureError("네이버 로그인이 필요합니다");
    if (info.error === "nobody-search") {
      throw new CaptureError("본문을 찾지 못함 (네이버 제목 검색으로도 글에 들어가지 못했습니다. 엑셀에 글 제목 열이 있으면 더 잘 찾습니다)");
    }
    if (info.error) throw new CaptureError("본문을 찾지 못함 (카페 가입이 필요한 글일 수 있음)");
    // 검색으로 들어오면 주소에 검색 표시(?art=…)가 붙으므로 원래 글 주소 모양으로
    if (!info.canonicalUrl || /[?#]/.test(info.canonicalUrl)) {
      const m = String(url).match(ARTICLE_URL);
      if (m) info.canonicalUrl = `https://cafe.naver.com/${m[1]}/${m[2]}`;
    }

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
    for (const im of info.images) out.images.push((await fetchImage(im.src, { width: im.width })) || (await take(`image${im.index}`)));
    for (const c of info.comments) out.comments.push(await take(`comment${c.index}`));
    // 마지막: 본문 이미지를 없앤 상태로 찍음. 길면 여러 장으로 나눠 찍어 [Blob, Blob, …] (앱에서 이어 붙임)
    {
      const rect = await withTimeout(probe(tabId, "rect", "body"), 20000).catch(() => null);
      if (rect && rect.height > BODY_CHUNK) {
        out.body = [];
        for (let y0 = 0; y0 < rect.height; y0 += BODY_CHUNK) {
          out.body.push(await shot(tabId, { ...rect, y: rect.y + y0, height: Math.min(BODY_CHUNK, rect.height - y0) }));
        }
      } else out.body = await shot(tabId, rect);
    }
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
    // 본문·닉네임·작성자 글 제목·인증글에서 제원이 안 보이면, 작성자의 다른 글을 몇 개 더 열어 본문·댓글을 읽는다
    const specSources = () => [
      { from: "게시판명", text: info.boardName },
      { from: "게시글 제목", text: info.title },
      { from: "게시글 본문", text: info.bodyText },
      { from: "작성자 닉네임", text: info.author },
      ...info.authorPosts.map((p) => ({ from: "작성자 글 제목", text: p.title })),
      ...info.authorCertPosts.map((p) => ({ from: `작성자 글 본문 「${p.title}」`, text: p.text })),
      ...(info.authorPostTexts || []).map((p) => ({ from: `작성자 글 본문 「${p.title}」`, text: p.text })),
    ];
    info.authorPostTexts = [];
    if (!specCandidates(specSources()).filter((c) => !/톤$/.test(c.spec)).length) {
      onStep("작성자 글에서 제원 확인 중");
      const opened = new Set(info.authorCertPosts.map((p) => p.title));
      const rest = info.authorPosts.filter((p) => p.href && !opened.has(p.title) && !CERT_RE.test(p.title));
      const pick = [...rest.filter((p) => SPEC_TITLE_RE.test(p.title)), ...rest.filter((p) => !SPEC_TITLE_RE.test(p.title))].slice(0, MAX_SPEC_POSTS);
      for (const p of pick) {
        await sleep(1000 + Math.random() * 1500);
        const text = await readArticleText(tabId, p.href);
        if (text) info.authorPostTexts.push({ title: p.title, text });
        if (specCandidates(specSources()).filter((c) => !/톤$/.test(c.spec)).length) break;
      }
    }
    info.specHints = specCandidates(specSources()).slice(0, 12);
    if (info.boardLink) await sleep(1000 + Math.random() * 1500);
    info.boardPosts = await readList(tabId, info.boardLink);
    return out;
  } finally {
    await close();
  }
}
