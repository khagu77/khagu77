// 유튜브 영상 탭 안에서 실행되는 공통 도구 (자막 만들기·영상 저장이 함께 쓴다).
// 영상 플레이어를 찾아 광고를 넘기고, 처음부터 재생을 시작한다.
(() => {
  if (window.__ytCap) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs, isStopped = () => false) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (isStopped()) throw new Error("중지됨");
      const v = fn();
      if (v) return v;
      await sleep(300);
    }
    return null;
  }

  function videoTitle() {
    const h1 = document.querySelector("h1.ytd-watch-metadata, #title h1");
    return ((h1 && h1.textContent.trim()) || document.title.replace(/ - YouTube$/, "")).trim();
  }

  const currentVideoId = () => new URL(location.href).searchParams.get("v");
  const isAd = (player) => !!player && player.classList.contains("ad-showing");

  function clickSkipAd() {
    const btn = document.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern");
    if (btn) btn.click();
  }

  // → { player, video, videoId }. 화면 쪽으로 info / status / needplay / playing 을 보낸다.
  async function prepareVideo(post, speed, isStopped) {
    const videoId = currentVideoId();
    const player = await waitFor(() => document.querySelector("#movie_player"), 30000, isStopped);
    const video = await waitFor(() => (player || document).querySelector("video"), 30000, isStopped);
    if (!video) throw new Error("영상 플레이어를 찾지 못했습니다");

    // 영상 앞 광고가 끝날 때까지 기다린다 (건너뛰기 버튼이 나오면 누른다).
    if (isAd(player)) post({ type: "status", text: "광고가 끝나기를 기다리는 중…" });
    while (isAd(player)) {
      if (isStopped()) throw new Error("중지됨");
      clickSkipAd();
      await sleep(500);
    }
    await waitFor(() => video.readyState >= 1 && video.duration > 0 && isFinite(video.duration), 30000, isStopped);
    post({ type: "info", title: videoTitle(), duration: video.duration });

    video.loop = false;
    video.currentTime = 0;
    video.playbackRate = speed;
    video.play().catch(() => {});
    await sleep(1500);
    if (video.paused) {
      post({ type: "needplay" });
      await waitFor(() => !video.paused, 30 * 60 * 1000, isStopped);
      video.currentTime = 0;
    }
    post({ type: "playing" });
    return { player, video, videoId };
  }

  // 녹음·녹화 준비가 끝난 뒤 영상 맨 앞으로 되돌린다 (재생 확인하는 동안 지나간 앞부분을 놓치지 않도록).
  async function rewind(video) {
    video.currentTime = 0;
    await Promise.race([new Promise((r) => video.addEventListener("seeked", r, { once: true })), sleep(5000)]);
    if (video.paused) video.play().catch(() => {});
  }

  // 화면(확장)에서 port 로 연결해 오면 handler(port, 시작메시지, isStopped) 를 실행한다.
  // handler 는 정리 함수를 돌려준다.
  function serve(name, handler) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== name) return;
      let stopped = false;
      let cleanup = () => {};
      port.onDisconnect.addListener(() => {
        stopped = true;
        cleanup();
      });
      port.onMessage.addListener(async (msg) => {
        if (msg.type !== "start") return;
        try {
          cleanup = (await handler(port, msg, () => stopped)) || cleanup;
        } catch (e) {
          if (!stopped) port.postMessage({ type: "error", message: String((e && e.message) || e) });
        }
      });
    });
  }

  window.__ytCap = { sleep, waitFor, isAd, clickSkipAd, currentVideoId, prepareVideo, rewind, serve };
})();
