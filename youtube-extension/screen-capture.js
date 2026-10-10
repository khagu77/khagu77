// 스크립트 추출(화면 자막 인식) - 유튜브 영상 탭 안에서 실행된다. (capture-common.js 다음에 넣는다)
// 영상을 빠르게 재생하면서 화면 아래쪽 자막 글자(caption-mask.js)가 바뀔 때마다 그 부분 그림을 스크립트 화면으로 보낸다.
// 글자 읽기(OCR)는 스크립트 화면에서 한다. 광고가 나오는 동안은 보내지 않는다.
(() => {
  if (window.__screenCapture) return;
  window.__screenCapture = true;
  const { isAd, clickSkipAd, currentVideoId, prepareVideo, rewind, serve } = window.__ytCap;

  const TICK_MS = 120; // 화면을 살펴보는 간격 (실제 시간)
  const SIG_W = 320; // 자막이 바뀌었는지는 줄인 그림에서 "자막 글자 점"만 골라 비교한다
  const CHANGE = 0.25; // 글자 점의 25% 이상이 달라지면 자막이 바뀐 것으로 본다
  const EMPTY = 0.002; // 글자 점이 이보다 적으면 자막이 없는 것으로 본다

  function signature(sctx, video, sy, sh) {
    const w = SIG_W;
    const h = Math.max(8, Math.round((sh * SIG_W) / video.videoWidth));
    if (sctx.canvas.height !== h) sctx.canvas.height = h;
    sctx.drawImage(video, 0, sy, video.videoWidth, sh, 0, 0, w, h);
    const fontPx = (0.07 * video.videoHeight * SIG_W) / video.videoWidth; // 자막 글자 높이 짐작
    const sig = window.captionMask(sctx.getImageData(0, 0, w, h).data, w, h, Math.max(2, Math.round(fontPx * 0.15)));
    const count = window.keepCenterBlock(sig, w, h, Math.round(fontPx * 1.2));
    return { sig, bright: count / sig.length };
  }

  // 두 글자 그림이 얼마나 다른지 (글자 점 기준 0~1)
  function diff(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    let x = 0;
    let u = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i] ? 1 : 0;
      const q = b[i] ? 1 : 0;
      x += p ^ q;
      u += p | q;
    }
    return u ? x / u : 0;
  }

  serve("screen", async (port, { speed, region }, isStopped) => {
    const post = (m) => {
      if (!isStopped()) port.postMessage(m);
    };
    const { player, video, videoId } = await prepareVideo(post, speed, isStopped);

    const small = document.createElement("canvas");
    small.width = SIG_W;
    small.height = 8;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    const crop = document.createElement("canvas");
    const cctx = crop.getContext("2d");
    try {
      signature(sctx, video, 0, video.videoHeight || 1);
    } catch {
      throw new Error("영상 화면을 읽을 수 없습니다");
    }

    let prev = null; // 직전에 본 그림
    let sent = null; // 마지막으로 보낸(또는 빈 것으로 본) 그림
    let changedAt = 0; // 자막이 바뀌기 시작한 영상 시각
    let settled = true; // 직전 그림이 그 앞 그림과 같았는지
    let held = false; // 글자 읽기가 밀려서 화면이 잠깐 세워 달라고 했는지
    let lastProgress = 0;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      video.removeEventListener("ended", finish);
      post({ type: "done" });
    }

    function tick() {
      if (finished) return;
      if (isStopped()) return cleanup();
      if (currentVideoId() !== videoId || video.ended) return finish();
      if (isAd(player)) return clickSkipAd();
      if (held) {
        if (!video.paused) video.pause();
        return;
      }
      if (video.paused || video.seeking || !video.videoWidth) return;

      const t = video.currentTime;
      if (t - lastProgress >= 1) {
        lastProgress = t;
        post({ type: "progress", t });
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sh = Math.round(vh * region);
      const sy = vh - sh;
      const { sig, bright } = signature(sctx, video, sy, sh);
      const moved = diff(sig, prev);
      prev = sig;
      if (moved >= CHANGE) {
        if (settled) changedAt = t;
        settled = false;
        // 자막 뒤 배경이 계속 움직이면 그림이 멈추지 않으므로, 1초(영상 시각)마다 그냥 보낸다.
        if (t - changedAt < 1) return;
      } else {
        settled = true;
      }
      // 자막이 자리 잡았고 마지막으로 보낸 것과 다르면 보낸다.
      if (diff(sig, sent) < CHANGE) return;
      sent = sig;
      if (bright < EMPTY) return; // 자막 없음
      crop.width = vw;
      crop.height = sh;
      cctx.drawImage(video, 0, sy, vw, sh, 0, 0, vw, sh);
      post({ type: "frame", t: changedAt, image: crop.toDataURL("image/jpeg", 0.92) });
      changedAt = t;
    }

    port.onMessage.addListener((m) => {
      if (m.type !== "hold") return;
      held = m.on;
      if (held) video.pause();
      else video.play().catch(() => {});
    });

    video.addEventListener("ended", finish);
    await rewind(video);
    changedAt = 0;
    const timer = setInterval(tick, TICK_MS);

    function cleanup() {
      finished = true;
      clearInterval(timer);
      video.removeEventListener("ended", finish);
      if (isStopped()) video.pause();
      video.playbackRate = 1;
    }
    return () => {
      if (!finished) cleanup();
      video.playbackRate = 1;
    };
  });
})();
