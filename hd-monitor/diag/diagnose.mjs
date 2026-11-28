// 점검(읽기 전용): 새 제외어 규칙(뉴스·관심 채널·관심 동호회 예외)으로 돌아올 글 수
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildContext, classify } from "./src/classify.js";
const db = getFirestore(initializeApp(), "hdmon");
const st = (await db.doc("settings/main").get()).data();
const ctx = buildContext(st);
console.log("우파 관심 채널 등록:", (st.favYoutube || []).filter((y) => /우파/.test(y.name)).map((y) => `${y.name}(${y.id})`));
const snap = await db.collection("posts").where("collectedAt", ">=", new Date(Date.now() - 3 * 86400e3)).get();
const back = {}; let issue = 0;
for (const d of snap.docs) { const p = d.data(); if (!p.excluded || p.manualGarbage) continue; const c = classify({ ...p, desc: p.descFull || p.desc, requireMatch: false }, ctx); if (!c) continue; const k = `${p.channel}${c.fav ? "(관심)" : ""}`; back[k] = (back[k] || 0) + 1; if (c.isIssue) issue++; }
console.log("다시 분류하면 돌아올 글:", back, "| 그중 이슈:", issue);
