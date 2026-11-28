// 점검(읽기 전용): 유튜브·커뮤니티 글의 조회수·댓글수 저장 상태
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const since = new Date(Date.now() - 6 * 3600e3);
const snap = await db.collection("posts").where("collectedAt", ">=", since).select("channel", "views", "comments", "likes", "via", "url", "collectedAt").get();
const by = {};
for (const d of snap.docs) {
  const p = d.data();
  const b = (by[p.channel] ||= { n: 0, views: 0, comments: 0, likes: 0, ex: [] });
  b.n++; if (typeof p.views === "number") b.views++; if (typeof p.comments === "number") b.comments++; if (typeof p.likes === "number") b.likes++;
  if (b.ex.length < 2 && ["youtube", "bobae", "clien", "ppomppu"].includes(p.channel)) b.ex.push(`${p.via} ${p.collectedAt.toDate().toISOString().slice(11, 16)} v=${p.views} c=${p.comments}`);
}
for (const [ch, b] of Object.entries(by)) console.log(ch, "최근 6시간", b.n, "| 조회수", b.views, "댓글수", b.comments, "좋아요", b.likes, "|", b.ex.join(" ; "));
const sec = (await db.doc("secrets/main").get()).data() || {};
console.log("유튜브 키 개수:", String(sec.youtubeKeys || "").split(/\s+/).filter(Boolean).length);
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const r of runs.slice(0, 8)) { const l = (r.log || []).filter((x) => /유튜브|커뮤니티|조회수|통계/.test(x)); console.log("수집", r.at.toDate().toISOString().slice(11, 16), "|", l.join(" / ").slice(0, 300)); }
const top = (await db.doc("status/top").get()).data();
console.log("TOP 문서:", top ? `${top.items.length}건, ${top.at?.toDate?.().toISOString()}` : "없음");
