// 수집한 글 저장: 분류 → 언론 유사 제목 묶기 → 새 글만 저장 → 일별 통계·실시간 피드 갱신
import { db, FieldValue, Timestamp, getState, setState } from "./db.js";
import { classify } from "./classify.js";
import { findSimilar } from "./similarity.js";
import { canonicalUrl, hash, kstParts, pool } from "./util.js";

import { siteOf } from "./site.js";
export { siteOf };

const toTs = (d) => (d instanceof Date && !isNaN(d) ? Timestamp.fromDate(d) : null);

export function buildPost(item, cls, now) {
  let posted = item.postedAt instanceof Date && !isNaN(item.postedAt) ? item.postedAt : null;
  if (posted && posted.getTime() > now.getTime() + 10 * 60e3) posted = null; // 미래 시각(잘못 읽은 날짜)은 버림
  if (posted && item.via === "community" && now.getTime() - posted.getTime() > 3 * 86400e3) posted = null; // 게시판 최신 목록인데 오래된 날짜 = 잘못 읽음
  return {
    channel: item.channel,
    title: String(item.title || "").slice(0, 300),
    desc: String(item.desc || "").slice(0, 400),
    url: item.channel === "youtube" && item.short && item.vid ? `https://www.youtube.com/shorts/${item.vid}` : item.url,
    source: String(item.source || "").slice(0, 80),
    sourceId: String(item.sourceId || "").slice(0, 120),
    postedAt: toTs(posted),
    postedDay: item.postedDay || null,
    collectedAt: Timestamp.fromDate(now),
    time: Timestamp.fromDate(posted || now),
    thumb: item.thumb || null,
    ...(item.channel === "youtube" && typeof item.short === "boolean" ? { short: item.short } : {}),
    site: item.site || siteOf(item),
    via: item.via || "",
    query: item.query || "",
    ...cls,
    dupOf: null,
    dupCount: 0,
    memo: "",
    star: false,
    hidden: false,
  };
}

export async function ingest(items, ctx, log) {
  const now = new Date();
  const byId = new Map();
  for (const it of items) {
    if (!it || !it.url || !it.title) continue;
    const id = hash(canonicalUrl(it.url));
    if (!byId.has(id)) byId.set(id, it);
  }
  if (!byId.size) return [];

  const dupTh = Number(ctx.settings.collect.newsDupThreshold) || 0.8;
  const recentDoc = await getState("news_recent");
  const cutoff = now.getTime() - 48 * 3600e3;
  const recent = (recentDoc.items || []).filter((x) => x.at > cutoff);

  const docs = [];
  for (const [id, it] of byId) {
    const cls = classify(it, ctx);
    if (!cls) continue;
    const data = buildPost(it, cls, now);
    if (data.channel === "news") {
      const sim = findSimilar(data.title, recent, dupTh);
      if (sim && sim.item.id !== id) data.dupOf = sim.item.id;
    }
    docs.push({ id, data });
  }

  const created = [];
  await pool(docs, 12, async ({ id, data }) => {
    try {
      await db.doc(`posts/${id}`).create(data);
      created.push({ id, ...data });
    } catch (e) {
      if (e.code !== 6) throw e; // 6 = 이미 있음 (다른 검색어로 이미 저장된 글)
    }
  });

  // 새로 저장된 언론 기사만 유사도 기준 목록에 추가 · 대표 기사의 '유사 n건' 올리기
  const repInc = new Map();
  for (const p of created) {
    if (p.channel !== "news") continue;
    if (p.dupOf) repInc.set(p.dupOf, (repInc.get(p.dupOf) || 0) + 1);
    else recent.push({ id: p.id, t: p.title, at: now.getTime() });
  }
  await Promise.all([...repInc].map(([rid, n]) => db.doc(`posts/${rid}`).update({ dupCount: FieldValue.increment(n) }).catch(() => {})));
  await setState("news_recent", { items: recent.slice(-700) });

  if (created.length) await updateStats(created, now);
  log.push(`저장: 후보 ${docs.length}건 중 새 글 ${created.length}건`);
  return created;
}

export function statsDelta(posts) {
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const d = { total: 0, issue: 0, garbage: 0, ch: {}, cat: {}, sent: {}, hour: {}, kw: {}, grp: {}, favCafe: {}, favYt: {}, chIssue: {}, sentIssue: {}, shortCat: {} };
  for (const p of posts) {
    const hr = String(kstParts(p.collectedAt?.toDate ? p.collectedAt.toDate() : new Date()).hour).padStart(2, "0");
    d.total++;
    inc(d.ch, p.channel);
    inc(d.sent, p.sentiment);
    inc(d.hour, hr);
    if (p.channel === "youtube" && p.short) for (const c of p.cats || []) inc(d.shortCat, c); // 카테고리별 쇼츠(릴스) 수 → 릴스 제외 건수
    for (const c of p.cats || []) inc(d.cat, c);
    if (p.isIssue || p.must) {
      d.issue++;
      inc(d.chIssue, p.channel);
      inc(d.sentIssue, p.sentiment);
    } else d.garbage++;
    for (const k of p.kw || []) inc(d.kw, k.replace(/[.~*/[\]]/g, " ").trim() || "기타");
    for (const g of p.kwGroups || []) inc(d.grp, g);
    // 카페 주소 ID·채널 ID 를 모르면 이름으로 (빈 이름표는 통계에서 빠지던 문제)
    const favKey = (x) => String(x.sourceId || x.source || "기타").replace(/[.~*/[\]]/g, " ").trim().slice(0, 100) || "기타";
    if (p.fav && p.channel === "cafe") inc(d.favCafe, favKey(p));
    if (p.fav && p.channel === "youtube") inc(d.favYt, favKey(p));
  }
  return d;
}

const asInc = (o) => {
  if (typeof o === "number") return FieldValue.increment(o);
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = asInc(v);
  return r;
};

// 실시간 피드: 한 번에 많이 들어오는 채널(블로그 등)이 다른 채널을 밀어내지 않도록 채널별로 번갈아 고름 (이슈 글 먼저 · 최신순)
export function pickForFeed(created, n) {
  const by = new Map();
  for (const p of [...created].sort((a, b) => Number(!!(b.isIssue || b.must)) - Number(!!(a.isIssue || a.must)) || b.time.toMillis() - a.time.toMillis())) {
    if (!by.has(p.channel)) by.set(p.channel, []);
    by.get(p.channel).push(p);
  }
  const out = [];
  while (out.length < n && [...by.values()].some((l) => l.length)) for (const l of by.values()) if (l.length && out.length < n) out.push(l.shift());
  return out.sort((a, b) => b.time.toMillis() - a.time.toMillis());
}

async function updateStats(created, now) {
  const { day } = kstParts(now);
  await db.doc(`stats/${day}`).set({ day, ...asInc(statsDelta(created)), updatedAt: Timestamp.fromDate(now) }, { merge: true });
  // 실시간 피드 (대시보드 화면이 문서 하나만 구독)
  const liveRef = db.doc("status/live");
  const snap = await liveRef.get();
  const prev = snap.exists ? snap.data().items || [] : [];
  const next = pickForFeed(created, 40)
    .map((p) => ({ id: p.id, site: p.site || null, sourceId: p.sourceId || "", title: p.title, channel: p.channel, source: p.source, url: p.url, time: p.time, sentiment: p.sentiment, isIssue: !!(p.isIssue || p.must), kw: (p.kw || []).slice(0, 3) }));
  await liveRef.set({ items: [...next, ...prev].slice(0, 40), at: Timestamp.fromDate(now) });
}
