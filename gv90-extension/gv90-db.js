// GV90 데일리 DB: 이 PC 크롬(확장프로그램 저장소, IndexedDB)에 수집한 게시물·(앞으로) 댓글을 건별로 보관한다.
// 엑셀 파일만 보관하던 팰리세이드 수집기와 달리 행 단위로 저장해 대시보드·기간별 엑셀·댓글 연결에 바로 쓴다.
//
//  posts    게시물 { key, url, channel, media, car, date(ms), hasTime, title, body, summary, category, sentiment,
//                   by('rule'|'ai'|'edit'), day(수집일 YYYYMMDD), serial(연번), savedAt, commentCount? }
//  comments 댓글(확장용) { key, postKey, url, channel, media, car, date, text, sentiment, category, summary, by, day, serial }
//  days     수집일 { day, from, to, savedAt, fileName, stats:{ posts, byChannel, bySentiment, byCategory, comments } }
//  files    그날 만든 엑셀 { key:'day:YYYYMMDD', day, name, bytes }
//  runs     수집 회차 { id, startedAt, finishedAt, range:{start,end}, auto, holiday('토요일' 등 · 근무일이면 ""), reportedAt, items }
//           ← 온라인 오전 일일동향처럼 휴일 수집분을 다음 근무일 엑셀에 합칠 때 씀
//  kv       설정(저장 폴더 등) { key, ... }
//  게시물에는 조회수(views)·댓글 수(ccount)·강한 비판(harsh)도 같이 둔다 (결과 표·대시보드 👁 💬 🔥)

const GV_DB_NAME = "gv90Db";
const GV_DB_VERSION = 1;
const CHANNELS = ["언론", "유튜브", "동호회", "자동차 커뮤니티"];

let gvDbPromise = null;
function gvDb() {
  if (!gvDbPromise) {
    gvDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(GV_DB_NAME, GV_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("posts")) {
          const s = db.createObjectStore("posts", { keyPath: "key" });
          s.createIndex("day", "day");
          s.createIndex("channel", "channel");
        }
        if (!db.objectStoreNames.contains("comments")) {
          const s = db.createObjectStore("comments", { keyPath: "key" });
          s.createIndex("postKey", "postKey");
          s.createIndex("day", "day");
        }
        if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", { keyPath: "day" });
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "key" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
        if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return gvDbPromise;
}

// stores: 이름 또는 이름 배열 · fn(store 또는 {이름: store}) 의 반환값(요청이면 그 결과)을 돌려줌
async function gvTx(stores, mode, fn) {
  const db = await gvDb();
  const names = Array.isArray(stores) ? stores : [stores];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const arg = Array.isArray(stores) ? Object.fromEntries(names.map((n) => [n, tx.objectStore(n)])) : tx.objectStore(stores);
    const out = fn(arg);
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// kv 저장소 (저장 폴더 핸들 등)
async function kvGet(key) {
  return (await gvTx("kv", "readonly", (s) => s.get(key)))?.value;
}
async function kvSet(key, value) {
  await gvTx("kv", "readwrite", (s) => s.put({ key, value }));
}
async function kvDelete(key) {
  await gvTx("kv", "readwrite", (s) => s.delete(key));
}

// ---------------------------------------------------------------------------
// 수집 회차 (온라인 오전 일일동향의 '데일리 DB' 회차처럼)
// ---------------------------------------------------------------------------

async function saveRun(run) {
  await gvTx("runs", "readwrite", (s) => s.put(run));
  // 오래된 회차는 60개까지만 (게시물은 posts 에 따로 남아 있음)
  const all = (await getAll("runs")).sort((a, b) => b.finishedAt - a.finishedAt);
  if (all.length > 60) await gvTx("runs", "readwrite", (s) => all.slice(60).forEach((r) => s.delete(r.id)));
}

async function listRuns() {
  return (await getAll("runs")).sort((a, b) => a.finishedAt - b.finishedAt);
}

// 아직 엑셀에 담지 않은 회차 (지난 보고 이후 · 최근 10일까지만)
async function pendingRuns(lastReportAt = 0) {
  const since = Math.max(lastReportAt, Date.now() - 10 * 86400000);
  return (await listRuns()).filter((r) => !r.reportedAt && r.finishedAt > since && (r.items || []).length);
}

async function markRunsReported(ids, at = Date.now()) {
  const runs = await getAll("runs");
  await gvTx("runs", "readwrite", (s) => runs.filter((r) => ids.includes(r.id)).forEach((r) => s.put({ ...r, reportedAt: at })));
}

const getAll = (store, index, value) => gvTx(store, "readonly", (s) => (index ? s.index(index).getAll(value) : s.getAll()));

function todayKey(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function prettyDay(day) {
  return day ? `${day.slice(0, 4)}.${day.slice(4, 6)}.${day.slice(6, 8)}` : "";
}

// ---------------------------------------------------------------------------
// 게시물
// ---------------------------------------------------------------------------

const CHANNEL_ORDER = { 언론: 0, 유튜브: 1, 동호회: 2, "자동차 커뮤니티": 3 };

// 엑셀·화면 순서: 수집일 → 채널(언론·유튜브·동호회·커뮤니티) → 게시일 → 연번
function postOrder(a, b) {
  return (
    String(a.day).localeCompare(String(b.day)) ||
    (a.serial || 0) - (b.serial || 0) ||
    (CHANNEL_ORDER[a.channel] ?? 9) - (CHANNEL_ORDER[b.channel] ?? 9) ||
    (a.date || 0) - (b.date || 0)
  );
}

async function allPosts() {
  return (await getAll("posts")).sort(postOrder);
}

async function postsOfDay(day) {
  return (await getAll("posts", "day", day)).sort(postOrder);
}

// 게시물 저장: 이미 있는 글(같은 key)은 수집일·연번을 그대로 두고 분석 결과만 바꿈. 새 글은 연번을 이어서 매김
// → { added, updated }
async function savePosts(list, day) {
  const existing = new Map((await getAll("posts")).map((p) => [p.key, p]));
  let maxSerial = 0;
  for (const p of existing.values()) maxSerial = Math.max(maxSerial, p.serial || 0);
  const sorted = [...list].sort((a, b) => (CHANNEL_ORDER[a.channel] ?? 9) - (CHANNEL_ORDER[b.channel] ?? 9) || (a.date || 0) - (b.date || 0));
  let added = 0;
  let updated = 0;
  const now = Date.now();
  const recs = sorted.map((x) => {
    const old = existing.get(x.key);
    if (old) updated++;
    else added++;
    return {
      ...old,
      ...x,
      day: old?.day || x.day || day,
      serial: old?.serial || ++maxSerial,
      savedAt: now,
    };
  });
  await gvTx("posts", "readwrite", (s) => recs.forEach((r) => s.put(r)));
  return { added, updated, recs };
}

async function updatePost(key, patch) {
  const old = await gvTx("posts", "readonly", (s) => s.get(key));
  if (!old) return null;
  const rec = { ...old, ...patch };
  await gvTx("posts", "readwrite", (s) => s.put(rec));
  return rec;
}

async function deletePosts(keys) {
  await gvTx(["posts", "comments"], "readwrite", (st) => {
    for (const k of keys) {
      st.posts.delete(k);
      const req = st.comments.index("postKey").getAllKeys(k);
      req.onsuccess = () => req.result.forEach((ck) => st.comments.delete(ck));
    }
  });
}

// ---------------------------------------------------------------------------
// 댓글 (확장용: 댓글 수집을 붙이면 여기에 저장 → 엑셀 '댓글' 시트·대시보드 댓글 칸이 자동으로 채워짐)
// ---------------------------------------------------------------------------

async function allComments() {
  return (await getAll("comments")).sort((a, b) => String(a.day).localeCompare(String(b.day)) || (a.serial || 0) - (b.serial || 0));
}

async function commentsOfPost(postKey) {
  return getAll("comments", "postKey", postKey);
}

// comments: [{ postKey, text, date, ... }] · key 가 없으면 원글+작성일+내용으로 만듦 (같은 댓글은 한 번만)
async function saveComments(comments, day) {
  const existing = new Map((await getAll("comments")).map((c) => [c.key, c]));
  let maxSerial = 0;
  for (const c of existing.values()) maxSerial = Math.max(maxSerial, c.serial || 0);
  let added = 0;
  const recs = comments.map((c) => {
    const key = c.key || `${c.postKey}|${c.date || ""}|${String(c.text || "").slice(0, 80)}`;
    const old = existing.get(key);
    if (!old) added++;
    return { ...old, ...c, key, day: old?.day || c.day || day, serial: old?.serial || ++maxSerial };
  });
  await gvTx("comments", "readwrite", (s) => recs.forEach((r) => s.put(r)));
  return { added, total: recs.length };
}

// 글 하나의 댓글을 이번에 모은 것으로 바꾼다 (다시 수집: 없어진 댓글은 빼고, 표에서 직접 고친 성향은 그대로)
// → { total, added }
async function replacePostComments(postKey, list, day) {
  const old = new Map((await getAll("comments", "postKey", postKey)).map((c) => [c.key, c]));
  let maxSerial = 0;
  for (const c of await getAll("comments")) maxSerial = Math.max(maxSerial, c.serial || 0);
  let added = 0;
  const recs = list.map((c) => {
    const key = `${postKey}|${c.writtenAt || c.date || ""}|${String(c.text || "").slice(0, 80)}`;
    const prev = old.get(key);
    old.delete(key);
    if (!prev) added++;
    const keep = prev && (prev.edited || []).includes("sentiment") ? { sentiment: prev.sentiment, edited: prev.edited, by: prev.by } : {};
    return { ...c, key, postKey, day: prev?.day || day, serial: prev?.serial || ++maxSerial, ...keep };
  });
  await gvTx("comments", "readwrite", (s) => {
    for (const k of old.keys()) s.delete(k);
    recs.forEach((r) => s.put(r));
  });
  return { total: recs.length, added };
}

async function updateComment(key, patch) {
  const old = await gvTx("comments", "readonly", (s) => s.get(key));
  if (!old) return null;
  const rec = { ...old, ...patch };
  await gvTx("comments", "readwrite", (s) => s.put(rec));
  return rec;
}

async function putComments(list) {
  await gvTx("comments", "readwrite", (s) => list.forEach((c) => s.put(c)));
}

// ---------------------------------------------------------------------------
// 수집일 기록 · 그날 엑셀
// ---------------------------------------------------------------------------

function countBy(list, field, keys) {
  const out = Object.fromEntries((keys || []).map((k) => [k, 0]));
  for (const x of list) out[x[field] || "-"] = (out[x[field] || "-"] || 0) + 1;
  return out;
}

function statsOf(posts, comments = []) {
  return {
    posts: posts.length,
    byChannel: countBy(posts, "channel", CHANNELS),
    bySentiment: countBy(posts, "sentiment", typeof SENTIMENTS !== "undefined" ? SENTIMENTS : []),
    byCategory: countBy(typeof catList === "function" ? posts.flatMap((p) => catList(p.category).map((category) => ({ category }))) : posts, "category", typeof CATEGORIES !== "undefined" ? CATEGORIES : []),
    comments: comments.length,
    commentSentiment: countBy(comments, "sentiment", typeof SENTIMENTS !== "undefined" ? SENTIMENTS : []),
  };
}

async function listDays() {
  return (await getAll("days")).sort((a, b) => b.day.localeCompare(a.day));
}

async function getDay(day) {
  return gvTx("days", "readonly", (s) => s.get(day));
}

// 그날 기록을 DB 안의 게시물·댓글로 다시 셈 (info 는 기간·파일명 등 덧붙일 것)
async function refreshDay(day, info = {}) {
  const old = await getDay(day);
  const posts = await postsOfDay(day);
  const comments = await getAll("comments", "day", day);
  if (!posts.length && !comments.length && !info.keepEmpty) {
    await gvTx(["days", "files"], "readwrite", (st) => {
      st.days.delete(day);
      st.files.delete(`day:${day}`);
    });
    return null;
  }
  const rec = { ...old, ...info, day, savedAt: Date.now(), stats: statsOf(posts, comments) };
  delete rec.keepEmpty;
  await gvTx("days", "readwrite", (s) => s.put(rec));
  return rec;
}

async function saveDayFile(day, name, bytes) {
  await gvTx("files", "readwrite", (s) => s.put({ key: `day:${day}`, day, name, bytes }));
}

async function getDayFile(day) {
  return gvTx("files", "readonly", (s) => s.get(`day:${day}`));
}

// 그날 수집분 지우기 (그날 처음 들어온 게시물·댓글과 그날 엑셀)
async function deleteDay(day) {
  const posts = await postsOfDay(day);
  await deletePosts(posts.map((p) => p.key));
  const comments = await getAll("comments", "day", day);
  await gvTx(["days", "files", "comments"], "readwrite", (st) => {
    st.days.delete(day);
    st.files.delete(`day:${day}`);
    comments.forEach((c) => st.comments.delete(c.key));
  });
}

// 바로 전 수집일 대비 증감 → { prevDay, diff } (전 기록이 없으면 null)
function dayDiff(days, i, pick = (d) => d.stats?.posts || 0) {
  const prev = days[i + 1];
  if (!prev) return null;
  return { prevDay: prev.day, diff: pick(days[i]) - pick(prev) };
}

// ---------------------------------------------------------------------------
// 백업 (다른 PC 로 옮기기)
// ---------------------------------------------------------------------------

async function exportBackup() {
  return {
    app: "gv90",
    version: 1,
    exportedAt: new Date().toISOString(),
    posts: await getAll("posts"),
    comments: await getAll("comments"),
    days: await getAll("days"),
    runs: await getAll("runs"),
  };
}

async function importBackup(data) {
  if (!data || data.app !== "gv90") throw new Error("GV90 수집기 백업 파일이 아닙니다.");
  await gvTx(["posts", "comments", "days", "runs"], "readwrite", (st) => {
    (data.posts || []).forEach((p) => st.posts.put(p));
    (data.comments || []).forEach((c) => st.comments.put(c));
    (data.days || []).forEach((d) => st.days.put(d));
    (data.runs || []).forEach((r) => st.runs.put(r));
  });
  return { posts: (data.posts || []).length, comments: (data.comments || []).length, days: (data.days || []).length };
}
