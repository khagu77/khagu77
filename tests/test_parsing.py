import os
from pathlib import Path

from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

import naver_cafe_comments as m


def test_parse_article_url_variants():
    assert m.parse_article_url("https://cafe.naver.com/ca-fe/cafes/123/articles/456?boardtype=L") == ("123", "456")
    assert m.parse_article_url("https://cafe.naver.com/f-e/cafes/123/articles/456") == ("123", "456")
    assert m.parse_article_url("https://m.cafe.naver.com/ca-fe/web/cafes/123/articles/456") == ("123", "456")
    assert m.parse_article_url("https://cafe.naver.com/ArticleRead.nhn?clubid=123&articleid=456") == ("123", "456")
    assert m.parse_article_url(
        "https://cafe.naver.com/mycafe?iframe_url_utf8=%2FArticleRead.nhn%253Fclubid%3D123%2526articleid%3D456"
    ) == ("123", "456")
    assert m.parse_article_url("https://cafe.naver.com/mycafe/456") == (None, "456")
    assert m.parse_article_url("https://example.com/") == (None, None)


def test_parse_comment_items():
    payload = {"result": {"comments": {"items": [
        {"id": 1, "refId": 1, "writer": {"id": "abc", "nick": "철수"}, "content": "첫 댓글",
         "updateDate": 1700000000000, "isDeleted": False},
        {"id": 2, "refId": 1, "isRef": True, "writer": {"id": "def", "nick": "영희"}, "content": "답글",
         "updateDate": 1700000100000, "sticker": {"url": "https://s/x.png"}},
    ]}}}
    items = m.extract_comment_items(payload)
    c1, c2 = (m.parse_comment_item(i) for i in items)
    assert (c1.nickname, c1.writer_id, c1.is_reply, c1.parent_id) == ("철수", "abc", False, "")
    assert (c2.is_reply, c2.parent_id, c2.attachment) == (True, "1", "https://s/x.png")
    assert c1.written_at.startswith("2023-11-1")
    assert m.extract_comment_items({"result": {}}) is None


def test_dom_extract():
    html = """
    <div class="CommentBox"><ul>
      <li id="c1" class="CommentItem"><a class="comment_nickname">철수</a>
        <span class="text_comment">안녕하세요</span><span class="comment_info_date">2024.01.01. 10:00</span></li>
      <li id="c2" class="CommentItem CommentItem--reply"><a class="comment_nickname">영희</a>
        <span class="text_comment">반가워요</span><span class="comment_info_date">2024.01.01. 11:00</span></li>
    </ul></div>"""
    with sync_playwright() as p:
        exe = os.environ.get("CHROMIUM_PATH")
        b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = b.new_page()
        page.set_content(html)
        rows = page.evaluate(m._DOM_EXTRACT_JS)
        b.close()
    cs = m.dom_rows_to_comments(rows)
    assert [(c.nickname, c.content, c.is_reply, c.parent_id) for c in cs] == [
        ("철수", "안녕하세요", False, ""), ("영희", "반가워요", True, "c1")]


def test_save_excel(tmp_path: Path):
    r = m.ArticleResult(url="u", cafe_id="1", article_id="2", title="제목", method="API",
                        comments=[m.Comment("1", False, "", "철수", "abc", "내용\x01", "2024-01-01")])
    bad = m.ArticleResult(url="v", error="권한 없음")
    out = m.save_excel([r, bad], tmp_path / "out.xlsx")
    wb = load_workbook(out)
    rows = list(wb["댓글"].values)
    assert rows[0] == tuple(m.COMMENT_HEADERS)
    assert rows[1][9] == "철수" and rows[1][11] == "내용"
    summary = list(wb["요약"].values)
    assert summary[1][-1] == "성공" and summary[2][-1] == "권한 없음"
