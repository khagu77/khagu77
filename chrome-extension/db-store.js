// 최종 DB: 그날그날 최종 엑셀 파일을 이 PC 크롬(확장프로그램 저장소, IndexedDB)에 날짜별로 보관한다.
// 종류(kind): buzz = 게시물 리스트('채널별 버즈량 현황'), raw = 댓글 raw data(언론·동호회·유튜브·자동차 커뮤니티)
// 하루에 종류마다 한 파일(같은 날 다시 저장하면 그날 파일을 바꿈). 가장 최근 날짜의 파일이 '최종'이며,
// 게시물 찾기·댓글 수집에서 파일을 고르지 않으면 이 최종 파일에 이어 쓴다.

const DB_KINDS = {
  buzz: { label: "게시물 리스트 (채널별 버즈량 현황)", short: "게시물 리스트" },
  raw: { label: "댓글 raw data", short: "댓글 raw data" },
};

function finalDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("finalDb", 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore("files", { keyPath: "key" });
      store.createIndex("kind", "kind");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbTx(mode, fn) {
  const db = await finalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", mode);
    const out = fn(tx.objectStore("files"));
    tx.oncomplete = () => resolve(out?.result ?? out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 날짜 최신순 → { key, kind, date(YYYYMMDD), name, bytes, savedAt, source('auto'|'upload'), summary }
async function dbList(kind) {
  const rows = await dbTx("readonly", (s) => s.index("kind").getAll(kind));
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.savedAt - a.savedAt);
}

async function dbLatest(kind) {
  return (await dbList(kind))[0] || null;
}

// stats: 그날 수집 건수 { posts } / { comments, youtube }. 같은 날 다시 저장하면 게시물·카페 댓글은 더하고
// 유튜브(매일 전체 다시 수집)는 바꾼다. stats 없이 저장(수정본 올리기 등)하면 그날 건수는 그대로 둔다.
async function dbSaveDay(kind, date, name, bytes, source, summary = "", stats = null) {
  const key = `${kind}:${date}`;
  const old = await dbTx("readonly", (s) => s.get(key)).catch(() => null);
  let merged = old?.stats || null;
  if (stats) {
    merged = { ...(old?.stats || {}) };
    for (const [k, v] of Object.entries(stats)) {
      if (v === undefined || v === null) continue;
      merged[k] = k === "youtube" ? v : (merged[k] || 0) + v;
    }
  }
  const rec = { key, kind, date, name, bytes, savedAt: Date.now(), source, summary, stats: merged };
  await dbTx("readwrite", (s) => s.put(rec));
  return rec;
}

// 그날 건수와 바로 전 기록일(전일·직전 근무일) 건수 비교 → { today, prev, prevDate, diff } (전 기록이 없으면 prev=null)
async function dbStatDiff(kind, date, field) {
  const rows = await dbList(kind);
  const cur = rows.find((r) => r.date === date);
  const prev = rows.find((r) => r.date < date && r.stats && r.stats[field] !== undefined);
  const today = cur?.stats?.[field] ?? null;
  if (today === null) return null;
  const p = prev ? prev.stats[field] : null;
  return { today, prev: p, prevDate: prev?.date || null, diff: p === null ? null : today - p };
}

// ▲ NN 건(빨강) / ▼ NN 건(파랑) / 변동 없음 → 요소
function diffBadge(d) {
  const span = document.createElement("span");
  if (!d || d.diff === null) {
    span.className = "diff none";
    span.textContent = "전일 기록 없음";
  } else if (d.diff > 0) {
    span.className = "diff up";
    span.textContent = `▲ ${d.diff.toLocaleString()} 건`;
  } else if (d.diff < 0) {
    span.className = "diff down";
    span.textContent = `▼ ${(-d.diff).toLocaleString()} 건`;
  } else {
    span.className = "diff none";
    span.textContent = "변동 없음";
  }
  if (d?.prevDate) span.title = `${prettyDate(d.prevDate)} ${d.prev.toLocaleString()}건 대비`;
  return span;
}

// "오늘 게시물 12건 (전일 대비 ▲ 3 건)" 한 줄
function diffLine(label, d) {
  const wrap = document.createElement("span");
  wrap.className = "diffline";
  wrap.append(`${label} ${d.today.toLocaleString()}건 (${d.prevDate ? `${prettyDate(d.prevDate).slice(5)} 대비 ` : "전일 대비 "}`, diffBadge(d), ")");
  return wrap;
}

async function dbDelete(key) {
  await dbTx("readwrite", (s) => s.delete(key));
}

// 파일 이름 앞 날짜(YYYYMMDD)가 있으면 그 날짜, 없으면 오늘
function dateFromName(name) {
  const m = String(name).match(/^(\d{8})/);
  return m ? m[1] : today();
}

function prettyDate(ymd8) {
  const d = new Date(Number(ymd8.slice(0, 4)), Number(ymd8.slice(4, 6)) - 1, Number(ymd8.slice(6, 8)));
  return `${ymd8.slice(0, 4)}-${ymd8.slice(4, 6)}-${ymd8.slice(6, 8)} (${"일월화수목금토"[d.getDay()]})`;
}

// 댓글 raw data 파일 → 시트별 마지막 연번 (최종 DB '내용' 칸, 한 줄에 한 채널)
const RAW_SHEETS = ["언론", "유튜브", "동호회", "자동차 커뮤니티"];
async function rawSummary(wb) {
  const names = wb.sheetNames();
  const lines = ["마지막 연번"];
  for (const name of RAW_SHEETS) {
    if (!names.includes(name)) continue;
    let last = 0;
    for (const r of await wb.readRows(name)) {
      const n = Number(r.cells.A);
      if (r.r > 1 && r.cells.A !== undefined && r.cells.A !== "" && Number.isFinite(n)) last = Math.max(last, n);
    }
    lines.push(`${name} ${last.toLocaleString()}`);
  }
  return lines.join("\n");
}

// 예전 모양('동호회 마지막 연번 …')으로 저장된 raw data 기록의 '내용'을 채널별로 다시 만든다 (한 번만)
async function refreshRawSummaries() {
  let changed = 0;
  for (const rec of await dbList("raw")) {
    if (!/^동호회 마지막 연번/.test(rec.summary || "")) continue;
    try {
      const summary = await rawSummary(await XlsxTemplate.Workbook.open(rec.bytes));
      await dbTx("readwrite", (s) => s.put({ ...rec, summary }));
      changed++;
    } catch {
      /* 못 읽는 파일은 그대로 둔다 */
    }
  }
  return changed;
}

// 채널 이름 → 색깔 둥근 상자 (언론 현대차 블루 · 유튜브 빨강 · 동호회 네이버 녹색 · 자동차 커뮤니티 보라)
const CHANNEL_CLASS = { 언론: "news", 유튜브: "yt", 동호회: "cafe", "자동차 커뮤니티": "comm" };
function channelChip(name) {
  const span = document.createElement("span");
  span.className = `ch ch-${CHANNEL_CLASS[name] || "etc"}`;
  span.textContent = name;
  return span;
}

// 최종 DB '내용' 칸: "마지막 연번\n언론 1,355\n…" → 줄마다 채널 색깔 상자 + 번호
function summaryNodes(summary) {
  const lines = String(summary || "").split("\n");
  if (lines.length < 2) return [String(summary || "")];
  return lines.map((line, i) => {
    const div = document.createElement("div");
    const name = i > 0 && Object.keys(CHANNEL_CLASS).find((c) => line.startsWith(`${c} `));
    if (name) div.append(channelChip(name), line.slice(name.length));
    else div.textContent = line;
    return div;
  });
}
