"""GV90 온라인 게시물 일일 수집 확장 통합 테스트.

실제 사이트 대신 가짜 응답(route)으로 언론(네이버 뉴스)·유튜브(채널 RSS·영상 화면)·자동차 커뮤니티(클리앙)를 수집하고
결과 표(👁 조회 💬 댓글 뱃지 · 무료 성향 분석) → 휴일 수집분 합본 → 엑셀(일일동향 RAW 양식 + 성향) → 데일리 DB · 대시보드를 확인한다.
동호회(네이버 카페)는 실제 로그인이 필요해 이 테스트에서는 끈다.
확장 로딩에는 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import base64
import json
import os
import re
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

EXT_DIR = Path(__file__).resolve().parent.parent / "gv90-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

YT_CHANNEL = "UCabcdefghijklmnopqrstuv"

NEWS_SEARCH = (
    "<html><body><div class='list'>"
    '<div class="news_item"><div class="profile"><a class="press" href="https://www.yna.co.kr/">연합뉴스</a>'
    '<span class="info">2026.08.05.</span><a href="https://n.news.naver.com/mnews/article/001/0000000001">네이버뉴스</a></div>'
    '<a class="news_tit" href="https://www.yna.co.kr/view/AKR0001"><span class="headline">제네시스 GV90 출시, 실내 고급감 호평</span></a>'
    '<a class="news_dsc" href="https://www.yna.co.kr/view/AKR0001">제네시스가 플래그십 SUV GV90 을 공개했다. 시승 참가자들은 만족한다는 반응이다...</a></div>'
    '<div class="news_item"><a class="news_tit" href="https://n.news.naver.com/mnews/article/002/0000000002">GV90 사전계약 일정 안내 기사</a><span class="info">2026.08.05.</span></div>'
    "</div></body></html>"
)


def news_article(oid, aid):
    title = "제네시스 GV90 출시, 실내 고급감 호평" if aid.endswith("1") else "GV90 사전계약 일정 안내 기사"
    body = "GV90 실내가 고급스럽고 만족스럽다는 평가가 많다." if aid.endswith("1") else "제네시스는 GV90 사전계약 일정을 공개했다."
    return (
        f'<html><body><div class="media_end_head_top_logo"><img title="{"연합뉴스" if aid.endswith("1") else "한국경제"}"></div>'
        f'<h2 id="title_area">{title}</h2>'
        f'<span data-date-time="2026-08-05 15:00:00">2026.08.05</span>'
        f'<article id="dic_area">{body}</article></body></html>'
    )


NEWS_COMMENTS = ["GV90 실내 정말 고급스럽네요 만족", "가격이 너무 비싸요 실망", "출시 일정 궁금합니다"]


def cbox(url):
    # 네이버 '더 보기' 방식: 첫 묶음 뒤에 morePage.next 를 주고, moreParam.next 로 다음 묶음 (쪽 번호만 바꾸면 같은 첫 묶음)
    q = parse_qs(urlparse(url).query)
    texts = NEWS_COMMENTS if q["objectId"][0].endswith("0000000001") and not q.get("parentCommentNo") else []
    nums = list(enumerate(texts))
    more = None
    if texts:
        if q.get("moreParam.next") == ["N2"]:
            nums = nums[2:]
        else:
            nums, more = nums[:2], {"next": "N2"}
    data = {"success": True, "result": {"count": {"comment": 31 if texts else 0}, "pageModel": {"totalPages": 1}, "morePage": more or {}, "commentList": [
        {"commentNo": i + 1, "contents": t, "regTime": "2026-08-05T16:0%d:00+0900" % i, "userName": "u", "replyCount": 0} for i, t in nums]}}
    return "cb(" + json.dumps(data, ensure_ascii=False) + ");"


YT_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry><yt:videoId>gv90video01</yt:videoId><title>GV90 시승기 승차감 최고</title><published>2026-08-05T06:30:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>제네시스 GV90 리뷰</media:description></media:group></entry>
 <entry><yt:videoId>gv90short001</yt:videoId><title>GV90 쇼츠 한 컷</title><link rel="alternate" href="https://www.youtube.com/shorts/gv90short001"/><published>2026-08-05T06:40:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>GV90</media:description></media:group></entry>
 <entry><yt:videoId>gv90short002</yt:videoId><title>GV90 쇼츠 두 컷</title><link rel="alternate" href="https://www.youtube.com/watch?v=gv90short002"/><published>2026-08-05T06:45:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>GV90</media:description></media:group></entry>
 <entry><yt:videoId>otherotherx</yt:videoId><title>아반떼 세차 영상</title><published>2026-08-05T05:00:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>-</media:description></media:group></entry>
</feed>"""
YT_WATCH = (
    '<html><script>ytcfg.set({"INNERTUBE_API_KEY":"KEY","INNERTUBE_CLIENT_VERSION":"2.0"});</script>'
    '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"GV90 시승기 승차감 최고","author":"자동차채널","shortDescription":"제네시스 GV90 리뷰","viewCount":"15234"},'
    '"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-08-05T15:30:00+09:00"}}};</script>'
    "<script>var ytInitialData = "
    + json.dumps({"engagementPanels": [{"commentsEntryPointHeaderRenderer": {"commentCount": {"simpleText": "128"}}}],
                  "contents": {"itemSectionRenderer": {"sectionIdentifier": "comment-item-section", "contents": [
                      {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "T1"}}}}]}}})
    + ";</script></html>"
)

CLIEN_LIST = (
    "<html><body>"
    '<div class="list_item"><a href="/service/board/cm_car/501">GV90 실물 보니 실망입니다 비싸요</a><span class="timestamp">2026-08-05 10:00:00</span></div>'
    '<div class="list_item"><a href="/service/board/cm_car/502">타이어 교체 후기</a><span class="timestamp">2026-08-05 09:00:00</span></div>'
    '<div class="list_item"><a href="/service/board/cm_car/400">GV90 옛날 글</a><span class="timestamp">2026-07-20 06:00:00</span></div>'
    "</body></html>"
)
CLIEN_VIEW = (
    '<html><body><h3 class="post_subject">GV90 실물 보니 실망입니다 비싸요</h3>'
    '<div class="post_author"><span class="view_count date">2026-08-05 10:00:00</span> <span class="view_count"><i class="fa fa-eye"></i><strong>1,234</strong></span></div>'
    '<div class="post_article">가격이 너무 비싸서 실망입니다. 옵션도 아쉽네요.</div>'
    '<div class="comment_head">댓글 2</div>'
    '<div class="comment_row"><div class="comment_view">그래도 실내는 좋던데요</div><span class="timestamp">2026-08-05 10:10:00</span></div>'
    '<div class="comment_row"><div class="comment_view">저도 비싸서 포기</div><span class="timestamp">2026-08-05 10:20:00</span></div>'
    "</body></html>"
)


def yt_comment(cid, text):
    return {"payload": {"commentEntityPayload": {"properties": {"commentId": cid, "content": {"content": text}, "publishedTime": "1시간 전"}, "author": {"displayName": "a"}}}}


YT_NEXT = {"frameworkUpdates": {"entityBatchUpdate": {"mutations": [yt_comment("Y1", "GV90 디자인 멋지다 최고"), yt_comment("Y2", "흉물 같음 현기차")]}},
           "onResponseReceivedEndpoints": [{"reloadContinuationItemsCommand": {"continuationItems": [{"commentsHeaderRenderer": {"countText": {"runs": [{"text": "댓글 "}, {"text": "1,234"}, {"text": "개"}]}}}]}}]}

# 뽐뿌 댓글 목록(JSON, 전체읽기): 2쪽 · 답글은 댓글 안 배열 · 차단·지운 댓글은 빼야 함 (이슈 모니터링 보고서 테스트와 같은 실제 구조)
PPOM_JSON = {
    "1": {"total_page": "2", "total_comment": "6", "c_page": 1, "comments": [
        {"no": 1, "depth": 0, "name": "<b>SirO_u</b>", "memo": "<p>첫 댓글 GV90 가격 비싸요</p><p>정말로&nbsp;</p>", "meta": {"time_detail": "2026-08-05 17:00:01"},
         "block_status": {"is_blocked": False, "is_spam": False},
         "sub_cmt": [{"no": 2, "depth": 1, "name": "<b>아셋팜</b>", "memo": "<p>답글 동의합니다</p>", "meta": {"time_detail": "2026-08-05 17:05:06"}, "block_status": {"is_blocked": False},
                      "sub_cmt": [{"no": 5, "depth": 2, "name": "<b>SirO_u</b>", "memo": "<div>답글의 답글</div>", "meta": {"time_detail": "2026-08-05 17:26:29"}, "block_status": {"is_blocked": False}}]}]},
        {"no": 3, "depth": 0, "memo": "차단된 댓글입니다", "meta": {"time_detail": "2026-08-05 17:10:00"}, "block_status": {"is_blocked": True, "is_spam": False}},
        {"no": 6, "depth": 0, "name": "<b>지운 분</b>", "memo": "", "meta": {"time_detail": "2026-08-05 17:11:00"}, "block_status": {"is_blocked": False}},
        {"no": 4, "depth": 0, "memo": "<p>옵션 구성 아쉽네요</p>", "meta": {"time_detail": "2026-08-05 17:20:00"}, "block_status": {"is_blocked": False}},
    ]},
    "2": {"total_page": "2", "total_comment": "6", "c_page": 2, "comments": [{"no": 7, "comment": "둘째 쪽 댓글 기본 모델 괜찮음", "date": "08-05 18:30", "re_level": "0"}]},
}
PPOM_VIEW = ('<html><head><meta charset="euc-kr"></head><body><div class="board-contents">GV90 가격 이야기</div><span>조회 3,210</span><span>댓글 [5]</span>'
             '<div class="comment_wrapper"><div class="mid-text-area">첫 댓글 GV90 가격 비싸요 정말로</div></div>'
             '<a href="javascript:BbsCommentLoadMore.loadNext();">다음 코멘트 더 보기</a></body></html>')


# 보배드림 글 화면: 작성자 정보 칸에 '작성글: 게시글 16,067 | 댓글 55,929'(작성자가 쓴 총 댓글 수) · 제목 옆 [11] = 이 글의 댓글 수
# (온라인 오전 일일동향에서 발견된 오류: 작성자 총 댓글 수를 이 글의 댓글 수로 읽음)
def bobae_view(n=11):
    items = "".join(f'<li><dl><dt><span class="date">2026.08.05 11:{i:02d}</span></dt><dd id="small_cmt_{i}">보배 댓글 {i + 1}번 GV90 좋네요</dd></dl></li>' for i in range(n))
    return ('<html><body><div class="writerProfile"><dl><dt>CN8 계기판 없는 차는 향후 중고로 판매 시 불리할 듯 [11]</dt>'
            '<dd><span class="countGroup">2026.08.05 10:00 | 조회 1,775 | 추천 3</span></dd>'
            '<dd>작성글: 게시글 16,067 | 댓글 55,929</dd></dl></div>'
            '<div class="bodyCont">본문입니다. 계기판 이야기</div>'
            f'<div class="commentlistbox"><ul>{items}</ul></div></body></html>')


def parse_cnt(t):
    return int(re.sub(r"[^0-9]", "", str(t or "")) or 0)


def wait_js(page, expr, timeout=60000):
    for _ in range(int(timeout / 250)):
        if page.evaluate(expr):
            return
        page.wait_for_timeout(250)
    raise AssertionError(f"기다렸지만 안 됨: {expr}")


@pytest.fixture()
def ext(tmp_path: Path):
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}"],
            accept_downloads=True,
        )
        requests = []

        def naver(route):
            url = route.request.url
            requests.append(url)
            if "search.naver.com" in url:
                start = parse_qs(urlparse(url).query).get("start", ["1"])[0]
                route.fulfill(status=200, content_type="text/html; charset=utf-8", body=NEWS_SEARCH if start == "1" else "<html></html>")
            elif "apis.naver.com/commentBox" in url:
                route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=cbox(url))
            elif "n.news.naver.com" in url:
                m = re.search(r"article/(\d+)/(\d+)", url)
                route.fulfill(status=200, content_type="text/html; charset=utf-8", body=news_article(m.group(1), m.group(2)))
            else:
                route.fulfill(status=200, content_type="text/html", body="<html></html>")

        def youtube(route):
            url = route.request.url
            if "/shorts/" in url:  # 쇼츠면 그대로(200), 일반 영상이면 watch 로 넘김
                if "gv90short" in url:
                    route.fulfill(status=200, content_type="text/html", body="<html>shorts</html>")
                else:
                    route.fulfill(status=303, headers={"location": url.replace("/shorts/", "/watch?v=")})
                return
            if "/feeds/videos.xml" in url:
                route.fulfill(status=200, content_type="application/xml", body=YT_FEED)
            elif "/youtubei/v1/next" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(YT_NEXT, ensure_ascii=False))
            elif "/watch" in url:
                route.fulfill(status=200, content_type="text/html", body=YT_WATCH)
            else:  # 검색 결과: 영상 없음
                route.fulfill(status=200, content_type="text/html", body="<html><script>var ytInitialData = {};</script></html>")

        def clien(route):
            body = CLIEN_VIEW if re.search(r"/cm_car/\d+", route.request.url) else CLIEN_LIST
            route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)

        ctx.route("https://*.naver.com/**", naver)
        ctx.route("https://www.youtube.com/**", youtube)
        ctx.route("https://www.clien.net/**", clien)

        def ppomppu(route):
            url = route.request.url
            requests.append(url)
            if "comment.php" in url:
                q = parse_qs(urlparse(url).query)
                assert q.get("cmd") == ["get_comment_json"] and q.get("comment_mode") == ["sort_asc"]
                route.fulfill(status=200, content_type="application/json; charset=utf-8", body=json.dumps(PPOM_JSON[q["c_page"][0]], ensure_ascii=False))
            else:
                route.fulfill(status=200, headers={"content-type": "text/html; charset=euc-kr"}, body=PPOM_VIEW.encode("euc-kr"))

        ctx.route("https://www.ppomppu.co.kr/**", ppomppu)

        def bobae(route):
            requests.append(route.request.url)
            route.fulfill(status=200, content_type="text/html; charset=utf-8", body=bobae_view())

        ctx.route("https://www.bobaedream.co.kr/**", bobae)
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        yield ctx, sw, ext_id, requests
        ctx.close()


def test_gv90_collect_excel_db_dashboard(ext, tmp_path: Path):
    ctx, sw, ext_id, requests = ext
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto(f"chrome-extension://{ext_id}/gv90.html")
    page.evaluate("gv90Init")

    # 자동 수집 예약 (일일동향처럼 매일 06:00)
    alarm = sw.evaluate("chrome.alarms.get('gv90-daily-collect')")
    assert alarm and alarm["scheduledTime"] > 0

    # 설정: 카페 끄기 · 커뮤니티는 클리앙만 · 유튜브 채널 1개 · 매일 근무일(휴일 합본 확인용) · 무료 분석이 기본
    page.evaluate(
        f"""async () => {{
        const s = await loadSettings();
        if (s.aiOn) throw new Error('AI 판독이 기본으로 켜져 있음');
        s.channels = {{ news: true, cafe: false, youtube: true, community: true }};
        s.communities = s.communities.map((c) => ({{ ...c, on: c.name === '클리앙' }}));
        s.youtubeChannels = [{{ id: '{YT_CHANNEL}', name: '자동차채널', on: true }}];
        s.youtubeSearch = true;
        s.newsMaxPages = 1;
        s.workdays = '0,1,2,3,4,5,6';
        s.holidays = '';
        s.speed = 'normal';
        await saveSettings(s);
        // 데일리 DB 에 이미 있는 글 (지난 보고에 들어감) → 다시 넣지 않음
        await savePosts([{{ key: 'news:002/0000000002', url: 'https://n.news.naver.com/mnews/article/002/0000000002', channel: '언론', media: '한국경제', car: 'GV90',
          date: new Date(2026, 7, 4).getTime(), summary: '지난 보고 글', category: '판매·출고', sentiment: '중립', day: '20260804' }}], '20260804');
        await refreshDay('20260804', {{ from: new Date(2026, 7, 3, 7, 30).getTime(), to: new Date(2026, 7, 4, 7, 30).getTime() }});
        // 아직 엑셀에 담지 않은 휴일 수집분 (다음 근무일에 합쳐짐)
        await saveRun({{ id: 'run-holiday', startedAt: Date.now() - 3600e3, finishedAt: Date.now() - 3000e3, range: {{ start: new Date(2026, 7, 4, 7, 30).getTime(), end: new Date(2026, 7, 5, 7, 30).getTime() }},
          auto: true, holiday: '토요일', items: [{{ key: 'clien.net:holiday', channel: '자동차 커뮤니티', media: '보배드림', url: 'https://www.bobaedream.co.kr/view?code=national&No=777',
          title: 'GV90 주말 시승 후기', summary: 'GV90 주말 시승 만족 후기', date: new Date(2026, 7, 4, 20, 0).getTime(), exact: true, views: 55, ccount: 3,
          checked: true, related: true, car: 'GV90', category: '성능·주행', sentiment: '긍정', by: 'rule' }}] }});
      }}"""
    )
    page.reload()
    page.evaluate("gv90Init")
    page.fill("#rangeStart", "2026-08-05T07:30")
    page.fill("#rangeEnd", "2026-08-06T07:30")
    page.click("#start")
    # 찾는 대로 결과 표에 바로 보임 (수집 중)
    wait_js(page, "running && document.querySelectorAll('#results tbody tr').length > 0", 120000)
    assert page.is_visible("#resultBox")
    wait_js(page, "!running && items.length > 0", 120000)
    page.locator("#summary", has_text="GV90 관련 게시물").wait_for()

    items = page.evaluate("items")
    by_key = {x["key"]: x for x in items}
    # 언론: 네이버 뉴스 기사 (댓글 수) · 이미 DB 에 있는 기사는 체크 해제
    news1 = by_key["news:001/0000000001"]
    assert news1["channel"] == "언론" and news1["media"] == "연합뉴스" and news1["ccount"] == 31 and news1["checked"]
    assert news1["sentiment"] == "긍정"  # 무료 분석: '만족·호평·고급스럽'
    assert by_key["news:002/0000000002"]["dup"] and not by_key["news:002/0000000002"]["checked"]
    # 유튜브: 채널 RSS 중 키워드 맞는 영상만 · 조회수·댓글 수
    yt = by_key["yt:gv90video01"]
    assert yt["views"] == 15234 and yt["ccount"] == 128 and yt["checked"]
    assert "yt:otherotherx" not in by_key
    assert "yt:gv90short001" not in by_key and "yt:gv90short002" not in by_key  # 쇼츠 제외 (피드 주소 · 쇼츠 확인)
    # 커뮤니티: 제목에 키워드 · 기간 안 · 조회수·댓글 수 · 부정
    cl = [x for x in items if x["channel"] == "자동차 커뮤니티" and "501" in x["url"]][0]
    assert cl["views"] == 1234 and cl["ccount"] == 2 and cl["sentiment"] == "부정" and cl["category"] == "가격"
    assert not any("/cm_car/400" in x["url"] for x in items)
    # 휴일 수집분 합본
    assert by_key["clien.net:holiday"]["fromRun"].endswith("토요일 수집")

    # 결과 표: 👁 💬 뱃지 (조회 1,000↑ 이면 빨간 hot)
    row = page.locator("#results tbody tr", has_text="실망입니다")
    badge = row.locator(".counts")
    assert "👁 1,234" in badge.inner_text() and "💬 2" in badge.inner_text()
    assert "hot" in badge.get_attribute("class")

    # 엑셀 만들기 → 데일리 DB 저장
    page.click("#saveList")
    page.locator("#saveInfo", has_text="데일리 DB 저장").wait_for(timeout=60000)
    b64 = page.evaluate(
        """async () => { const f = await getDayFile(todayKey()); let s = ''; for (const b of f.bytes) s += String.fromCharCode(b); return [f.name, btoa(s)]; }"""
    )
    assert re.match(r"^\d{6}_GV90 온라인 동향 게시글 raw data\.xlsx$", b64[0]), b64[0]
    wb = load_workbook(BytesIO(base64.b64decode(b64[1])))
    assert wb.sheetnames[0] == "제네시스"
    ws = wb["제네시스"]
    assert [c.value for c in ws[1]] == ["연번", "채널", "커뮤니티명", "차종", "게시일", "게시글 위치", "주요 내용", "구분", "성향"]
    assert ws["A1"].fill.fgColor.rgb == "FF002060" and ws["A1"].font.b and ws["A1"].font.sz == 11 and ws.row_dimensions[1].height == 25
    assert ws.column_dimensions["C"].width > 50 and ws["C2"].alignment.horizontal == "left"
    rows = [[c.value for c in r] for r in ws.iter_rows(min_row=2)]
    assert [r[0] for r in rows] == list(range(1, len(rows) + 1))  # 연번 이어짐 (누적)
    # 순서: 보고일마다 이전 데이터 뒤에 이어 붙임 · 그날 안에서는 채널(언론 · 유튜브 · 동호회 · 커뮤니티)
    CHO = ["언론", "유튜브", "동호회", "자동차 커뮤니티"]
    days = page.evaluate("(async () => { const m = {}; for (const p of await allPosts()) m[p.url] = p.day; return m; })()")
    keyseq = [(days[r[5]], CHO.index(r[1])) for r in rows]
    assert keyseq == sorted(keyseq), keyseq
    urls = {r[5]: r for r in rows}
    assert "https://n.news.naver.com/mnews/article/002/0000000002" in urls  # 지난 보고 글도 누적 엑셀에
    assert urls["https://www.clien.net/service/board/cm_car/501"][8] == "부정"
    assert urls["https://www.clien.net/service/board/cm_car/501"][3] == "GV90"
    assert urls["https://www.clien.net/service/board/cm_car/501"][1] == "자동차 커뮤니티"
    assert ws["E2"].number_format == 'mm"월"\\ dd"일"'  # 일일동향 양식 날짜 형식
    assert ws["F2"].hyperlink is not None
    assert "일자별 집계" in wb.sheetnames
    wd = wb["일자별 집계"]
    # 게시글 엑셀: 댓글 시트 없음 · 일자별 집계에도 댓글 열 없음
    assert "댓글" not in wb.sheetnames
    assert wd["K1"].value == "(단위 : 건)" and wd["B2"].value == "게시물" and wd["C2"].value == "채널별 게시물" and wd["K2"].value == "부정+단순비난 비율"
    # 합계·비율은 수식 (엑셀에서 다시 계산) · 값도 함께 들어 있음 · 건수는 천 단위 쉼표
    tot_row = next(r for r in range(4, wd.max_row + 1) if wd.cell(r, 1).value == "합계")
    assert str(wd.cell(tot_row, 2).value).startswith("=SUM(B4:") and str(wd.cell(4, 11).value).startswith("=IF(B4=0")
    assert wd.cell(4, 2).number_format == "#,##0"
    wd = load_workbook(BytesIO(base64.b64decode(b64[1])), data_only=True)["일자별 집계"]
    lrow = [wd.cell(r, 11) for r in range(4, wd.max_row + 1)]
    assert all(isinstance(c.value, (int, float)) and c.number_format == "0.0%" for c in lrow if c.value != "-"), [(c.value, c.number_format) for c in lrow]
    import zipfile
    with zipfile.ZipFile(BytesIO(base64.b64decode(b64[1]))) as z:
        assert all("numberStoredAsText" in z.read(n).decode() for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
    # 저장이 끝나면 '받기'가 아니라 '✔ 엑셀 저장 완료!' (또 누르면 묻고, [취소]면 파일을 더 만들지 않음)
    assert page.inner_text("#getList").strip() == "✔ 엑셀 저장 완료!"
    # 같은 글을 다시 저장해도 늘지 않음
    total = page.evaluate("(async () => (await allPosts()).length)()")
    page.evaluate("makeExcel({ interactive: false })")
    assert page.evaluate("(async () => (await allPosts()).length)()") == total
    # 휴일 회차는 보고됨 처리
    assert page.evaluate("(async () => (await listRuns()).find((r) => r.id === 'run-holiday').reportedAt > 0)()")

    # 예전 수정본 올리기로 두 번 들어간 커뮤니티 글 (키가 주소 전체) → 데일리 DB 를 열면 하나로 합침
    page.evaluate("""(async () => { const o = (await allPosts()).find((p) => p.key === 'clien.net:501');
      await savePosts([{ ...o, key: 'clien.net:' + o.url, summary: '엑셀에서 고친 요약', by: 'edit', day: '20991231' }], '20991231'); })()""")
    # 데일리 DB 화면
    page.goto(f"chrome-extension://{ext_id}/db.html")
    page.evaluate("dbInit")
    dup = page.evaluate("(async () => (await allPosts()).filter((p) => p.url.includes('cm_car/501')).map((p) => [p.key, p.summary]))()")
    assert dup == [["clien.net:501", "엑셀에서 고친 요약"]], dup
    assert page.locator("#days tbody tr").count() == 2
    # 성향별: 게시글 · 댓글 · 총평가 나눠 표시 (위쪽 누적 성향도)
    first = page.locator("#days tbody tr").first.inner_text()
    assert "게시글" in first and "댓글" in first and "총평가" in first, first
    assert page.is_visible("#dbSenti") and "총평가" in page.inner_text("#dbSenti")
    # 최종 엑셀 받기: 게시글 · 게시글 댓글 성향 · 일자별 집계 (댓글이 없으면 댓글 탭 없이)
    assert page.is_visible("#finalXlsx")
    fb = page.evaluate("""(async () => {
      const day = document.querySelector('#finalBox').dataset.day;
      const posts = await postsOfDay(day);
      const bytes = Gv90Xlsx.buildFinal({ posts, comments: [{ postKey: posts[0].key, text: 'GV90 좋네요', sentiment: '긍정', category: '디자인', date: Date.now() }], daily: (await listDays()).reverse() });
      let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
    })()""")
    wf = load_workbook(BytesIO(base64.b64decode(fb)), data_only=True)
    assert wf.sheetnames == ["게시글", "게시글 댓글 성향", "일자별 집계"], wf.sheetnames
    # 일자별 집계: 게시물 표 아래에 댓글 표 (같은 모양)
    wd2 = wf["일자별 집계"]
    vals = [[c.value for c in r] for r in wd2.iter_rows()]
    hrow = next(i for i, r in enumerate(vals) if r[0] == "보고일" and r[1] == "댓글")
    assert vals[hrow][2] == "채널별 댓글" and vals[hrow][6] == "성향별 댓글" and vals[hrow + 1][6] == "긍정"
    tot = next(r for r in vals[hrow:] if r[0] == "합계")
    assert tot[1] == 1 and tot[6] == 1  # 댓글 1개 · 긍정 1
    # 보고일 줄 버튼: 게시글 엑셀 저장 · 댓글 엑셀 저장 · 게시글/댓글 수정본 올리기 (최종 엑셀은 위 칸에서만)
    acts = page.locator("#days tbody tr").first.inner_text()
    for t in ["게시글 엑셀 저장", "댓글 엑셀 저장", "게시글 수정본 올리기", "댓글 수정본 올리기"]:
        assert t in acts, acts
    # 수정본 올리기의 게시글 찾기 키 = 수집기 키 (커뮤니티 글이 두 번 들어가지 않게)
    assert page.evaluate("keyOfUrl('https://www.clien.net/service/board/cm_car/501')") == "clien.net:501"
    page.locator("#days tbody tr").first.locator("button", has_text="게시물 보기").click()
    page.locator("#dayPosts tbody tr .counts.hot").first.wait_for()

    # 대시보드 (상세 + 보고용 복사 대시보드)
    page.goto(f"chrome-extension://{ext_id}/dashboard.html")
    page.evaluate("dashInit")
    page.locator("#reportBody", has_text="DASHBOARD").wait_for()
    assert "GV90" in page.inner_text("#reportBody")
    # 왼쪽 댓글 합계 = 채널 카드 댓글 합
    assert page.evaluate("rpData.totalComments === rpData.channels.reduce((s, c) => s + c.comments, 0)")
    assert page.evaluate("rpData.totalComments === rpData.comments.length")  # 댓글 = 모은 댓글 수 (댓글 엑셀과 같게)
    # 모니터링 채널: 그날 글이 나온 곳이 아니라 설정의 전체 모니터링 수
    assert "모니터링 채널: 언론 네이버 뉴스 전체 · 유튜브 1개 채널 + 검색 · 커뮤니티 1곳" in page.inner_text("#reportBody")
    assert page.evaluate("(async () => { const d = { ...rpData, channels: rpData.channels.filter((c) => c.ch !== '유튜브'), channelsOn: ['언론', '유튜브', '자동차 커뮤니티'] }; d.excluded = { 유튜브: { n: 2, why: { 'GV90 관련 내용이 아닌 글(다른 차종 이야기·단순 언급)': 2 } } }; const h = reportHtml(d); return h.includes('해당일에 관련 게시글 없음') && h.includes('수집 후보 <b>2건</b>을 확인했으나'); })()")
    page.locator("#trend svg").wait_for()
    page.click("#rpCopy")
    page.locator("#rpInfo", has_text="복사했습니다").wait_for()

    assert not errors, errors
    assert not any("cafe.naver.com" in u for u in requests)  # 카페를 끄면 카페 화면을 열지 않음

    # 직접 넣은 주소만 수집: 전체를 다시 돌지 않고 그 글만 지금 결과에 더함
    page.goto(f"chrome-extension://{ext_id}/gv90.html")
    page.evaluate("gv90Init")
    wait_js(page, "items.length > 0")
    n0 = page.evaluate("items.length")
    before = len(requests)
    page.fill("#directUrls", "https://www.youtube.com/watch?v=gv90direct1")
    page.click("#start")
    page.locator("#summary", has_text="직접 넣은 주소").wait_for()
    assert page.evaluate("items.length") == n0 + 1 and page.evaluate("items.some((x) => x.key === 'yt:gv90direct1' && x.checked)")
    assert not [u for u in requests[before:] if "search.naver.com" in u]  # 언론 검색을 다시 하지 않음


def test_gv90_comments(ext, tmp_path: Path):
    """댓글 수집: 언론(네이버 뉴스) · 유튜브 · 클리앙 · 뽐뿌(댓글 목록 전체읽기 2쪽, 답글 포함, 차단·지운 댓글 제외) → 무료 성향 분석 → DB · 댓글 엑셀 · 대시보드 반응."""
    ctx, sw, ext_id, requests = ext
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto(f"chrome-extension://{ext_id}/comments.html")
    page.evaluate("commentsInit")
    page.evaluate(
        """async () => {
        const day = todayKey();
        const base = { car: 'GV90', exact: true, category: '가격', sentiment: '중립', by: 'rule', day, date: new Date(2026, 7, 5, 15).getTime() };
        await savePosts([
          { ...base, key: 'news:001/0000000001', url: 'https://n.news.naver.com/mnews/article/001/0000000001', channel: '언론', media: '연합뉴스', title: 'GV90 출시', ccount: 31 },
          { ...base, key: 'newsx:www.hankyung.com/article/1', url: 'https://www.hankyung.com/article/1', channel: '언론', media: '한국경제', title: '외부 기사', ccount: null },
          { ...base, key: 'yt:gv90video01', url: 'https://www.youtube.com/watch?v=gv90video01', channel: '유튜브', media: '자동차채널', title: 'GV90 시승기', ccount: 128, src: { videoId: 'gv90video01' } },
          { ...base, key: 'clien.net:501', url: 'https://www.clien.net/service/board/cm_car/501', channel: '자동차 커뮤니티', media: '클리앙', title: 'GV90 실물 보니 실망입니다 비싸요', ccount: 2 },
          { ...base, key: 'bobaedream.co.kr:2422499', url: 'https://www.bobaedream.co.kr/view?code=national&No=2422499', channel: '자동차 커뮤니티', media: '보배드림', title: 'CN8 계기판 없는 차는 향후 중고로 판매 시 불리할 듯', ccount: 55 },
          { ...base, key: 'ppomppu.co.kr:980300', url: 'https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980300', channel: '자동차 커뮤니티', media: '뽐뿌', title: 'GV90 가격', ccount: 5 },
        ], day);
        await refreshDay(day, { keepEmpty: true });
      }"""
    )
    page.reload()
    page.evaluate("commentsInit")
    # 댓글 수 읽기: 작성자 정보 줄의 '댓글 55,929' 가 아니라 제목 옆 [11] · 조회수보다 큰 수는 버림 · 클리앙·뽐뿌는 그대로
    counts = page.evaluate(
        """([bobae, clien, ppom]) => {
        const doc = (h) => new DOMParser().parseFromString(h, 'text/html');
        const b = 'https://www.bobaedream.co.kr/view?code=national&No=2422499';
        return [
          articleCommentCount(doc(bobae), communityAdapter(b), { views: 1775, title: 'CN8 계기판 없는 차는' }),
          articleCommentCount(doc(bobae.replace(' [11]', '')), communityAdapter(b), { views: 1775, title: 'CN8 계기판 없는 차는' }),
          expectedCommentCount(doc(bobae)),
          articleCommentCount(doc(clien), communityAdapter('https://www.clien.net/service/board/cm_car/501'), { views: 1234, title: 'GV90 실물' }),
          articleCommentCount(doc(ppom), communityAdapter('https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980300'), { views: 3210, title: 'GV90' }),
        ];
      }""",
        [bobae_view(), CLIEN_VIEW, PPOM_VIEW],
    )
    assert counts[0] == 11 and counts[2] < 1000 and counts[3] == 2 and counts[4] == 5, counts
    # 뽐뿌 댓글 수는 댓글 목록(get_comment_json)의 total_comment (글 화면의 한 쪽 개수 등이 아니라)
    assert page.evaluate("ppomppuCommentTotal('https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980300')") == 6
    assert counts[1] is None or counts[1] <= 1775, counts
    rows = page.locator("#postTable tbody tr")
    assert rows.count() == 6
    # 언론사 자체 사이트 기사는 고를 수 없음 (네이버 댓글 없음)
    assert page.locator("#postTable tbody tr", has_text="한국경제").locator("input").is_disabled()
    assert page.locator("#postTable tbody tr", has_text="연합뉴스").locator(".stb.st-before").count() == 1
    page.click("#start")
    # 수집 중: 차례를 기다리는 글은 '대기', 지금 읽는 글은 '수집 중' 뱃지
    wait_js(page, "running && document.querySelectorAll('#postTable .stb.st-run').length === 1", 30000)
    wait_js(page, "!running && document.querySelector('#summary').textContent.includes('댓글')", 120000)
    assert page.locator("#postTable .stb.st-run, #postTable .stb.st-wait").count() == 0
    by = page.evaluate("(async () => { const out = {}; for (const c of await allComments()) (out[c.postKey] ||= []).push([c.text, c.sentiment, c.isReply]); return out; })()")
    assert [c[0] for c in by["news:001/0000000001"]] == NEWS_COMMENTS
    assert {c[0] for c in by["yt:gv90video01"]} == {"GV90 디자인 멋지다 최고", "흉물 같음 현기차"}
    assert {c[0] for c in by["clien.net:501"]} == {"그래도 실내는 좋던데요", "저도 비싸서 포기"}
    # 보배드림: 댓글 11개 · 댓글 수 11 (예전에 잘못 저장된 55 대신)
    assert len(by["bobaedream.co.kr:2422499"]) == 11
    assert page.evaluate("(async () => (await allPosts()).find((p) => p.key === 'bobaedream.co.kr:2422499').ccount)()") == 11
    ppom = {c[0]: c for c in by["ppomppu.co.kr:980300"]}
    print("PPOM", sorted(ppom))
    assert set(ppom) == {"첫 댓글 GV90 가격 비싸요 정말로", "답글 동의합니다", "답글의 답글", "옵션 구성 아쉽네요", "둘째 쪽 댓글 기본 모델 괜찮음"}, sorted(ppom)
    assert not any("차단" in t for t in ppom)
    assert ppom["답글 동의합니다"][2] is True  # 답글
    assert any("comment.php" in u and "c_page=2" in u for u in requests)  # 2쪽까지 전체읽기
    # 무료 성향 분석
    news = {c[0]: c[1] for c in by["news:001/0000000001"]}
    assert news["GV90 실내 정말 고급스럽네요 만족"] == "긍정" and news["가격이 너무 비싸요 실망"] == "부정"
    assert dict((c[0], c[1]) for c in by["yt:gv90video01"])["흉물 같음 현기차"] == "단순비난"
    # 수집 상태 · 다시 수집해도 늘지 않음
    assert "✔ 완료 3개" in page.locator("#postTable tbody tr", has_text="연합뉴스").locator(".stb.st-ok").inner_text()
    n1 = page.evaluate("(async () => (await allComments()).length)()")
    page.evaluate("posts.forEach((p) => (p.checked = p.key === 'clien.net:501')); renderPosts();")
    page.click("#start")
    wait_js(page, "!running", 60000)
    assert page.evaluate("(async () => (await allComments()).length)()") == n1
    # 댓글 표: 모두 보임 · 채널 · 분석(AI 안 됨) 거르기
    page.select_option("#chSel", "유튜브")
    n_yt = page.evaluate("comments.filter((c) => c.channel === '유튜브').length")
    assert page.locator("#commentTable tbody tr").count() == n_yt and n_yt > 0
    page.select_option("#chSel", "")
    page.select_option("#bySel", "notai")
    assert page.locator("#commentTable tbody tr").count() == page.evaluate("comments.length")  # 무료 분석만 한 상태
    page.select_option("#bySel", "")
    # 댓글 표에서 성향 고치기 → DB
    # 댓글 구분은 댓글마다 내용으로 (원글 구분 '가격'을 복사하지 않음)
    cats = page.evaluate("(async () => (await allComments()).map((c) => [c.category, ruleCategory(c.text)]))()")
    assert all(a == b for a, b in cats), cats
    assert any(a != "가격" for a, _ in cats)
    sel = page.locator("#commentTable tbody tr", has_text="출시 일정 궁금합니다").locator("select.senti")
    sel.select_option("부정")
    page.wait_for_timeout(300)
    assert page.evaluate("(async () => (await allComments()).find((c) => c.text === '출시 일정 궁금합니다').sentiment)()") == "부정"
    # 댓글 표에서 구분 고치기 → DB (직접 고친 값)
    page.locator("#commentTable tbody tr", has_text="출시 일정 궁금합니다").locator("select.cat").select_option("판매·출고")
    page.wait_for_timeout(300)
    assert page.evaluate("(async () => (await allComments()).find((c) => c.text === '출시 일정 궁금합니다').category)()") == "판매·출고"
    # 댓글 엑셀
    page.click("#makeXlsx")
    page.locator("#saveInfo", has_text="저장했습니다").wait_for()
    b64 = page.evaluate("(() => { let s = ''; for (const b of pendingXlsx.bytes) s += String.fromCharCode(b); return [pendingXlsx.name, btoa(s)]; })()")
    assert b64[0].endswith("GV90 온라인 동향 댓글 raw data.xlsx"), b64[0]
    wb = load_workbook(BytesIO(base64.b64decode(b64[1])))
    assert wb.sheetnames == ["댓글", "게시글별 댓글 성향"]
    assert page.inner_text("#getXlsx").strip() == "✔ 댓글 엑셀 저장 완료!"
    ws = wb["댓글"]
    assert [c.value for c in ws[1]] == ["연번", "채널", "커뮤니티명", "차종", "작성일", "게시글 위치", "댓글", "구분", "성향"]
    assert ws["A1"].fill.fgColor.rgb == "FF002060" and ws.row_dimensions[1].height == 25
    assert ws.max_row - 1 == n1
    assert "판매·출고" in [r[7].value for r in ws.iter_rows(min_row=2)]
    assert isinstance(wb["게시글별 댓글 성향"]["A2"].value, int)  # 게시글 번호는 숫자 (오류 표시 안 나게)
    # 나중에 다시 수집한 글의 댓글도 그 게시글 자리에 (맨 뒤로 가지 않음)
    order = page.evaluate("""(() => {
      const posts = [{ key: 'c1', channel: '자동차 커뮤니티', day: '20261111', date: 2 }, { key: 'y1', channel: '유튜브', day: '20261111', date: 1 }];
      const cs = [{ postKey: 'c1', text: 'c-a', channel: '자동차 커뮤니티' }, { postKey: 'c1', text: 'c-b', channel: '자동차 커뮤니티' }, { postKey: 'y1', text: 'y-a', channel: '유튜브' }];
      const bytes = Gv90Xlsx.buildComments({ comments: cs, posts });
      let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
    })()""")
    wo = load_workbook(BytesIO(base64.b64decode(order)))["댓글"]
    assert [r[6].value for r in wo.iter_rows(min_row=2)] == ["y-a", "c-a", "c-b"]
    # 누적: 게시글 엑셀과 같은 순서 (보고일마다 이어 붙임)
    order2 = page.evaluate("""(() => {
      const posts = [{ key: 'new', channel: '언론', day: '20261111', serial: 3 }, { key: 'old', channel: '자동차 커뮤니티', day: '20261110', serial: 1 }];
      const cs = [{ postKey: 'new', text: 'n-a', channel: '언론' }, { postKey: 'old', text: 'o-a', channel: '자동차 커뮤니티' }];
      const bytes = Gv90Xlsx.buildComments({ comments: cs, posts });
      let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
    })()""")
    assert [r[6].value for r in load_workbook(BytesIO(base64.b64decode(order2)))["댓글"].iter_rows(min_row=2)] == ["o-a", "n-a"]  # 지난 보고일 댓글 먼저, 새 보고일 댓글이 뒤에
    wg = wb["게시글별 댓글 성향"]
    assert [c.value for c in wg[1]] == ["No", "커뮤니티명 / 게시글 위치", "제목", "주요 내용 · 댓글", "게시일 · 작성일", "구분", "성향"]
    # 게시글 줄: 커뮤니티명 · 제목 / 첫 댓글 줄 B칸: 게시글 위치(링크)
    assert wg["A2"].value == 1 and wg["B2"].value and wg["C2"].value
    assert wg["A3"].value == "1-1" and str(wg["B3"].value).startswith("http") and wg["B3"].hyperlink is not None
    assert wg["A4"].value != "1-2" or not wg["B4"].value
    # 댓글 수정본 올리기: 엑셀에서 고친 댓글 성향·구분을 DB 에 (게시글별 댓글 성향 탭 · 답글 줄)
    target = page.evaluate("(async () => { const c = (await allComments()).find((c) => c.isReply); return [c.text, c.sentiment]; })()")
    new_sent = "부정" if target[1] != "부정" else "긍정"
    wfix = load_workbook(BytesIO(base64.b64decode(b64[1])))
    wsg = wfix["게시글별 댓글 성향"]
    hit = 0
    for r in range(2, wsg.max_row + 1):
        if str(wsg.cell(r, 4).value or "").endswith(target[0]):
            wsg.cell(r, 7).value = new_sent
            wsg.cell(r, 6).value = "모두 포함(가격+편의사양)"
            hit += 1
    assert hit == 1
    fixp = tmp_path / "fix.xlsx"
    wfix.save(fixp)
    page.goto(f"chrome-extension://{ext_id}/db.html")
    page.evaluate("dbInit")
    page.locator("#finalFix").wait_for()
    with page.expect_file_chooser() as fc:
        page.click("#finalFix")
    fc.value.set_files(str(fixp))
    page.locator("#info", has_text="바뀐 댓글 1개").wait_for()
    got = page.evaluate(f"(async () => {{ const c = (await allComments()).find((c) => c.text === {json.dumps(target[0])}); return [c.sentiment, c.category, c.edited]; }})()")
    assert got[0] == new_sent and got[1] == "모두 포함(가격+편의사양)" and "sentiment" in got[2], got
    # 대시보드: 반응 = 게시글 + 댓글 성향
    page.goto(f"chrome-extension://{ext_id}/dashboard.html")
    page.evaluate("dashInit")
    page.locator("#reportBody", has_text="반응").wait_for()
    assert "전체 성향 (성향을 분석한 반응" in page.inner_text("#reportBody")
    assert not errors, errors


def test_gv90_resume(ext, tmp_path: Path):
    """중지된 수집이 있으면 '수집 시작' → 확인 시 멈춘 곳부터 이어서 (끝난 언론은 다시 검색하지 않음)."""
    ctx, sw, ext_id, requests = ext
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    page.goto(f"chrome-extension://{ext_id}/gv90.html")
    page.evaluate("gv90Init")
    page.evaluate(
        """async () => {
        const s = await loadSettings();
        s.channels = { news: true, cafe: false, youtube: false, community: true };
        s.communities = s.communities.map((c) => ({ ...c, on: c.name === '클리앙' }));
        s.newsMaxPages = 1;
        await saveSettings(s);
        await chrome.storage.local.set({ gvResume: { v: 1, at: Date.now() - 60000, runId: 'run-stopped', startedAt: Date.now() - 600000,
          on: s.channels, range: { start: new Date(2026, 7, 5, 7, 30).getTime(), end: new Date(2026, 7, 6, 7, 30).getTime() },
          cafeTotal: 0, commTotal: 1, done: { news: true, youtube: false, cafes: [], communities: [] }, seen: ['news:001/0000000001'],
          items: [{ key: 'news:001/0000000001', channel: '언론', media: '연합뉴스', url: 'https://n.news.naver.com/mnews/article/001/0000000001',
            title: 'GV90 출시 호평', body: 'GV90 고급스럽 만족', date: new Date(2026, 7, 5, 9, 0).getTime(), exact: true, ccount: 31,
            checked: true, related: true, car: 'GV90', sentiment: '긍정', category: '디자인', summary: 'GV90 호평' }] } });
        await saveRun({ id: 'run-stopped', startedAt: Date.now() - 600000, finishedAt: Date.now() - 60000, range: { start: 0, end: 1 }, stopped: true, items: [] });
      }"""
    )
    page.reload()
    page.evaluate("gv90Init")
    wait_js(page, "document.querySelector('#estInfo').textContent.includes('중지된 수집')")
    page.fill("#rangeStart", "2026-08-01T07:30")  # 화면 기간이 달라도 이어하기는 멈춘 수집의 기간으로
    page.fill("#rangeEnd", "2026-08-02T07:30")
    before = len(requests)
    page.click("#start")
    wait_js(page, "!running && items.length > 0", 120000)
    assert dialogs and "이어서" in dialogs[0]
    assert page.input_value("#rangeStart") == "2026-08-05T07:30"
    # 언론은 끝난 단계라 네이버 뉴스 검색을 다시 하지 않음
    assert not [u for u in requests[before:] if "search.naver.com" in u]
    keys = page.evaluate("items.map((x) => x.key)")
    assert "news:001/0000000001" in keys  # 지난번 찾은 글 그대로
    assert any(k.startswith("clien") for k in keys)  # 남은 커뮤니티는 이어서 수집
    # 다 끝나면 진행 위치는 지우고, 같은 회차(run-stopped)로 덮어씀
    assert page.evaluate("chrome.storage.local.get('gvResume').then((o) => !o.gvResume)")
    runs = page.evaluate("listRuns().then((r) => r.map((x) => [x.id, x.stopped, x.items.length]))")
    assert ["run-stopped", False, len(keys)] in runs
    # 예전 버전에서 본문에 섞인 코드·동영상 문구가 주요 내용에 있으면 다시 정리
    fixed = page.evaluate("""() => {
      items.push({ key: 'bobae:x', title: 'Gv90', by: 'rule', summary: 'Gv90 - window.onload = function() { $(document).ready(function() { …',
        body: 'window.onload = function() { $(document).ready(function() { $("#a").hide(); }); }; Your browser does not support the video tag. 가격 보니 비싸네요. https://a.com/x' });
      fixDirtySummaries();
      return items.at(-1).summary;
    }""")
    assert fixed == "Gv90 - 가격 보니 비싸네요.", fixed
    # 체크 안 된 글 삭제하기 (확인 창은 자동 수락)
    page.evaluate("items = items.filter((x) => x.key !== 'bobae:x'); window._keep = items.length; items.forEach((x, i) => { x.checked = i === 0; }); renderResults()")
    page.click("#unselDelete")
    wait_js(page, "items.length === 1 && items[0].checked")
    # 유튜브 댓글 수: 영상 화면에 없으면 댓글 머리글('댓글 1,234개')에서
    cc = page.evaluate("""new YoutubeCollector({ log() {}, isStopped: () => false }).commentCount({ html: '',
      initialData: { itemSectionRenderer: { sectionIdentifier: 'comment-item-section', contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'T1' } } } }] } } })""")
    assert parse_cnt(cc) == 1234, cc
    # 영상 화면이 window["ytInitialData"] = {…} 모양이어도 읽음
    assert page.evaluate("""extractJsonAfter('<script>window["ytInitialData"] = {"a": {"b": 1}};</script>', 'ytInitialData').a.b""") == 1
    # 구분 '모두 포함': 무료 분석은 여러 이슈를 다룬 글이면 '모두 포함(…)' · 표에서 여러 개 직접 고르기
    assert page.evaluate("ruleCategory('GV90 디자인 외관 멋지다 가격 1억3950만원 비싸 사전계약 출고 대기')") == "모두 포함(디자인+가격+판매·출고)"
    page.evaluate("items = items.filter((x) => x.key !== 'bobae:x'); document.querySelector('#filter').value = ''; renderResults()")
    first_key = page.evaluate("visibleItems()[0].key")
    sel = page.locator("#results tbody tr").first.locator("select.cat")
    sel.select_option("__multi")
    pop = page.locator(".cat-pop")
    pop.wait_for()
    for c in ["디자인", "가격"]:
        pop.locator(f"input[value='{c}']").check()
    for c in ["품질", "성능·주행", "편의사양", "판매·출고", "서비스"]:
        pop.locator(f"input[value='{c}']").uncheck()
    pop.get_by_text("확인").click()
    cat = page.evaluate(f"items.find((x) => x.key === '{first_key}').category")
    assert cat == "모두 포함(디자인+가격)", cat
    assert page.evaluate(f"items.find((x) => x.key === '{first_key}').edited.includes('category')")
    assert not errors, errors
