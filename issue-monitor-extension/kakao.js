// 카카오톡 '나에게 보내기' 알림 (담당자 요청 2026-11-22: 자동 수집 시작·끝을 카카오톡으로)
//  - 담당자 카카오 개발자 앱(REST API 키 · 클라이언트 시크릿)으로 한 번 연결(카카오 로그인)하면
//    토큰을 이 PC 크롬(chrome.storage.local "kakaoAuth")에만 두고, 만료 전에 알아서 갱신한다
//  - 액세스 토큰 6시간 · 리프레시 토큰 2개월 (한 달 안 남으면 보낼 때 새 리프레시 토큰을 받아 계속 이어짐)
//  - 알림이 실패해도 수집에는 영향 없음
const Kakao = (() => {
  const AUTH = "kakaoAuth";
  const redirectUri = () => (chrome.identity ? chrome.identity.getRedirectURL("kakao") : "");
  const errText = (j, status) => {
    const msg = j.error_description || j.msg || j.error || "";
    const code = j.error_code || j.code || status;
    const hint = /KOE006/.test(String(code) + msg) ? " — 카카오 개발자 사이트에 아래 리다이렉트 URI 를 등록해 주세요"
      : /KOE004/.test(String(code) + msg) ? " — 카카오 로그인 사용 설정을 ON 으로 해 주세요"
      : /KOE010|client_secret|invalid_client/i.test(String(code) + msg) ? " — 클라이언트 시크릿을 확인해 주세요"
      : /insufficient scopes|-402/.test(String(code) + msg) ? " — '카카오톡 메시지 전송' 동의항목을 켜고 다시 연결해 주세요"
      : /invalid_grant|-401/.test(String(code) + msg) ? " — 연결이 만료됐습니다. 설정에서 다시 연결해 주세요"
      : "";
    return `카카오 오류 ${code}${msg ? `: ${msg}` : ""}${hint}`;
  };
  async function tokenReq(params) {
    const r = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(params),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(errText(j, r.status));
    return j;
  }
  async function save(j, prev = {}) {
    const now = Date.now();
    const a = {
      access: j.access_token,
      accessExp: now + (j.expires_in || 21600) * 1000,
      refresh: j.refresh_token || prev.refresh,
      refreshExp: j.refresh_token_expires_in ? now + j.refresh_token_expires_in * 1000 : prev.refreshExp,
      at: prev.at || now,
    };
    await chrome.storage.local.set({ [AUTH]: a });
    return a;
  }
  async function connect(key, secret) {
    if (!key) throw new Error("REST API 키를 넣어 주세요");
    if (!chrome.identity) throw new Error("확장 프로그램을 새로고침한 뒤 다시 해 주세요 (카카오 로그인 권한)");
    const url = `https://kauth.kakao.com/oauth/authorize?${new URLSearchParams({ client_id: key, redirect_uri: redirectUri(), response_type: "code", scope: "talk_message" })}`;
    let back;
    try {
      back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    } catch (e) {
      throw new Error(`카카오 로그인 창이 닫혔거나 열리지 않았습니다 (${e.message || e}). 리다이렉트 URI 등록·REST API 키를 확인해 주세요.`);
    }
    const u = new URL(back);
    const code = u.searchParams.get("code");
    if (!code) throw new Error(u.searchParams.get("error_description") || u.searchParams.get("error") || "카카오 로그인이 취소되었습니다");
    const p = { grant_type: "authorization_code", client_id: key, redirect_uri: redirectUri(), code };
    if (secret) p.client_secret = secret;
    return save(await tokenReq(p));
  }
  async function token(key, secret) {
    const { [AUTH]: a } = await chrome.storage.local.get(AUTH);
    if (!a || !a.refresh) throw new Error("카카오톡이 연결되지 않았습니다 (설정 → 카카오톡 알림 → 카카오톡 연결)");
    if (a.access && a.accessExp - Date.now() > 5 * 60000) return a.access;
    const p = { grant_type: "refresh_token", client_id: key, refresh_token: a.refresh };
    if (secret) p.client_secret = secret;
    return (await save(await tokenReq(p), a)).access;
  }
  // 나와의 채팅으로 글 보내기 (텍스트 200자까지)
  async function send(text, s) {
    const tk = await token(s.kakaoRestKey, s.kakaoSecret);
    const tpl = {
      object_type: "text",
      text: String(text).slice(0, 200),
      link: { web_url: "https://cafe.naver.com", mobile_web_url: "https://cafe.naver.com" },
    };
    const r = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ template_object: JSON.stringify(tpl) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.result_code !== 0) throw new Error(errText(j, r.status));
  }
  async function status() {
    const { [AUTH]: a } = await chrome.storage.local.get(AUTH);
    return a && a.refresh ? a : null;
  }
  async function disconnect() {
    await chrome.storage.local.remove(AUTH);
  }
  return { connect, send, status, disconnect, redirectUri };
})();
