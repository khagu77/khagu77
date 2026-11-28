// 점검(읽기 전용): 오늘 '수집된' 글 vs 오늘 '작성된' 글 — 차이가 어디서 나는지
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const from = Timestamp.fromDate(new Date(`${day}T00:00:00+09:00`));
const c = async (q) => (await q.count().get()).data().count;
const P = db.collection("posts").where("cats", "array-contains", "all");
console.log("오늘 수집된 글:", await c(P.where("collectedAt", ">=", from).orderBy("collectedAt", "desc")));
console.log("오늘 작성된 글:", await c(P.where("time", ">=", from).orderBy("time", "desc")));
console.log("통계(오늘 수집) 전체:", (await db.doc(`stats/${day}`).get()).data()?.cat?.all);
// 오늘 수집됐지만 작성은 오늘 이전인 글: 채널별 · 며칠 전 글인지
const snap = await P.where("collectedAt", ">=", from).orderBy("collectedAt", "desc").select("channel", "time", "via").get();
const old = {}, age = { "1일": 0, "2~3일": 0, "4~7일": 0, "8~30일": 0, "30일+": 0 };
for (const d of snap.docs) {
  const p = d.data();
  const t = p.time?.toMillis?.() || 0;
  if (t >= from.toMillis()) continue;
  old[p.channel] = (old[p.channel] || 0) + 1;
  const dd = (from.toMillis() - t) / 86400e3;
  age[dd <= 1 ? "1일" : dd <= 3 ? "2~3일" : dd <= 7 ? "4~7일" : dd <= 30 ? "8~30일" : "30일+"]++;
}
console.log("오늘 수집 · 작성은 이전 (채널별):", JSON.stringify(old).replace(/[{}]/g, " "));
console.log("며칠 전 글인지:", JSON.stringify(age).replace(/[{}]/g, " "));
