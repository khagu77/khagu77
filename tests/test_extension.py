"""크롬 확장프로그램 통합 테스트.

실제 네이버/유튜브 대신 가짜 응답(route)을 넣고, 확장 화면에서 수집 → 엑셀 다운로드까지 확인한다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import ssl
import subprocess
import threading
from datetime import date, datetime
from zoneinfo import ZoneInfo
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



def seoul_today() -> date:
    """브라우저를 Asia/Seoul 로 띄우므로 파일 이름 날짜도 서울 기준."""
    return datetime.now(ZoneInfo("Asia/Seoul")).date()

def cafe_html(canonical, extra=""):
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
        (f'<html><head><meta property="og:url" content="{canonical}"></head><body>' if canonical else "<html><body>")
        + extra + '<h3 class="title_text">카페 글 제목</h3>'
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
    # 사용자 파일처럼: '채널' 칸의 셀 글꼴은 Helvetica Neue 인데 '동호회' 글자에만 현대산스 글꼴을 직접 줌
    from openpyxl.cell.rich_text import CellRichText, TextBlock
    from openpyxl.cell.text import InlineFont

    cafe.cell(row=3, column=2).font = Font(name="Helvetica Neue", size=10)
    cafe.cell(row=3, column=2).value = CellRichText(TextBlock(InlineFont(rFont="현대산스 Text Medium", sz=10), "동호회"))
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
            requests.append(self.path)
            if self.headers.get("Host", "").startswith("naver.me"):  # 짧은 주소 → 새 카페 화면 주소로 넘김
                self.send_response(302)
                self.send_header("Location", NAVER_ME[self.path])
                self.end_headers()
                return
            lx3 = lx3_page(self.path)
            if lx3 is not None:
                body = lx3.encode()
            else:
                canonical = "https://cafe.naver.com/testcafe/456" if "/456" in self.path else "https://cafe.naver.com/mycafe/789"
                body = cafe_html(canonical).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    server.requests = requests
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
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
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
    # 기존 파일 없이 시작하면 먼저 묻는다
    assert any("기존 raw data 엑셀 파일을 고르지 않았습니다" in m for m in dialogs) == (template is None), dialogs
    assert naver_api_calls == []  # 네이버 API 는 한 번도 직접 부르지 않는다
    return path, summary, requested_tokens


URLS = [
    "https://cafe.naver.com/ca-fe/cafes/123/articles/456",
    "https://cafe.naver.com/mycafe/789",
    "https://youtu.be/abcdefghijk",
]


def test_blank_output(tmp_path: Path):
    path, summary, tokens = run_extension(tmp_path, URLS)
    assert path.name == f"{seoul_today():%Y%m%d}_raw_data.xlsx"
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
    assert path.name == f"{seoul_today():%Y%m%d}_현대차_raw_data_정리.xlsx"
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
    rich = load_workbook(path, rich_text=True)["동호회"]
    for r in range(4, 8):  # 새 행의 '동호회' 글자도 마지막 행처럼 현대산스 글꼴
        v = rich.cell(row=r, column=2).value
        assert str(v) == "동호회" and v[0].font.rFont == "현대산스 Text Medium", (r, v)
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


# ---------------------------------------------------------------------------
# LX3 팰리세이드 전동 시트 관련: 카페 검색 → 기간·관련 글 추리기 → 엑셀 → 댓글 수집으로 넘기기
# ---------------------------------------------------------------------------

LX3_CAFES = {"111": ("AA 동호회", "aacafe"), "222": ("BB 오너스 - 비비", "bbcafe")}
# 검색 결과 (카페, 페이지) → [(글번호, 제목, 목록 날짜)]
LX3_SEARCH = {
    ("111", 1): [
        ("1001", "팰리세이드 전동시트 끼임 사고 무섭네요", "2026.10.12. 09:30"),
        ("1002", "카시트 추천 부탁드려요", "2026.10.12. 08:00"),
        ("1003", "2열 시트 폴딩 오류", "2026.10.11."),
        ("1004", "시트 리콜 언제 하나요", "2026.10.11."),
        ("1005", "오늘 오후 시트 리콜 글", "2026.10.12. 13:00"),
    ],
    ("111", 2): [("1006", "전동 시트 사망 사고 기사", "2026.10.11. 12:30"), ("1007", "옛날 시트 글", "2026.10.10.")],
    ("111", 3): [("1008", "더 옛날 시트 글", "2026.10.09.")],
    ("222", 1): [("20001", "아이오닉9 전동시트 리콜 공지", "2026.10.11.")],
}
# 게시글 화면의 정확한 작성 시간
LX3_TIMES = {"1003": "2026.10.11. 15:22", "1004": "2026.10.11. 08:00", "20001": "2026.10.11. 18:05", "1001": "2026.10.12. 09:30"}
NAVER_ME = {"/xSBkYEbW": "https://cafe.naver.com/f-e/cafes/111/articles/1001"}


def lx3_page(path):
    """새 카페 화면(f-e) 흉내: 검색 결과는 화면이 뜬 뒤 스크립트로 그린다. 해당 없는 주소면 None."""
    import re
    from urllib.parse import parse_qs, urlparse

    u = urlparse(path)
    m = re.match(r"/f-e/cafes/(\d+)/menus/0$", u.path)
    if m:
        cafe = m.group(1)
        qs = parse_qs(u.query)
        assert qs.get("q") == ["시트"], qs
        page = int(qs.get("page", ["1"])[0])
        name, slug = LX3_CAFES[cafe]
        rows = LX3_SEARCH.get((cafe, page), [])
        if cafe == "222":  # 링크 없이 글번호가 보이는 표 모양(전체글보기 목록)
            html = "".join(f"<tr><td>{aid}</td><td><span class='article_title'>{title}</span></td><td>글쓴이</td><td class='td_date'>{date}</td><td>53</td></tr>"
                           for aid, title, date in rows)
            html = f"<table>{html}</table>" if html else '<p class="empty">검색 결과가 없습니다.</p>'
        elif page == 2:  # <a href> 없이 data-* 로 글을 여는 모양
            html = "".join(f'<div class="article-item" data-article-id="{aid}"><span class="tit">{title}</span><span class="date">{date}</span></div>'
                           for aid, title, date in rows)
        else:
          html = "".join(
            f'<li class="article-item"><a class="article_title" href="/f-e/cafes/{cafe}/articles/{aid}?referrerAllArticles=false">'
            f'<strong>{title}</strong></a> <a class="cmt" href="/f-e/cafes/{cafe}/articles/{aid}?commentFocus=true">[3]</a>'
            f'<div class="item_preview"><a href="/f-e/cafes/{cafe}/articles/{aid}">미리보기 내용 시트 이야기</a></div>'
            f'<span class="nickname">글쓴이</span><span class="date">{date}</span></li>'
            for aid, title, date in rows
          ) or '<p class="empty">검색 결과가 없습니다.</p>'
        home = f'<a class="cafe_name" href="https://cafe.naver.com/{slug}">{name}</a>' if cafe == "111" else ""
        return (
            f"<html><head><title>전체글보기,{name} : 네이버 카페</title></head><body>{home}<ul id='list'><p>검색 결과가 없습니다.</p></ul>"
            # 실제 화면처럼 처음엔 '결과 없음'이 잠깐 보였다가 목록이 늦게 그려진다
            # 새 카페 화면처럼: 보이는 탭에서만(화면 그리기·보이는지 확인이 돌 때만) 목록을 그린다
            "<div id='sentinel'></div><script>window.__visible = [document.visibilityState];"
            "function render(){ requestAnimationFrame(() => { document.getElementById('list').innerHTML = "
            f"{json.dumps(html, ensure_ascii=False)}; }}); }}"
            f"function go(){{ if (document.hidden) return setTimeout(go, 300);"
            " new IntersectionObserver((es, io) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); render(); } })"
            ".observe(document.getElementById('sentinel')); }"
            f"setTimeout(go, {6000 if page == 1 else 400});</script>"
            "</body></html>"
        )
    m = re.match(r"/f-e/cafes/(\d+)/articles/(\d+)$", u.path)
    if m:
        cafe, aid = m.groups()
        name, slug = LX3_CAFES[cafe]
        canonical = f"https://cafe.naver.com/{slug}/{aid}" if cafe == "222" else ""  # 111 은 화면에 영문 주소 단서 없음
        return cafe_html(canonical, f'<div class="article_info"><span class="date">{LX3_TIMES.get(aid, "")}</span></div>')
    return None


def make_buzz_file(path: Path):
    """사용자 '채널별 버즈량 현황' 파일과 같은 구조: 3행 머리글, B~G 열, 이미 있는 글 하나."""
    from datetime import datetime as dt

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "채널별 버즈량 현황"
    for c, h in zip("BCDEFG", ["순번", "채널", "매체명", "게시일", "제목", "URL"]):
        ws[f"{c}3"] = h
        ws[f"{c}3"].font = Font(name="맑은 고딕", bold=True)
    thin = Side(style="thin")
    ws.append([])
    ws["B4"], ws["C4"], ws["D4"], ws["E4"], ws["F4"], ws["G4"] = 1, "언론", "연합뉴스", dt(2026, 3, 14, 7, 59), "기사", "https://n.news.naver.com/x"
    ws["B5"], ws["C5"], ws["D5"], ws["E5"], ws["F5"], ws["G5"] = 2, "동호회", "AA 동호회", dt(2026, 10, 12), "이미 있는 글", "https://cafe.naver.com/aacafe/1001"
    for c in "BCDEFG":
        ws[f"{c}5"].font = Font(name="맑은 고딕", size=11)
        ws[f"{c}5"].border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws["E5"].number_format = "yyyy-mm-dd"
    ws["B5"].alignment = Alignment(horizontal="center")
    ws["G5"].hyperlink = "https://cafe.naver.com/aacafe/1001"
    ws.freeze_panes = "A4"
    wb.save(path)


def test_lx3(tmp_path: Path):
    server = start_fake_cafe(tmp_path)
    port = server.server_address[1]
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            timezone_id="Asia/Seoul",
            args=[
                f"--disable-extensions-except={EXT_DIR}",
                f"--load-extension={EXT_DIR}",
                f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{port}, MAP naver.me 127.0.0.1:{port}",
                "--no-proxy-server",
                "--ignore-certificate-errors",
            ],
            accept_downloads=True,
        )
        naver_api = []
        ctx.route("https://apis.naver.com/**", lambda route: (naver_api.append(route.request.url), route.fulfill(status=500, body="")))
        ctx.route("https://www.youtube.com/**", lambda route: route.fulfill(
            status=200, content_type="application/json" if "/youtubei/" in route.request.url else "text/html",
            body=json.dumps(YT_PAGES.get(json.loads(route.request.post_data or "{}").get("continuation"), {}))
            if "/youtubei/" in route.request.url else YT_HTML))
        # 실제 크롬의 뒤쪽 탭 흉내 (진단 파일로 확인: 탭이 hidden 이면 새 카페 화면은 글 목록을 그리지 않음):
        # 카페 화면은 '보이지 않음' 상태이고 화면 그리기(requestAnimationFrame)·보이는지 확인(IntersectionObserver)이 멈춘다
        ctx.add_init_script("""if (location.hostname === 'cafe.naver.com') {
          Object.defineProperty(Document.prototype, 'hidden', { get: () => true, configurable: true });
          Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden', configurable: true });
          window.requestAnimationFrame = () => 0;
          window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
        }""")
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = f"chrome-extension://{sw.url.split('/')[2]}"
        page = ctx.new_page()
        page.goto(f"{ext}/lx3.html")
        page.on("dialog", lambda d: d.accept())

        # 제목·메뉴, 기본 시간: 전일 오후 12시 ~ 당일 오후 12시
        assert page.inner_text("h1") == "팰리세이드(LX3) 전동 시트 관련 카페·유튜브 게시물 및 댓글 수집기"
        now = datetime.now(ZoneInfo("Asia/Seoul"))
        today_noon = now.replace(hour=12, minute=0, second=0, microsecond=0)
        assert page.input_value("#to") == today_noon.strftime("%Y-%m-%dT12:00")
        assert page.input_value("#from") == (today_noon - __import__("datetime").timedelta(days=1)).strftime("%Y-%m-%dT12:00")
        assert len(page.input_value("#cafeList").split("\n")) == 12 and "16624720" in page.input_value("#cafeList")

        # 유튜브 목록: 기본 23개 · 추가 · 삭제 · 기본으로 되돌리기
        assert page.locator("#ytList li").count() == 23
        assert page.locator("#ytList li a").first.inner_text() == "https://www.youtube.com/watch?v=qCzKGyMaDq4"
        page.evaluate("youtube.length = 0; saveYoutube()")
        page.fill("#ytInput", "https://youtu.be/abcdefghijk https://www.youtube.com/watch?v=zzzzzzzzzzz&t=3 엉뚱한주소")
        page.click("#ytAdd")
        assert page.locator("#ytList li").count() == 2 and page.input_value("#ytInput") == "엉뚱한주소"
        page.locator("#ytList li").nth(1).locator("button").click()
        assert page.locator("#ytList li a").all_inner_texts() == ["https://www.youtube.com/watch?v=abcdefghijk"]
        page.reload()  # 저장됨
        assert page.locator("#ytList li a").all_inner_texts() == ["https://www.youtube.com/watch?v=abcdefghijk"]

        # 테스트용 동호회 두 곳, 기간 2026-10-11 12:00 ~ 2026-10-12 12:00
        page.locator("#settings summary").click()
        page.fill("#cafeList", "https://cafe.naver.com/f-e/cafes/111/menus/0\nhttps://cafe.naver.com/f-e/cafes/222/menus/0")
        page.locator("#cafeList").dispatch_event("change")
        page.fill("#from", "2026-10-11T12:00")
        page.fill("#to", "2026-10-12T12:00")
        page.click("#search")
        page.locator("#summary", has_text="찾은 글").wait_for(timeout=240000)
        summary = page.inner_text("#summary")
        rows = page.locator("#results tbody tr")
        got = [(rows.nth(i).locator("td").nth(1).inner_text(), rows.nth(i).locator("td").nth(2).inner_text(),
                rows.nth(i).locator("td").nth(3).inner_text(), rows.nth(i).locator("td").nth(4).inner_text(),
                rows.nth(i).locator("input").is_checked()) for i in range(rows.count())]
        assert got == [
            ("2026-10-11 12:30", "AA 동호회", "전동 시트 사망 사고 기사", "https://cafe.naver.com/aacafe/1006", True),
            ("2026-10-11 15:22", "AA 동호회", "2열 시트 폴딩 오류", "https://cafe.naver.com/aacafe/1003", True),
            ("2026-10-11 18:05", "BB 오너스 - 비비", "아이오닉9 전동시트 리콜 공지", "https://cafe.naver.com/bbcafe/20001", True),
            ("2026-10-12 08:00", "AA 동호회", "카시트 추천 부탁드려요", "https://cafe.naver.com/aacafe/1002", False),
            ("2026-10-12 09:30", "AA 동호회", "팰리세이드 전동시트 끼임 사고 무섭네요", "https://cafe.naver.com/aacafe/1001", True),
        ], (got, summary, page.inner_text("#log"))
        assert "찾은 글 5개 (관련 글로 체크 4개)" in summary, summary
        # 선택 반전: 체크된 글은 해제, 해제된 글은 체크 → 다시 반전하면 원래대로
        checks = lambda: [rows.nth(i).locator("input").is_checked() for i in range(rows.count())]
        before = checks()
        page.click("#selInvert")
        assert checks() == [not c for c in before] and "5개 중 1개 체크" in page.inner_text("#resultCount")
        page.click("#selInvert")
        assert checks() == before
        page.click("#selNone")
        assert checks() == [False] * 5
        page.click("#selInvert")
        assert checks() == [True] * 5
        for i, c in enumerate(before):  # 원래 체크 상태로
            if not c:
                rows.nth(i).locator("input").uncheck()
        assert checks() == before
        # 선택 삭제: 반전으로 관련 없는 글(카시트)만 체크 → 한꺼번에 삭제, 화면을 다시 열어도 그대로
        page.click("#selInvert")
        assert page.inner_text("#selDelete") == "선택 삭제 (1개)"
        page.click("#selDelete")
        assert rows.count() == 4 and "카시트" not in page.inner_text("#results")
        page.reload()
        assert rows.count() == 4 and checks() == [False] * 4
        page.click("#selAll")
        # 동호회 이름·영문 주소가 설정 표에 채워진다
        assert page.locator("#cafeInfo tbody tr").nth(1).locator("td").nth(2).text_content() == "BB 오너스 - 비비"
        assert page.locator("#cafeInfo tbody tr").nth(0).locator("input").input_value() == "aacafe"

        # 새 파일로 받기
        with page.expect_download() as dl:
            page.click("#saveList")
        new_file = tmp_path / ("new_" + dl.value.suggested_filename)
        dl.value.save_as(new_file)
        assert dl.value.suggested_filename == f"{seoul_today():%Y%m%d}_팰리세이드 전동시트 관련 채널별 버즈량 현황.xlsx"

        # 기존 파일에 이어 쓰기: 이미 있는 글(aacafe/1001)은 체크가 풀린다
        buzz = tmp_path / "20261011_팰리세이드 북미 사망사고 관련 채널별 버즈량.xlsx"
        make_buzz_file(buzz)
        page.set_input_files("#listFile", str(buzz))
        page.locator("#listFileInfo", has_text="✔").wait_for()
        assert "이미 파일에 있음" in rows.nth(3).inner_text() and not rows.nth(3).locator("input").is_checked()
        rows.nth(0).locator("button.del").click()  # 필요 없는 글 삭제
        page.locator("#settings summary").click()
        page.fill("#saveFolder", "팰리세이드 모니터링/../일일보고")
        page.locator("#saveFolder").dispatch_event("change")
        assert page.input_value("#saveFolder") == "팰리세이드 모니터링/일일보고"
        # 크롬 다운로드 기능에 넘기는 저장 경로 확인 (Playwright 는 받은 파일 이름을 임의로 바꾸므로)
        page.evaluate("const _dl = chrome.downloads.download.bind(chrome.downloads); chrome.downloads.download = (o) => { window.__dl = o; return _dl(o); }; 0")
        with page.expect_download() as dl:
            page.click("#saveList")
        appended = tmp_path / "appended.xlsx"
        dl.value.save_as(appended)
        assert page.evaluate("window.__dl.filename") == f"팰리세이드 모니터링/일일보고/{seoul_today():%Y%m%d}_팰리세이드 북미 사망사고 관련 채널별 버즈량.xlsx"
        assert "다운로드 / 팰리세이드 모니터링/일일보고 폴더에" in page.inner_text("#saveInfo")

        # 체크한 글 + 유튜브 목록 → 댓글 수집 화면
        page.click("#toComments")
        page.wait_for_url("**/app.html")
        assert "카페 글 2개, 유튜브 영상 1개" in page.inner_text("#handoff")
        assert page.input_value("#urls").split("\n") == [
            "https://cafe.naver.com/aacafe/1003", "https://cafe.naver.com/bbcafe/20001", "https://www.youtube.com/watch?v=abcdefghijk"]

        # naver.me 짧은 주소도 엑셀에는 https://cafe.naver.com/카페주소/글번호 로
        page.fill("#urls", "https://naver.me/xSBkYEbW")
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        raw = tmp_path / dl.value.suggested_filename
        dl.value.save_as(raw)
        assert page.locator("nav.menu a.on").inner_text() == "댓글 수집"
        ctx.close()
    server.shutdown()
    assert naver_api == []
    assert not any("page=4" in r for r in server.requests), server.requests  # 모두 기간 이전인 3페이지에서 멈춤

    # 엑셀 '복구' 경고가 나지 않게: 틀 고정(3행) 아래에서 화면이 시작해야 한다
    import re
    import zipfile
    for f in (new_file, appended):
        view = re.search(r"<sheetView\b.*?</sheetView>", zipfile.ZipFile(f).read("xl/worksheets/sheet1.xml").decode()).group(0)
        split = int(float(re.search(r'ySplit="([\d.]+)"', view).group(1)))
        assert int(re.search(r'topLeftCell="[A-Z]+(\d+)"', view).group(1)) > split, view
        assert int(re.search(r'activeCell="[A-Z]+(\d+)"', view).group(1)) > split, view

    ws = load_workbook(new_file)["채널별 버즈량 현황"]
    data = [[c.value for c in r[1:7]] for r in ws.iter_rows(min_row=4)]
    assert [d[0] for d in data] == [1, 2, 3, 4]
    assert [d[1] for d in data] == ["동호회"] * 4
    assert [d[2] for d in data] == ["AA 동호회", "AA 동호회", "BB 오너스 - 비비", "AA 동호회"]
    assert data[1][3] == datetime(2026, 10, 11, 15, 22)
    assert [d[5] for d in data] == ["https://cafe.naver.com/aacafe/1006", "https://cafe.naver.com/aacafe/1003",
                                     "https://cafe.naver.com/bbcafe/20001", "https://cafe.naver.com/aacafe/1001"]
    assert ws["G5"].hyperlink.target == "https://cafe.naver.com/aacafe/1003"
    assert ws["B3"].value == "순번" and ws["B4"].border.left.style == "thin" and ws["E4"].number_format == "mm-dd-yy"

    ws = load_workbook(appended)["채널별 버즈량 현황"]
    data = [[c.value for c in r[1:7]] for r in ws.iter_rows(min_row=4)]
    assert [d[0] for d in data] == [1, 2, 3, 4]
    assert [d[5] for d in data[2:]] == ["https://cafe.naver.com/aacafe/1003", "https://cafe.naver.com/bbcafe/20001"]
    assert ws["G5"].hyperlink.target == "https://cafe.naver.com/aacafe/1001"  # 기존 링크 유지
    assert ws["G7"].hyperlink.target == "https://cafe.naver.com/bbcafe/20001"
    assert ws["B7"].border.left.style == "thin" and ws["E7"].number_format == "yyyy-mm-dd"  # 마지막 동호회 행 서식

    cafe = list(load_workbook(raw)["동호회"].values)
    assert cafe[1][4] == "https://cafe.naver.com/aacafe/1001", cafe[1]
