// 점검(읽기 전용): 5분 수집(collectTick) 함수의 최근 실행 로그 · 저장된 마지막 수집
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const app = initializeApp();
const db = getFirestore(app, "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(11, 19);
const runs = (await db.doc("state/runs").get()).data()?.items || [];
console.log("저장된 마지막 수집:", runs.slice(0, 3).map((r) => kst(r.at.toDate())).join(", "), "| 지금", kst(Date.now()));
try {
  const { access_token } = await applicationDefault().getAccessToken();
  const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="collecttick" AND timestamp>="${new Date(Date.now() - 50 * 60e3).toISOString()}" AND (severity>=WARNING OR textPayload:"timeout" OR textPayload:"exceeded" OR httpRequest.status>=400)`;
  const r = await fetch("https://logging.googleapis.com/v2/entries:list", {
    method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ resourceNames: [`projects/${process.env.GCLOUD_PROJECT}`], filter, orderBy: "timestamp desc", pageSize: 25 }),
  });
  const j = await r.json();
  if (!r.ok) console.log("로그 읽기 실패:", r.status, j.error?.message?.slice(0, 200));
  for (const e of j.entries || []) console.log(kst(e.timestamp), e.severity, e.httpRequest ? `HTTP ${e.httpRequest.status} ${e.httpRequest.latency || ""}` : "", String(e.textPayload || e.jsonPayload?.message || "").slice(0, 220));
  if (r.ok && !(j.entries || []).length) console.log("최근 50분 경고·오류 로그 없음");
} catch (e) { console.log("로그 점검 오류:", e.message); }
