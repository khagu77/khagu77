// 인스타그램: Meta 공식 Instagram API(페이스북 로그인 방식) 해시태그 검색 — 개발 모드(심사 없이) · 연결한 비즈니스 계정으로
// 한도: 계정당 7일에 서로 다른 해시태그 30개 · 시간당 호출 200회 → 5분마다 해시태그 몇 개씩 돌아가며 최근 게시물 확인
import { getState, setState, SECRETS_REF } from "../db.js";
import { fetchWithTimeout } from "../util.js";

const G = "https://graph.facebook.com";

async function graph(path, params) {
  const r = await fetchWithTimeout(`${G}/${path}?${new URLSearchParams(params)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error(j.error?.message || `HTTP ${r.status}`);
    e.code = j.error?.code;
    throw e;
  }
  return j;
}

export const parseHashtags = (text) => [...new Set(String(text || "").split(/[\s,+#\n]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);

// 연결: 페이스북 로그인 코드 → 60일 토큰 → 연결된 인스타그램 비즈니스 계정 찾기
export async function igConnect(code, redirectUri, secrets) {
  if (!secrets.metaAppId || !secrets.metaAppSecret) throw new Error("설정 → API 키에 Meta 앱 ID·앱 시크릿 코드를 먼저 넣어 주세요");
  const short = await graph("oauth/access_token", { client_id: secrets.metaAppId, client_secret: secrets.metaAppSecret, redirect_uri: redirectUri, code });
  const long = await graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: secrets.metaAppId, client_secret: secrets.metaAppSecret, fb_exchange_token: short.access_token });
  const pages = await graph("me/accounts", { fields: "name,instagram_business_account{id,username}", access_token: long.access_token, limit: "100" });
  const page = (pages.data || []).find((p) => p.instagram_business_account);
  if (!page) throw new Error("연결된 인스타그램 비즈니스 계정을 찾지 못했습니다. 인스타그램 계정을 비즈니스로 바꾸고 페이스북 페이지에 연결했는지, 로그인할 때 그 페이지를 선택했는지 확인해 주세요");
  const ig = page.instagram_business_account;
  const data = { igToken: long.access_token, igTokenExp: Date.now() + (long.expires_in || 60 * 86400) * 1000, igUserId: ig.id, igUsername: ig.username || "", igPage: page.name || "" };
  await SECRETS_REF().set(data, { merge: true });
  return { username: data.igUsername, page: data.igPage, expiresAt: data.igTokenExp };
}

// 60일 토큰을 만료 10일 전에 자동 연장
async function refreshIfNeeded(secrets, log) {
  if (!secrets.igToken || !(secrets.igTokenExp - Date.now() < 10 * 86400e3)) return secrets.igToken;
  try {
    const long = await graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: secrets.metaAppId, client_secret: secrets.metaAppSecret, fb_exchange_token: secrets.igToken });
    await SECRETS_REF().set({ igToken: long.access_token, igTokenExp: Date.now() + (long.expires_in || 60 * 86400) * 1000 }, { merge: true });
    log.push("인스타그램: 로그인 토큰 연장");
    return long.access_token;
  } catch (e) {
    log.push(`인스타그램: 토큰 연장 실패 — 설정에서 다시 연결해 주세요 (${e.message})`);
    return secrets.igToken;
  }
}

export async function collectInstagram({ settings, secrets, log }) {
  const ig = settings.instagram || {};
  if (!ig.on || !secrets.igToken || !secrets.igUserId) return [];
  const tags = parseHashtags(ig.hashtags);
  if (!tags.length) return [];
  const token = await refreshIfNeeded(secrets, log);
  const st = await getState("instagram");
  st.ids ||= {};
  st.seen ||= {};
  if (st.pauseUntil > Date.now()) { log.push(`인스타그램: 한도 때문에 잠시 쉬는 중 (${Math.ceil((st.pauseUntil - Date.now()) / 60000)}분)`); return []; }
  const perTick = Math.max(1, Math.min(10, Number(ig.perTick) || 4));
  let i = (st.i || 0) % tags.length;
  const out = [];
  let done = 0;
  for (let n = 0; n < Math.min(perTick, tags.length); n++) {
    const tag = tags[i];
    i = (i + 1) % tags.length;
    try {
      if (!st.ids[tag]) {
        const r = await graph("ig_hashtag_search", { user_id: secrets.igUserId, q: tag, access_token: token });
        st.ids[tag] = r.data?.[0]?.id || "none";
      }
      if (st.ids[tag] === "none") continue;
      const r = await graph(`${st.ids[tag]}/recent_media`, { user_id: secrets.igUserId, fields: "id,caption,permalink,timestamp,media_type,like_count,comments_count", limit: "50", access_token: token });
      done++;
      const seen = new Set(st.seen[tag] || []);
      for (const m of r.data || []) {
        if (!m.permalink || seen.has(m.id)) continue;
        const cap = String(m.caption || "").replace(/\s+/g, " ").trim();
        const d = new Date(m.timestamp);
        out.push({
          channel: "instagram", title: (cap.split(/(?<=[.!?…])\s|#/)[0] || cap).slice(0, 100) || `#${tag} 게시물`, desc: cap.slice(0, 400),
          url: m.permalink, source: `#${tag}`, sourceId: tag, postedAt: isNaN(d) ? null : d, via: "instagram", query: tag,
          comments: m.comments_count ?? null, likes: m.like_count ?? null,
        });
      }
      st.seen[tag] = (r.data || []).map((m) => m.id).slice(0, 100);
    } catch (e) {
      log.push(`인스타그램 #${tag}: ${e.message}`.slice(0, 160));
      if (e.code === 4 || e.code === 17 || e.code === 32 || /limit/i.test(e.message)) { st.pauseUntil = Date.now() + 60 * 60e3; break; }
      if (e.code === 190) { log.push("인스타그램: 로그인이 만료됐습니다. 설정 → API 키에서 다시 연결해 주세요"); break; }
    }
  }
  st.i = i;
  await setState("instagram", st);
  log.push(`인스타그램: 해시태그 ${done}개 확인 (전체 ${tags.length}개 중), 새 게시물 ${out.length}건`);
  return out;
}
