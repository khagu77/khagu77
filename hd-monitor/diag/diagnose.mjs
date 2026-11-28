// 점검(읽기 전용): 카페 이름 — 장부 · 모르는 카페 · 도우미 버전 · gajasoso 같은 글의 경로
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const book = (await db.doc("status/cafeNames").get()).data()?.names || {};
const unk = (await db.doc("state/cafe_unknown").get()).data()?.ids || [];
console.log("장부:", Object.keys(book).length, "| 모르는 카페:", unk.length, "|", unk.slice(0, 20).join(", "));
console.log("gajasoso 장부:", book.gajasoso || "-", "| 모르는 목록에 있음:", unk.includes("gajasoso"));
const ext = (await db.doc("state/ext_runs").get()).data()?.items || [];
for (const r of ext.slice(0, 6)) console.log("도우미", r.at?.toDate?.().toISOString().slice(11, 16), r.client, "|", (r.log || []).join(" / ").slice(0, 160));
const snap = await db.collection("posts").where("sourceId", "==", "gajasoso").limit(5).get();
for (const d of snap.docs) { const p = d.data(); console.log("gajasoso 글:", p.via, "| source:", JSON.stringify(p.source), "|", p.collectedAt?.toDate?.().toISOString().slice(0, 16)); }
// 최근 피드 카페 중 이름 없는 것
const live = (await db.doc("status/live").get()).data()?.items || [];
const no = live.filter((x) => x.channel === "cafe" && (!x.source || x.source === x.sourceId));
console.log("피드 카페 이름 없음:", no.length, "/", live.filter((x) => x.channel === "cafe").length, no.map((x) => `${x.sourceId}${book[String(x.sourceId).toLowerCase()] ? "(장부 있음)" : ""}`).join(", "));
