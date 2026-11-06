"""카페·유튜브 댓글 수집기(comment-extension) 통합 테스트.

LX3 수집기(chrome-extension) 테스트의 가짜 카페·유튜브·네이버 뉴스·자동차 커뮤니티 화면을 그대로 쓴다.
"""
import json
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_extension import (  # noqa: E402
    CHROMIUM, URLS, YT_HTML, YT_PAGES, make_template, news_cbox, seoul_today, start_fake_cafe, start_fake_sites,
)

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "comment-extension"
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

SITE_HOSTS = ["n.news.naver.com", "www.bobaedream.co.kr", "www.clien.net", "www.ppomppu.co.kr"]


def youtube_route(down):
    def handler(route):
        if down["on"]:
            return route.fulfill(status=503, body="")
        if "/youtubei/" in route.request.url:
            token = json.loads(route.request.post_data or "{}").get("continuation")
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(YT_PAGES.get(token, {})))
        return route.fulfill(status=200, content_type="text/html", body=YT_HTML)
    return handler


def open_ext(p, tmp_path, cafe_port, sites_port=None):
    rules = [f"MAP cafe.naver.com 127.0.0.1:{cafe_port}"]
    if sites_port:
        rules += [f"MAP {h} 127.0.0.1:{sites_port}" for h in SITE_HOSTS]
    ctx = p.chromium.launch_persistent_context(
        str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
        args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}",
              "--host-resolver-rules=" + ", ".join(rules), "--no-proxy-server", "--ignore-certificate-errors"],
        accept_downloads=True)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    return ctx, f"chrome-extension://{sw.url.split('/')[2]}"


def test_manifest_and_page(tmp_path: Path):
    m = json.loads((EXT_DIR / "manifest.json").read_text())
    assert m["name"] == "카페·유튜브 댓글 수집기"
    assert "key" not in m  # 예전 설치 폴더에 덮어쓰면 ID 가 그대로
    for size in ("16", "32", "48", "128"):
        assert (EXT_DIR / m["icons"][size]).exists()
    server = start_fake_cafe(tmp_path)
    with sync_playwright() as p:
        ctx, ext = open_ext(p, tmp_path, server.server_address[1])
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{ext}/app.html")
        page.wait_for_timeout(1000)
        assert page.inner_text("h1") == "카페·유튜브 댓글 수집기"
        assert page.inner_text("#ver") == f"v{m['version']}"
        assert [t.replace("\n", "") for t in page.locator("nav.menu a").all_inner_texts()] == ["1💬 댓글 수집", "2🗄 최종 DB"]  # 팰리세이드 메뉴 없음
        assert page.locator("a[href*='lx3']").count() == 0
        assert not errors, errors
        ctx.close()
    server.shutdown()


def test_cafe_youtube_db(tmp_path: Path):
    """카페·유튜브: 처음엔 새 파일(최종 DB에 오늘 파일로 저장) → 다음 수집은 최종 DB 파일에 이어 쓰기(중복 제외)
    → 기존 엑셀을 직접 고르면 그 파일에 이어 쓰기 → 최종 DB 화면에 날짜별로 보임."""
    server = start_fake_cafe(tmp_path)
    tpl = tmp_path / "20261008_현대차_raw_data_정리.xlsx"
    make_template(tpl)
    with sync_playwright() as p:
        ctx, ext = open_ext(p, tmp_path, server.server_address[1])
        down = {"on": False}
        ctx.route("https://www.youtube.com/**", youtube_route(down))
        page = ctx.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{ext}/app.html")
        page.fill("#urls", "\n".join(URLS))
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        blank = tmp_path / "blank.xlsx"
        dl.value.save_as(blank)
        assert dl.value.suggested_filename == f"{seoul_today():%Y%m%d}_raw_data.xlsx"
        assert any("최종 DB에도 파일이 없습니다" in m for m in dialogs), dialogs
        page.locator("#summary", has_text="최종 DB에 오늘 파일로 저장했습니다").wait_for()
        wb = load_workbook(blank)
        assert wb.sheetnames == ["언론", "동호회", "유튜브", "자동차 커뮤니티"]
        assert [r[0] for r in list(wb["동호회"].values)[1:]] == [1, 2, 3, 4, 5, 6]
        assert [r[3] for r in list(wb["유튜브"].values)[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막"]

        # 다시 수집: 최종 DB의 오늘 파일에 이어 쓰고, 이미 있는 댓글은 뺌
        page.locator("#templateInfo", has_text="최종 DB 파일").wait_for()
        dialogs.clear()
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        again = tmp_path / "again.xlsx"
        dl.value.save_as(again)
        assert not any("최종 DB에도 파일이 없습니다" in m for m in dialogs), dialogs
        page.locator("#summary", has_text="저장되었습니다").wait_for()
        assert "이미 있던 댓글 6개 제외" in page.inner_text("#summary"), page.inner_text("#summary")
        assert [r[0] for r in list(load_workbook(again)["동호회"].values)[1:]] == [1, 2, 3, 4, 5, 6]

        # 기존 엑셀을 직접 고르면 그 파일에 이어 씀
        page.set_input_files("#templateFile", str(tpl))
        page.locator("#templateInfo", has_text="20261008_현대차").wait_for()
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        cont = tmp_path / "cont.xlsx"
        dl.value.save_as(cont)
        assert dl.value.suggested_filename == f"{seoul_today():%Y%m%d}_현대차_raw_data_정리.xlsx"
        page.locator("#summary", has_text="저장되었습니다").wait_for()
        summary = page.inner_text("#summary")
        assert "동호회 5개 추가(연번 3~7)" in summary and "이미 있던 댓글 1개 제외" in summary, summary
        assert [r[0] for r in list(load_workbook(cont)["동호회"].values)[1:]] == [1, 2, 3, 4, 5, 6, 7]

        # 최종 DB 화면: 댓글 raw data 만, 오늘 파일이 '최종'
        page.goto(f"{ext}/db.html")
        page.locator("section[data-kind=raw] tbody tr.final").wait_for()
        assert page.locator("section[data-kind]").count() == 1
        row = page.inner_text("section[data-kind=raw] tbody tr.final")
        assert "최종" in row and f"{seoul_today():%Y%m%d}_현대차_raw_data_정리.xlsx" in row, row
        with page.expect_download() as dl:
            page.click("section[data-kind=raw] tbody tr.final .get")
        assert dl.value.suggested_filename == f"{seoul_today():%Y%m%d}_현대차_raw_data_정리.xlsx"
        assert not errors, errors
        ctx.close()
    server.shutdown()


def test_news_community(tmp_path: Path):
    """네이버 뉴스 댓글(답글 포함)·자동차 커뮤니티(보배드림·클리앙·뽐뿌) 댓글 ('별도 파일로 작성')."""
    cafe = start_fake_cafe(tmp_path)
    sites = start_fake_sites(tmp_path)
    with sync_playwright() as p:
        ctx, ext = open_ext(p, tmp_path, cafe.server_address[1], sites.server_address[1])
        ctx.route("https://apis.naver.com/**", lambda route: route.fulfill(
            status=200, content_type="text/javascript; charset=utf-8", body=news_cbox(route.request.url)))
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{ext}/app.html")
        page.check("#separate")
        page.fill("#urls", "\n".join([
            "https://n.news.naver.com/mnews/article/001/0000000001",
            "https://www.bobaedream.co.kr/view?code=national&No=2398545",
            "https://www.clien.net/service/board/cm_car/111",
            "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980149",
        ]))
        with page.expect_download(timeout=240000) as dl:
            page.click("#start")
        raw = tmp_path / "raw.xlsx"
        dl.value.save_as(raw)
        progress = page.inner_text("#progress")
        wb = load_workbook(raw)
        assert [r[3] for r in list(wb["언론"].values)[1:]] == ["리콜 빨리 해라", "답글도 모아요", "아이 키우는 집은 무섭겠다"], progress
        comm = [(r[1], r[3]) for r in list(wb["자동차 커뮤니티"].values)[1:]]
        assert comm == [
            ("보배드림", "서비스센터 가 보세요"), ("보배드림", "저도 같은 증상이에요"),
            ("클리앙", "센터 예약하세요"), ("클리앙", "리콜 대상인지 확인해 보세요"),
            ("뽐뿌", "리콜 소식 반갑네요"), ("뽐뿌", "끼임 사고 무섭다"), ("뽐뿌", "둘째 쪽 댓글 하나"), ("뽐뿌", "둘째 쪽 댓글 둘"),
        ], (comm, progress)
        page.locator("#summary", has_text="저장되었습니다").wait_for()
        summary = page.inner_text("#summary")
        assert "언론 3개 추가" in summary and "자동차 커뮤니티 8개 추가" in summary, summary
        assert "최종 DB" not in summary  # 별도 파일은 최종 DB에 저장 안 함
        assert page.evaluate("dbList('raw')") == []
        assert not errors, errors
        ctx.close()
    cafe.shutdown()
    sites.shutdown()


def test_retry_and_resume(tmp_path: Path):
    """실패한 것만 다시 수집 · 중단 후 이어하기(이미 한 것은 다시 하지 않음)."""
    server = start_fake_cafe(tmp_path)
    with sync_playwright() as p:
        ctx, ext = open_ext(p, tmp_path, server.server_address[1])
        down = {"on": False}
        ctx.route("https://www.youtube.com/**", youtube_route(down))
        page = ctx.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        page.goto(f"{ext}/app.html")
        page.wait_for_timeout(1000)

        # 1) 카페 글은 되고 유튜브는 실패 → '다시 수집'은 유튜브만, 최종 DB의 오늘 파일에 이어 씀
        page.fill("#urls", "https://cafe.naver.com/mycafe/789\nhttps://youtu.be/abcdefghijk")
        down["on"] = True
        with page.expect_download(timeout=120000):
            page.click("#start")
        page.locator("#retryFailed", has_text="실패한 1개 다시 수집").wait_for(timeout=10000)
        down["on"] = False
        before = len(server.requests)
        with page.expect_download(timeout=60000) as dl:
            page.click("#retryFailed")
        retried = tmp_path / "retried.xlsx"
        dl.value.save_as(retried)
        assert len(server.requests) == before  # 카페 글은 다시 열지 않음
        wb = load_workbook(retried)
        assert [r[3] for r in list(wb["동호회"].values)[1:]] == ["첫 댓글", "답글", "둘째 페이지"]  # 앞의 카페 댓글 유지
        assert [r[3] for r in list(wb["유튜브"].values)[1:]] == ["좋아요", "답글이에요", "멋져요", "마지막"]
        assert page.is_hidden("#retryFailed")

        # 2) 2개 중 1개 끝난 상태로 중단됨 → 다시 열면 이어서 2번째만
        page.goto(f"{ext}/app.html")
        page.wait_for_timeout(1500)
        page.evaluate("""() => saveResume('comments', {
          urls: ['https://cafe.naver.com/mycafe/790', 'https://youtu.be/abcdefghijk'], done: 1, separate: true, attached: false,
          results: [{ platform: 'cafe', url: 'https://cafe.naver.com/mycafe/790', sheetUrl: 'https://cafe.naver.com/mycafe/790', cafeId: '',
            cafeUrl: 'mycafe', articleId: '790', title: '', author: '', method: '화면', error: '',
            comments: [{ commentId: 'x', isReply: false, parentId: '', nickname: 'a', content: '중단 전 댓글', writtenAt: '2026.10.19. 10:00', isDeleted: false }] }] })""")
        before = len(server.requests)
        with page.expect_download(timeout=60000) as dl:
            page.reload()
        out = tmp_path / "resumed.xlsx"
        dl.value.save_as(out)
        assert any("중단된 댓글 수집이 있습니다 (2개 중 1개 완료" in m for m in dialogs), dialogs
        assert len(server.requests) == before
        wb = load_workbook(out)
        assert [r[3] for r in list(wb["동호회"].values)[1:]] == ["중단 전 댓글"]
        assert page.evaluate("loadResume('comments')") is None
        ctx.close()
    server.shutdown()


@pytest.mark.parametrize("name", ["cafe-common.js", "template.js", "xlsx.js", "bg-render.js", "db-store.js", "db.js", "app.css"])
def test_shared_files_match(name):
    """LX3 수집기와 함께 쓰는 파일은 같은 내용 (한쪽만 고치지 않게)."""
    assert (EXT_DIR / name).read_bytes() == (ROOT / "chrome-extension" / name).read_bytes()


PPOM_API = {
    "1": {"c_page": 1, "total_page": 2, "total_comment": 5, "comments": [
        {"no": 1, "memo": "첫 댓글<br>둘째 줄", "regdate": "2026-11-05 10:20:30", "depth": 0},
        {"no": 2, "memo": "답글이에요", "regdate": "2026-11-05 10:25:00", "depth": 1},
        {"no": 3, "comment": "<b>굵은</b> 댓글", "wdt": 1762306200, "depth": 0},
    ]},
    "2": {"c_page": 2, "total_page": 2, "total_comment": 5, "comments": [
        {"no": 4, "memo": "둘째 쪽 하나", "info": {"reg_date": "2026-11-06 08:00:00"}},
        {"no": 5, "memo": "둘째 쪽 둘", "regdate": "2026-11-06 09:00:00"},
    ]},
}


def test_ppomppu_comment_list(tmp_path: Path):
    """뽐뿌: 화면 버튼을 누르지 않고 댓글 목록(comment.php JSON)을 1쪽부터 끝까지 받아 모두 수집 (작성일·답글·HTML 정리)."""
    from urllib.parse import parse_qs, urlparse
    cafe = start_fake_cafe(tmp_path)
    sites = start_fake_sites(tmp_path)
    with sync_playwright() as p:
        ctx, ext = open_ext(p, tmp_path, cafe.server_address[1], sites.server_address[1])
        asked = []

        def api(route):
            q = parse_qs(urlparse(route.request.url).query)
            asked.append(q)
            route.fulfill(status=200, content_type="application/json", body=json.dumps(PPOM_API.get(q["c_page"][0], {}), ensure_ascii=False))

        ctx.route("https://www.ppomppu.co.kr/zboard/comment.php*", api)
        page = ctx.new_page()
        page.goto(f"{ext}/app.html")
        page.check("#separate")
        page.fill("#urls", "https://www.ppomppu.co.kr/zboard/view.php?id=car&no=980149")
        with page.expect_download(timeout=180000) as dl:
            page.click("#start")
        raw = tmp_path / "raw.xlsx"
        dl.value.save_as(raw)
        progress = page.inner_text("#progress")
        assert [q["c_page"][0] for q in asked] == ["1", "2"], asked
        assert all(q["cmd"] == ["get_comment_json"] and q["id"] == ["car"] and q["no"] == ["980149"] for q in asked)
        rows = [(r[1], r[2], r[3]) for r in list(load_workbook(raw)["자동차 커뮤니티"].values)[1:]]
        assert [r[2] for r in rows] == ["첫 댓글 둘째 줄", "답글이에요", "굵은 댓글", "둘째 쪽 하나", "둘째 쪽 둘"], (rows, progress)
        assert all(r[0] == "뽐뿌" for r in rows)
        assert str(rows[0][1]).startswith("2026") and str(rows[3][1]).startswith("2026"), rows  # 작성일도 들어감
        assert "뽐뿌 댓글 목록" in progress, progress
        ctx.close()
    cafe.shutdown()
    sites.shutdown()
