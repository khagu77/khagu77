// 점검(읽기 전용): 유튜브 숏츠 판별 상태
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const since = new Date(Date.now() - 2 * 86400e3);
const snap = await db.collection("posts").where("channel", "==", "youtube").get();
let total = 0, recent = 0, sTrue = 0, sFalse = 0, sNone = 0, urlShorts = 0;
const samples = [];
for (const d of snap.docs) {
  const p = d.data(); total++;
  if (p.collectedAt?.toDate() >= since) recent++;
  if (p.short === true) sTrue++; else if (p.short === false) sFalse++; else sNone++;
  if (/\/shorts\//.test(p.url)) urlShorts++;
  if (samples.length < 6 && p.collectedAt?.toDate() >= since) samples.push(`${p.via} | short=${p.short} | ${p.url}`);
}
console.log({ total, recent, sTrue, sFalse, sNone, urlShorts });
samples.forEach((s) => console.log("예:", s));
console.log("backfill:", JSON.stringify((await db.doc("state/shorts_backfill").get()).data()));
const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
console.log("오늘 shortCat:", JSON.stringify((await db.doc(`stats/${day}`).get()).data()?.shortCat));
// 숏츠 주소 응답 확인 (서버에서 HEAD)
for (const s of samples.slice(0, 3)) {
  const vid = (s.match(/v=([\w-]+)/) || s.match(/shorts\/([\w-]+)/) || [])[1];
  if (!vid) continue;
  const r = await fetch(`https://www.youtube.com/shorts/${vid}`, { method: "HEAD", redirect: "manual" });
  console.log("HEAD", vid, r.status, r.headers.get("location"));
}
const run = (await db.doc("status/main").get()).data()?.lastRun;
console.log("마지막 수집:", (run?.log || []).join(" / "));
