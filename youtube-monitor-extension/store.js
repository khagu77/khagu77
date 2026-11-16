// 이 PC 크롬 안의 데이터베이스 (IndexedDB)
//  videos: 찾은 영상 { id, title, channelId, channelName, group, published, views, likes, comments, desc, summary, include, … , history: { 'YYYY-MM-DD': {views, comments, likes} } }
//  thumbs: 엑셀용 작은 썸네일 (JPEG 바이트)
//  runs:   수집 기록 { at, found, added, … }
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open("hyundai-yt-monitor", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
        if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "at" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      let out;
      Promise.resolve(fn(st)).then((v) => (out = v));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  return {
    all: (store = "videos") => tx(store, "readonly", (st) => req(st.getAll())),
    get: (id, store = "videos") => tx(store, "readonly", (st) => req(st.get(id))),
    put: (rec, store = "videos") => tx(store, "readwrite", (st) => req(st.put(rec))),
    putMany: (recs, store = "videos") => tx(store, "readwrite", (st) => Promise.all(recs.map((r) => req(st.put(r))))),
    del: (id, store = "videos") => tx(store, "readwrite", (st) => req(st.delete(id))),
    clear: (store = "videos") => tx(store, "readwrite", (st) => req(st.clear())),
  };
})();

async function loadSettings() {
  const { hmSettings } = await chrome.storage.local.get("hmSettings");
  const s = { ...DEFAULTS, ...(hmSettings || {}) };
  s.ai = { ...DEFAULTS.ai, ...(hmSettings?.ai || {}) };
  if (String(s.managed || "").trim() === OLD_MANAGED_DEFAULT) s.managed = DEFAULTS.managed; // 예전 기본값 → GV90 채널 48곳
  return s;
}
async function saveSettings(s) {
  await chrome.storage.local.set({ hmSettings: s });
}
