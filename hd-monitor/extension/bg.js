// 수집 도우미: 5분마다 뽐뿌 게시판 목록 + 네이버 검색(뉴스·블로그·카페)을 평소 크롬으로 보는 것처럼 읽어 새 글만 모니터링 시스템으로 보냄
importScripts("parse.js", "naver-parse.js");

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

// ── 네이버 검색 (시스템이 정해 준 검색어를 돌아가며, 사람이 검색하는 속도로) ──
const h8 = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

async function remoteConfig(c) {
  const { rc } = await chrome.storage.local.get("rc");
  if (rc && Date.now() - rc.at < 30 * 60e3) return rc.cfg;
  const r = await fetch(c.endpoint, { headers: { Authorization: `Bearer ${c.token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `시스템 응답 ${r.status}`);
  await chrome.storage.local.set({ rc: { at: Date.now(), cfg: j } });
  return j;
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_PARSER"], justification: "네이버 검색 결과 화면 읽기" });
}

// 카페 이름 사전: 카페 주소 ID(소문자) 또는 '#카페 번호' → { club, num, name }
// 검색 화면에 카페 이름이 없을 때 카페 첫 화면 제목("이름 : 네이버 카페")에서 찾아 기억해 둠 (한 번에 몇 곳씩만)
async function cafeDict() { return (await chrome.storage.local.get("cafeDict")).cafeDict || {}; }
function remember(dict, club, num, name) {
  const e = { club: club || dict[`#${num}`]?.club || "", num: num || dict[String(club).toLowerCase()]?.num || "", name: name || "" };
  if (e.club) dict[e.club.toLowerCase()] = { ...(dict[e.club.toLowerCase()] || {}), ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)) };
  if (e.num) dict[`#${e.num}`] = { ...(dict[`#${e.num}`] || {}), ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)) };
}
// 카페 이름 찾기: ① 네이버 카페 안내 정보(JSON) ② 카페 첫 화면 제목 · og:title
async function lookupCafe(dict, club) {
  let name = "", num = "";
  try {
    const r = await fetch(`https://apis.naver.com/cafe-web/cafe2/CafeGateInfo.json?cluburl=${encodeURIComponent(club)}`, { credentials: "include", cache: "no-store" });
    if (r.ok) {
      const t = await r.text();
      name = (t.match(/"cafeName"\s*:\s*"([^"]{1,80})"/) || t.match(/"clubName"\s*:\s*"([^"]{1,80})"/) || [])[1] || "";
      num = (t.match(/"(?:cafeId|clubId|clubid)"\s*:\s*"?(\d{3,})/) || [])[1] || "";
      if (name) name = JSON.parse(`"${name}"`);
    }
  } catch {}
  if (!name) {
    const r = await fetch(`https://cafe.naver.com/${encodeURIComponent(club)}`, { credentials: "include", cache: "no-store" });
    if (!r.ok) return;
    const html = await r.text();
    name = (html.match(/<title>\s*([^<]+?)\s*:\s*네이버\s*카페\s*<\/title>/i) || html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i) || [])[1] || "";
    if (/^네이버\s*카페$/.test(name.trim())) name = "";
    num ||= (html.match(/g_sClubId\s*=\s*["'](\d+)["']/) || html.match(/["']?clubid["']?\s*[:=]\s*["']?(\d{4,})/i) || [])[1] || "";
  }
  remember(dict, club, num, name.replace(/\s*:\s*네이버\s*카페$/, "").trim());
}

async function collectNaver(cfg, items, status, names) {
  const n = cfg.naver || {};
  if (!n.on || !n.queries?.length || !n.kinds?.length) return;
  const st = await chrome.storage.local.get(["naverCursor", "naverSeen", "naverPauseUntil"]);
  if (st.naverPauseUntil > Date.now()) { status.naver = `네이버 잠시 쉼 (${Math.ceil((st.naverPauseUntil - Date.now()) / 60000)}분)`; return; }
  const calls = [];
  for (const q of n.queries) for (const k of n.kinds) calls.push({ q, k });
  let i = (st.naverCursor || 0) % calls.length;
  const seen = st.naverSeen || {};
  const perRun = Math.max(3, Math.min(30, Number(n.perRun) || 12));
  const dict = await cafeDict();
  for (const c of cfg.favCafes || []) if (!dict[String(c.id).toLowerCase()]?.name) remember(dict, c.id, "", c.name);
  const unknown = new Set();
  await ensureOffscreen();
  let done = 0;
  let got = 0;
  for (let x = 0; x < Math.min(perRun, calls.length); x++) {
    const { q, k } = calls[i];
    i = (i + 1) % calls.length;
    const r = await fetch(HDNaver.searchUrl(k, q), { credentials: "include", cache: "no-store" });
    const html = await r.text();
    if (HDNaver.isBlocked(html, r.status)) {
      await chrome.storage.local.set({ naverPauseUntil: Date.now() + 30 * 60e3 });
      status.naver = "네이버가 잠시 막음 → 30분 쉼";
      break;
    }
    const { rows = [] } = await chrome.runtime.sendMessage({ target: "offscreen", type: "parseNaver", html, kind: k });
    const sk = `${k}|${q}`;
    const prev = new Set(seen[sk] || []);
    for (const row of rows) {
      if (k === "cafe") {
        const num = (row.url.match(/cafes\/(\d+)\/articles/) || [])[1] || "";
        const art = (row.url.match(/articles\/(\d+)/) || [])[1] || "";
        if (row.source) remember(dict, row.club, num, row.source);
        const e = (row.club && dict[row.club.toLowerCase()]) || (num && dict[`#${num}`]) || null;
        if (!row.club && e?.club) { row.club = e.club; if (art) row.url = `https://cafe.naver.com/${e.club}/${art}`; }
        if (!row.source && e?.name) row.source = e.name;
        if (!row.source && row.club) unknown.add(row.club);
      }
      const hh = h8(row.url);
      if (prev.has(hh)) continue;
      got++;
      items.push({
        channel: k, title: row.title, desc: row.snippet, url: row.url, extUrl: row.extUrl, source: row.source,
        sourceId: k === "cafe" ? row.club : k === "blog" ? row.owner : "", postedAt: row.date, fromSearch: true, query: q,
      });
    }
    seen[sk] = rows.map((row) => h8(row.url)).slice(0, 40);
    done++;
    await sleep(2500 + Math.random() * 3000); // 사람이 검색하는 정도의 간격
  }
  // 이름 모르는 카페 · 번호 모르는 관심 동호회를 몇 곳씩 알아 둠 (다음 수집부터 이름 표시·관심 동호회 확인)
  const favNoNum = (cfg.favCafes || []).map((c) => c.id).filter((id) => !dict[String(id).toLowerCase()]?.num);
  const ask = (cfg.cafeLookup || []).filter((club) => !dict[String(club).toLowerCase()]?.name);
  for (const club of [...new Set([...unknown].slice(0, 4).concat(ask.slice(0, 6), favNoNum.slice(0, 3)))]) {
    try { await lookupCafe(dict, club); } catch {}
    await sleep(1200 + Math.random() * 1500);
  }
  // 시스템이 물어본 카페 · 이번에 이름을 안 카페 → 시스템의 카페 이름 장부로 (이미 저장된 글의 이름도 채워짐)
  const sentNames = (await chrome.storage.local.get("cafeNamesSent")).cafeNamesSent || {};
  for (const [k, e] of Object.entries(dict)) {
    if (k.startsWith("#") || !e.name || !e.club) continue;
    if (sentNames[k] !== e.name || (cfg.cafeLookup || []).map((x) => String(x).toLowerCase()).includes(k)) names[e.club] = e.name;
    if (Object.keys(names).length >= 200) break;
  }
  await chrome.storage.local.set({ naverCursor: i, naverSeen: seen, cafeDict: dict });
  status.naver ||= `네이버 검색 ${done}회 (전체 ${calls.length}개 중), 새 글 ${got}건`;
}

let running = false;
async function run() {
  if (running) return { skipped: true };
  running = true;
  const status = { at: Date.now(), sent: 0, created: 0, error: "", naver: "", ppomppu: "" };
  try {
    const c = await getCfg();
    if (!c.on) return status;
    if (!c.token) throw new Error("수집 토큰을 넣어 주세요 (시스템 → 설정 → API 키 → 크롬 수집 도우미)");
    const { seen = {} } = await chrome.storage.local.get("seen");
    const items = [];
    const cafeNames = {};
    try {
      await collectNaver(await remoteConfig(c), items, status, cafeNames);
    } catch (e) {
      status.naver = `네이버 오류: ${e.message || e}`;
    }
    const before = items.length;
    let boardsRead = 0;
    for (const b of boardsOf(c.boards)) {
      boardsRead++;
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
    status.ppomppu = `뽐뿌 게시판 ${boardsRead}곳, 새 글 ${items.length - before}건`;
    if (items.length || Object.keys(cafeNames).length) {
      const r = await fetch(c.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
        body: JSON.stringify({ items, cafeNames, client: `수집 도우미 ${chrome.runtime.getManifest().version}`, naver: status.naver }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `시스템 응답 ${r.status}`);
      status.sent = items.length;
      if (Object.keys(cafeNames).length) {
        const { cafeNamesSent = {} } = await chrome.storage.local.get("cafeNamesSent");
        await chrome.storage.local.set({ cafeNamesSent: { ...cafeNamesSent, ...Object.fromEntries(Object.entries(cafeNames).map(([k, v]) => [k.toLowerCase(), v])) } });
      }
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
  if (typeof msg !== "string") return false; // offscreen 문서용 메시지는 무시
  if (msg === "runNow") { run().then(reply); return true; }
  if (msg === "reschedule") { schedule().then(() => reply(true)); return true; }
  return false;
});
