// 점검(읽기 전용): 우파푸른하늘 영상이 다시 분류에서 빠진 이유
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
import { norm, parseRules, matchRules } from "./src/keywords.js";
const db = getFirestore(initializeApp(), "hdmon");
const s = await db.doc(`posts/${hash(canonicalUrl("https://www.youtube.com/watch?v=cbQAELeJ9rc"))}`).get();
const p = s.data() || {};
console.log("제목:", p.title, "| cats", p.cats, "| excluded", p.excluded, "| isIssue", p.isIssue, "| desc", (p.desc || "").length, "| descFull", (p.descFull || "").length);
const st = (await db.doc("settings/main").get()).data();
const ex = parseRules(st.keywordGroups.filter((g) => g.role === "exclude").map((g) => g.rules).join("+"));
const tgt = parseRules(st.keywordGroups.filter((g) => g.role === "target").map((g) => g.rules).join("+"));
const full = `${p.title} ${p.descFull || p.desc || ""}`;
console.log("제외어 걸림(제목):", matchRules(norm(p.title), ex));
console.log("제외어 걸림(전체):", matchRules(norm(full), ex));
console.log("관련어 걸림:", matchRules(norm(full), tgt).slice(0, 10));
for (const r of matchRules(norm(full), ex)) { const w = r.split("*")[0].trim(); const i = full.indexOf(w); console.log(" ·", r, "→", i >= 0 ? full.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, " ") : "(띄어쓰기 달라 원문 위치 못 찾음)"); }
// 최근 3일 유튜브 중 제외 처리된 글 수 · 걸린 제외어 분포
const snap = await db.collection("posts").where("collectedAt", ">=", new Date(Date.now() - 3 * 86400e3)).get();
const cnt = {}; let exN = 0, all = 0;
for (const d of snap.docs) { const q = d.data(); all++; if (!q.excluded) continue; exN++; const t = norm(`${q.title} ${q.descFull || q.desc || ""}`); for (const r of matchRules(t, ex)) cnt[`${q.channel}:${r}`] = (cnt[`${q.channel}:${r}`] || 0) + 1; }
console.log("최근 3일", all, "건 중 제외", exN, "건");
console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}=${v}`).join(", "));
