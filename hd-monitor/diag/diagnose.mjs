// 점검(읽기 전용): 제외 표시가 있지만 지금 규칙으론 제외가 아닌 글 — 언제 수집됐는지 · 예시
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildContext, classify } from "./src/classify.js";
import { getSettings } from "./src/db.js";
const db = getFirestore(initializeApp(), "hdmon");
const ctx = buildContext(await getSettings(true));
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const snap = await db.collection("posts").where("collectedAt", ">=", new Date(Date.now() - 3 * 86400e3)).get();
const byDay = {}; const ex = [];
for (const d of snap.docs) { const p = d.data(); if (!p.excluded || p.manualGarbage) continue; const c = classify({ ...p, desc: p.descFull || p.desc, requireMatch: false }, ctx); if (!c) continue;
  const k = `${p.channel}${c.fav ? "(관심)" : ""} ${kst(p.collectedAt.toDate()).slice(0, 5)}`; byDay[k] = (byDay[k] || 0) + 1;
  if (!c.fav && p.channel !== "news" && ex.length < 6) ex.push(`${p.channel} ${kst(p.collectedAt.toDate())} | ${p.title.slice(0, 50)} | 문서수정 ${kst(d.updateTime.toDate())}`); }
console.log(byDay); ex.forEach((x) => console.log(" ·", x));
