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

  jobs.push(fixCommunityDatesOnce(log).then(() => []));
  jobs.push(backfillShorts(log).then(() => []));
  if (force || tick % 6 === 0) jobs.push(refreshYoutubeStats(secrets, log).then(() => [])); // 30분마다 최근 영상 숫자 새로
  const results = await Promise.allSettled(jobs);
  const items = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else log.push(`오류: ${r.reason?.message || r.reason}`);
  }
  // 유튜브 영상: 조회수 · 좋아요 · 댓글수
  try { const { addVideoStats } = await import("./collectors/youtube.js"); await addVideoStats(items, secrets); } catch (e) { log.push(`유튜브 통계: ${e.message}`.slice(0, 100)); }
  let created = [];
  try {
    created = await ingest(items, ctx, log);
    await (await import("./topStats.js")).updateTop(created).catch((e) => log.push(`조회수 TOP: ${e.message}`.slice(0, 100)));
    await (await import("./newsComments.js")).queueNews(created).catch(() => {});
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

// 1회: 날짜를 잘못 읽어(조회수 '1.2' 등) 오래된 글로 저장된 최근 게시판 글의 작성 시각을 수집 시각으로
async function fixCommunityDatesOnce(log) {
  const st = await getState("fixes");
  if (st.communityDates1) return;
  const since = new Date(Date.now() - 4 * 86400e3);
  const snap = await db.collection("posts").where("collectedAt", ">=", since).get();
  const w = db.bulkWriter();
  let n = 0;
  for (const d of snap.docs) {
    const p = d.data();
    if (p.via !== "community" || !p.time || !p.collectedAt) continue;
    if (p.collectedAt.toMillis() - p.time.toMillis() > 3 * 86400e3) { w.update(d.ref, { time: p.collectedAt, postedAt: null }); n++; }
  }
  await w.close();
  await setState("fixes", { ...st, communityDates1: true });
  log.push(`게시판 글 작성 시각 바로잡음: ${n}건`);
}

// 이미 저장된 유튜브 영상의 숏츠 여부를 5분마다 조금씩 확인 → 다 끝나면 날짜별 숏츠 수를 실제 글로 다시 셈 (한 번)
async function backfillShorts(log) {
  const st = await getState("shorts_backfill3");
  if (st.done) return;
  const { isShort } = await import("./collectors/youtube.js");
  const { kstParts, pool } = await import("./util.js");
  const snap = await db.collection("posts").where("channel", "==", "youtube").get();
  const todo = snap.docs.filter((d) => typeof d.data().short !== "boolean" && !(st.skip || []).includes(d.id)).slice(0, 80);
  let n = 0;
  const skip = [...(st.skip || [])];
  await pool(todo, 5, async (d) => {
    const p = d.data();
    const vid = (String(p.url).match(/[?&]v=([\w-]{6,})/) || String(p.url).match(/shorts\/([\w-]{6,})/) || [])[1];
    const v = vid ? await isShort(vid) : null;
    if (v === null) { skip.push(d.id); return; } // 확인 안 되는 영상(삭제 등)은 건너뜀
    await d.ref.update(v ? { short: true, url: `https://www.youtube.com/shorts/${vid}` } : { short: false });
    Object.assign(p, { short: v });
    n++;
  });
  if (n) log.push(`저장된 유튜브 숏츠 확인: ${n}건`);
  if (todo.length) { await setState("shorts_backfill3", { skip: skip.slice(-500), checked: (st.checked || 0) + n }); return; }
  // 다 확인함 → 날짜(수집일)별 · 카테고리별 숏츠 수를 실제 글로 다시 세어 통계에 덮어씀
  const again = await db.collection("posts").where("channel", "==", "youtube").where("short", "==", true).get();
  const byDay = {};
  const favDay = {};
  for (const d of again.docs) {
    const p = d.data();
    if (!p.collectedAt) continue;
    const day = kstParts(p.collectedAt.toDate()).day;
    for (const c of p.cats || []) ((byDay[day] ||= {})[c] = (byDay[day][c] || 0) + 1);
    if (p.fav) { const k = String(p.sourceId || p.source || "기타").replace(/[.~*/[\]]/g, " ").trim().slice(0, 100) || "기타"; ((favDay[day] ||= {})[k] = (favDay[day][k] || 0) + 1); }
  }
  const w = db.bulkWriter();
  for (const [day, m] of Object.entries(byDay)) w.update(db.doc(`stats/${day}`), { shortCat: m, favYtShort: favDay[day] || {} });
  await w.close().catch((e) => log.push(`숏츠 통계 다시 세기 일부 실패: ${e.message}`));
  await setState("shorts_backfill3", { ...st, done: true, days: Object.keys(byDay).length });
  log.push(`숏츠 통계 다시 셈: ${Object.keys(byDay).length}일`);
}

// 최근 3일 유튜브 영상의 조회수 · 좋아요 · 댓글수를 새로 받아 둠 (영상 50개당 할당량 1단위)
async function refreshYoutubeStats(secrets, log) {
  if (!secrets.youtubeKeys) return;
  const { videoStats } = await import("./collectors/youtube.js");
  const since = Date.now() - 3 * 86400e3;
  // 유튜브 글만 읽음 (전체 채널 최근 3일 수만 건을 읽다 실패하던 문제)
  const snap = await db.collection("posts").where("channel", "==", "youtube").select("url", "views", "likes", "comments", "collectedAt", "title", "channel", "source", "sourceId", "time", "short", "isIssue", "must").get();
  const docs = snap.docs.filter((d) => (d.data().collectedAt?.toMillis?.() || 0) >= since).slice(0, 1500);
  const vidOf = (u) => (String(u).match(/[?&]v=([\w-]{6,})/) || String(u).match(/shorts\/([\w-]{6,})/) || [])[1];
  const m = await videoStats(docs.map((d) => vidOf(d.data().url)), secrets);
  if (!m.size) { if (docs.length) log.push(`유튜브 조회수·댓글수: 받은 통계 없음 (영상 ${docs.length}개${videoStats.lastError ? `, ${videoStats.lastError}` : ""})`); return; }
  const w = db.bulkWriter();
  let n = 0;
  const changedPosts = [];
  const num = (v) => (v == null || !Number.isFinite(+v) ? null : +v);
  for (const d of docs) {
    const s = m.get(vidOf(d.data().url));
    if (!s) continue;
    const patch = {};
    for (const k of ["views", "likes", "comments"]) if (num(s[k]) !== null && num(s[k]) !== d.data()[k]) patch[k] = num(s[k]);
    if (Object.keys(patch).length) { w.update(d.ref, patch); n++; changedPosts.push({ id: d.id, ...d.data(), ...patch }); }
  }
  await w.close();
  await (await import("./topStats.js")).updateTop(changedPosts).catch(() => {});
  if (n) log.push(`유튜브 조회수·댓글수 새로 고침: ${n}건`);
}
