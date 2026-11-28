// 대시보드 '조회수 TOP · 댓글수 TOP': 최근 30일 글 중 숫자가 큰 글을 문서 하나에 모아 둠
// (화면이 게시물 수천 건을 읽지 않도록 · 새 글 저장할 때와 유튜브 숫자 새로 고칠 때 갱신)
import { db } from "./db.js";

const REF = "status/top";
const ms = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : +t || 0);

// 채널 묶음별로 따로 남김 — 한 목록에 섞어 120개만 남기면 숫자가 큰 유튜브에 밀려 커뮤니티 글이 들어왔다 빠졌다 함
const GROUP = { youtube: "youtube", cafe: "cafe", bobae: "community", clien: "community", ppomppu: "community", instagram: "instagram", news: "news", blog: "blog", post: "blog" };
const PER_GROUP = 30;

export async function updateTop(posts) {
  const list = posts.filter((p) => p && p.id);
  if (!list.length) return;
  const issue = (p) => (p.isIssue || p.must) && !p.manualGarbage && !p.excluded;
  // 여러 수집 작업이 동시에 고쳐도 서로 덮어쓰지 않도록 트랜잭션
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.doc(REF));
    const cut = Date.now() - 30 * 86400e3;
    const by = new Map((snap.data()?.items || []).map((x) => [x.id, x]));
    let touched = false;
    for (const p of list) {
      if (!issue(p)) { if (by.delete(p.id)) touched = true; continue; } // 가비지로 바뀐 글은 순위에서 뺌
      if (typeof p.views !== "number" && typeof p.comments !== "number") continue;
      touched = true;
      by.set(p.id, {
        id: p.id, title: String(p.title || "").slice(0, 120), url: p.url, channel: p.channel, source: String(p.source || "").slice(0, 60), sourceId: String(p.sourceId || "").slice(0, 60),
        time: ms(p.time || p.postedAt || p.collectedAt), short: !!p.short,
        views: typeof p.views === "number" ? p.views : by.get(p.id)?.views ?? null,
        comments: typeof p.comments === "number" ? p.comments : by.get(p.id)?.comments ?? null,
        likes: typeof p.likes === "number" ? p.likes : by.get(p.id)?.likes ?? null,
      });
    }
    if (!touched) return;
    const all = [...by.values()].filter((x) => x.time >= cut);
    const keep = new Map();
    for (const g of new Set(Object.values(GROUP))) {
      const inG = all.filter((x) => (GROUP[x.channel] || x.channel) === g);
      for (const k of ["views", "comments"]) inG.filter((x) => typeof x[k] === "number").sort((a, b) => b[k] - a[k]).slice(0, PER_GROUP).forEach((x) => keep.set(x.id, x));
    }
    tx.set(db.doc(REF), { items: [...keep.values()], at: new Date() });
  });
}
