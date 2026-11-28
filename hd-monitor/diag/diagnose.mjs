// 점검(읽기 전용): 현재 키워드 그룹 구성
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const s = (await db.doc("settings/main").get()).data();
for (const g of s.keywordGroups || []) console.log(JSON.stringify({ id: g.id, name: g.name, role: g.role, issue: g.issue, alert: g.alert, collect: g.collect, requireTarget: g.requireTarget, rules: String(g.rules || "").replace(/\s+/g, " ").slice(0, 900) }));
