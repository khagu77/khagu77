// 점검(읽기 전용): 최근 자동차 커뮤니티·관심 동호회/유튜브 글의 저장 상태와 오늘 통계를 출력
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const fmt = (t) => (t?.toDate ? t.toDate().toISOString() : t);
const since = new Date(Date.now() - 2 * 86400e3);

const snap = await db.collection("posts").where("collectedAt", ">=", since).get();
const byCh = {};
const comm = [];
for (const d of snap.docs) {
  const p = d.data();
  byCh[p.channel] = byCh[p.channel] || { n: 0, issue: 0, inCommunityCat: 0, fav: 0 };
  const c = byCh[p.channel];
  c.n++; if (p.isIssue || p.must) c.issue++; if ((p.cats || []).includes("community")) c.inCommunityCat++; if (p.fav) c.fav++;
  if (["bobae", "clien", "ppomppu"].includes(p.channel)) comm.push(p);
}
console.log("최근 2일 수집 글 채널별:", JSON.stringify(byCh));
comm.sort((a, b) => b.collectedAt.toMillis() - a.collectedAt.toMillis());
for (const p of comm.slice(0, 15)) console.log("커뮤니티:", p.channel, "| via", p.via, "| time", fmt(p.time), "| collected", fmt(p.collectedAt), "| cats", (p.cats || []).join(","), "| hidden", p.hidden, "|", String(p.title).slice(0, 30));

const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const st = (await db.doc(`stats/${day}`).get()).data() || {};
console.log("오늘 통계 cat:", JSON.stringify(st.cat), "\nfavCafe:", JSON.stringify(st.favCafe), "\nfavYt:", JSON.stringify(st.favYt), "\nch:", JSON.stringify(st.ch));
const q = await db.collection("posts").where("cats", "array-contains", "community").orderBy("time", "desc").limit(5).get();
for (const d of q.docs) console.log("community 카테고리 최신:", fmt(d.data().time), d.data().channel, String(d.data().title).slice(0, 30));
const fixes = (await db.doc("state/fixes").get()).data();
console.log("1회 보정 상태:", JSON.stringify(fixes));
const run = (await db.doc("status/main").get()).data()?.lastRun;
console.log("마지막 수집:", fmt(run?.at), (run?.log || []).join(" / "));
