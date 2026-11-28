// 점검(읽기 전용): 뽐뿌 글(no=983369)이 저장됐는지 · 수집 도우미 기록
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
for (const u of ["https://www.ppomppu.co.kr/zboard/view.php?id=car&no=983369", "https://www.ppomppu.co.kr/zboard/view.php?id=car&page=1&divpage=184&&no=983369"]) {
  const s = await db.doc(`posts/${hash(canonicalUrl(u))}`).get();
  console.log("주소", canonicalUrl(u), "→", s.exists ? `저장됨 · ${s.data().title} · cats=${s.data().cats} · via=${s.data().via}` : "없음");
}
const all = await db.collection("posts").where("channel", "==", "ppomppu").select("url", "title", "collectedAt", "via").get();
const near = all.docs.map((d) => d.data()).filter((p) => /no=98336\d|no=98337\d/.test(p.url));
console.log("근처 번호 저장 글:", near.map((p) => `${p.url.match(/no=(\d+)/)[1]} ${p.via} ${String(p.title).slice(0, 25)}`).join(" | ") || "없음");
console.log("뽐뿌 저장 글 전체:", all.size);
const ext = (await db.doc("state/ext_runs").get()).data()?.items || [];
for (const r of ext.slice(0, 5)) console.log("도우미", kst(r.at.toDate()), r.client, "받음", r.received, "새글", r.created, "|", String(r.naver || "").slice(0, 160));
const settings = (await db.doc("settings/main").get()).data();
console.log("뽐뿌 게시판 설정:", JSON.stringify((settings.boards || []).filter((b) => /ppomppu/.test(b.url))).slice(0, 300));
