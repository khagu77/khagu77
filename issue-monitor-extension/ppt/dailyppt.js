// 일일 보고서 PPT 최종본 보관 (데일리 DB) — 주간 보고서의 바탕 자료
// 보고 날짜마다 PPT 를 종류별로 하나씩 둔다 (이 PC 크롬 IndexedDB "report-extension" / kv "dailyPpts"):
//   system : 시스템이 만든 PPT (PPT 받기 때 자동 저장)
//   edited : 담당자가 고쳐서 올린 PPT
//   full   : 1인용(나눠 쓰기)일 때 따로 올린 전체 PPT, 또는 지난 PPT 올리기
// 그날의 최종본 = 전체(full) > 담당자 수정본 > 시스템 작성본 (나눠 쓴 일부 PPT 는 전체가 아니면 뒤로)
(function (global) {
  const KEY = "dailyPpts";
  const KEEP_DAYS = 70;
  const KIND_LABEL = { full: "전체 PPT(첨부)", edited: "담당자 수정본", system: "시스템 작성본" };

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("report-extension", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function get() {
    const db = await open();
    return new Promise((resolve) => {
      const r = db.transaction("kv").objectStore("kv").get(KEY);
      r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []);
      r.onerror = () => resolve([]);
    });
  }
  async function put(list) {
    const db = await open();
    return new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(list, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // 파일 이름에서 보고 날짜 찾기: "261016", "2026-10-16", "20261016", "10.16" 등
  function dateFromName(name, ref = new Date()) {
    const s = String(name || "");
    let m = s.match(/(20\d{2})[-._]?(\d{2})[-._]?(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(?:^|[^\d])(2\d)(\d{2})(\d{2})(?:[^\d]|$)/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `20${m[1]}-${m[2]}-${m[3]}`;
    return "";
  }

  const rank = (e) => (e.kind === "full" ? 3 : 0) + (e.partial ? 0 : 2) + (e.kind === "edited" ? 1 : 0);

  // 같은 날짜·같은 종류는 새것으로 바꾼다
  async function add(entry) {
    const list = await get();
    const e = { id: `${entry.date}-${entry.kind}-${Date.now()}`, at: Date.now(), partial: false, count: 0, ...entry };
    const cut = dateKey(new Date(Date.now() - KEEP_DAYS * 86400000));
    const next = [e, ...list.filter((x) => !(x.date === e.date && x.kind === e.kind) && x.date >= cut)];
    await put(next);
    return e;
  }

  async function remove(id) {
    await put((await get()).filter((x) => x.id !== id));
  }

  // 날짜별 묶음: [{ date, entries(최종본 순), final }]
  async function byDate() {
    const list = await get();
    const map = new Map();
    for (const e of list) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, entries]) => {
        entries.sort((a, b) => rank(b) - rank(a) || b.at - a.at);
        return { date, entries, final: entries[0] };
      });
  }

  async function finalOf(date) {
    const d = (await byDate()).find((x) => x.date === date);
    return d ? d.final : null;
  }

  global.DailyPpt = { add, remove, byDate, finalOf, dateFromName, dateKey, KIND_LABEL };
})(typeof window !== "undefined" ? window : self);
