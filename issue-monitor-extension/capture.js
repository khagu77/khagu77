// 네이버 카페 화면(MAIN world)에 수집하는 동안만 끼워 넣는 스크립트.
// 카페 화면이 스스로 불러오는 게시글 목록/본문 데이터(JSON)를 옆에서 같이 받아 둔다.
// 확장이 네이버에 따로 요청을 보내지 않으므로, 사람이 화면을 보는 것과 요청 내용이 같다.
(() => {
  if (window.__imHooked) return;
  window.__imHooked = true;
  const store = (window.__imCaptured = []);

  function keep(url, text) {
    if (!text || text.length > 5_000_000) return;
    if (!/article|Article|cafeId|clubid/i.test(text)) return;
    try {
      store.push({ url: String(url), data: JSON.parse(text) });
      if (store.length > 80) store.shift();
    } catch {
      // JSON 이 아니면 무시
    }
  }

  const interesting = (url) => /naver\.com/.test(String(url));

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = res.url || String(args[0] && args[0].url ? args[0].url : args[0]);
        if (interesting(url)) {
          res
            .clone()
            .text()
            .then((t) => keep(url, t))
            .catch(() => {});
        }
      } catch {
        // 무시
      }
      return res;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__imUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (interesting(this.__imUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") keep(this.__imUrl, this.responseText);
          else if (this.responseType === "json" && this.response) keep(this.__imUrl, JSON.stringify(this.response));
        } catch {
          // 무시
        }
      });
    }
    return origSend.apply(this, args);
  };
})();
