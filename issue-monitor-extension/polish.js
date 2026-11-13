// 화면 꾸미기 도우미 (담당자 요청 2026-11-13) — 모든 탭·화면 공통, 기능은 건드리지 않고 모양만 정리
//  - 데일리 DB·명령 프롬프트·설정: 제목(h2)마다 그 아래 내용을 카드로 묶음
//  - 구역 제목 앞 ①②③ → 흰 동그라미 번호 뱃지
//  - 제목·항목 옆 긴 설명 → ⓘ (마우스를 올리거나 누르면 보임), 긴 설명 문단 → "ⓘ 설명 보기" 로 접기
//  - "아직 … 없습니다" 빈 목록 안내 → 점선 안내 상자
// 글자·id·버튼은 그대로 두고 감싸기만 하므로 기존 코드(이벤트, id 로 찾기)는 그대로 동작한다.
(function () {
  const TITLE_TIP = 34; // 제목 옆 설명이 이보다 길면 ⓘ 로
  const LABEL_TIP = 44; // 항목 이름 옆 설명
  const BLOCK_FOLD = 90; // 설명 문단이 이보다 길면 접기
  const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";

  function tipify(span) {
    if (!span || span.id || span.closest(".tip") || span.querySelector("[id]")) return;
    const wrap = document.createElement("span");
    wrap.className = "tip";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tip-i";
    btn.textContent = "i";
    btn.setAttribute("aria-label", "설명 보기");
    span.replaceWith(wrap);
    span.classList.add("tip-body");
    wrap.append(btn, span);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll(".tip.open").forEach((t) => t !== wrap && t.classList.remove("open"));
      wrap.classList.toggle("open");
    });
    wrap.addEventListener("mouseenter", () => {
      const r = wrap.getBoundingClientRect();
      wrap.classList.toggle("right", r.left > window.innerWidth * 0.55);
    });
  }

  function foldBlock(el) {
    if (el.id || el.closest(".more-hint") || el.closest("dialog .tip") || el.querySelector("[id]")) return;
    const box = document.createElement("div");
    box.className = "more-hint";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "more-btn";
    btn.textContent = "ⓘ 설명 보기";
    el.replaceWith(box);
    const body = document.createElement("div");
    body.className = "more-body";
    body.append(el);
    box.append(btn, body);
    btn.addEventListener("click", () => {
      box.classList.toggle("open");
      btn.textContent = box.classList.contains("open") ? "ⓘ 설명 접기" : "ⓘ 설명 보기";
    });
  }

  // 제목 h2 마다 그 아래 형제들을 카드로 묶기
  function cardify(section) {
    if (!section || section.dataset.carded) return;
    section.dataset.carded = "1";
    const kids = [...section.children];
    let card = null;
    for (const k of kids) {
      if (k.classList.contains("sticky")) {
        // 화면 아래 고정 막대(설정 저장 등)는 카드 밖에 그대로
        card = null;
        continue;
      }
      if (k.tagName === "H2") {
        card = document.createElement("div");
        card.className = "card";
        k.before(card);
      } else if (!card) {
        if (k.tagName === "SCRIPT" || k.hidden) continue;
        card = document.createElement("div");
        card.className = "card";
        k.before(card);
      }
      card.append(k);
    }
  }

  function numberBadges(root) {
    for (const h of root.querySelectorAll(".wk-box > h3, .card > h2, .set-group > h3")) {
      const first = h.firstChild;
      if (!first || first.nodeType !== 3) continue;
      const t = first.textContent.replace(/^\s+/, "");
      const i = CIRCLED.indexOf(t[0]);
      if (i < 0) continue;
      first.textContent = t.slice(1).replace(/^\s+/, "");
      const n = document.createElement("span");
      n.className = "t-num";
      n.textContent = String(i + 1);
      h.insertBefore(n, h.firstChild);
    }
  }

  function run() {
    if (window.top !== window || /\/ppt\//.test(location.pathname)) document.body.classList.add("inframe");
    for (const id of ["tab-db", "tab-prompt", "tab-settings"]) cardify(document.getElementById(id));
    numberBadges(document);
    // 제목 옆 설명
    for (const h of document.querySelectorAll(".card > h2, .wk-box > h3, .set-group > h3, h2.badge-title")) {
      for (const s of h.querySelectorAll(":scope > .hint")) if (!s.id && s.textContent.trim().length > TITLE_TIP) tipify(s);
    }
    // 항목 이름(label)·체크 옆 설명
    for (const s of document.querySelectorAll("label > span.hint, label.check > span.hint, label.radio > span.hint")) {
      if (!s.id && s.textContent.trim().length > LABEL_TIP) tipify(s);
    }
    // 버튼 줄 옆의 긴 설명
    for (const s of document.querySelectorAll(".buttons > span.hint, .learnbox > span.hint, .recoverbox > span.hint")) {
      if (!s.id && s.textContent.trim().length > LABEL_TIP) tipify(s);
    }
    // 빈 목록 안내
    for (const p of document.querySelectorAll("p.hint[id$='Empty'], p.hint[id$='empty'], p[id$='HistEmpty']")) p.classList.add("empty");
    // 긴 설명 문단 접기
    for (const el of document.querySelectorAll("p.hint, div.hint")) {
      if (el.id || el.classList.contains("empty")) continue;
      if (el.textContent.trim().length > BLOCK_FOLD) foldBlock(el);
    }
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".tip")) document.querySelectorAll(".tip.open").forEach((t) => t.classList.remove("open"));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
