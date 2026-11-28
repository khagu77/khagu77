import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRules, compileGroups, collectQueries, norm, matchRules } from "../src/keywords.js";
import { similarity } from "../src/similarity.js";
import { buildContext, classify } from "../src/classify.js";
import { DEFAULT_SETTINGS } from "../src/defaults.js";
import { rowDate, parseBoardList, boardAdapter } from "../src/collectors/community.js";
import { parseRss } from "../src/collectors/youtube.js";
import { normalizeItem, pressName } from "../src/collectors/naver.js";
import { formatAlert } from "../src/alerts.js";

test("키워드 문법: + , OR / * AND / #숫자 무시", () => {
  const r = parseRules("그랜저#10+팰리세이드*끼임, 차량 화재");
  assert.deepEqual(r.map((x) => x.raw), ["그랜저", "팰리세이드*끼임", "차량 화재"]);
  assert.deepEqual(matchRules(norm("팰리세이드 2열 시트 끼임 사고"), r), ["팰리세이드*끼임"]);
  assert.deepEqual(matchRules(norm("차량화재 발생"), r), ["차량 화재"]);
});

test("유사도: 언론 머리말 차이는 80% 이상", () => {
  assert.ok(similarity("[단독] 현대차 팰리세이드, 2열 전동시트 끼임 사고 리콜", "현대차 팰리세이드 2열 전동시트 끼임 사고 리콜…") >= 0.8);
  assert.ok(similarity("현대차 3분기 실적 발표", "기아 신형 스포티지 출시") < 0.3);
});

const ctx = buildContext(DEFAULT_SETTINGS);

test("분류: 현대차 + 품질 키워드 → 이슈 · 언론 카테고리 · 알림", () => {
  const c = classify({ channel: "news", title: "현대차 아이오닉5 ICCU 결함 무상수리", desc: "" }, ctx);
  assert.ok(c.isIssue && c.alert);
  assert.ok(c.cats.includes("all") && c.cats.includes("news") && !c.cats.includes("garbage"));
  assert.equal(c.sentiment, "neg");
});

test("분류: 현대차 관련이지만 이슈어 없음 → 가비지", () => {
  const c = classify({ channel: "blog", title: "그랜저 시승기 주말 나들이", desc: "" }, ctx);
  assert.ok(!c.isIssue);
  assert.deepEqual(c.cats.sort(), ["all", "garbage"]);
});

test("분류: 품질어만 있고 현대차 단어 없으면 이슈 아님 (requireTarget)", () => {
  const c = classify({ channel: "cafe", title: "냉장고 결함 리콜 받았어요", desc: "", sourceId: "x" }, ctx);
  assert.ok(!c.isIssue);
});

test("분류: 관심 동호회 + 이슈 → 관심 동호회 카테고리, 검색 결과 아닌 목록은 관련어 필요", () => {
  const c = classify({ channel: "cafe", title: "팰리세이드 전동시트 끼임 무섭네요", sourceId: "gamewinds" }, ctx);
  assert.ok(c.fav && c.cats.includes("cafe_fav"));
  assert.equal(classify({ channel: "clien", title: "오늘 점심 메뉴", requireMatch: true }, ctx), null);
});

test("분류: 인싸케이 영상은 키워드 없어도 저장 · 관심 유튜브", () => {
  const c = classify({ channel: "youtube", title: "오늘의 브이로그", sourceId: "UCjYS1a6ENGSfUfxEJpVCOtQ", requireMatch: true }, ctx);
  assert.ok(c && c.must && c.cats.includes("youtube_fav") && c.cats.includes("youtube"));
});

test("분류: 제외어", () => {
  assert.equal(classify({ channel: "cafe", title: "팰리세이드 휠 팝니다", sourceId: "x" }, ctx), null);
});

test("분류: 단순비난", () => {
  assert.equal(classify({ channel: "bobae", title: "역시 흉기차 ㅉㅉ", desc: "" }, ctx).sentiment, "abuse");
});

test("수집 검색어 목록", () => {
  const q = collectQueries(compileGroups(DEFAULT_SETTINGS));
  assert.ok(q.includes("현대차") && q.includes("팰리세이드") && q.includes("차량 화재"));
  assert.ok(!q.includes("K8"));
});

test("게시판 날짜 읽기", () => {
  const now = new Date("2026-11-28T00:00:00Z"); // KST 09:00
  assert.equal(rowDate("홍길동 07:46 조회 12", now).toISOString(), "2026-11-27T22:46:00.000Z");
  assert.equal(rowDate("2026-11-27 13:05:11", now).toISOString(), "2026-11-27T04:05:00.000Z");
  assert.equal(rowDate("26/11/25", now).toISOString(), "2026-11-24T15:00:00.000Z");
  assert.equal(rowDate("11/20", now).toISOString(), "2026-11-19T15:00:00.000Z");
});

test("게시판 목록 읽기 (클리앙 모양)", () => {
  const ad = boardAdapter("https://www.clien.net/service/board/cm_car");
  const html = `<div class="list_item symph_row"><a class="list_subject" href="/service/board/cm_car/1900001?od=T31"><span>그랜저 엔진오일 누유</span></a><span class="timestamp">2026-11-28 07:10:00</span></div>
  <div class="list_item symph_row"><a href="/service/board/cm_car/1900002"><span>테슬라 후기</span></a> 06:55</div>`;
  const rows = parseBoardList(html, ad);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "그랜저 엔진오일 누유");
  assert.equal(ad.articleUrl(rows[0].id), "https://www.clien.net/service/board/cm_car/1900001");
});

test("게시판 목록 읽기 (보배드림 모양)", () => {
  const ad = boardAdapter("https://www.bobaedream.co.kr/list?code=national");
  const html = `<table><tr><td class="pl14"><a class="bsubject" href="/view?code=national&amp;No=123456&amp;bm=1" title="싼타페 시동꺼짐">싼타페 시동꺼짐</a></td><td class="date">07:31</td></tr></table>`;
  const rows = parseBoardList(html, ad);
  assert.equal(rows[0].id, "123456");
});

test("유튜브 RSS 읽기", () => {
  const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><author><name>인싸 케이</name></author>
  <entry><yt:videoId>abc123</yt:videoId><yt:channelId>UCx</yt:channelId><title>팰리세이드 결함 &amp; 리콜</title><published>2026-11-27T10:00:00+00:00</published><media:group><media:description>설명</media:description></media:group></entry></feed>`;
  const [v] = parseRss(xml, "UCx");
  assert.equal(v.url, "https://www.youtube.com/watch?v=abc123");
  assert.equal(v.title, "팰리세이드 결함 & 리콜");
  assert.equal(v.source, "인싸 케이");
});

test("네이버 결과 정리", () => {
  const n = normalizeItem("news", { title: "<b>현대차</b> 리콜", originallink: "https://www.yna.co.kr/view/1", link: "https://n.news.naver.com/mnews/article/001/1", description: "x", pubDate: "Sat, 28 Nov 2026 07:46:00 +0900" });
  assert.equal(n.title, "현대차 리콜");
  assert.equal(n.source, "연합뉴스");
  assert.ok(n.url.includes("n.news.naver.com"));
  const c = normalizeItem("cafe", { title: "t", link: "http://cafe.naver.com/gamewinds/123", cafename: "LX3 클럽", cafeurl: "https://cafe.naver.com/gamewinds" });
  assert.equal(c.sourceId, "gamewinds");
  assert.equal(pressName("https://news.hankyung.com/article/1"), "한국경제");
});

test("카카오 알림 문구: 채널 머리말 + 제목 + URL, 200자 이내", () => {
  const t = formatAlert({ channel: "bobae", title: "가".repeat(300), url: "https://www.bobaedream.co.kr/view?code=national&No=1", kw: ["급발진"], source: "보배드림" });
  assert.ok(t.startsWith("🚗 [보배드림]"));
  assert.ok(t.endsWith("https://www.bobaedream.co.kr/view?code=national&No=1"));
  assert.ok(t.length <= 200);
});

test("화면용 공용 모듈이 서버와 같음 (다르면 npm run sync-shared)", async () => {
  const fs = await import("node:fs");
  for (const f of ["keywords", "similarity", "sentiment", "classify", "defaults", "site"]) {
    assert.equal(fs.readFileSync(new URL(`../../public/js/shared/${f}.js`, import.meta.url), "utf8"), fs.readFileSync(new URL(`../src/${f}.js`, import.meta.url), "utf8"), f);
  }
});

import { parseSearchPage, linkKey, relTime } from "../src/collectors/naverweb.js";

test("네이버 검색 화면: 뉴스 (언론사 링크 + 네이버뉴스 링크를 한 글로)", () => {
  const html = `<ul class="list_news">
  <li class="bx"><div class="news_wrap"><div class="info_group"><a class="info press" href="https://www.hankyung.com/">한국경제</a><span class="info">3시간 전</span><a class="info" href="https://n.news.naver.com/mnews/article/015/0005000001?sid=101">네이버뉴스</a></div>
    <a class="news_tit" href="https://www.hankyung.com/article/2026112800001" title="현대차 아이오닉5 ICCU 결함 무상수리">현대차 아이오닉5 ICCU 결함 무상수리</a>
    <div class="news_dsc"><a class="api_txt_lines dsc_txt_wrap" href="https://www.hankyung.com/article/2026112800001">현대자동차가 아이오닉5 통합충전제어장치(ICCU) 결함으로 무상수리를 실시한다. 대상은 12만대다.</a></div></div></li>
  <li class="bx"><div class="news_wrap"><div class="info_group"><a class="info press" href="https://www.yna.co.kr/">연합뉴스</a><span class="info">15분 전</span></div>
    <a class="news_tit" href="https://www.yna.co.kr/view/AKR2026112800001">팰리세이드 2열 전동시트 끼임 사고</a></div></li></ul>`;
  const now = new Date("2026-11-28T03:00:00Z");
  const rows = parseSearchPage(html, "news");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "현대차 아이오닉5 ICCU 결함 무상수리");
  assert.equal(rows[0].url, "https://n.news.naver.com/mnews/article/015/0005000001");
  assert.equal(rows[0].source, "한국경제");
  assert.ok(rows[0].snippet.includes("12만대"));
  assert.equal(rows[1].url, "https://www.yna.co.kr/view/AKR2026112800001");
  assert.equal(rows[1].source, "연합뉴스");
  assert.ok(rows[1].date && rows[1].date.getTime() <= Date.now());
  void now;
});

test("네이버 검색 화면: 카페 (카페 이름·주소 ID·제목)", () => {
  const html = `<div class="view_wrap"><div class="user_box"><a class="name" href="https://cafe.naver.com/gamewinds">LX3 클럽</a><span class="sub">2026.11.27.</span></div>
    <div class="title_area"><a class="title_link" href="https://cafe.naver.com/gamewinds/4299497?art=abc">팰리세이드 3열 폴딩 손 끼임 조심하세요</a></div>
    <div class="dsc_area"><a class="dsc_link" href="https://cafe.naver.com/gamewinds/4299497?art=abc">아이가 3열 폴딩할 때 손이 끼일 뻔했습니다 정말 위험하네요</a></div></div>
  <div class="view_wrap"><div class="user_box"><a class="name" href="https://cafe.naver.com/tobloomer">팰리세이드 오너스 클럽</a><span class="sub">5시간 전</span></div>
    <div class="title_area"><a class="title_link" href="https://cafe.naver.com/tobloomer/133964">전동시트 업데이트 후기</a></div></div>`;
  const rows = parseSearchPage(html, "cafe");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://cafe.naver.com/gamewinds/4299497");
  assert.equal(rows[0].club, "gamewinds");
  assert.equal(rows[0].source, "LX3 클럽");
  assert.equal(rows[0].title, "팰리세이드 3열 폴딩 손 끼임 조심하세요");
  assert.equal(rows[0].date.toISOString(), "2026-11-26T15:00:00.000Z");
  assert.equal(rows[1].source, "팰리세이드 오너스 클럽");
});

test("네이버 검색 화면: 블로그 주소 정리·상대 시각", () => {
  assert.equal(linkKey("blog", "https://m.blog.naver.com/PostView.naver?blogId=car_life&logNo=223456789012").url, "https://blog.naver.com/car_life/223456789012");
  assert.equal(linkKey("blog", "https://blog.naver.com/car_life"), null);
  const now = new Date("2026-11-28T03:00:00Z");
  assert.equal(relTime("홍길동 · 2시간 전", now).toISOString(), "2026-11-28T01:00:00.000Z");
  assert.equal(relTime("어제", now).toISOString(), "2026-11-27T03:00:00.000Z");
});

import { siteOf } from "../src/store.js";
test("언론사 로고용 사이트 주소", () => {
  assert.equal(siteOf({ channel: "news", url: "https://n.news.naver.com/mnews/article/015/0005000001", extUrl: "https://www.hankyung.com/article/1" }), "hankyung.com");
  assert.equal(siteOf({ channel: "news", url: "https://n.news.naver.com/mnews/article/001/0015000001" }), "yna.co.kr");
  assert.equal(siteOf({ channel: "news", url: "https://www.motorgraph.com/news/articleView.html?idxno=1" }), "motorgraph.com");
  assert.equal(siteOf({ channel: "cafe", url: "https://cafe.naver.com/a/1" }), null);
});

test("알림: 동호회·유튜브는 관심 목록 글만", async () => {
  const { sendAlerts } = await import("../src/alerts.js");
  // 카카오 키가 없으면 후보만 고르고 끝나므로, 후보 필터만 따로 확인
  const ctx2 = { settings: { ...DEFAULT_SETTINGS } };
  const mk = (channel, fav) => ({ id: channel + fav, channel, fav, alert: true, isIssue: true, dupOf: null, title: `${channel}${fav}`, time: { toMillis: () => Date.now() } });
  const log = [];
  await sendAlerts([mk("cafe", false), mk("youtube", false)], ctx2, {}, log);
  assert.deepEqual(log, []); // 관심 아닌 동호회·유튜브는 후보에서 빠져 아무 것도 안 함
  await sendAlerts([mk("cafe", true)], ctx2, {}, log);
  assert.deepEqual(log, ["알림: 카카오 키 없음"]);
});

import { isBlockedPage } from "../src/collectors/naverweb.js";
test("네이버 차단 판단: 스크립트 속 captcha 글자는 무시", () => {
  assert.equal(isBlockedPage('<html><script>var captcha="x"</script><div>현대차 리콜</div></html>', 200), false);
  assert.equal(isBlockedPage("<html><div>자동입력 방지 문자를 입력해 주세요</div></html>", 200), true);
  assert.equal(isBlockedPage("", 403), true);
});

test("네이버 검색 화면: 카페 이름이 링크가 아닌 글자일 때도 읽음", () => {
  const html = `<div class="view_wrap"><div class="user_info"><span class="cafe_name">LX3 클럽</span><span class="sub">3시간 전</span></div>
    <a class="title_link" href="https://cafe.naver.com/gamewinds/111">팰리세이드 시트 끼임</a></div>
    <div class="view_wrap"><div class="user_info"><span class="cafe_name">그랜저 오너스</span></div>
    <a class="title_link" href="https://cafe.naver.com/allfm03/222">그랜저 누수</a></div>`;
  const rows = parseSearchPage(html, "cafe");
  assert.equal(rows[0].source, "LX3 클럽");
  assert.equal(rows[1].source, "그랜저 오너스");
});

import { normalizeExternal } from "../src/external.js";
test("크롬 수집 도우미가 보낸 글 정리", () => {
  const out = normalizeExternal({ items: [
    { channel: "ppomppu", url: "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=1", title: " 그랜저  누수 ", postedAt: "2026-11-28T01:00:00Z", source: "뽐뿌 자동차포럼" },
    { channel: "evil", url: "https://x.com", title: "x" },
    { channel: "ppomppu", url: "javascript:alert(1)", title: "x" },
  ] });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "그랜저 누수");
  assert.ok(out[0].requireMatch && out[0].postedAt instanceof Date);
});

test("수집 도우미: 뽐뿌 목록 읽기 (EUC-KR 해독 뒤 HTML)", async () => {
  const { createRequire } = await import("node:module");
  const P = createRequire(import.meta.url)("../../extension/parse.js");
  const html = `<table><tr class="list1"><td>1</td><td><a href="view.php?id=car&amp;page=1&amp;no=777001"><font class="list_title">싼타페 하이브리드 누수 &amp; 리콜</font></a> <span class="list_comment2">[3]</span></td><td><nobr class="eng list_vspace">07:46:12</nobr></td></tr>
  <tr class="list0"><td><a href="view.php?id=car&no=776990">그랜저 소음</a></td><td><nobr>26/11/27</nobr></td></tr>
  <tr><td><a href="view.php?id=freeboard&no=1">다른 게시판</a></td></tr></table>`;
  const now = new Date("2026-11-28T00:00:00Z");
  const rows = P.parsePpomppuList(html, "car", now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "싼타페 하이브리드 누수 & 리콜");
  assert.equal(rows[0].date.toISOString(), "2026-11-27T22:46:00.000Z");
  assert.equal(rows[1].date.toISOString(), "2026-11-26T15:00:00.000Z");
});

test("관심 동호회: 카페 주소 ID 를 몰라도 카페 이름으로 확인", () => {
  const item = { channel: "cafe", title: "팰리세이드 전동시트 끼임", source: "LX3 클럽", sourceId: "#12345" };
  const c = classify(item, ctx);
  assert.ok(c.fav && c.cats.includes("cafe_fav"));
  assert.equal(item.sourceId, "gamewinds");
});

test("수집 도우미 네이버 검색 결과: 검색 결과는 관련어 없어도 저장 대상, 언론사 원문 주소 유지", () => {
  const [n] = normalizeExternal({ items: [{ channel: "news", fromSearch: true, url: "https://n.news.naver.com/mnews/article/015/0001", extUrl: "https://www.hankyung.com/a/1", title: "기사", query: "현대차" }] });
  assert.equal(n.requireMatch, false);
  assert.equal(n.extUrl, "https://www.hankyung.com/a/1");
  assert.equal(n.via, "ext:naver:news");
  const [p] = normalizeExternal({ items: [{ channel: "ppomppu", url: "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=1", title: "글" }] });
  assert.equal(p.requireMatch, true);
});

import { parseGoogleNewsRss, parseBoardRss } from "../src/collectors/official.js";
test("Google 뉴스 RSS: 제목 끝 언론사 이름 떼기·언론사 주소", () => {
  const xml = `<rss><channel><item><title>현대차 아이오닉5 ICCU 무상수리 - 한국경제</title><link>https://news.google.com/rss/articles/CBMi123?oc=5</link><pubDate>Fri, 28 Nov 2026 01:00:00 GMT</pubDate><source url="https://www.hankyung.com">한국경제</source></item></channel></rss>`;
  const [it] = parseGoogleNewsRss(xml);
  assert.equal(it.title, "현대차 아이오닉5 ICCU 무상수리");
  assert.equal(it.source, "한국경제");
  assert.equal(it.sourceUrl, "https://www.hankyung.com");
  assert.equal(it.postedAt.toISOString(), "2026-11-28T01:00:00.000Z");
});
test("뽐뿌 RSS 읽기", () => {
  const xml = `<rss><channel><item><title><![CDATA[그랜저 누수 문의]]></title><link>http://www.ppomppu.co.kr/zboard/view.php?id=car&amp;no=12345</link><pubDate>Fri, 28 Nov 2026 10:00:00 +0900</pubDate></item></channel></rss>`;
  const [it] = parseBoardRss(xml);
  assert.equal(it.title, "그랜저 누수 문의");
  assert.equal(it.url, "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=12345");
});

test("알림: 가입인사·등업 신청 글은 보내지 않음", async () => {
  const { sendAlerts } = await import("../src/alerts.js");
  const ctx2 = { settings: { ...DEFAULT_SETTINGS } };
  const mk = (title) => ({ id: title, channel: "cafe", fav: true, alert: true, isIssue: true, dupOf: null, title, time: { toMillis: () => Date.now() } });
  const log = [];
  await sendAlerts([mk("[가입인사] 팰리세이드 출고했습니다"), mk("등업 신청합니다 LX3 리콜")], ctx2, {}, log);
  assert.deepEqual(log, []); // 후보가 없어 아무 것도 안 함
  await sendAlerts([mk("팰리세이드 시트 끼임 사고")], ctx2, {}, log);
  assert.deepEqual(log, ["알림: 카카오 키 없음"]);
});

test("알림: 가비지(이슈 아님) 글은 보내지 않음", async () => {
  const { sendAlerts } = await import("../src/alerts.js");
  const log = [];
  await sendAlerts([{ id: "g", channel: "news", alert: true, isIssue: false, dupOf: null, title: "현대차 리콜", time: { toMillis: () => Date.now() } }], { settings: { ...DEFAULT_SETTINGS } }, {}, log);
  assert.deepEqual(log, []);
});

test("알림: 3시간 넘은 글(처음 수집 때 들어온 하루치)은 보내지 않음", async () => {
  const { sendAlerts } = await import("../src/alerts.js");
  const ctx2 = { settings: { ...DEFAULT_SETTINGS } };
  const log = [];
  await sendAlerts([{ id: "old", channel: "news", fav: false, alert: true, dupOf: null, title: "현대차 리콜", time: { toMillis: () => Date.now() - 5 * 3600e3 } }], ctx2, {}, log);
  assert.deepEqual(log, []);
});

import { parseHashtags } from "../src/collectors/instagram.js";
test("인스타그램 해시태그 목록 정리 (최대 30개)", () => {
  assert.deepEqual(parseHashtags("#현대차, 팰리세이드 + #GV80\n현대차"), ["현대차", "팰리세이드", "gv80"]);
  assert.equal(parseHashtags(Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ")).length, 30);
  const c = classify({ channel: "instagram", title: "팰리세이드 출고 후기", desc: "" }, buildContext(DEFAULT_SETTINGS));
  assert.ok(c.cats.includes("all"));
});

import { pickForFeed } from "../src/store.js";
test("실시간 피드: 많이 들어온 채널이 다른 채널을 밀어내지 않음", () => {
  const t = (ms) => ({ toMillis: () => ms });
  const created = [...Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, channel: "blog", time: t(1000 + i) })), { id: "ig1", channel: "instagram", time: t(1) }, { id: "n1", channel: "news", time: t(2) }];
  const ids = pickForFeed(created, 40).map((p) => p.id);
  assert.equal(ids.length, 40);
  assert.ok(ids.includes("ig1") && ids.includes("n1"));
});

test("게시판 날짜: 조회수 '1.2k' 같은 숫자를 날짜로 읽지 않음", () => {
  const now = new Date("2026-11-28T00:00:00Z");
  assert.equal(rowDate("그랜저 누수 조회 1.2 k 추천 3", now), null);
});

test("유튜브 RSS: 숏츠 링크 구분", () => {
  const xml = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><author><name>c</name></author>
  <entry><yt:videoId>s1</yt:videoId><link rel="alternate" href="https://www.youtube.com/shorts/s1"/><title>a</title><published>2026-11-27T10:00:00+00:00</published></entry>
  <entry><yt:videoId>v1</yt:videoId><link rel="alternate" href="https://www.youtube.com/watch?v=v1"/><title>b</title><published>2026-11-27T10:00:00+00:00</published></entry></feed>`;
  const [a, b] = parseRss(xml, "c");
  assert.equal(a.short, true);
  assert.equal(b.short, false);
});

test("관심 유튜브 채널·관심 동호회 이름이 나오는 게시판 글도 수집", () => {
  const s = { ...DEFAULT_SETTINGS, favYoutube: [{ id: "UC1", name: "모트라인" }, { id: "UC2", name: "오토기어" }], favCafes: [{ id: "abc", name: "LX3 클럽" }] };
  const ctx = buildContext(s);
  const r = classify({ channel: "ppomppu", title: "모트라인이랑 오토기어 영상들 제미나이한테 분석하라 했더니", requireMatch: true }, ctx);
  assert.ok(r, "저장돼야 함");
  assert.ok(r.targets.includes("관심: 모트라인"));
  assert.equal(classify({ channel: "ppomppu", title: "오늘 점심 뭐 먹지", requireMatch: true }, ctx), null);
});
