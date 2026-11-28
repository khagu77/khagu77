// 점검(읽기 전용): 게시물 수 세기 — 정렬을 붙일 때와 뺄 때
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const from = Timestamp.fromDate(new Date(`${day}T00:00:00+09:00`));
for (const cat of ["all", "youtube_fav"]) {
  const base = db.collection("posts").where("cats", "array-contains", cat).where("time", ">=", from);
  for (const [name, q] of [["정렬 없음", base], ["최신순 정렬", base.orderBy("time", "desc")]]) {
    try { console.log(cat, name, "→", (await q.count().get()).data().count); }
    catch (e) { console.log(cat, name, "→ 실패:", String(e.message).slice(0, 90)); }
  }
  try { console.log(cat, "숏츠만 최신순 →", (await base.where("short", "==", true).orderBy("time", "desc").count().get()).data().count); }
  catch (e) { console.log(cat, "숏츠만 → 실패:", String(e.message).slice(0, 90)); }
}
