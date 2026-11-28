// 수집한 글 저장: 분류 → 언론 유사 제목 묶기 → 새 글만 저장 → 일별 통계·실시간 피드 갱신
import { db, FieldValue, Timestamp, getState, setState } from "./db.js";
import { classify } from "./classify.js";
import { findSimilar } from "./similarity.js";
import { canonicalUrl, hash, kstParts, pool } from "./util.js";

import { siteOf } from "./site.js";
export { siteOf };

const num = (k, v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(+v) && +v >= 0 ? { [k]: Math.round(+v) } : {});
const toTs = (d) => (d instanceof Date && !isNaN(d) ? Timestamp.fromDate(d) : null);

export function buildPost(item, cls, now) {
  let posted = item.postedAt instanceof Date && !isNaN(item.postedAt) ? item.postedAt : null;
  if (posted && posted.getTime() > now.getTime() + 10 * 60e3) posted = null; // 미래 시각(잘못 읽은 날짜)은 버림
  if (posted && item.via === "community" && now.getTime() - posted.getTime() > 3 * 86400e3) posted = null; // 게시판 최신 목록인데 오래된 날짜 = 잘못 읽음
  return {
    channel: item.channel,
    title: String(item.title || "").slice(0, 300),
    desc: String(item.desc || "").slice(0, 400),
    // 유튜브는 설명 뒤쪽에 키워드가 있는 경우가 많아, 다시 분류할 때 쓰도록 설명 전체를 따로 보관
    ...(item.channel === "youtube" && String(item.desc || "").length > 400 ? { descFull: String(item.desc).slice(0, 3000) } : {}),
    url: item.channel === "youtube" && item.short && item.vid ? `https://www.youtube.com/shorts/${item.vid}` : item.url,
    source: String(item.source || "").slice(0, 80),
    sourceId: String(item.sourceId || "").slice(0, 120),
    postedAt: toTs(posted),
    postedDay: item.postedDay || null,
    collectedAt: Timestamp.fromDate(now),
    time: Timestamp.fromDate(posted || now),
    thumb: item.thumb || null,
    // 조회수 · 댓글수 · 좋아요 (수집할 때 보이는 곳만: 유튜브 관심 채널 · 인스타그램 · 게시판 댓글 수)
    ...num("views", item.views), ...num("comments", item.comments), ...num("likes", item.likes),
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
  // 카페 이름: 장부에서 채우고, 새로 본 이름은 장부에 기억
  try { const { fillCafeNames } = await import("./cafeNames.js"); await fillCafeNames(items); } catch (e) { log.push(`카페 이름 장부: ${e.message}`.slice(0, 120)); }
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
  const upgraded = [];
  await pool(docs, 12, async ({ id, data }) => {
    try {
      await db.doc(`posts/${id}`).create(data);
      created.push({ id, ...data });
    } catch (e) {
      if (e.code !== 6) throw e; // 6 = 이미 있음 (다른 검색어로 이미 저장된 글)
      // 이미 가비지로 저장된 글이 이번엔 이슈로 판단되면 이슈로 올림
      // (예: 유튜브 검색 결과의 짧은 설명으로는 키워드가 없었는데, 관심 채널 RSS 의 전체 설명에는 있음)
      if (data.isIssue || data.must) {
        const ref = db.doc(`posts/${id}`);
        const old = (await ref.get()).data();
        if (old && !(old.isIssue || old.must) && !old.manualGarbage) {
          const patch = { targets: data.targets, kw: data.kw, kwGroups: data.kwGroups, isIssue: data.isIssue, must: data.must, alert: data.alert, fav: data.fav, cats: data.cats };
          if (String(data.desc || "").length > String(old.desc || "").length) patch.desc = data.desc;
          if (data.descFull) patch.descFull = data.descFull;
          if (old.sentimentBy === "rule") patch.sentiment = data.sentiment;
          await ref.update(patch);
          upgraded.push({ old, next: { ...old, ...patch } });
        }
      }
    }
  });
  if (upgraded.length) {
    // 일별 통계도 가비지 → 이슈로 옮김 (수집한 날 기준)
    const inc = {};
    const bump = (day, f, k, n) => { ((inc[day] ||= {})[f] ||= {})[k] = (inc[day][f][k] || 0) + n; };
    for (const { old, next } of upgraded) {
      if (!old.collectedAt) continue;
      const day = kstParts(old.collectedAt.toDate()).day;
      for (const c of old.cats || []) if (!next.cats.includes(c)) bump(day, "cat", c, -1);
      for (const c of next.cats) if (!(old.cats || []).includes(c)) bump(day, "cat", c, 1);
      bump(day, "_", "issue", 1); bump(day, "_", "garbage", -1);
      bump(day, "chIssue", old.channel, 1);
      if (old.sentiment !== next.sentiment) { bump(day, "sent", old.sentiment, -1); bump(day, "sent", next.sentiment, 1); }
      bump(day, "sentIssue", next.sentiment, 1);
    }
    await Promise.all(Object.entries(inc).map(([day, fields]) => {
      const data = {};
      for (const [f, m] of Object.entries(fields)) {
        if (f === "_") { for (const [k, n] of Object.entries(m)) data[k] = FieldValue.increment(n); continue; }
        data[f] = {};
        for (const [k, n] of Object.entries(m)) if (n && k) data[f][k] = FieldValue.increment(n);
      }
      return db.doc(`stats/${day}`).set(data, { merge: true });
    }));
    log.push(`가비지 → 이슈로 올림: ${upgraded.length}건`);
  }

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
  const d = { total: 0, issue: 0, garbage: 0, ch: {}, cat: {}, sent: {}, hour: {}, kw: {}, grp: {}, favCafe: {}, favYt: {}, chIssue: {}, sentIssue: {}, shortCat: {}, favYtShort: {} };
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
    if (p.fav && p.channel === "youtube" && p.short) inc(d.favYtShort, favKey(p)); // 관심 유튜브 TOP 의 채널별 숏츠 수
  }
  return d;
}

// 주의: merge 저장에서 빈 묶음 {} 은 기존 값을 통째로 지움 → 빈 묶음은 아예 빼고 저장
const asInc = (o) => {
  if (typeof o === "number") return FieldValue.increment(o);
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Object.keys(v).length) continue;
    r[k] = asInc(v);
  }
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
