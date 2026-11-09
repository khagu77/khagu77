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

// 위쪽 띠 버전 표시
document.addEventListener("DOMContentLoaded", () => {
  const v = document.getElementById("ver");
  if (v) v.textContent = `v${chrome.runtime.getManifest().version}`;
});
