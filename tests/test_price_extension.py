"""'싼타페 페이스리프트(MX5 F/L) 가격 언급 게시물 수집' 확장프로그램(price-extension) 통합 테스트.

cafe.naver.com 을 로컬 HTTPS 서버로 돌려 카페 첫 화면·검색 결과·게시글을 흉내 내고,
기간 정하기 → 게시물 찾기 → 본문 읽기(작성자·조회수·댓글수)·요약 → 엑셀 받기까지 확인한다.
CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import re
import shutil
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "price-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
needs_chromium = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")


@pytest.mark.parametrize("name", ["cafe-common.js", "template.js", "bg-render.js"])
def test_shared_files_match(name):
    """다른 확장과 함께 쓰는 파일은 같아야 한다 (한쪽만 고치지 않도록)."""
    assert (EXT_DIR / name).read_bytes() == (ROOT / "seat-extension" / name).read_bytes(), name


def test_ui_matches_seat():
    assert (EXT_DIR / "ui.js").read_bytes() == (ROOT / "seat-extension" / "seat-ui.js").read_bytes()


def test_manifest():
    m = json.loads((EXT_DIR / "manifest.json").read_text())
    assert m["name"] == "싼타페 페이스리프트(MX5 F/L) 가격 언급 게시물 수집"
    for other in ["chrome-extension", "seat-extension"]:
        assert m["key"] != json.loads((ROOT / other / "manifest.json").read_text())["key"]  # 따로 설치·따로 저장
    for f in [*m["icons"].values(), m["background"]["service_worker"], *m["content_scripts"][0]["js"], "price.html", "price-template.xlsx"]:
        assert (EXT_DIR / f).exists(), f
    html = (EXT_DIR / "price.html").read_text()
    for src in re.findall(r'(?:src|href)="([^"#:]+)"', html):
        assert (EXT_DIR / src).exists(), src


POST_HEAD = ["순번", "동호회명", "작성일", "제목", "내용 요약", "URL", "작성자 닉네임", "조회수", "댓글수",
             "구간", "예상 가격 여론", "예상 가격·인상 폭 언급", "예상 인상 폭(만 원)", "비교 차종", "구매 영향", "여론 요지"]


COMMENT_HEAD = ["순번", "동호회명", "게시글 순번", "게시글 제목", "게시글 URL", "구간", "댓글 작성일", "작성자 닉네임", "구분", "댓글 내용",
                "가격 관련", "댓글 여론", "금액 언급", "인상액 언급", "인상액(만 원)", "요지"]


def test_template():
    """시트 3개 · 기존 보고 양식(seat-template)과 같은 서체·크기·테두리 · 머리글은 현대 블루 바탕에 흰색 굵은 글씨."""
    wb = load_workbook(EXT_DIR / "price-template.xlsx")
    assert wb.sheetnames == ["게시물", "댓글", "구간별 여론", "주별 추이"]
    assert [c.value for c in wb["댓글"][3]][1:] == COMMENT_HEAD
    ws = wb["게시물"]
    assert [c.value for c in ws[3]][1:] == POST_HEAD
    base = load_workbook(ROOT / "seat-extension" / "seat-template.xlsx").active
    for mine, theirs in [(ws["B3"], base["B3"]), (ws["C4"], base["C4"]), (ws["E4"], base["F4"])]:
        assert (mine.font.name, mine.font.sz, mine.font.b) == (theirs.font.name, theirs.font.sz, theirs.font.b)
        assert mine.border.left.style == theirs.border.left.style
    for sheet, row in [("게시물", 3), ("댓글", 3), ("구간별 여론", 5), ("주별 추이", 3)]:
        for c in wb[sheet][row][1:]:
            assert c.fill.fgColor.rgb == "FF002C5F" and c.font.color.rgb == "FFFFFFFF" and c.font.b, (sheet, c.coordinate)
    assert ws["B3"].alignment.horizontal == "center" and ws.freeze_panes == "A4"
    assert [c.value for c in wb["구간별 여론"][5]][1:5] == ["구간", "기간", "일수", "글 수"]
    colors = {r.formula[0].split('"')[1]: r.dxf.font.color.rgb for cf in ws.conditional_formatting for r in cf.rules}
    assert colors == {"부정": "FFE00000", "긍정": "FF0070C0", "중립": "FF00B050", "단순비난": "FFBF8F00"}
    # 댓글: 금액·인상액 언급이 있으면 댓글 내용·금액·인상액 칸 빨강
    red = [(str(cf.sqref), r.formula[0], r.dxf.font.color.rgb) for cf in wb["댓글"].conditional_formatting for r in cf.rules if "OR" in r.formula[0]]
    assert red == [("K4:K50000 N4:P50000", 'OR($N4<>"",$O4<>"")', "FFE00000")], red


CAFES = {"trailer": "60001", "iroid": "60002", "choids": "60003"}  # 영문 주소 → 카페 번호
# (카페 번호, 글번호) → (제목, 목록 날짜, 본문, 글 화면 모양)
POSTS = {
    ("60001", "1001"): ("페리 가격 얼마나 오를까요", "2026.10.10.",
                        "싼타페 페리 출시가가 4천만원대 중반이라는 얘기가 있네요.\n현행보다 300만원 정도 오른다고 하니 고민됩니다.\n색상은 그대로래요.", "new"),
    ("60001", "1002"): ("페리 디자인 유출 사진", "2026.10.11.", "페리 앞모습 사진입니다. 램프가 바뀌었네요.", "new"),
    ("60001", "1003"): ("페리 가격 예상", "2026.08.01.", "기간 전 글", "new"),
    # 목록엔 가격 단어가 없지만 본문에 예상 가격 언급 → 본문까지 열어 수집
    ("60001", "1004"): ("페리 실물 봤어요", "2026.10.11.", "페리 실물 봤는데 멋지네요.\n딜러 말로는 200만원 정도 오른다네요. 그 정도면 적당한 듯.", "new"),
    ("60002", "2001"): ("신형 견적 받았어요", "2026.10.15.", "F/L 견적 받아보니 하이브리드 캘리 풀옵 5,100만원 나오네요.", "old"),
    ("60002", "2002"): ("flex 타이어 가격 문의", "2026.10.16.", "타이어 가격 얼마인가요", "new"),
    ("60003", "3001"): ("페리 가격 공동구매 모집", "2026.10.12.", "가격 할인 공동구매 합니다", "new"),
    ("60003", "3002"): ("페리 가격 확정?", "2026.10.25.", "기간 뒤 글", "new"),
    # 비교 차종 글: 싼타페 이야기가 있으면 수집, 그 차(현행·신형) 가격만이면 넣지 않음
    ("60003", "3003"): ("투싼 가격 보고 왔어요", "2026.10.13.", "투싼 가격 3140만원부터라니 우리 싼타페도 오르겠네요.\n부담됩니다. 좀 기다려 볼까", "new"),
    ("60003", "3004"): ("투싼 가격 정리", "2026.10.13.", "투싼 하이브리드 3615만원부터입니다", "new"),
}
SEARCH = {  # (카페 번호, 검색어) → 결과에 나오는 글번호
    ("60001", "페리 가격"): ["1004", "1002", "1001", "1003"],
    ("60002", "페리 가격"): ["2002"],
    ("60002", "신형 가격"): ["2001", "2002"],
    ("60003", "페리 가격"): ["3002", "3001"],
    ("60003", "투싼 가격"): ["3004", "3003"],
}
# 글마다 댓글 (닉네임, 작성일, 내용, 답글 여부)
COMMENTS = {"1001": [
    ("오너1", "2026.10.13. 10:00", "페리 4,500만 원대면 너무 비싸네요", False),
    ("오너2", "2026.10.15. 09:00", "300 오르면 부담돼서 안 삽니다", True),
    ("오너3", "2026.10.15. 11:00", "현기차가 늘 그렇지 ㅋㅋ 호구들만 삼", False),
    ("오너4", "2026.10.12. 08:00", "축하드려요 ^^", False),
    ("삭제", "2026.10.12. 08:30", "", False),  # 삭제된 댓글 (빼고 읽음)
]}
# 글마다 작성자 · 조회수 · 댓글수
META = {"1001": ("싼타기다림", "1,234", 12), "1002": ("페리러버", "88", 0), "2001": ("견적왕", "56", 3)}


def search_html(cafe, q, page):
    ids = SEARCH.get((cafe, q), []) if page == 1 else []
    rows = "".join(
        f'<li class="article-item"><a class="article_title" href="/f-e/cafes/{cafe}/articles/{aid}"><strong>{POSTS[(cafe, aid)][0]}</strong></a>'
        f'<span class="date">{POSTS[(cafe, aid)][1]}</span></li>'
        for aid in ids
    ) or '<p class="empty">검색 결과가 없습니다.</p>'
    return f"<html><head><title>검색 : 네이버 카페</title></head><body><ul>{rows}</ul></body></html>"


def article_html(cafe, aid):
    title, date, text, kind = POSTS[(cafe, aid)]
    nick, views, comments = META.get(aid, ("익명", "1", 0))
    body = "".join(f"<p>{line}</p>" for line in text.split("\n"))
    clist = "".join(
        f'<li class="CommentItem{" CommentItem--reply" if reply else ""}" id="c{aid}{k}"><span class="comment_nickname">{n}</span>'
        + (f'<span class="text_comment">{t}</span>' if t else '<p class="comment_deleted">삭제된 댓글입니다</p>')
        + f'<span class="comment_info_date">{d}</span></li>'
        for k, (n, d, t, reply) in enumerate(COMMENTS.get(aid, []))
    )
    if kind == "new":  # 지금 카페 글 화면 모양
        return (f'<html><body><div class="ArticleContentBox"><div class="article_header">'
                f'<div class="ArticleTitle"><h3 class="title_text">{title}</h3></div>'
                f'<div class="WriterInfo"><div class="profile_info"><div class="nick_box"><button class="nickname">{nick}</button></div></div>'
                f'<div class="article_info"><span class="date">{date} 14:05</span><span class="count">조회 {views}</span></div></div></div>'
                f'<div class="article_container"><div class="se-main-container">{body}</div></div>'
                f'<div class="ArticleTool"><a class="button_comment">댓글 <strong class="num">{comments}</strong></a></div>'
                f'<div class="CommentBox"><ul>{clist}</ul></div></div></body></html>')
    # 조회수가 머리 글자에만 있고, 댓글수는 댓글 목록으로만 알 수 있는 모양
    items = "".join(f'<li class="CommentItem"><span class="text_comment">댓글{i}</span></li>' for i in range(comments))
    return (f'<html><body><div class="article_header"><h3 class="title_text">{title}</h3>'
            f'<div class="WriterInfo"><span class="nickname">{nick}</span> <span class="date">{date} 09:30</span> <span>조회 {views}</span></div></div>'
            f'<div class="se-main-container">{body}</div><div class="CommentBox"><ul>{items}</ul></div></body></html>')


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
                body = f'<html><body><a href="/f-e/cafes/{CAFES[u.path.strip("/")]}/menus/0">전체글보기</a></body></html>'
            elif m := re.match(r"^/([a-z]+)/(\d+)$", u.path):
                body = article_html(CAFES[m.group(1)], m.group(2))
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


def launch(p, tmp_path, server):
    ext_dir = tmp_path / "ext"
    shutil.copytree(EXT_DIR, ext_dir)
    ctx = p.chromium.launch_persistent_context(
        str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
        args=[f"--disable-extensions-except={ext_dir}", f"--load-extension={ext_dir}", "--no-proxy-server", "--ignore-certificate-errors",
              f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{server.server_address[1]}"],
        accept_downloads=True,
    )
    ctx.add_init_script("window.__seatAutoConfirm = true;")  # 화면 안 확인 상자는 자동으로 '확인'
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"chrome-extension://{sw.url.split('/')[2]}/price.html")
    page.locator("#login", has_text="네이버").wait_for()
    page.evaluate("CAFE_ARTICLE_DELAY[0] = CAFE_ARTICLE_DELAY[1] = CAFE_PAGE_DELAY[0] = CAFE_PAGE_DELAY[1] = 10")
    return ctx, page, errors


def set_value(page, sel, value):
    page.fill(sel, value)
    page.locator(sel).dispatch_event("change")


EVENTS = "2026-10-12 | 아반떼 가격 공개 | 시험용\n2026-10-14 | 투싼 가격 공개 | 시험용"


@needs_chromium
def test_price(tmp_path: Path):
    server = start_server(tmp_path)
    with sync_playwright() as p:
        ctx, page, errors = launch(p, tmp_path, server)
        assert page.inner_text("h1") == "싼타페 페이스리프트(MX5 F/L) 가격 언급 게시물 수집"
        assert page.evaluate("document.querySelector('.brand .logo').naturalWidth") > 0
        assert page.evaluate("getComputedStyle(document.querySelector('.topbar')).backgroundColor") == "rgb(107, 107, 69)"  # 카키
        # 기본: 동호회 3곳 · 기준 사건(아반떼 8/5 · 투싼 10/21) · 기간은 첫 사건 30일 전부터 오늘까지
        assert page.input_value("#cafeList").split("\n") == ["MX5 | 싼타페MX5패밀리 | trailer", "MX5 | 클럽싼타페 | iroid", "MX5 | 싼타페MX5클럽 | choids"]
        assert "동호회 3곳" in page.inner_text("#cafeNames")
        assert [e.split(" | ")[:2] for e in page.input_value("#events").split("\n")] == [["2026-08-05", "아반떼 가격 공개"], ["2026-10-21", "투싼 가격 공개"]]
        assert page.input_value("#startDate") == "2026-07-06"
        assert page.evaluate("stages().map(s => s.name)") == ["① 아반떼 가격 공개 전", "② 아반떼 가격 공개 후", "③ 투싼 가격 공개 후"]
        # 영문 낱말(FL)은 낱말로만: flex·flat 에서는 찾지 않음
        assert page.evaluate("judge('MX5 FL 가격').related") is True
        assert page.evaluate("judge('MX5FL 가격 얼마').related") is True
        assert page.evaluate("judge('flex 타이어 가격').related") is False
        # 비교 차종 가격: 싼타페 이야기가 있을 때만
        assert page.evaluate("judge('투싼 가격 보니 싼타페도 오르겠네').related") is True
        assert page.evaluate("judge('투싼 가격 3615만원').related") is False
        # 예상 인상 폭(규칙): 페리 문장(이나 바로 다음 문장)의 숫자만
        assert page.evaluate("ruleRaise('페리는 200~300 인상 예상').raise") == 250
        assert page.evaluate("ruleRaise('투싼이 300만원 올랐네요').raise") is None

        set_value(page, "#events", EVENTS)
        page.locator("#settings summary").click()
        set_value(page, "#queries", "페리 가격, 신형 가격, 투싼 가격")
        set_value(page, "#startDate", "2026-09-01")
        set_value(page, "#endDate", "2026-10-20")
        assert "동호회·검색어 9개" in page.inner_text("#jobInfo") and "2026-09-01 ~ 2026-10-20" in page.inner_text("#jobInfo")

        page.click("#search")
        try:
            page.locator("#summary", has_text="새로 찾은 글").wait_for(timeout=180000)
        except Exception:
            raise AssertionError(f"{page.inner_text('#summary')}\n{page.inner_text('#log')}\n{errors}\n{server.requests}")
        assert not errors, errors
        rows = page.locator("#results tbody tr")
        got = {rows.nth(i).locator("a").inner_text(): rows.nth(i).locator("input").is_checked() for i in range(rows.count())}
        assert got == {
            "페리 가격 얼마나 오를까요": True,
            "페리 실물 봤어요": False,  # 목록엔 가격 단어 없음 → 본문에서 확인
            "페리 디자인 유출 사진": False,  # 가격 단어 없음 → 본문에서 확인
            "신형 견적 받았어요": True,
            "flex 타이어 가격 문의": False,  # flex 는 FL 이 아님
            "페리 가격 공동구매 모집": False,  # 관련 없는 단어
            "투싼 가격 보고 왔어요": False,  # 목록엔 싼타페 단어 없음 → 본문에서 확인
            "투싼 가격 정리": False,  # 목록엔 싼타페 단어 없음 → 본문에서 확인 (본문도 다른 차 가격만이면 넣지 않음)
        }, (got, page.inner_text("#log"))  # 기간 전(8.1)·뒤(10.25) 글은 넣지 않음
        assert page.evaluate("clubIds") == {"trailer": "60001", "iroid": "60002", "choids": "60003"}
        assert page.evaluate("items.find(x => x.key === 'iroid/2002').queries") == ["페리 가격", "신형 가격"]
        # 찾기만 한 단계: 여론 변화 숫자는 잠정치
        page.locator("#stageState", has_text="잠정치").wait_for()
        assert "본문·댓글 확인 전 글 2개 포함" in page.inner_text("#stageState") and "본문에서 확인할 글 4개 남음" in page.inner_text("#stageState")

        # 본문 읽기 + 규칙 요약 (AI 없음): 작성자 닉네임·조회수·댓글수도 읽고, 본문에서 확인할 글도 연다
        # 버튼 이름: 읽을 글 수 (체크한 글 2 + 본문에서 확인할 글 4)
        assert page.inner_text("#readBodies").startswith("본문·댓글 읽고 요약하기 (6개")
        page.click("#readBodies")
        page.locator("#summary", has_text="규칙으로 요약했습니다").wait_for(timeout=180000)
        page.locator("#readBodies", has_text="모두 읽음").wait_for()
        # 예전 버전에서 요약만 한 글(댓글 안 읽음): 댓글만 읽는다는 이름
        page.evaluate("items.find(x => x.key === 'iroid/2001').commentsRead = false; updateCounts()")
        assert page.inner_text("#readBodies").startswith("댓글 읽고 분석하기 (1개")
        page.evaluate("items.find(x => x.key === 'iroid/2001').commentsRead = true; updateCounts()")
        assert not errors, errors
        checked = page.evaluate("items.filter(x => x.checked).map(x => x.key).sort()")
        assert checked == ["choids/3003", "iroid/2001", "trailer/1001", "trailer/1004"], checked
        read = page.evaluate("Object.fromEntries(items.filter(x => x.checked).map(x => [x.key, [x.nickname, x.views, x.comments, x.summary, x.hasTime]]))")
        assert read["trailer/1001"][:3] == ["싼타기다림", 1234, 12] and read["iroid/2001"][:3] == ["견적왕", 56, 3], read
        assert "4천만원대" in read["trailer/1001"][3] and "300만원" in read["trailer/1001"][3] and "색상" not in read["trailer/1001"][3]
        assert all(v[4] for v in read.values())  # 글 화면에서 작성 시각까지
        assert any("/trailer/1002" in r for r in server.requests) and any("/choids/3004" in r for r in server.requests)
        assert not any("/iroid/2002" in r for r in server.requests)  # 페리·비교 차종 단어도 없는 글은 열지 않음
        ops = page.evaluate("Object.fromEntries(items.filter(x => x.checked).map(x => { const o = opinion(x); return [x.key, [o.tone, o.raise, o.compare, o.impact]]; }))")
        assert ops == {
            "trailer/1001": ["부정", 300, [], "해당 없음"],
            "trailer/1004": ["중립", 200, [], "해당 없음"],
            "choids/3003": ["부정", None, ["투싼"], "대기·관망"],
            "iroid/2001": ["중립", None, [], "해당 없음"],
        }, ops
        # 댓글: 삭제 댓글 빼고 읽고, 댓글마다 금액·인상액·여론(규칙) 판단
        cm = page.evaluate("items.find(x => x.key === 'trailer/1001').commentList.map(c => { const a = commentOpinion(c); return [c.nickname, c.isReply, a.relevant, a.tone, a.amount, a.raise]; })")
        assert cm == [
            ["오너1", False, True, "부정", "4,500만 원대", None],
            ["오너2", True, True, "부정", "", 300],
            ["오너3", False, True, "단순비난", "", None],
            ["오너4", False, False, "중립", "", None],
        ], cm
        assert page.evaluate("items.filter(x => x.checked).every(x => x.commentsRead)")
        row = rows.filter(has_text="페리 가격 얼마나 오를까요")
        assert "댓글 4개 읽음 (가격 관련 3 · 부정 2 · 단순비난 1)" in row.inner_text()
        assert row.locator("td").nth(4).inner_text() == "싼타기다림" and row.locator("td").nth(5).inner_text() == "1,234"
        assert row.locator(".tone").inner_text() == "부정"

        # 여론 변화 표 (화면)
        page.locator("#stageTable tbody tr").nth(2).wait_for()
        st = page.locator("#stageTable tbody tr")
        assert [st.nth(i).locator("td b").first.inner_text() for i in range(3)] == ["① 아반떼 가격 공개 전", "② 아반떼 가격 공개 후", "③ 투싼 가격 공개 후"]
        assert "2026-09-01 ~ 10-11 (41일)" in st.nth(0).locator("td").first.inner_text()
        assert st.nth(0).locator("td").nth(1).locator("b").inner_text() == "2개" and "250만 원" in st.nth(0).locator("td").nth(3).inner_text()
        assert "투싼 1" in st.nth(1).locator("td").nth(4).inner_text()
        # 가로 스크롤 없이 한 화면에
        assert page.evaluate("(() => { const w = document.querySelector('#stageBox .tablewrap'); return w.scrollWidth <= w.clientWidth; })()")
        assert "숫자로 본 변화" in page.inner_text("#reportText") and "부정 비율" in page.inner_text("#reportText")
        # 본문을 모두 읽은 뒤: 확정치 · 여론 글자에 색(부정 빨강 · 긍정 파랑 · 중립 녹색), 숫자는 굵게
        page.locator("#stageState", has_text="확정치").wait_for()
        assert page.locator("#reportText .t-neg b").first.inner_text() == "50%"
        assert page.evaluate("getComputedStyle(document.querySelector('#stageTable .t-neu')).color") == "rgb(0, 160, 70)"
        assert page.evaluate("getComputedStyle(document.querySelector('#stageTable .t-pos b')).fontWeight") == "700"

        with page.expect_download() as dl:
            page.click("#saveExcel")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        assert re.match(r"^\d{8}_싼타페 페이스리프트\(MX5 FL\) 가격 언급 게시물_20260901-20261020\.xlsx$", path.name), path.name
        page.locator("#saveInfo", has_text="데이터 DB에 오늘 파일로 저장").wait_for()
        assert "엑셀에 넣은 글 4건" in page.inner_text("#diffs")

        # 데이터 DB: 받은 엑셀이 오늘 날짜로 · 건수 · AI 비용 · 소요 시간 · 백업
        page.click("a.tool[href='price-db.html']")
        page.wait_for_url("**/price-db.html")
        db_row = page.locator("section[data-kind=price] tbody tr").first
        db_row.locator(".chip").first.wait_for()
        chips = db_row.locator(".chip").all_inner_texts()
        assert chips[:4] == ["글 4", "싼타페MX5패밀리 2", "클럽싼타페 1", "싼타페MX5클럽 1"], chips
        assert "긍정 0" in chips and "중립 2" in chips and "부정 2" in chips and "예상 인상 폭 평균 250만 원" in chips, chips
        assert any(c.startswith("소요 시간 ") and "찾기" in c and "글당" in c for c in chips), chips
        assert "첫 기록" in db_row.locator(".counts").inner_text() and db_row.locator(".pill").inner_text() == "최종"
        assert "누적 소요 시간" in page.inner_text("#work") and "찾기" in page.inner_text("#work")
        with page.expect_download() as dl:
            page.click("#backup")
        backup = tmp_path / dl.value.suggested_filename
        dl.value.save_as(backup)
        data = json.loads(backup.read_text())
        assert data["app"] == "mx5fl-price" and len(data["data"]["priceItems"]) == 8 and data["data"]["priceTime"]["search"] > 0
        assert "aiKey" not in json.dumps(data)
        page.evaluate("chrome.storage.local.set({ priceItems: [] })")
        page.set_input_files("#restoreFile", str(backup))
        page.locator("#dbInfo", has_text="백업을 불러왔습니다").wait_for()
        # 수정본 올리기: 받은 엑셀로 건수를 다시 셈
        with page.expect_file_chooser() as fc:
            db_row.locator(".up").click()
        fc.value.set_files(str(path))
        page.locator("#dbInfo", has_text="바꿨습니다").wait_for()
        assert "직접 올림" in page.locator("section[data-kind=price] tbody tr").first.inner_text()
        page.click("a.tool[href='price.html']")
        page.wait_for_url("**/price.html")
        page.locator("#results tbody tr").nth(7).wait_for()
        assert page.input_value("#startDate") == "2026-09-01"  # 다시 열어도 기간 시작일 유지
        assert not errors, errors
        ctx.close()
    server.shutdown()

    wb = load_workbook(path)
    ws = wb["게시물"]
    assert [c.value for c in ws[3]][1:] == POST_HEAD
    rows = [[c.value for c in r][1:] for r in ws.iter_rows(min_row=4)]
    assert [r[3] for r in rows] == ["페리 가격 얼마나 오를까요", "페리 실물 봤어요", "투싼 가격 보고 왔어요", "신형 견적 받았어요"]  # 작성일순
    r = rows[0]
    assert r[:2] == [1, "싼타페MX5패밀리"] and r[2].strftime("%Y-%m-%d %H:%M") == "2026-10-10 14:05"
    assert "4천만원대" in r[4] and r[5] == "https://cafe.naver.com/trailer/1001" and ws["G4"].hyperlink.target == r[5]
    assert r[6:9] == ["싼타기다림", 1234, 12]
    assert r[9:13] == ["① 아반떼 가격 공개 전", "부정", "300만원 정도 오른", 300]
    assert rows[2][9:15] == ["② 아반떼 가격 공개 후", "부정", None, None, "투싼", "대기·관망"]
    assert rows[3][1] == "클럽싼타페" and rows[3][2].strftime("%H:%M") == "09:30" and rows[3][6:9] == ["견적왕", 56, 3]
    assert ws["D4"].number_format == "yyyy-mm-dd hh:mm" and ws["I4"].number_format == "#,##0"
    assert ws["B4"].font.name == "현대산스 Text" and ws["B4"].font.sz == 11 and ws["B3"].font.b
    assert ws.max_row == 7
    # 댓글 시트: 게시글 순서 · 게시글 안에서는 작성순 · 구간은 댓글 작성일 기준
    ws = wb["댓글"]
    assert [c.value for c in ws[3]][1:] == COMMENT_HEAD
    cr = [[c.value for c in r][1:] for r in ws.iter_rows(min_row=4)]
    assert [r[9] for r in cr[:4]] == ["축하드려요 ^^", "페리 4,500만 원대면 너무 비싸네요", "300 오르면 부담돼서 안 삽니다", "현기차가 늘 그렇지 ㅋㅋ 호구들만 삼"]
    assert cr[1][:9] == [2, "싼타페MX5패밀리", 1, "페리 가격 얼마나 오를까요", "https://cafe.naver.com/trailer/1001", "② 아반떼 가격 공개 후",
                         cr[1][6], "오너1", "댓글"] and cr[1][6].strftime("%Y-%m-%d %H:%M") == "2026-10-13 10:00"
    assert cr[1][10:15] == ["O", "부정", "4,500만 원대", None, None]
    assert cr[2][5] == "③ 투싼 가격 공개 후" and cr[2][8] == "답글" and cr[2][11:15] == ["부정", None, "300 오르면", 300]
    assert cr[3][10:12] == ["O", "단순비난"] and cr[0][10:12] == [None, "중립"]
    assert len(cr) == 7 and [r[2] for r in cr[4:]] == [4, 4, 4]  # 신형 견적(옛 화면 모양) 글의 댓글 3개
    assert ws["F5"].hyperlink.target == "https://cafe.naver.com/trailer/1001"
    # 구간별 여론: 기준 사건 전후 숫자 + 숫자로 본 변화
    ws = wb["구간별 여론"]
    st = {r[1].value: [c.value for c in r][1:] for r in ws.iter_rows(min_row=6)}
    assert list(st) == ["① 아반떼 가격 공개 전", "② 아반떼 가격 공개 후", "③ 투싼 가격 공개 후"]
    a = st["① 아반떼 가격 공개 전"]
    assert a[1] == "2026-09-01 ~ 2026-10-11" and a[2:4] == [41, 2] and a[5:8] == [0, 1, 1] and a[9] == 0.5
    assert a[10:13] == [2, 250, 250]  # 예상 가격 언급 글 · 인상 폭 평균 · 중앙값
    assert st["② 아반떼 가격 공개 후"][3] == 1 and st["② 아반떼 가격 공개 후"][14] == 1  # 투싼 비교 언급
    assert st["③ 투싼 가격 공개 후"][1] == "2026-10-14 ~ 2026-10-20" and st["③ 투싼 가격 공개 후"][2] == 7
    # 댓글 여론 열 (가격 관련 댓글 수 · 긍정 · 중립 · 부정 · 단순비난 · 부정·비난 비율 · 금액 언급 · 인상액 평균)
    assert st["② 아반떼 가격 공개 후"][19:27] == [1, 0, 0, 1, 0, 1, 1, None]
    assert st["③ 투싼 가격 공개 후"][19:27] == [2, 0, 0, 1, 1, 1, 0, 300]
    assert "가격 관련 댓글 1개" in ws["B3"].value
    assert "[숫자로 본 변화]" in ws["B3"].value and "부정 비율" in ws["B3"].value and "기준 사건 2026-10-12 아반떼 가격 공개" in ws["B2"].value
    assert ws["J6"].number_format == "0%"
    # 주별 추이: 월요일 시작 · 사건이 있는 주 표시
    ws = wb["주별 추이"]
    weeks = [[c.value for c in r][1:] for r in ws.iter_rows(min_row=4)]
    assert weeks[0][0] == "2026-09-01 ~ 09-06" and sum(w[3] for w in weeks) == 4
    ev = {w[0]: w[2] for w in weeks}
    assert ev["2026-10-12 ~ 10-18"] == "10-12 아반떼 가격 공개, 10-14 투싼 가격 공개"


def fake_claude(route, calls):
    """Claude API 흉내: 글 판단(본문에 '만원' 이 있으면 F/L 예상 가격 글)과 여론 변화 보고를 구분해 답한다 (스트리밍 형식)."""
    body = json.loads(route.request.post_data)
    data = json.loads(body["messages"][0]["content"].split("\n\n", 1)[1])
    calls.append(body)
    if "달린 댓글들" in body["system"]:
        out = {"items": [{"id": x["id"], "relevant": "축하" not in x["댓글"], "tone": "단순비난" if "호구" in x["댓글"] else "중립" if "축하" in x["댓글"] else "부정",
                          "amount": "4,500만 원대 (AI)" if "4,500" in x["댓글"] else "", "raiseText": "300 인상" if "300" in x["댓글"] else "",
                          "raise": 300 if "300" in x["댓글"] else None, "point": "가격 부담"} for x in data]}
    elif "여론 보고서" in body["system"]:
        out = {"overall": ["투싼 가격 공개 후 F/L 인상 우려가 커짐"], "stages": [{"stage": s["구간"], "summary": f"{s['구간']} 요지"} for s in data["구간"]]}
    else:
        out = {"items": [{"id": x["id"], "relevant": "만원" in x["본문"], "tone": "부정", "expect": "300만 원 인상 예상" if "300" in x["본문"] else "",
                          "raise": 300 if "300" in x["본문"] else None, "compare": [], "impact": "대기·관망", "point": "인상 폭 우려",
                          "summary": f"{x['제목']} 가격 이야기를 하는 내용."} for x in data]}
    ev = lambda t, d: f"event: {t}\ndata: {json.dumps(d, ensure_ascii=False)}\n\n"
    sse = (ev("message_start", {"type": "message_start", "message": {"id": "m", "type": "message", "role": "assistant", "model": body["model"],
                                                                     "content": [], "stop_reason": None, "usage": {"input_tokens": 1000, "output_tokens": 0}}})
           + ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
           + ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": json.dumps(out, ensure_ascii=False)}})
           + ev("content_block_stop", {"type": "content_block_stop", "index": 0})
           + ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 200}})
           + ev("message_stop", {"type": "message_stop"}))
    route.fulfill(status=200, headers={"content-type": "text/event-stream", "access-control-allow-origin": "*"}, body=sse)


@needs_chromium
def test_ai_summary(tmp_path: Path):
    """AI 를 켜면 본문을 읽는 대로 AI 가 예상 가격 언급 여부·여론을 판단하고, 여론 변화 보고를 써서 엑셀·데이터 DB 에 넣는다."""
    server = start_server(tmp_path)
    with sync_playwright() as p:
        ctx, page, errors = launch(p, tmp_path, server)
        calls = []
        ctx.route("https://api.anthropic.com/v1/messages**", lambda route: fake_claude(route, calls))
        set_value(page, "#events", EVENTS)
        set_value(page, "#startDate", "2026-10-01")
        set_value(page, "#endDate", "2026-10-20")
        base = "cafeIndex:0,cafeName:'싼타페MX5패밀리',slug:'trailer',hasTime:false,queries:['q'],touched:false,summary:'',by:'',bodyNote:'',bodyRead:false,body:'',text:''"
        page.evaluate(f"""items = [
          {{key:'trailer/1001',articleId:'1001',title:'페리 가격 얼마나 오를까요',checked:true,date:new Date(2026,9,10).getTime(),{base}}},
          {{key:'trailer/1002',articleId:'1002',title:'페리 디자인 유출 사진',checked:true,date:new Date(2026,9,11).getTime(),{base}}},
        ]; renderResults();""")
        page.evaluate("document.getElementById('panelAi').open = true")
        page.fill("#aiKey", "sk-ant-test")
        page.click("#aiSave")
        assert page.is_checked("#aiOn") and page.inner_text("#readBodies").startswith("💰") and page.inner_text("#writeReport").startswith("💰")
        page.locator("#settings summary").click()
        set_value(page, "#aiRules", "- 하이브리드 가격은 따로 적는다")
        page.click("#readBodies")
        page.locator("#summary", has_text="AI 로 판단·요약했습니다").wait_for(timeout=60000)
        got = page.evaluate("Object.fromEntries(items.map(x => [x.key, [x.checked, x.by, x.summary, x.nickname, x.tone, x.raise, x.impact]]))")
        assert got == {
            "trailer/1001": [True, "ai", "페리 가격 얼마나 오를까요 가격 이야기를 하는 내용", "싼타기다림", "부정", 300, "대기·관망"],  # 끝 마침표는 뗌
            "trailer/1002": [False, "ai", "페리 디자인 유출 사진 가격 이야기를 하는 내용", "페리러버", "부정", None, "대기·관망"],  # 예상 가격 언급 없음 → 해제
        }, got
        assert len(calls) == 2 and "달린 댓글들" in calls[1]["system"]  # 글 판단 1번 + 댓글 판단 1번
        system = calls[0]["system"]
        assert "예상 가격" in system and "하이브리드 가격은 따로 적는다" in system and "2026-10-14 투싼 가격 공개" in system and "현행 차량 가격은 넣지 않음" in system
        sent = json.loads(calls[0]["messages"][0]["content"].split("\n\n", 1)[1])
        assert "300만원" in sent[0]["본문"] and sent[0]["구간"] == "① 아반떼 가격 공개 전" and "싼타기다림" not in json.dumps(sent, ensure_ascii=False)
        assert "체크 해제" in page.locator("#results tbody tr", has_text="페리 디자인 유출 사진").inner_text()

        # 엑셀 받기: 보고가 없으면 AI 가 여론 변화 보고를 먼저 씀
        with page.expect_download() as dl:
            page.click("#saveExcel")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        page.locator("#saveInfo", has_text="데이터 DB에 오늘 파일로 저장").wait_for()
        assert len(calls) == 3 and "여론 보고서" in calls[2]["system"]
        assert "투싼 가격 공개 후 F/L 인상 우려가 커짐" in page.inner_text("#reportText")
        rec = page.evaluate("dbLatest('price').then(r => r.stats)")
        assert rec["aiCost"] > 0 and rec["time"]["read"] > 0 and rec["time"]["report"] >= 0 and rec["neg"] == 1
        assert not errors, errors
        ctx.close()
    server.shutdown()

    wb = load_workbook(path)
    ws = wb["구간별 여론"]
    assert "[보고 요지]" in ws["B3"].value and "- 투싼 가격 공개 후 F/L 인상 우려가 커짐" in ws["B3"].value
    assert ws["AC6"].value == "① 아반떼 가격 공개 전 요지"
    cr = [[c.value for c in r][1:] for r in wb["댓글"].iter_rows(min_row=4)]
    assert [r[11] for r in cr] == ["중립", "부정", "부정", "단순비난"] and cr[1][12] == "4,500만 원대 (AI)" and cr[2][14] == 300
    r = [c.value for c in wb["게시물"][4]][1:]
    assert r[10:16] == ["부정", "300만 원 인상 예상", 300, None, "대기·관망", "인상 폭 우려"]
