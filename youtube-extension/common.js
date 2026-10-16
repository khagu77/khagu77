// 스크립트 추출·영상 파일 다운로드 화면이 함께 쓰는 도구

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");

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

function readUrls() {
  return $("#urls")
    .value.split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 65 → "01:05", 3723 → "1:02:03"
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function safeFileName(s) {
  return (s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/\.+$/, "").slice(0, 80);
}

function setSummary(text, cls = "") {
  $("#summary").textContent = text;
  $("#summary").className = `summary ${cls}`;
}

function addProgressRow(index, url) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${index + 1}</td><td class="url"></td><td class="status">대기</td><td class="actions"></td>`;
  // 주소는 눌러서 새 탭으로 열 수 있게
  const link = document.createElement("a");
  link.href = /^https?:\/\//i.test(url) ? url : "#";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = url;
  tr.querySelector(".url").appendChild(link);
  $("#progress tbody").appendChild(tr);
  $("#progress").hidden = false;
  return tr;
}

function setRowTitle(row, title) {
  let el = row.querySelector(".title");
  if (!el) {
    el = document.createElement("span");
    el.className = "title";
    row.querySelector(".url").appendChild(el);
  }
  el.textContent = title;
}

function setRowStatus(row, text, cls = "") {
  const td = row.querySelector(".status");
  td.textContent = text;
  td.className = `status ${cls}`;
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
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
  });
}

// 유튜브 영상을 새 탭으로 열고 영상 탭 안에 files 를 넣은 뒤 port 로 연결해 start 를 보낸다.
// onMessage(m, port, tabId) 가 true 를 돌려주면 끝, error 메시지를 받으면 실패.
// beforeClose 까지 기다린 뒤 탭을 닫는다. 진행 중에는 runInYoutubeTab.abort() 로 중지한다.
async function runInYoutubeTab({ videoId, files, portName, start, mute, highQuality, onMessage, beforeClose }) {
  const tab = await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: true });
  let port = null;
  try {
    await waitTabComplete(tab.id);
    if (mute) await chrome.tabs.update(tab.id, { muted: true });
    if (highQuality) {
      // 글자가 잘 보이도록 가능한 높은 화질로 재생해 달라고 유튜브 플레이어에 요청한다.
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => {
            const p = document.getElementById("movie_player");
            try {
              if (p && p.setPlaybackQualityRange) p.setPlaybackQualityRange("hd1080", "hd1080");
            } catch {}
          },
        })
        .catch(() => {});
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture-common.js", "caption-mask.js", ...files] });
    await new Promise((resolve, reject) => {
      runInYoutubeTab.abort = () => reject(new Error("중지됨"));
      port = chrome.tabs.connect(tab.id, { name: portName });
      port.onDisconnect.addListener(() => reject(new Error("유튜브 탭이 닫혔습니다")));
      port.onMessage.addListener((m) => {
        try {
          if (m.type === "error") reject(new Error(m.message));
          else if (onMessage(m, port, tab.id)) resolve();
        } catch (e) {
          reject(e);
        }
      });
      port.postMessage({ type: "start", ...start });
    });
    if (beforeClose) await beforeClose();
  } finally {
    runInYoutubeTab.abort = null;
    if (port) port.disconnect();
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
runInYoutubeTab.abort = null;

function menu(active) {
  const nav = document.createElement("nav");
  nav.className = "menu";
  for (const [href, label] of [
    ["script.html", "스크립트 추출"],
    ["video.html", "영상·음성 파일 다운로드"],
    ["review.html", "스크립트 AI 검열"],
  ]) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (href === active) a.className = "active";
    nav.appendChild(a);
  }
  $("h1").after(nav);
}

// 파일 받기: blob: 주소 대신 data: 주소로 받는다.
// (blob: 로 받으면 크롬이 맥 파일 정보 '출처'에 chrome-extension://… 주소를 남기는데, data: 주소는 출처를 남기지 않음)
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// 맥: 받은 파일의 '출처' 정보는 백그라운드(meta-clean.js)가 빠른다운로드 도우미로 지운다.
// 받기 전에 파일 이름을 적어 두고, 처리 결과(lastClean)를 화면 아래 알림으로 보여준다.
async function registerClean(name) {
  try {
    const { pendingClean = [] } = await chrome.storage.session.get("pendingClean");
    const now = Date.now();
    await chrome.storage.session.set({ pendingClean: [...pendingClean.filter((p) => p.until > now), { name, until: now + 10 * 60e3 }] });
  } catch {
    /* 무시 */
  }
}

const CLEAN_NOTICE = {
  ok: "✔ 받은 파일의 '출처' 정보를 지웠습니다.",
  old: "⚠ 빠른다운로드 도우미가 예전 버전이라 '출처' 정보를 지우지 못했습니다. 유튜브추출기 압축 안의 '빠른다운로드_도우미설치.app'을 한 번 다시 실행해 주세요.",
  none: "⚠ 빠른다운로드 도우미가 없어 '출처' 정보를 지우지 못했습니다. 유튜브추출기 압축 안의 '빠른다운로드_도우미설치.app'을 실행하면 다음부터 자동으로 지웁니다.",
  refused: "⚠ '출처' 정보를 지우지 못했습니다(내 폴더 밖에 저장된 파일).",
  error: "⚠ '출처' 정보를 지우는 중 오류가 났습니다.",
};

function showCleanNotice(r) {
  let box = document.getElementById("cleanNotice");
  if (!box) {
    box = document.createElement("div");
    box.id = "cleanNotice";
    box.style.cssText =
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:min(720px,92vw);padding:9px 14px;border-radius:8px;" +
      "font-size:13px;line-height:1.45;box-shadow:0 2px 10px rgba(0,0,0,.25);z-index:9999;color:#fff;";
    document.body.appendChild(box);
  }
  box.style.background = r.ok ? "#1e8e3e" : "#b3261e";
  box.textContent = `${CLEAN_NOTICE[r.ok ? "ok" : r.reason] || CLEAN_NOTICE.error} (${r.name})`;
  clearTimeout(box._t);
  box._t = setTimeout(() => box.remove(), r.ok ? 6000 : 20000);
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.lastClean?.newValue) showCleanNotice(changes.lastClean.newValue);
  });
}

async function clickDownload(blob, name) {
  await registerClean(name);
  const a = document.createElement("a");
  a.href = await blobToDataUrl(blob);
  a.download = name;
  a.rel = "noreferrer";
  a.referrerPolicy = "no-referrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
