// 수집 도우미: 5분마다 뽐뿌 게시판 목록을 읽어(평소 크롬으로 보는 것과 같은 접속) 새 글만 모니터링 시스템으로 보냄
importScripts("parse.js");

const DEF = {
  on: true,
  endpoint: "https://hd-issue-monitor.web.app/api/ingest",
  token: "",
  boards: "car | 뽐뿌 자동차포럼\nfreeboard | 뽐뿌 자유게시판",
  every: 5,
};
const getCfg = async () => ({ ...DEF, ...(await chrome.storage.local.get(Object.keys(DEF))) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const boardsOf = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [id, name] = l.split("|").map((x) => x.trim());
  return { id, name: name || `뽐뿌 ${id}` };
}).filter((b) => /^[\w-]+$/.test(b.id));

async function schedule() {
  const c = await getCfg();
  await chrome.alarms.clear("collect");
  if (c.on) chrome.alarms.create("collect", { periodInMinutes: Math.max(3, Number(c.every) || 5), delayInMinutes: 0.2 });
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "collect") run().catch(() => {}); });

async function fetchList(id, page) {
  const r = await fetch(`https://www.ppomppu.co.kr/zboard/zboard.php?id=${encodeURIComponent(id)}&page=${page}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`뽐뿌 ${id} ${r.status}`);
  const buf = await r.arrayBuffer();
  const ct = r.headers.get("content-type") || "";
  const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
  const cs = (ct.match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  return new TextDecoder(/euc-kr|ks_c|cp949/i.test(cs) ? "euc-kr" : "utf-8").decode(buf);
}

let running = false;
async function run() {
  if (running) return { skipped: true };
  running = true;
  const status = { at: Date.now(), sent: 0, created: 0, error: "" };
  try {
    const c = await getCfg();
    if (!c.on) return status;
    if (!c.token) throw new Error("수집 토큰을 넣어 주세요 (시스템 → 설정 → API 키 → 크롬 수집 도우미)");
    const { seen = {} } = await chrome.storage.local.get("seen");
    const items = [];
    for (const b of boardsOf(c.boards)) {
      const prev = new Set(seen[b.id] || []);
      const first = !seen[b.id];
      const top = [];
      for (let page = 1; page <= 2; page++) {
        const rows = HDParse.parsePpomppuList(await fetchList(b.id, page), b.id);
        if (page === 1) top.push(...rows.map((r) => r.no));
        const fresh = rows.filter((r) => !prev.has(r.no));
        for (const r of fresh) {
          items.push({
            channel: "ppomppu", title: r.title, url: `https://www.ppomppu.co.kr/zboard/view.php?id=${b.id}&no=${r.no}`,
            source: b.name, sourceId: `ppomppu:${b.id}`, postedAt: r.date ? r.date.toISOString() : null,
          });
        }
        if (first || fresh.length < rows.length || !rows.length) break;
        await sleep(1500 + Math.random() * 1500);
      }
      if (top.length) seen[b.id] = [...new Set([...top, ...(seen[b.id] || [])])].slice(0, 300);
      await sleep(1000 + Math.random() * 1500);
    }
    if (items.length) {
      const r = await fetch(c.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
        body: JSON.stringify({ items, client: `수집 도우미 ${chrome.runtime.getManifest().version}` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `시스템 응답 ${r.status}`);
      status.sent = items.length;
      status.created = j.created || 0;
    }
    await chrome.storage.local.set({ seen });
  } catch (e) {
    status.error = e.message || String(e);
  } finally {
    running = false;
    const { log = [] } = await chrome.storage.local.get("log");
    await chrome.storage.local.set({ last: status, log: [status, ...log].slice(0, 20) });
    chrome.action.setBadgeText({ text: status.error ? "!" : status.created ? String(status.created) : "" });
    chrome.action.setBadgeBackgroundColor({ color: status.error ? "#d93a3b" : "#1f5fd6" });
  }
  return status;
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg === "runNow") { run().then(reply); return true; }
  if (msg === "reschedule") { schedule().then(() => reply(true)); return true; }
  return false;
});
