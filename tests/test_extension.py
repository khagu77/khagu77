"""크롬 확장프로그램 통합 테스트.

실제 네이버/유튜브 대신 가짜 응답(route)을 넣고, 확장 화면에서 수집 → 엑셀 다운로드까지 확인한다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import ssl
import subprocess
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

EXT_DIR = Path(__file__).resolve().parent.parent / "chrome-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

# 카페 게시글 화면 흉내: 댓글 2페이지, 2페이지 버튼을 누르면 목록이 바뀐다.
CAFE_PAGES = {
    1: [("c10", False, "철수", "첫 댓글", "2023.11.15. 07:13"), ("c11", True, "영희", "답글", "2023.11.15. 07:15")],
    2: [("c12", False, "민수", "둘째 페이지", "2023.11.15. 07:16"), ("c13", False, "", "삭제된 댓글입니다.", "")],
}


def cafe_html(canonical):
    pages = {
        n: "".join(
            f'<li id="{cid}" class="CommentItem{" CommentItem--reply" if reply else ""}">'
            f'<a class="comment_nickname">{nick}</a><span class="text_comment">{text}</span>'
            f'<span class="comment_info_date">{date}</span>'
            + ('<p class="comment_deleted"></p>' if not nick else "")
            + "</li>"
            for cid, reply, nick, text, date in items
        )
        for n, items in CAFE_PAGES.items()
    }
    return (
        f'<html><head><meta property="og:url" content="{canonical}"></head><body>'
        '<h3 class="title_text">카페 글 제목</h3>'
        '<div class="CommentBox"><ul id="list"></ul><div class="ArticlePaginate">'
        '<button aria-pressed="true">1</button><button>2</button></div></div>'
        f"<script>const pages = {json.dumps(pages, ensure_ascii=False)};"
        "const btns = document.querySelectorAll('.ArticlePaginate button');"
        "function show(n){ setTimeout(() => { document.getElementById('list').innerHTML = pages[n];"
        " btns.forEach(b => b.setAttribute('aria-pressed', b.textContent == n)); }, 300); }"
        "btns.forEach(b => b.addEventListener('click', () => show(b.textContent)));"
        "document.getElementById('list').innerHTML = pages[1];</script></body></html>"
    )


def yt_payload(cid, name, text, likes="3", replies="0"):
    return {"payload": {"commentEntityPayload": {
        "properties": {"commentId": cid, "content": {"content": text}, "publishedTime": "1일 전"},
        "author": {"displayName": name, "channelId": "UC_" + name},
        "toolbar": {"likeCountNotliked": likes, "replyCount": replies},
    }}}


YT_HTML = (
    '<html><script>ytcfg.set({"INNERTUBE_API_KEY":"KEY","INNERTUBE_CLIENT_VERSION":"2.0"});</script>'
    '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"테스트 영상 {괄호}","author":"채널A"}};</script>'
    '<script>var ytInitialData = ' + json.dumps({"contents": {"twoColumnWatchNextResults": {"results": {"results": {"contents": [
        {"itemSectionRenderer": {"sectionIdentifier": "comment-item-section", "contents": [
            {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "TOP1"}}}}]}}]}}}}})
    + ';</script></html>'
)

YT_PAGES = {
    "TOP1": {
        "onResponseReceivedEndpoints": [{"reloadContinuationItemsCommand": {"continuationItems": [
            {"commentsHeaderRenderer": {"sortMenu": {"sortFilterSubMenuRenderer": {"subMenuItems": [
                {"serviceEndpoint": {"continuationCommand": {"token": "SORT_NEW"}}}]}}}},
            {"commentThreadRenderer": {"commentViewModel": {}, "replies": {"commentRepliesRenderer": {"contents": [
                {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "REP_A"}}}}]}}}},
            {"commentThreadRenderer": {"commentViewModel": {}}},
            {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "TOP2"}}}},
        ]}}],
        "frameworkUpdates": {"entityBatchUpdate": {"mutations": [
            yt_payload("A", "앨리스", "좋아요", replies="1"), yt_payload("B", "밥", "멋져요")]}},
    },
    "REP_A": {"frameworkUpdates": {"entityBatchUpdate": {"mutations": [yt_payload("A.r1", "찰리", "답글이에요")]}}},
    "TOP2": {"frameworkUpdates": {"entityBatchUpdate": {"mutations": [yt_payload("C", "데이브", "마지막", likes="1.2천")]}}},
}


def make_template(path: Path):
    """사용자 raw data 파일과 같은 구조의 가짜 양식."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font

    wb = Workbook()
    wb.remove(wb.active)
    headers = ["연번", "채널", "작성일", "댓글", "url"]
    press = wb.create_sheet("언론")
    press.append(headers)
    press.append([1, "언론", "2026.03.14. 06:48", "언론 댓글", "https://n.news.naver.com/a"])
    cafe = wb.create_sheet("동호회")
    cafe.append(headers)
    cafe.append([1, "동호회", "2026.03.14. 10:42", "예전 댓글", "https://cafe.naver.com/old/1"])
    cafe.append([2, "동호회", "2023.11.15. 07:13", "첫 댓글", "https://cafe.naver.com/mycafe/789"])  # 중복
    cafe.cell(row=2, column=5).hyperlink = "https://cafe.naver.com/old/1"
    for c in range(1, 6):
        cafe.cell(row=3, column=c).font = Font(name="맑은 고딕", size=10)
    cafe.cell(row=3, column=4).alignment = Alignment(wrap_text=True)
    cafe.row_dimensions[3].height = 20
    cafe.freeze_panes = "A2"
    yt = wb.create_sheet("유튜브")
    yt.append(headers)
    yt.append([1, "유튜브", "6개월 전", "남겨둘 영상 댓글", "https://www.youtube.com/watch?v=keepkeepkee"])
    yt.append([2, "유튜브", "6개월 전", "다시 수집될 영상의 옛 댓글", "https://www.youtube.com/watch?v=abcdefghijk"])
    yt.append([3, "유튜브", "1년 전", "오늘 목록에 없는 영상", "https://www.youtube.com/watch?v=goneoldvid1"])
    car = wb.create_sheet("자동차 커뮤니티")
    car.append(headers)
    car.append([1, "뽐뿌", "2026.03.14", "커뮤니티 댓글", "https://www.ppomppu.co.kr/x"])
    wb.save(path)


def start_fake_cafe(tmp_path: Path):
    """확장이 새 탭으로 여는 카페 글은 Playwright route 로 가로챌 수 없어서,
    cafe.naver.com 을 로컬 HTTPS 서버로 돌려 가짜 게시글 화면을 보여준다."""
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=cafe.naver.com",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            canonical = "https://cafe.naver.com/testcafe/456" if "/456" in self.path else "https://cafe.naver.com/mycafe/789"
            body = cafe_html(canonical).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_extension(tmp_path: Path, urls, template=None, fail_video=None):
    requested_tokens = []
    server = start_fake_cafe(tmp_path)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            timezone_id="Asia/Seoul",
            args=[
                f"--disable-extensions-except={EXT_DIR}",
                f"--load-extension={EXT_DIR}",
                f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{server.server_address[1]}",
                "--no-proxy-server",
                "--ignore-certificate-errors",
            ],
            accept_downloads=True,
        )

        naver_api_calls = []

        def naver_api(route):
            naver_api_calls.append(route.request.url)
            route.fulfill(status=500, body="")

        def youtube(route):
            if "/youtubei/v1/next" in route.request.url:
                token = json.loads(route.request.post_data)["continuation"]
                requested_tokens.append(token)
                route.fulfill(status=200, content_type="application/json", body=json.dumps(YT_PAGES.get(token, {})))
            elif fail_video and fail_video in route.request.url:
                route.fulfill(status=404, body="")
            else:
                route.fulfill(status=200, content_type="text/html", body=YT_HTML)

        ctx.route("https://apis.naver.com/**", naver_api)
        ctx.route("https://www.youtube.com/**", youtube)

        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        page = ctx.new_page()
        page.goto(f"chrome-extension://{ext_id}/app.html")
        if template:
            page.set_input_files("#templateFile", str(template))
            page.locator("#templateInfo", has_text="✔").wait_for()
        page.fill("#urls", "\n".join(urls))
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        page.locator("#summary", has_text="저장되었습니다").wait_for()
        summary = page.inner_text("#summary")
        ctx.close()
    server.shutdown()
    assert naver_api_calls == []  # 네이버 API 는 한 번도 직접 부르지 않는다
    return path, summary, requested_tokens


URLS = [
    "https://cafe.naver.com/ca-fe/cafes/123/articles/456",
    "https://cafe.naver.com/mycafe/789",
    "https://youtu.be/abcdefghijk",
]


def test_blank_output(tmp_path: Path):
    path, summary, tokens = run_extension(tmp_path, URLS)
    assert path.name == f"{date.today():%Y%m%d}_raw_data.xlsx"
    assert "SORT_NEW" not in tokens
    wb = load_workbook(path)
    assert wb.sheetnames == ["언론", "동호회", "유튜브", "자동차 커뮤니티"]
    assert list(wb["언론"].values) == [("연번", "채널", "작성일", "댓글", "url")]

    cafe = list(wb["동호회"].values)
    assert cafe[1] == (1, "동호회", "2023.11.15. 07:13", "첫 댓글", "https://cafe.naver.com/testcafe/456")
    assert [r[0] for r in cafe[1:]] == [1, 2, 3, 4, 5, 6]
    assert cafe[4][4] == "https://cafe.naver.com/mycafe/789"

    yt = list(wb["유튜브"].values)
    assert [r[3] for r in yt[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막"]
    assert yt[1] == (1, "유튜브", "1일 전", "좋아요", "https://www.youtube.com/watch?v=abcdefghijk")


def test_continue_template(tmp_path: Path):
    tpl = tmp_path / "20261008_현대차_raw_data_정리.xlsx"
    make_template(tpl)
    urls = URLS + ["https://www.youtube.com/watch?v=keepkeepkee"]
    path, summary, _ = run_extension(tmp_path, urls, template=tpl, fail_video="keepkeepkee")
    assert path.name == f"{date.today():%Y%m%d}_현대차_raw_data_정리.xlsx"
    assert "동호회 5개 추가(연번 3~7)" in summary and "이미 있던 댓글 1개 제외" in summary
    assert "삭제된 댓글" not in str(list(load_workbook(path)["동호회"].values))

    wb = load_workbook(path)
    assert wb.sheetnames == ["언론", "동호회", "유튜브", "자동차 커뮤니티"]
    assert list(wb["언론"].values)[1] == (1, "언론", "2026.03.14. 06:48", "언론 댓글", "https://n.news.naver.com/a")
    assert list(wb["자동차 커뮤니티"].values)[1][3] == "커뮤니티 댓글"

    cafe_ws = wb["동호회"]
    cafe = list(cafe_ws.values)
    assert [r[0] for r in cafe[1:]] == [1, 2, 3, 4, 5, 6, 7]
    assert cafe[3] == (3, "동호회", "2023.11.15. 07:13", "첫 댓글", "https://cafe.naver.com/testcafe/456")
    # mycafe/789 의 '첫 댓글'은 파일에 이미 있으므로 다시 넣지 않음
    assert [(r[3], r[4]) for r in cafe[6:]] == [
        ("답글", "https://cafe.naver.com/mycafe/789"), ("둘째 페이지", "https://cafe.naver.com/mycafe/789")]
    assert cafe_ws.cell(row=4, column=1).font.name == "맑은 고딕"  # 마지막 행 서식 따라감
    assert cafe_ws.cell(row=4, column=4).alignment.wrap_text
    assert cafe_ws.row_dimensions[4].height == 20
    assert cafe_ws.cell(row=2, column=5).hyperlink.target == "https://cafe.naver.com/old/1"
    assert cafe_ws.freeze_panes == "A2"

    yt = list(wb["유튜브"].values)
    # 오늘 입력한 영상만 남는다: 수집한 영상은 새 댓글, 수집 실패한 영상(keepkeepkee)은 기존 행 유지,
    # 오늘 목록에 없는 영상(goneoldvid1)은 빠진다.
    assert [r[3] for r in yt[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막", "남겨둘 영상 댓글"]
    assert [r[0] for r in yt[1:]] == [1, 2, 3, 4, 5]
    assert "수집 실패한 유튜브 영상 1개는 기존 댓글 유지" in summary
