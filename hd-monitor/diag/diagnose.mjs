// 점검(읽기 전용): 20:48 이후 다시 분류 호출 결과(시간·상태) · 우파 영상 문서 수정 시각
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
const P = process.env.GCLOUD_PROJECT;
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 19).replace("T", " ");
const s = await db.doc(`posts/${hash(canonicalUrl("https://www.youtube.com/watch?v=cbQAELeJ9rc"))}`).get();
console.log("우파 영상 문서 수정:", kst(s.updateTime.toDate()), "| excluded", s.data().excluded);
const { access_token } = await applicationDefault().getAccessToken();
const q = async (filter) => { const r = await fetch("https://logging.googleapis.com/v2/entries:list", { method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ resourceNames: [`projects/${P}`], filter, orderBy: "timestamp asc", pageSize: 100 }) }); const j = await r.json(); if (!r.ok) console.log("로그 실패", j.error?.message); return j.entries || []; };
for (const e of await q(`timestamp>="2026-11-28T05:30:00Z" AND resource.type="cloud_run_revision" AND resource.labels.service_name="reclassify" AND httpRequest.requestMethod="POST"`)) console.log("다시 분류", kst(e.timestamp), e.httpRequest.status, e.httpRequest.latency || "");
for (const e of await q(`timestamp>="2026-11-28T11:45:00Z" AND resource.type="cloud_run_revision" AND resource.labels.service_name="reclassify" AND severity>=WARNING`)) console.log("경고", kst(e.timestamp), (e.textPayload || JSON.stringify(e.jsonPayload || {})).slice(0, 200));
