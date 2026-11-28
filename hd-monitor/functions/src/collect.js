// 5분마다 실행되는 수집 한 바퀴
import { db, getSettings, getSecrets, getState, setState, Timestamp } from "./db.js";
import { buildContext } from "./classify.js";
import { collectQueries } from "./keywords.js";
import { collectNaver, parseKeys } from "./collectors/naver.js";
import { collectNaverWeb } from "./collectors/naverweb.js";
import { collectYoutubeRss, collectYoutubeSearch } from "./collectors/youtube.js";
import { collectCommunity } from "./collectors/community.js";
import { collectGoogleNews, collectDaumBlog, collectPpomppuRss } from "./collectors/official.js";
import { collectInstagram } from "./collectors/instagram.js";
import { ingest } from "./store.js";
import { sendAlerts } from "./alerts.js";
import { autoAnalyze } from "./ai.js";

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
  // 네이버가 Google 서버의 검색을 막아(403) 기본은 크롬 수집 도우미가 담당
  if (want("naver")) {
    if (parseKeys(secrets.naverKeys).length) jobs.push(collectNaver({ queries, settings, secrets, log }));
    else if (settings.collect.naverByExtension !== false) {
      // 언론은 Google 뉴스, 블로그는 다음 검색이 맡고, 네이버 카페만 서버가 아주 천천히 검색 (많이 하면 네이버가 403)
      if (settings.collect.naverServerCafe !== false && settings.collect.naver?.cafe !== false) {
        jobs.push(collectNaverWeb({ queries, settings, log, force, kinds: ["cafe"], perTick: Number(settings.collect.naverServerCafePerTick) || 6, slow: true }));
      }
    } else jobs.push(collectNaverWeb({ queries, settings, log, force }));
  }
  if (want("rss") && settings.collect.youtubeRss && (force || tick % 2 === 0)) jobs.push(collectYoutubeRss({ settings, log }));
  if (want("ytsearch") && settings.collect.youtubeSearch) jobs.push(collectYoutubeSearch({ queries: targetQueries, settings, secrets, log }));
  if (want("community") && settings.collect.community) jobs.push(collectCommunity({ settings, log }));
  // 설치 없이 서버만으로 되는 공식 경로
  if (want("gnews")) jobs.push(collectGoogleNews({ queries, settings, log }));
  if (want("instagram")) jobs.push(collectInstagram({ settings, secrets, log }));
  if (want("daum")) jobs.push(collectDaumBlog({ queries, settings, secrets, log }));
  if (want("ppomppu") && (force || tick % 2 === 0)) jobs.push(collectPpomppuRss({ settings, log }));

  const results = await Promise.allSettled(jobs);
  const items = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else log.push(`오류: ${r.reason?.message || r.reason}`);
  }
  let created = [];
  try {
    created = await ingest(items, ctx, log);
    await autoAnalyze(created, settings, secrets, log);
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
