// 점검(읽기 전용): 카페 이름 장부 상태 · 수집 도우미 버전
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const show = (o) => JSON.stringify(o ?? null).replace(/[{}]/g, " ");
const book = (await db.doc("status/cafeNames").get()).data()?.names || {};
console.log("장부 카페 수:", Object.keys(book).length, "예:", show(Object.fromEntries(Object.entries(book).slice(0, 8))));
const unk = (await db.doc("state/cafe_unknown").get()).data()?.ids || [];
console.log("모르는 카페 수:", unk.length, "예:", unk.slice(0, 15).join(", "));
const ext = (await db.doc("state/ext_runs").get()).data()?.items || [];
for (const r of ext.slice(0, 5)) console.log("도우미:", r.at?.toDate?.().toISOString(), r.client, "받음", r.received, "새글", r.created, "|", (r.log || []).join(" / ").slice(0, 200));
const live = (await db.doc("status/live").get()).data()?.items || [];
const cafes = live.filter((x) => x.channel === "cafe").slice(0, 8);
for (const c of cafes) console.log("피드 카페:", c.sourceId, "|", c.source, "| 장부:", book[String(c.sourceId).toLowerCase()] || "-");
const recent = await db.collection("posts").where("channel", "==", "cafe").orderBy("collectedAt", "desc").limit(200).get().catch((e) => ({ docs: [], err: e.message }));
let noName = 0, idName = 0, named = 0;
const vias = {};
for (const d of recent.docs) { const p = d.data(); const s = String(p.source || ""); if (!s) noName++; else if (s.toLowerCase() === String(p.sourceId).toLowerCase()) idName++; else named++; if (!s || s.toLowerCase() === String(p.sourceId).toLowerCase()) vias[p.via] = (vias[p.via] || 0) + 1; }
console.log("최근 카페 글 200:", "이름 있음", named, "/ 이름 없음", noName, "/ 아이디가 이름", idName, "| 이름 없는 글 경로:", show(vias), recent.err || "");
