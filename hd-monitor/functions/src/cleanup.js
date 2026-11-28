// 보관 기간이 지난 가비지 글 삭제 (이슈 글·중요 표시·메모 달린 글은 지우지 않음)
import { db, getSettings, getState, setState, Timestamp } from "./db.js";

export async function cleanupOldGarbage({ maxDelete = 30000 } = {}) {
  const settings = await getSettings(true);
  const days = Number(settings.collect?.garbageRetentionDays) || 0;
  if (days <= 0) return { deleted: 0, skipped: "off" };
  const cutoff = Timestamp.fromDate(new Date(Date.now() - days * 86400e3));
  let deleted = 0;
  let kept = 0;
  let last = null;
  while (deleted < maxDelete) {
    let q = db.collection("posts").where("cats", "array-contains", "garbage").where("collectedAt", "<", cutoff).orderBy("collectedAt", "desc").limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const w = db.bulkWriter();
    for (const d of snap.docs) {
      const p = d.data();
      if (p.star || p.memo || p.isIssue || p.must) { kept++; continue; }
      w.delete(d.ref);
      deleted++;
    }
    await w.close();
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  const prev = await getState("cleanup");
  await setState("cleanup", { at: new Date(), days, deleted, kept, total: (prev.total || 0) + deleted });
  return { deleted, kept, days };
}
