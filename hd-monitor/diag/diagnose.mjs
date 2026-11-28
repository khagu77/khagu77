// 점검(읽기 전용): 5분 수집 함수 최근 로그(경고·오류) · 저장된 마지막 수집
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 19).replace("T", " ");
const runs = (await db.doc("state/runs").get()).data()?.items || [];
console.log("지금", kst(Date.now()), "| 저장된 마지막 수집:", runs.slice(0, 3).map((r) => kst(r.at.toDate())).join(", "));
const v = (await db.doc(`posts/${hash(canonicalUrl("https://www.youtube.com/watch?v=cbQAELeJ9rc"))}`).get()).data() || {};
console.log("우파푸른하늘 영상:", v.cats, v.isIssue);
const { access_token } = await applicationDefault().getAccessToken();
const since = new Date(Date.now() - 40 * 60e3).toISOString();
const filter = `timestamp>="${since}" AND (resource.labels.service_name="collecttick" OR resource.labels.function_name="collectTick") AND severity>=DEFAULT`;
const r = await fetch("https://logging.googleapis.com/v2/entries:list", { method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ resourceNames: [`projects/${process.env.GCLOUD_PROJECT}`], filter, orderBy: "timestamp desc", pageSize: 40 }) });
const j = await r.json();
if (!r.ok) console.log("로그 읽기 실패", r.status, j.error?.message?.slice(0, 200));
for (const e of j.entries || []) console.log(kst(e.timestamp), e.severity, e.httpRequest ? `HTTP ${e.httpRequest.status} ${e.httpRequest.latency || ""}` : "", String(e.textPayload || e.jsonPayload?.message || e.protoPayload?.status?.message || "").replace(/\s+/g, " ").slice(0, 260));
if (r.ok && !(j.entries || []).length) console.log("최근 40분 collectTick 로그 없음 (함수가 실행되지 않음)");
