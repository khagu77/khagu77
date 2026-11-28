// 사용자 관리 (관리자): 등록 · 승인 · 권한 · 중지 · 삭제
import { esc, toast, busy, modal, confirmBox, ROLE, STATUS, fmtTime } from "../ui.js";

export async function render(root, store) {
  root.innerHTML = `
    <div class="page-head"><div><h1>사용자 관리</h1><p>관리자: 모든 기능 · 담당자: 성향 지정·메모·AI 분석 · 열람자: 보기·엑셀</p></div>
      <div class="actions"><button class="btn primary" id="add">＋ 사용자 등록</button></div></div>
    <div class="card" style="padding:0;overflow:auto"><table class="tbl" id="tbl"><thead><tr><th>이름</th><th>이메일</th><th>부서</th><th>권한</th><th>상태</th><th>카카오 알림</th><th>최근 로그인</th><th></th></tr></thead><tbody></tbody></table></div>`;
  const tbody = root.querySelector("tbody");
  let users = [];
  async function load() {
    users = (await store.be.listUsers()).sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || String(a.name).localeCompare(String(b.name)));
    tbody.innerHTML = users.map((u, i) => `<tr data-uid="${esc(u.uid)}" style="animation:rowIn .4s ${i * 30}ms both">
      <td><input class="input" data-f="name" value="${esc(u.name || "")}" style="min-width:110px"></td>
      <td>${esc(u.email)}</td>
      <td><input class="input" data-f="dept" value="${esc(u.dept || "")}" style="min-width:100px"></td>
      <td><select class="input" data-f="role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td><select class="input" data-f="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${u.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>${u.status === "pending" ? ` <button class="btn sm primary" data-approve>승인</button>` : ""}</td>
      <td>${u.kakaoConnected ? `<span class="badge b-pos">연결됨${u.alertOn ? " · 켜짐" : " · 꺼짐"}</span>` : `<span class="badge b-neu">미연결</span>`}</td>
      <td class="hint">${esc(fmtTime(u.lastLoginAt) || "-")}</td>
      <td>${u.uid === store.me.uid ? `<span class="hint">나</span>` : `<button class="btn sm ghost danger" data-del>삭제</button>`}</td></tr>`).join("");
  }
  tbody.addEventListener("change", async (e) => {
    const tr = e.target.closest("tr");
    const f = e.target.dataset.f;
    if (!tr || !f) return;
    if (tr.dataset.uid === store.me.uid && (f === "role" || f === "status")) { toast("자기 자신의 권한·상태는 바꿀 수 없습니다", "err"); return load(); }
    try { await store.be.updateUser(tr.dataset.uid, { [f]: e.target.value.trim() }); toast("바꿨습니다"); } catch (err) { toast(err.message, "err"); }
  });
  tbody.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const u = users.find((x) => x.uid === tr.dataset.uid);
    if (e.target.closest("[data-approve]")) {
      await store.be.updateUser(u.uid, { status: "active" });
      toast(`${u.name || u.email} 님을 승인했습니다`);
      load();
    }
    if (e.target.closest("[data-del]")) {
      const body = await modal("사용자 삭제", `<p><b>${esc(u.name || u.email)}</b> 님을 이 시스템에서 삭제합니다.</p>
        <label class="toggle-row"><input type="checkbox" id="delAcc"> 로그인 계정도 삭제 (같은 Firebase 프로젝트의 유튜브 모니터링 시스템도 로그인할 수 없게 됨)</label>`, { ok: "삭제", danger: true });
      if (!body) return;
      try { await store.be.deleteUser(u.uid, body.querySelector("#delAcc").checked); toast("삭제했습니다"); load(); } catch (err) { toast(err.message, "err"); }
    }
  });
  root.querySelector("#add").onclick = async () => {
    const body = await modal("사용자 등록", `<div style="display:flex;flex-direction:column;gap:12px">
      <label class="field">이메일<input class="input" id="em" type="email"></label>
      <label class="field">처음 비밀번호 (6자 이상 · 이미 있는 계정이면 비워도 됨)<input class="input" id="pw" type="text"></label>
      <label class="field">이름<input class="input" id="nm"></label><label class="field">부서<input class="input" id="dp"></label>
      <label class="field">권한<select class="input" id="rl">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${k === "viewer" ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>`, { ok: "등록" });
    if (!body) return;
    try {
      await store.be.createUser({ email: body.querySelector("#em").value.trim(), password: body.querySelector("#pw").value, name: body.querySelector("#nm").value.trim(), dept: body.querySelector("#dp").value.trim(), role: body.querySelector("#rl").value });
      toast("등록했습니다");
      load();
    } catch (err) { toast(err.message, "err", 6000); }
  };
  void busy; void confirmBox;
  await load();
}
