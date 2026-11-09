// (온라인 오전 일일동향 확장 issue-monitor-extension 에서 가져옴)
// 완료 축하 효과 (담당자 요청 2026-11-02)
//  - Celebrate.done(버튼): 받기 버튼이 무지개빛으로 흐르며 커졌다 작아지고, 빛이 퍼지고, 버튼 위에 '✔ 완료!' 가 흔들린다 (약 2.4초)
//  - Celebrate.ding(): 수집·PPT 작성·주간 보고서 작성 등 작업이 끝나면 '딩동댕' (도·미·솔 실로폰 소리, 따로 소리 파일 없이 만듦)
//  - Celebrate.after(): 효과가 보이도록 알림창을 조금 늦게 띄울 때 기다리는 시간
// 수집 탭·PPT·RAW 작성·주간 보고서 화면(iframe)에서 함께 쓴다
(function (global) {
  const DURATION = 2400;
  const STYLE_ID = "celebrate-style";
  const CSS = `
@keyframes cel-flow { 0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; } }
@keyframes cel-pulse { 0%, 100% { transform: scale(1); } 25% { transform: scale(1.14); } 50% { transform: scale(0.96); } 75% { transform: scale(1.08); } }
@keyframes cel-glow {
  0% { box-shadow: 0 0 0 0 rgba(255, 80, 80, 0.75), 0 0 0 0 rgba(80, 160, 255, 0.6); }
  50% { box-shadow: 0 0 18px 8px rgba(255, 200, 60, 0.55), 0 0 34px 16px rgba(120, 90, 255, 0.35); }
  100% { box-shadow: 0 0 30px 22px rgba(80, 220, 160, 0), 0 0 48px 30px rgba(80, 160, 255, 0); }
}
@keyframes cel-badge-in { 0% { opacity: 0; transform: translate(-50%, 6px) scale(0.6); } 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes cel-shake { 0%, 100% { rotate: 0deg; } 20% { rotate: -9deg; } 40% { rotate: 8deg; } 60% { rotate: -6deg; } 80% { rotate: 5deg; } }
@keyframes cel-badge-out { to { opacity: 0; transform: translate(-50%, -10px) scale(0.9); } }
.cel-btn {
  position: relative;
  color: #fff !important;
  border-color: transparent !important;
  background: linear-gradient(90deg, #ff4d4d, #ff9f1a, #ffe14d, #3ddc84, #3d8bff, #8a5cff, #ff4dd2, #ff4d4d) !important;
  background-size: 300% 100% !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  animation: cel-flow 1s linear infinite, cel-pulse 0.8s ease-in-out 3, cel-glow 0.8s ease-out 3 !important;
  z-index: 5;
}
.cel-badge {
  position: fixed;
  z-index: 3000;
  pointer-events: none;
  padding: 4px 12px;
  border-radius: 999px;
  font: 800 14px/1.2 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  color: #fff;
  white-space: nowrap;
  background: linear-gradient(90deg, #ff4d4d, #ff9f1a, #3ddc84, #3d8bff, #8a5cff);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  transform: translate(-50%, 0);
  animation: cel-badge-in 0.25s ease-out, cel-shake 0.45s ease-in-out 0.25s 4, cel-badge-out 0.35s ease-in ${DURATION - 350}ms forwards;
}
@media (prefers-reduced-motion: reduce) {
  .cel-btn { animation: cel-flow 3s linear infinite !important; }
  .cel-badge { animation: cel-badge-in 0.25s ease-out, cel-badge-out 0.35s ease-in ${DURATION - 350}ms forwards; }
}`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function done(btn, text = "✔ 완료!") {
    if (!btn || !btn.isConnected) return;
    ensureStyle();
    btn.classList.remove("cel-btn");
    void btn.offsetWidth; // 다시 누르면 처음부터
    btn.classList.add("cel-btn");
    const r = btn.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.className = "cel-badge";
    badge.textContent = text;
    badge.style.left = `${r.left + r.width / 2}px`;
    badge.style.top = `${Math.max(4, r.top - 34)}px`;
    document.body.appendChild(badge);
    clearTimeout(btn._celTimer);
    btn._celTimer = setTimeout(() => {
      btn.classList.remove("cel-btn");
      badge.remove();
    }, DURATION);
  }

  // '딩동댕': 도(C5)·미(E5)·솔(G5) 실로폰 소리. 연달아 끝나는 작업(캡처 끝 → PPT 저장 등)은 4초 안에 한 번만
  let ctx = null;
  let lastDing = 0;
  async function ding() {
    const now = Date.now();
    if (now - lastDing < 4000) return;
    lastDing = now;
    try {
      ctx = ctx || new (global.AudioContext || global.webkitAudioContext)();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + 0.05;
      const notes = [
        [523.25, 0, 0.55],
        [659.25, 0.22, 0.55],
        [783.99, 0.44, 1.3],
      ];
      for (const [freq, at, len] of notes) {
        for (const [mul, vol] of [[1, 0.32], [4, 0.06], [2.76, 0.04]]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = freq * mul;
          g.gain.setValueAtTime(0.0001, t0 + at);
          g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len * (mul === 1 ? 1 : 0.35));
          o.connect(g).connect(ctx.destination);
          o.start(t0 + at);
          o.stop(t0 + at + len + 0.05);
        }
      }
    } catch {}
  }

  const after = () => new Promise((r) => setTimeout(r, 1400));

  global.Celebrate = { done, ding, after };
})(typeof window !== "undefined" ? window : self);
