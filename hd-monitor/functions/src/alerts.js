// 알림: 알림 그룹 키워드가 걸린 새 글 → 제목 유사도 80% 이상이면 대표 1건만 → 알림 켠 담당자 모두에게 카카오톡
import { db, getState, setState } from "./db.js";
import { CHANNELS } from "./defaults.js";
import { kakaoSend } from "./kakao.js";
import { findSimilar } from "./similarity.js";

export const SITE_URL = "https://hd-issue-monitor.web.app";
const goLink = (site, url) => `${site}/go.html?u=${encodeURIComponent(url)}`;

export function formatAlert(p) {
  const ch = CHANNELS[p.channel] || { name: p.channel, icon: "🔔" };
  const head = `${ch.icon} [${ch.name}]${p.channel === "cafe" || p.channel === "youtube" ? ` ${p.source}` : ""}`;
  const kw = (p.kw || []).slice(0, 3).join(", ");
  const tail = `${kw ? `\n🔑 ${kw}` : ""}\n${p.url}`;
  const room = Math.max(20, 200 - head.length - tail.length - 2);
  const title = p.title.length > room ? `${p.title.slice(0, room - 1)}…` : p.title;
  return `${head}\n${title}${tail}`.slice(0, 200);
}

export async function sendAlerts(created, ctx, secrets, log) {
  const cand = created.filter((p) => p.alert && !p.dupOf).sort((a, b) => a.time.toMillis() - b.time.toMillis());
  if (!cand.length) return;
  if (!secrets.kakaoRestKey) { log.push("알림: 카카오 키 없음"); return; }
  const cfg = ctx.settings.alert || {};
  const th = Number(cfg.dupThreshold) || 0.8;
  const now = Date.now();
  const st = await getState("alert_recent");
  const recent = (st.items || []).filter((x) => x.at > now - (Number(cfg.dupHours) || 24) * 3600e3);
  const picked = [];
  for (const p of cand) {
    if (findSimilar(p.title, recent, th)) continue;
    recent.push({ t: p.title, at: now, id: p.id });
    picked.push(p);
  }
  await setState("alert_recent", { items: recent.slice(-500) });
  if (!picked.length) return;

  const site = ctx.settings.siteUrl || SITE_URL;
  const users = await db.collection("users").where("status", "==", "active").where("alertOn", "==", true).get();
  let sent = 0;
  const perPost = new Map(); // 글 id → 받은 사람 이름
  let failed = 0;
  for (const u of users.docs) {
    const prof = u.data();
    if (!prof.kakaoConnected) continue;
    const chs = prof.alertChannels && prof.alertChannels.length ? prof.alertChannels : Object.keys(CHANNELS);
    const mine = picked.filter((p) => chs.includes(p.channel) && (!prof.alertIssueOnly || p.isIssue));
    const max = Number(cfg.maxPerRun) || 15;
    try {
      for (const p of mine.slice(0, max)) { await kakaoSend(u.id, formatAlert(p), goLink(site, p.url), secrets); sent++; perPost.set(p.id, [...(perPost.get(p.id) || []), prof.name || prof.email || u.id]); }
      if (mine.length > max) {
        await kakaoSend(u.id, `🔔 새 이슈 게시물 ${mine.length - max}건이 더 있습니다.\n모니터링 시스템에서 확인해 주세요.`, `${site}/#/posts`, secrets, "시스템 열기");
        sent++;
      }
    } catch (e) {
      failed++;
      log.push(`알림 실패 (${prof.name || prof.email}): ${e.message}`);
    }
  }
  // 카톡으로 나간 글에 표시 (목록에서 '카톡 발송' 뱃지)
  if (perPost.size) {
    const batch = db.batch();
    for (const [id, names] of perPost) batch.update(db.doc(`posts/${id}`), { alerted: true, alertedAt: new Date(), alertedTo: names.slice(0, 20) });
    await batch.commit().catch((e) => log.push(`발송 표시 실패: ${e.message}`));
  }
  await db.collection("alerts").add({ at: new Date(), posts: picked.map((p) => ({ id: p.id, title: p.title, channel: p.channel, url: p.url })), sent, failed });
  log.push(`알림: ${picked.length}건 (메시지 ${sent}통${failed ? `, 실패 ${failed}명` : ""})`);
}
