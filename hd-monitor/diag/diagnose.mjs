// 점검(읽기 전용): 20:20~20:40 사이 호출된 서버 기능 (누가 글을 바꿨는지)
import { initializeApp, applicationDefault } from "firebase-admin/app";
const P = process.env.GCLOUD_PROJECT;
initializeApp();
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 19).replace("T", " ");
const { access_token } = await applicationDefault().getAccessToken();
const filter = `timestamp>="2026-11-28T11:25:00Z" AND timestamp<="2026-11-28T11:40:00Z" AND resource.type="cloud_run_revision" AND httpRequest.requestMethod="POST"`;
const r = await fetch("https://logging.googleapis.com/v2/entries:list", { method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ resourceNames: [`projects/${P}`], filter, orderBy: "timestamp asc", pageSize: 100 }) });
const j = await r.json();
if (!r.ok) console.log("로그 실패", r.status, j.error?.message);
for (const e of j.entries || []) console.log(kst(e.timestamp), e.resource.labels.service_name, e.httpRequest.status, e.httpRequest.latency || "");
