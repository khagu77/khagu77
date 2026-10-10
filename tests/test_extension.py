"""크롬 확장프로그램 통합 테스트.

실제 네이버/유튜브 대신 가짜 응답(route)을 넣고, 확장 화면에서 수집 → 엑셀 다운로드까지 확인한다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
from datetime import date
from pathlib import Path

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

EXT_DIR = Path(__file__).resolve().parent.parent / "chrome-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

NAVER_COMMENTS = {
    1: {"result": {"comments": {"items": [
        {"id": 10, "refId": 10, "writer": {"id": "abc", "nick": "철수"}, "content": "첫 댓글", "updateDate": 1700000000000},
        {"id": 11, "refId": 10, "isRef": True, "writer": {"id": "def", "nick": "영희"}, "content": "답글", "updateDate": 1700000100000},
    ]}}},
    2: {"result": {"comments": {"items": [
        {"id": 12, "refId": 12, "writer": {"id": "ghi", "nick": "민수"}, "content": "둘째 페이지", "updateDate": 1700000200000},
    ]}}},
}


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
    car = wb.create_sheet("자동차 커뮤니티")
    car.append(headers)
    car.append([1, "뽐뿌", "2026.03.14", "커뮤니티 댓글", "https://www.ppomppu.co.kr/x"])
    wb.save(path)


def run_extension(tmp_path: Path, urls, template=None, re_youtube=True, fail_video=None):
    requested_tokens = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}"],
            accept_downloads=True,
        )

        def naver(route):
            url = route.request.url
            if "/comments/pages/" in url:
                page_no = int(url.split("/comments/pages/")[1].split("?")[0])
                body = NAVER_COMMENTS.get(page_no, {"result": {"comments": {"items": []}}})
            elif "CafeGateInfo" in url:
                body = {"message": {"result": {"cafeInfoView": {"cafeId": 777}}}}
            else:
                body = {"result": {"article": {"subject": "카페 글 제목", "writer": {"nick": "글쓴이"}},
                                   "cafe": {"url": "testcafe"}}}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        def youtube(route):
            if "/youtubei/v1/next" in route.request.url:
                token = json.loads(route.request.post_data)["continuation"]
                requested_tokens.append(token)
                route.fulfill(status=200, content_type="application/json", body=json.dumps(YT_PAGES.get(token, {})))
            elif fail_video and fail_video in route.request.url:
                route.fulfill(status=404, body="")
            else:
                route.fulfill(status=200, content_type="text/html", body=YT_HTML)

        ctx.route("https://apis.naver.com/**", naver)
        ctx.route("https://www.youtube.com/**", youtube)

        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        page = ctx.new_page()
        page.goto(f"chrome-extension://{ext_id}/app.html")
        if template:
            page.set_input_files("#templateFile", str(template))
            page.locator("#templateInfo", has_text="✔").wait_for()
        if not re_youtube:
            page.uncheck("#reYt")
        page.fill("#urls", "\n".join(urls))
        with page.expect_download(timeout=60000) as dl:
            page.click("#start")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        page.locator("#summary", has_text="저장되었습니다").wait_for()
        summary = page.inner_text("#summary")
        ctx.close()
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
    path, summary, _ = run_extension(tmp_path, URLS, template=tpl, fail_video="keepkeepkee")
    assert path.name == f"{date.today():%Y%m%d}_현대차_raw_data_정리.xlsx"
    assert "동호회 5개 추가(연번 3~7)" in summary and "이미 있던 댓글 1개 제외" in summary

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
    # 실패한 영상(keepkeepkee)은 기존 행 유지, 다시 수집한 영상은 새 댓글로 교체
    assert [r[3] for r in yt[1:]] == ["남겨둘 영상 댓글", "좋아요", "답글이에요", "멋져요", "마지막"]
    assert [r[0] for r in yt[1:]] == [1, 2, 3, 4, 5]
    assert "다시 수집될 영상의 옛 댓글" not in [r[3] for r in yt]
