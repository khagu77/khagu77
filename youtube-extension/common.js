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

// 맥: 받은 파일의 '출처'(다운로드한 곳) 정보를 빠른다운로드 도우미로 지운다.
// 크롬은 내려받은 파일마다 받은 곳(chrome-extension://…)을 남기고 확장프로그램이 이를 막을 방법이 없어,
// 저장이 끝난 뒤 도우미가 그 정보만 지운다. 도우미가 없거나 맥이 아니면 아무것도 하지 않는다.
const META_HELPER = "com.khagu77.ytdl";
const IS_MAC = /Mac/i.test(navigator.userAgent) || !!globalThis.__forceCleanMeta;

function cleanWhereFrom(filename) {
  const bytes = new TextEncoder().encode(filename);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return chrome.runtime.sendNativeMessage(META_HELPER, { action: "cleanmeta", b64: btoa(s) }).catch(() => null);
}

// name 으로 막 받은 파일을 찾아, 저장이 끝나면 출처 정보를 지운다 (최대 2분 기다림)
async function cleanAfterDownload(name, startedAfter) {
  if (!IS_MAC || !chrome.downloads?.search) return;
  const stem = name.replace(/\.[^.]+$/, "");
  const ext = name.slice(stem.length);
  const base = (p) => String(p).split(/[\\/]/).pop();
  const matches = (item) => {
    const b = base(item.filename || "");
    return b === name || (b.startsWith(stem) && b.endsWith(ext) && /^ \(\d+\)$/.test(b.slice(stem.length, b.length - ext.length)));
  };
  for (let i = 0; i < 120; i++) {
    const items = await chrome.downloads.search({ startedAfter, orderBy: ["-startTime"] }).catch(() => []);
    const item = items.find(matches);
    if (item?.state === "complete") return cleanWhereFrom(item.filename);
    if (item?.state === "interrupted") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function clickDownload(blob, name) {
  const startedAfter = new Date(Date.now() - 2000).toISOString();
  const a = document.createElement("a");
  a.href = await blobToDataUrl(blob);
  a.download = name;
  a.rel = "noreferrer";
  a.referrerPolicy = "no-referrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  cleanAfterDownload(name, startedAfter);
}
