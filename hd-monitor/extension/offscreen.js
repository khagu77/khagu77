// 서비스 워커에는 DOMParser 가 없어 이 숨은 문서에서 네이버 검색 화면을 읽음
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "parseNaver") return false;
  try {
    const doc = new DOMParser().parseFromString(msg.html, "text/html");
    reply({ rows: HDNaver.parseSearchDoc(doc, msg.kind) });
  } catch (e) {
    reply({ rows: [], error: String(e.message || e) });
  }
  return false;
});
