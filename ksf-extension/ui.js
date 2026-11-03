// 화면 안 확인 상자: 크롬은 보고 있지 않은 탭(뒤쪽 탭·다른 창)의 confirm()/alert() 창을 막고 '취소'로 처리한다.
// 오래 걸리는 작업 중에 다른 탭을 보고 있으면 확인 창이 막혀 작업이 멈추므로, 화면 안에 상자를 띄우고 답할 때까지 기다린다.
// (기다리는 동안 탭 제목에 '❓ 확인 필요' 표시)

// → Promise<boolean> (확인: true · 취소: false). okOnly 면 확인 버튼만.
function askConfirm(message, { ok = "확인", cancel = "취소", okOnly = false } = {}) {
  if (globalThis.__seatAutoConfirm) {
    // 자동 시험용: 물어본 내용만 남기고 바로 확인
    (globalThis.__seatAsked ||= []).push(message);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "ask-back";
    back.innerHTML =
      '<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-text"></div>' +
      '<div class="buttons"><button class="primary ask-ok"></button><button class="ask-cancel"></button></div></div>';
    back.querySelector(".ask-text").textContent = message;
    back.querySelector(".ask-ok").textContent = ok;
    const cancelBtn = back.querySelector(".ask-cancel");
    cancelBtn.textContent = cancel;
    cancelBtn.hidden = okOnly;
    const title = document.title;
    document.title = `❓ 확인 필요 - ${title}`;
    const done = (v) => {
      back.remove();
      document.title = title;
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(okOnly);
      } else if (e.key === "Enter") {
        e.preventDefault();
        done(true);
      }
    };
    back.querySelector(".ask-ok").addEventListener("click", () => done(true));
    cancelBtn.addEventListener("click", () => done(false));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    back.querySelector(".ask-ok").focus();
  });
}

function askAlert(message) {
  return askConfirm(message, { okOnly: true });
}

// ---------------------------------------------------------------------------
// 저장 폴더: '폴더 선택'으로 고른 폴더(File System Access)에 엑셀·백업을 바로 저장한다.
// 고른 폴더는 이 PC 크롬(IndexedDB)에 기억하고, 고르지 않았거나 쓸 수 없으면 크롬 다운로드 폴더로 받는다.
// 크롬 보안상 화면에는 폴더 이름만 보이고, 크롬을 새로 켠 뒤 처음 저장할 때 허용을 한 번 물을 수 있다.
// ---------------------------------------------------------------------------

function folderDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("seatFolder", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function folderKv(mode, fn) {
  const db = await folderDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function getSaveFolder() {
  try {
    return (await folderKv("readonly", (s) => s.get("save"))) || null;
  } catch {
    return null;
  }
}

async function setSaveFolder(handle) {
  await folderKv("readwrite", (s) => (handle ? s.put(handle, "save") : s.delete("save")));
}

// 저장 버튼을 누른 바로 그때(사용자 동작 안에서) 폴더 쓰기 허용을 확인·요청해 둔다 → saveBytes 가 이어서 씀
let folderReady = null;
function prepareFolder() {
  folderReady = (async () => {
    const h = await getSaveFolder();
    if (!h) return null;
    let p = await h.queryPermission({ mode: "readwrite" });
    if (p !== "granted") p = await h.requestPermission({ mode: "readwrite" });
    return p === "granted" ? h : null;
  })().catch(() => null);
  return folderReady;
}

// 고른 폴더에 저장 (안 되면 다운로드 폴더) → 저장한 곳 설명 글자
async function saveBytes(data, name) {
  const h = await (folderReady || prepareFolder());
  folderReady = null;
  if (h) {
    try {
      const fh = await h.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      return `📁 ${h.name} 폴더`;
    } catch {
      /* 아래 다운로드로 */
    }
  }
  if (data instanceof Blob) await clickDownload(data, name);
  else await downloadBytes(data, name);
  return `${saveWhereText(await saveOptions())}${(await getSaveFolder()) ? " (고른 폴더에 쓰지 못해 다운로드 폴더로)" : ""}`;
}

async function renderSaveFolder() {
  const box = document.getElementById("folderName");
  if (!box) return;
  const h = await getSaveFolder();
  box.textContent = h ? `📁 ${h.name}` : "크롬 다운로드 폴더";
  box.className = `folder-name ${h ? "on" : ""}`;
  const clear = document.getElementById("clearFolder");
  if (clear) clear.hidden = !h;
}

async function pickSaveFolder() {
  if (!window.showDirectoryPicker) return askAlert("이 크롬에서는 폴더 선택을 쓸 수 없습니다. 크롬을 최신 버전으로 업데이트해 주세요.");
  try {
    const h = await window.showDirectoryPicker({ id: "seatSave", mode: "readwrite" });
    await setSaveFolder(h);
  } catch (e) {
    if (e?.name !== "AbortError") askAlert(`폴더를 고르지 못했습니다: ${e?.message || e}`);
  }
  renderSaveFolder();
}

async function clearSaveFolder() {
  await setSaveFolder(null);
  renderSaveFolder();
}

// ---------------------------------------------------------------------------
// AI 비용 (수집 화면 · 데이터 DB 화면이 함께 씀)
// ---------------------------------------------------------------------------

const AI_PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] }; // 100만 토큰당 달러 (입력, 출력)
const WON_PER_USD = 1400;

function aiWonExact(input, output, model) {
  const [inP, outP] = AI_PRICE[model] || AI_PRICE["claude-opus-5-5"];
  return ((input * inP + output * outP) / 1e6) * WON_PER_USD;
}

// "약 1,234원 ($0.88)"
function fmtWon(won) {
  const w = Math.max(0, Number(won) || 0);
  return `약 ${Math.round(w).toLocaleString()}원 ($${(w / WON_PER_USD).toFixed(2)})`;
}

// 비용 기록(1.0.8) 전에 AI 를 쓴 글의 비용 추정: AI 요약했는데 기록이 없는 글 · AI 1차 검토했는데 기록이 없는 글
function estimateUntrackedWon(items, model) {
  let won = 0;
  let posts = 0;
  for (const x of items) {
    if (x.aiCost) continue;
    let w = 0;
    if (x.by === "ai") w += aiWonExact(Math.min(4000, (x.body || x.text || "").length) + (x.title || "").length + 300 + 1500 / 6, 160, model);
    if (x.aiScreen) w += aiWonExact((x.title || "").length + Math.min(400, (x.text || "").length) + 60 + 900 / 40, 30, model);
    if (w) {
      won += w;
      posts++;
    }
  }
  return { won, posts };
}
