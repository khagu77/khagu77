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


def cbox(url):
    q = parse_qs(urlparse(url).query)
    n = 31 if q["objectId"][0].endswith("0000000001") else 0
    data = {"success": True, "result": {"count": {"comment": n}, "pageModel": {"totalPages": 1}, "commentList": []}}
    return "cb(" + json.dumps(data, ensure_ascii=False) + ");"


YT_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry><yt:videoId>gv90video01</yt:videoId><title>GV90 시승기 승차감 최고</title><published>2026-08-05T06:30:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>제네시스 GV90 리뷰</media:description></media:group></entry>
 <entry><yt:videoId>otherotherx</yt:videoId><title>아반떼 세차 영상</title><published>2026-08-05T05:00:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>-</media:description></media:group></entry>
</feed>"""
YT_WATCH = (
    '<html><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"GV90 시승기 승차감 최고","author":"자동차채널","shortDescription":"제네시스 GV90 리뷰","viewCount":"15234"},'
    '"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-08-05T15:30:00+09:00"}}};</script>'
    "<script>var ytInitialData = "
    + json.dumps({"engagementPanels": [{"commentsEntryPointHeaderRenderer": {"commentCount": {"simpleText": "128"}}}]})
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
    '<div class="post_author"><span class="view_count date">2026-08-05 10:00:00</span> <span class="view_count">조회 1,234</span></div>'
    '<div class="post_article">가격이 너무 비싸서 실망입니다. 옵션도 아쉽네요.</div>'
    '<div class="comment_head">댓글 25</div></body></html>'
)


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
            if "/feeds/videos.xml" in url:
                route.fulfill(status=200, content_type="application/xml", body=YT_FEED)
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
    # 커뮤니티: 제목에 키워드 · 기간 안 · 조회수·댓글 수 · 부정
    cl = [x for x in items if x["channel"] == "자동차 커뮤니티" and "501" in x["url"]][0]
    assert cl["views"] == 1234 and cl["ccount"] == 25 and cl["sentiment"] == "부정" and cl["category"] == "가격"
    assert not any("/cm_car/400" in x["url"] for x in items)
    # 휴일 수집분 합본
    assert by_key["clien.net:holiday"]["fromRun"].endswith("토요일 수집")

    # 결과 표: 👁 💬 뱃지 (조회 1,000↑ 이면 빨간 hot)
    row = page.locator("#results tbody tr", has_text="실망입니다")
    badge = row.locator(".counts")
    assert "👁 1,234" in badge.inner_text() and "💬 25" in badge.inner_text()
    assert "hot" in badge.get_attribute("class")

    # 엑셀 만들기 → 데일리 DB 저장
    page.click("#saveList")
    page.locator("#saveInfo", has_text="데일리 DB 저장").wait_for(timeout=60000)
    b64 = page.evaluate(
        """async () => { const f = await getDayFile(todayKey()); let s = ''; for (const b of f.bytes) s += String.fromCharCode(b); return [f.name, btoa(s)]; }"""
    )
    assert re.match(r"^\d{6}_GV90 온라인 동향 raw data\.xlsx$", b64[0]), b64[0]
    wb = load_workbook(BytesIO(base64.b64decode(b64[1])))
    assert wb.sheetnames[0] == "제네시스"
    ws = wb["제네시스"]
    assert [c.value for c in ws[1]] == ["연번", "커뮤니티명", "차종", "게시일", "구분", "게시글 위치", "주요 내용", "성향"]
    rows = [[c.value for c in r] for r in ws.iter_rows(min_row=2)]
    assert [r[0] for r in rows] == list(range(1, len(rows) + 1))  # 연번 이어짐 (누적)
    urls = {r[5]: r for r in rows}
    assert "https://n.news.naver.com/mnews/article/002/0000000002" in urls  # 지난 보고 글도 누적 엑셀에
    assert urls["https://www.clien.net/service/board/cm_car/501"][7] == "부정"
    assert urls["https://www.clien.net/service/board/cm_car/501"][2] == "GV90"
    assert ws["D2"].number_format == 'mm"월"\\ dd"일"'  # 일일동향 양식 날짜 형식
    assert ws["F2"].hyperlink is not None
    assert "일자별 집계" in wb.sheetnames
    # 같은 글을 다시 저장해도 늘지 않음
    total = page.evaluate("(async () => (await allPosts()).length)()")
    page.evaluate("makeExcel({ interactive: false })")
    assert page.evaluate("(async () => (await allPosts()).length)()") == total
    # 휴일 회차는 보고됨 처리
    assert page.evaluate("(async () => (await listRuns()).find((r) => r.id === 'run-holiday').reportedAt > 0)()")

    # 데일리 DB 화면
    page.goto(f"chrome-extension://{ext_id}/db.html")
    page.evaluate("dbInit")
    assert page.locator("#days tbody tr").count() == 2
    page.locator("#days tbody tr").first.locator("button", has_text="게시물 보기").click()
    page.locator("#dayPosts tbody tr .counts.hot").first.wait_for()

    # 대시보드 (상세 + 보고용 복사 대시보드)
    page.goto(f"chrome-extension://{ext_id}/dashboard.html")
    page.evaluate("dashInit")
    page.locator("#reportBody", has_text="DASHBOARD").wait_for()
    assert "GV90" in page.inner_text("#reportBody")
    page.locator("#trend svg").wait_for()
    page.click("#rpCopy")
    page.locator("#rpInfo", has_text="복사했습니다").wait_for()

    assert not errors, errors
    assert not any("cafe.naver.com" in u for u in requests)  # 카페를 끄면 카페 화면을 열지 않음
