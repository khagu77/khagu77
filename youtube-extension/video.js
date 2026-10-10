// 영상·음성 파일 다운로드 - 화면 (common.js 다음에 넣는다)
// 영상을 유튜브 탭에서 처음부터 재생하며 녹화·녹음하고(video-capture.js), 끝나면 그 탭이 파일을 저장한다.
// 탭을 닫기 전에 다운로드가 끝날 때까지 기다린다.

let running = false;

function mb(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`;
}

// 유튜브 탭이 저장한 파일(blob: 다운로드)이 끝날 때까지 기다린다.
function waitDownload(name, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let id = null;
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(err) {
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      err ? reject(err) : resolve();
    }
    function onCreated(item) {
      if (id === null && item.url.startsWith("blob:https://www.youtube.com/")) id = item.id;
    }
    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") finish(null);
      else if (delta.state.current === "interrupted") finish(new Error(`파일 저장 실패 (${name})`));
    }
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

async function downloadVideo(url, row, kind) {
  const verb = kind === "audio" ? "녹음" : "녹화";
  const videoId = parseYoutubeId(url);
  if (!videoId) throw new Error("유튜브 영상 주소가 아닙니다");
  let duration = 0;
  let saved = null;
  let downloaded = null;

  setRowStatus(row, "유튜브 탭 여는 중…");
  await runInYoutubeTab({
    videoId,
    files: kind === "audio" ? ["lib/lame.min.js", "video-capture.js"] : ["video-capture.js"],
    portName: "video",
    start: { baseName: `${today()}_${videoId}`, kind },
    onMessage(m, port) {
      if (m.type === "info") {
        duration = m.duration;
        setRowTitle(row, m.title);
        // 제목을 알았으니 파일 이름을 다시 알려준다: 20261010_유튜브제목
        port.postMessage({ type: "name", baseName: `${today()}_${safeFileName(m.title) || videoId}` });
      } else if (m.type === "status") {
        setRowStatus(row, m.text);
      } else if (m.type === "needplay") {
        setRowStatus(row, "유튜브 탭에서 재생 버튼(▶)을 한 번 눌러 주세요", "err");
      } else if (m.type === "playing") {
        setRowStatus(row, `${verb} 시작`);
        // 다운로드 감시는 파일이 만들어지기 전에 걸어 둔다
        downloaded = waitDownload(videoId);
        downloaded.catch(() => {});
      } else if (m.type === "progress") {
        setRowStatus(row, `${verb} 중 ${fmtTime(m.t)} / ${fmtTime(duration)} · ${mb(m.size)}`);
      } else if (m.type === "saved") {
        saved = m;
        setRowStatus(row, `파일 저장 중… ${mb(m.size)}`);
        return true;
      }
      return false;
    },
    beforeClose: () => downloaded,
  });
  return saved;
}

// ---------------------------------------------------------------------------
// 빠른 다운로드(영상 .mp4 / 음성 .m4a): Mac 도우미(크롬 Native Messaging, '유튜브 도우미 설치' 앱으로 설치)가
// yt-dlp 로 파일을 바로 받는다. 영상을 재생하지 않는다.
// ---------------------------------------------------------------------------

const HELPER = "com.khagu77.ytdl";
const HELPER_OLD =
  "Mac 도우미가 예전 버전이라 영상 빠른 다운로드를 할 수 없습니다. 새로 받은 폴더의 '유튜브 도우미 설치' 앱을 한 번 더 실행한 뒤 이 화면을 새로고침하세요.";
const isFast = (kind) => kind === "fast" || kind === "fastvideo";
const HELPER_MISSING =
  "Mac 도우미가 설치되어 있지 않습니다. 압축 푼 폴더의 '유튜브 도우미 설치' 앱을 한 번 실행한 뒤 이 화면을 새로고침하세요. " +
  "(처음 열 때 '확인되지 않은 개발자' 안내가 나오면 앱을 오른쪽 클릭 → 열기, " +
  "또는 시스템 설정 → 개인정보 보호 및 보안에서 '그래도 열기')";

let stopFast = null; // 진행 중인 음성 빠른 다운로드를 멈추는 함수

// → { ok, ext } 또는 null(설치 안 됨)
function pingHelper() {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HELPER);
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => done(null), 8000);
    function done(v) {
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {}
      resolve(v);
    }
    port.onMessage.addListener((m) => m.type === "pong" && done(m));
    port.onDisconnect.addListener(() => done(null));
    port.postMessage({ type: "ping" });
  });
}

async function showHelperStatus() {
  const el = $("#helper");
  const kind = $("#kind").value;
  el.hidden = !isFast(kind);
  if (el.hidden) return;
  el.textContent = "Mac 도우미 확인 중…";
  el.className = "hint";
  const r = await pingHelper();
  if (kind !== $("#kind").value) return; // 확인하는 사이 형식을 바꿈
  if (!r || !r.ok) {
    el.textContent = HELPER_MISSING;
    el.className = "hint err";
  } else if (kind === "fastvideo" && !r.video) {
    el.textContent = HELPER_OLD;
    el.className = "hint err";
  } else {
    const ext = kind === "fastvideo" ? "mp4" : r.ext;
    el.textContent = `✔ Mac 도우미가 연결되었습니다. 다운로드 폴더에 날짜_제목.${ext} 로 저장합니다.`;
    el.className = "hint ok";
  }
}

async function fastDownload(urls, kind) {
  const what = kind === "fastvideo" ? "영상" : "음성";
  const rows = urls.map((u, i) => addProgressRow(i, u));
  const jobs = []; // 도우미에게 보낼 영상 (번호 → 줄)
  urls.forEach((u, i) => {
    const id = parseYoutubeId(u);
    if (id) jobs.push({ row: rows[i], url: `https://www.youtube.com/watch?v=${id}`, ok: false });
    else setRowStatus(rows[i], "유튜브 영상 주소가 아닙니다", "err");
  });
  if (!jobs.length) return 0;
  setSummary(`${jobs.length}개 영상의 ${what}을 받는 중…`);
  await new Promise((resolve) => {
    let finished = false;
    const port = chrome.runtime.connectNative(HELPER);
    stopFast = () => {
      finished = true;
      port.disconnect(); // 도우미도 함께 끝난다
      for (const j of jobs) if (!j.ok) setRowStatus(j.row, "중지됨", "err");
      resolve();
    };
    port.onDisconnect.addListener(() => {
      if (!finished) {
        const why = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "";
        const msg = /not found|forbidden/i.test(why) ? HELPER_MISSING : `도우미 연결이 끊겼습니다 ${why}`;
        for (const j of jobs) if (!j.ok) setRowStatus(j.row, msg, "err");
      }
      resolve();
    });
    port.onMessage.addListener((m) => {
      const j = jobs[m.index];
      if (m.type === "updating") setSummary("유튜브 다운로드 도구(yt-dlp)를 최신으로 바꾸는 중… (며칠에 한 번, 1분 안쪽)");
      else if (m.type === "start") {
        setSummary(`${jobs.length}개 영상의 ${what}을 받는 중…`);
        setRowStatus(j.row, "받는 중…");
      } else if (m.type === "title") setRowTitle(j.row, m.title);
      else if (m.type === "progress") setRowStatus(j.row, `받는 중 ${Math.floor(m.percent)}%`);
      else if (m.type === "merging") setRowStatus(j.row, "영상과 소리를 합치는 중…");
      else if (m.type === "saved") {
        j.ok = true;
        setRowStatus(j.row, `완료 · ${m.file.split("/").pop()}`, "ok");
      } else if (m.type === "error") setRowStatus(j.row, `받지 못함: ${m.message}`, "err");
      else if (m.type === "finished") {
        finished = true;
        port.disconnect();
        resolve();
      }
    });
    port.postMessage({ type: "download", kind: kind === "fastvideo" ? "video" : "audio", urls: jobs.map((j) => j.url) });
  });
  stopFast = null;
  return jobs.filter((j) => j.ok).length;
}

async function start() {
  const urls = readUrls();
  if (!urls.length) return setSummary("유튜브 영상 URL을 입력하세요.", "err");
  const kind = $("#kind").value;
  running = true;
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#progress tbody").innerHTML = "";
  let ok = 0;

  if (isFast(kind)) {
    ok = await fastDownload(urls, kind);
    setSummary(
      running
        ? `${ok} / ${urls.length}개 ${kind === "fastvideo" ? "영상" : "음성"} 파일을 다운로드 폴더에 저장했습니다.`
        : "중지했습니다.",
      running && ok ? "ok" : "",
    );
    running = false;
    $("#start").disabled = false;
    $("#stop").disabled = true;
    return;
  }

  for (let i = 0; i < urls.length && running; i++) {
    const row = addProgressRow(i, urls[i]);
    setSummary(`${i + 1} / ${urls.length}번째 영상 ${kind === "audio" ? "녹음" : "녹화"} 중…`);
    try {
      const r = await downloadVideo(urls[i], row, kind);
      setRowStatus(row, `완료 · ${r.name} (${mb(r.size)})`, "ok");
      ok++;
    } catch (e) {
      setRowStatus(row, e.message, "err");
    }
  }

  setSummary(
    running
      ? `${ok} / ${urls.length}개 ${kind === "audio" ? "음성" : "영상"} 파일을 다운로드 폴더에 저장했습니다.`
      : "중지했습니다. 진행 중이던 파일은 저장하지 않았습니다.",
    running ? "ok" : "",
  );
  running = false;
  $("#start").disabled = false;
  $("#stop").disabled = true;
}

menu("video.html");
try {
  $("#kind").value = localStorage.getItem("downloadKind") || "fastvideo";
} catch {}
$("#kind").addEventListener("change", () => {
  try {
    localStorage.setItem("downloadKind", $("#kind").value);
  } catch {}
  showHelperStatus();
});
showHelperStatus();
$("#start").addEventListener("click", start);
$("#stop").addEventListener("click", () => {
  running = false;
  $("#stop").disabled = true;
  if (runInYoutubeTab.abort) runInYoutubeTab.abort();
  if (stopFast) stopFast();
});
