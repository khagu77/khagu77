// 화면과 서버가 같이 씀 (npm run sync-shared)
// 언론사 사이트 주소 (로고 아이콘용): 언론사 원문 주소 → 없으면 네이버뉴스 언론사 번호로
const OID_SITE = { "001": "yna.co.kr", "003": "newsis.com", "421": "news1.kr", "015": "hankyung.com", "009": "mk.co.kr", "011": "sedaily.com", "023": "chosun.com", "025": "joongang.co.kr", "020": "donga.com", "028": "hani.co.kr", "032": "khan.co.kr", "469": "hankookilbo.com", "005": "kmib.co.kr", "081": "seoul.co.kr", "021": "munhwa.com", "022": "segye.com", "008": "mt.co.kr", "018": "edaily.co.kr", "014": "fnnews.com", "277": "asiae.co.kr", "016": "heraldcorp.com", "056": "kbs.co.kr", "214": "imbc.com", "055": "sbs.co.kr", "437": "jtbc.co.kr", "052": "ytn.co.kr", "057": "mbn.co.kr", "449": "ichannela.com", "448": "tvchosun.com", "079": "nocutnews.co.kr", "047": "ohmynews.com", "002": "pressian.com", "030": "etnews.com", "092": "zdnet.co.kr", "029": "dt.co.kr", "031": "inews24.com", "648": "bizwatch.co.kr", "366": "biz.chosun.com", "374": "biz.sbs.co.kr", "215": "wowtv.co.kr", "119": "dailian.co.kr", "417": "moneys.co.kr", "293": "bloter.net", "138": "ddaily.co.kr", "629": "tf.co.kr", "087": "kwnews.co.kr", "088": "imaeil.com", "082": "busan.com", "658": "kookje.co.kr", "666": "kyeonggi.com", "662": "nongmin.com", "665": "thescoop.co.kr" };
export function siteOf(item) {
  if (item.channel !== "news") return null;
  const oid = String(item.url || "").match(/news\.naver\.com\/(?:mnews\/)?article\/(\d{3})\//)?.[1];
  try {
    const u = item.extUrl || (!oid ? item.url : "");
    if (u) return new URL(u).hostname.replace(/^(www|m|news|n)\./, "");
  } catch {}
  return (oid && OID_SITE[oid]) || null;
}

