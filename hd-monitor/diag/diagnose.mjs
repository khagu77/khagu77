// 점검(읽기 전용): 오늘(KST) 작성된 글 vs 오늘 수집된 글
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const now = new Date(); const day = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const from = new Date(`${day}T00:00:00+09:00`);
console.log("지금", kst(now), "| 오늘 0시", from.toISOString());
const byTime = await db.collection("posts").where("time", ">=", from).count().get();
const byCol = await db.collection("posts").where("collectedAt", ">=", from).get();
console.log("오늘 작성(time):", byTime.data().count, "| 오늘 수집:", byCol.size);
const ch = {}; for (const d of byCol.docs) { const p = d.data(); const t = p.time?.toDate?.(); const k = `${p.channel}:${t && t >= from ? "오늘작성" : "이전작성"}`; ch[k] = (ch[k] || 0) + 1; }
console.log(ch);
byCol.docs.slice(0, 8).forEach((d) => { const p = d.data(); console.log(" ·", p.channel, "작성", p.time ? kst(p.time.toDate()) : "-", "postedAt", p.postedAt ? kst(p.postedAt.toDate()) : "-", "| 수집", kst(p.collectedAt.toDate()), "|", (p.title || "").slice(0, 30)); });
