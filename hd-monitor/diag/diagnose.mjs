// 점검(읽기 전용): 최근 2시간 언론 글 — 네이버 뉴스 주소 비율 · 이슈 여부 · 들어온 경로
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const since = new Date(Date.now() - 2 * 3600e3);
const snap = await db.collection("posts").where("channel", "==", "news").select("url", "isIssue", "must", "via", "collectedAt").get();
const t = {};
for (const d of snap.docs) {
  const p = d.data();
  if (p.collectedAt.toDate() < since) continue;
  const k = `${p.via} | 네이버뉴스주소=${/n\.news\.naver\.com\/mnews\/article\/\d{3}\/\d{6,}/.test(p.url)} | 이슈=${!!(p.isIssue || p.must)}`;
  t[k] = (t[k] || 0) + 1;
}
for (const [k, v] of Object.entries(t).sort((a, b) => b[1] - a[1])) console.log(v, k);
const q = (await db.doc("state/news_cmt_queue").get()).data();
console.log("대기열 문서:", q ? `${(q.items || []).length}건` : "없음");
