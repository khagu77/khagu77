// 점검(읽기 전용): Google 뉴스 묶음 검색 결과 · 쉬는 상태
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 8)) console.log("수집", kst(r.at.toDate()), "|", (r.log || []).filter((x) => /Google/.test(x)).join(" / "));
const g = (await db.doc("state/gnews").get()).data() || {};
console.log("Google 상태: 연속 막힘", g.strikes, "| 쉬는 끝", g.pauseUntil ? kst(g.pauseUntil) : "-");
// 2026-11-28T11:36:34Z 재점검
