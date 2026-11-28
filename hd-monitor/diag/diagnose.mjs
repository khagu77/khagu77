// 점검(읽기 전용): 특정 유튜브 영상이 왜 수집되지 않았는지
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalUrl, hash } from "./src/util.js";
import { buildContext, classify } from "./src/classify.js";
const db = getFirestore(initializeApp(), "hdmon");
const vid = "cbQAELeJ9rc";
for (const u of [`https://www.youtube.com/watch?v=${vid}`, `https://www.youtube.com/shorts/${vid}`]) {
  const s = await db.doc(`posts/${hash(canonicalUrl(u))}`).get();
  console.log("저장 여부", u, s.exists ? `있음 cats=${s.data().cats}` : "없음");
}
const sec = (await db.doc("secrets/main").get()).data() || {};
const key = String(sec.youtubeKeys || "").split(/\s+/).filter(Boolean)[0];
const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vid}&key=${encodeURIComponent(key)}`);
const it = (await r.json()).items?.[0];
if (!it) { console.log("영상 정보 없음", r.status); process.exit(0); }
const sn = it.snippet;
console.log("채널:", sn.channelTitle, sn.channelId, "| 올린 시각:", sn.publishedAt);
console.log("제목:", sn.title);
const settings = (await db.doc("settings/main").get()).data();
const fav = (settings.favYoutube || []).find((c) => c.id === sn.channelId);
console.log("관심 채널:", fav ? `예 (${fav.name})` : "아니오");
const ctx = buildContext(settings);
const cls = classify({ channel: "youtube", title: sn.title, desc: sn.description, sourceId: sn.channelId, source: sn.channelTitle, requireMatch: true }, ctx);
console.log("분류:", cls ? `저장 대상 · 이슈=${cls.isIssue} · 키워드=${cls.kw.join(",")} · 대상=${cls.targets.join(",")}` : "키워드에 안 걸리거나 제외어에 걸림 (저장 안 함)");
const seen = (await db.doc("state/yt_rss_seen").get()).data() || {};
console.log("관심 채널 확인 기록:", (seen[sn.channelId] || []).includes(vid) ? "이미 본 영상" : "본 적 없음", "| API 대신 읽은 시각:", seen._apiAt?.[sn.channelId] ? new Date(seen._apiAt[sn.channelId] + 9 * 3600e3).toISOString().slice(11, 16) : "-");
const runs = (await db.doc("state/runs").get()).data()?.items || [];
for (const x of runs.slice(0, 4)) console.log("수집", new Date(x.at.toDate().getTime() + 9 * 3600e3).toISOString().slice(11, 16), "|", (x.log || []).filter((l) => /유튜브/.test(l)).join(" / ").slice(0, 220));
