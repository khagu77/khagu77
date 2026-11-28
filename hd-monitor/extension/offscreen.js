// 서비스 워커에는 DOMParser 가 없어 이 숨은 문서에서 네이버 검색 화면을 읽음
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "parseNaver") return false;
  try {
    // 검색 화면의 onclick 같은 동작 코드는 필요 없으므로 지우고 읽음 (크롬 확장 오류 메시지 방지)
    const html = String(msg.html || "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
    const doc = new DOMParser().parseFromString(html, "text/html");
    reply({ rows: HDNaver.parseSearchDoc(doc, msg.kind) });
  } catch (e) {
    reply({ rows: [], error: String(e.message || e) });
  }
  return false;
});
