"""크롬 확장프로그램 통합 테스트.

실제 네이버/유튜브 대신 가짜 응답(route)을 넣고, 확장 화면에서 수집 → 엑셀 다운로드까지 확인한다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
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


def test_extension_end_to_end(tmp_path: Path):
    requested_tokens = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
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
                body = {"result": {"article": {"subject": "카페 글 제목", "writer": {"nick": "글쓴이"}}}}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        def youtube(route):
            if "/youtubei/v1/next" in route.request.url:
                token = json.loads(route.request.post_data)["continuation"]
                requested_tokens.append(token)
                route.fulfill(status=200, content_type="application/json", body=json.dumps(YT_PAGES.get(token, {})))
            else:
                route.fulfill(status=200, content_type="text/html", body=YT_HTML)

        ctx.route("https://apis.naver.com/**", naver)
        ctx.route("https://www.youtube.com/**", youtube)

        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        page = ctx.new_page()
        page.goto(f"chrome-extension://{ext_id}/app.html")
        page.fill("#urls", "\n".join([
            "https://cafe.naver.com/ca-fe/cafes/123/articles/456",
            "https://cafe.naver.com/mycafe/789",
            "https://youtu.be/abcdefghijk",
        ]))
        with page.expect_download(timeout=60000) as dl:
            page.click("#start")
        path = tmp_path / "out.xlsx"
        dl.value.save_as(path)
        summary = page.inner_text("#summary")
        ctx.close()

    assert "댓글 10개" in summary
    assert "SORT_NEW" not in requested_tokens
    wb = load_workbook(path)
    assert wb.sheetnames == ["카페 댓글", "유튜브 댓글", "요약"]

    cafe = list(wb["카페 댓글"].values)
    assert [r[9] for r in cafe[1:]] == ["철수", "영희", "민수", "철수", "영희", "민수"]
    assert cafe[1][1] == "123" and cafe[4][1] == "777"  # 짧은 주소는 카페ID 조회
    assert cafe[2][6] == "답글" and cafe[2][8] == "10"
    assert cafe[1][3] == "카페 글 제목"

    yt = list(wb["유튜브 댓글"].values)
    assert [(r[8], r[5]) for r in yt[1:]] == [("앨리스", "댓글"), ("찰리", "답글"), ("밥", "댓글"), ("데이브", "댓글")]
    assert yt[1][2] == "테스트 영상 {괄호}" and yt[1][3] == "채널A"
    assert yt[2][7] == "A" and yt[1][12] == 3 and yt[4][12] == "1.2천"

    summary_rows = list(wb["요약"].values)
    assert [r[-1] for r in summary_rows[1:]] == ["성공", "성공", "성공"]
