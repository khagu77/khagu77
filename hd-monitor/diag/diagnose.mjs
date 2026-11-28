// 점검(읽기 전용): 자동차 커뮤니티 · 유튜브 숫자 저장, 뉴스 댓글수 대기열
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
for (const ch of ["bobae", "clien", "ppomppu", "youtube"]) {
  const snap = await db.collection("posts").where("channel", "==", ch).select("views", "comments", "collectedAt", "title", "via").get();
  const docs = snap.docs.map((d) => d.data()).sort((a, b) => b.collectedAt.toMillis() - a.collectedAt.toMillis()).slice(0, 6);
  console.log(`== ${ch} (전체 ${snap.size})`);
  for (const p of docs) console.log(" ", p.collectedAt.toDate().toISOString().slice(11, 16), p.via, "조회", p.views, "댓글", p.comments, "|", String(p.title).slice(0, 30));
}
const q = (await db.doc("state/news_cmt_queue").get()).data()?.items || [];
console.log("뉴스 댓글 대기열:", q.length, "| 확인할 때 된 것:", q.filter((x) => x.next <= Date.now()).length);
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 6)) { const l = (r.log || []).filter((x) => /커뮤니티|유튜브 조회|오류|통계/.test(x)); console.log("수집", r.at.toDate().toISOString().slice(11, 16), "|", l.join(" / ").slice(0, 250)); }
