// 현대차 온라인 이슈 모니터링 — Firebase Functions (codebase: hdmon, 서울 리전)
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { db, FieldValue, getSettings, getSecrets, SECRETS_REF, SETTINGS_REF } from "./src/db.js";
import { DEFAULT_SETTINGS } from "./src/defaults.js";
import { runCollection } from "./src/collect.js";
import { cleanupOldGarbage } from "./src/cleanup.js";
import { analyzePosts } from "./src/ai.js";
import { kakaoExchange, kakaoSend, kakaoDisconnect } from "./src/kakao.js";
import { buildContext, classify } from "./src/classify.js";
import { statsDelta } from "./src/store.js";
import { kstParts } from "./src/util.js";
import { SITE_URL } from "./src/alerts.js";

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
const SECRET_KEYS = ["naverKeys", "youtubeKeys", "geminiKey", "claudeKey", "kakaoRestKey", "kakaoSecret"];
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
  return secretsInfo(await getSecrets());
}));
function secretsInfo(s) {
  const lines = (t) => String(t || "").split(/\n/).map((x) => x.trim()).filter(Boolean).length;
  const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
  return {
    naverKeys: lines(s.naverKeys), youtubeKeys: words(s.youtubeKeys), geminiKey: !!s.geminiKey, claudeKey: !!s.claudeKey,
    kakaoRestKey: !!s.kakaoRestKey, kakaoSecret: !!s.kakaoSecret,
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
  const batch = db.batch();
  for (const r of res) batch.update(db.doc(`posts/${r.id}`), { sentiment: r.sentiment, sentimentBy: r.by, sentimentReason: r.reason, analyzedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { results: res, log };
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
    const cls = classify({ ...p, requireMatch: false }, ctx);
    const next = cls
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
