// 영상 파일 다운로드 - 화면 (common.js 다음에 넣는다)
// 영상을 유튜브 탭에서 처음부터 재생하며 녹화하고(video-capture.js), 끝나면 그 탭이 파일을 저장한다.
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

async function downloadVideo(url, row) {
  const videoId = parseYoutubeId(url);
  if (!videoId) throw new Error("유튜브 영상 주소가 아닙니다");
  let duration = 0;
  let saved = null;
  let downloaded = null;

  setRowStatus(row, "유튜브 탭 여는 중…");
  await runInYoutubeTab({
    videoId,
    files: ["video-capture.js"],
    portName: "video",
    start: { baseName: `${today()}_${videoId}` },
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
        setRowStatus(row, "녹화 시작");
        // 다운로드 감시는 파일이 만들어지기 전에 걸어 둔다
        downloaded = waitDownload(videoId);
        downloaded.catch(() => {});
      } else if (m.type === "progress") {
        setRowStatus(row, `녹화 중 ${fmtTime(m.t)} / ${fmtTime(duration)} · ${mb(m.size)}`);
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

async function start() {
  const urls = readUrls();
  if (!urls.length) return setSummary("유튜브 영상 URL을 입력하세요.", "err");
  running = true;
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#progress tbody").innerHTML = "";
  let ok = 0;

  for (let i = 0; i < urls.length && running; i++) {
    const row = addProgressRow(i, urls[i]);
    setSummary(`${i + 1} / ${urls.length}번째 영상 녹화 중…`);
    try {
      const r = await downloadVideo(urls[i], row);
      setRowStatus(row, `완료 · ${r.name} (${mb(r.size)})`, "ok");
      ok++;
    } catch (e) {
      setRowStatus(row, e.message, "err");
    }
  }

  setSummary(
    running ? `${ok} / ${urls.length}개 영상을 다운로드 폴더에 저장했습니다.` : "중지했습니다. 녹화 중이던 영상은 저장하지 않았습니다.",
    running ? "ok" : "",
  );
  running = false;
  $("#start").disabled = false;
  $("#stop").disabled = true;
}

menu("video.html");
$("#start").addEventListener("click", start);
$("#stop").addEventListener("click", () => {
  running = false;
  $("#stop").disabled = true;
  if (runInYoutubeTab.abort) runInYoutubeTab.abort();
});
