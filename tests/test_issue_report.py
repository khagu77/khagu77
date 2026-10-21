"""'이슈 모니터링 보고서 작성' 확장 통합 테스트.

실제 네이버 뉴스·유튜브·클리앙·Claude API 대신 가짜 응답(route)을 넣고,
1 목적·채널·키워드 → 2 게시글 수집(AI 관련성) → 3 댓글 수집 → 4 성향 분석 → 5 PPT·최종 DB 저장까지 확인한다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import io
import json
import os
import re
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

EXT_DIR = Path(__file__).resolve().parent.parent / "issue-report-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

YT_CHANNEL = "UCabcdefghijklmnopqrstuv"

# ---------------------------------------------------------------- 네이버 뉴스
NEWS_SEARCH = (
    "<html><body><ul>"
    '<li><a href="https://n.news.naver.com/mnews/article/001/0000000001">아반떼 가격 공개 기사</a> <a href="https://n.news.naver.com/mnews/article/001/0000000001">네이버뉴스</a></li>'
    '<li><a href="https://n.news.naver.com/mnews/article/002/0000000002">댓글 없는 아반떼 기사</a></li>'
    # 언론사 자체 사이트 기사 (「네이버뉴스」 링크 없음)
    '<li class="bx"><div class="news_info"><a class="info press" href="https://www.hankyung.com/">한국경제</a><span class="info">2026.08.06.</span></div>'
    '<a class="news_tit" href="https://www.hankyung.com/article/2026080612345">아반떼 가격 공개 외부 언론사 기사</a><div class="dsc">아반떼 가격 이야기</div></li>'
    "</ul></body></html>"
)
NEWS_COMMENTS = {
    "news001,0000000001": ["가격이 너무 비싸요 4천은 심했다", "현기 배짱장사 답이 없네", "디자인 좋네요 기대됩니다"],
    "news002,0000000002": [],
}


def news_article(oid, aid):
    return (
        f'<html><head><meta property="og:title" content="기사 {aid}"></head><body>'
        f'<div class="media_end_head_top_logo"><img title="연합뉴스"></div>'
        f'<h2 id="title_area">현대차 디 올 뉴 아반떼 가격 공개 {aid[-1]}</h2>'
        f'<span class="media_end_head_info_datestamp_time" data-date-time="2026-08-06 09:00:00">2026.08.06</span>'
        f'<article id="dic_area">아반떼 가격이 2398만원부터 시작합니다.</article></body></html>'
    )


def cbox(url):
    q = parse_qs(urlparse(url).query)
    texts = NEWS_COMMENTS.get(q["objectId"][0], [])
    data = {
        "success": True,
        "result": {
            "count": {"comment": len(texts)},
            "pageModel": {"totalPages": 1},
            "commentList": [
                {"commentNo": i + 1, "contents": t, "regTime": "2026-08-06T09:3%d:00+0900" % i, "userName": "u", "replyCount": 0}
                for i, t in enumerate(texts)
            ],
        },
    }
    return "cb(" + json.dumps(data, ensure_ascii=False) + ");"


# ---------------------------------------------------------------- 유튜브
YT_FEED = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry><yt:videoId>abcdefghijk</yt:videoId><title>신형 아반떼 가격 리뷰</title><published>2026-08-06T00:30:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>CN8 가격 분석</media:description></media:group></entry>
 <entry><yt:videoId>oldoldoldol</yt:videoId><title>지난주 영상</title><published>2026-07-20T00:00:00+00:00</published>
  <author><name>자동차채널</name></author><media:group><media:description>-</media:description></media:group></entry>
</feed>"""
YT_WATCH = (
    '<html><script>ytcfg.set({"INNERTUBE_API_KEY":"KEY","INNERTUBE_CLIENT_VERSION":"2.0"});</script>'
    '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"신형 아반떼 가격 리뷰","author":"자동차채널","shortDescription":"CN8"},'
    '"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-08-06T09:30:00+09:00"}}};</script>'
    "<script>var ytInitialData = "
    + json.dumps({"contents": {"itemSectionRenderer": {"sectionIdentifier": "comment-item-section", "contents": [
        {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "T1"}}}}]}}})
    + ";</script></html>"
)


def yt_comment(cid, text):
    return {"payload": {"commentEntityPayload": {"properties": {"commentId": cid, "content": {"content": text}, "publishedTime": "1시간 전"}, "author": {"displayName": "a"}}}}


YT_NEXT = {"frameworkUpdates": {"entityBatchUpdate": {"mutations": [yt_comment("Y1", "노조 월급 주려고 올렸네 현기"), yt_comment("Y2", "가격 비싸서 쏘나타 삽니다")]}}}

# ---------------------------------------------------------------- 클리앙
CLIEN_LIST = (
    "<html><body>"
    '<div class="list_item"><a href="/service/board/cm_car/111">아반떼 가격 진짜 비싸네요</a><span class="timestamp">2026-08-06 08:00:00</span></div>'
    '<div class="list_item"><a href="/service/board/cm_car/112">무관한 아반떼 가격 광고</a><span class="timestamp">2026-08-06 07:00:00</span></div>'
    '<div class="list_item"><a href="/service/board/cm_car/113">타이어 교체 후기</a><span class="timestamp">2026-08-06 06:00:00</span></div>'
    '<div class="list_item"><a href="/service/board/cm_car/100">아반떼 가격 옛날 글</a><span class="timestamp">2026-08-01 06:00:00</span></div>'
    "</body></html>"
)
CLIEN_VIEW = (
    '<html><body><div class="post_author"><span class="view_count date">2026-08-06 08:00:00</span></div>'
    '<div class="post_article">아반떼 가격 너무 올랐습니다</div>'
    '<div class="comment_row"><div class="comment_view">그래도 차는 잘 나왔어요 좋네요</div><span class="timestamp">2026-08-06 08:10:00</span></div>'
    '<div class="comment_row"><div class="comment_view">옵션 장사 심하네요 비싸</div><span class="timestamp">2026-08-06 08:20:00</span></div>'
    "</body></html>"
)


# ---------------------------------------------------------------- Claude API (스트리밍 응답 흉내)
def sse(obj_text):
    events = [
        ("message_start", {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
                                                                "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 100, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": obj_text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 50}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {e}\ndata: {json.dumps(d, ensure_ascii=False)}\n\n" for e, d in events)


def senti_of(text):
    if "현기" in text or "노조" in text:
        return "단순비난"
    if "비싸" in text or "심했" in text or "장사" in text:
        return "부정"
    if "좋" in text or "기대" in text:
        return "긍정"
    return "중립"


def claude(body, calls):
    system = "".join(b["text"] for b in body["system"]) if isinstance(body.get("system"), list) else body.get("system", "")
    user = body["messages"][0]["content"]
    calls.append({"system": system, "user": user, "model": body["model"]})
    if "수집 키워드 추천 규칙" in system:
        assert "CN8 가격 공개 이후 가격·옵션 여론 파악" in system
        return {"lines": ["CN8|아반떼 가격|가격표", "아반떼 옵션 유료"], "exclude": ["렌트"], "note": "차종과 가격 표현을 묶었습니다."}
    if "게시물 관련성 판독" in system:
        posts = re.findall(r'<post id="(\d+)">\n.*?\n.*?\n제목: (.*?)\n', user)
        res = [{"id": i, "relevant": "무관" not in t and "타이어" not in t, "reason": "테스트"} for i, t in posts]
        return {"results": res}
    if "댓글 성향 분석" in system:
        rows = re.findall(r"^(\d+)\t(?:└답글 )?(.*)$", user, re.M)
        return {"results": [{"id": i, "s": senti_of(t)} for i, t in rows]}
    if "보고서 작성 규칙" in system:
        ids = {}
        for sec in re.split(r"\n## ", user)[1:]:
            name = sec.split(" ")[0]
            ids[name] = re.findall(r"^(c\d+)\t", sec, re.M)
        return {
            "title": "CN8 가격 공개 관련 여론 동향",
            "summary": ["테스트 요약 첫째 문장 확인 中", "테스트 요약 둘째 문장 다수 확인"],
            "quotes_short": {k: ids.get(k, [])[:2] for k in ["긍정", "중립", "부정", "단순비난"]},
            "quotes_long": {k: ids.get(k, []) for k in ["긍정", "중립", "부정", "단순비난"]},
        }
    return {}


def test_issue_report(tmp_path: Path):
    claude_calls = []
    downloads = {}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}", "--no-proxy-server"],
            accept_downloads=True,
        )

        def naver(route):
            url = route.request.url
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
            elif "/youtubei/v1/next" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(YT_NEXT))
            elif "/watch" in url:
                route.fulfill(status=200, content_type="text/html", body=YT_WATCH)
            else:
                route.fulfill(status=200, content_type="text/html", body=f'<html><meta property="og:title" content="자동차채널"><script>{{"externalId":"{YT_CHANNEL}"}}</script></html>')

        def clien(route):
            url = route.request.url
            body = CLIEN_VIEW if re.search(r"/cm_car/\d+", url) else CLIEN_LIST
            route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)

        def anthropic(route):
            body = json.loads(route.request.post_data)
            out = json.dumps(claude(body, claude_calls), ensure_ascii=False)
            route.fulfill(status=200, headers={"content-type": "text/event-stream", "access-control-allow-origin": "*"}, body=sse(out))

        ctx.route("https://*.naver.com/**", naver)
        ctx.route("https://www.youtube.com/**", youtube)
        ctx.route("https://www.clien.net/**", clien)
        ctx.route("https://api.anthropic.com/**", anthropic)

        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.goto(f"chrome-extension://{ext_id}/app.html")

        def save_download(button):
            with page.expect_download(timeout=60000) as dl:
                page.click(button)
            path = tmp_path / dl.value.suggested_filename
            dl.value.save_as(path)
            return path

        # 설정: API 키
        page.click('nav .tab[data-tab="settings"]')
        page.fill("#apiKey", "sk-ant-test")
        page.click("#saveSettings")
        page.locator("#settingsMsg", has_text="저장").wait_for()

        # 1. 목적·채널·키워드
        page.click('nav .tab[data-tab="setup"]')
        page.fill("#purpose", "CN8 가격 공개 이후 가격·옵션 여론 파악")
        page.fill("#issueName", "CN8 가격 공개")
        page.fill("#rangeFrom", "2026-08-05T07:00")
        page.fill("#rangeTo", "2026-08-06T10:00")
        page.click("#suggestKeywords")
        page.locator("#suggestMsg", has_text="추천 완료").wait_for(timeout=30000)
        assert page.input_value("#keywords") == "CN8|아반떼 가격|가격표\n아반떼 옵션 유료\n-렌트"
        page.fill("#keywords", "CN8|아반떼 가격\n-렌트")
        assert '"CN8 가격"' in page.inner_text("#queryPreview") and '"아반떼 가격"' in page.inner_text("#queryPreview")
        page.uncheck("#chCafe")
        page.fill("#newsUrls", "https://n.news.naver.com/mnews/article/001/0000000001")
        # 기본 유튜브 채널 48개가 모두 선택된 채로 나온다 → 테스트는 가짜 채널 하나만
        assert page.locator("#ytList input:checked").count() == 48
        assert page.locator("#ytList label", has_text="모터그래프").count() == 1
        page.click("#ytNone")
        page.fill("#ytAdd", YT_CHANNEL)
        page.click("#ytAddBtn")
        page.locator("#ytList label", has_text="자동차채널").wait_for()
        for cb in page.locator("#commList input").all():
            if "clien" not in cb.get_attribute("value"):
                cb.uncheck()
        page.click("#goCollect")
        page.locator("#tab-posts").wait_for(state="visible")

        # 2. 게시글 수집 + AI 관련성
        page.click("#collectPosts")
        page.locator("#postsSummary", has_text="관련 게시글").wait_for(timeout=120000)
        summary = page.inner_text("#postsSummary")
        # 언론 3(댓글 있는 기사·댓글 없는 기사·언론사 자체 사이트 기사 모두) + 유튜브 1(기간 밖 영상 제외) + 클리앙 1(무관 1·키워드 없음 1·기간 밖 1 제외)
        assert "관련 게시글 5건" in summary, summary
        posts_xlsx = save_download("#dlPosts")
        wb = load_workbook(posts_xlsx)
        assert wb.sheetnames == ["언론", "유튜브", "커뮤니티"]
        assert [c.value for c in wb["언론"][1]] == ["No", "출처", "제목", "작성시간", "Link"]
        news_rows = {r[4]: r[1] for r in wb["언론"].iter_rows(min_row=2, values_only=True)}
        assert news_rows["https://www.hankyung.com/article/2026080612345"] == "한국경제"
        assert "https://n.news.naver.com/mnews/article/002/0000000002" in news_rows  # 댓글 없는 기사도 목록에
        assert len(news_rows) == 3
        assert wb["언론"]["B2"].value == "연합뉴스"
        assert wb["언론"]["E2"].hyperlink.target == "https://n.news.naver.com/mnews/article/001/0000000001"
        assert wb["커뮤니티"]["C2"].value == "아반떼 가격 진짜 비싸네요"
        assert wb["언론"]["A1"].font.name == "현대산스 Text Medium"

        # 3. 댓글 수집
        page.click("#goComments")
        page.click("#collectComments")
        # 작업 중에는 로딩바가 보이고, 뒤로 가기(마우스 제스처·단축키)를 막는다
        page.locator("#workBar").wait_for(state="visible")
        page.go_back()
        page.keyboard.press("Alt+ArrowLeft")
        page.wait_for_timeout(500)
        assert page.url.endswith("/app.html")
        assert "뒤로·앞으로 가기를 막았습니다" in page.inner_text("#workBarText")
        page.locator("#commentsSummary", has_text="댓글을 모은 글 5/5").wait_for(timeout=120000)
        assert "언론사 자체 사이트 — 네이버 댓글 없음" in page.inner_text("#commentsTable")
        assert "댓글 없음 — 건너뜀" in page.inner_text("#commentsTable")
        page.locator("#workBar").wait_for(state="hidden")
        assert "댓글 7개" in page.inner_text("#commentsSummary")
        raw_xlsx = save_download("#dlComments")
        wb = load_workbook(raw_xlsx)
        assert [c.value for c in wb["언론"][2]][:3] == ["domain", "text", "성향"]
        assert wb["언론"]["A1"].value == "CN8_가격_공개_언론 댓글"
        assert wb["언론"].max_row == 5 and wb["언론"]["C3"].value is None

        # 4. 성향 분석
        page.click("#goSentiment")
        page.click("#runSentiment")
        page.locator("#sentimentSummary", has_text="분석한 댓글 7개").wait_for(timeout=60000)
        senti_xlsx = save_download("#dlSentiment")
        wb = load_workbook(senti_xlsx)
        got = {r[1]: r[2] for ws in wb.worksheets for r in ws.iter_rows(min_row=3, values_only=True)}
        assert got["현기 배짱장사 답이 없네"] == "단순비난"
        assert got["가격이 너무 비싸요 4천은 심했다"] == "부정"
        assert got["디자인 좋네요 기대됩니다"] == "긍정"
        # 목적·이슈명·강조 규칙이 프롬프트에 들어감
        sys_senti = next(c["system"] for c in claude_calls if "댓글 성향 분석" in c["system"])
        assert "CN8 가격 공개 이후 가격·옵션 여론 파악" in sys_senti and "가장 중요한 규칙" in sys_senti
        sys_rel = next(c["system"] for c in claude_calls if "게시물 관련성 판독" in c["system"])
        assert "CN8 가격 공개 이후 가격·옵션 여론 파악" in sys_rel and "가장 중요한 규칙" in sys_rel

        # 5. 보고서
        page.click("#goReport")
        page.click("#writeReport")
        page.locator("#reportMsg", has_text="초안").wait_for(timeout=60000)
        assert page.input_value("#rTitle") == "CN8 가격 공개 관련 여론 동향"
        pptx = save_download("#dlPptx")
        page.click("#saveFinal")
        page.locator("#finalMsg", has_text="최종 DB 저장 완료").wait_for(timeout=60000)

        # 보고서 DB · 백업
        page.click('nav .tab[data-tab="db"]')
        page.locator("#dbTable .badge.final").wait_for()
        backup = save_download("#dbExport")

        # 언론만 다시 수집: 다른 채널의 게시글·댓글·성향 분석은 그대로
        page.click('nav .tab[data-tab="posts"]')
        for c in ["cafe", "youtube", "community"]:
            box = page.locator(f'#runChannels input[value="{c}"]')
            if box.count():
                box.uncheck()
        page.click("#collectPosts")
        page.locator("#postsSummary", has_text="언론 새로 수집").wait_for(timeout=120000)
        page.click('nav .tab[data-tab="comments"]')
        assert "댓글 4개" in page.inner_text("#commentsSummary"), page.inner_text("#commentsSummary")
        page.click('nav .tab[data-tab="sentiment"]')
        assert "분석한 댓글 4개" in page.inner_text("#sentimentSummary")
        ctx.close()

    assert errors == [], errors
    with zipfile.ZipFile(pptx) as z:
        slide1 = z.read("ppt/slides/slide1.xml").decode()
        slide2 = z.read("ppt/slides/slide2.xml").decode()
        chart = z.read("ppt/charts/chart1.xml").decode()
    assert "CN8 가격 공개 관련 여론 동향" in slide1 and "테스트 요약 첫째 문장 확인 中" in slide1
    assert "현대하모니 L" in slide1  # 양식 서체 유지
    assert "현기 배짱장사 답이 없네" in slide2 or "노조 월급 주려고 올렸네 현기" in slide2
    # 전체 7개: 긍정 2(좋네요·기대) / 부정 3 / 단순비난 2
    assert "28.6%" in slide1 and "42.9%" in slide1
    assert "<c:v>0.286</c:v>" in chart
    with zipfile.ZipFile(backup) as z:
        names = z.namelist()
        meta = json.loads(z.read("backup.json"))
    assert len(meta["jobs"]) == 1 and meta["jobs"][0]["final"]
    assert sorted(f["kind"] for f in meta["files"]) == ["comments", "posts", "pptx", "sentiment"]
    assert all(f["path"] in names for f in meta["files"])


# ---------------------------------------------------------------- 카페: 바로 열면 안 보이는 글 → 네이버 검색 경유
def cafe_full_article():
    return (
        '<html><head><title>아반떼 클럽 : 네이버 카페</title></head><body>'
        '<h3 class="title_text">아반떼 가격 너무 비싸요</h3><div class="article_info"><span class="date">2026.08.06. 09:00</span></div>'
        '<div class="se-main-container">가격이 너무 올랐네요</div>'
        '<div class="CommentBox"><ul>'
        '<li id="c1" class="CommentItem"><a class="comment_nickname">철수</a><span class="text_comment">진짜 비싸요 심했다</span><span class="comment_info_date">2026.08.06. 09:10</span></li>'
        '<li id="c2" class="CommentItem CommentItem--reply"><a class="comment_nickname">영희</a><span class="text_comment">현기 배짱장사</span><span class="comment_info_date">2026.08.06. 09:20</span></li>'
        "</ul></div></body></html>"
    )


def start_fake_naver(tmp_path: Path):
    import ssl
    import subprocess
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=cafe.naver.com",
                    "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = self.headers.get("Host", "")
            requests.append(host + self.path)
            if host.startswith("search.naver.com"):
                body = '<html><body><ul><li><a href="https://cafe.naver.com/avantemd/555?art=SEARCHKEY">아반떼 가격 너무 비싸요</a></li></ul></body></html>'
            elif self.path.startswith("/avantemd/555?art=SEARCHKEY"):
                body = cafe_full_article()
            elif self.path.startswith("/f-e/cafes/123/menus/0"):
                page = parse_qs(urlparse(self.path).query).get("page", ["1"])[0]
                body = (
                    '<html><head><title>아반떼 클럽 : 네이버 카페</title></head><body><table>'
                    '<tr><td><a class="article" href="https://cafe.naver.com/avantemd/555">아반떼 가격 너무 비싸요</a></td><td class="td_date">2026.08.06. 09:00</td></tr>'
                    "</table></body></html>"
                ) if page == "1" else "<html><body>검색 결과가 없습니다</body></html>"
            elif self.path.startswith("/f-e/cafes/123/articles/555") or self.path.startswith("/avantemd/555"):
                # 바로 열면 제목만 보이고 본문·댓글은 안 보임 (등급 제한)
                body = '<html><body><h3 class="title_text">아반떼 가격 너무 비싸요</h3><p>등급이 되어야 읽을 수 있습니다</p></body></html>'
            elif self.path.startswith("/avantemd"):
                body = '<html><script>var g_sClubId = "123";</script><body>카페 홈</body></html>'
            else:
                body = "<html><body></body></html>"
            data = body.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    server.requests = requests
    return server


def test_cafe_via_search(tmp_path: Path):
    server = start_fake_naver(tmp_path)
    port = server.server_address[1]
    claude_calls = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            timezone_id="Asia/Seoul",
            args=[
                f"--disable-extensions-except={EXT_DIR}",
                f"--load-extension={EXT_DIR}",
                f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{port}, MAP search.naver.com 127.0.0.1:{port}",
                "--no-proxy-server",
                "--ignore-certificate-errors",
            ],
            accept_downloads=True,
        )

        def anthropic(route):
            body = json.loads(route.request.post_data)
            out = json.dumps(claude(body, claude_calls), ensure_ascii=False)
            route.fulfill(status=200, headers={"content-type": "text/event-stream", "access-control-allow-origin": "*"}, body=sse(out))

        ctx.route("https://api.anthropic.com/**", anthropic)
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.goto(f"chrome-extension://{ext_id}/app.html")
        page.click('nav .tab[data-tab="settings"]')
        page.fill("#apiKey", "sk-ant-test")
        page.click("#saveSettings")
        page.locator("#settingsMsg", has_text="저장").wait_for()
        page.click('nav .tab[data-tab="setup"]')
        page.fill("#purpose", "CN8 가격 공개 이후 가격·옵션 여론 파악")
        page.fill("#issueName", "CN8 가격 공개")
        page.fill("#rangeFrom", "2026-08-05T07:00")
        page.fill("#rangeTo", "2026-08-06T10:00")
        page.fill("#keywords", "아반떼 가격")
        for cb in ["#chNews", "#chYoutube", "#chCommunity"]:
            page.uncheck(cb)
        # 찾기 칸이 비어 있어도 동호회 목록이 보이고 '전체 선택'이 된다
        page.click("#cafeAll")
        assert page.locator("#cafeList input:checked").count() == page.locator("#cafeList input").count() > 40
        page.click("#cafeNone")
        page.fill("#cafeFilter", "아반떼 클럽")
        page.click("#cafeAll")
        page.fill("#cafeFilter", "")
        page.dispatch_event("#cafeFilter", "input")
        assert page.locator("#cafeList input:checked").count() == 1
        assert page.is_checked('#cafeList input[value="avantemd"]')
        page.click("#goCollect")
        page.click("#collectPosts")
        page.locator("#postsSummary", has_text="관련 게시글 1건").wait_for(timeout=180000)
        page.click("#goComments")
        page.click("#collectComments")
        page.locator("#commentsSummary", has_text="댓글을 모은 글 1/1").wait_for(timeout=180000)
        assert "댓글 2개" in page.inner_text("#commentsSummary")
        log = page.text_content("#commentsLog")
        ctx.close()
    server.shutdown()
    assert errors == [], errors
    assert "네이버 검색을 거쳐 읽음" in log, log
    assert any(r.startswith("search.naver.com") for r in server.requests), server.requests
    assert any("art=SEARCHKEY" in r for r in server.requests)
