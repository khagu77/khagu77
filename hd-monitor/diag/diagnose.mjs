// 점검(읽기 전용): 우파푸른하늘 영상(cbQAELeJ9rc) 현재 상태 · 최근 변경
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const s = await db.doc(`posts/${hash(canonicalUrl("https://www.youtube.com/watch?v=cbQAELeJ9rc"))}`).get();
const p = s.data() || {};
console.log("영상:", "cats", p.cats, "| isIssue", p.isIssue, "| kw", p.kw, "| targets", p.targets, "| fav", p.fav, "| 작성", p.time && kst(p.time.toDate()), "| 문서 수정", kst(s.updateTime.toDate()));
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 10)) { const l = (r.log || []).filter((x) => /가비지 → 이슈|유튜브 조회수|다시 분류/.test(x)); if (l.length) console.log("수집", kst(r.at.toDate()), "|", l.join(" / ")); }
