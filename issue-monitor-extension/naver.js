// 네이버 카페 수집
// - 확장이 네이버 API 를 직접 부르지 않는다. 백그라운드 탭 하나로 카페 화면(전체글보기 목록, 게시글)을
//   사람처럼 차례로 열고, 화면에 보이는 내용과 그 화면이 스스로 불러온 데이터만 읽는다.
// - 열고 닫는 사이사이 무작위로 기다리고, 몇 카페마다 길게 쉰다.
// - 로그인 풀림·보호조치·자동입력 방지 화면이 보이면 BlockedError 로 네이버 수집을 즉시 멈춘다.

const CAPTURE_SCRIPT_ID = "im-capture";

async function enableCapture() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CAPTURE_SCRIPT_ID] });
  } catch {
    // 등록돼 있지 않으면 무시
  }
  await chrome.scripting.registerContentScripts([
    {
      id: CAPTURE_SCRIPT_ID,
      matches: ["https://cafe.naver.com/*"],
      js: ["capture.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      persistAcrossSessions: false,
    },
  ]);
}

async function disableCapture() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CAPTURE_SCRIPT_ID] });
  } catch {
    // 무시
  }
}

// 탭이 새 주소를 읽기 시작(loading)한 뒤 다 읽을(complete) 때까지 기다린다.
function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let started = false;
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve();
    }
    function listener(id, info) {
      if (id !== tabId) return;
      if (info.status === "loading") started = true;
      else if (info.status === "complete" && started) done();
    }
    function onRemoved(id) {
      if (id === tabId) done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

// 백그라운드 탭 하나를 계속 재사용하며 주소만 바꿔 연다.
class WorkerTab {
  constructor() {
    this.tabId = null;
    this.pageviews = 0;
  }

  async open(url) {
    this.pageviews++;
    if (this.pageviews > NAVER_MAX_PAGEVIEWS) {
      throw new BlockedError(`안전을 위해 한 번에 여는 네이버 화면 수(${NAVER_MAX_PAGEVIEWS})를 넘겨 멈췄습니다`);
    }
    let tabId = this.tabId;
    if (tabId !== null) {
      try {
        await chrome.tabs.get(tabId);
      } catch {
        tabId = this.tabId = null; // 사용자가 탭을 닫음
      }
    }
    if (tabId === null) {
      const tab = await chrome.tabs.create({ url: "about:blank", active: false });
      this.tabId = tabId = tab.id;
      await sleep(500);
    }
    const loaded = waitForTabLoad(tabId);
    await chrome.tabs.update(tabId, { url });
    await loaded;
    await sleep(2500); // 화면(iframe/스크립트)이 그려질 시간
    const tab = await chrome.tabs.get(this.tabId);
    return tab.url || "";
  }

  async run(func, args = [], world = "ISOLATED") {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId, allFrames: true },
        func,
        args,
        world,
      });
    } catch {
      return []; // 오류 화면 등 읽을 수 없는 화면
    }
    return results.map((r) => r.result).filter((r) => r !== undefined && r !== null);
  }

  // 지금 탭 주소 (아직 탭을 안 열었거나 사용자가 닫았으면 "")
  async url() {
    if (this.tabId === null) return "";
    try {
      return (await chrome.tabs.get(this.tabId)).url || "";
    } catch {
      this.tabId = null;
      return "";
    }
  }

  // 맨 바깥 화면(프레임)에서만 실행
  async runMain(func, args = [], world = "MAIN") {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: this.tabId, frameIds: [0] }, func, args, world });
      return r ? r.result : null;
    } catch {
      return null;
    }
  }

  async captured() {
    const parts = await this.run(() => (window.__imCaptured || []).map((x) => x.data), [], "MAIN");
    return parts.flat();
  }

  async close() {
    if (this.tabId !== null) {
      await chrome.tabs.remove(this.tabId).catch(() => {});
      this.tabId = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 화면 안에서 실행되는 함수들 (확장 바깥 변수는 못 쓴다)
// ---------------------------------------------------------------------------

// 막힘/로그인/권한 신호
function pageSignalsInFrame() {
  const text = (document.body ? document.body.innerText : "").slice(0, 4000);
  return {
    href: location.href,
    blocked: /보호조치|비정상적인 (접근|활동)|자동입력 방지|자동 입력 방지|로봇이 아닙니다|captcha|이용이 제한/i.test(text),
    memberOnly: /멤버만 (볼|이용)|카페 멤버가 아닙니다|가입 후 이용|등급이 (부족|되어야)|읽기 권한/.test(text),
    login: location.hostname === "nid.naver.com",
  };
}

// 카페 숫자 번호(clubid) 찾기
function findClubIdInFrame() {
  const fromUrl = location.href.match(/\/cafes\/(\d+)/) || location.href.match(/clubid=(\d+)/i);
  if (fromUrl) return fromUrl[1];
  if (window.g_sClubId) return String(window.g_sClubId);
  const html = document.documentElement ? document.documentElement.innerHTML : "";
  const m = html.match(/g_sClubId\s*=\s*["']?(\d+)/) || html.match(/"cafeId"\s*:\s*"?(\d+)/) || html.match(/\/f-e\/cafes\/(\d+)/);
  return m ? m[1] : null;
}

// 목록 화면에서 게시글 링크 읽기 (데이터를 못 받았을 때의 대비책)
function listArticlesInFrame() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/articles\/(\d+)/) || href.match(/articleid=(\d+)/i);
    if (!m || seen.has(m[1])) continue;
    const title = (a.innerText || "").replace(/\s+/g, " ").trim();
    if (title.length < 2 || /^\[?\d+\]?$/.test(title)) continue;
    const row = a.closest("tr, li, [class*='item'], [class*='Item']") || a.parentElement;
    const dateEl = row && row.querySelector(".td_date, .date, [class*='date'], [class*='Date'], time");
    const isNotice = !!(row && row.querySelector(".notice, [class*='notice'], [class*='Notice'], .board-tag-notice, img[alt*='공지']"));
    seen.add(m[1]);
    out.push({
      articleId: m[1],
      title,
      dateText: dateEl ? dateEl.innerText.trim() : "",
      rowText: row ? row.innerText.replace(/\s+/g, " ").slice(0, 300) : "",
      isNotice,
    });
  }
  return out;
}

// 네이버 검색 결과에서 이 카페의 이 글 링크 찾기 → { index, href, snippet } 또는 null
function findCafeLinkInSearch(cafeId, articleId, title) {
  const anchors = [...document.querySelectorAll("a[href]")];
  const norm = (x) => String(x || "").replace(/\s+/g, "").toLowerCase();
  const want = norm(title).slice(0, 30);
  let best = null;
  anchors.forEach((a, index) => {
    const href = a.href || "";
    if (!/cafe\.naver\.com/.test(href)) return;
    const sameArticle =
      (cafeId && new RegExp(`cafe\\.naver\\.com/${cafeId}/${articleId}(?!\\d)`, "i").test(href)) ||
      new RegExp(`(articles/|articleid=)${articleId}(?!\\d)`, "i").test(href);
    const sameCafe = cafeId && new RegExp(`cafe\\.naver\\.com/${cafeId}(/|\\?|$)`, "i").test(href);
    const titleHit = want && norm(a.innerText).includes(want.slice(0, 15));
    const score = (sameArticle ? 10 : 0) + (sameCafe && titleHit ? 5 : 0);
    if (score >= 5 && (!best || score > best.score)) {
      const box = a.closest("li, .total_wrap, .detail_box, .view_wrap, [class*='item']") || a.parentElement;
      best = { index, href, score, snippet: box ? box.innerText.replace(/\s+/g, " ").slice(0, 600) : "" };
    }
  });
  return best;
}

// 검색 결과 링크를 같은 탭에서 열리게 해서 누른다
function clickSearchResult(index) {
  const a = [...document.querySelectorAll("a[href]")][index];
  if (!a) return false;
  a.setAttribute("target", "_self");
  a.click();
  return true;
}

// 카페 메뉴(왼쪽 게시판 목록)에서 그룹 제목 아래의 게시판 번호들 (화면 안에서 실행)
function findMenusInGroupInFrame(groupNorm) {
  const norm = (t) => String(t || "").replace(/[^가-힣A-Za-z0-9&]/g, "").toLowerCase();
  const menuId = (a) => {
    const m = (a.getAttribute("href") || "").match(/menus\/(\d+)|menuid=(\d+)/i);
    return m ? m[1] || m[2] : null;
  };
  const out = new Set();
  // 그룹 제목: 글자가 짧고 그룹 이름을 담았으며, 게시판 링크 자체는 아닌 요소 (가장 안쪽 것)
  const heads = [...document.querySelectorAll("li, div, p, strong, span, button, h3, h4, dt, a")].filter((e) => {
    const text = (e.innerText || "").trim();
    if (!text || text.length > 40 || !norm(text).includes(groupNorm)) return false;
    if (e.closest("a[href*='menus/'], a[href*='menuid=']")) return false;
    return ![...e.children].some((c) => norm(c.innerText).includes(groupNorm)); // 더 안쪽에 같은 글자가 있으면 그쪽을 쓴다
  });
  for (const h of heads) {
    // 1) 그룹 제목과 게시판들이 한 덩어리 안에 들어 있는 경우
    let box = h.parentElement;
    for (let d = 0; d < 3 && box; d++, box = box.parentElement) {
      const links = [...box.querySelectorAll("a[href]")].map(menuId).filter(Boolean);
      const otherHeads = [...box.querySelectorAll("li, div, p, strong, span, button, h3, h4, dt")].filter((e) => e !== h && /[★☆■□▶▷◆◇●○]/.test(e.innerText || "") && !e.querySelector("a"));
      if (links.length && links.length < 40 && otherHeads.length === 0) {
        links.forEach((x) => out.add(x));
        break;
      }
    }
    if (out.size) break;
    // 2) 그룹 제목 다음 형제들에 게시판이 이어지는 경우 (다음 그룹 제목 전까지)
    let row = h.closest("li, dt, div") || h;
    for (let sib = row.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const links = [...sib.querySelectorAll("a[href]"), ...(sib.matches("a[href]") ? [sib] : [])].map(menuId).filter(Boolean);
      if (!links.length) break;
      links.forEach((x) => out.add(x));
    }
    if (out.size) break;
  }
  return [...out];
}

// 진단용: 화면 상태 요약
function diagInFrame() {
  const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => /articles?\/?\d|articleid=/i.test(h));
  return {
    href: location.href,
    title: document.title,
    anchors: links.length,
    sample: links.slice(0, 3),
    text: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 160),
  };
}

// 카페 화면 안에서(로그인된 그 화면 그대로) 데이터 주소를 차례로 요청해 처음 성공한 것까지 돌려준다
async function fetchJsonInPage(urls) {
  const out = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { credentials: "include" });
      const t = await r.text();
      let data = null;
      try {
        data = JSON.parse(t);
      } catch {
        // JSON 아님
      }
      out.push({ url: u, status: r.status, data, snippet: data ? "" : t.slice(0, 120) });
      if (r.ok && data) break;
    } catch (e) {
      out.push({ url: u, error: String(e) });
    }
  }
  return out;
}

// 게시글 화면 읽기
function readArticleInFrame() {
  const pick = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return "";
  };
  return {
    href: location.href,
    title: pick([".title_text", ".ArticleTitle .title_text", "h3.title_text", ".tit-box .title"]),
    date: pick([".article_info .date", ".WriterInfo .date", ".ArticleWriterProfile .date", ".article_info", ".tit-box .date"]),
    body: pick([".se-main-container", ".ContentRenderer", ".article_viewer", ".article_container .content", "#tbody", "#postContent"]),
    // 댓글(지금 보이는 첫 페이지, 최대 30개): 본문에 차종이 없을 때 댓글로 유추
    comments: [...document.querySelectorAll("li.CommentItem")]
      .slice(0, 30)
      .map((li) => {
        const nick = (li.querySelector(".comment_nickname") || {}).innerText || "";
        const text = (li.querySelector(".text_comment") || {}).innerText || "";
        const mine = !!li.querySelector(".comment_writer, .CommentWriter, [class*='writer']");
        return text.trim() ? { nick: nick.trim(), text: text.trim().slice(0, 200), mine } : null;
      })
      .filter(Boolean),
    // 작성자: 닉네임과 작성자 정보(작성 글 목록) 화면 주소
    // 조회수·댓글 수 (보고 필요 선정에 참고)
    views: (() => {
      const m = (pick([".article_info", ".WriterInfo", ".ArticleWriterProfile"]) || "").match(/조회\s*([\d,]+)/);
      return m ? +m[1].replace(/,/g, "") : null;
    })(),
    ccount: (() => {
      const t = pick([".CommentBox .comment_title", ".button_comment", ".article_info"]) || "";
      const m = t.match(/댓글\s*([\d,]+)/);
      return m ? +m[1].replace(/,/g, "") : document.querySelectorAll("li.CommentItem").length || null;
    })(),
    nickname: pick([".WriterInfo .nickname", ".ArticleWriterProfile .nickname", ".nick_box .nickname", ".profile_info .nickname", ".nickname"]),
    writerHref: (() => {
      const a = document.querySelector(".WriterInfo a[href*='members'], .ArticleWriterProfile a[href*='members'], .profile_area a[href*='members'], a[href*='/members/'], a[href*='memberid=']");
      return a ? a.href : "";
    })(),
  };
}

// 댓글 목록 → 판정용 글 (작성자 본인 댓글 표시, 최대 1500자)
function formatComments(list, writerNick) {
  const lines = (list || []).map((c) => `${c.mine || (writerNick && c.nick === writerNick) ? "[작성자] " : ""}${c.nick ? `${c.nick}: ` : ""}${c.text}`);
  return lines.join("\n").slice(0, 1500);
}

// 화면이 받아 온 데이터에서 작성자 찾기 → { memberKey, nick }
function writerFromJson(datas, articleId) {
  let found = null;
  walkJson(datas, (o) => {
    if (found) return;
    const w = o.writer || (o.article && o.article.writer);
    if (w && (w.memberKey || w.id) && (!o.id || String(o.id) === String(articleId) || String(o.articleId || "") === String(articleId) || o.article)) {
      found = { memberKey: w.memberKey || w.id, nick: w.nick || w.nickname || "" };
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// 화면이 받아 온 데이터(JSON)에서 게시글 찾기
// ---------------------------------------------------------------------------

const num = (v) => (v === undefined || v === null || v === "" || isNaN(+String(v).replace(/,/g, "")) ? null : +String(v).replace(/,/g, ""));

function walkJson(node, fn, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (const x of node) walkJson(x, fn, depth + 1);
    return;
  }
  fn(node);
  for (const v of Object.values(node)) if (v && typeof v === "object") walkJson(v, fn, depth + 1);
}

function toTimestamp(v) {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    if (/^\d{10,13}$/.test(v)) return toTimestamp(+v);
    const p = parseKoreanDate(v);
    if (p && p.exact) return p.date.getTime();
    const t = Date.parse(v);
    if (!isNaN(t)) return t;
  }
  return null;
}

function articlesFromJson(datas, clubId) {
  const found = new Map();
  for (const data of datas) {
    walkJson(data, (o) => {
      const id = o.articleId ?? o.articleid ?? o.id;
      const title = o.subject ?? o.title;
      if (id === undefined || typeof title !== "string") return;
      if (!/^\d+$/.test(String(id))) return;
      const ts = toTimestamp(o.writeDateTimestamp ?? o.writeDate ?? o.addDate ?? o.createDate ?? o.writeTime);
      if (ts === null) return;
      const cafe = o.cafeId ?? o.clubId ?? o.clubid;
      if (clubId && cafe !== undefined && String(cafe) !== String(clubId)) return; // 다른 카페 글(추천 글 등)
      const key = String(id);
      if (!found.has(key)) {
        found.set(key, {
          articleId: key,
          title: htmlToText(title),
          ts,
          menu: o.menuName || "",
          menuId: o.menuId ?? o.menuid ?? null,
          views: num(o.readCount ?? o.readcount ?? o.viewCount ?? o.hitCount),
          ccount: num(o.commentCount ?? o.commentcount ?? o.replyCount ?? o.totalCommentCount),
          notice: !!(o.isNotice || o.notice || o.noticeType),
        });
      }
    });
  }
  return [...found.values()];
}

function articleBodyFromJson(datas, articleId) {
  let best = null;
  for (const data of datas) {
    walkJson(data, (o) => {
      const html = o.contentHtml ?? o.content;
      if (typeof html !== "string" || html.length < 5) return;
      const id = o.articleId ?? o.id ?? (o.article && o.article.id);
      if (id !== undefined && String(id) !== String(articleId)) return;
      if (!best || html.length > best.html.length) {
        best = {
          html,
          ts: toTimestamp(o.writeDateTimestamp ?? o.writeDate ?? (o.article && o.article.writeDate)),
          title: o.subject || "",
        };
      }
    });
    walkJson(data, (o) => {
      if (o.article && typeof o.article === "object" && String(o.article.id ?? o.article.articleId) === String(articleId)) {
        const a = o.article;
        const html = a.contentHtml || "";
        if (html && (!best || html.length > best.html.length)) {
          best = { html, ts: toTimestamp(a.writeDate ?? a.writeDateTimestamp), title: a.subject || "" };
        }
      }
    });
  }
  return best;
}

// ---------------------------------------------------------------------------
// 수집 흐름
// ---------------------------------------------------------------------------

class NaverCollector {
  constructor({ delays, log, isStopped }) {
    this.delays = delays;
    this.log = log;
    this.isStopped = isStopped;
    this.tab = new WorkerTab();
    this.viewCount = 0;
  }

  checkStop() {
    if (this.isStopped()) throw new StopError("중지됨");
  }

  async wait(range) {
    const end = Date.now() + randomBetween(range);
    while (Date.now() < end) {
      this.checkStop();
      await sleep(Math.min(500, end - Date.now()));
    }
  }

  async openChecked(url) {
    this.checkStop();
    const finalUrl = await this.tab.open(url);
    if (/nid\.naver\.com/.test(finalUrl)) throw new BlockedError("네이버 로그인이 풀렸습니다. 크롬에서 네이버에 다시 로그인해 주세요");
    const signals = await this.tab.run(pageSignalsInFrame);
    if (signals.some((s) => s.login)) throw new BlockedError("네이버 로그인이 풀렸습니다. 크롬에서 네이버에 다시 로그인해 주세요");
    if (signals.some((s) => s.blocked)) throw new BlockedError("네이버 보호조치·자동입력 방지 화면이 보여 네이버 수집을 멈췄습니다");
    return { finalUrl, memberOnly: signals.some((s) => s.memberOnly) };
  }

  async start() {
    await enableCapture();
  }

  async finish() {
    await disableCapture();
    await this.tab.close();
  }

  async clubIdFor(cafe) {
    const { clubIds = {} } = await chrome.storage.local.get("clubIds");
    if (clubIds[cafe.id]) return clubIds[cafe.id];
    await this.openChecked(`https://cafe.naver.com/${encodeURIComponent(cafe.id)}`);
    let id = null;
    for (let i = 0; i < 4 && !id; i++) {
      const tab = { url: await this.tab.url() };
      const m = (tab.url || "").match(/\/cafes\/(\d+)/) || (tab.url || "").match(/clubid=(\d+)/i);
      if (m) id = m[1];
      if (!id) {
        const datas = await this.tab.captured();
        walkJson(datas, (o) => {
          const url = o.cafeUrl ?? o.url ?? o.clubUrl;
          const cid = o.cafeId ?? o.clubId ?? o.clubid;
          if (!id && url === cafe.id && cid) id = String(cid);
        });
      }
      if (!id) {
        const ids = await this.tab.run(findClubIdInFrame, [], "MAIN");
        id = ids.find(Boolean) || null;
      }
      if (!id) await sleep(1500);
    }
    if (!id) {
      // 카페 소개 정보(카페 화면이 처음 열릴 때 쓰는 것과 같은 정보)로 확인
      const res = await this.tab.runMain(fetchJsonInPage, [[`https://apis.naver.com/cafe-web/cafe2/CafeGateInfo.json?cluburl=${encodeURIComponent(cafe.id)}`]]);
      for (const r of res || []) {
        walkJson(r.data, (o) => {
          const cid = o.cafeId ?? o.clubId ?? o.clubid;
          if (!id && cid && /^\d+$/.test(String(cid))) id = String(cid);
        });
      }
    }
    if (!id) {
      await this.diagnose(cafe, null, "카페 번호 찾기");
      throw new Error("카페 번호를 찾지 못했습니다 (카페 ID 확인 필요)");
    }
    this.log(`${cafe.name}: 카페 번호 ${id}`);
    clubIds[cafe.id] = id;
    await chrome.storage.local.set({ clubIds });
    await this.wait(this.delays.listPage);
    return id;
  }

  async forgetClubId(cafe) {
    const { clubIds = {} } = await chrome.storage.local.get("clubIds");
    delete clubIds[cafe.id];
    await chrome.storage.local.set({ clubIds });
  }

  // 실패했을 때 원인을 알 수 있도록 화면 상태를 기록에 남긴다
  async diagnose(cafe, clubId, step, logNow = true) {
    try {
      const tab = { url: await this.tab.url() };
      const frames = await this.tab.run(diagInFrame);
      const datas = await this.tab.run(() => (window.__imCaptured || []).map((x) => x.url), [], "MAIN");
      const lines = [
        `[진단] ${cafe.name} (${cafe.id}) 단계=${step} 카페번호=${clubId || "?"}`,
        `  탭 주소: ${tab.url}`,
        ...frames.map((f) => `  프레임: ${f.href} | 제목="${f.title}" | 글링크 ${f.anchors}개 ${f.sample.join(" ")} | 내용: ${f.text}`),
        `  화면이 받은 데이터: ${datas.flat().length}건 ${datas.flat().slice(0, 6).join(" , ")}`,
      ];
      if (logNow) this.log(lines.join("\n"), "err");
      return lines.join("\n");
    } catch (e) {
      return `[진단 실패] ${e.message}`;
    }
  }

  // 목록 한 페이지 읽기. 방법: fe = 새 카페 화면, api = 카페 화면 안에서 목록 데이터 요청, old = 예전 목록 화면
  async listPage(cafe, clubId, page, mode) {
    if (mode === "fe" || mode === "old") {
      const url =
        mode === "fe"
          ? `https://cafe.naver.com/f-e/cafes/${clubId}/menus/0?viewType=L&page=${page}&size=50`
          : `https://cafe.naver.com/ArticleList.nhn?search.clubid=${clubId}&search.boardtype=L&search.menuid=&search.page=${page}&userDisplay=50`;
      const { memberOnly } = await this.openChecked(url);
      for (let attempt = 0; attempt < 6; attempt++) {
        const datas = await this.tab.captured();
        const fromJson = articlesFromJson(datas, clubId).map((a) => ({ ...a, exact: true }));
        if (fromJson.length) return { items: fromJson, memberOnly };
        const dom = (await this.tab.run(listArticlesInFrame)).flat();
        if (dom.length >= 5 || (attempt >= 3 && dom.length)) {
          return {
            memberOnly,
            items: dom.map((d) => {
              const parsed = parseKoreanDate(d.dateText) || parseKoreanDate(d.rowText.replace(d.title, " "));
              return { articleId: d.articleId, title: d.title, ts: parsed ? parsed.date.getTime() : null, exact: parsed ? parsed.exact : false, notice: d.isNotice };
            }),
          };
        }
        await sleep(1500);
      }
      return { items: [], memberOnly };
    }
    // api: 지금 열려 있는 카페 화면 안에서, 카페 화면이 쓰는 목록 데이터를 한 페이지 요청
    const tab = { url: await this.tab.url() };
    if (!/^https:\/\/cafe\.naver\.com\//.test(tab.url || "")) await this.openChecked(`https://cafe.naver.com/${encodeURIComponent(cafe.id)}`);
    const res = await this.tab.runMain(fetchJsonInPage, [
      [
        `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${clubId}/menus/0/articles?page=${page}&pageSize=50&sortBy=TIME&viewType=L`,
        `https://apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json?search.clubid=${clubId}&search.queryType=lastArticle&search.menuid=0&search.page=${page}&search.perPage=50&ad=false`,
      ],
    ]);
    const items = articlesFromJson((res || []).map((r) => r.data).filter(Boolean), clubId).map((a) => ({ ...a, exact: true }));
    if (!items.length) this.log(`${cafe.name}: 목록 데이터 요청 결과 ${(res || []).map((r) => `${r.status || r.error} ${r.snippet || ""}`).join(" / ")}`, "err");
    return { items, memberOnly: false };
  }

  // 전체글보기 목록에서 기간 안의 글 목록 → [{articleId, title, ts|null, exact, url}]
  async listCafe(cafe, range) {
    const clubId = await this.clubIdFor(cafe);
    const { naverListMode } = await chrome.storage.local.get("naverListMode");
    const modes = [...new Set([naverListMode, "fe", "api", "old"].filter(Boolean))];
    let mode = null;
    let prevIds = "";
    const all = new Map();
    for (let page = 1; page <= NAVER_MAX_LIST_PAGES; page++) {
      let items = [];
      let memberOnly = false;
      const diags = []; // 모든 방법이 실패했을 때만 기록에 남긴다
      for (const m of mode ? [mode] : modes) {
        const r = await this.listPage(cafe, clubId, page, m);
        memberOnly = memberOnly || r.memberOnly;
        if (r.items.length) {
          items = r.items;
          if (!mode) {
            mode = m;
            if (m !== naverListMode) {
              await chrome.storage.local.set({ naverListMode: m });
              this.log(`네이버 목록 읽는 방법: ${m === "fe" ? "카페 화면" : m === "api" ? "카페 화면 안 목록 데이터" : "예전 목록 화면"}`);
            }
          }
          break;
        }
        if (page === 1) diags.push(await this.diagnose(cafe, clubId, `목록(${m})`, false));
        await this.wait(this.delays.listPage);
      }
      if (!items.length) {
        if (page === 1) {
          for (const d of diags) this.log(d, "err");
          if (memberOnly) throw new Error("카페 글 목록을 볼 권한이 없습니다 (가입·등급 확인)");
          await this.forgetClubId(cafe); // 카페 번호가 틀렸을 수도 있으니 다음에 다시 찾는다
          throw new Error("글 목록을 읽지 못했습니다 (진행 기록의 [진단] 내용을 보내 주세요)");
        }
        break;
      }
      const ids = items.map((it) => it.articleId).join(",");
      if (ids === prevIds) break; // 페이지를 넘겨도 같은 글 → 마지막 페이지
      prevIds = ids;
      for (const it of items) {
        const parsed = it.ts !== null ? { date: new Date(it.ts), exact: it.exact } : null;
        if (!parsed) continue; // 날짜를 모르는 글은 기간을 판단할 수 없어 뺀다
        if (!mayBeInRange(parsed, range)) continue;
        if (it.notice && !inRange(parsed.date, range)) continue;
        if (!all.has(it.articleId)) {
          all.set(it.articleId, { articleId: it.articleId, title: it.title, ts: it.ts, exact: it.exact, url: `https://cafe.naver.com/${cafe.id}/${it.articleId}`, menu: it.menu || "", menuId: it.menuId ?? null, views: it.views ?? null, ccount: it.ccount ?? null });
        }
      }
      // 목록은 최신순: 이 페이지 글 대부분이 기간보다 오래됐으면 다음 페이지는 볼 필요 없음
      if (pageIsPastRange(items, range)) break;
      await this.wait(this.delays.listPage);
    }
    return this.filterBoards(cafe, clubId, [...all.values()]);
  }

  // 카페 설정의 '게시판 지정'이 있으면 그 게시판 글만 남긴다
  //   숫자 = 게시판 번호(menus/숫자), "그룹:이름" = 카페 메뉴의 그 묶음(카테고리) 아래 게시판 전부, 그 밖 = 게시판 이름(일부만 같아도 됨)
  async filterBoards(cafe, clubId, posts) {
    const spec = parseBoardSpec(cafe.boards);
    if (!spec.ids.size && !spec.names.length && !spec.groups.length) return posts;
    const ids = new Set(spec.ids);
    for (const g of spec.groups) {
      const found = await this.groupMenuIds(cafe, clubId, g);
      if (found.length) {
        found.forEach((id) => ids.add(id));
        this.log(`${cafe.name}: 그룹 '${g}' 게시판 ${found.length}개 (${found.join(", ")})`);
      } else {
        this.log(`${cafe.name}: 그룹 '${g}' 의 게시판을 카페 메뉴에서 찾지 못했습니다 (게시판 번호를 직접 넣어 주세요)`, "err");
      }
    }
    if (posts.length && posts.every((p) => p.menuId === null && !p.menu)) {
      this.log(`${cafe.name}: 글 목록에 게시판 정보가 없어 게시판 지정 없이 전체를 봅니다`, "err");
      return posts;
    }
    if (!ids.size && !spec.names.length) {
      this.log(`${cafe.name}: 지정한 게시판을 하나도 찾지 못해 전체를 봅니다`, "err");
      return posts;
    }
    const kept = posts.filter((p) => (p.menuId !== null && ids.has(String(p.menuId))) || (p.menu && spec.names.some((n) => boardNorm(p.menu).includes(n))));
    this.log(`${cafe.name}: 게시판 지정 → 기간 내 글 ${posts.length}개 중 ${kept.length}개`);
    return kept;
  }

  // 카페 메뉴에서 그룹(카테고리) 아래 게시판 번호들 찾기 (7일간 기억)
  async groupMenuIds(cafe, clubId, group) {
    const key = `${cafe.id}|${group}`;
    const { groupMenus = {} } = await chrome.storage.local.get("groupMenus");
    const cached = groupMenus[key];
    if (cached && Date.now() - cached.at < 7 * 86400000 && cached.ids.length) return cached.ids;
    await this.openChecked(`https://cafe.naver.com/${encodeURIComponent(cafe.id)}`);
    let ids = [];
    for (let attempt = 0; attempt < 4 && !ids.length; attempt++) {
      ids = [...new Set((await this.tab.run(findMenusInGroupInFrame, [boardNorm(group)])).flat())];
      if (!ids.length) await sleep(1500);
    }
    if (ids.length) {
      groupMenus[key] = { at: Date.now(), ids };
      await chrome.storage.local.set({ groupMenus });
    }
    await this.wait(this.delays.listPage);
    return ids;
  }

  // 게시글 본문 읽기 → { title, body, ts|null }
  // 지금 열린 게시글 화면에서 본문 읽기 → info 또는 null
  async readOpenedArticle(post) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const frames = await this.tab.run(readArticleInFrame);
      const hit = frames.find((f) => f.body);
      const datas = await this.tab.captured();
      const fromJson = articleBodyFromJson(datas, post.articleId);
      if (hit || fromJson) {
        const parsed = hit && hit.date ? parseKoreanDate(hit.date) : null;
        const w = writerFromJson(datas, post.articleId);
        const named = frames.find((f) => f.nickname || f.writerHref) || {};
        const comments = (frames.find((f) => f.comments && f.comments.length) || {}).comments || [];
        const writerNick = named.nickname || (w && w.nick) || "";
        return {
          title: (hit && hit.title) || (fromJson && htmlToText(fromJson.title)) || post.title,
          body: (hit && hit.body) || (fromJson ? htmlToText(fromJson.html) : ""),
          ts: fromJson && fromJson.ts ? fromJson.ts : parsed && parsed.exact ? parsed.date.getTime() : null,
          writer: { nick: writerNick, href: named.writerHref || "", memberKey: (w && w.memberKey) || "" },
          comments: formatComments(comments, writerNick),
          views: (frames.find((f) => f.views) || {}).views ?? null,
          ccount: (frames.find((f) => f.ccount) || {}).ccount ?? null,
        };
      }
      const signals = await this.tab.run(pageSignalsInFrame);
      if (signals.some((x) => x.memberOnly) && attempt >= 1) return null; // 권한 없음 화면
      await sleep(1500);
    }
    return null;
  }

  // 게시글 본문 읽기 → { title, body, ts|null, via }
  // 카페에서 바로 열면 안 보이는 글(넥쏘 카페·영운모 등)은 네이버 검색 카페 탭에서 제목으로 찾아 그 링크로 들어가 읽는다.
  async readArticle(post, cafe = {}) {
    if (!cafe.viaSearch) {
      await this.openChecked(post.url);
      const info = await this.readOpenedArticle(post);
      if (info) return info;
    }
    const viaSearch = await this.readViaSearch(post, cafe);
    if (viaSearch) return viaSearch;
    throw new Error(cafe.viaSearch ? "네이버 검색으로도 글을 찾지 못함" : "글을 볼 수 없음 (권한 제한·삭제) → 네이버 검색으로도 찾지 못함");
  }

  // PE 여부 등 차종이 애매할 때: 작성자 정보(작성 글 목록) 화면을 열어 그 사람이 쓴 다른 글 제목을 모은다
  async authorTitles(post, cafe, writer) {
    let url = writer && /members|memberid=/i.test(writer.href || "") ? writer.href : "";
    if (!url && writer && writer.memberKey) {
      const { clubIds = {} } = await chrome.storage.local.get("clubIds");
      if (clubIds[cafe.id]) url = `https://cafe.naver.com/f-e/cafes/${clubIds[cafe.id]}/members/${encodeURIComponent(writer.memberKey)}`;
    }
    if (!url) return [];
    await this.wait(this.delays.article);
    await this.openChecked(url);
    let titles = [];
    for (let attempt = 0; attempt < 4 && !titles.length; attempt++) {
      const datas = await this.tab.captured();
      titles = articlesFromJson(datas, null).map((a) => a.title);
      if (!titles.length) titles = (await this.tab.run(listArticlesInFrame)).flat().map((d) => d.title);
      if (!titles.length) await sleep(1500);
    }
    return [...new Set(titles)].filter((t) => t && t !== post.title).slice(0, 30);
  }

  async readViaSearch(post, cafe) {
    const query = String(post.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!query) return null;
    await this.wait(this.delays.article);
    const urls = [
      `https://search.naver.com/search.naver?ssc=tab.cafe.all&query=${encodeURIComponent(query)}`,
      `https://search.naver.com/search.naver?where=article&query=${encodeURIComponent(query)}`,
    ];
    let snippet = "";
    for (const url of urls) {
      await this.openChecked(url);
      let found = null;
      for (let attempt = 0; attempt < 4 && !found; attempt++) {
        found = await this.tab.runMain(findCafeLinkInSearch, [cafe.id || "", post.articleId, query]);
        if (!found) await sleep(1200);
      }
      if (!found) continue;
      snippet = found.snippet || snippet;
      // 사람처럼 검색 결과의 링크를 눌러 들어간다 (검색을 거쳐 들어가야 보이는 글)
      const loaded = waitForTabLoad(this.tab.tabId);
      await this.tab.runMain(clickSearchResult, [found.index]);
      await loaded;
      await sleep(2500);
      const tab = { url: await this.tab.url() };
      if (/nid\.naver\.com/.test(tab.url || "")) throw new BlockedError("네이버 로그인이 풀렸습니다. 크롬에서 네이버에 다시 로그인해 주세요");
      const signals = await this.tab.run(pageSignalsInFrame);
      if (signals.some((x) => x.blocked)) throw new BlockedError("네이버 보호조치·자동입력 방지 화면이 보여 네이버 수집을 멈췄습니다");
      const info = await this.readOpenedArticle(post);
      if (info) return { ...info, via: "검색" };
      break;
    }
    // 글에는 못 들어갔지만 검색 결과 요약 글이 있으면 그거라도 판정에 쓴다
    if (snippet) return { title: post.title, body: `(검색 결과 요약) ${snippet}`, ts: null, via: "검색 요약" };
    return null;
  }

}
