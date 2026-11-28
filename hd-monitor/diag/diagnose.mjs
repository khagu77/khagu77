// 점검(읽기 전용): 게시판 목록의 댓글 수 위치 · 유튜브 통계 요청 응답 (키 값은 출력하지 않음)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore(initializeApp(), "hdmon");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; hd-monitor-diag)" };
for (const [name, url, re] of [
  ["클리앙", "https://www.clien.net/service/board/cm_car", /\/service\/board\/cm_car\/\d+/],
  ["보배드림", "https://www.bobaedream.co.kr/list?code=national", /\/view\?code=national(&amp;|&)No=\d+/],
]) {
  try {
    const r = await fetch(url, { headers: UA });
    const html = await r.text();
    console.log(`== ${name} ${r.status} 길이 ${html.length}`);
    let i = 0, n = 0;
    while (n < 2) {
      const m = html.slice(i).match(re);
      if (!m) break;
      const at = i + m.index;
      const s = html.slice(Math.max(0, at - 700), at + 900).replace(/\s+/g, " ");
      console.log(`-- 예 ${n + 1}:`, s.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").slice(0, 1600));
      i = at + 2000; n++;
    }
  } catch (e) { console.log(name, "실패", e.message); }
}
const sec = (await db.doc("secrets/main").get()).data() || {};
const key = String(sec.youtubeKeys || "").split(/\s+/).filter(Boolean)[0];
if (key) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`);
  const j = await r.json().catch(() => ({}));
  console.log("유튜브 통계 요청:", r.status, j.error ? `${j.error.code} ${j.error.message} ${JSON.stringify(j.error.errors?.[0]?.reason || "")}` : `받음 ${j.items?.length}개 · 조회수 ${j.items?.[0]?.statistics?.viewCount}`);
  const s2 = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${encodeURIComponent(key)}`);
  const j2 = await s2.json().catch(() => ({}));
  console.log("유튜브 검색 요청:", s2.status, j2.error ? `${j2.error.code} ${j2.error.message}` : "정상");
}
