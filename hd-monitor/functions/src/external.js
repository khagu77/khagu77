// 크롬 확장(수집 도우미)이 보낸 글 저장 — 서버 수집과 같은 분류·중복 제거·알림을 거침
import { db, getSettings, getState, setState, Timestamp } from "./db.js";
import { buildContext } from "./classify.js";
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
    out.push({
      channel, url, title, desc: String(it.desc || "").slice(0, 400), source: String(it.source || "").slice(0, 80),
      sourceId: String(it.sourceId || "").slice(0, 120), postedAt: d && !isNaN(d) ? d : null,
      requireMatch: true, via: `ext:${channel}`, query: "",
    });
  }
  return out;
}

export async function ingestFromExtension(body, secrets) {
  const log = [];
  const items = normalizeExternal(body);
  const ctx = buildContext(await getSettings());
  const settings = ctx.settings;
  const created = items.length ? await ingest(items, ctx, log) : [];
  if (created.length) await autoAnalyze(created, settings, secrets, log);
  if (created.length) await sendAlerts(created, ctx, secrets, log);
  const run = { at: Timestamp.now(), received: items.length, created: created.length, client: String(body.client || "").slice(0, 60), log };
  const prev = await getState("ext_runs");
  await Promise.all([
    setState("ext_runs", { items: [run, ...(prev.items || [])].slice(0, 30) }),
    db.doc("status/main").set({ extLast: run }, { merge: true }),
  ]);
  return { received: items.length, created: created.length };
}
