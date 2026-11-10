// GV90 화면 공통 도구 (수집 화면 · 데일리 DB · 대시보드)
//  - 👁 조회수 💬 댓글수 🔥 뱃지 (온라인 오전 일일동향과 같은 규칙: 조회 1,000 이상·댓글 20개 이상·강한 비판이면 빨간색)
//  - 채널·성향 뱃지, 저장 폴더(폴더 선택 창 · 다운로드 하위 폴더 · 매번 묻기), 완료 효과(무지개 받기 버튼·'✔ 완료!'·딩동댕)

const CH_NAME = { news: "언론", youtube: "유튜브", cafe: "동호회", community: "자동차 커뮤니티" };
const CH_CLASS = { 언론: "ch-news", 유튜브: "ch-yt", 동호회: "ch-cafe", "자동차 커뮤니티": "ch-comm" };

function chChip(name) {
  return el("span", { class: `ch ${CH_CLASS[name] || "ch-etc"}`, text: name === "자동차 커뮤니티" ? "커뮤니티" : name || "-" });
}

function sentiChip(s) {
  return el("span", { class: `chip senti ${SENTI_CLASS[s] || "neu"}`, text: s || "-" });
}

// 👁 조회 💬 댓글 🔥 (일일동향 countsBadge 와 같음)
function countsBadge(r) {
  const parts = [];
  if (r.views != null) parts.push(`👁 ${Number(r.views).toLocaleString()}`);
  if (r.ccount != null) parts.push(`💬 ${Number(r.ccount).toLocaleString()}`);
  if (r.harsh) parts.push("🔥");
  if (!parts.length) return null;
  const hot = isHot(r);
  return el("span", { class: `counts${hot ? " hot" : ""}`, title: `조회 ${r.views ?? "-"} · 댓글 ${r.ccount ?? "-"}${r.harsh ? " · 강한 비판·욕설 있음" : ""}`, text: parts.join(" ") });
}

function isHot(r) {
  return !!(r.harsh || r.views >= 1000 || r.ccount >= 20);
}

// "1.2천" · "3만" · "1,234" → 숫자
function parseCount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "");
  const m = s.match(/([\d.]+)\s*(천|만|억|K|M)?/i);
  if (!m) return null;
  const mul = { 천: 1e3, 만: 1e4, 억: 1e8, k: 1e3, m: 1e6 }[(m[2] || "").toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mul);
}

function fmtDay(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// 완료 효과: 받기 버튼 무지개 반짝임(.ready, 누르면 멈춤) + '✔ 완료!' + 딩동댕
// ---------------------------------------------------------------------------

function readyButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle("ready", !!on);
  if (on) btn.disabled = false;
}

async function soundOn() {
  const s = await loadSettings();
  return s.sound !== false;
}

async function celebrate(btn, text = "✔ 완료!") {
  if (btn) Celebrate.done(btn, text);
  if (await soundOn()) Celebrate.ding();
}

// ---------------------------------------------------------------------------
// 저장 위치: 고른 폴더(File System Access, 데일리 DB kv 에 핸들 보관) > 다운로드 폴더(하위 폴더 · 매번 묻기)
// ---------------------------------------------------------------------------

async function getSaveDir() {
  return (await kvGet("saveDir").catch(() => null)) || null;
}

async function pickSaveDir() {
  const handle = await window.showDirectoryPicker({ id: "gv90-save", mode: "readwrite" });
  await kvSet("saveDir", handle);
  return handle;
}

async function clearSaveDir() {
  await kvDelete("saveDir").catch(() => {});
}

// interactive=false(자동 수집): 폴더 허락을 새로 물어야 하면 묻지 않고 다운로드 폴더로
async function saveFile(bytes, name, { interactive = true } = {}) {
  name = cleanFileName(name);
  const s = await loadSettings();
  const dir = await getSaveDir();
  if (dir) {
    try {
      let perm = await dir.queryPermission({ mode: "readwrite" });
      if (perm !== "granted" && interactive) perm = await dir.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        let target = name;
        for (let i = 1; i < 100; i++) {
          try {
            await dir.getFileHandle(target);
            target = name.replace(/(\.xlsx)?$/i, ` (${i})$1`);
          } catch {
            break;
          }
        }
        const fh = await dir.getFileHandle(target, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
        return `'${dir.name}' 폴더에 ${target}`;
      }
    } catch {
      /* 아래 다운로드로 */
    }
  }
  const folder = cleanFolder(s.saveFolder);
  const ask = !!s.saveAsk && interactive;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = await blobToDataUrl(blob);
  try {
    await chrome.downloads.download({ url, filename: folder ? `${folder}/${name}` : name, saveAs: ask, conflictAction: "uniquify" });
  } catch {
    await downloadBytes(bytes, name);
  }
  return ask ? `고른 위치에 ${name}` : `다운로드${folder ? ` / ${folder}` : ""} 폴더에 ${name}`;
}

async function saveWhereText() {
  const s = await loadSettings();
  const dir = await getSaveDir();
  if (dir) return `📁 ${dir.name} 폴더에 바로 저장`;
  return s.saveAsk ? "받을 때마다 저장 위치를 묻습니다" : `크롬 다운로드${cleanFolder(s.saveFolder) ? ` / ${cleanFolder(s.saveFolder)}` : ""} 폴더에 저장`;
}

// 구분 고르기: 한 개 분류 · '모두 포함(…)' 여러 개 (고르면 체크 상자 창)
function categorySelect(value, onPick) {
  const sel = el("select", { class: "cat" });
  const fill = (v) => {
    sel.textContent = "";
    for (const c of CATEGORIES) sel.add(new Option(c, c));
    if (catList(v).length > 1) sel.add(new Option(v, v));
    sel.add(new Option("모두 포함 (여러 개 고르기…)", "__multi"));
    sel.value = v || "일반";
    sel.title = v || "일반";
  };
  fill(value || "일반");
  let cur = value || "일반";
  sel.addEventListener("change", async () => {
    if (sel.value !== "__multi") {
      cur = sel.value;
      fill(cur);
      return onPick(cur);
    }
    const picked = await pickCategories(sel, catList(cur));
    if (picked) {
      cur = catJoin(picked);
      onPick(cur);
    }
    fill(cur);
  });
  return sel;
}

function pickCategories(anchor, current) {
  document.querySelector(".cat-pop")?.remove();
  return new Promise((resolve) => {
    const boxes = CATEGORIES.filter((c) => c !== "일반").map((c) => el("label", {}, [el("input", { type: "checkbox", value: c, checked: current.includes(c) }), ` ${c}`]));
    const preview = el("div", { class: "hint" });
    const upd = () => (preview.textContent = `→ ${catJoin(boxes.map((b) => b.firstChild).filter((i) => i.checked).map((i) => i.value))}`);
    boxes.forEach((b) => b.firstChild.addEventListener("change", upd));
    upd();
    const close = (v) => {
      pop.remove();
      document.removeEventListener("mousedown", outside, true);
      resolve(v);
    };
    const ok = el("button", { class: "small primary", text: "확인", onclick: () => close(boxes.map((b) => b.firstChild).filter((i) => i.checked).map((i) => i.value)) });
    const cancel = el("button", { class: "small", text: "취소", onclick: () => close(null) });
    const pop = el("div", { class: "cat-pop" }, [el("b", { text: "다룬 구분 (여러 개)" }), ...boxes, preview, el("div", { class: "buttons" }, [ok, cancel])]);
    const outside = (e) => {
      if (!pop.contains(e.target)) close(null);
    };
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 4}px`;
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left - 60, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8))}px`;
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  });
}

// 위쪽 띠 버전 표시
document.addEventListener("DOMContentLoaded", () => {
  const v = document.getElementById("ver");
  if (v) v.textContent = `v${chrome.runtime.getManifest().version}`;
});

// ---------------------------------------------------------------------------
// 예상 소요 시간: 진행 막대에 '남은 시간 · 경과'를 붙인다 (모든 작업 공통)
//  - 같은 단계(진행 막대 글자의 숫자 앞부분이 같음) 안에서 실제 걸린 속도로 남은 시간을 계산
//  - 단계가 바뀌거나 처음부터 다시 세면 새로 잼
// ---------------------------------------------------------------------------

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `약 ${Math.max(5, Math.round(sec / 5) * 5)}초`;
  if (sec < 3600) return `약 ${Math.round(sec / 60)}분`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `약 ${h}시간${m ? ` ${m}분` : ""}`;
}

let etaPhase = null; // { key, start, total, lastDone }
let workStartedAt = 0;
let workPlanSec = 0; // 시작할 때 계산한 전체 예상 시간 (초)

// 작업 시작: 전체 예상 시간을 정해 두면 진행 막대에 '전체 예상 N분'도 함께 보임
function startWorkClock(planSec = 0) {
  workStartedAt = Date.now();
  workPlanSec = planSec;
  etaPhase = null;
}

if (typeof showWork === "function") {
  const baseShowWork = showWork;
  const baseHideWork = hideWork;
  showWork = function (text, done = 0, total = 0) {
    const now = Date.now();
    if (!workStartedAt) workStartedAt = now;
    const key = String(text).replace(/\d[\s\S]*$/, "").trim();
    if (!etaPhase || etaPhase.key !== key || etaPhase.total !== total || done < etaPhase.lastDone) etaPhase = { key, start: now, total, lastDone: done, startDone: done };
    etaPhase.lastDone = done;
    const parts = [];
    const doneHere = done - etaPhase.startDone;
    const elapsed = (now - workStartedAt) / 1000;
    if (total && doneHere > 0) parts.push(`이 단계 남은 시간 ${fmtDur(((now - etaPhase.start) / 1000 / doneHere) * (total - done))}`);
    if (workPlanSec) {
      const left = workPlanSec - elapsed;
      parts.push(left > 30 ? `전체 예상 ${fmtDur(workPlanSec)} (남은 시간 ${fmtDur(left)})` : `전체 예상 ${fmtDur(workPlanSec)} (거의 끝나 감)`);
    }
    if (elapsed >= 30) parts.push(`경과 ${fmtDur(elapsed).replace(/^약 /, "")}`);
    baseShowWork(parts.length ? `${text} · ${parts.join(" · ")}` : text, done, total);
  };
  hideWork = function () {
    etaPhase = null;
    workStartedAt = 0;
    workPlanSec = 0;
    baseHideWork();
  };
}
