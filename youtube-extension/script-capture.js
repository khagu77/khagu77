// 스크립트 추출 - 유튜브 영상 탭 안에서 실행된다. (capture-common.js 다음에 넣는다)
// 영상을 처음부터 재생하면서 소리를 16kHz 로 줄여 스크립트 화면으로 2초씩 보낸다.
// 유튜브 자막은 쓰지 않는다. 광고가 나오는 동안은 보내지 않는다.
(() => {
  if (window.__scriptCapture) return;
  window.__scriptCapture = true;
  const { waitFor, isAd, clickSkipAd, currentVideoId, prepareVideo, rewind, serve } = window.__ytCap;

  const OUT_RATE = 16000;
  const SEND_SEC = 2;

  function toBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  serve("script", async (port, { speed }, isStopped) => {
    const post = (m) => {
      if (!isStopped()) port.postMessage(m);
    };
    const { player, video, videoId } = await prepareVideo(post, speed, isStopped);

    const stream = video.captureStream();
    const track = await waitFor(() => stream.getAudioTracks()[0], 15000, isStopped);
    if (!track) throw new Error("영상 소리를 가져오지 못했습니다");

    const ctx = new AudioContext();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    src.connect(proc);
    proc.connect(ctx.destination); // 출력은 무음. 연결해야 onaudioprocess 가 돈다.

    // 구간 평균으로 16kHz 로 줄인다 (단순 추출보다 잡음이 적다).
    const ratio = ctx.sampleRate / OUT_RATE;
    const sendLen = OUT_RATE * SEND_SEC;
    let out = new Int16Array(sendLen);
    let outLen = 0;
    let chunkT = 0;
    let acc = 0;
    let cnt = 0;
    let phase = 0;
    let finished = false;
    let started = false;
    let epoch = 0;

    function send() {
      if (outLen > 0) post({ type: "audio", epoch, t: chunkT, data: toBase64(out.subarray(0, outLen)) });
      out = new Int16Array(sendLen);
      outLen = 0;
    }

    function finish() {
      if (finished) return;
      finished = true;
      send();
      post({ type: "done" });
      cleanup();
    }

    proc.onaudioprocess = (e) => {
      if (finished || !started) return;
      if (isStopped()) return cleanup();
      if (currentVideoId() !== videoId || video.ended) return finish(); // 다음 영상으로 넘어갔거나 끝남
      if (isAd(player) || video.paused || video.seeking) {
        if (isAd(player)) clickSkipAd();
        send(); // 끊긴 곳까지 보내고, 다시 시작할 때 새 시각으로 시작
        acc = cnt = phase = 0;
        return;
      }
      const input = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) {
        acc += input[i];
        cnt++;
        phase += 1;
        if (phase >= ratio) {
          phase -= ratio;
          if (outLen === 0) chunkT = Math.max(0, video.currentTime - ((input.length - i) / ctx.sampleRate) * video.playbackRate);
          const v = Math.max(-1, Math.min(1, acc / cnt));
          out[outLen++] = v < 0 ? v * 0x8000 : v * 0x7fff;
          acc = cnt = 0;
          if (outLen === sendLen) send();
        }
      }
    };

    const onEnded = () => finish();
    video.addEventListener("ended", onEnded);
    await rewind(video);
    started = true;

    // 탭 음소거 때문에 소리가 안 잡히면 스크립트 화면이 처음부터 다시 하라고 보낸다.
    port.onMessage.addListener((msg) => {
      if (msg.type !== "restart") return;
      epoch = msg.epoch;
      outLen = 0;
      acc = cnt = phase = 0;
      video.currentTime = 0;
      video.play().catch(() => {});
    });

    function cleanup() {
      video.removeEventListener("ended", onEnded);
      proc.onaudioprocess = null;
      try {
        src.disconnect();
        proc.disconnect();
      } catch {}
      track.stop();
      ctx.close().catch(() => {});
      if (isStopped() && !finished) video.pause();
      video.playbackRate = 1;
    }
    return cleanup;
  });
})();
