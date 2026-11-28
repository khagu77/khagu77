// 점검(읽기 전용): 네이버 카페 검색 '결과를 못 읽음' — 결과 0건 화면인지, 화면 모양이 바뀐 건지
import { searchUrl, parseSearchPage } from "./src/collectors/naverweb.js";
import { UA } from "./src/util.js";
for (const [q, nso] of [["승용차 시동꺼짐", true], ["불났", true], ["불났", false], ["현대차", true]]) {
  let u = searchUrl("cafe", q); if (!nso) u = u.replace(/&nso=[^&]+/, "");
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: "https://www.naver.com/" } });
  const h = await r.text();
  const vis = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const none = vis.match(/[^.]{0,30}(결과가 없|검색결과가 없|일치하는)[^.]{0,40}/);
  const links = new Set(h.match(/cafe\.naver\.com\/[\w-]+\/\d+|cafe\.naver\.com\/(?:ca-fe|f-e)\/cafes\/\d+\/articles\/\d+/g) || []);
  console.log(`${q}${nso ? " (최근 1일)" : " (기간 없음)"} | HTTP ${r.status} · ${h.length}자 | 결과 없음 문구: ${none ? none[0].trim() : "없음"} | 카페 글 링크 ${links.size} | 읽은 글 ${parseSearchPage(h, "cafe").length}`);
  await new Promise((s) => setTimeout(s, 3000));
}
