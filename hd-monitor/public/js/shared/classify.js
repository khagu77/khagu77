// 게시물 분류: 키워드 매칭 → 이슈 여부 · 알림 여부 · 카테고리 · 기본 성향
import { norm, matchRules, compileGroups } from "./keywords.js";
import { compileLexicon, ruleSentiment } from "./sentiment.js";

export function buildContext(settings) {
  return {
    settings,
    compiled: compileGroups(settings),
    lex: compileLexicon(settings.lexicon),
    favCafes: new Map((settings.favCafes || []).map((c) => [String(c.id).toLowerCase(), c])),
    // 카페 주소 ID 를 모를 때(새 카페 주소 형식 등) 카페 이름으로도 관심 동호회 확인
    favCafeNames: new Map((settings.favCafes || []).map((c) => [norm(c.name), c])),
    favYoutube: new Map((settings.favYoutube || []).map((c) => [c.id, c])),
    categories: settings.categories || [],
  };
}

export function categoriesFor(p, categories) {
  const out = [];
  for (const c of categories) {
    const chOk = !c.channels || c.channels.includes("*") || c.channels.includes(p.channel);
    if (!chOk) continue;
    if (c.filter === "issue" && !(p.isIssue || p.must)) continue;
    if (c.filter === "garbage" && (p.isIssue || p.must)) continue;
    if (c.fav === "cafe" && !(p.channel === "cafe" && p.fav)) continue;
    if (c.fav === "youtube" && !(p.channel === "youtube" && p.fav)) continue;
    out.push(c.id);
  }
  return out;
}

// item: { channel, title, desc, url, source, sourceId, postedAt, requireMatch }
// 반환: 저장할 필드(분류 결과 포함) 또는 null(제외)
export function classify(item, ctx) {
  const text = norm(`${item.title} ${item.desc || ""}`);
  const { compiled } = ctx;
  if (matchRules(text, compiled.exclude).length) return null;

  const targets = matchRules(text, compiled.target);
  const kw = [];
  const kwGroups = [];
  let isIssue = false;
  let alert = false;
  for (const g of compiled.groups) {
    if (g.role !== "issue") continue;
    if (g.requireTarget && !targets.length) continue;
    const hits = matchRules(text, g.parsed);
    if (!hits.length) continue;
    kwGroups.push(g.id);
    for (const h of hits) if (!kw.includes(h)) kw.push(h);
    if (g.issue) isIssue = true;
    if (g.alert) alert = true;
  }

  let fav = false;
  let must = false;
  if (item.channel === "cafe") {
    const byId = ctx.favCafes.get(String(item.sourceId || "").toLowerCase());
    const byName = !byId && item.source ? ctx.favCafeNames?.get(norm(item.source)) : null;
    fav = !!(byId || byName);
    // 이름으로 찾았으면 통계(관심 동호회 TOP)가 모이도록 카페 주소 ID 로 맞춤
    if (byName && (!item.sourceId || String(item.sourceId).startsWith("#") || !ctx.favCafes.has(String(item.sourceId).toLowerCase()))) item.sourceId = byName.id;
  }
  if (item.channel === "youtube") {
    const y = ctx.favYoutube.get(item.sourceId);
    fav = !!y;
    must = !!(y && y.must);
  }
  // 게시판 목록·관심 유튜브처럼 검색어 없이 가져온 글은 현대차 관련어나 이슈어가 있어야 저장
  if (item.requireMatch && !must && !targets.length && !kw.length) return null;

  const out = {
    targets: targets.slice(0, 10),
    kw: kw.slice(0, 20),
    kwGroups,
    isIssue,
    alert: alert || must,
    fav,
    must,
    sentiment: ruleSentiment(`${item.title} ${item.desc || ""}`, ctx.lex),
    sentimentBy: "rule",
  };
  out.cats = categoriesFor({ ...out, channel: item.channel }, ctx.categories);
  return out;
}
