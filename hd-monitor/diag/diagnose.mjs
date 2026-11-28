// 점검(읽기 전용): 우파푸른하늘 영상(cbQAELeJ9rc) 상태 · 유튜브 다시 분류 기록
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const s = await db.doc(`posts/${hash(canonicalUrl("https://www.youtube.com/watch?v=cbQAELeJ9rc"))}`).get();
const p = s.data() || {};
console.log("영상:", "cats", p.cats, "| isIssue", p.isIssue, "| kw", p.kw, "| 조회", p.views);
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 6)) console.log("수집", kst(r.at.toDate()), "|", (r.log || []).filter((x) => /유튜브 조회수|가비지 → 이슈|게시판 조회수|오류/.test(x)).join(" / ").slice(0, 260));
