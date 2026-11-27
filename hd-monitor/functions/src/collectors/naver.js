// 네이버 검색 API (공식·무료: 앱 1개당 하루 25,000회) — 뉴스 · 블로그 · 카페글 · (선택) 웹문서 중 네이버 포스트
// 로그인이 필요 없고 차단 걱정이 없는 공식 경로. 카페글은 비가입 카페 글도 제목·요약이 나온다.
import { decodeHtml, fetchWithTimeout, hash, kstParts } from "../util.js";
import { getState, setState } from "../db.js";

const ENDPOINT = { news: "news", blog: "blog", cafe: "cafearticle", post: "webkr" };
const TICKS_PER_DAY = 288; // 5분마다

const PRESS = {
  "yna.co.kr": "연합뉴스", "yonhapnewstv.co.kr": "연합뉴스TV", "chosun.com": "조선일보", "joongang.co.kr": "중앙일보", "donga.com": "동아일보",
  "hani.co.kr": "한겨레", "khan.co.kr": "경향신문", "hankookilbo.com": "한국일보", "kmib.co.kr": "국민일보", "seoul.co.kr": "서울신문",
  "munhwa.com": "문화일보", "segye.com": "세계일보", "mk.co.kr": "매일경제", "hankyung.com": "한국경제", "sedaily.com": "서울경제",
  "mt.co.kr": "머니투데이", "edaily.co.kr": "이데일리", "fnnews.com": "파이낸셜뉴스", "asiae.co.kr": "아시아경제", "heraldcorp.com": "헤럴드경제",
  "newsis.com": "뉴시스", "news1.kr": "뉴스1", "kbs.co.kr": "KBS", "imbc.com": "MBC", "sbs.co.kr": "SBS", "jtbc.co.kr": "JTBC",
  "ytn.co.kr": "YTN", "mbn.co.kr": "MBN", "ichannela.com": "채널A", "tvchosun.com": "TV조선", "nocutnews.co.kr": "노컷뉴스",
  "ohmynews.com": "오마이뉴스", "pressian.com": "프레시안", "etnews.com": "전자신문", "zdnet.co.kr": "지디넷코리아", "dt.co.kr": "디지털타임스",
  "inews24.com": "아이뉴스24", "bizwatch.co.kr": "비즈워치", "biz.chosun.com": "조선비즈", "ajunews.com": "아주경제", "newspim.com": "뉴스핌",
  "dailian.co.kr": "데일리안", "etoday.co.kr": "이투데이", "mtn.co.kr": "MTN", "sentv.co.kr": "서울경제TV", "wowtv.co.kr": "한국경제TV",
  "motorgraph.com": "모터그래프", "autoherald.co.kr": "오토헤럴드", "autodaily.co.kr": "오토데일리", "dailycar.co.kr": "데일리카",
  "carguy.kr": "카가이", "autotimes.co.kr": "오토타임즈", "gpkorea.com": "글로벌오토뉴스", "motoya.co.kr": "모토야", "top-rider.com": "탑라이더",
  "autopostkorea.com": "오토포스트", "kpinews.kr": "KPI뉴스", "thebell.co.kr": "더벨", "businesspost.co.kr": "비즈니스포스트",
};
export function pressName(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|m|news|biz|n)\./, "");
    for (const [d, n] of Object.entries(PRESS)) if (h === d || h.endsWith(`.${d}`)) return n;
    return h;
  } catch {
    return "";
  }
}

export function parseKeys(text) {
  return String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [id, secret] = l.split(/[:\s]+/); return { id, secret }; })
    .filter((k) => k.id && k.secret);
}

export function normalizeItem(source, it) {
  const title = decodeHtml(it.title);
  const desc = decodeHtml(it.description);
  if (source === "news") {
    const naver = /n\.news\.naver\.com|news\.naver\.com/.test(it.link || "");
    const url = naver ? it.link : it.originallink || it.link;
    const d = it.pubDate ? new Date(it.pubDate) : null;
    return { channel: "news", title, desc, url, source: pressName(it.originallink || it.link), sourceId: "", postedAt: d && !isNaN(d) ? d : null };
  }
  if (source === "blog") {
    const pd = /^\d{8}$/.test(it.postdate || "") ? `${it.postdate.slice(0, 4)}-${it.postdate.slice(4, 6)}-${it.postdate.slice(6)}` : null;
    return { channel: "blog", title, desc, url: it.link, source: decodeHtml(it.bloggername), sourceId: it.bloggerlink || "", postedDay: pd, postedAt: null };
  }
  if (source === "cafe") {
    let clubId = "";
    try { clubId = new URL(it.cafeurl || it.link).pathname.split("/").filter(Boolean)[0] || ""; } catch {}
    return { channel: "cafe", title, desc, url: String(it.link || "").replace(/^http:/, "https:"), source: decodeHtml(it.cafename), sourceId: clubId, postedAt: null };
  }
  // 웹문서 중 네이버 포스트만
  if (!/post\.naver\.com/.test(it.link || "")) return null;
  return { channel: "post", title, desc, url: it.link, source: "네이버 포스트", sourceId: "", postedAt: null };
}

async function search(source, query, key, start = 1) {
  const u = `https://openapi.naver.com/v1/search/${ENDPOINT[source]}.json?${new URLSearchParams({ query, display: "100", start: String(start), sort: "date" })}`;
  const r = await fetchWithTimeout(u, { headers: { "X-Naver-Client-Id": key.id, "X-Naver-Client-Secret": key.secret } });
  if (r.status === 429) { const e = new Error("네이버 API 하루 한도 초과"); e.quota = true; throw e; }
  if (!r.ok) throw new Error(`네이버 API ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  return j.items || [];
}

// 이번 차례(5분)에 할 검색만 골라 실행하고 새 글을 돌려준다
export async function collectNaver({ queries, settings, secrets, log }) {
  const keys = parseKeys(secrets.naverKeys);
  if (!keys.length) { log.push("네이버: API 키 없음 (설정 → API 키)"); return []; }
  const sources = Object.entries(settings.collect.naver || {}).filter(([, on]) => on).map(([s]) => s);
  const calls = [];
  for (const q of queries) for (const s of sources) calls.push({ q, s });
  if (!calls.length) return [];

  const { day } = kstParts();
  const usage = await getState("naver_usage");
  if (usage.day !== day) { usage.day = day; usage.used = {}; usage.dead = {}; }
  const perKey = Math.max(100, Number(settings.collect.naverDailyBudget) || 24000);
  const perTick = Math.max(10, Math.floor((perKey * keys.length) / TICKS_PER_DAY));
  const pickKey = () => {
    for (let i = 0; i < keys.length; i++) {
      if (usage.dead[i]) continue;
      if ((usage.used[i] || 0) < perKey) return i;
    }
    return -1;
  };

  const cur = await getState("naver_cursor");
  let i = (cur.i || 0) % calls.length;
  const todo = [];
  for (let n = 0; n < Math.min(perTick, calls.length); n++) { todo.push(calls[i]); i = (i + 1) % calls.length; }

  const seenDocs = {};
  for (const s of sources) seenDocs[s] = await getState(`naver_seen_${s}`);
  const out = [];
  let used = 0;
  let budgetLeft = perTick;
  let errors = 0;

  // 동시에 6개씩 (네이버 API 초당 제한 여유)
  for (let k = 0; k < todo.length; k += 6) {
    const chunk = todo.slice(k, k + 6);
    await Promise.all(chunk.map(async ({ q, s }) => {
      const seen = new Set(seenDocs[s][q] || []);
      const firstHashes = [];
      for (let page = 0; page < 3 && budgetLeft > 0; page++) {
        const ki = pickKey();
        if (ki < 0) return;
        budgetLeft--; used++;
        usage.used[ki] = (usage.used[ki] || 0) + 1;
        let items;
        try {
          items = await search(s, q, keys[ki], 1 + page * 100);
        } catch (e) {
          if (e.quota) usage.dead[ki] = true;
          errors++;
          if (errors <= 3) log.push(`네이버 ${s} "${q}": ${e.message}`);
          return;
        }
        let fresh = 0;
        for (const it of items) {
          const h = hash(it.link, 10);
          if (page === 0) firstHashes.push(h);
          if (seen.has(h)) continue;
          fresh++;
          const n = normalizeItem(s, it);
          if (n) out.push({ ...n, via: `naver:${s}`, query: q });
        }
        // 처음 보는 검색어이거나, 이번 쪽이 전부 새 글일 때만 다음 쪽까지
        if (!seenDocs[s][q] || fresh < items.length || items.length < 100) break;
      }
      if (firstHashes.length) seenDocs[s][q] = firstHashes.slice(0, 80);
    }));
  }

  await Promise.all([
    setState("naver_cursor", { i, total: calls.length, perTick, at: new Date() }),
    setState("naver_usage", usage),
    ...sources.map((s) => setState(`naver_seen_${s}`, seenDocs[s])),
  ]);
  log.push(`네이버: 검색 ${used}회 (전체 ${calls.length}개 중 ${todo.length}개 차례), 받은 글 ${out.length}건`);
  return out;
}
