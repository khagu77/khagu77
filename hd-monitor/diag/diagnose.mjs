// 점검(읽기 전용): 뉴스 댓글수 대기열 · 수집 도우미 기록 · 게시판 숫자 채우기
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const ext = (await db.doc("state/ext_runs").get()).data()?.items || [];
for (const r of ext.slice(0, 6)) console.log("도우미", r.at?.toDate?.().toISOString().slice(11, 16), r.client, "|", (r.log || []).filter((x) => /뉴스|댓글|대기열/.test(x)).join(" / "), "|", String(r.naver || "").slice(0, 120));
const q = (await db.doc("state/news_cmt_queue").get()).data();
console.log("대기열:", q ? `${q.items.length}건 · 확인할 때 된 것 ${q.items.filter((x) => x.next <= Date.now()).length}` : "없음");
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 6)) console.log("수집", r.at.toDate().toISOString().slice(11, 16), "|", (r.log || []).filter((x) => /게시판 조회수|뉴스 댓글|유튜브 조회수|오류/.test(x)).join(" / ").slice(0, 250));
for (const ch of ["bobae", "clien"]) {
  const s = await db.collection("posts").where("channel", "==", ch).select("views", "comments").get();
  console.log(ch, "전체", s.size, "| 조회수 있음", s.docs.filter((d) => typeof d.data().views === "number").length, "| 댓글수 있음", s.docs.filter((d) => typeof d.data().comments === "number").length);
}
