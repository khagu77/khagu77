// 점검(읽기 전용): 오늘 통계의 숏츠 수 · 유튜브 카테고리 건수 비교
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { kstParts } from "./src/util.js";
const db = getFirestore(initializeApp(), "hdmon");
const { day } = kstParts(new Date());
const st = (await db.doc(`stats/${day}`).get()).data() || {};
const show = (o) => JSON.stringify(o || null).replace(/[{}]/g, " ");
console.log("오늘 문서:", day, "있음:", !!st.day);
console.log("cat:", show(st.cat));
console.log("shortCat:", show(st.shortCat));
const kst0 = new Date(`${day}T00:00:00+09:00`);
const snap = await db.collection("posts").where("collectedAt", ">=", kst0).get();
const byCat = {}, shortByCat = {}, oldPosted = {};
for (const d of snap.docs) {
  const p = d.data();
  if (p.channel !== "youtube") continue;
  for (const c of p.cats || []) {
    byCat[c] = (byCat[c] || 0) + 1;
    if (p.short) shortByCat[c] = (shortByCat[c] || 0) + 1;
    if (p.time && p.time.toDate() < new Date(Date.now() - 3 * 86400e3)) oldPosted[c] = (oldPosted[c] || 0) + 1;
  }
}
console.log("오늘 수집 유튜브 글 카테고리별:", show(byCat));
console.log("그중 숏츠:", show(shortByCat));
console.log("그중 작성 3일 넘은 글:", show(oldPosted));
console.log("backfill:", show((await db.doc("state/shorts_backfill").get()).data()));
