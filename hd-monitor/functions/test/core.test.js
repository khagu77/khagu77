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
  for (const f of ["keywords", "similarity", "sentiment", "classify", "defaults"]) {
    assert.equal(fs.readFileSync(new URL(`../../public/js/shared/${f}.js`, import.meta.url), "utf8"), fs.readFileSync(new URL(`../src/${f}.js`, import.meta.url), "utf8"), f);
  }
});
