// 점검(읽기 전용): 우파푸른하늘 영상(cbQAELeJ9rc) 현재 상태 · 유튜브 다시 분류 기록
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const s = await db.doc(`posts/${hash(canonicalUrl("https://www.youtube.com/watch?v=cbQAELeJ9rc"))}`).get();
const p = s.data() || {};
console.log("영상:", s.exists, "| cats", p.cats, "| isIssue", p.isIssue, "| fav", p.fav, "| via", p.via, "| desc 길이", String(p.desc || "").length, "| 조회", p.views);
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 12)) { const l = (r.log || []).filter((x) => /유튜브 조회수|가비지 → 이슈|유튜브 통계|오류/.test(x)); if (l.length) console.log("수집", kst(r.at.toDate()), "|", l.join(" / ").slice(0, 260)); }
console.log("최근 수집 시각:", runs.slice(0, 3).map((r) => kst(r.at.toDate())).join(", "));
