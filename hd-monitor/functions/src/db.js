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
    // 새 버전에서 추가된 설정 항목은 기본값으로 채움
    cache = {
      ...DEFAULT_SETTINGS,
      ...d,
      collect: { ...DEFAULT_SETTINGS.collect, ...(d.collect || {}), naver: { ...DEFAULT_SETTINGS.collect.naver, ...(d.collect?.naver || {}) } },
      alert: { ...DEFAULT_SETTINGS.alert, ...(d.alert || {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(d.ai || {}) },
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
