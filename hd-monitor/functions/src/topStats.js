// 대시보드 '조회수 TOP · 댓글수 TOP': 최근 30일 글 중 숫자가 큰 글을 문서 하나에 모아 둠
// (화면이 게시물 수천 건을 읽지 않도록 · 새 글 저장할 때와 유튜브 숫자 새로 고칠 때 갱신)
import { db } from "./db.js";

const REF = "status/top";
const KEEP = 120;
const ms = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : +t || 0);

export async function updateTop(posts) {
  // 이슈 게시물만 (가비지는 순위에서 뺌)
  const cand = posts.filter((p) => p && p.id && (p.isIssue || p.must) && (typeof p.views === "number" || typeof p.comments === "number"));
  if (!cand.length) return;
  const snap = await db.doc(REF).get();
  const cut = Date.now() - 30 * 86400e3;
  const by = new Map((snap.data()?.items || []).map((x) => [x.id, x]));
  for (const p of cand) {
    by.set(p.id, {
      id: p.id, title: String(p.title || "").slice(0, 120), url: p.url, channel: p.channel, source: String(p.source || "").slice(0, 60), sourceId: String(p.sourceId || "").slice(0, 60),
      time: ms(p.time || p.postedAt || p.collectedAt), short: !!p.short,
      views: typeof p.views === "number" ? p.views : by.get(p.id)?.views ?? null,
      comments: typeof p.comments === "number" ? p.comments : by.get(p.id)?.comments ?? null,
      likes: typeof p.likes === "number" ? p.likes : by.get(p.id)?.likes ?? null,
    });
  }
  const all = [...by.values()].filter((x) => x.time >= cut);
  const top = (k) => all.filter((x) => typeof x[k] === "number").sort((a, b) => b[k] - a[k]).slice(0, KEEP);
  const keep = new Map([...top("views"), ...top("comments")].map((x) => [x.id, x]));
  await db.doc(REF).set({ items: [...keep.values()], at: new Date() });
}
