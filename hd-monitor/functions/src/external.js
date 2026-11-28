// 크롬 확장(수집 도우미)이 보낸 글 저장 — 서버 수집과 같은 분류·중복 제거·알림을 거침
import { db, getSettings, getState, setState, Timestamp } from "./db.js";
import { buildContext } from "./classify.js";
import { collectQueries } from "./keywords.js";
import { parseKeys } from "./collectors/naver.js";
import { ingest } from "./store.js";
import { sendAlerts } from "./alerts.js";
import { autoAnalyze } from "./ai.js";

const ALLOWED = new Set(["ppomppu", "bobae", "clien", "cafe", "news", "blog"]);

export function normalizeExternal(body) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
  const out = [];
  for (const it of items) {
    const channel = String(it.channel || "");
    const url = String(it.url || "");
    const title = String(it.title || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!ALLOWED.has(channel) || !/^https:\/\//.test(url) || !title) continue;
    const d = it.postedAt ? new Date(it.postedAt) : null;
    // 네이버 검색 결과(검색어로 찾은 글)는 서버 네이버 수집과 같게 전부 '전체'에 넣고, 게시판 목록 글은 현대차 관련어가 있어야 저장
    const fromSearch = !!it.fromSearch && ["news", "blog", "cafe"].includes(channel);
    const extUrl = /^https?:\/\//.test(String(it.extUrl || "")) ? String(it.extUrl) : "";
    out.push({
      channel, url, extUrl, title, desc: String(it.desc || "").slice(0, 400), source: String(it.source || "").slice(0, 80),
      sourceId: String(it.sourceId || "").slice(0, 120), postedAt: d && !isNaN(d) ? d : null,
      requireMatch: !fromSearch, via: fromSearch ? `ext:naver:${channel}` : `ext:${channel}`, query: String(it.query || "").slice(0, 80),
      views: Number.isFinite(+it.views) && it.views !== null ? +it.views : null, comments: Number.isFinite(+it.comments) && it.comments !== null ? +it.comments : null,
    });
  }
  return out;
}

export async function ingestFromExtension(body, secrets) {
  const log = [];
  // 수집 도우미가 네이버에서 알아 온 카페 이름 → 장부 + 이미 저장된 글의 빈 이름 채움
  if (body.cafeNames && typeof body.cafeNames === "object") {
    const { addNames } = await import("./cafeNames.js");
    const fixed = await addNames(Object.fromEntries(Object.entries(body.cafeNames).slice(0, 300)));
    if (fixed) log.push(`카페 이름 채움: 글 ${fixed}건`);
  }
  const items = normalizeExternal(body);
  const ctx = buildContext(await getSettings());
  const settings = ctx.settings;
  const created = items.length ? await ingest(items, ctx, log) : [];
  if (created.length) await (await import("./topStats.js")).updateTop(created).catch(() => {});
  if (created.length) {
    try { const n = await (await import("./newsComments.js")).queueNews(created); if (n) log.push(`뉴스 댓글 대기열 +${n}`); }
    catch (e) { log.push(`뉴스 댓글 대기열 오류: ${e.message}`.slice(0, 140)); }
  }
  // 수집 도우미가 알아 온 네이버 뉴스 댓글 수
  if (body.newsComments && typeof body.newsComments === "object") {
    const n = await (await import("./newsComments.js")).applyNewsComments(body.newsComments);
    log.push(`뉴스 댓글수 ${Object.keys(body.newsComments).length}건 확인${n ? `, 바뀜 ${n}건` : ""}`);
  }
  if (created.length) await autoAnalyze(created, settings, secrets, log);
  if (created.length) await sendAlerts(created, ctx, secrets, log);
  if (body.naver) log.unshift(String(body.naver).slice(0, 120));
  const run = { at: Timestamp.now(), received: items.length, created: created.length, client: String(body.client || "").slice(0, 60), naver: String(body.naver || "").slice(0, 120), log };
  const prev = await getState("ext_runs");
  await Promise.all([
    setState("ext_runs", { items: [run, ...(prev.items || [])].slice(0, 30) }),
    db.doc("status/main").set({ extLast: run }, { merge: true }),
  ]);
  return { received: items.length, created: created.length };
}

// 수집 도우미가 5분마다 받아 가는 설정: 네이버 검색어·종류 (서버가 네이버에 막혀 PC 크롬이 대신 검색)
export async function extensionConfig(secrets) {
  const settings = await getSettings();
  const ctx = buildContext(settings);
  const useExt = settings.collect.naverByExtension !== false && !parseKeys(secrets.naverKeys).length;
  return {
    naver: {
      on: useExt,
      kinds: ["news", "blog", "cafe"].filter((k) => settings.collect.naver?.[k]),
      queries: collectQueries(ctx.compiled),
      perRun: Number(settings.collect.extNaverPerRun) || 12,
    },
    favCafes: (settings.favCafes || []).map((c) => ({ id: c.id, name: c.name })),
    cafeLookup: await (await import("./cafeNames.js")).unknownCafes(15), // 이름을 알아 와 줄 카페
    newsComments: await (await import("./newsComments.js")).dueNews(6), // 수집 도우미가 기사를 실제로 열어 댓글 수를 읽음
  };
}
