// 카카오톡 '나에게 보내기' (무료) — 담당자마다 자기 카카오 계정을 한 번 연결해 두면 각자의 '나와의 채팅'으로 알림
// 토큰은 서버 전용 문서(kakao/{uid})에만 저장 (화면에서 읽을 수 없음)
import { db, getSecrets } from "./db.js";

const KOE = {
  KOE006: "리다이렉트 URI 가 카카오 개발자 사이트에 등록되지 않았습니다",
  KOE101: "REST API 키가 맞지 않습니다",
  KOE004: "카카오 로그인이 꺼져 있습니다 (카카오 로그인 → 사용 설정 ON)",
  KOE205: "'카카오톡 메시지 전송' 동의항목이 설정되지 않았습니다",
  KOE010: "클라이언트 시크릿이 맞지 않습니다",
};
function errText(j, status) {
  const msg = j.error_description || j.msg || j.error || "";
  const code = j.error_code || j.code || status;
  const k = Object.keys(KOE).find((x) => String(msg + code).includes(x));
  if (/invalid_grant|-401/.test(String(code) + msg)) return "카카오 연결이 만료됐습니다. '내 알림'에서 다시 연결해 주세요";
  if (/insufficient scopes|-402/.test(String(code) + msg)) return "'카카오톡 메시지 전송' 동의가 필요합니다. 다시 연결해 주세요";
  return `카카오 오류 ${code}${msg ? `: ${msg}` : ""}${k ? ` — ${KOE[k]}` : ""}`;
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

function toAuth(j, prev = {}) {
  const now = Date.now();
  return {
    access: j.access_token,
    accessExp: now + (j.expires_in || 21600) * 1000,
    refresh: j.refresh_token || prev.refresh,
    refreshExp: j.refresh_token_expires_in ? now + j.refresh_token_expires_in * 1000 : prev.refreshExp || null,
    connectedAt: prev.connectedAt || now,
    updatedAt: now,
  };
}

export async function kakaoExchange(uid, code, redirectUri) {
  const s = await getSecrets();
  if (!s.kakaoRestKey) throw new Error("관리자가 아직 카카오 REST API 키를 넣지 않았습니다 (설정 → API 키)");
  const p = { grant_type: "authorization_code", client_id: s.kakaoRestKey, redirect_uri: redirectUri, code };
  if (s.kakaoSecret) p.client_secret = s.kakaoSecret;
  const a = toAuth(await tokenReq(p));
  await db.doc(`kakao/${uid}`).set(a);
  await db.doc(`users/${uid}`).set({ kakaoConnected: true, kakaoAt: new Date() }, { merge: true });
  return a;
}

async function accessToken(uid, secrets) {
  const ref = db.doc(`kakao/${uid}`);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().refresh) throw new Error("카카오톡이 연결되지 않았습니다");
  const a = snap.data();
  if (a.access && a.accessExp - Date.now() > 5 * 60e3) return a.access;
  const p = { grant_type: "refresh_token", client_id: secrets.kakaoRestKey, refresh_token: a.refresh };
  if (secrets.kakaoSecret) p.client_secret = secrets.kakaoSecret;
  try {
    const n = toAuth(await tokenReq(p), a);
    await ref.set(n);
    return n.access;
  } catch (e) {
    if (/만료/.test(e.message)) {
      await ref.delete();
      await db.doc(`users/${uid}`).set({ kakaoConnected: false, kakaoError: e.message }, { merge: true });
    }
    throw e;
  }
}

// text 는 200자까지, link 는 카카오 앱에 등록한 사이트 도메인이어야 함 → 우리 사이트의 /go.html 을 거쳐 원문으로 이동
export async function kakaoSend(uid, text, linkUrl, secrets, buttonTitle = "게시물 보기") {
  const tk = await accessToken(uid, secrets);
  const tpl = { object_type: "text", text: String(text).slice(0, 200), link: { web_url: linkUrl, mobile_web_url: linkUrl }, button_title: buttonTitle };
  const r = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(tpl) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.result_code !== 0) throw new Error(errText(j, r.status));
}

export async function kakaoDisconnect(uid) {
  await db.doc(`kakao/${uid}`).delete();
  await db.doc(`users/${uid}`).set({ kakaoConnected: false }, { merge: true });
}
