// 영상·음성 파일 다운로드 - 유튜브 영상 탭 안에서 실행된다. (capture-common.js 다음에 넣는다)
// 영상을 처음부터 1배속으로 재생하면서 녹화(영상: .mp4) 또는 녹음(음성: .mp3, lib/lame.min.js 필요)하고,
// 끝나면 파일로 저장한다. 광고가 나오거나 멈춘 동안은 녹화·녹음을 멈춘다.
(() => {
  if (window.__videoCapture) return;
  window.__videoCapture = true;
  const { waitFor, isAd, clickSkipAd, currentVideoId, prepareVideo, rewind, serve } = window.__ytCap;

  const VIDEO_TYPES = [
    ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm", "webm"],
  ];
  const MP3_KBPS = 192;

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // 영상 녹화: MediaRecorder. → { size(), pause(), resume(), stop() → Promise<{blob, ext}>, onError }
  async function videoRecorder(video, isStopped, onError) {
    const [mimeType, ext] = VIDEO_TYPES.find(([m]) => MediaRecorder.isTypeSupported(m)) || [];
    if (!mimeType) throw new Error("이 크롬은 영상 녹화를 지원하지 않습니다");
    const stream = video.captureStream();
    const ok = await waitFor(() => stream.getVideoTracks().length && stream.getAudioTracks().length, 15000, isStopped);
    if (!ok) throw new Error("영상 화면·소리를 가져오지 못했습니다");
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
    const parts = [];
    let size = 0;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        parts.push(e.data);
        size += e.data.size;
      }
    };
    rec.onerror = (e) => onError(`녹화 오류: ${(e.error && e.error.message) || "알 수 없음"}`);
    return {
      start: () => rec.start(1000),
      size: () => size,
      pause: () => rec.state === "recording" && rec.pause(),
      resume: () => rec.state === "paused" && rec.resume(),
      stop: () =>
        new Promise((resolve) => {
          if (rec.state === "inactive") return resolve(null);
          rec.onstop = () => resolve({ blob: new Blob(parts, { type: mimeType.split(";")[0] }), ext });
          rec.stop();
        }),
    };
  }

  // 음성 녹음: 영상 소리를 받아 바로 MP3 로 인코딩한다 (lamejs).
  // hold(): 지금 녹음을 쉬어야 하는지 (광고·일시정지). 소리 조각마다 바로 확인한다.
  async function audioRecorder(video, isStopped, hold) {
    if (typeof lamejs === "undefined") throw new Error("MP3 인코더를 불러오지 못했습니다");
    const stream = video.captureStream();
    const track = await waitFor(() => stream.getAudioTracks()[0], 15000, isStopped);
    if (!track) throw new Error("영상 소리를 가져오지 못했습니다");
    const ctx = new AudioContext();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    const enc = new lamejs.Mp3Encoder(2, ctx.sampleRate, MP3_KBPS);
    const parts = [];
    let size = 0;
    let recording = false;
    const toInt16 = (f) => {
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const v = Math.max(-1, Math.min(1, f[i]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      return out;
    };
    const push = (buf) => {
      if (buf.length) {
        parts.push(new Uint8Array(buf));
        size += buf.length;
      }
    };
    proc.onaudioprocess = (e) => {
      if (!recording || hold()) return;
      const left = toInt16(e.inputBuffer.getChannelData(0));
      const right = e.inputBuffer.numberOfChannels > 1 ? toInt16(e.inputBuffer.getChannelData(1)) : left;
      for (let i = 0; i < left.length; i += 1152) {
        push(enc.encodeBuffer(left.subarray(i, i + 1152), right.subarray(i, i + 1152)));
      }
    };
    src.connect(proc);
    proc.connect(ctx.destination); // 출력은 무음. 연결해야 onaudioprocess 가 돈다.
    function close() {
      recording = false;
      proc.onaudioprocess = null;
      try {
        src.disconnect();
        proc.disconnect();
      } catch {}
      track.stop();
      ctx.close().catch(() => {});
    }
    return {
      start: () => (recording = true),
      size: () => size,
      pause: () => (recording = false),
      resume: () => (recording = true),
      stop: async () => {
        close();
        push(enc.flush());
        return { blob: new Blob(parts, { type: "audio/mpeg" }), ext: "mp3" };
      },
    };
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

    const { player, video, videoId } = await prepareVideo(post, 1, isStopped);
    let finished = false;
    const shouldHold = () => isAd(player) || video.paused || video.seeking;
    const rec =
      start.kind === "audio"
        ? await audioRecorder(video, isStopped, shouldHold)
        : await videoRecorder(video, isStopped, (message) => {
            post({ type: "error", message });
            cleanup();
          });
    await rewind(video);
    rec.start();

    async function finish() {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      video.removeEventListener("ended", finish);
      const out = await rec.stop();
      if (!out || isStopped()) return;
      const name = `${baseName}.${out.ext}`;
      saveBlob(out.blob, name);
      post({ type: "saved", name, size: out.blob.size });
    }

    // 광고·일시정지 중에는 녹화·녹음을 멈추고, 끝나면 이어서 한다.
    const timer = setInterval(() => {
      if (finished) return;
      if (isStopped()) return cleanup();
      if (currentVideoId() !== videoId || video.ended) return finish();
      const hold = shouldHold();
      if (isAd(player)) clickSkipAd();
      if (hold) rec.pause();
      else rec.resume();
      post({ type: "progress", t: video.currentTime, size: rec.size() });
    }, 500);
    video.addEventListener("ended", finish);

    function cleanup() {
      finished = true;
      clearInterval(timer);
      video.removeEventListener("ended", finish);
      rec.stop();
      video.pause();
    }
    return () => {
      if (!finished) cleanup();
    };
  });
})();
