// 영상 파일 다운로드 - 유튜브 영상 탭 안에서 실행된다. (capture-common.js 다음에 넣는다)
// 영상을 처음부터 1배속으로 재생하면서 화면과 소리를 녹화하고, 끝나면 .mp4 로 저장한다.
// 광고가 나오는 동안은 녹화를 멈춘다.
(() => {
  if (window.__videoCapture) return;
  window.__videoCapture = true;
  const { waitFor, isAd, clickSkipAd, currentVideoId, prepareVideo, rewind, serve } = window.__ytCap;

  const MIME_TYPES = [
    ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm", "webm"],
  ];

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  serve("video", async (port, start, isStopped) => {
    const post = (m) => {
      if (!isStopped()) port.postMessage(m);
    };
    // 화면이 영상 제목을 알게 되면 파일 이름(20261010_유튜브제목)을 다시 보내 준다.
    let baseName = start.baseName;
    port.onMessage.addListener((m) => {
      if (m.type === "name") baseName = m.baseName;
    });
    const [mimeType, ext] = MIME_TYPES.find(([m]) => MediaRecorder.isTypeSupported(m)) || [];
    if (!mimeType) throw new Error("이 크롬은 영상 녹화를 지원하지 않습니다");

    const { player, video, videoId } = await prepareVideo(post, 1, isStopped);
    const stream = video.captureStream();
    const ok = await waitFor(() => stream.getVideoTracks().length && stream.getAudioTracks().length, 15000, isStopped);
    if (!ok) throw new Error("영상 화면·소리를 가져오지 못했습니다");

    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
    const parts = [];
    let size = 0;
    let finished = false;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        parts.push(e.data);
        size += e.data.size;
      }
    };
    rec.onerror = (e) => {
      post({ type: "error", message: `녹화 오류: ${(e.error && e.error.message) || "알 수 없음"}` });
      cleanup();
    };
    rec.onstop = () => {
      if (!finished || isStopped()) return;
      const name = `${baseName}.${ext}`;
      saveBlob(new Blob(parts, { type: mimeType.split(";")[0] }), name);
      parts.length = 0;
      post({ type: "saved", name, size });
    };
    await rewind(video);
    rec.start(1000);

    function finish() {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      video.removeEventListener("ended", finish);
      if (rec.state !== "inactive") rec.stop();
    }

    // 광고·일시정지 중에는 녹화를 멈추고, 끝나면 이어서 녹화한다.
    const timer = setInterval(() => {
      if (finished) return;
      if (isStopped()) return cleanup();
      if (currentVideoId() !== videoId || video.ended) return finish();
      const hold = isAd(player) || video.paused;
      if (isAd(player)) clickSkipAd();
      if (hold && rec.state === "recording") rec.pause();
      else if (!hold && rec.state === "paused") rec.resume();
      post({ type: "progress", t: video.currentTime, size });
    }, 500);
    video.addEventListener("ended", finish);

    function cleanup() {
      finished = true;
      clearInterval(timer);
      video.removeEventListener("ended", finish);
      if (rec.state !== "inactive") rec.stop();
      parts.length = 0;
      video.pause();
    }
    return () => {
      if (!finished) cleanup();
    };
  });
})();
