import { siteOf } from "./shared/site.js";
// 화면 공용 도구: 요소 만들기 · 토스트 · 모달 · 숫자 카운트업 · 시간 표시 · 채널/성향 정보
export const CH = {
  news: { name: "언론", short: "언", color: "--s1" },
  cafe: { name: "동호회", short: "N", color: "--s6" },
  blog: { name: "블로그", short: "B", color: "--s3" },
  post: { name: "포스트", short: "P", color: "--s3" },
  youtube: { name: "유튜브", short: "▶", color: "--s8" },
  bobae: { name: "보배드림", short: "보", color: "--s2" },
  clien: { name: "클리앙", short: "C", color: "--s7" },
  ppomppu: { name: "뽐뿌", short: "뽐", color: "--s5" },
};
export const CH_ORDER = ["news", "cafe", "blog", "youtube", "bobae", "clien", "ppomppu", "post"];
export const SENT = {
  pos: { name: "긍정", cls: "b-pos", color: "--pos" },
  neu: { name: "중립", cls: "b-neu", color: "--neu" },
  neg: { name: "부정", cls: "b-neg", color: "--neg" },
  abuse: { name: "단순비난", cls: "b-abuse", color: "--abuse" },
};
export const SENT_ORDER = ["neg", "abuse", "neu", "pos"];
export const ROLE = { admin: "관리자", editor: "담당자", viewer: "열람자" };
export const STATUS = { active: "사용", pending: "승인 대기", disabled: "중지" };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// 채널 아이콘: 언론은 언론사 로고, 보배드림·클리앙·뽐뿌는 사이트 로고 (못 불러오면 글자 아이콘)
const SITE_LOGO = { bobae: "bobaedream.co.kr", clien: "clien.net", ppomppu: "ppomppu.co.kr" };
export const logoSite = (ch, p) => SITE_LOGO[ch] || (ch === "news" && p ? p.site || siteOf({ channel: "news", url: p.url, extUrl: p.extUrl }) : null);
export const chIcon = (ch, small = false, p = null) => {
  const site = logoSite(ch, p);
  const size = small ? ' style="width:22px;height:22px;font-size:10px;border-radius:6px"' : "";
  const title = esc(ch === "news" && p?.source ? p.source : CH[ch]?.name || ch);
  if (!site) return `<span class="ch-ico ch-${esc(ch)}"${size} title="${title}">${esc(CH[ch]?.short || "?")}</span>`;
  return `<span class="ch-ico ch-${esc(ch)} logo"${size} title="${title}">${esc(CH[ch]?.short || "?")}<img alt="" loading="lazy" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64" onerror="this.remove()"></span>`;
};
export const sentBadge = (s, by) => {
  const m = SENT[s] || SENT.neu;
  return `<span class="badge ${m.cls}">${m.name}${by && by !== "rule" && by !== "manual" ? " · AI" : ""}</span>`;
};

export const toDate = (t) => (t ? (t.toDate ? t.toDate() : t instanceof Date ? t : new Date(t.seconds ? t.seconds * 1000 : t)) : null);
const pad = (n) => String(n).padStart(2, "0");
export function fmtTime(t, withYear = false) {
  const d = toDate(t);
  if (!d) return "";
  return `${withYear ? `${d.getFullYear()}-` : ""}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function ago(t) {
  const d = toDate(t);
  if (!d) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtNum = (n) => Number(n || 0).toLocaleString("ko-KR");

// 숫자가 촤라락 올라가는 효과
export function countUp(el, to, { dur = 1100, suffix = "", decimals = 0 } = {}) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  function fmt(v) { return (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("ko-KR")) + suffix; }
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

let toastBox;
export function toast(msg, type = "ok", ms = 3200) {
  if (!toastBox) { toastBox = h(`<div class="toasts"></div>`); document.body.append(toastBox); }
  const t = h(`<div class="toast ${type}"><span>${type === "err" ? "⚠️" : type === "ok" ? "✅" : "ℹ️"}</span><span>${esc(msg)}</span></div>`);
  toastBox.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
}

export function modal(title, bodyHtml, { ok = "확인", cancel = "취소", danger = false, wide = false } = {}) {
  return new Promise((resolve) => {
    const back = h(`<div class="modal-back"><div class="modal" style="${wide ? "max-width:760px" : ""}"><h3>${esc(title)}</h3><div class="mbody">${bodyHtml}</div>
      <div class="foot">${cancel ? `<button class="btn" data-x>${esc(cancel)}</button>` : ""}<button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(ok)}</button></div></div></div>`);
    const close = (v) => { back.style.animation = "fadeIn .2s reverse both"; setTimeout(() => back.remove(), 180); resolve(v); };
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-x]")) close(null); });
    back.querySelector("[data-ok]").addEventListener("click", () => close(back.querySelector(".mbody")));
    document.body.append(back);
    back.querySelector("input,textarea,select")?.focus();
  });
}
export const confirmBox = async (msg, ok = "확인", danger = false) => !!(await modal("확인", `<p>${esc(msg)}</p>`, { ok, danger }));

// 버튼 물결 효과
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn");
  if (!b) return;
  const r = b.getBoundingClientRect();
  const s = Math.max(r.width, r.height);
  const rp = h(`<span class="ripple" style="width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px"></span>`);
  b.append(rp);
  setTimeout(() => rp.remove(), 600);
});

// 버튼 누르는 동안 로딩 표시
export async function busy(btn, fn) {
  btn.classList.add("loading");
  btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove("loading"); btn.disabled = false; }
}

// 슬라이딩 표시줄이 있는 세그먼트 버튼
export function segmented(container, onChange) {
  const ind = h(`<span class="seg-ind"></span>`);
  container.prepend(ind);
  const move = () => {
    const on = container.querySelector("button.on");
    if (!on) return;
    ind.style.left = `${on.offsetLeft}px`;
    ind.style.width = `${on.offsetWidth}px`;
  };
  container.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    container.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    move();
    onChange?.(b.dataset.v);
  });
  requestAnimationFrame(move);
  return move;
}

export function tabsIndicator(tabs) {
  let ind = tabs.querySelector(".tab-ind");
  if (!ind) { ind = h(`<span class="tab-ind"></span>`); tabs.append(ind); }
  const on = tabs.querySelector("button.on");
  if (on) { ind.style.left = `${on.offsetLeft}px`; ind.style.width = `${on.offsetWidth}px`; }
}

export function highlight(text, words) {
  let s = esc(text);
  const ws = [...new Set(words.filter((w) => w && w.length >= 1))].sort((a, b) => b.length - a.length).slice(0, 12);
  for (const w of ws) {
    const re = new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    s = s.replace(re, (m) => `\u0001${m}\u0002`);
  }
  return s.replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");
}

export const cafeSearchUrl = (title) => `https://search.naver.com/search.naver?ssc=tab.cafe.all&query=${encodeURIComponent(title)}`;
