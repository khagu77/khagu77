"""크롬 확장프로그램 통합 테스트.

실제 네이버/유튜브 대신 가짜 응답(route)을 넣고, 확장 화면에서 수집 → 엑셀 다운로드까지 확인한다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import re
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
    assert any("기존 raw data 엑셀 파일을 고르지 않았고" in m for m in dialogs) == (template is None), dialogs
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
        ("1010", "카시트 질문", "2026.10.11."),  # 관련 없는 글(체크 해제)이지만 날짜만 보여 열어서 확인 → 오전 글이라 뺌
    ],
    ("111", 2): [("1006", "전동 시트 사망 사고 기사", "2026.10.11. 12:30"), ("1007", "옛날 시트 글", "2026.10.10.")],
    ("111", 3): [("1008", "더 옛날 시트 글", "2026.10.09.")],
    ("222", 1): [("20001", "아이오닉9 전동시트 리콜 공지", "2026.10.11.")],
}
# 게시글 화면의 정확한 작성 시간
LX3_TIMES = {"1010": "2026.10.11. 10:00", "1003": "2026.10.11. 15:22", "1004": "2026.10.11. 08:00", "20001": "2026.10.11. 18:05", "1001": "2026.10.12. 09:30"}
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
    ws["B5"], ws["C5"], ws["D5"], ws["E5"], ws["F5"], ws["G5"] = 2, "동호회", "AA 동호회", dt(2026, 10, 12), "이미 있는 글", "https://cafe.naver.com/f-e/cafes/111/articles/1001"
    for c in "BCDEFG":
        ws[f"{c}5"].font = Font(name="맑은 고딕", size=11)
        ws[f"{c}5"].border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws["E5"].number_format = "yyyy-mm-dd"
    ws["B5"].alignment = Alignment(horizontal="center")
    ws["G5"].hyperlink = "https://cafe.naver.com/f-e/cafes/111/articles/1001"
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
        # 시작: 직전 근무일 오후 12시 (주말·공휴일·대체공휴일 건너뜀)
        cases = {  # 오늘 → 시작
            "2026-10-14": "2026-10-13",  # 평일: 전날
            "2026-10-19": "2026-10-16",  # 월요일: 금요일
            "2026-10-06": "2026-10-02",  # 개천절(토)·일·대체공휴일(월) 다음 날: 금요일
            "2026-09-28": "2026-09-23",  # 추석 연휴(목~토)·일요일 다음 날: 연휴 전 수요일
            "2027-02-09": "2027-02-04",  # 설 연휴(금~일)·대체공휴일(월) 다음 날: 목요일
        }
        for today, start in cases.items():
            got = page.evaluate("(d) => { const r = defaultRange(new Date(d + 'T09:00')); return [ymd(r.from), r.from.getHours(), ymd(r.to), r.to.getHours()]; }", today)
            assert got == [start, 12, today, 12], (today, got)
        page.evaluate("document.getElementById('holidays').value = '2026-10-13'")  # 추가 휴일(회사 휴무)
        assert page.evaluate("ymd(defaultRange(new Date('2026-10-14T09:00')).from)") == "2026-10-12"
        page.evaluate("document.getElementById('holidays').value = ''")
        assert page.input_value("#from") == page.evaluate("toLocalInput(defaultRange().from)")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.fill("#from", "2026-01-01T09:00")
        page.click("#resetRange")  # '기본 시간으로' 버튼 (클릭 정보가 시각 자리에 넘어가 오류 나던 문제)
        assert page.input_value("#from") == page.evaluate("toLocalInput(defaultRange().from)") and not errors, errors
        assert "기본 시간:" in page.inner_text("#rangeInfo")
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
        # 언론·커뮤니티는 기본으로 켜져 있음 → 이 테스트는 동호회만 (언론·커뮤니티는 test_lx3_news_community)
        assert page.is_checked("#chCafe") and page.is_checked("#chNews") and page.is_checked("#chCommunity")
        page.uncheck("#chNews")
        page.uncheck("#chCommunity")
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
        for _ in range(50):  # 지운 결과가 저장될 때까지
            if page.evaluate("chrome.storage.local.get('lx3Last').then((x) => x.lx3Last.items.length)") == 4:
                break
            page.wait_for_timeout(100)
        page.reload()
        rows.nth(3).wait_for()
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
        assert page.evaluate("window.__dl.url.slice(0, 5)") == "data:"  # blob: 이 아니어야 맥 파일 정보 '출처'가 남지 않음
        assert page.evaluate("window.__dl.filename") == f"팰리세이드 모니터링/일일보고/{seoul_today():%Y%m%d}_팰리세이드 북미 사망사고 관련 채널별 버즈량.xlsx"
        page.locator("#saveInfo", has_text="다운로드 / 팰리세이드 모니터링/일일보고 폴더에").wait_for()

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
        assert "댓글 수집" in page.locator("nav.menu a.on").inner_text()
        ctx.close()
    server.shutdown()
    assert naver_api == []
    assert not any("page=4" in r for r in server.requests), server.requests  # 모두 기간 이전인 3페이지에서 멈춤
    assert any(r.startswith("/f-e/cafes/111/articles/1010") for r in server.requests)  # 체크 해제된 글도 시간 확인

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
    assert data[1][3] == datetime(2026, 10, 11)  # 엑셀 게시일은 날짜만 (작성 시간은 결과 표에)
    assert [d[5] for d in data] == ["https://cafe.naver.com/aacafe/1006", "https://cafe.naver.com/aacafe/1003",
                                     "https://cafe.naver.com/bbcafe/20001", "https://cafe.naver.com/aacafe/1001"]
    assert ws["G5"].hyperlink.target == "https://cafe.naver.com/aacafe/1003"
    assert ws["B3"].value == "순번" and ws["B4"].border.left.style == "thin" and ws["E4"].number_format == "mm-dd-yy"

    ws = load_workbook(appended)["채널별 버즈량 현황"]
    data = [[c.value for c in r[1:7]] for r in ws.iter_rows(min_row=4)]
    assert [d[0] for d in data] == [1, 2, 3, 4]
    assert [d[5] for d in data[2:]] == ["https://cafe.naver.com/aacafe/1003", "https://cafe.naver.com/bbcafe/20001"]
    assert ws["G5"].hyperlink.target == "https://cafe.naver.com/f-e/cafes/111/articles/1001"  # 기존 링크 유지
    assert ws["G7"].hyperlink.target == "https://cafe.naver.com/bbcafe/20001"
    assert ws["B7"].border.left.style == "thin" and ws["E7"].number_format == "yyyy-mm-dd"  # 마지막 동호회 행 서식

    cafe = list(load_workbook(raw)["동호회"].values)
    assert cafe[1][4] == "https://cafe.naver.com/aacafe/1001", cafe[1]


def sheet_view(path, sheet_xml="xl/worksheets/sheet1.xml"):
    import re
    import zipfile
    xml = zipfile.ZipFile(path).read(sheet_xml).decode()
    view = (re.search(r"<sheetView\b[^>]*[^/]>.*?</sheetView>", xml, re.S) or re.search(r"<sheetView\b[^>]*/>", xml)).group(0)
    top = re.search(r'topLeftCell="([A-Z]+\d+)"', view)
    act = re.search(r'activeCell="([A-Z]+\d+)"', view)
    return (top.group(1) if top else None), (act.group(1) if act else None)


def test_final_db(tmp_path: Path):
    """최종 DB: 등록한 최종 파일에 파일 선택 없이 이어 쓰고(결과는 오늘 파일로 DB 저장), 같은 날 다시 받으면 오늘 파일에 이어 씀.
    '별도 파일로 작성'은 새 파일·DB 저장 안 함. 수정본을 올리면 그 파일에 이어 씀. 댓글 수집도 같은 방식.
    받은 엑셀은 커서가 마지막 행 바로 아래에 있다."""
    buzz = tmp_path / "20261011_버즈량.xlsx"
    make_buzz_file(buzz)
    raw = tmp_path / "20261008_raw_data.xlsx"
    make_template(raw)
    today = f"{seoul_today():%Y%m%d}"
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}", "--no-proxy-server"],
            accept_downloads=True)
        ctx.route("https://www.youtube.com/**", lambda route: route.fulfill(
            status=200, content_type="application/json" if "/youtubei/" in route.request.url else "text/html",
            body=json.dumps(YT_PAGES.get(json.loads(route.request.post_data or "{}").get("continuation"), {}))
            if "/youtubei/" in route.request.url else YT_HTML))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = f"chrome-extension://{sw.url.split('/')[2]}"
        page = ctx.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

        def db_upload(kind, button_index, path):
            with page.expect_file_chooser() as fc:
                page.locator(f"section[data-kind={kind}] button", has_text=button_index).first.click() if isinstance(button_index, str) \
                    else page.locator(f"section[data-kind={kind}] tbody tr").nth(button_index).locator("button.up").click()
            fc.value.set_files(str(path))
            page.locator("#dbInfo", has_text="✔").wait_for()

        def db_rows(kind):
            return page.locator(f"section[data-kind={kind}] tbody tr").all_inner_texts()

        # 1) 최종 DB 에 지금까지의 최종 파일 등록 (파일명 앞 날짜로)
        page.goto(f"{ext}/db.html")
        db_upload("buzz", "파일 등록", buzz)
        assert "2026-10-11" in db_rows("buzz")[0] and "최종" in db_rows("buzz")[0] and "마지막 순번 2" in db_rows("buzz")[0]

        def lx3_save(aids):
            page.goto(f"{ext}/lx3.html")
            page.locator("#listFileInfo", has_text="✔").wait_for(state="attached")
            page.evaluate("""(aids) => {
              cafeNames['111'] = 'AA 동호회'; cafeSlugs['111'] = 'aacafe';
              items = aids.map((a, i) => ({ key: '111/' + a, cafeId: '111', cafeIndex: 0, articleId: a, slug: '', title: '시트 리콜 ' + a,
                text: '', date: new Date(2026, 9, 12, 9, i), hasTime: true, ambiguous: false, checked: true, related: true, note: '', dup: false }));
              markDuplicates(); renderResults(); }""", aids)
            with page.expect_download() as dl:
                page.click("#saveList")
            out = tmp_path / f"buzz_{len(list(tmp_path.glob('buzz_*')))}.xlsx"
            dl.value.save_as(out)
            page.locator("#saveInfo", has_text="✔").wait_for()
            return out, dl.value.suggested_filename

        def serials(path):
            ws = load_workbook(path)["채널별 버즈량 현황"]
            return [(r[1].value, r[6].value) for r in ws.iter_rows(min_row=4)]

        # 2) 파일을 고르지 않아도 최종 DB 파일에 이어 씀. 이미 있는 글(1001)은 빠짐
        page.goto(f"{ext}/lx3.html")
        page.locator("#listFileInfo", has_text="최종 DB 파일(2026-10-11").wait_for(state="attached")
        out1, name1 = lx3_save(["1001", "1002"])
        assert name1 == f"{today}_버즈량.xlsx"
        assert serials(out1)[-1] == (3, "https://cafe.naver.com/aacafe/1002") and len(serials(out1)) == 3
        assert sheet_view(out1) == ("A4", "A7")  # 커서: 마지막 행(6) 바로 아래, 화면은 위 행들이 보이게
        assert not any("첨부하지 않았고" in m for m in dialogs)
        # 3) 같은 날 다시 받으면 방금 저장한 오늘 파일에 이어 씀
        out2, _ = lx3_save(["1003"])
        assert serials(out2)[-1] == (4, "https://cafe.naver.com/aacafe/1003")
        assert page.inner_text("#diffs") == "오늘 게시물 2건 (전일 대비 전일 기록 없음)"  # 같은 날 1건 + 1건
        page.goto(f"{ext}/db.html")
        rows = db_rows("buzz")
        assert len(rows) == 2 and f"{today[:4]}-{today[4:6]}-{today[6:]}" in rows[0] and "마지막 순번 4" in rows[0], rows
        # 전일(직전 기록일) 5건이었다면 오늘 3건째 저장 후 ▼ 2 건(파란색)
        page.goto(f"{ext}/db.html")
        page.evaluate("""async () => { const r = (await dbList('buzz')).find((x) => x.date === '20261011');
          r.stats = { posts: 5 }; await dbTx('readwrite', (s) => s.put(r)); }""")
        lx3_save(["1005"])
        assert page.inner_text("#diffs") == "오늘 게시물 3건 (10-11 (일) 대비 ▼ 2 건)", page.inner_text("#diffs")
        assert page.locator("#diffs .diff").get_attribute("class") == "diff down"
        page.goto(f"{ext}/db.html")
        assert "게시물 3건 ▼ 2 건" in db_rows("buzz")[0] and "게시물 5건 전일 기록 없음" in db_rows("buzz")[1], db_rows("buzz")
        # 4) 별도 파일로 작성: 새 파일(순번 1부터), 최종 DB 는 그대로
        page.goto(f"{ext}/lx3.html")
        page.evaluate("""() => { cafeNames['111'] = 'AA 동호회'; cafeSlugs['111'] = 'aacafe';
          items = [{ key: '111/1009', cafeId: '111', cafeIndex: 0, articleId: '1009', slug: '', title: '따로', text: '',
            date: new Date(2026, 9, 12, 9, 0), hasTime: true, ambiguous: false, checked: true, related: true, note: '', dup: false }];
          renderResults(); }""")
        page.check("#separate")
        assert "별도 파일로 작성" in page.locator("#listFileInfo").text_content()
        with page.expect_download() as dl:
            page.click("#saveList")
        sep = tmp_path / "separate.xlsx"
        dl.value.save_as(sep)
        assert serials(sep) == [(1, "https://cafe.naver.com/aacafe/1009")]
        page.goto(f"{ext}/db.html")
        assert "마지막 순번 5" in db_rows("buzz")[0]
        # 5) 엑셀에서 고친 수정본을 오늘 날짜에 올리면 그 파일에 이어 씀
        fixed = tmp_path / f"{today}_버즈량_수정.xlsx"
        from openpyxl import load_workbook as _lw
        wb = _lw(out2)
        ws = wb["채널별 버즈량 현황"]
        ws.append([None, 10, "언론", "연합뉴스", None, "직접 넣은 기사", "https://n.news.naver.com/y"])
        wb.save(fixed)
        db_upload("buzz", 0, fixed)
        assert "직접 올림" in db_rows("buzz")[0] and "마지막 순번 10" in db_rows("buzz")[0]
        assert "게시물 3건" in db_rows("buzz")[0]  # 수정본을 올려도 그날 수집 건수는 그대로
        out3, _ = lx3_save(["1004"])
        assert serials(out3)[-2:] == [(10, "https://n.news.naver.com/y"), (11, "https://cafe.naver.com/aacafe/1004")]

        # 6) 댓글 수집도 최종 DB 의 raw data 에 이어 씀
        page.goto(f"{ext}/db.html")
        db_upload("raw", "파일 등록", raw)
        page.evaluate("""async () => { const r = (await dbList('raw')).find((x) => x.date === '20261008');
          r.stats = { comments: 10, youtube: 2 }; await dbTx('readwrite', (s) => s.put(r)); }""")
        page.goto(f"{ext}/app.html")
        page.locator("#templateInfo", has_text="최종 DB 파일(2026-10-08").wait_for()
        page.fill("#urls", "https://youtu.be/abcdefghijk")
        with page.expect_download(timeout=60000) as dl:
            page.click("#start")
        rawout = tmp_path / "rawout.xlsx"
        dl.value.save_as(rawout)
        assert dl.value.suggested_filename == f"{today}_raw_data.xlsx"
        page.locator("#summary", has_text="최종 DB에 오늘 파일로 저장").wait_for()
        assert page.inner_text("#diffs").split("\n") == ["오늘 카페 댓글 0건 (10-08 (목) 대비 ▼ 10 건)", "유튜브 댓글 4건 (10-08 (목) 대비 ▲ 2 건)"] or \
            page.inner_text("#diffs") == "오늘 카페 댓글 0건 (10-08 (목) 대비 ▼ 10 건)유튜브 댓글 4건 (10-08 (목) 대비 ▲ 2 건)", page.inner_text("#diffs")
        assert page.locator("#diffs .diff.up").inner_text() == "▲ 2 건"
        wb = load_workbook(rawout)
        assert list(wb["언론"].values)[1][3] == "언론 댓글"  # 기존 파일에 이어 쓴 것
        assert [r[3] for r in list(wb["유튜브"].values)[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막"]
        page.goto(f"{ext}/db.html")
        assert len(db_rows("raw")) == 2 and "최종" in db_rows("raw")[0]
        ctx.close()
    assert not any("첨부하지 않았고" in m or "고르지 않았고" in m for m in dialogs), dialogs


def test_resume(tmp_path: Path):
    """중단 후 이어하기: 수집·찾기 중 진행 상황이 저장돼 있으면, 화면을 다시 열 때 이어서 할지 묻고
    남은 것부터 계속한다(이미 한 것은 다시 하지 않음)."""
    server = start_fake_cafe(tmp_path)
    port = server.server_address[1]
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}",
                  f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{port}", "--no-proxy-server", "--ignore-certificate-errors"],
            accept_downloads=True)
        yt_down = {"on": False}  # True 면 유튜브 접속 실패 (다시 수집 확인용)
        ctx.route("https://www.youtube.com/**", lambda route: route.fulfill(status=503, body="") if yt_down["on"] else route.fulfill(
            status=200, content_type="application/json" if "/youtubei/" in route.request.url else "text/html",
            body=json.dumps(YT_PAGES.get(json.loads(route.request.post_data or "{}").get("continuation"), {}))
            if "/youtubei/" in route.request.url else YT_HTML))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = f"chrome-extension://{sw.url.split('/')[2]}"
        page = ctx.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

        # 0) 실패한 항목 다시 수집: 실패하면 버튼이 생기고, 누르면 실패한 것만 다시 수집
        page.goto(f"{ext}/app.html")
        page.wait_for_timeout(1000)
        page.check("#separate")
        page.fill("#urls", "https://youtu.be/abcdefghijk")
        yt_down["on"] = True
        with page.expect_download(timeout=60000):
            page.click("#start")
        page.locator("#retryFailed", has_text="실패한 1개 다시 수집").wait_for(timeout=10000)
        yt_down["on"] = False
        with page.expect_download(timeout=60000) as dl:
            page.click("#retryFailed")
        retried = tmp_path / "retried.xlsx"
        dl.value.save_as(retried)
        assert [r[3] for r in list(load_workbook(retried)["유튜브"].values)[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막"]
        assert page.is_hidden("#retryFailed")

        # 1) 댓글 수집: 2개 중 1개(카페 글) 끝난 상태로 중단됨 → 다시 열면 이어서 2번째(유튜브)만 수집
        page.goto(f"{ext}/app.html")
        page.wait_for_timeout(1500)  # 화면이 다 열린 뒤(이어하기 확인이 끝난 뒤)에 저장
        page.evaluate("""() => saveResume('comments', {
          urls: ['https://cafe.naver.com/mycafe/789', 'https://youtu.be/abcdefghijk'], done: 1, separate: true, attached: false,
          results: [{ platform: 'cafe', url: 'https://cafe.naver.com/mycafe/789', sheetUrl: 'https://cafe.naver.com/mycafe/789', cafeId: '', cafeUrl: 'mycafe',
            articleId: '789', title: '', author: '', method: '화면', error: '',
            comments: [{ commentId: 'x', isReply: false, parentId: '', nickname: 'a', content: '중단 전 댓글', writtenAt: '2026.10.19. 10:00', isDeleted: false }] }] })""")
        before = len(server.requests)
        with page.expect_download(timeout=60000) as dl:
            page.reload()
        out = tmp_path / "resumed.xlsx"
        dl.value.save_as(out)
        assert any("중단된 댓글 수집이 있습니다 (2개 중 1개 완료" in m for m in dialogs), dialogs
        assert len(server.requests) == before  # 끝난 카페 글은 다시 열지 않음
        wb = load_workbook(out)
        assert [r[3] for r in list(wb["동호회"].values)[1:]] == ["중단 전 댓글"]
        assert [r[3] for r in list(wb["유튜브"].values)[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막"], page.inner_text("#progress") + page.inner_text("#summary")
        assert page.evaluate("loadResume('comments')") is None  # 끝나면 지움

        # 2) 게시물 찾기: 동호회 2곳 중 1곳 끝난 상태로 중단됨 → 이어서 2번째 동호회만 찾음
        page.goto(f"{ext}/lx3.html")
        page.wait_for_timeout(1500)
        page.evaluate("""() => saveResume('lx3', { from: '2026-10-11T12:00', to: '2026-10-12T12:00', q: '시트', ids: ['111', '222'], nextCafe: 1,
          items: [{ key: '111/1001', cafeId: '111', cafeIndex: 0, articleId: '1001', slug: 'aacafe', title: '중단 전에 찾은 글', text: '',
            date: new Date(2026, 9, 12, 9, 30).getTime(), hasTime: true, ambiguous: false, checked: true, related: true, note: '', dup: false }] })""")
        before = len(server.requests)
        page.reload()
        page.locator("#summary", has_text="찾은 글").wait_for(timeout=120000)
        assert any("중단된 게시물 찾기가 있습니다 (동호회 2곳 중 1곳 완료, 찾은 글 1개" in m for m in dialogs), dialogs
        new = server.requests[before:]
        assert not any("/cafes/111/menus" in r for r in new) and any("/cafes/222/menus" in r for r in new), new
        titles = page.locator("#results tbody tr td:nth-child(4)").all_inner_texts()
        assert titles == ["아이오닉9 전동시트 리콜 공지", "중단 전에 찾은 글"], titles
        assert page.evaluate("loadResume('lx3')") is None
        ctx.close()
    server.shutdown()


# ---------------------------------------------------------------------------
# 언론(네이버 뉴스 검색·댓글 상자) · 자동차 커뮤니티(보배드림·클리앙·뽐뿌) 흉내
# ---------------------------------------------------------------------------

def news_item(press, press_home, date_text, title, ext_url, naver_url=None):
    naver = f'<a class="info" href="{naver_url}">네이버뉴스</a>' if naver_url else ""
    return (
        '<li class="bx"><div class="news_wrap"><div class="news_info"><div class="info_group">'
        f'<a class="info press" href="{press_home}">{press}</a><span class="info">{date_text}</span>{naver}</div></div>'
        f'<a class="news_tit" href="{ext_url}" title="{title}">{title}</a>'
        f'<div class="news_dsc"><a class="api_txt_lines dsc_txt_wrap" href="{ext_url}">{title} 관련 요약문입니다. 자세한 내용은 기사에서 확인하세요.</a></div>'
        "</div></li>"
    )


NEWS_SEARCH = (
    '<html><body><ul class="list_news">'
    + news_item("연합뉴스", "https://www.yna.co.kr/", "2026.10.21.", "팰리세이드 전동시트 끼임 사고 리콜",
                "https://www.yna.co.kr/view/AKR001", "https://n.news.naver.com/mnews/article/001/0000000001?sid=103")
    + news_item("컨슈머치", "https://www.consumuch.com/", "2026.10.22.", "팰리세이드 2열 전동시트 결함 논란",
                "https://www.consumuch.com/news/articleView.html?idxno=79352&iqfrm=naver")
    + news_item("한국일보", "https://www.hankookilbo.com/", "2026.10.20.", "팰리세이드 전동시트 지난 기사",
                "https://www.hankookilbo.com/News/Read/A1", "https://n.news.naver.com/mnews/article/469/0000000003?sid=101")
    + "</ul></body></html>"
)

NEWS_ARTICLE = (
    '<html><head><meta property="og:title" content="팰리세이드 전동시트 끼임 사고 리콜"></head><body>'
    '<div class="media_end_head_top_logo"><img title="연합뉴스"></div>'
    '<h2 id="title_area">팰리세이드 전동시트 끼임 사고 리콜</h2>'
    '<span class="media_end_head_info_datestamp_time _ARTICLE_DATE_TIME" data-date-time="2026-10-21 15:00:00">2026.10.21. 오후 3:00</span>'
    "</body></html>"
)


def news_cbox(url):
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(url).query)
    if q.get("parentCommentNo"):
        lst = [{"commentNo": 1, "contents": "부모 댓글", "regTime": "2026-10-21T16:00:00+0900"},
               {"commentNo": 11, "contents": "답글도 모아요", "regTime": "2026-10-21T16:05:00+0900"}]
    else:
        lst = [{"commentNo": 1, "contents": "리콜 빨리 해라", "regTime": "2026-10-21T16:00:00+0900", "replyCount": 1},
               {"commentNo": 2, "contents": "", "regTime": "2026-10-21T16:10:00+0900", "deleted": True},
               {"commentNo": 3, "contents": "아이 키우는 집은 무섭겠다", "regTime": "2026-10-21T17:30:00+0900", "replyCount": 0}]
    data = {"success": True, "result": {"objectTitle": "팰리세이드 전동시트 끼임 사고 리콜", "count": {"comment": 3},
                                        "pageModel": {"totalPages": 1}, "commentList": lst}}
    return "cb(" + json.dumps(data, ensure_ascii=False) + ");"


BOBAE_LIST = (
    "<html><body><table>"
    '<tr class="list"><td class="pl14"><a class="bsubject" href="/view?code=national&No=2398545&bm=1">싼타페 시트 결함 문의드립니다</a></td>'
    '<td class="date">2026.10.21 16:20</td></tr>'
    '<tr class="list"><td class="pl14"><a class="bsubject" href="/view?code=national&No=2398500&bm=1">팰리세이드 시트 지난 글</a></td>'
    '<td class="date">2026.10.18 10:00</td></tr>'
    "</table></body></html>"
)
BOBAE_VIEW = (
    '<html><body><div class="writerProfile"><span class="countGroup">2026.10.21 16:20</span></div>'
    '<div class="commentlistbox"><ul class="basiclist">'
    '<li><dl><dt><span class="date">2026.10.21 17:00</span></dt><dd id="small_cmt_1">서비스센터 가 보세요</dd></dl></li>'
    '<li><dl><dt><span class="date">2026.10.21 17:10</span></dt><dd id="small_cmt_2">저도 같은 증상이에요</dd></dl></li>'
    "</ul></div></body></html>"
)
CLIEN_LIST = (
    "<html><body>"
    '<div class="list_item"><a class="list_subject" href="/service/board/cm_car/111?od=T31">팰리세이드 전동시트 또 고장났네요</a>'
    '<span class="timestamp">2026-10-21 18:00:00</span></div>'
    '<div class="list_item"><a class="list_subject" href="/service/board/cm_car/112?od=T31">타이어 교체 후기</a>'
    '<span class="timestamp">2026-10-21 17:00:00</span></div>'
    '<div class="list_item"><a class="list_subject" href="/service/board/cm_car/100?od=T31">팰리세이드 시트 옛날 글</a>'
    '<span class="timestamp">2026-10-19 06:00:00</span></div>'
    "</body></html>"
)
CLIEN_NEWS_LIST = (
    '<html><body><div class="list_item"><a href="/service/board/news/500">오늘의 경제 소식</a>'
    '<span class="timestamp">2026-10-21 13:00:00</span></div></body></html>'
)
CLIEN_VIEW = (
    '<html><body><div class="post_author"><span class="view_count date">2026-10-21 18:00:00</span></div>'
    '<div class="comment_row"><div class="comment_view">센터 예약하세요</div><span class="timestamp">2026-10-21 18:30:00</span></div>'
    '<div class="comment_row"><div class="comment_view">리콜 대상인지 확인해 보세요</div><span class="timestamp">2026-10-21 19:00:00</span></div>'
    "</body></html>"
)
PPOM_HEAD = '<html><head><meta charset="euc-kr"></head><body><div class="board-contents">본문입니다</div>'


def ppom_comment(i, text, when):
    return (f'<div class="comment_wrapper"><div id="commentContent_{i}" class="mid-text-area">{text}</div>'
            f'<span class="eng-day">{when}</span></div>')


def ppom_view(no, c_page):
    if no == "980149":  # 댓글 5개(삭제 1개 포함)가 두 쪽에 나뉘어 있음
        if c_page == "2":
            body = ppom_comment(4, "둘째 쪽 댓글 하나", "2026-10-22 10:10") + ppom_comment(5, "둘째 쪽 댓글 둘", "2026-10-22 10:20")
        else:
            body = (ppom_comment(1, "리콜 소식 반갑네요", "2026-10-22 09:01") + ppom_comment(2, "삭제된 댓글입니다.", "2026-10-22 09:02")
                    + ppom_comment(3, "끼임 사고 무섭다", "2026-10-22 09:05"))
        return (PPOM_HEAD + '<span>댓글 [5]</span><div id="quote">' + body + "</div>"
                '<div class="comment_page"><a href="view.php?id=car&amp;no=980149&amp;c_page=1">1</a> '
                '<a href="view.php?id=car&amp;no=980149&amp;c_page=2">2</a></div></body></html>')
    # 980150: 화면이 열린 뒤에 댓글을 불러옴 (받아 온 화면엔 없음)
    return PPOM_HEAD + (
        '<span>댓글 [3]</span><div id="cbox"></div><script>setTimeout(function(){var h="";'
        '["늦게 뜨는 댓글 하나","늦게 뜨는 댓글 둘","늦게 뜨는 댓글 셋"].forEach(function(t,i){'
        'h+=\'<div class="comment_wrapper"><div id="commentContent_\'+i+\'" class="mid-text-area">\'+t+\'</div><span class="eng-day">2026-10-22 11:0\'+i+\'</span></div>\';});'
        'document.getElementById("cbox").innerHTML=h;},400);</script></body></html>'
    )


PPOM_LIST = (
    '<html><head><meta charset="euc-kr"></head><body><table>'
    '<tr class="baseList"><td><a href="view.php?id=car&amp;no=980149"><span class="baseList-title">[펠리세이드] 2열 시트 끼임 리콜 소식</span></a>'
    '<span class="list_comment2"><span>5</span></span></td><td><time class="baseList-time">2026-10-22 08:00:00</time></td></tr>'
    '<tr class="baseList"><td><a href="view.php?id=car&amp;no=980150"><span class="baseList-title">팰리세이드 전동시트 리콜 후기</span></a>'
    '<span class="list_comment2"><span>3</span></span></td><td><time class="baseList-time">2026-10-22 07:00:00</time></td></tr>'
    '<tr class="baseList"><td><a href="view.php?id=car&amp;no=980100"><span class="baseList-title">팰리세이드 시트 옛날 글</span></a></td>'
    "<td>2026-10-01 08:00:00</td></tr>"
    "</table></body></html>"
)


def start_fake_sites(tmp_path: Path):
    """search.naver.com · n.news.naver.com · 보배드림 · 클리앙 · 뽐뿌 를 한 서버로 (Host 머리글로 나눔)."""
    from urllib.parse import parse_qs, urlparse
    cert, key = tmp_path / "sites-cert.pem", tmp_path / "sites-key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=fake",
                    "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = (self.headers.get("Host") or "").split(":")[0]
            requests.append(host + self.path)
            u = urlparse(self.path)
            q = parse_qs(u.query)
            ctype, body = "text/html; charset=utf-8", "<html><body></body></html>"
            if host == "search.naver.com":
                # '팰리세이드 전동시트'·'팰리세이드 결함' 검색에만 결과 (같은 기사가 두 검색어에 다 나옴 → 하나만)
                if q.get("query", [""])[0] in ("팰리세이드 전동시트", "팰리세이드 결함") and q.get("start", ["1"])[0] == "1":
                    body = NEWS_SEARCH
            elif host == "n.news.naver.com":
                body = NEWS_ARTICLE
            elif host == "www.bobaedream.co.kr":
                body = BOBAE_VIEW if u.path == "/view" else (BOBAE_LIST if q.get("page", ["1"])[0] == "1" else "<html></html>")
            elif host == "www.clien.net":
                if re.search(r"/service/board/\w+/\d+", u.path):
                    body = CLIEN_VIEW
                elif q.get("po", ["0"])[0] == "0":
                    body = CLIEN_NEWS_LIST if "/news" in u.path else CLIEN_LIST
            elif host == "www.ppomppu.co.kr":
                ctype = "text/html; charset=euc-kr"
                if "view.php" in u.path:
                    body = ppom_view(q.get("no", [""])[0], q.get("c_page", ["1"])[0])
                elif q.get("page", ["1"])[0] == "1":
                    body = PPOM_LIST
            data = body.encode("euc-kr" if "euc-kr" in ctype else "utf-8")
            self.send_response(200)
            if host == "www.ppomppu.co.kr":  # 실제 사이트처럼 다른 화면 안(틀)에 넣지 못하게
                self.send_header("X-Frame-Options", "SAMEORIGIN")
                self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.requests = requests
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_lx3_news_community(tmp_path: Path):
    """언론(네이버 뉴스 검색: 네이버 뉴스·언론사 사이트 기사)·자동차 커뮤니티(게시판 목록) 게시물 찾기 → 엑셀 →
    댓글 수집(네이버 뉴스 댓글·답글, 커뮤니티 댓글: 뽐뿌 EUC-KR·댓글 여러 쪽·늦게 뜨는 댓글, 삭제 댓글 제외)."""
    server = start_fake_sites(tmp_path)
    port = server.server_address[1]
    hosts = ["search.naver.com", "n.news.naver.com", "www.bobaedream.co.kr", "www.clien.net", "www.ppomppu.co.kr"]
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}",
                  "--host-resolver-rules=" + ", ".join(f"MAP {h} 127.0.0.1:{port}" for h in hosts),
                  "--no-proxy-server", "--ignore-certificate-errors"],
            accept_downloads=True)
        cbox_calls = []
        ctx.route("https://apis.naver.com/**", lambda route: (cbox_calls.append(route.request.url), route.fulfill(
            status=200, content_type="text/javascript; charset=utf-8", body=news_cbox(route.request.url))))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = f"chrome-extension://{sw.url.split('/')[2]}"
        page = ctx.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{ext}/lx3.html")

        # 기본 설정: 메인 6개 × 서브 7개 = 검색어 42개, 커뮤니티 게시판 4곳
        assert page.input_value("#mainKw") == "펠리세이드, 팰리세이드, LX3, 아이오닉9, 싼타페, MX5"
        assert page.input_value("#subKw") == "전동시트, 시트, 결함, 리콜, 시트리콜, 시트 결함, 시트 사망 사고"
        qs = page.evaluate("keywordQueries($('#mainKw').value, $('#subKw').value)")
        assert len(qs) == 42 and qs[0] == "펠리세이드 전동시트" and "MX5 시트 사망 사고" in qs
        assert page.input_value("#boards").split("\n") == [
            "https://www.bobaedream.co.kr/list?code=national", "https://www.clien.net/service/board/cm_car",
            "https://www.clien.net/service/board/news", "https://www.ppomppu.co.kr/zboard/zboard.php?id=car"]
        assert page.evaluate("matchesCombo('[펠리세이드] 2열 시트 끼임', '팰리세이드, 펠리세이드', '시트')")
        assert not page.evaluate("matchesCombo('팰리세이드 타이어', '팰리세이드', '시트, 결함')")

        # 언론·커뮤니티만, 검색어는 짧게 (메인 1 × 서브 2)
        page.locator("#settings summary").click()
        page.uncheck("#chCafe")
        page.fill("#mainKw", "팰리세이드, 펠리세이드, 싼타페")
        page.locator("#mainKw").dispatch_event("change")
        page.fill("#subKw", "전동시트, 시트, 결함")
        page.locator("#subKw").dispatch_event("change")
        page.fill("#from", "2026-10-21T12:00")
        page.fill("#to", "2026-10-22T12:00")
        # 메인 3 × 서브 3 = 9개 검색어 중 2개만 결과가 있음 → 기간·중복을 걸러 언론 2건
        page.click("#search")
        page.locator("#summary", has_text="찾은 글").wait_for(timeout=240000)
        summary = page.inner_text("#summary")
        rows = page.locator("#results tbody tr")
        got = [(rows.nth(i).locator("td").nth(1).inner_text(), rows.nth(i).locator("td").nth(2).inner_text(),
                rows.nth(i).locator("td").nth(3).inner_text(), rows.nth(i).locator("td").nth(4).inner_text(),
                rows.nth(i).locator("input").is_checked()) for i in range(rows.count())]
        assert got == [
            # 언론: 네이버 뉴스 기사는 글을 열어 시간 확인(15:00), 언론사 사이트 기사는 날짜만 (iqfrm 주소 그대로)
            ("2026-10-21 15:00", "언론 · 연합뉴스", "팰리세이드 전동시트 끼임 사고 리콜", "https://n.news.naver.com/mnews/article/001/0000000001", True),
            ("2026-10-22", "언론 · 컨슈머치", "팰리세이드 2열 전동시트 결함 논란", "https://www.consumuch.com/news/articleView.html?idxno=79352&iqfrm=naver", True),
            # 커뮤니티: 게시판 순(보배드림 → 클리앙 → 뽐뿌) · 날짜순
            ("2026-10-21 16:20", "자동차 커뮤니티 · 보배드림", "싼타페 시트 결함 문의드립니다", "https://www.bobaedream.co.kr/view?code=national&No=2398545", True),
            ("2026-10-21 18:00", "자동차 커뮤니티 · 클리앙", "팰리세이드 전동시트 또 고장났네요", "https://www.clien.net/service/board/cm_car/111", True),
            ("2026-10-22 07:00", "자동차 커뮤니티 · 뽐뿌", "팰리세이드 전동시트 리콜 후기", "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980150", True),
            ("2026-10-22 08:00", "자동차 커뮤니티 · 뽐뿌", "[펠리세이드] 2열 시트 끼임 리콜 소식", "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980149", True),
        ], (got, summary, page.inner_text("#log"))
        assert "찾은 글 6개 (언론 2 · 자동차 커뮤니티 4 · 관련 글로 체크 6개)" in summary, summary
        assert "언론사 사이트 기사(네이버 댓글 없음)" in rows.nth(1).inner_text()
        news_q = [r for r in server.requests if r.startswith("search.naver.com")]
        assert len(news_q) == 9 and all("ds=2026.10.21" in r and "de=2026.10.22" in r and "sort=1" in r for r in news_q), news_q
        assert not any("/cm_car/112" in r for r in server.requests)  # 키워드 없는 글은 열지 않음
        assert not errors, errors

        # 엑셀: 채널·매체명·날짜·URL
        page.check("#separate")
        with page.expect_download() as dl:
            page.click("#saveList")
        buzz = tmp_path / "buzz.xlsx"
        dl.value.save_as(buzz)
        ws = load_workbook(buzz).worksheets[0]
        vals = [r[1:7] for r in ws.iter_rows(min_row=4, values_only=True) if r[1]]
        assert [(v[0], v[1], v[2], v[3].date().isoformat(), v[5]) for v in vals] == [
            (1, "언론", "연합뉴스", "2026-10-21", "https://n.news.naver.com/mnews/article/001/0000000001"),
            (2, "언론", "컨슈머치", "2026-10-22", "https://www.consumuch.com/news/articleView.html?idxno=79352&iqfrm=naver"),
            (3, "자동차 커뮤니티", "보배드림", "2026-10-21", "https://www.bobaedream.co.kr/view?code=national&No=2398545"),
            (4, "자동차 커뮤니티", "클리앙", "2026-10-21", "https://www.clien.net/service/board/cm_car/111"),
            (5, "자동차 커뮤니티", "뽐뿌", "2026-10-22", "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980150"),
            (6, "자동차 커뮤니티", "뽐뿌", "2026-10-22", "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980149"),
        ], vals

        # 이미 파일에 있는 글: 같은 기사를 다른 주소 모양(sid·iqfrm 없음)으로 넣은 파일에 이어 쓰면 체크가 풀린다
        page.uncheck("#separate")
        old = tmp_path / "20261021_버즈량.xlsx"
        make_buzz_file(old)
        wb = load_workbook(old)
        ws = wb.worksheets[0]
        ws.append([None, 99, "언론", "연합뉴스", None, "예전에 넣은 기사", "https://n.news.naver.com/mnews/article/001/0000000001?sid=103"])
        ws.append([None, 100, "언론", "컨슈머치", None, "예전에 넣은 기사", "https://www.consumuch.com/news/articleView.html?idxno=79352"])
        wb.save(old)
        page.set_input_files("#listFile", str(old))
        page.locator("#listFileInfo", has_text="✔").wait_for()
        assert [rows.nth(i).locator("input").is_checked() for i in range(2)] == [False, False]
        assert "이미 파일에 있음" in rows.nth(0).inner_text() and "이미 파일에 있음" in rows.nth(1).inner_text()
        page.set_input_files("#listFile", [])
        page.check("#separate")
        for i in range(2):
            rows.nth(i).locator("input").check()

        # 댓글 수집으로: 언론은 네이버 뉴스 기사만 (언론사 사이트 기사는 댓글이 없어 뺌)
        page.uncheck("#withYoutube")
        page.click("#toComments")
        page.wait_for_url("**/app.html")
        handoff = page.inner_text("#handoff")
        assert "언론 기사 1개, 커뮤니티 글 4개" in handoff and "언론사 자체 사이트 기사 1개는" in handoff, handoff
        assert page.input_value("#urls").split("\n") == [
            "https://n.news.naver.com/mnews/article/001/0000000001",
            "https://www.bobaedream.co.kr/view?code=national&No=2398545",
            "https://www.clien.net/service/board/cm_car/111",
            "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980150",
            "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980149",
        ]
        page.check("#separate")
        with page.expect_download(timeout=240000) as dl:
            page.click("#start")
        raw = tmp_path / "raw.xlsx"
        dl.value.save_as(raw)
        progress = page.inner_text("#progress")
        wb = load_workbook(raw)
        news_rows = [r for r in list(wb["언론"].values)[1:]]
        assert news_rows == [
            (1, "언론", "2026.10.21. 16:00", "리콜 빨리 해라", "https://n.news.naver.com/mnews/article/001/0000000001"),
            (2, "언론", "2026.10.21. 16:05", "답글도 모아요", "https://n.news.naver.com/mnews/article/001/0000000001"),
            (3, "언론", "2026.10.21. 17:30", "아이 키우는 집은 무섭겠다", "https://n.news.naver.com/mnews/article/001/0000000001"),
        ], (news_rows, progress)
        comm = [r for r in list(wb["자동차 커뮤니티"].values)[1:]]
        assert [(r[0], r[1], r[2], r[3]) for r in comm] == [
            (1, "보배드림", "2026.10.21. 17:00", "서비스센터 가 보세요"),
            (2, "보배드림", "2026.10.21. 17:10", "저도 같은 증상이에요"),
            (3, "클리앙", "2026.10.21. 18:30", "센터 예약하세요"),
            (4, "클리앙", "2026.10.21. 19:00", "리콜 대상인지 확인해 보세요"),
            # 화면이 열린 뒤 불러오는 댓글 → 보이지 않는 틀로 열어 읽음
            (5, "뽐뿌", "2026.10.22. 11:00", "늦게 뜨는 댓글 하나"),
            (6, "뽐뿌", "2026.10.22. 11:01", "늦게 뜨는 댓글 둘"),
            (7, "뽐뿌", "2026.10.22. 11:02", "늦게 뜨는 댓글 셋"),
            # 댓글 두 쪽 (EUC-KR) · 삭제된 댓글 제외
            (8, "뽐뿌", "2026.10.22. 09:01", "리콜 소식 반갑네요"),
            (9, "뽐뿌", "2026.10.22. 09:05", "끼임 사고 무섭다"),
            (10, "뽐뿌", "2026.10.22. 10:10", "둘째 쪽 댓글 하나"),
            (11, "뽐뿌", "2026.10.22. 10:20", "둘째 쪽 댓글 둘"),
        ], (comm, progress)
        assert comm[0][4] == "https://www.bobaedream.co.kr/view?code=national&No=2398545"
        assert comm[-1][4] == "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980149"
        assert any("parentCommentNo=1" in u for u in cbox_calls)  # 답글도 읽음
        summary = page.inner_text("#summary")
        assert "언론 3개 추가" in summary and "자동차 커뮤니티 11개 추가" in summary, summary
        assert not errors, errors
        ctx.close()
    server.shutdown()
