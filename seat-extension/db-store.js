// 데이터 DB: 받은 엑셀 파일을 이 PC 크롬(확장프로그램 저장소, IndexedDB)에 날짜별로 보관한다.
// (댓글 수집기의 db-store.js 를 이 확장에 맞게 고친 것)
// 종류(kind): seat = 최종 데이터(체크한 글 · 보고 양식) · seatRaw = 전체 raw 데이터(찾은 글 전체)
// 하루에 한 파일(같은 날 다시 받으면 그날 파일을 바꿈). 가장 최근 날짜의 파일이 '최종'.

const DB_KINDS = {
  seat: { label: "최종 데이터 (체크한 글 · 보고 양식)", short: "최종 데이터" },
  seatRaw: { label: "전체 raw 데이터 (찾은 글 전체)", short: "전체 raw 데이터" },
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

// stats: 그 파일의 건수 { posts, LX3, ME1, MX5, missing }. 받을 때마다 전체를 다시 쓰는 파일이라
// 같은 날 다시 저장하면 더하지 않고 바꾼다. stats 없이 저장(수정본 올리기 등)하면 그날 건수는 그대로 둔다.
async function dbSaveDay(kind, date, name, bytes, source, summary = "", stats = null) {
  const key = `${kind}:${date}`;
  const old = await dbTx("readonly", (s) => s.get(key)).catch(() => null);
  let merged = old?.stats || null;
  if (stats) {
    merged = { ...(old?.stats || {}) };
    for (const [k, v] of Object.entries(stats)) {
      if (v === undefined || v === null) continue;
      merged[k] = v;
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
