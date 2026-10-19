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

async function dbSaveDay(kind, date, name, bytes, source, summary = "") {
  const rec = { key: `${kind}:${date}`, kind, date, name, bytes, savedAt: Date.now(), source, summary };
  await dbTx("readwrite", (s) => s.put(rec));
  return rec;
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
