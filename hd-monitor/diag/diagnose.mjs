// 점검(읽기 전용): 관심 동호회 TOP — 카페별 수집 글 (작성일 7일 안/밖 · 경로 · 예시 제목)
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const since = Timestamp.fromDate(new Date(Date.now() - 7 * 86400e3));
const snap = await db.collection("posts").where("cats", "array-contains", "cafe_fav").where("collectedAt", ">=", since).orderBy("collectedAt", "desc").select("sourceId", "source", "title", "time", "via", "query", "isIssue").get();
const by = {};
for (const d of snap.docs) {
  const p = d.data();
  const k = p.sourceId || p.source;
  const b = (by[k] ||= { name: p.source, n: 0, in7: 0, old: 0, via: {}, q: {}, ex: [] });
  b.n++;
  if (p.time.toMillis() >= since.toMillis()) b.in7++; else b.old++;
  b.via[p.via] = (b.via[p.via] || 0) + 1;
  b.q[p.query] = (b.q[p.query] || 0) + 1;
  if (b.ex.length < 4) b.ex.push(`${p.time.toDate().toISOString().slice(0, 10)} ${String(p.title).slice(0, 34)}`);
}
const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 9);
for (const [id, b] of rows) {
  console.log(`== ${b.name} (${id}) 수집 ${b.n} | 작성 7일 안 ${b.in7} · 이전 ${b.old} | 경로 ${JSON.stringify(b.via).replace(/[{}"]/g, "")}`);
  console.log("   검색어 상위:", Object.entries(b.q).sort((a, c) => c[1] - a[1]).slice(0, 5).map(([q, n]) => `${q}(${n})`).join(", "));
  b.ex.forEach((e) => console.log("   예:", e));
}
