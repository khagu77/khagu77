// 점검(읽기 전용): 서버 수집이 돌고 있는지 · 수집 도우미 마지막 보고 · 새 기능 기록
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16);
console.log("지금(한국):", kst(new Date()));
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 8)) console.log("서버 수집", kst(r.at.toDate()), `${Math.round(r.ms / 1000)}초`, "새 글", r.created, "|", (r.log || []).filter((x) => /게시판 조회수|뉴스 댓글|유튜브 조회수|오류|실패/.test(x)).join(" / ").slice(0, 300));
const ext = (await db.doc("state/ext_runs").get()).data()?.items || [];
for (const r of ext.slice(0, 3)) console.log("도우미", kst(r.at.toDate()), r.client, "|", (r.log || []).filter((x) => /뉴스|대기열/.test(x)).join(" / "));
const q = (await db.doc("state/news_cmt_queue").get()).data();
console.log("뉴스 댓글 대기열:", q ? `${q.items.length}건` : "없음");
for (const ch of ["bobae", "clien"]) {
  const s = await db.collection("posts").where("channel", "==", ch).select("views", "comments").get();
  console.log(ch, "전체", s.size, "| 조회수 있음", s.docs.filter((d) => typeof d.data().views === "number").length, "| 댓글수 있음", s.docs.filter((d) => typeof d.data().comments === "number").length);
}
// 2026-11-28T07:06:52Z 재점검
