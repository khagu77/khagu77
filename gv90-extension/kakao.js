// 카카오톡 '나에게 보내기' 알림 (온라인 오전 일일동향 v1.10.118 과 같은 코드)
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
  const KOE = {
    KOE006: "리다이렉트 URI 가 등록되지 않았습니다. 설정 화면의 리다이렉트 URI 를 [복사]해 카카오 [플랫폼 키] → [REST API 키] → 리다이렉트 URI 에 그대로 등록해 주세요 (끝에 /kakao 까지)",
    KOE101: "REST API 키가 맞지 않습니다. [플랫폼 키] → [REST API 키]의 키를 다시 복사해 넣어 주세요 (JavaScript 키·네이티브 앱 키가 아님)",
    KOE004: "카카오 로그인이 꺼져 있습니다. [카카오 로그인] → 사용 설정을 ON 으로 바꿔 주세요",
    KOE205: "'카카오톡 메시지 전송' 동의항목이 설정되지 않았습니다. [카카오 로그인] → [동의항목]에서 카카오톡 메시지 전송을 '선택 동의'로 바꾸고 저장해 주세요",
    KOE007: "앱 정보가 맞지 않습니다. REST API 키를 다시 확인해 주세요",
  };
  async function precheck(url) {
    try {
      // 정상이면 카카오가 로그인 화면으로 넘기므로 따라가지 않는다 (따라가면 크롬 '오류'에 CORS 경고가 남음)
      const r = await fetch(url, { credentials: "omit", redirect: "manual" });
      if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) return "";
      const t = await r.text();
      const m = t.match(/KOE\d{3}/);
      if (m) return `카카오 설정 오류 ${m[0]}: ${KOE[m[0]] || "카카오 개발자 사이트 설정을 확인해 주세요"}`;
      if (!r.ok) return `카카오 로그인 화면을 불러오지 못했습니다 (HTTP ${r.status}). 리다이렉트 URI 등록·REST API 키·동의항목을 확인해 주세요`;
    } catch {}
    return "";
  }
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
    const pre = await precheck(url);
    if (pre) throw new Error(pre);
    let back;
    try {
      back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    } catch (e) {
      try { chrome.tabs.create({ url }); } catch {}
      throw new Error(`카카오 로그인 창이 열리지 않았습니다 (${e.message || e}). 새 탭에 카카오 화면을 열었으니 오류 번호(KOE…)를 확인해 주세요. 흔한 원인: 리다이렉트 URI 미등록(KOE006) · 카카오톡 메시지 전송 동의항목 미설정(KOE205) · 카카오 로그인 OFF(KOE004) · REST API 키 오류(KOE101)`);
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
  async function send(text, s) {
    const tk = await token(s.kakaoRestKey, s.kakaoSecret);
    const tpl = { object_type: "text", text: String(text).slice(0, 200), link: { web_url: "https://cafe.naver.com", mobile_web_url: "https://cafe.naver.com" } };
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
  async function disconnect() { await chrome.storage.local.remove(AUTH); }
  return { connect, send, status, disconnect, redirectUri };
})();
