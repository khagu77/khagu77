// 이 시스템 전용 Firestore 데이터베이스(hdmon) — 같은 프로젝트의 유튜브 모니터링 데이터와 완전히 분리
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { DEFAULT_SETTINGS } from "./defaults.js";

export const DB_ID = "hdmon";
const app = getApps()[0] || initializeApp();
export const db = getFirestore(app, DB_ID);
export { FieldValue, Timestamp };

export const SETTINGS_REF = () => db.doc("settings/main");
export const SECRETS_REF = () => db.doc("secrets/main");

let cache = null;
let cacheAt = 0;
export async function getSettings(fresh = false) {
  if (!fresh && cache && Date.now() - cacheAt < 30000) return cache;
  const snap = await SETTINGS_REF().get();
  if (!snap.exists) {
    await SETTINGS_REF().set({ ...DEFAULT_SETTINGS, updatedAt: FieldValue.serverTimestamp() });
    cache = DEFAULT_SETTINGS;
  } else {
    const d = snap.data();
    // 예전 기본값(9,000)은 같은 프로젝트의 유튜브 모니터링 시스템 할당량을 거의 다 써 버려 3,000 으로 낮춤 (1회)
    if (d.collect?.youtubeDailyUnits === 9000 && !d.collect?.ytUnitsFixed) {
      d.collect = { ...d.collect, youtubeDailyUnits: 3000, ytUnitsFixed: true };
      await SETTINGS_REF().set({ collect: d.collect }, { merge: true });
    }
    // 인스타그램 카테고리가 없으면 가비지 앞에 한 번 추가
    if (Array.isArray(d.categories) && !d.igCatAdded && !d.categories.some((c) => (c.channels || []).includes("instagram"))) {
      const gi = d.categories.findIndex((c) => c.id === "garbage");
      const cat = DEFAULT_SETTINGS.categories.find((c) => c.id === "instagram");
      d.categories.splice(gi < 0 ? d.categories.length : gi, 0, cat);
      d.igCatAdded = true;
      await SETTINGS_REF().set({ categories: d.categories, igCatAdded: true }, { merge: true });
    }
    // 새 버전에서 추가된 설정 항목은 기본값으로 채움
    cache = {
      ...DEFAULT_SETTINGS,
      ...d,
      collect: { ...DEFAULT_SETTINGS.collect, ...(d.collect || {}), naver: { ...DEFAULT_SETTINGS.collect.naver, ...(d.collect?.naver || {}) } },
      alert: { ...DEFAULT_SETTINGS.alert, ...(d.alert || {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(d.ai || {}) },
      instagram: { ...DEFAULT_SETTINGS.instagram, ...(d.instagram || {}) },
    };
  }
  cacheAt = Date.now();
  return cache;
}

export async function getSecrets() {
  const s = await SECRETS_REF().get();
  return s.exists ? s.data() : {};
}

export async function getState(id) {
  const s = await db.doc(`state/${id}`).get();
  return s.exists ? s.data() : {};
}
export const setState = (id, data) => db.doc(`state/${id}`).set(data);
