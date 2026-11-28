// 뽐뿌 게시판 목록 HTML → 글 목록 [{ no, title, date }] (서비스 워커에는 DOMParser 가 없어 글자로 읽음)
(function (root) {
  const decode = (s) => String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();

  // 목록 한 줄의 글자에서 작성 시각 (오늘 글은 시:분:초, 지난 글은 YY/MM/DD)
  function rowDate(text, now = new Date()) {
    const k = new Date(now.getTime() + 9 * 3600e3);
    const mk = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
    let m = text.match(/(?<!\d)(\d{2})[./](\d{1,2})[./](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return mk(2000 + +m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
    m = text.match(/(?<![\d:])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d:])/);
    if (m) {
      const d = mk(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate(), +m[1], +m[2]);
      return d > now ? new Date(d.getTime() - 86400e3) : d;
    }
    return null;
  }

  function parsePpomppuList(html, boardId, now = new Date()) {
    const best = new Map();
    const re = /<a\b[^>]*href=["']([^"']*view\.php\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const href = m[1].replace(/&amp;/g, "&");
      const id = (href.match(/[?&]id=([^&#]+)/) || [])[1];
      const no = (href.match(/[?&]no=(\d+)/) || [])[1];
      if (!no || id !== boardId) continue;
      const title = decode(m[2]).replace(/\s*\[\d+\]\s*$/, "");
      if (!title || /^\d+$/.test(title)) continue;
      const prev = best.get(no);
      if (prev && prev.title.length >= title.length) continue;
      // 이 링크가 든 목록 한 줄(<tr>…</tr>)에서 시각 찾기
      const start = html.lastIndexOf("<tr", m.index);
      const end = html.indexOf("</tr>", m.index);
      const row = start >= 0 && end > m.index && m.index - start < 4000 ? html.slice(start, end) : html.slice(m.index, m.index + 800);
      best.set(no, { no, title, date: rowDate(decode(row.replace(/<a\b[\s\S]*?<\/a>/i, " ")), now) });
    }
    return [...best.values()];
  }

  root.HDParse = { parsePpomppuList, rowDate, decode };
  if (typeof module !== "undefined") module.exports = root.HDParse;
})(typeof self !== "undefined" ? self : globalThis);
