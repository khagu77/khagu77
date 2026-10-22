"""'LX3 / ME1 / MX5 전동 시트 작동 위험 상황 관련 게시물 수집' 화면(seat.html) 통합 테스트.

cafe.naver.com 을 로컬 HTTPS 서버로 돌려 카페 첫 화면·검색 결과·게시글을 흉내 내고,
게시물 찾기 → 비교 파일 등록 → 본문 읽기·규칙 요약 → 엑셀 받기까지 확인한다.
CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import re
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from openpyxl import Workbook, load_workbook
from playwright.sync_api import sync_playwright

EXT_DIR = Path(__file__).resolve().parent.parent / "chrome-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

CAFES = {"palicafe": "50001", "evcafe": "50002"}  # 영문 주소 → 카페 번호
# (카페 번호, 글번호) → (제목, 목록 날짜, 본문)
POSTS = {
    ("50001", "1001"): ("3열 탈 때 2열 시트에 아이 발 끼임", "2025.03.10.",
                        "어제 3열에 아이가 타다가 2열 전동 시트가 복귀하면서 발이 끼였어요.\n센서가 있는데도 멈추지 않아 깜짝 놀랐습니다."),
    ("50001", "1002"): ("3열 시트 가죽 질감 좋네요", "2025.04.01.", "3열 시트 가죽이 생각보다 좋습니다."),
    ("50001", "1003"): ("2열 시트 폴딩 조심하세요", "2024.12.01.", "양산 전 글"),
    ("50002", "2001"): ("아이오닉9 3열 위험하네요", "2025.02.02.",
                        "아이오닉9 3열에서 내릴 때 2열 시트 원터치 폴딩하면 손이 낄 뻔했습니다. 다들 조심하세요."),
    ("50002", "2002"): ("아이오닉5 2열 끼임", "2025.02.03.", "아이오닉5 2열 시트 이야기"),
}
# 검색어 → 결과에 나오는 글번호 (카페마다)
SEARCH = {
    ("50001", "3열 시트"): ["1002", "1001", "1003"],
    ("50001", "시트 끼임"): ["1001"],
    ("50002", "아이오닉9 3열"): ["2002", "2001"],
}


def search_html(cafe, q, page):
    ids = SEARCH.get((cafe, q), []) if page == 1 else []
    rows = "".join(
        f'<li class="article-item"><a class="article_title" href="/f-e/cafes/{cafe}/articles/{aid}"><strong>{POSTS[(cafe, aid)][0]}</strong></a>'
        f'<span class="date">{POSTS[(cafe, aid)][1]}</span></li>'
        for aid in ids
    ) or '<p class="empty">검색 결과가 없습니다.</p>'
    return f"<html><head><title>검색 : 네이버 카페</title></head><body><ul>{rows}</ul></body></html>"


def start_server(tmp_path: Path):
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=cafe.naver.com",
                    "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            u = urlparse(self.path)
            body = "<html><body>없는 화면</body></html>"
            m = re.match(r"/f-e/cafes/(\d+)/menus/0$", u.path)
            if m:
                qs = parse_qs(u.query)
                body = search_html(m.group(1), qs["q"][0], int(qs.get("page", ["1"])[0]))
            elif re.match(r"^/([a-z]+)/?$", u.path):  # 카페 첫 화면: 화면 속 링크에 카페 번호
                slug = u.path.strip("/")
                body = f'<html><body><a href="/f-e/cafes/{CAFES[slug]}/menus/0">전체글보기</a></body></html>'
            elif m := re.match(r"^/([a-z]+)/(\d+)$", u.path):
                cafe = CAFES[m.group(1)]
                title, date, text = POSTS[(cafe, m.group(2))]
                body = (f'<html><body><div class="ArticleTitle"><h3 class="title_text">{title}</h3></div>'
                        f'<div class="article_info"><span class="date">{date} 14:05</span></div>'
                        f'<div class="se-main-container">{"".join(f"<p>{line}</p>" for line in text.split(chr(10)))}</div></body></html>')
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


def make_compare_files(tmp_path: Path):
    """사용자 일일 온라인 동향 리스트 · 로데이터와 같은 머리글의 가짜 파일."""
    trend = Workbook()
    ws = trend.active
    ws.title = "전체"
    ws.append(["차종", "재원", "불만구분", "매체", "동호회명", "게시일", "게시글 위치", "내용", "중복", "작성자"])
    ws.append(["LX3", "-", "품질(주의/경고/심각)", "동호회", "팰리 카페", "2025-03-10", "https://cafe.naver.com/palicafe/1001", "끼임", "신규", "-"])
    ws.append(["MX5", "-", "품질", "동호회", "다른 카페", "2025-06-30", "https://cafe.naver.com/other/1", "", "신규", "-"])
    ws.append(["ME1", "-", "품질", "동호회", "전기차", "2025-01-02", "https://cafe.naver.com/evcafe/1999", "", "신규", "-"])
    trend.save(tmp_path / "251231_일일동향.xlsx")
    raw = Workbook()
    ws = raw.active
    ws.title = "현대자동차"
    ws.append([None, "커뮤니티명", "차종", "게시일", "구분", "게시글 위치", "주요 내용"])
    ws.append([1, "팰리 카페", "LX3", "2025-03-10", "품질", "https://cafe.naver.com/palicafe/1001?art=abc", "끼임"])
    ws.append([2, "전기차", "ME1", "2025-02-02", "품질", "https://cafe.naver.com/f-e/cafes/50002/articles/2001", "3열"])
    raw.save(tmp_path / "251231_raw_data.xlsx")
    return [tmp_path / "251231_일일동향.xlsx", tmp_path / "251231_raw_data.xlsx"]


def test_seat(tmp_path: Path):
    server = start_server(tmp_path)
    port = server.server_address[1]
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}",
                  f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{port}", "--no-proxy-server", "--ignore-certificate-errors"],
            accept_downloads=True,
        )
        naver_api = []
        ctx.route("https://apis.naver.com/**", lambda route: (naver_api.append(route.request.url), route.fulfill(status=500, body="")))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = f"chrome-extension://{sw.url.split('/')[2]}"
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.goto(f"{ext}/seat.html")
        page.evaluate("CAFE_ARTICLE_DELAY[0] = CAFE_ARTICLE_DELAY[1] = CAFE_PAGE_DELAY[0] = CAFE_PAGE_DELAY[1] = 10")

        assert page.inner_text("h1") == "LX3 / ME1 / MX5 전동 시트 작동 위험 상황 관련 게시물 수집"
        assert page.get_attribute(".brand .logo", "src") == "icons/logo-seat.png"
        assert page.evaluate("document.querySelector('.brand .logo').naturalWidth") > 0
        # 위쪽 띠: 에르메스 오렌지
        assert page.evaluate("getComputedStyle(document.querySelector('.topbar')).backgroundColor") == "rgb(243, 112, 33)"
        # 기본 동호회 12곳, 차종 3개(시작일: 양산 시점)
        assert len(page.input_value("#cafeList").split("\n")) == 12
        assert page.evaluate("CARS.map(c => carSettings()[c.code].start)") == ["2024-12-20", "2024-12-16", "2023-08-15"]

        # 테스트용 동호회 두 곳 · 검색어 2개 · MX5 는 찾지 않음
        page.locator("#settings summary").click()
        page.fill("#cafeList", "LX3 | 팰리 카페 | palicafe\nME1 | 전기차 | evcafe | 혼합")
        page.locator("#cafeList").dispatch_event("change")
        page.fill("#queries", "3열 시트, 시트 끼임")
        page.locator("#queries").dispatch_event("change")
        page.fill("#mixedQueries", "{차종} 3열")
        page.locator("#mixedQueries").dispatch_event("change")
        page.locator("#carRows tr[data-car=MX5] .carOn").uncheck()
        assert "동호회·검색어 3개" in page.inner_text("#jobInfo")

        page.click("#search")
        try:
            page.locator("#summary", has_text="새로 찾은 글").wait_for(timeout=180000)
        except Exception:
            raise AssertionError(f"{page.inner_text('#summary')}\n{page.inner_text('#log')}\n{errors}\n{server.requests}")
        assert not errors, errors
        rows = page.locator("#results tbody tr")
        got = {rows.nth(i).locator("a").inner_text(): rows.nth(i).locator("input").is_checked() for i in range(rows.count())}
        assert got == {
            "3열 탈 때 2열 시트에 아이 발 끼임": True,
            "3열 시트 가죽 질감 좋네요": False,  # 위험 단어 없음
            "아이오닉9 3열 위험하네요": True,
            "아이오닉5 2열 끼임": False,  # 혼합 동호회인데 차종 이름 없음
        }, (got, page.inner_text("#log"))  # 1003 은 양산 시점(2024-12-20) 이전이라 빠짐
        assert "새로 찾은 글 4개" in page.inner_text("#summary")
        # 카페 번호는 카페 첫 화면에서 알아냄
        assert page.evaluate("clubIds.palicafe") == "50001" and page.evaluate("clubIds.evcafe") == "50002"
        assert not naver_api

        # 비교 파일: 머리글로 종류 자동 판단, f-e 주소·?art= 붙은 주소도 같은 글로
        page.set_input_files("#compareFiles", [str(f) for f in make_compare_files(tmp_path)])
        page.locator("#compareInfo", has_text="2개 파일을 등록").wait_for()
        kinds = page.locator("#compareTable tbody select")
        assert sorted(kinds.nth(i).input_value() for i in range(2)) == ["raw", "trend"]
        yn = {rows.nth(i).locator("a").inner_text(): rows.nth(i).locator("td.yn").inner_text() for i in range(rows.count())}
        assert yn["3열 탈 때 2열 시트에 아이 발 끼임"] == "Y / Y" and yn["아이오닉9 3열 위험하네요"] == "N / Y", yn

        # 본문 읽기 + 규칙 요약 (AI 끔)
        page.click("#readBodies")
        page.locator("#summary", has_text="규칙으로 썼습니다").wait_for(timeout=120000)
        assert not errors, errors
        texts = page.evaluate("items.filter(x => x.checked).map(x => [x.title, x.bodyRead, x.summary, x.reason])")
        by = {t[0]: t for t in texts}
        assert by["3열 탈 때 2열 시트에 아이 발 끼임"][1] and "끼였어요" in by["3열 탈 때 2열 시트에 아이 발 끼임"][2]
        assert by["3열 탈 때 2열 시트에 아이 발 끼임"][3] == ""  # 온라인 동향에 있으면 누락 사유 없음
        assert by["아이오닉9 3열 위험하네요"][3].startswith("로데이터에는 수집되었으나") and by["아이오닉9 3열 위험하네요"][3].endswith("추정")

        # 다시 열어도 결과·비교 파일 유지
        page.reload()
        page.evaluate("CAFE_ARTICLE_DELAY[0] = CAFE_ARTICLE_DELAY[1] = 10")
        assert page.locator("#results tbody tr").count() == 4 and page.locator("#compareTable tbody tr").count() == 2

        # 작업 중에는 뒤로가기·백스페이스 막기
        page.evaluate("showBusy('테스트', 0, 1)")
        assert page.evaluate("navGuardOn") is True
        page.keyboard.press("Backspace")
        page.go_back()
        assert page.url.endswith("seat.html") and page.locator("#guardNotice").count() == 1
        page.evaluate("hideBusy()")
        assert page.evaluate("navGuardOn") is False

        with page.expect_download() as dl:
            page.click("#saveList")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        assert re.match(r"^\d{8}_LX3·ME1·MX5 전동 시트 작동 위험 상황 관련 게시물\.xlsx$", path.name), path.name
        ctx.close()
    server.shutdown()

    wb = load_workbook(path, rich_text=True)
    ws = wb.active
    assert [c.value for c in ws[3]][1:] == ["순번", "차종", "동호회명", "게시일", "제목", "URL", "주요내용 요약", "온라인동향/로데이터 포함 여부", "미포함시 누락 사유"]
    r4 = [c.value for c in ws[4]]
    assert r4[1:4] == [1, "LX3", "팰리 카페"] and r4[5] == "3열 탈 때 2열 시트에 아이 발 끼임"
    assert ws["E4"].value.strftime("%Y-%m-%d") == "2025-03-10" and ws["E4"].number_format == "yyyy-mm-dd"
    assert r4[6] == "https://cafe.naver.com/palicafe/1001" and ws["G4"].hyperlink.target == r4[6]
    assert r4[9] is None
    r5 = [c.value for c in ws[5]]
    assert r5[1:4] == [2, "ME1", "전기차"] and r5[6] == "https://cafe.naver.com/evcafe/2001"
    assert r5[9].startswith("로데이터에는 수집되었으나")
    # 포함 여부: 한 칸 안에서 Y 파랑 · N 빨강
    cell = ws["I5"].value
    assert str(cell) == "N / Y"
    colors = [(b.text, b.font.color.rgb if b.font and b.font.color else None) for b in cell if hasattr(b, "font")]
    assert colors == [("N", "FFE00000"), (" / ", None), ("Y", "FF0070C0")], colors
    assert all(b.font.rFont == "맑은 고딕" for b in cell if hasattr(b, "font"))
    assert str(ws["I4"].value) == "Y / Y"
    assert ws.max_row == 5
