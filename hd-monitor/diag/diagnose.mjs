// 점검(읽기 전용): 뽐뿌 조회수·댓글수 — 수집 도우미 버전 · 최근 뽐뿌 글 · 뽐뿌 목록 화면 구조
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const ext = (await db.doc("state/ext_runs").get()).data()?.items || [];
for (const r of ext.slice(0, 4)) console.log("도우미", kst(r.at.toDate()), r.client, "|", String(r.naver || "").slice(0, 140));
const s = await db.collection("posts").where("channel", "==", "ppomppu").select("via", "views", "comments", "collectedAt", "title").get();
const docs = s.docs.map((d) => d.data()).sort((a, b) => b.collectedAt.toMillis() - a.collectedAt.toMillis()).slice(0, 8);
for (const p of docs) console.log("뽐뿌", kst(p.collectedAt.toDate()), p.via, "조회", p.views, "댓글", p.comments, "|", String(p.title).slice(0, 30));
try {
  const r = await fetch("https://www.ppomppu.co.kr/zboard/zboard.php?id=car", { headers: { "User-Agent": "Mozilla/5.0 (compatible; hd-monitor-diag)" } });
  const buf = Buffer.from(await r.arrayBuffer());
  let html = new TextDecoder("euc-kr").decode(buf);
  if (!/view\.php/.test(html)) html = buf.toString("utf8");
  console.log("뽐뿌 목록 응답", r.status, "길이", html.length);
  const i = html.search(/view\.php\?id=car&(amp;)?no=\d+/);
  if (i > 0) {
    const a = html.lastIndexOf("<tr", i), b = html.indexOf("</tr>", i);
    console.log("한 줄:", html.slice(a, b + 5).replace(/\s+/g, " ").replace(/<(script|style)[\s\S]*?<\/\1>/g, "").slice(0, 1800));
  }
} catch (e) { console.log("뽐뿌 목록 실패", e.message); }
