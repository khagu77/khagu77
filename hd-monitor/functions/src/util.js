import crypto from "node:crypto";
import iconv from "iconv-lite";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hash = (s, n = 20) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, n);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
export function decodeHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// 한국 시간 기준 날짜 키 (YYYY-MM-DD) / 시(0~23)
export function kstParts(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  return { day: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// 문자 인코딩 자동 판별(EUC-KR 사이트 대응)해서 HTML 문자열로
export async function fetchHtml(url, headers = {}) {
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  let cs = (r.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1];
  if (!cs) cs = buf.slice(0, 2048).toString("latin1").match(/charset=["']?([\w-]+)/i)?.[1];
  cs = (cs || "utf-8").toLowerCase();
  if (/euc-kr|ks_c_5601|cp949/.test(cs)) return iconv.decode(buf, "cp949");
  return buf.toString("utf8");
}

// 동시에 n개씩 실행
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try {
        out[k] = { ok: true, value: await fn(items[k], k) };
      } catch (e) {
        out[k] = { ok: false, error: e };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export const canonicalUrl = (u) => {
  try {
    const x = new URL(u);
    x.hash = "";
    x.hostname = x.hostname.replace(/^m\./, "").replace(/^www\./, "");
    if (x.protocol === "http:") x.protocol = "https:";
    return x.toString();
  } catch {
    return String(u || "");
  }
};
