// [필수] 네이버 로그인이 풀려 있으면 네이버 카페 수집을 시작하지 않는다.
// 빨간 전체 화면 경고(깜빡임) + 사이렌 소리로 먼저 로그인하게 하고, 로그인되면(3초마다 확인) 바로 수집을 이어서 시작한다.
// (유튜브·네이버 뉴스·자동차 커뮤니티만 수집할 때는 막지 않음 — 네이버 카페가 들어 있을 때만)

let sirenTimer = null;
let sirenCtx = null;

// 위잉-위잉 사이렌 한 번 (약 1.9초)
function sirenOnce() {
  try {
    sirenCtx = sirenCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (sirenCtx.state === "suspended") sirenCtx.resume().catch(() => {});
    const t0 = sirenCtx.currentTime;
    const osc = sirenCtx.createOscillator();
    const gain = sirenCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(650, t0);
    osc.frequency.linearRampToValueAtTime(1350, t0 + 0.45);
    osc.frequency.linearRampToValueAtTime(650, t0 + 0.9);
    osc.frequency.linearRampToValueAtTime(1350, t0 + 1.35);
    osc.frequency.linearRampToValueAtTime(650, t0 + 1.8);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
    gain.gain.setValueAtTime(0.35, t0 + 1.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.85);
    osc.connect(gain).connect(sirenCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 1.9);
    window.__sirenCount = (window.__sirenCount || 0) + 1; // 테스트 확인용
  } catch {
    /* 소리를 못 내도 경고 화면은 그대로 */
  }
}

// 처음 1분은 3초마다, 그 뒤는 20초마다 ([소리 끄기] 전까지)
function sirenStart() {
  sirenStop();
  sirenOnce();
  let n = 0;
  const tick = () => {
    sirenOnce();
    n++;
    sirenTimer = setTimeout(tick, n < 20 ? 3000 : 20000);
  };
  sirenTimer = setTimeout(tick, 3000);
}

function sirenStop() {
  clearTimeout(sirenTimer);
  sirenTimer = null;
}

async function naverLoggedIn() {
  try {
    return !!(await chrome.cookies.get({ url: "https://www.naver.com", name: "NID_AUT" }));
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// 로그인돼 있으면 바로 true. 아니면 경고를 띄우고 로그인될 때까지 기다린다 ([수집 취소]면 false)
function naverLoginGate({ reason = "" } = {}) {
  return new Promise(async (resolve) => {
    if (await naverLoggedIn()) return resolve(true);
    if (typeof checkLogin === "function") checkLogin();
    document.getElementById("loginAlarm")?.remove();
    const box = document.createElement("div");
    box.id = "loginAlarm";
    box.className = "login-alarm";
    box.innerHTML = `
      <div class="la-card" role="alertdialog" aria-live="assertive">
        <div class="la-icon">🚨</div>
        <h2>네이버 로그인이 풀려 있습니다!</h2>
        <p class="la-main">${reason ? `${escapeHtml(reason)}<br>` : ""}네이버 카페는 로그인해야 수집됩니다. <b>먼저 네이버에 로그인해 주세요.</b><br>로그인하기 전에는 수집을 시작하지 않습니다.</p>
        <p class="la-sub">로그인하면 몇 초 안에 자동으로 확인하고 수집을 이어서 시작합니다.</p>
        <div class="la-btns">
          <button type="button" class="la-login">🔑 네이버 로그인 열기</button>
          <button type="button" class="la-check">로그인했어요 · 다시 확인</button>
          <button type="button" class="la-mute">🔇 소리 끄기</button>
          <button type="button" class="la-cancel">수집 취소</button>
        </div>
        <p class="la-status" aria-live="polite"></p>
      </div>`;
    document.body.append(box);
    const status = box.querySelector(".la-status");
    sirenStart();
    let poll = null;
    const finish = (ok) => {
      clearInterval(poll);
      sirenStop();
      if (ok) {
        status.textContent = "✅ 네이버 로그인 확인! 수집을 시작합니다.";
        box.classList.add("ok");
        setTimeout(() => box.remove(), 1200);
      } else box.remove();
      if (typeof checkLogin === "function") checkLogin();
      resolve(ok);
    };
    const check = async (byUser) => {
      if (await naverLoggedIn()) return finish(true);
      if (byUser) status.textContent = `아직 로그인되지 않았습니다 (${new Date().toLocaleTimeString("ko-KR")} 확인). 로그인 창에서 로그인한 뒤 다시 눌러 주세요.`;
    };
    poll = setInterval(() => check(false), 3000);
    box.querySelector(".la-login").addEventListener("click", () => chrome.tabs.create({ url: "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fcafe.naver.com" }));
    box.querySelector(".la-check").addEventListener("click", () => check(true));
    box.querySelector(".la-mute").addEventListener("click", (e) => {
      sirenStop();
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = "소리 꺼짐";
    });
    box.querySelector(".la-cancel").addEventListener("click", () => {
      if (!confirm("수집을 시작하지 않고 닫을까요?")) return;
      finish(false);
    });
  });
}

// 화면을 열어 둔 동안 로그인 상태가 바뀌면 위쪽 로그인 표시를 바로 바꿈
try {
  chrome.cookies.onChanged.addListener((ch) => {
    if (ch.cookie && ch.cookie.name === "NID_AUT" && /naver\.com$/.test(ch.cookie.domain) && typeof checkLogin === "function") checkLogin();
  });
} catch {
  /* 무시 */
}
