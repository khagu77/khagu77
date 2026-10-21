// 보고서 DB: 이 PC 크롬 안(IndexedDB)에 작업(보고서)마다 수집 게시글·댓글·성향·보고서 문장과
// 만들어진 파일(게시글 엑셀·댓글 엑셀·성향 엑셀·PPT)을 함께 보관한다. 백업 파일(.zip)로 내보내기·가져오기.

const IDB_NAME = "issue-report-db";
const IDB_VERSION = 1;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) {
        const fs = db.createObjectStore("files", { keyPath: "id" });
        fs.createIndex("jobId", "jobId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let idbPromise = null;
const idb = () => (idbPromise ||= idbOpen());

async function idbRun(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(tx.objectStore(store))).then((v) => (out = v));
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const DB = {
  async putJob(job) {
    job.updatedAt = Date.now();
    await idbRun("jobs", "readwrite", (s) => s.put(JSON.parse(JSON.stringify(job))));
  },
  async getJob(id) {
    return idbRun("jobs", "readonly", (s) => reqP(s.get(id)));
  },
  async listJobs() {
    const all = await idbRun("jobs", "readonly", (s) => reqP(s.getAll()));
    return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async deleteJob(id) {
    const files = await DB.listFiles(id);
    await idbRun("files", "readwrite", (s) => files.forEach((f) => s.delete(f.id)));
    await idbRun("jobs", "readwrite", (s) => s.delete(id));
  },
  // kind: posts | comments | sentiment | pptx
  async putFile(jobId, kind, name, bytes) {
    const rec = { id: `${jobId}/${kind}`, jobId, kind, name, bytes: new Blob([bytes]), size: bytes.length, at: Date.now() };
    await idbRun("files", "readwrite", (s) => s.put(rec));
    return rec;
  },
  async getFile(id) {
    return idbRun("files", "readonly", (s) => reqP(s.get(id)));
  },
  async listFiles(jobId) {
    return idbRun("files", "readonly", (s) => reqP(s.index("jobId").getAll(jobId)));
  },

  // 백업: backup.json(작업 목록) + files/… (만든 파일 그대로)
  async exportZip(jobIds = null) {
    const jobs = (await DB.listJobs()).filter((j) => !jobIds || jobIds.includes(j.id));
    const out = new Map();
    const fileMeta = [];
    for (const j of jobs) {
      for (const f of await DB.listFiles(j.id)) {
        const path = `files/${f.id.replace(/[^\w.-]+/g, "_")}`;
        out.set(path, new Uint8Array(await f.bytes.arrayBuffer()));
        fileMeta.push({ id: f.id, jobId: f.jobId, kind: f.kind, name: f.name, at: f.at, path });
      }
    }
    out.set("backup.json", JSON.stringify({ app: "issue-report", version: 1, exportedAt: Date.now(), jobs, files: fileMeta }));
    return Zip.write(out);
  },
  async importZip(bytes) {
    const files = await Zip.read(bytes);
    const meta = JSON.parse(Zip.text(files.get("backup.json") || new Uint8Array()));
    if (meta.app !== "issue-report") throw new Error("이 프로그램의 백업 파일이 아닙니다");
    for (const j of meta.jobs || []) await idbRun("jobs", "readwrite", (s) => s.put(j));
    for (const f of meta.files || []) {
      const data = files.get(f.path);
      if (!data) continue;
      await idbRun("files", "readwrite", (s) => s.put({ id: f.id, jobId: f.jobId, kind: f.kind, name: f.name, at: f.at, size: data.length, bytes: new Blob([data]) }));
    }
    return { jobs: (meta.jobs || []).length, files: (meta.files || []).length };
  },
};
