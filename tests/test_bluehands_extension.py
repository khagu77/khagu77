"""블루핸즈/하이테크센터 정비 예약 확장프로그램 통합 테스트.

cafe.naver.com · search.naver.com 을 로컬 HTTPS 서버로 돌려
기사목록 파일 → 작성자 확인(직접 / 검색 경유 / 패스) → 지난 보고서에 이어 쓰기 → DB 목록까지 확인한다.
확장 로딩에는 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import filecmp
import json
import os
import shutil
import ssl
import subprocess
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo

import pytest
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "bluehands-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")


def test_shared_files_match_comment_collector():
    """두 확장이 같이 쓰는 파일은 내용이 같아야 한다 (한쪽만 고치지 않도록)."""
    for name in ("template.js", "cafe-common.js"):
        assert filecmp.cmp(EXT_DIR / name, ROOT / "chrome-extension" / name, shallow=False), name


def article_html(nick, body="본문 내용입니다. 하이테크센터 예약했어요."):
    return (
        "<html><head><title>테스트 카페 : 네이버 카페</title></head><body><div class='ArticleContentBox'>"
        "<div class='article_header'><h3 class='title_text'>글 제목</h3>"
        f"<div class='WriterInfo'><div class='nick_box'><button class='nickname'>{nick}</button></div></div></div>"
        f"<div class='article_container'><div class='se-main-container'><p>{body}</p></div></div>"
        "</div></body></html>"
    )


# 지난주 iroid/5520064 처럼 글 주소로 들어가면 알림창으로 삭제를 알리고 카페 첫 화면으로 보내는 경우
DELETED_ALERT = "<html><body><script>alert('삭제되었거나 존재하지 않는 게시글입니다.'); location.replace('/aacafe');</script></body></html>"
DELETED = "<html><body><div class='error_content'><p>삭제되었거나 존재하지 않는 게시글입니다.</p></div></body></html>"
MEMBERS_ONLY = "<html><body><div class='error_content'><p>카페 멤버만 볼 수 있습니다.</p><a>카페 가입하기</a></div></body></html>"

# 제목 → 검색 결과에 나올 링크
SEARCH_RESULTS = {
    "블루핸즈 예약 문의": ["https://cafe.naver.com/aacafe/9999?art=WRONG", "https://cafe.naver.com/aacafe/102?art=TOKEN102"],
    "넥쏘 하이테크센터 후기": ["https://cafe.naver.com/nexocafe/201?art=TOKEN201"],
}


def start_fake_naver(tmp_path: Path):
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=cafe.naver.com",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )
    hits = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = self.headers.get("Host", "").split(":")[0]
            u = urlparse(self.path)
            q = parse_qs(u.query)
            hits.append((host, self.path, self.headers.get("Referer", "")))
            if host == "search.naver.com":
                query = unquote(q.get("query", [""])[0]).strip('"')
                links = SEARCH_RESULTS.get(query, [])
                body = "<html><body><div id='main_pack'>" + (
                    "".join(f"<div class='total_wrap'><a class='title_link' href='{h}'>{query}</a></div>" for h in links)
                    if links else "<p>'검색결과가 없습니다'</p>"
                ) + "</div></body></html>"
            elif u.path == "/aacafe/101":
                body = article_html("울산ll테스터")
            elif u.path == "/aacafe/102":
                body = article_html("검색ll작성자") if q.get("art") == ["TOKEN102"] else MEMBERS_ONLY
            elif u.path == "/nexocafe/201":
                body = article_html("넥쏘ll회원") if q.get("art") == ["TOKEN201"] else MEMBERS_ONLY
            elif u.path == "/aacafe/104":  # 삭제된 게시물 (알림창)
                body = DELETED_ALERT
            elif u.path == "/nexocafe/202":  # 삭제된 게시물 (화면 안내)
                body = DELETED
            else:  # aacafe/103 등: 언제나 막힘
                body = MEMBERS_ONLY
            data = body.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            # 네이버처럼 '틀 안에서 열지 마세요' 머리글 - 확장이 자기 화면 안의 틀에 한해 빼야 읽힌다
            self.send_header("X-Frame-Options", "SAMEORIGIN")
            self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
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
    server.hits = hits
    return server


def make_list_xls(path: Path):
    """모니터링 사이트의 기사목록 .xls (실제로는 HTML 표) 흉내 - 최신 글이 위."""
    rows = [
        ("디올뉴 넥쏘카페 / 수소차 동호회", "넥쏘 하이테크센터 후기", "2026-10-11 09:00:00", "https://cafe.naver.com/nexocafe/201"),
        ("디올뉴 넥쏘카페 / 수소차 동호회", "지워진 넥쏘 글", "2026-10-10 20:00:00", "https://cafe.naver.com/nexocafe/202"),
        ("AA 동호회", "못 보는 글", "2026-10-10 10:00:00", "https://cafe.naver.com/aacafe/103"),
        ("AA 동호회", "지워진 글", "2026-10-09 18:00:00", "https://cafe.naver.com/aacafe/104"),
        ("AA 동호회", "블루핸즈 예약 문의", "2026-10-09 15:30:00", "https://cafe.naver.com/aacafe/102"),
        ("AA 동호회", "하이테크센터 정비 예약했어요", "2026-10-08 11:25:00", "https://cafe.naver.com/aacafe/101"),
        ("AA 동호회", "이미 보고한 글", "2026-10-06 08:00:00", "https://cafe.naver.com/aacafe/100"),
        ("뉴스", "블로그 글", "2026-10-06 07:00:00", "https://blog.naver.com/someone/1"),
    ]
    trs = "".join(
        f"<tr height=24><td align=center>{i + 1}</td><td align=center>CAFE</td><td align=center>{cafe}</td>"
        f"<td align=center>네이버</td><td>{title}</td><td align=center>-</td><td align=center></td><td>{when}</td>"
        f"<td>{when}</td><td></td><td>{url}</td></tr>"
        for i, (cafe, title, when, url) in enumerate(rows)
    )
    path.write_text(
        '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
        "</head><body><table border=1><tr height=28><th>No</th><th>채널</th><th>출처</th><th>포털</th><th>제목</th><th>분류</th>"
        f"<th>성향</th><th>작성시간</th><th>수집시간</th><th>댓글수</th><th>Link</th></tr>{trs}</table></body></html>",
        encoding="utf-8",
    )


def make_report(path: Path):
    """지난 보고서: 양식에 2행(마지막 연번 5)."""
    shutil.copy(EXT_DIR / "report-template.xlsx", path)
    wb = load_workbook(path)
    ws = wb.active
    styles = [c._style for c in ws[2]]
    ws.delete_rows(2)
    for r, row in enumerate([
        [4, "동호회", "AA 동호회", datetime(2026, 10, 5, 9, 0), "지난주 글", "서울ll누구", "https://cafe.naver.com/aacafe/99"],
        [5, "동호회", "AA 동호회", datetime(2026, 10, 6, 8, 0), "이미 보고한 글", "부산ll누구", "https://cafe.naver.com/aacafe/100"],
    ], start=2):
        for c, v in enumerate(row, start=1):
            cell = ws.cell(r, c, v)
            cell._style = styles[c - 1]
        ws.row_dimensions[r].height = 24
    wb.save(path)


@pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")
def test_bluehands(tmp_path: Path):
    from playwright.sync_api import sync_playwright

    server = start_fake_naver(tmp_path)
    port = server.server_address[1]
    list_xls = tmp_path / "기사목록20261012.xls"
    make_list_xls(list_xls)
    report = tmp_path / "20261005_정비 예약 관련 테스트 보고서.xlsx"
    make_report(report)

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
        api_calls = []
        ctx.route("https://apis.naver.com/**", lambda route: (api_calls.append(route.request.url), route.fulfill(status=500, body="")))
        # 카카오톡 '나에게 보내기' 대신 가짜 응답 - 보낸 글만 모은다
        kakao_msgs = []

        def kakao(route):
            from urllib.parse import parse_qs as _pq
            body = _pq(route.request.post_data or "")
            kakao_msgs.append(json.loads(body["template_object"][0])["text"])
            route.fulfill(status=200, content_type="application/json", body='{"result_code":0}')

        ctx.route("https://kapi.kakao.com/**", kakao)
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = f"chrome-extension://{sw.url.split('/')[2]}"
        dialogs, leave_prompts = [], []

        confirm_answers = []  # 확인 창 답(차례대로) - 비어 있으면 '확인'
        confirm_messages = []

        def on_dialog(d):
            if d.type == "confirm":
                confirm_messages.append(d.message)
                d.accept() if (confirm_answers.pop(0) if confirm_answers else True) else d.dismiss()
            elif d.type == "beforeunload":  # 작업 중 새로고침·닫기 확인 → 테스트에서는 '나가기'
                leave_prompts.append(1)
                d.accept()
            else:
                dialogs.append(d.message)
                d.dismiss()

        ctx.on("page", lambda pg: pg.on("dialog", on_dialog))
        page = ctx.new_page()
        page.goto(f"{ext}/bluehands.html")
        assert page.inner_text("h1") == "블루핸즈/하이테크센터 정비 예약 관련 수집 시스템"

        # 보고 일정: 월요일, 월요일이 쉬는 날이면 다음 근무일
        sched = page.evaluate("""() => [
            ['2026-10-12', '2026-10-05', '2026-10-07', '2027-02-10', '2026-10-13'].map(s => {
                const [y, m, d] = s.split('-').map(Number);
                return ymd(reportDayOfWeek(new Date(y, m - 1, d)).day);
            }),
            ymd(reportDayOfWeek(new Date(2026, 9, 19), parseExtraHolidays('2026-10-19 회사 휴무')).day),
            reportSchedule(new Date(2026, 9, 7)).next.day.getDate(),
        ]""")
        assert sched == [["2026-10-12", "2026-10-06", "2026-10-06", "2027-02-10", "2026-10-12"], "2026-10-20", 12]
        # 보고일 옆 빨간 상자: 지난 보고일 오전 10:00 ~ 이번 보고일 오전 10:00
        window_text = page.evaluate("""() => [
            uploadWindowText(reportSchedule(new Date(2026, 10, 9, 9))),
            uploadWindowText(reportSchedule(new Date(2026, 9, 6, 9))),  // 10/5 대체공휴일 → 10/6(화) 보고
            uploadWindowText(reportSchedule(new Date(2026, 9, 7, 9))),  // 보고 다음 날 → 다음 기간
        ]""")
        assert window_text == [
            "2026년 11월 2일 오전 10:00 ~ 2026년 11월 9일 오전 10:00까지 게시글 파일 업로드 하세요.",
            "2026년 9월 28일 오전 10:00 ~ 2026년 10월 6일 오전 10:00까지 게시글 파일 업로드 하세요.",
            "2026년 10월 6일 오전 10:00 ~ 2026년 10월 12일 오전 10:00까지 게시글 파일 업로드 하세요.",
        ], window_text
        pill = page.locator("#schedule .upload-window")
        assert pill.inner_text().endswith("까지 게시글 파일 업로드 하세요.")
        assert pill.evaluate("e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]") == ["rgb(224, 36, 36)", "rgb(255, 255, 255)"]

        # 테스트는 빨리: 글 사이 기다림을 줄인다
        page.evaluate("CAFE_ARTICLE_DELAY.splice(0, 2, 10, 20); CAFE_PAGE_DELAY.splice(0, 2, 10, 20)")

        page.set_input_files("#listFile", str(list_xls))
        page.locator("#listInfo", has_text="✔").wait_for()
        assert "글 8개 (2026-10-06 07:00 ~ 2026-10-11 09:00)" in page.inner_text("#listInfo")
        page.set_input_files("#reportFile", str(report))
        page.locator("#reportInfo", has_text="✔").wait_for()
        assert "2행(마지막 연번 5)" in page.inner_text("#reportInfo")
        rows = page.locator("#items tbody tr")
        assert rows.count() == 8
        assert "이미 보고서에 있음" in rows.nth(1).inner_text()  # 날짜순: 블로그(07:00) → 이미 보고한 글(08:00) → …
        assert "네이버 카페 글 주소가 아님" in rows.nth(0).inner_text()

        # 카카오톡 알림 켜기 (연결된 상태로)
        page.click("#kakaoBox > summary")
        page.evaluate("""async () => {
            await chrome.storage.local.set({ kakaoAuth: { access: 'A', accessExp: Date.now() + 3600e3, refresh: 'R', refreshExp: Date.now() + 60 * 86400e3, at: Date.now() } });
            document.querySelector('#kakaoOn').checked = true;
            document.querySelector('#kakaoRestKey').value = 'KEY';
            await saveKakaoSettings(); await renderKakaoStatus();
        }""")
        assert "✓ 연결됨" in page.inner_text("#kakaoStatus")
        assert page.inner_text("#kakaoRedirect").endswith("chromiumapp.org/kakao")
        page.click("#kakaoTest")
        try:
            page.locator("#kakaoStatus", has_text="테스트 알림을 보냈습니다").wait_for(timeout=10000)
        except Exception:
            raise AssertionError(page.inner_text("#kakaoStatus"))
        assert kakao_msgs[-1].startswith("[🧑🏻‍🔧 블루핸즈 정비 예약 🛠️]\n📨 테스트 알림 (")
        pages_before = len(ctx.pages)
        # [필수] 네이버 로그인이 풀려 있으면 시작하지 않는다: 빨간 경고·사이렌, 로그인되면 몇 초 안에 시작
        page.evaluate("""() => { window.__sirens = 0; const orig = sirenOnce; sirenOnce = () => { window.__sirens++; orig(); }; }""")
        page.click("#start")
        page.locator("#loginAlarm", has_text="네이버 로그인이 풀려 있습니다!").wait_for()
        assert page.locator("#loginAlarm", has_text="로그인하기 전에는 수집을 시작하지 않습니다").count() == 1
        assert page.evaluate("window.__sirens") >= 1
        page.wait_for_timeout(1500)
        assert page.locator("#busy").is_hidden() and not [h for h in server.hits if h[0] == "cafe.naver.com"]
        page.click("#loginAlarm .la-check")
        page.locator("#loginAlarm .la-status", has_text="아직 로그인되지 않았습니다").wait_for()
        ctx.add_cookies([{"name": "NID_AUT", "value": "test", "domain": ".naver.com", "path": "/"}])
        page.locator("#loginAlarm .la-status", has_text="네이버 로그인 확인! 수집을 시작합니다").wait_for(timeout=10000)
        page.locator("#loginAlarm").wait_for(state="detached")
        assert "✔ 네이버에 로그인되어 있습니다" in page.inner_text("#login")
        # 작업 중 표시: 맨 위 로딩 바 · 탭 제목
        page.locator("#busy").wait_for(state="visible")
        assert "작성자 확인 중" in page.inner_text("#busy")
        rows.nth(2).locator("td", has_text="✔ 확인").wait_for(timeout=120000)
        assert page.title().startswith("⏳ ")
        # 뒤로 가기(마우스 제스처 등)는 막힌다 - 화면·작업 그대로
        page.go_back()  # 브라우저의 진짜 뒤로 가기 (마우스 제스처·Alt+←와 같음)
        page.locator("#toast", has_text="뒤로 가기가 막혀").wait_for()
        assert page.url.endswith("/bluehands.html") and page.locator("#busy").is_visible()
        # 실수로 새로고침(창 닫기와 같음) → 확인 창이 뜨고, 나간 뒤 다시 열면 '이어서 진행'
        page.reload()
        assert leave_prompts, "작업 중 나가기 확인 창이 떠야 함"
        page.evaluate("CAFE_ARTICLE_DELAY.splice(0, 2, 10, 20); CAFE_PAGE_DELAY.splice(0, 2, 10, 20)")
        page.locator("#resumeBox", has_text="중간에 끊겼습니다").wait_for()
        assert "지난번에 고른 파일" in page.inner_text("#reportInfo")  # 보고서 파일도 기억
        assert rows.nth(2).locator("td").nth(6).inner_text() == "✔ 확인"
        page.click("#resume")
        page.locator("#summary", has_text="작성자 확인을 마쳤습니다").wait_for(timeout=300000)
        # 카카오톡 알림: 로그인 풀림 → 시작 → (새로고침 뒤 이어서) 시작 → 끝, 모두 머리말 다음 줄부터 내용
        heads = [m.split("\n")[1] for m in kakao_msgs]
        assert all(m.startswith("[🧑🏻‍🔧 블루핸즈 정비 예약 🛠️]\n") for m in kakao_msgs), kakao_msgs
        assert heads[1].startswith("🚨 네이버 로그인이 풀려 작성자 확인을 시작하지 못했습니다"), heads
        assert heads[2] == "🚀 작성자 확인 시작" and heads[-1] == "✅ 작성자 확인 끝", heads
        assert "확인 2 · 패스 1 · 삭제 2" in kakao_msgs[-1] and "[엑셀 받기]를 눌러 저장하세요" in kakao_msgs[-1]
        assert all(len(m) <= 200 for m in kakao_msgs)
        assert page.locator("#busy").is_hidden() and not page.title().startswith("⏳")
        # 끝나면 받기 버튼 축하 효과(무지개·커졌다 작아짐·'✔ 완료!') - 받으면 멈춤
        assert "celebrate" in page.get_attribute("#save", "class")
        assert page.evaluate("getComputedStyle(document.querySelector('#save'), '::after').content") == '"✔ 완료!"'
        assert "bh-rainbow" in page.evaluate("getComputedStyle(document.querySelector('#save')).animationName")
        # 이미 끝난 글은 다시 열지 않는다
        assert len([h for h in server.hits if h[1].startswith("/aacafe/101")]) == 1
        # 탭·창을 하나도 띄우지 않는다
        assert len(ctx.pages) == pages_before, [pg.url for pg in ctx.pages]
        assert "최소화된 창" not in page.inner_text("#log")  # 보이지 않는 틀에서 다 읽음
        # 삭제된 게시물 2개(알림창 1 · 화면 안내 1, 넥쏘카페 글은 검색에서 못 찾아 글 주소로 확인)는
        # 목록에 빨간 취소선으로 남는다
        assert rows.count() == 8
        deleted = page.locator("#items tbody tr.deleted")
        assert deleted.count() == 2
        assert [deleted.nth(i).locator("td").nth(3).inner_text() for i in range(2)] == ["지워진 글", "지워진 넥쏘 글"]
        assert "삭제된 게시물" in deleted.nth(0).locator("td").nth(6).inner_text()
        assert deleted.nth(0).locator("td").nth(3).evaluate("e => getComputedStyle(e).textDecorationLine") == "line-through"
        assert "삭제된 게시물 2개(엑셀에서 뺌)" in page.inner_text("#itemCount")
        # 이미 보고서에 있는 글은 보고서의 작성자를 보여 준다
        assert rows.nth(1).locator("td").nth(5).inner_text() == "부산ll누구"
        live = page.locator("#items tbody tr:not(.deleted)")
        got = [
            (live.nth(i).locator("td").nth(0).inner_text(), live.nth(i).locator("td").nth(3).inner_text(),
             live.nth(i).locator(".nick").inner_text() if live.nth(i).locator(".nick").count()
             else live.nth(i).locator("input.author").input_value(),
             live.nth(i).locator("td").nth(6).inner_text())
            for i in range(2, 6)
        ]
        assert got == [
            ("6", "하이테크센터 정비 예약했어요", "울산ll테스터", "✔ 확인"),
            ("7", "블루핸즈 예약 문의", "검색ll작성자", "✔ 확인(검색 경유)"),
            ("8", "못 보는 글", "", "패스 - 검색에서 같은 글을 찾지 못함"),
            ("9", "넥쏘 하이테크센터 후기", "넥쏘ll회원", "✔ 확인(검색 경유)"),
        ], got
        # 알림창은 화면에 뜨지 않는다(확장이 연 탭에서만 막고 기록)
        assert dialogs == [], dialogs
        assert "이어서 진행" in page.inner_text("#log")
        assert "이번 주 신규 3건 · 전주 신규 1건 대비 ▲ 2 건 (누적 5건)" in page.inner_text("#weekCompare")
        assert page.locator("#weekCompare .up").evaluate("e => getComputedStyle(e).color") == "rgb(224, 36, 36)"
        assert "확인 2개 · 패스 1개 · 삭제된 게시물 2개(엑셀에서 뺌)" in page.inner_text("#summary")

        # 넥쏘카페는 처음부터 검색으로: 글 주소를 바로 열지 않는다
        assert not [h for h in server.hits if h[1] == "/nexocafe/201"]
        # 검색 결과 링크로 들어갈 때 검색 화면을 거쳐 온 것으로 (Referer)
        art = [h for h in server.hits if h[1].startswith("/aacafe/102?art=")]
        assert art and "search.naver.com" in art[0][2]

        # 저장 폴더 지정: 내려받기를 거치지 않고 그 폴더에 바로 쓴다 ('출처' 정보가 붙지 않음).
        # (테스트에서는 폴더 고르기 창 대신 크롬의 테스트용 폴더를 지정)
        page.evaluate("async () => setSaveFolder(await navigator.storage.getDirectory())")
        page.locator("#saveFolderInfo", has_text="폴더에 바로 저장합니다").wait_for()
        downloads = []
        page.on("download", lambda d: downloads.append(d))
        page.click("#save", force=True)  # 축하 효과로 움직이는 중에도 누름
        page.locator("#saveInfo", has_text="✔").wait_for()
        assert not downloads, "폴더를 지정했으면 내려받기를 하지 않는다"
        today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y%m%d")
        want = f"{today}_정비 예약 관련 테스트 보고서.xlsx"
        assert f"{want} (" in page.inner_text("#saveInfo") and "폴더에 저장" in page.inner_text("#saveInfo")
        data = page.evaluate("""async (name) => {
            const dir = await navigator.storage.getDirectory();
            const f = await (await dir.getFileHandle(name)).getFile();
            return Array.from(new Uint8Array(await f.arrayBuffer()));
        }""", want)
        out = tmp_path / want
        out.write_bytes(bytes(data))
        # 같은 이름이 이미 있으면 덮어쓰지 않고 ' (2)'
        assert page.evaluate("""async () => {
            const dir = await navigator.storage.getDirectory();
            return freeName(dir, document.querySelector('#saveInfo').textContent.split(' (')[0].slice(2));
        }""") == f"{today}_정비 예약 관련 테스트 보고서 (2).xlsx"
        # 기본 다운로드 폴더로 되돌리기 (아래 DB 엑셀은 내려받기로 확인)
        page.click("#clearSaveFolder")
        page.locator("#saveFolderInfo", has_text="기본 다운로드 폴더로 받습니다").wait_for()
        assert "celebrate" not in (page.get_attribute("#save", "class") or "")
        today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y%m%d")
        assert "3개 추가 (연번 6~9), 패스 1개는 넣지 않았습니다, 삭제된 게시물 2개는 넣지 않았습니다" in page.inner_text("#saveInfo")
        assert "이번 주 신규 3건 · 전주 신규 1건 대비 ▲ 2 건" in page.inner_text("#saveInfo .compare")

        # DB 목록: 지난 보고서 2행 + 새 글 3행
        page.click("nav.menu a[data-tab=db]")
        page.locator("#dbCount", has_text="DB 전체 5행").wait_for()
        page.fill("#dbQuery", "넥쏘")
        assert page.locator("#dbTable tbody tr").count() == 1
        assert page.locator("#history tbody tr").count() == 1
        with page.expect_download() as dl:
            page.click("#dbExport")
        db_file = tmp_path / dl.value.suggested_filename
        dl.value.save_as(db_file)
        assert db_file.name == f"{today}_정비 예약 관련 DB 목록_검색결과.xlsx"
        # 받은 보고서 기록: 보관된 파일 다시 받기 · 수정본 올리기 · 삭제(두 번 확인)
        row = page.locator("#history tbody tr").first
        with page.expect_download() as dl:
            row.locator("button", has_text="⬇ 받기").click()
        again = tmp_path / ("again_" + dl.value.suggested_filename)
        dl.value.save_as(again)
        assert dl.value.suggested_filename == out.name and again.read_bytes() == out.read_bytes()
        revised = tmp_path / "수정본.xlsx"
        rwb = load_workbook(out)
        rwb.active["F4"] = "고친닉네임"
        rwb.save(revised)
        row.locator("input[type=file]").set_input_files(str(revised))
        page.locator("#dbInfo", has_text="수정본(수정본.xlsx, 5행)으로 바꾸고").wait_for()
        assert "다음 보고서는 이 수정본 아래에 이어 씁니다" in page.inner_text("#dbInfo")
        assert "수정본 ·" in page.inner_text("#history tbody tr")
        page.fill("#dbQuery", "고친닉네임")
        assert page.locator("#dbTable tbody tr").count() == 1  # DB 도 수정본 내용으로
        page.fill("#dbQuery", "")
        with page.expect_download() as dl:
            row.locator("button", has_text="⬇ 받기").click()
        dl.value.save_as(tmp_path / "rev_dl.xlsx")
        assert (tmp_path / "rev_dl.xlsx").read_bytes() == revised.read_bytes()
        # 삭제: 두 번째 확인에서 취소하면 그대로
        n_conf = len(confirm_messages)
        confirm_answers[:] = [True, False]
        row.locator("button", has_text="삭제").click()
        page.locator("#dbInfo", has_text="삭제를 취소했습니다").wait_for()
        assert len(confirm_messages) == n_conf + 2 and "정말 삭제합니다" in confirm_messages[-1]
        assert page.locator("#history tbody tr").count() == 1
        confirm_answers[:] = [True, True]
        row.locator("button", has_text="삭제").click()
        page.locator("#dbInfo", has_text="기록을 삭제했습니다").wait_for()
        assert page.locator("#history tbody tr").count() == 0
        assert page.locator("#dbCount", has_text="DB 전체 5행").count() == 1  # DB 글은 그대로
        # 받은 보고서 기록의 전주 대비: 새로 넣은 글 수끼리 비교 (같은 주에 다시 받은 기록은 건너뜀)
        week_cells = page.evaluate("""() => {
            const day = 86400e3, t = new Date(2026, 10, 2, 10).getTime();  // 11/2(월)
            history = [
                { at: t, added: 54, total: 300, file: 'c' },
                { at: t - 7 * day + 3600e3, added: 70, total: 246, file: 'b2' },  // 10/26 주에 다시 받음
                { at: t - 7 * day, added: 83, total: 246, file: 'b' },
                { at: t - 14 * day, added: 40, total: 163, file: 'a' },
            ];
            renderDb();
            return [...document.querySelectorAll('#history tbody tr')].map(tr => tr.children[6].innerText);
        }""")
        assert week_cells == ["▼ 16 건", "▲ 30 건", "▲ 43 건", "전주 기록 없음"], week_cells
        ctx.close()
    server.shutdown()
    assert api_calls == []

    # 시트 이름은 설정의 고정 이름(원본 '기사목록20260911 (1)' 대신), 문서 속성의 시트 목록도 같이
    out_wb = load_workbook(out)
    assert out_wb.sheetnames == ["정비 예약 모니터링"]
    assert load_workbook(db_file).sheetnames == ["정비 예약 모니터링"]
    import zipfile
    app = zipfile.ZipFile(out).read("docProps/app.xml").decode()
    assert "기사목록" not in app
    ws = out_wb.active
    data = [[c.value for c in row] for row in ws.iter_rows(min_row=1)]
    assert data[0] == ["No", "채널", "채널명", "작성일", "제목", "작성자", "URL"]
    assert data[1:] == [
        [4, "동호회", "AA 동호회", datetime(2026, 10, 5, 9, 0), "지난주 글", "서울ll누구", "https://cafe.naver.com/aacafe/99"],
        [5, "동호회", "AA 동호회", datetime(2026, 10, 6, 8, 0), "이미 보고한 글", "부산ll누구", "https://cafe.naver.com/aacafe/100"],
        [6, "동호회", "AA 동호회", datetime(2026, 10, 8, 11, 25), "하이테크센터 정비 예약했어요", "울산ll테스터", "https://cafe.naver.com/aacafe/101"],
        [7, "동호회", "AA 동호회", datetime(2026, 10, 9, 15, 30), "블루핸즈 예약 문의", "검색ll작성자", "https://cafe.naver.com/aacafe/102"],
        [9, "동호회", "디올뉴 넥쏘카페 / 수소차 동호회", datetime(2026, 10, 11, 9, 0), "넥쏘 하이테크센터 후기", "넥쏘ll회원", "https://cafe.naver.com/nexocafe/201"],
    ]
    # 새 행은 바로 위(마지막) 행과 같은 서식(글꼴·테두리·표시 형식·행 높이), URL 에는 링크
    for r in (4, 5, 6):
        for c in range(1, 8):
            assert ws.cell(r, c)._style == ws.cell(3, c)._style, (r, c)
        assert ws.row_dimensions[r].height == 24
        assert ws.cell(r, 7).hyperlink.target == ws.cell(r, 7).value
    assert ws.cell(4, 6).font.name == "현대산스 Text Medium" and ws.cell(4, 4).number_format == "m/d/yy h:mm"

    exported = [[c.value for c in row] for row in load_workbook(db_file).active.iter_rows(min_row=2)]
    assert exported == [data[5]]
