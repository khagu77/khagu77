// 자동차 커뮤니티 (보배드림 · 클리앙 · 뽐뿌) — 로그인 없는 공개 게시판 목록을 5분마다 1~2쪽 읽음
// 제목에 현대차 관련어나 이슈어가 있는 글만 저장 (LX3 수집기와 같은 게시판 규칙)
import * as cheerio from "cheerio";
import { decodeHtml, fetchHtml, pool, sleep } from "../util.js";
import { getState, setState } from "../db.js";

export function boardAdapter(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^m\./, "www.");
  if (host.endsWith("bobaedream.co.kr")) {
    const code = u.searchParams.get("code") || "national";
    return {
      channel: "bobae", site: "보배드림", key: `bobae:${code}`,
      listUrl: (p) => `https://www.bobaedream.co.kr/list?code=${encodeURIComponent(code)}&page=${p}`,
      articleId: (href) => {
        const m = String(href).replace(/&amp;/g, "&").match(/\/view\?[^"']*code=([^&"']+)[^"']*&No=(\d+)|\/view\?[^"']*No=(\d+)[^"']*code=([^&"']+)/i);
        if (!m) return null;
        const c = m[1] || m[4];
        const no = m[2] || m[3];
        return c === code ? no : null;
      },
      articleUrl: (id) => `https://www.bobaedream.co.kr/view?code=${encodeURIComponent(code)}&No=${id}`,
    };
  }
  if (host.endsWith("clien.net")) {
    const board = u.pathname.match(/\/service\/board\/([^/?#]+)/)?.[1] || "cm_car";
    return {
      channel: "clien", site: "클리앙", key: `clien:${board}`,
      listUrl: (p) => `https://www.clien.net/service/board/${board}?&od=T31&po=${p - 1}`,
      articleId: (href) => String(href).match(new RegExp(`/service/board/${board}/(\\d+)`))?.[1] || null,
      articleUrl: (id) => `https://www.clien.net/service/board/${board}/${id}`,
    };
  }
  if (host.endsWith("ppomppu.co.kr")) {
    const id = u.searchParams.get("id") || "car";
    return {
      channel: "ppomppu", site: "뽐뿌", key: `ppomppu:${id}`,
      listUrl: (p) => `https://www.ppomppu.co.kr/zboard/zboard.php?id=${encodeURIComponent(id)}&page=${p}`,
      articleId: (href) => {
        const q = String(href).replace(/&amp;/g, "&");
        if (!/view\.php/.test(q)) return null;
        return q.match(/[?&]id=([^&#]+)/)?.[1] === id ? q.match(/[?&]no=(\d+)/)?.[1] || null : null;
      },
      articleUrl: (no) => `https://www.ppomppu.co.kr/zboard/view.php?id=${encodeURIComponent(id)}&no=${no}`,
    };
  }
  return null;
}

// 목록 한 줄의 글자에서 작성 시각 찾기 (오늘 글은 시:분만, 지난 글은 날짜만 나오는 게시판이 많음)
export function rowDate(text, now = new Date()) {
  const t = String(text || "");
  const kNow = new Date(now.getTime() + 9 * 3600e3);
  const Y = kNow.getUTCFullYear();
  const mk = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
  let m = t.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m) return mk(+m[1], +m[2], +m[3], +m[4], +m[5]);
  m = t.match(/(?<!\d)(\d{2})[./](\d{1,2})[./](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m) return mk(2000 + +m[1], +m[2], +m[3], +m[4], +m[5]);
  m = t.match(/(?<![\d.:/-])(\d{1,2}):(\d{2})(?::\d{2})?(?![\d:])/);
  if (m) {
    const d = mk(Y, kNow.getUTCMonth() + 1, kNow.getUTCDate(), +m[1], +m[2]);
    return d > now ? new Date(d.getTime() - 86400e3) : d;
  }
  m = t.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/) || t.match(/(?<!\d)(\d{2})[./](\d{1,2})[./](\d{1,2})(?!\d)/);
  if (m) return mk(m[1].length === 2 ? 2000 + +m[1] : +m[1], +m[2], +m[3]);
  m = t.match(/(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d./])/);
  if (m && +m[1] <= 12) { const d = mk(Y, +m[1], +m[2]); return d > now ? mk(Y - 1, +m[1], +m[2]) : d; }
  return null;
}

export function parseBoardList(html, ad) {
  const $ = cheerio.load(html);
  const best = new Map();
  $("a[href]").each((_, a) => {
    const id = ad.articleId($(a).attr("href") || "");
    if (!id) return;
    const raw = decodeHtml($(a).attr("title") || $(a).text());
    const title = raw.replace(/\s*\[\d+\]\s*$/, "").trim();
    if (!title || /^\d+$/.test(title)) return;
    const prev = best.get(id);
    if (prev && prev.title.length >= title.length) return;
    const row = $(a).closest("tr, li, .list_item, .symph_row, .bbs_list_item");
    // 칸 사이를 띄어서 읽음 (붙여 읽으면 '(25)11/21204' 처럼 날짜를 못 찾음)
    const rowText = decodeHtml($.html(row.length ? row : $(a).parent().parent()).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    // 조회수: 클리앙 .list_hit .hit ('90.4 k'), 보배드림 td.count
    const hitTxt = row.find(".list_hit .hit, td.count, .hit, .count").first().text().trim();
    const hm = hitTxt.match(/^([\d,.]+)\s*([kK만])?$/);
    const views = hm ? Math.round(parseFloat(hm[1].replace(/,/g, "")) * (hm[2] === "만" ? 1e4 : hm[2] ? 1e3 : 1)) : null;
    // 댓글 수: 제목 끝 [12] 또는 제목 옆 댓글 표시 (게시판마다 달라 못 찾으면 비움)
    const dc = row.attr("data-comment-count"); // 클리앙: 글 줄에 댓글 수가 들어 있음
    const cm = (dc != null && /^\d+$/.test(dc) ? [null, dc] : null) || raw.match(/\[(\d{1,5})\]\s*$/) || $(a).text().match(/\[(\d{1,5})\]\s*$/) || $(a).parent().find(".rSymph05, .reply, .list_comment, .baseList-c, .comment_count, .totreply").first().text().match(/(\d{1,5})/);
    // 보배드림: 댓글이 없으면 표시가 없음 → 0
    const comments = cm ? +cm[1] : row.length && row.find(".totreply").length === 0 && ad.channel === "bobae" ? 0 : null;
    best.set(id, { id, title, date: rowDate(rowText), comments, views });
  });
  return [...best.values()];
}

export async function collectCommunity({ settings, log }) {
  // 뽐뿌는 서버 접속을 막아서 크롬 수집 도우미가 담당 (설정에서 서버 수집을 다시 켤 수 있음)
  const boards = (settings.boards || []).map((b) => ({ ...b, ad: boardAdapter(b.url) })).filter((b) => b.ad && (b.ad.channel !== "ppomppu" || settings.collect.serverPpomppu));
  if (!boards.length) return [];
  const seenDoc = await getState("community_seen");
  const out = [];
  const res = await pool(boards, 3, async (b) => {
    const seen = new Set(seenDoc[b.ad.key] || []);
    const first = !seenDoc[b.ad.key];
    const top = [];
    for (let p = 1; p <= 2; p++) {
      const rows = parseBoardList(await fetchHtml(b.ad.listUrl(p), { Referer: b.ad.listUrl(1) }), b.ad);
      if (p === 1) top.push(...rows.map((r) => r.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      for (const r of fresh) {
        out.push({
          channel: b.ad.channel, title: r.title, desc: "", url: b.ad.articleUrl(r.id), source: b.name || b.ad.site,
          sourceId: b.ad.key, postedAt: r.date, requireMatch: true, via: "community", comments: r.comments, views: r.views,
        });
      }
      if (first || fresh.length < rows.length || !rows.length) break;
      await sleep(800 + Math.random() * 1200);
    }
    if (top.length) seenDoc[b.ad.key] = top.slice(0, 120);
  });
  let fail = 0;
  for (const r of res) if (!r.ok) { fail++; if (fail <= 2) log.push(`커뮤니티: ${r.error.message}`); }
  await setState("community_seen", seenDoc);
  log.push(`커뮤니티 게시판 ${boards.length}곳, 새 글 ${out.length}건${fail ? `, 실패 ${fail}` : ""}`);
  return out;
}
