// 성향 바꾸기 (담당자 지정 · AI 분석 공통): 게시물 + 일별 통계의 성향 건수 + 대시보드 실시간 피드를 한꺼번에
import { db, FieldValue } from "./db.js";
import { kstParts } from "./util.js";

// updates: [{ id, sentiment, by, reason }] · known: 이미 읽어 둔 게시물 (id → 데이터, 없으면 읽음)
export async function applySentiment(updates, known = new Map(), extra = {}) {
  if (!updates.length) return 0;
  const miss = updates.filter((u) => !known.has(u.id));
  if (miss.length) for (const s of await db.getAll(...miss.map((u) => db.doc(`posts/${u.id}`)))) if (s.exists) known.set(s.id, s.data());
  const batch = db.batch();
  const inc = {};
  const bump = (day, f, k, n) => { if (!k) return; ((inc[day] ||= {})[f] ||= {})[k] = (inc[day][f][k] || 0) + n; };
  const changed = new Map();
  for (const u of updates) {
    const p = known.get(u.id);
    if (!p) continue;
    batch.update(db.doc(`posts/${u.id}`), { sentiment: u.sentiment, sentimentBy: u.by, sentimentReason: u.reason || "", ...extra, ...(u.by === "manual" ? {} : { analyzedAt: FieldValue.serverTimestamp() }) });
    if (u.sentiment !== p.sentiment && p.collectedAt) {
      const day = kstParts(p.collectedAt.toDate()).day;
      bump(day, "sent", p.sentiment, -1); bump(day, "sent", u.sentiment, 1);
      if (p.isIssue || p.must) { bump(day, "sentIssue", p.sentiment, -1); bump(day, "sentIssue", u.sentiment, 1); }
    }
    Object.assign(p, { sentiment: u.sentiment, sentimentBy: u.by, sentimentReason: u.reason || "" });
    changed.set(u.id, u.sentiment);
  }
  for (const [day, fields] of Object.entries(inc)) {
    const data = {};
    for (const [f, m] of Object.entries(fields)) { data[f] = {}; for (const [k, n] of Object.entries(m)) if (n) data[f][k] = FieldValue.increment(n); }
    batch.set(db.doc(`stats/${day}`), data, { merge: true });
  }
  await batch.commit();
  await syncLive(changed);
  return changed.size;
}

// 실시간 피드에 올라 있는 글이면 그 성향도 바로 바꿈
export async function syncLive(changed) {
  if (!changed.size) return;
  const ref = db.doc("status/live");
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const items = s.exists ? s.data().items || [] : [];
    let hit = false;
    const next = items.map((it) => (changed.has(it.id) && it.sentiment !== changed.get(it.id) ? ((hit = true), { ...it, sentiment: changed.get(it.id) }) : it));
    if (hit) tx.update(ref, { items: next });
  });
}
