// 엑셀 내려받기 (ExcelJS · 사이트에 함께 올린 파일) — 항목·순서·서체를 골라 저장해 두고 그 양식으로 내려받음
import { CH, SENT, fmtTime, toast, esc, modal, sourceName } from "./ui.js";

const COMMUNITY = new Set(["bobae", "clien", "ppomppu"]);
const GROUP = { news: "언론", cafe: "동호회", blog: "블로그", post: "블로그", youtube: "유튜브", instagram: "인스타그램" };
const n = (v) => (typeof v === "number" ? v : "");

// 고를 수 있는 항목 (key · 머리글 · 열 너비 · 값)
export const FIELDS = [
  { k: "no", t: "연번", w: 6, v: (p, i) => i + 1 },
  { k: "group", t: "카테고리", w: 13, v: (p) => (COMMUNITY.has(p.channel) ? "자동차 커뮤니티" : GROUP[p.channel] || CH[p.channel]?.name || p.channel) },
  { k: "source", t: "채널명", w: 20, v: (p) => (COMMUNITY.has(p.channel) ? CH[p.channel].name : sourceName(p) || p.source || CH[p.channel]?.name || "") },
  { k: "board", t: "게시판", w: 18, v: (p) => (COMMUNITY.has(p.channel) ? p.source || "" : "") },
  { k: "posted", t: "작성일", w: 17, v: (p) => (p.postedAt ? fmtTime(p.postedAt, true) : p.postedDay || "") },
  { k: "collected", t: "수집일", w: 17, v: (p) => fmtTime(p.collectedAt, true) },
  { k: "title", t: "제목", w: 60, v: (p) => p.title || "" },
  { k: "url", t: "URL", w: 45, v: (p) => p.url || "", link: true },
  { k: "views", t: "조회수", w: 9, v: (p) => n(p.views) },
  { k: "comments", t: "댓글수", w: 9, v: (p) => n(p.comments) },
  { k: "likes", t: "좋아요", w: 9, v: (p) => n(p.likes) },
  { k: "sent", t: "성향", w: 9, v: (p) => SENT[p.sentiment]?.name || "" },
  { k: "sentBy", t: "성향 판단", w: 11, v: (p) => (p.sentimentBy === "rule" ? "규칙" : p.sentimentBy === "manual" ? "담당자" : p.sentimentBy ? `AI(${p.sentimentBy})` : "") },
  { k: "reason", t: "판단 근거", w: 28, v: (p) => p.sentimentReason || "" },
  { k: "kw", t: "검색 키워드", w: 24, v: (p) => (p.kw || []).join(", ") || p.query || "" },
  { k: "grp", t: "키워드 그룹", w: 22, v: (p, i, ctx) => (p.kwGroups || []).map((g) => ctx.grpNames[g] || g).join(", ") },
  { k: "cats", t: "시스템 카테고리", w: 22, v: (p, i, ctx) => (p.cats || []).filter((c) => c !== "all").map((c) => ctx.catNames[c] || c).join(", ") },
  { k: "issue", t: "이슈 여부", w: 9, v: (p) => (p.isIssue || p.must ? "이슈" : "") },
  { k: "short", t: "숏츠", w: 7, v: (p) => (p.channel === "youtube" ? (p.short ? "숏츠" : "") : "") },
  { k: "dup", t: "유사 기사 수", w: 10, v: (p) => p.dupCount || "" },
  { k: "alerted", t: "카톡 발송", w: 17, v: (p) => (p.alerted ? fmtTime(p.alertedAt, true) : "") },
  { k: "star", t: "중요", w: 6, v: (p) => (p.star ? "★" : "") },
  { k: "memo", t: "메모", w: 24, v: (p) => p.memo || "" },
  { k: "desc", t: "내용", w: 60, v: (p) => p.desc || "" },
];
const BY = Object.fromEntries(FIELDS.map((f) => [f.k, f]));
export const DEFAULT_FORM = { cols: ["no", "group", "source", "posted", "title", "url", "views", "comments", "sent", "kw"], font: "Hyundai Sans Text KR", size: 10 };

const LS = "hdmon-excel-form";
function loadForm(settings) {
  let f = null;
  try { f = JSON.parse(localStorage.getItem(LS) || "null"); } catch {}
  f ||= settings?.excelForm || DEFAULT_FORM;
  const cols = (f.cols || []).filter((k) => BY[k]);
  return { cols: cols.length ? cols : DEFAULT_FORM.cols, font: f.font || DEFAULT_FORM.font, size: +f.size || DEFAULT_FORM.size };
}

// 양식 고르기 창: 체크로 넣고 빼기 · ↑↓ 로 순서 · 서체
async function pickForm(store, count) {
  const form = loadForm(store.settings);
  const order = [...form.cols, ...FIELDS.map((f) => f.k).filter((k) => !form.cols.includes(k))];
  const on = new Set(form.cols);
  const row = (k) => `<div class="xf-row ${on.has(k) ? "on" : ""}" data-k="${k}"><label><input type="checkbox" ${on.has(k) ? "checked" : ""}> ${esc(BY[k].t)}</label><span><button type="button" class="btn sm ghost" data-up title="위로">↑</button><button type="button" class="btn sm ghost" data-dn title="아래로">↓</button></span></div>`;
  const pr = modal(`엑셀 내려받기 · ${count.toLocaleString()}건`, `
    <p class="hint" style="margin:0 0 8px">넣을 항목을 체크하고 ↑↓ 로 순서를 정하세요. 체크한 순서대로 열이 만들어집니다.</p>
    <div class="xf-list" id="xfList">${order.map(row).join("")}</div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <label class="field" style="flex:1;min-width:200px">서체 (엑셀을 여는 PC에 설치된 이름)<input class="input" id="xfFont" value="${esc(form.font)}" list="xfFonts"></label>
      <datalist id="xfFonts"><option value="Hyundai Sans Text KR"><option value="현대산스 Text"><option value="Hyundai Sans Text"><option value="맑은 고딕"></datalist>
      <label class="field" style="width:90px">글자 크기<input class="input" id="xfSize" type="number" min="7" max="20" value="${form.size}"></label>
    </div>
    <label class="toggle-row" style="margin-top:8px"><input type="checkbox" id="xfSave" checked> 이 양식을 이 컴퓨터에 저장 (다음에도 이대로)</label>
    ${store.isAdmin?.() ? `<label class="toggle-row"><input type="checkbox" id="xfShare"> 모든 사용자의 기본 양식으로 저장 (관리자)</label>` : ""}
    <button type="button" class="btn sm ghost" id="xfReset" style="margin-top:6px">기본 양식으로 되돌리기</button>`, { ok: "내려받기", wide: true });
  const body = [...document.querySelectorAll(".modal-back .mbody")].pop();
  const list = body.querySelector("#xfList");
  list.addEventListener("click", (e) => {
    const r = e.target.closest(".xf-row");
    if (!r) return;
    if (e.target.closest("[data-up]") && r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling);
    if (e.target.closest("[data-dn]") && r.nextElementSibling) r.parentNode.insertBefore(r.nextElementSibling, r);
  });
  list.addEventListener("change", (e) => { const r = e.target.closest(".xf-row"); r?.classList.toggle("on", e.target.checked); });
  body.querySelector("#xfReset").onclick = () => {
    on.clear();
    DEFAULT_FORM.cols.forEach((c) => on.add(c));
    list.innerHTML = [...DEFAULT_FORM.cols, ...FIELDS.map((f) => f.k).filter((k) => !on.has(k))].map(row).join("");
    body.querySelector("#xfFont").value = DEFAULT_FORM.font;
    body.querySelector("#xfSize").value = DEFAULT_FORM.size;
  };
  const res = await pr;
  if (!res) return null;
  const out = {
    cols: [...res.querySelectorAll(".xf-row")].filter((r) => r.querySelector("input").checked).map((r) => r.dataset.k),
    font: res.querySelector("#xfFont").value.trim() || DEFAULT_FORM.font,
    size: Math.min(20, Math.max(7, +res.querySelector("#xfSize").value || DEFAULT_FORM.size)),
  };
  if (!out.cols.length) { toast("항목을 하나 이상 고르세요", "err"); return null; }
  if (res.querySelector("#xfSave").checked) try { localStorage.setItem(LS, JSON.stringify(out)); } catch {}
  if (res.querySelector("#xfShare")?.checked) {
    try { await store.be.saveSettings({ excelForm: out }); try { localStorage.removeItem(LS); } catch {} toast("모든 사용자의 기본 양식으로 저장했습니다"); } catch (e) { toast(e.message, "err"); }
  }
  return out;
}

let loading;
function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return (loading ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "/vendor/exceljs.min.js";
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => { loading = null; no(new Error("엑셀 도구를 불러오지 못했습니다")); };
    document.head.append(s);
  }));
}

export async function exportExcel(posts, catName, store) {
  if (!posts.length) return toast("내려받을 글이 없습니다", "err");
  const [form, ExcelJS] = await Promise.all([pickForm(store, posts.length), loadExcelJs()]);
  if (!form) return;
  const settings = store.settings || {};
  const ctx = {
    catNames: Object.fromEntries((settings.categories || []).map((c) => [c.id, c.name])),
    grpNames: Object.fromEntries((settings.keywordGroups || settings.groups || []).map((g) => [g.id, g.name])),
  };
  const cols = form.cols.map((k) => BY[k]);
  const font = { name: form.font, size: form.size };
  const wb = new ExcelJS.Workbook();
  wb.creator = "온라인 이슈 모니터링";
  const ws = wb.addWorksheet("게시물", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((f) => ({ header: f.t, key: f.k, width: f.w }));
  posts.forEach((p, i) => {
    const r = ws.addRow(cols.map((f) => f.v(p, i, ctx)));
    cols.forEach((f, ci) => {
      const c = r.getCell(ci + 1);
      c.font = font;
      c.alignment = { vertical: "middle", wrapText: f.k === "title" || f.k === "desc" || f.k === "reason" };
      if (f.link && c.value) { c.value = { text: String(c.value), hyperlink: String(c.value) }; c.font = { ...font, color: { argb: "FF1F5FBF" }, underline: true }; }
    });
  });
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((c) => {
    c.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002C5F" } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const buf = await wb.xlsx.writeBuffer();
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `${ymd}_${catName.replace(/[\\/:*?"<>|()\s]+/g, "_")}_게시물_${posts.length}건.xlsx`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`엑셀 ${posts.length}건을 내려받았습니다`);
}
