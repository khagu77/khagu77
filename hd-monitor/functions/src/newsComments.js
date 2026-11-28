// 네이버 뉴스 댓글수: 이슈 기사(네이버 뉴스 주소)를 대기열에 넣어 두면 크롬 수집 도우미가 댓글 수를 알아 와 줌
// (서버는 네이버가 막음 · 블로그/카페는 하지 않음)
import { db, getState, setState } from "./db.js";

const KEY = "news_cmt_queue";
const HOLD = 48 * 3600e3;
const art = (url) => String(url || "").match(/n\.news\.naver\.com\/mnews\/article\/(\d{3})\/(\d{6,})/);

export async function queueNews(created) {
  const add = created.filter((p) => p && p.id && p.channel === "news" && (p.isIssue || p.must) && art(p.url));
  if (!add.length) return;
  const st = await getState(KEY);
  const now = Date.now();
  const list = (st.items || []).filter((x) => now - x.at < HOLD);
  const have = new Set(list.map((x) => x.id));
  for (const p of add) if (!have.has(p.id)) { const m = art(p.url); list.push({ id: p.id, oid: m[1], aid: m[2], at: now, next: now }); }
  await setState(KEY, { items: list.slice(-800) });
}

// 수집 도우미에게 줄 기사 (확인할 때가 된 것부터)
export async function dueNews(n = 30) {
  const now = Date.now();
  const items = ((await getState(KEY)).items || []).filter((x) => now - x.at < HOLD && x.next <= now);
  return items.sort((a, b) => a.next - b.next).slice(0, n).map(({ id, oid, aid }) => ({ id, oid, aid }));
}

// 받은 댓글 수 반영: 처음 6시간은 30분마다, 그 뒤엔 3시간마다 다시 확인
export async function applyNewsComments(counts) {
  const ids = Object.keys(counts || {}).filter((id) => Number.isFinite(+counts[id]) && +counts[id] >= 0).slice(0, 100);
  if (!ids.length) return 0;
  const now = Date.now();
  const st = await getState(KEY);
  const list = (st.items || []).map((x) => (ids.includes(x.id) ? { ...x, next: now + (now - x.at < 6 * 3600e3 ? 30 : 180) * 60e3 } : x));
  await setState(KEY, { items: list });
  const snaps = await db.getAll(...ids.map((id) => db.doc(`posts/${id}`)));
  const batch = db.batch();
  const changed = [];
  for (const s of snaps) {
    if (!s.exists) continue;
    const c = Math.round(+counts[s.id]);
    if (s.data().comments !== c) { batch.update(s.ref, { comments: c }); changed.push({ id: s.id, ...s.data(), comments: c }); }
  }
  if (changed.length) await batch.commit();
  await (await import("./topStats.js")).updateTop(changed).catch(() => {});
  return changed.length;
}
