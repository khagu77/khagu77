// 내 알림 · 정보: 카카오톡 연결 · 받을 채널 · 테스트 발송 · 비밀번호
import { esc, toast, busy, CH, CH_ORDER, chIcon, ROLE } from "../ui.js";

export async function render(root, store) {
  const me = store.me;
  const chans = new Set(me.alertChannels?.length ? me.alertChannels : CH_ORDER);
  const kakaoId = store.settings.kakaoClientId;
  root.innerHTML = `
    <div class="page-head"><div><h1>내 알림 · 정보</h1><p>${esc(me.email)} · ${ROLE[me.role] || ""}</p></div></div>
    <div class="dash-grid stagger">
      <div class="card span-7" style="--i:0"><h3>💬 카카오톡 알림</h3>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px">
          <div style="width:64px;height:64px;border-radius:18px;background:#fee500;display:grid;place-items:center;font-size:32px;box-shadow:0 10px 30px rgba(254,229,0,.25);animation:float 3s ease-in-out infinite">💬</div>
          <div style="flex:1;min-width:200px"><b>${me.kakaoConnected ? "카카오톡이 연결되어 있어요" : "카카오톡을 연결해 주세요"}</b>
            <div class="hint">주요 키워드가 걸린 새 게시물을 내 카카오톡 '나와의 채팅'으로 보내 드립니다. 언론 기사는 제목이 80% 이상 비슷하면 대표 1건만 보냅니다.</div></div>
          ${me.kakaoConnected ? `<button class="btn" id="test">📨 테스트 발송</button><button class="btn ghost" id="unlink">연결 끊기</button>` : `<button class="btn primary" id="connect" ${kakaoId ? "" : "disabled"}>카카오톡 연결</button>`}
        </div>
        ${kakaoId ? "" : `<p class="hint err">관리자가 아직 카카오 앱 키를 넣지 않았습니다 (설정 → API 키).</p>`}
        ${me.kakaoError ? `<p class="hint err">${esc(me.kakaoError)}</p>` : ""}
        <label class="toggle-row" style="margin-bottom:14px"><span class="switch"><input type="checkbox" id="alertOn" ${me.alertOn ? "checked" : ""}><span></span></span><b>알림 받기</b></label>
        <div class="field" style="margin-bottom:8px">받을 채널</div>
        <div class="chips" id="chs">${CH_ORDER.map((c) => `<button class="chip ${chans.has(c) ? "on" : ""}" data-v="${c}">${chIcon(c, true)} ${CH[c].name}</button>`).join("")}</div>
        <div class="card" style="margin-top:16px;background:var(--panel-2);box-shadow:none"><div class="hint" style="margin-bottom:6px">이런 모양으로 옵니다</div>
          <div style="background:#b2c7da;color:#111;border-radius:14px;padding:12px;max-width:320px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5"><div style="background:#fff;border-radius:10px;padding:10px">📰 [언론]
현대차 아이오닉5 ICCU 결함 무상수리 확대…12만대 대상
🔑 ICCU, 결함, 무상수리
https://n.news.naver.com/mnews/article/001/0000000001<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px;text-align:center;font-weight:700">게시물 보기</div></div></div></div>
      </div>
      <div class="card span-5" style="--i:1"><h3>👤 내 정보</h3><div style="display:flex;flex-direction:column;gap:12px">
        <label class="field">이름<input class="input" id="name" value="${esc(me.name || "")}"></label>
        <label class="field">부서<input class="input" id="dept" value="${esc(me.dept || "")}"></label>
        <button class="btn" id="saveMe">저장</button>
        <button class="btn ghost" id="pw">🔑 비밀번호 재설정 메일 받기</button>
      </div></div>
    </div>`;
  const $q = (s) => root.querySelector(s);
  const save = async (patch, msg = "저장했습니다") => { try { await store.be.updateMe(patch); Object.assign(me, patch); toast(msg); } catch (e) { toast(e.message, "err"); } };
  $q("#alertOn").onchange = (e) => save({ alertOn: e.target.checked }, e.target.checked ? "알림을 켰습니다" : "알림을 껐습니다");
  $q("#chs").onclick = (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    chans.has(b.dataset.v) ? chans.delete(b.dataset.v) : chans.add(b.dataset.v);
    b.classList.toggle("on");
    save({ alertChannels: [...chans] }, "받을 채널을 바꿨습니다");
  };
  $q("#saveMe").onclick = () => save({ name: $q("#name").value.trim(), dept: $q("#dept").value.trim() });
  $q("#pw").onclick = () => store.be.resetPw(me.email).then(() => toast("비밀번호 재설정 메일을 보냈습니다")).catch((e) => toast(e.message, "err"));
  $q("#connect")?.addEventListener("click", () => {
    const redirect = `${location.origin}/kakao.html`;
    location.href = `https://kauth.kakao.com/oauth/authorize?${new URLSearchParams({ client_id: kakaoId, redirect_uri: redirect, response_type: "code", scope: "talk_message" })}`;
  });
  $q("#test")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { try { await store.be.kakaoTest(); toast("카카오톡을 확인해 보세요 📨"); } catch (err) { toast(err.message, "err", 6000); } }));
  $q("#unlink")?.addEventListener("click", async () => { await store.be.kakaoUnlink(); me.kakaoConnected = false; toast("연결을 끊었습니다"); render(root, store); });
}
