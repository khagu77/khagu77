// 5분마다 실행되는 수집 한 바퀴
import { db, getSettings, getSecrets, getState, setState, Timestamp } from "./db.js";
import { buildContext } from "./classify.js";
import { collectQueries } from "./keywords.js";
import { collectNaver, parseKeys } from "./collectors/naver.js";
import { collectNaverWeb } from "./collectors/naverweb.js";
import { collectYoutubeRss, collectYoutubeSearch } from "./collectors/youtube.js";
import { collectCommunity } from "./collectors/community.js";
import { ingest } from "./store.js";
import { sendAlerts } from "./alerts.js";

export async function runCollection({ force = false, parts = null } = {}) {
  const started = Date.now();
  const log = [];
  const settings = await getSettings(true);
  if (!settings.collect.enabled && !force) return { skipped: true };
  const secrets = await getSecrets();
  const ctx = buildContext(settings);
  const queries = collectQueries(ctx.compiled);
  const targetQueries = ctx.compiled.target.map((r) => r.query);
  const tick = Math.floor(started / 300000);
  const want = (p) => !parts || parts.includes(p);

  const jobs = [];
  // 네이버: 검색 API 키가 있으면 API, 없으면 검색 결과 화면을 직접 읽음
  if (want("naver")) jobs.push(parseKeys(secrets.naverKeys).length ? collectNaver({ queries, settings, secrets, log }) : collectNaverWeb({ queries, settings, log, force }));
  if (want("rss") && settings.collect.youtubeRss && (force || tick % 2 === 0)) jobs.push(collectYoutubeRss({ settings, log }));
  if (want("ytsearch") && settings.collect.youtubeSearch) jobs.push(collectYoutubeSearch({ queries: targetQueries, settings, secrets, log }));
  if (want("community") && settings.collect.community) jobs.push(collectCommunity({ settings, log }));

  const results = await Promise.allSettled(jobs);
  const items = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else log.push(`오류: ${r.reason?.message || r.reason}`);
  }
  let created = [];
  try {
    created = await ingest(items, ctx, log);
    await sendAlerts(created, ctx, secrets, log);
  } catch (e) {
    log.push(`저장/알림 오류: ${e.message}`);
  }

  const run = { at: Timestamp.now(), ms: Date.now() - started, fetched: items.length, created: created.length, log };
  const prev = await getState("runs");
  await Promise.all([
    setState("runs", { items: [run, ...(prev.items || [])].slice(0, 30) }),
    db.doc("status/main").set({ lastRun: run, queries: queries.length }, { merge: true }),
  ]);
  return run;
}
