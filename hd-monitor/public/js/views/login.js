// 로그인 · 가입 · 승인 대기 화면
import { h, esc, toast, busy, segmented } from "../ui.js";

const TICKS = ["📰 언론", "☕ 관심 동호회 51곳", "▶️ 관심 유튜브 48곳", "🚗 보배드림", "💬 클리앙", "🛒 뽐뿌", "🔔 카카오톡 실시간 알림", "🤖 AI 성향 분석", "📊 실시간 대시보드", "📥 엑셀 다운로드"];

function hero() {
  const blips = Array.from({ length: 7 }, (_, i) => `<span class="blip" style="left:${20 + ((i * 53) % 60)}%;top:${15 + ((i * 37) % 70)}%;animation-delay:${i * 0.57}s"></span>`).join("");
  const tk = TICKS.map((t) => `<span class="tk">${t}</span>`).join("");
  return `<section class="auth-hero">
    <div class="radar"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="sweep"></div>${blips}</div>
    <div class="brand" style="padding:0"><div class="brand-mark">H</div><div class="brand-text"><b>Online Issue Monitor</b><span>HYUNDAI · GENESIS</span></div></div>
    <div>
      <h1>온라인의 모든 신호를<br><span class="grad">5분 안에</span> 포착합니다</h1>
      <p>언론 · 동호회 · 유튜브 · 자동차 커뮤니티의 품질·안전 이슈를 자동으로 모으고, 성향을 분석해 카카오톡으로 바로 알려 드립니다.</p>
    </div>
    <div class="ticker"><div class="track">${tk}</div><div class="track" aria-hidden="true">${tk}</div></div>
  </section>`;
}

export function renderLogin(parent, store) {
  const el = h(`<div class="auth">${hero()}
    <section class="auth-box"><form class="card auth-card" autocomplete="on">
      <div class="seg" id="mode"><button type="button" class="on" data-v="in">로그인</button><button type="button" data-v="up">가입 신청</button></div>
      <h2 id="ttl">다시 오신 걸 환영해요 👋</h2>
      <label class="field">이메일<input class="input" name="email" type="email" required autocomplete="username" placeholder="name@company.com"></label>
      <label class="field">비밀번호<input class="input" name="pw" type="password" required minlength="6" autocomplete="current-password" placeholder="6자 이상"></label>
      <div id="upFields" style="display:none;flex-direction:column;gap:14px">
        <label class="field">이름<input class="input" name="name" placeholder="홍길동"></label>
        <label class="field">부서<input class="input" name="dept" placeholder="품질관리팀"></label>
        <div class="hint">가입 신청 후 관리자가 승인하면 사용할 수 있습니다. (맨 처음 가입한 사람은 자동으로 관리자)</div>
      </div>
      <button class="btn primary" style="height:44px" id="go">로그인</button>
      <button type="button" class="btn ghost sm" id="reset">비밀번호를 잊으셨나요?</button>
    </form></section></div>`);
  parent.append(el);
  let mode = "in";
  const f = el.querySelector("form");
  segmented(el.querySelector("#mode"), (v) => {
    mode = v;
    el.querySelector("#upFields").style.display = v === "up" ? "flex" : "none";
    el.querySelector("#go").textContent = v === "up" ? "가입 신청" : "로그인";
    el.querySelector("#ttl").textContent = v === "up" ? "모니터링 팀에 합류하기 ✨" : "다시 오신 걸 환영해요 👋";
  });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = el.querySelector("#go");
    busy(btn, async () => {
      try {
        if (mode === "up") {
          store.pendingProfile = { name: f.name.value.trim(), dept: f.dept.value.trim() };
          await store.be.signUp(f.email.value.trim(), f.pw.value);
        } else {
          await store.be.signIn(f.email.value.trim(), f.pw.value);
        }
      } catch (err) {
        const m = String(err.code || err.message);
        toast(/invalid-credential|wrong-password|user-not-found/.test(m) ? "이메일 또는 비밀번호가 맞지 않습니다" : /email-already-in-use/.test(m) ? "이미 가입된 이메일입니다. 로그인해 주세요 (다른 시스템과 같은 계정을 쓸 수 있어요)" : /too-many/.test(m) ? "시도가 너무 많습니다. 잠시 후 다시 해 주세요" : err.message, "err", 5000);
      }
    });
  });
  el.querySelector("#reset").onclick = async () => {
    const email = f.email.value.trim();
    if (!email) return toast("이메일을 먼저 입력해 주세요", "err");
    await store.be.resetPw(email).then(() => toast("비밀번호 재설정 메일을 보냈습니다")).catch((e) => toast(e.message, "err"));
  };
}

export function renderPending(parent, store) {
  const st = store.me?.status;
  const el = h(`<div class="auth">${hero()}<section class="auth-box"><div class="card auth-card" style="text-align:center">
    <div style="font-size:48px;animation:float 3s ease-in-out infinite">${st === "disabled" ? "⛔" : "⏳"}</div>
    <h2>${st === "disabled" ? "사용이 중지된 계정입니다" : "관리자 승인을 기다리고 있어요"}</h2>
    <p class="hint">${esc(store.me?.email || "")}<br>${st === "disabled" ? "관리자에게 문의해 주세요." : "승인되면 이 화면을 새로고침해 주세요."}</p>
    <button class="btn" id="re">새로고침</button><button class="btn ghost" id="out">로그아웃</button>
  </div></section></div>`);
  parent.append(el);
  el.querySelector("#re").onclick = () => location.reload();
  el.querySelector("#out").onclick = () => store.be.signOut();
}
