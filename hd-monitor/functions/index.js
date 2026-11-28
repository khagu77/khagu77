// 현대차 온라인 이슈 모니터링 — Firebase Functions (codebase: hdmon, 서울 리전)
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import crypto from "node:crypto";
import { ingestFromExtension, extensionConfig } from "./src/external.js";
import { igConnect } from "./src/collectors/instagram.js";
import { getAuth } from "firebase-admin/auth";
import { db, FieldValue, getSettings, getSecrets, SECRETS_REF, SETTINGS_REF } from "./src/db.js";
import { DEFAULT_SETTINGS } from "./src/defaults.js";
import { runCollection } from "./src/collect.js";
import { cleanupOldGarbage } from "./src/cleanup.js";
import { analyzePosts } from "./src/ai.js";
import { applySentiment } from "./src/sentimentApply.js";
const SENT_LABELS = ["pos", "neu", "neg", "abuse"];
import { kakaoExchange, kakaoSend, kakaoDisconnect } from "./src/kakao.js";
import { buildContext, classify, categoriesFor } from "./src/classify.js";
import { statsDelta } from "./src/store.js";
import { kstParts } from "./src/util.js";
import { SITE_URL, formatAlert } from "./src/alerts.js";

setGlobalOptions({ region: "asia-northeast3", maxInstances: 5 });

const RANK = { viewer: 1, editor: 2, admin: 3 };

async function requireUser(req, min = "viewer") {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다");
  const snap = await db.doc(`users/${req.auth.uid}`).get();
  const p = snap.exists ? snap.data() : null;
  if (!p || p.status !== "active") throw new HttpsError("permission-denied", "관리자 승인 후 사용할 수 있습니다");
  if ((RANK[p.role] || 0) < RANK[min]) throw new HttpsError("permission-denied", "권한이 없습니다");
  return { uid: req.auth.uid, ...p };
}
const wrap = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", e.message || String(e));
  }
};

// ── 수집 (5분마다) ───────────────────────────────────────────
export const collectTick = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Asia/Seoul", timeoutSeconds: 280, memory: "512MiB", maxInstances: 1, retryCount: 0 },
  async () => { await runCollection(); },
);

// 가비지 정리 (매일 새벽 4시 10분): 보관 기간이 지난 가비지 글 삭제 — 일별 통계(가비지 건수)는 그대로 남음
export const cleanupGarbage = onSchedule(
  { schedule: "10 4 * * *", timeZone: "Asia/Seoul", timeoutSeconds: 540, memory: "512MiB", maxInstances: 1, retryCount: 0 },
  async () => { await cleanupOldGarbage(); },
);

export const runNow = onCall({ timeoutSeconds: 300, memory: "512MiB" }, wrap(async (req) => {
  await requireUser(req, "admin");
  const parts = Array.isArray(req.data?.parts) ? req.data.parts : null;
  return runCollection({ force: true, parts });
}));

// ── 로그인 · 사용자 ──────────────────────────────────────────
// 로그인할 때마다 호출: 프로필이 없으면 만든다 (맨 처음 가입자는 관리자)
export const me = onCall(wrap(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다");
  const ref = db.doc(`users/${req.auth.uid}`);
  let snap = await ref.get();
  if (!snap.exists) {
    const any = await db.collection("users").limit(1).get();
    const first = any.empty;
    await ref.set({
      email: req.auth.token.email || "",
      name: String(req.data?.name || req.auth.token.name || "").slice(0, 40),
      dept: String(req.data?.dept || "").slice(0, 40),
      role: first ? "admin" : "viewer",
      status: first ? "active" : "pending",
      alertOn: false,
      alertChannels: [],
      createdAt: FieldValue.serverTimestamp(),
    });
    snap = await ref.get();
  }
  await ref.set({ lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
  if (snap.data().status === "active") await getSettings(); // 설정 문서가 없으면 기본값으로 생성
  return { uid: req.auth.uid, ...snap.data(), createdAt: null, lastLoginAt: null };
}));

export const adminCreateUser = onCall(wrap(async (req) => {
  await requireUser(req, "admin");
  const { email, password, name = "", dept = "", role = "viewer" } = req.data || {};
  if (!email || !RANK[role]) throw new HttpsError("invalid-argument", "이메일·권한을 확인해 주세요");
  const auth = getAuth();
  let user;
  try {
    user = await auth.getUserByEmail(email); // 같은 프로젝트의 다른 시스템에 이미 있는 계정이면 그대로 사용
  } catch {
    if (!password || password.length < 6) throw new HttpsError("invalid-argument", "비밀번호는 6자 이상");
    user = await auth.createUser({ email, password, displayName: name });
  }
  await db.doc(`users/${user.uid}`).set({
    email, name, dept, role, status: "active", alertOn: false, alertChannels: [], createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { uid: user.uid };
}));

// 이 시스템에서만 삭제 (로그인 계정은 같은 프로젝트의 유튜브 시스템과 함께 쓰므로 기본은 남김)
export const adminDeleteUser = onCall(wrap(async (req) => {
  const me = await requireUser(req, "admin");
  const { uid, deleteAccount = false } = req.data || {};
  if (!uid || uid === me.uid) throw new HttpsError("invalid-argument", "자기 자신은 삭제할 수 없습니다");
  await Promise.all([db.doc(`users/${uid}`).delete(), db.doc(`kakao/${uid}`).delete()]);
  if (deleteAccount) await getAuth().deleteUser(uid).catch(() => {});
  return { ok: true };
}));

// ── API 키 (서버 전용 저장소) ─────────────────────────────────
const SECRET_KEYS = ["naverKeys", "youtubeKeys", "geminiKey", "claudeKey", "kakaoRestKey", "kakaoSecret", "metaAppId", "metaAppSecret"];
export const saveSecrets = onCall(wrap(async (req) => {
  await requireUser(req, "admin");
  const patch = {};
  for (const k of SECRET_KEYS) if (typeof req.data?.[k] === "string") patch[k] = req.data[k].trim();
  if (Object.keys(patch).length) await SECRETS_REF().set(patch, { merge: true });
  // 카카오 REST API 키는 로그인 주소에 그대로 보이는 공개 값이라 화면에서도 쓸 수 있게 설정에 복사
  const site = typeof req.data?.siteUrl === "string" && /^https:\/\//.test(req.data.siteUrl) ? req.data.siteUrl.replace(/\/$/, "") : null;
  if ("kakaoRestKey" in patch || site) {
    await SETTINGS_REF().set({ ...("kakaoRestKey" in patch ? { kakaoClientId: patch.kakaoRestKey } : {}), ...(site ? { siteUrl: site } : {}) }, { merge: true });
  }
  // Meta 앱 ID 도 로그인 주소에 보이는 공개 값이라 화면에서 쓸 수 있게
  if ("metaAppId" in patch) {
    await SETTINGS_REF().set({ metaAppId: patch.metaAppId }, { merge: true });
  }
  return secretsInfo(await getSecrets());
}));
function secretsInfo(s) {
  const lines = (t) => String(t || "").split(/\n/).map((x) => x.trim()).filter(Boolean).length;
  const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
  return {
    naverKeys: lines(s.naverKeys), youtubeKeys: words(s.youtubeKeys), geminiKey: !!s.geminiKey, claudeKey: !!s.claudeKey,
    kakaoRestKey: !!s.kakaoRestKey, kakaoSecret: !!s.kakaoSecret, ingestToken: !!s.ingestToken,
    metaAppId: !!s.metaAppId, metaAppSecret: !!s.metaAppSecret,
    instagram: s.igToken ? { username: s.igUsername || "", page: s.igPage || "", expiresAt: s.igTokenExp || null } : null,
  };
}
export const secretsStatus = onCall(wrap(async (req) => {
  await requireUser(req, "admin");
  return secretsInfo(await getSecrets());
}));

// 설정 되돌리기 (항목별)
export const resetSettings = onCall(wrap(async (req) => {
  await requireUser(req, "admin");
  const key = req.data?.key;
  if (!(key in DEFAULT_SETTINGS)) throw new HttpsError("invalid-argument", "알 수 없는 항목");
  await SETTINGS_REF().set({ [key]: DEFAULT_SETTINGS[key], updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
}));

// ── 카카오톡 ─────────────────────────────────────────────────
export const kakaoConnect = onCall(wrap(async (req) => {
  const u = await requireUser(req);
  const { code, redirectUri } = req.data || {};
  if (!code || !redirectUri) throw new HttpsError("invalid-argument", "카카오 인증 코드가 없습니다");
  await kakaoExchange(u.uid, code, redirectUri);
  await db.doc(`users/${u.uid}`).set({ alertOn: true }, { merge: true });
  return { ok: true };
}));
export const kakaoTest = onCall(wrap(async (req) => {
  const u = await requireUser(req);
  const s = await getSettings();
  await kakaoSend(u.uid, `🔔 [테스트] 현대차 온라인 이슈 모니터링\n\n알림이 잘 연결되었습니다.\n이슈 게시물이 수집되면 이렇게 알려 드립니다.`, `${s.siteUrl || SITE_URL}/#/posts`, await getSecrets(), "시스템 열기");
  return { ok: true };
}));
// 담당자가 고른 글을 카톡으로 바로 보내기 (나에게 · 알림 받는 모든 담당자)
export const kakaoShare = onCall({ timeoutSeconds: 120 }, wrap(async (req) => {
  const u = await requireUser(req, "editor");
  const ids = [...new Set((req.data?.ids || []).map(String))];
  if (!ids.length) throw new HttpsError("invalid-argument", "보낼 게시물을 고르세요");
  if (ids.length > 20) throw new HttpsError("invalid-argument", "카톡 발송은 한 번에 20건까지 고를 수 있습니다");
  const secrets = await getSecrets();
  if (!secrets.kakaoRestKey) throw new HttpsError("failed-precondition", "카카오 키가 없습니다 (설정 → API 키)");
  const snaps = await db.getAll(...ids.map((id) => db.doc(`posts/${id}`)));
  const posts = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
  let people;
  if (req.data?.to === "all") {
    const q = await db.collection("users").where("status", "==", "active").where("alertOn", "==", true).get();
    people = q.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((p) => p.kakaoConnected);
  } else people = [u];
  if (!people.some((p) => p.kakaoConnected)) throw new HttpsError("failed-precondition", req.data?.to === "all" ? "카톡을 연결하고 알림을 켠 담당자가 없습니다" : "먼저 '내 알림 · 정보'에서 카카오톡을 연결해 주세요");
  const s = await getSettings();
  const site = s.siteUrl || SITE_URL;
  const who = u.name || u.email || "담당자";
  let sent = 0;
  const fails = [];
  const got = [];
  for (const p of people.filter((x) => x.kakaoConnected)) {
    try {
      for (const post of posts) {
        await kakaoSend(p.uid, `📢 ${who} 공유\n${formatAlert(post)}`.slice(0, 200), `${site}/go.html?u=${encodeURIComponent(post.url)}`, secrets);
        sent++;
      }
      got.push(p.name || p.email || p.uid);
    } catch (e) { fails.push(`${p.name || p.email}: ${e.message}`); }
  }
  if (got.length) {
    const batch = db.batch();
    for (const post of posts) batch.update(db.doc(`posts/${post.id}`), { alerted: true, alertedAt: new Date(), alertedTo: FieldValue.arrayUnion(...got.slice(0, 20)) });
    await batch.commit();
  }
  return { sent, people: got, fails };
}));
export const kakaoUnlink = onCall(wrap(async (req) => {
  const u = await requireUser(req);
  await kakaoDisconnect(u.uid);
  return { ok: true };
}));

// ── AI 성향 재분석 ───────────────────────────────────────────
export const analyze = onCall({ timeoutSeconds: 300 }, wrap(async (req) => {
  await requireUser(req, "editor");
  const ids = [...new Set((req.data?.ids || []).map(String))].slice(0, 100);
  if (!ids.length) throw new HttpsError("invalid-argument", "분석할 게시물을 고르세요");
  const snaps = await db.getAll(...ids.map((id) => db.doc(`posts/${id}`)));
  const posts = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
  const log = [];
  const res = await analyzePosts(posts, await getSettings(), await getSecrets(), log);
  await applySentiment(res, new Map(posts.map((p) => [p.id, p])));
  return { results: res, log };
}));

// 담당자가 고른 글을 가비지로 (또는 되돌리기): 카테고리 · 일별 통계 · 실시간 피드를 함께 바꿈
// manualGarbage 표시가 있으면 '다시 분류'를 해도 가비지로 남음
export const moveToGarbage = onCall({ timeoutSeconds: 120 }, wrap(async (req) => {
  const u = await requireUser(req, "editor");
  const ids = [...new Set((req.data?.ids || []).map(String))].slice(0, 300);
  const undo = !!req.data?.undo;
  if (!ids.length) throw new HttpsError("invalid-argument", "게시물을 고르세요");
  const ctx = buildContext(await getSettings());
  const snaps = await db.getAll(...ids.map((id) => db.doc(`posts/${id}`)));
  const batch = db.batch();
  const inc = {};
  const bump = (day, f, k, n) => { ((inc[day] ||= {})[f] ||= {})[k] = (inc[day][f][k] || 0) + n; };
  const top = (day, k, n) => { (inc[day] ||= {})[k] = (inc[day][k] || 0) + n; };
  let n = 0;
  for (const s of snaps) {
    if (!s.exists) continue;
    const p = s.data();
    let next;
    if (!undo) {
      if (!(p.isIssue || p.must) && p.manualGarbage) continue;
      next = { isIssue: false, must: false, alert: false, manualGarbage: true };
    } else {
      if (!p.manualGarbage) continue;
      const cls = classify({ ...p, desc: p.descFull || p.desc, requireMatch: false }, ctx);
      next = { isIssue: !!cls?.isIssue, must: !!cls?.must, alert: !!cls?.alert, manualGarbage: false };
    }
    next.cats = categoriesFor({ ...p, ...next }, ctx.categories);
    next.editedBy = u.uid;
    next.editedAt = FieldValue.serverTimestamp();
    batch.update(s.ref, next);
    n++;
    // 일별 통계: 카테고리 · 이슈/가비지 건수 옮김
    if (p.collectedAt) {
      const day = kstParts(p.collectedAt.toDate()).day;
      for (const c of p.cats || []) if (!next.cats.includes(c)) bump(day, "cat", c, -1);
      for (const c of next.cats) if (!(p.cats || []).includes(c)) bump(day, "cat", c, 1);
      const was = !!(p.isIssue || p.must), now = !!(next.isIssue || next.must);
      if (was !== now) {
        top(day, "issue", now ? 1 : -1); top(day, "garbage", now ? -1 : 1);
        bump(day, "chIssue", p.channel, now ? 1 : -1);
        if (p.sentiment) bump(day, "sentIssue", p.sentiment, now ? 1 : -1);
      }
    }
  }
  for (const [day, fields] of Object.entries(inc)) {
    const data = {};
    for (const [f, v] of Object.entries(fields)) {
      if (typeof v === "number") data[f] = FieldValue.increment(v);
      else { data[f] = {}; for (const [k, x] of Object.entries(v)) if (x) data[f][k] = FieldValue.increment(x); }
    }
    batch.set(db.doc(`stats/${day}`), data, { merge: true });
  }
  if (n) await batch.commit();
  // 실시간 피드의 '이슈' 표시도
  const live = db.doc("status/live");
  await db.runTransaction(async (tx) => {
    const s = await tx.get(live);
    const items = s.exists ? s.data().items || [] : [];
    if (items.some((x) => ids.includes(x.id))) tx.update(live, { items: items.map((x) => (ids.includes(x.id) ? { ...x, isIssue: undo } : x)) });
  });
  return { moved: n };
}));

// '글 직접 추가'에서 주소만 넣으면 제목 · 작성 일시 · 요약 자동 입력
export const previewPostUrl = onCall({ timeoutSeconds: 30 }, wrap(async (req) => {
  await requireUser(req, "editor");
  const url = String(req.data?.url || "").trim();
  if (!/^https?:\/\//.test(url)) throw new HttpsError("invalid-argument", "주소(http…)를 넣어 주세요");
  const { previewUrl } = await import("./src/preview.js");
  return previewUrl(url, await getSecrets());
}));

// 담당자가 글을 직접 추가 (수집이 놓친 글): 주소로 채널을 정하고 다른 글과 같게 분류 · 저장
export const addPostManual = onCall({ timeoutSeconds: 60 }, wrap(async (req) => {
  const u = await requireUser(req, "editor");
  const url = String(req.data?.url || "").trim();
  const title = String(req.data?.title || "").trim().slice(0, 300);
  if (!/^https?:\/\//.test(url) || !title) throw new HttpsError("invalid-argument", "주소(http…)와 제목을 넣어 주세요");
  const host = (() => { try { return new URL(url).hostname.replace(/^(www|m)\./, ""); } catch { return ""; } })();
  let channel = "news", source = String(req.data?.source || "").trim().slice(0, 80), sourceId = "";
  const q = (k) => { try { return new URL(url).searchParams.get(k) || ""; } catch { return ""; } };
  if (/ppomppu\.co\.kr$/.test(host)) { channel = "ppomppu"; sourceId = `ppomppu:${q("id") || "car"}`; source ||= q("id") === "freeboard" ? "뽐뿌 자유게시판" : "뽐뿌 자동차포럼"; }
  else if (/bobaedream\.co\.kr$/.test(host)) { channel = "bobae"; sourceId = `bobae:${q("code") || "national"}`; source ||= "보배드림"; }
  else if (/clien\.net$/.test(host)) { channel = "clien"; sourceId = `clien:${(url.match(/\/board\/([^/?#]+)/) || [])[1] || ""}`; source ||= "클리앙"; }
  else if (/cafe\.naver\.com$/.test(host)) { channel = "cafe"; sourceId = (url.match(/cafe\.naver\.com\/([\w-]+)\/\d+/) || [])[1] || ""; }
  else if (/blog\.naver\.com$/.test(host)) { channel = "blog"; sourceId = (url.match(/blog\.naver\.com\/([\w-]+)/) || [])[1] || ""; }
  else if (/youtube\.com$|youtu\.be$/.test(host)) channel = "youtube";
  else if (/instagram\.com$/.test(host)) channel = "instagram";
  const d = req.data?.postedAt ? new Date(req.data.postedAt) : null;
  const item = { channel, url, title, desc: String(req.data?.desc || "").slice(0, 400), source, sourceId, postedAt: d && !isNaN(d) ? d : null, requireMatch: false, via: "manual" };
  const ctx = buildContext(await getSettings());
  const { ingest } = await import("./src/store.js");
  const log = [];
  const created = await ingest([item], ctx, log);
  if (!created.length) {
    const cls = classify(item, ctx);
    if (!cls) throw new HttpsError("failed-precondition", "제외어에 걸려 저장하지 않았습니다 (설정 → 키워드의 제외어 확인)");
    return { created: 0, exists: true };
  }
  await db.doc(`posts/${created[0].id}`).update({ addedBy: u.name || u.email || u.uid }).catch(() => {});
  return { created: 1, id: created[0].id, channel, isIssue: !!(created[0].isIssue || created[0].must), cats: created[0].cats };
}));

// 담당자가 성향 지정: 게시물 + 통계 + 실시간 피드를 함께 바꿈
export const setSentiment = onCall(wrap(async (req) => {
  const u = await requireUser(req, "editor");
  const ids = [...new Set((req.data?.ids || []).map(String))].slice(0, 300);
  const sentiment = String(req.data?.sentiment || "");
  if (!ids.length || !SENT_LABELS.includes(sentiment)) throw new HttpsError("invalid-argument", "게시물과 성향을 고르세요");
  const reason = `${u?.name || "담당자"} 지정`;
  const n = await applySentiment(ids.map((id) => ({ id, sentiment, by: "manual", reason })), new Map(), { editedBy: req.auth.uid, editedAt: FieldValue.serverTimestamp() });
  return { updated: n, reason };
}));

// ── 키워드·카테고리를 바꾼 뒤 최근 글 다시 분류 + 통계 다시 계산 ─────────
export const reclassify = onCall({ timeoutSeconds: 540, memory: "1GiB" }, wrap(async (req) => {
  await requireUser(req, "admin");
  const days = Math.min(31, Math.max(1, Number(req.data?.days) || 3));
  const ctx = buildContext(await getSettings(true));
  const { day: today } = kstParts();
  const start = new Date(Date.parse(`${today}T00:00:00+09:00`) - (days - 1) * 86400e3);
  const snap = await db.collection("posts").where("collectedAt", ">=", start).get();
  const byDay = new Map();
  let writer = db.bulkWriter();
  let changed = 0;
  for (const d of snap.docs) {
    const p = d.data();
    const cls = p.manualGarbage ? null : classify({ ...p, desc: p.descFull || p.desc, requireMatch: false }, ctx);
    const next = p.manualGarbage ? { ...p } : cls
      ? { ...p, targets: cls.targets, kw: cls.kw, kwGroups: cls.kwGroups, isIssue: cls.isIssue, alert: cls.alert, fav: cls.fav, must: cls.must, cats: cls.cats,
          sentiment: p.sentimentBy === "rule" ? cls.sentiment : p.sentiment }
      : { ...p, cats: [], isIssue: false, excluded: true };
    if (JSON.stringify([next.cats, next.kw, next.sentiment]) !== JSON.stringify([p.cats, p.kw, p.sentiment])) {
      writer.update(d.ref, { targets: next.targets || [], kw: next.kw || [], kwGroups: next.kwGroups || [], isIssue: !!next.isIssue, alert: !!next.alert, fav: !!next.fav, must: !!next.must, cats: next.cats, sentiment: next.sentiment, excluded: !!next.excluded });
      changed++;
    }
    if (next.excluded) continue;
    const k = kstParts(p.collectedAt.toDate()).day;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(next);
  }
  for (const [k, list] of byDay) writer.set(db.doc(`stats/${k}`), { day: k, ...statsDelta(list), rebuiltAt: new Date() });
  await writer.close();
  return { scanned: snap.size, changed, days };
}));

// ── 크롬 확장(수집 도우미)이 보내는 글 받기: 사이트가 서버 접속을 막는 곳(뽐뿌 등)을 담당자 PC 크롬이 읽어 보냄 ──
export const ingestExternal = onRequest({ timeoutSeconds: 120, memory: "512MiB", invoker: "public" }, async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") { res.status(405).json({ error: "GET·POST 만 받습니다" }); return; }
  const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secrets = await getSecrets();
  const ok = secrets.ingestToken && token.length === secrets.ingestToken.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secrets.ingestToken));
  if (!ok) { res.status(401).json({ error: "수집 토큰이 맞지 않습니다 (시스템 설정 → API 키 → 크롬 수집 도우미)" }); return; }
  try {
    if (req.method === "GET") { res.json(await extensionConfig(secrets)); return; }
    res.json(await ingestFromExtension(req.body || {}, secrets));
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// 수집 도우미 토큰 새로 만들기 (관리자) — 만든 값은 이 응답에서만 보임
export const makeIngestToken = onCall(wrap(async (req) => {
  await requireUser(req, "admin");
  const token = crypto.randomBytes(24).toString("hex");
  await SECRETS_REF().set({ ingestToken: token }, { merge: true });
  return { token };
}));

// 인스타그램 연결 (관리자): 페이스북 로그인 코드 → 서버가 토큰 보관
export const instagramConnect = onCall(wrap(async (req) => {
  await requireUser(req, "admin");
  const { code, redirectUri } = req.data || {};
  if (!code || !redirectUri) throw new HttpsError("invalid-argument", "페이스북 로그인 코드가 없습니다");
  return igConnect(code, redirectUri, await getSecrets());
}));
