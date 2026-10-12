"""온라인 오전동향 PPT 보고서 작성기(report-extension) 통합 테스트.

가짜 카페 게시글(로컬 HTTPS 서버를 cafe.naver.com 으로 연결)과 가짜 Claude 응답으로
엑셀 선택 → 캡처 → AI 요약 → PPT 받기까지 확인한다.
템플릿 PPT 는 실제 보고서와 같은 구조(표지 / 요약표 / 구분 정의 / 상세 슬라이드)로 테스트 안에서 만든다.
확장 로딩에는 headless-shell 이 아닌 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

EXT_DIR = Path(__file__).resolve().parent.parent / "report-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

PNG_1PX = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

def _photo_png():
    """본문 첨부 사진(원본 1200x900 PNG). 확장은 화면 캡처 대신 이 원본 파일을 받아 써야 한다."""
    import base64
    import io as _io
    from PIL import Image, ImageDraw

    im = Image.new("RGB", (1200, 900), "#ff8800")
    ImageDraw.Draw(im).ellipse((360, 210, 840, 690), fill="#0066cc")
    buf = _io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


PHOTO = _photo_png()

def _svg(body, w, h):
    import base64
    return "data:image/svg+xml;base64," + base64.b64encode(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">{body}</svg>'.encode()).decode()


PROFILE = _svg('<circle cx="18" cy="18" r="18" fill="#cc00ff"/>', 36, 36)  # 사진 프로필(보라)
# 네이버 기본 프로필처럼 아주 연한 회색 동그라미 — 배경으로 오인해 잘라내면 안 된다
LIGHT = (224, 232, 240)
DEFAULT_PROFILE = _svg('<circle cx="18" cy="18" r="18" fill="#e0e8f0"/>', 36, 36)
STICKER = _svg('<rect width="80" height="80" fill="#00ff00"/>', 80, 80)


def comment_li(nick, text, cls="", extra="", profile=PROFILE):
    # 하트·… 버튼(주황)은 댓글 칸 오른쪽 밖으로 살짝 튀어나와 있다
    return (f'<li class="CommentItem {cls}" style="position:relative">'
            '<button class="comment_tool" style="position:absolute;right:-30px;top:0;width:16px;height:16px;'
            f'border:0;background:#ff8800"></button><div class="comment_thumb"><img src="{profile}" width="36" height="36"></div>'
            f'<a class="comment_nickname">{nick}</a>{extra}<span class="text_comment">{text}</span>'
            '<span class="comment_info_date">2026.10.06. 11:00</span></li>')


# 새 카페 화면(f-e) 흉내: og:url 이 없고, 'URL 복사' 버튼이 짧은 주소를 복사한다.
# 제목 영역(article_header) 안에 게시판 이름·제목·작성자(연회색 기본 프로필)·작성일·URL 복사가 있고,
# 글 아래에는 '님의 게시글 더보기' 작성자 영역(article_writer)이 따로 있다.
ARTICLE_HTML = f"""<html><head><meta charset="utf-8"><style>
body{{margin:0;font:16px/1.6 sans-serif;color:#222;background:#fff}}
.top{{position:fixed;top:0;left:0;right:0;height:40px;background:#03c75a}}
.wrap{{width:860px;margin:60px auto}}
.article_header{{border-bottom:1px solid #ddd;padding:10px 0;position:relative}}
.avatar{{display:inline-block;width:40px;height:40px;border-radius:50%;background:#e0e8f0;vertical-align:middle}}
.title_text{{font-size:26px;margin:0}}
.copy{{position:absolute;right:0;top:60px}}
.se-main-container p{{margin:0}}
.se-image img{{width:400px;height:300px;display:block}}
li.CommentItem{{list-style:none;padding:8px 0;border-bottom:1px solid #eee}}
</style></head><body><div class="top"><a href="https://cafe.naver.com/wrongname">카페 홈</a></div><div class="wrap">
<div class="ArticleContentBox"><div class="article_header">
<a class="link_board" href="/ca-fe/cafes/1/menus/5">ST1 질문 게시판 &gt;</a>
<h3 class="title_text">ST1 공조기가 혼자 켜집니다</h3>
<div class="WriterInfo"><span class="avatar"></span><a href="/ca-fe/cafes/1/members/abc"><span class="nickname">파주ll작성자</span></a></div>
<div class="article_info"><span class="date">2026.10.06. 10:00</span> <span class="count">조회 1,234</span></div>
<button class="copy" onclick="navigator.clipboard.writeText('https://cafe.naver.com/allfm01/2157343')">URL 복사</button>
</div>
<div class="article_container"><div class="se-main-container">
<div class="se-component se-text"><p>📍 함께하는 [ST1 클럽] 카페</p><p><br></p>
<p>질문은 질문 답변 게시판 이용해 주세요.</p><p>글쓰기에서 해당 게시판이 안 보이면 등업이 필요합니다.</p><p><br></p>
<p>카페 활동 예의를 지켜주세요.</p><p>경우에 따라 카페 운영 회칙에 의거 활동 정지 또는 탈퇴 처리될 수 있습니다.</p></div>
<div class="se-component se-horizontalLine"><hr style="width:360px;margin:0"></div>
<div class="se-component se-text">
<p>출고 2주 된 ST1 입니다.</p><p><br></p><p><br></p>
<p>시동만 걸면 공조기가 자동으로 켜지고</p><p><br></p><p><br></p><p><br></p>
<p>OFF 버튼을 눌러도 꺼지지 않습니다.</p></div>
<div class="se-component se-image"><img src="{PHOTO}"></div>
<div class="se-component se-text"><p>블루핸즈 예약했습니다.</p></div></div></div>
<div class="article_writer"><div class="profile_area"><span class="avatar"></span> 파주ll작성자 님의 게시글 더보기 &gt;</div></div>
<div class="ArticleTool"><a class="button_comment">댓글 5</a></div>
<div class="CommentBox"><ul>
{comment_li("회원1", "저도 같은 증상이에요")}
{comment_li("회원2", "저도요 ㅠ", "CommentItem--reply")}
{comment_li("파주ll작성자", "감사합니다", extra='<em class="comment_writer">작성자</em>')}
{comment_li("회원3", "사업소 가세요", profile=DEFAULT_PROFILE)}
{comment_li("회원4", "ㅋㅋ", extra=f'<div class="CommentItem__sticker"><img src="{STICKER}" width="80" height="80"></div>')}
</ul></div></div></div></body></html>"""

DELETED_HTML = ("<html><body><script>alert('삭제되었거나 존재하지 않는 게시글입니다.');</script>"
                "<p>삭제되었거나 존재하지 않는 게시글입니다.</p></body></html>")

AI_RESULT = {
    "issue": "공조기 자동 작동 및 OFF 불가",
    "spec": "EV",
    "short": "공조기 자동 작동 및 OFF 불가 발생",
    # 일부러 55자를 넘김 → 확장이 한 번 더 줄여 달라고 요청해야 함
    "body": "출고 2주 된 신차에서 시동을 걸 때마다 공조기가 자동으로 작동하고 OFF 버튼을 눌러도 꺼지지 않는다며 증상에 대해 문의하는 내용",
    "reaction": "‘저도 같은 증상이에요., 사업소에 가세요.’ 등의 여론",
    "level": "경고",
    "duplicate": "중복 2건",
    "region": "-",
    "comment_picks": [0, 1, 99],
}


SHORTENED = {
    "body": "출고 2주 된 차량에서 공조기가 자동 작동하고 OFF가 안 된다며 증상에 대해 문의하는 내용",
    "reaction": AI_RESULT["reaction"],
}


def sse_body(text):
    events = [
        ("message_start", {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant",
         "model": "claude-opus-5-5", "content": [], "stop_reason": None, "stop_sequence": None,
         "usage": {"input_tokens": 10, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
         "usage": {"output_tokens": 50}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {e}\ndata: {json.dumps(d, ensure_ascii=False)}\n\n" for e, d in events)


def make_template(path: Path):
    """실제 보고서와 같은 뼈대의 템플릿: 표지 날짜 / 요약표(8열) / 구분 정의 / 상세 슬라이드 2장(표 5x8 + 그림)."""
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Emu, Pt

    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(9906000), Emu(6858000)
    blank = prs.slide_layouts[6]

    s1 = prs.slides.add_slide(blank)
    s1.shapes.add_textbox(Emu(2336800), Emu(5733256), Emu(5232400), Emu(432048)).text_frame.text = "2026.10.12"
    s1.shapes.add_textbox(Emu(2336800), Emu(2636912), Emu(5232400), Emu(1440160)).text_frame.text = "현대차 온라인 이슈 보고서"

    s2 = prs.slides.add_slide(blank)
    s2.shapes.add_textbox(Emu(288261), Emu(233759), Emu(5040000), Emu(400000)).text_frame.text = "현대차 일일 온라인 이슈 – 2026.10.12"
    t = s2.shapes.add_table(4, 8, Emu(288261), Emu(1161290), Emu(9266180), Emu(1600000)).table
    for c, h in enumerate(["No.", "차종", "유형", "내용 요약", "댓글수", "이슈 신규/중복", "입고/운행지역", "집중관리고객"]):
        t.cell(0, c).text = h
    for r in (1, 2, 3):
        for c in range(8):
            t.cell(r, c).text = f"old{r}{c}"

    prs.slides.add_slide(blank).shapes.add_textbox(Emu(486375), Emu(233759), Emu(4827037), Emu(393634)).text_frame.text = "참고. 구분 값 정의"

    img = path.parent / "pic.png"
    img.write_bytes(__import__("base64").b64decode(PNG_1PX))
    for n in (1, 2):
        s = prs.slides.add_slide(blank)
        title = s.shapes.add_shape(1, Emu(407327), Emu(166736), Emu(9086968), Emu(338554))
        tf = title.text_frame
        tf.text = "■ "
        tf.paragraphs[0].add_run().text = f"예전 제목 {n}"
        s.shapes.add_textbox(Emu(8783273), Emu(166736), Emu(789396), Emu(338554)).text_frame.text = f"No.{n}"
        tbl = s.shapes.add_table(5, 8, Emu(343851), Emu(653393), Emu(9228818), Emu(5643942)).table
        labels = {(0, 0): "차 종", (0, 2): "제 원", (0, 4): "불만 구분", (0, 6): "경과", (1, 0): "매체",
                  (1, 2): "게시글\n위치", (1, 4): "버즈량", (1, 5): "조회수", (1, 6): "댓글", (3, 0): "내 용\n요 약", (4, 0): "게시글\n예시"}
        for (r, c), v in labels.items():
            tbl.cell(r, c).text = v
        tbl.cell(0, 1).text = "LX3"
        tbl.cell(0, 3).text = "2.5T"
        p = tbl.cell(0, 5).text_frame.paragraphs[0]
        for k, part in enumerate(["품질", "(", "주의", "/", "경고", "/", "심각", ")"]):
            run = p.add_run()
            run.text = part
            run.font.size = Pt(11)
            run.font.color.rgb = RGBColor(0x00, 0xB0, 0x50) if part == "주의" else RGBColor(0, 0, 0)
        tbl.cell(0, 7).text = "진행"
        tbl.cell(1, 1).text = "동호회\n예전 카페"
        tbl.cell(1, 3).merge(tbl.cell(2, 3))
        run = tbl.cell(1, 3).text_frame.paragraphs[0].add_run()
        run.text = "https://naver.me/OLD"
        run.hyperlink.address = "https://naver.me/OLD"
        tbl.cell(2, 5).text = "32건"
        tbl.cell(2, 6).text = "0건"
        tbl.cell(3, 1).merge(tbl.cell(3, 7))
        tbl.cell(3, 1).text = "예전 요약\n댓글 반응 없음"
        tbl.cell(4, 1).merge(tbl.cell(4, 7))
        s.shapes.add_picture(str(img), Emu(1360196), Emu(2112190), Emu(5400000), Emu(794492))
    prs.save(path)


DEFAULT_ROWS = [
    ["전기차 동호회", "NE", "2026-10-06", "품질", "https://cafe.naver.com/testcafe/1", "표시 안 된 글"],
    ["스타리아EV & ST1 클럽", "ST1", "2026-10-06", "품질", "https://naver.me/xSBkYEbW", "공조기 자동 작동 및 off 불가 발생 불만", "+"],
    ["아이오닉9 오너스", "ME1", "2026-10-06", "품질", "https://naver.me/deleted1", "삭제된 글", "+"],
    ["보배드림", "GN7 PE", "2026-10-06", "품질", "https://www.bobaedream.co.kr/view?No=1", "주행 중 시동 꺼짐", "+"],
]


def make_excel(path: Path, rows=DEFAULT_ROWS):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["커뮤니티명", "차종", "게시일", "구분", "URL", "주요 내용"])
    for r in rows:
        ws.append(r)
    wb.save(path)


def start_fake_cafe(tmp_path: Path):
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=cafe.naver.com",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/xSBkYEbW":  # naver.me 단축 주소 → 새 카페 화면 주소로 이동
                self.send_response(302)
                self.send_header("Location", "https://cafe.naver.com/f-e/cafes/1/articles/45176")
                self.end_headers()
                return
            # 예전 카페 화면: 바깥 페이지 안의 cafe_main 틀(iframe)에 게시글이 들어 있다
            if "/members/" in self.path or "/menus/" in self.path:
                titles = (["[출고인증] ST1 카고 받았습니다", "타이어 공기압 문의"] if "/members/" in self.path
                          else ["공조기 자동으로 켜짐", "공조기 OFF 안 됨", "와이퍼 소음"])
                body = ("<html><body><ul>" + "".join(
                    f'<li><a href="/ca-fe/cafes/1/articles/{100 + i}">{t}</a> <span>2026.09.2{i}.</span></li>'
                    for i, t in enumerate(titles)) + "</ul></body></html>").encode()
            elif self.path == "/ca-fe/cafes/1/articles/100":  # 작성자의 출고 인증 글
                body = ('<html><body><div class="se-main-container"><p>드디어 ST1 카고 <b>EV 롱레인지</b> 출고했습니다.</p>'
                        "</div></body></html>").encode()
            elif self.path == "/deleted1":
                body = DELETED_HTML.encode()
            elif "/framecafe/" in self.path:
                body = ('<html><body style="margin:0"><div style="height:120px;background:#eee">카페 메뉴</div>'
                        '<iframe id="cafe_main" name="cafe_main" src="/inner" style="width:1000px;height:1600px;border:0">'
                        '</iframe></body></html>').encode()
            else:
                body = ARTICLE_HTML.encode()
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


def run_report(tmp_path: Path, template: Path, excel: Path, out_dir: Path, ai_key="sk-ant-test"):
    from playwright.sync_api import sync_playwright

    server = start_fake_cafe(tmp_path)
    ai_requests = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=CHROMIUM,
            headless=True,
            args=[
                f"--disable-extensions-except={EXT_DIR}",
                f"--load-extension={EXT_DIR}",
                f"--host-resolver-rules=MAP cafe.naver.com 127.0.0.1:{server.server_address[1]},"
                f"MAP naver.me 127.0.0.1:{server.server_address[1]}",
                "--no-proxy-server",
                "--ignore-certificate-errors",
            ],
            accept_downloads=True,
        )

        def anthropic(route):
            req = json.loads(route.request.post_data)
            ai_requests.append(req)
            schema_keys = set(req["output_config"]["format"]["schema"]["properties"])
            result = SHORTENED if schema_keys == {"body", "reaction"} else AI_RESULT
            route.fulfill(status=200, headers={"content-type": "text/event-stream"},
                          body=sse_body(json.dumps(result, ensure_ascii=False)))

        ctx.route("https://api.anthropic.com/**", anthropic)
        # 삭제 안내 알림창은 확장이 직접 닫는다 (Playwright 의 자동 닫기와 겹치지 않게 빈 처리기를 둔다)
        ctx.on("page", lambda pg: pg.on("dialog", lambda d: None))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        page = ctx.new_page()
        page.on("console", lambda m: print("console:", m.text))
        page.goto(f"chrome-extension://{ext_id}/app.html")
        page.set_input_files("#templateFile", str(template))
        page.wait_for_selector("#templateInfo.ok")
        if ai_key:
            page.fill("#aiKey", ai_key)
            page.dispatch_event("#aiKey", "change")
        page.fill("#reportDate", "2026-10-07")
        page.set_input_files("#excelFile", str(excel))
        page.wait_for_selector("#start:not([disabled])")
        page.click("#start")
        page.wait_for_selector("#build:not([disabled])", timeout=180000)
        page.wait_for_selector("#stop[disabled]", timeout=180000)
        page.screenshot(path=str(out_dir / "screen.png"), full_page=True)
        with page.expect_download() as dl:
            page.click("#build")
        download = dl.value
        target = out_dir / download.suggested_filename
        download.save_as(target)
        summary = page.inner_text("#summary")
        ctx.close()
    server.shutdown()
    return target, ai_requests, summary


def test_report_end_to_end(tmp_path):
    from pptx import Presentation

    template = tmp_path / "template.pptx"
    excel = tmp_path / "issues.xlsx"
    make_template(template)
    make_excel(excel)
    out, ai_requests, summary = run_report(tmp_path, template, excel, tmp_path)

    assert out.name == "261007_현대차 온라인 이슈 보고서.pptx", summary
    # 카페 글만 AI 요약 (보배드림은 캡처·요약 안 함) + 본문 요약이 55자를 넘어 줄이기 요청 1번
    assert len(ai_requests) == 2
    sent = json.loads(ai_requests[0]["messages"][0]["content"].split("\n\n", 1)[1])
    assert "OFF 버튼을 눌러도" in sent["body"]
    # 카페 공통 안내 문구(게시판 글쓰기 양식)는 본문에서 뺀다
    assert sent["body"].startswith("출고 2주 된 ST1") and "등업" not in sent["body"]
    # 대댓글·작성자 댓글은 빼고, 이모티콘 댓글은 표시해서 보낸다
    assert [(c["text"], c["hasSticker"]) for c in sent["comments"]] == [
        ("저도 같은 증상이에요", False), ("사업소 가세요", False), ("ㅋㅋ", True)]
    assert sent["author"] == "파주ll작성자" and sent["postDate"] == "2026-10-06"
    assert [p["title"] for p in sent["authorPosts"]] == ["[출고인증] ST1 카고 받았습니다", "타이어 공기압 문의"]
    # 제원 확인용: 작성자의 출고 인증 글 본문을 읽어 보낸다
    assert sent["authorCertPosts"] == [{"title": "[출고인증] ST1 카고 받았습니다", "text": "드디어 ST1 카고 EV 롱레인지 출고했습니다."}]
    assert len(sent["boardPosts"]) == 3 and sent["boardPosts"][0]["date"].startswith("2026.09.2")

    prs = Presentation(out)
    slides = list(prs.slides)
    assert len(slides) == 5  # 표지 / 요약표 / 구분 정의 / 상세 2건 (삭제된 게시물 제외)
    assert any("2026.10.07" in sh.text_frame.text for sh in slides[0].shapes if sh.has_text_frame)
    summary_tbl = [sh for sh in slides[1].shapes if sh.has_table][0].table
    rows = [[c.text for c in r.cells] for r in summary_tbl.rows]
    assert rows[1][:6] == ["1", "ST1", "품질", "공조기 자동 작동 및 OFF 불가 발생", "5", "중복 2건"]
    assert rows[2][:2] == ["2", "GN7 PE"] and rows[2][4] == "확인"
    assert len(rows) == 3  # 삭제된 게시물은 요약표에도 없다

    d1 = slides[3]
    texts = [sh.text_frame.text for sh in d1.shapes if sh.has_text_frame]
    assert "■ ST1(ST1) 공조기 자동 작동 및 OFF 불가" in texts
    assert "No.1" in texts
    tbl = [sh for sh in d1.shapes if sh.has_table][0].table
    assert tbl.cell(0, 1).text == "ST1" and tbl.cell(0, 3).text == "EV" and tbl.cell(0, 7).text == "초기"
    level_runs = {r.text: str(r.font.color.rgb) for r in tbl.cell(0, 5).text_frame.paragraphs[0].runs if r.text in ("주의", "경고", "심각")}
    assert level_runs["경고"] == "0563C1"  # 경고는 파랑
    assert level_runs["주의"] != "00B050" and level_runs["심각"] != "C00000"
    assert tbl.cell(1, 1).text == "동호회\n스타리아EV & ST1 클럽"
    link_run = tbl.cell(1, 3).text_frame.paragraphs[0].runs[0]
    # naver.me 단축 주소 → https://cafe.naver.com/카페주소/글번호
    assert link_run.text == "https://cafe.naver.com/allfm01/2157343"
    assert link_run.hyperlink.address == "https://cafe.naver.com/allfm01/2157343"
    assert tbl.cell(2, 5).text == "1,234건" and tbl.cell(2, 6).text == "5건"
    assert tbl.cell(3, 1).text.split("\n")[0] == SHORTENED["body"]
    assert tbl.cell(3, 1).text.split("\n")[1] == "댓글 반응 : ‘저도 같은 증상이에요., 사업소에 가세요.’ 등의 여론"

    pics = [sh for sh in d1.shapes if sh.shape_type == 13]
    # 제목 + 본문 + 댓글 2개(AI 추천 0, 2) + 첨부 이미지 1
    assert len(pics) == 5
    cm = 360000
    xs = sorted(round(p.left / cm, 2) for p in pics)
    assert xs[0] == 3.66 and 4.56 in xs and xs[-1] >= 19.86
    # 댓글 캡처에는 작성자 동그라미 아이콘(보라색)이 함께 찍힌다
    from PIL import Image
    import io
    comment_pics = [p for p in pics if 3.6 < p.left / cm < 3.7 and p.top > 2133600 + 100000]
    assert len(comment_pics) == 2
    has = lambda pic, f: any(f(*px) for px in Image.open(io.BytesIO(pic.image.blob)).convert("RGB").getdata())
    is_light = lambda r, g, b: abs(r - LIGHT[0]) < 8 and abs(g - LIGHT[1]) < 8 and abs(b - LIGHT[2]) < 8
    is_purple = lambda r, g, b: r > 150 and g < 80 and b > 200
    # 사진 프로필이든 연회색 기본 프로필이든 모든 댓글에 아이콘이 들어간다
    assert sorted(has(p, is_purple) for p in comment_pics) == [False, True]
    assert all(has(p, is_light) or has(p, is_purple) for p in comment_pics)
    for p in comment_pics:
        assert has(p, lambda r, g, b: r > 200 and 90 < g < 170 and b < 80), "하트·… 버튼이 잘림"
    # 제목 캡처: 게시판 이름·제목·작성자 아이콘(연회색)이 한 장으로, 아이콘 위아래가 잘리지 않고,
    # 글 아래 '게시글 더보기' 영역까지 늘어나지 않는다
    header_pic = min(pics, key=lambda p: p.top)
    assert header_pic.height < 3.3 * cm
    him = Image.open(io.BytesIO(header_pic.image.blob)).convert("RGB")
    rows_with_avatar = sum(1 for y in range(him.height) if any(is_light(*him.getpixel((x, y))) for x in range(0, 80)))
    expect = 40 * him.width / 868  # 40px 아이콘이 이미지에서 차지하는 높이
    assert rows_with_avatar >= expect * 0.85, (rows_with_avatar, expect)
    # 본문 캡처에도 안내 문구가 없다: 글자 4줄 높이만 (안내 문구 7줄이 들어가면 훨씬 높아짐)
    body_pic = [p for p in pics if 4.5 < p.left / cm < 4.6][0]
    assert body_pic.height < 1.8 * cm, body_pic.height / cm
    # 본문 사진: 원본 비율(4:3) 그대로, 오른쪽 영역에 150ppi 로
    photo = max(pics, key=lambda p: p.left)
    assert abs(photo.width / photo.height - 4 / 3) < 0.01
    assert abs(photo.image.size[0] / photo.image.size[1] - 4 / 3) < 0.01
    assert abs(photo.image.size[0] / (photo.width / cm / 2.54) - 150) < 2
    for pic in pics:
        assert pic.top >= 2133600 - 10 and pic.top + pic.height <= 6165850 + 10
        # 150ppi 로 저장
        ppi = pic.image.size[0] / (pic.width / cm / 2.54)
        assert ppi <= 151, (pic.name, ppi)

    d2 = slides[4]
    tbl2 = [sh for sh in d2.shapes if sh.has_table][0].table
    assert tbl2.cell(2, 5).text == "확인 필요"
    assert not [sh for sh in d2.shapes if sh.shape_type == 13]


def test_report_old_cafe_iframe(tmp_path):
    """예전 카페 화면(게시글이 cafe_main 틀 안에 있음)도 캡처·조회수 읽기가 된다. API 키가 없으면 엑셀 내용으로 초안."""
    from pptx import Presentation

    template = tmp_path / "template.pptx"
    excel = tmp_path / "issues.xlsx"
    make_template(template)
    make_excel(excel, [["아이오닉9 오너스", "ME1", "2026-10-06", "품질", "https://cafe.naver.com/framecafe/7",
                        "신차 검수 시 블랙잉크 차량 크롬 몰딩 조립", "+"]])
    out, ai_requests, _ = run_report(tmp_path, template, excel, tmp_path, ai_key="")
    assert ai_requests == []
    d1 = list(Presentation(out).slides)[3]
    texts = [sh.text_frame.text for sh in d1.shapes if sh.has_text_frame]
    assert "■ 아이오닉9(ME1) 신차 검수 시 블랙잉크 차량 크롬 몰딩 조립" in texts
    tbl = [sh for sh in d1.shapes if sh.has_table][0].table
    assert tbl.cell(2, 5).text == "1,234건" and tbl.cell(2, 6).text == "5건"
    assert tbl.cell(3, 1).text.startswith("신차 검수 시 블랙잉크")
    pics = [sh for sh in d1.shapes if sh.shape_type == 13]
    assert len(pics) == 5  # 제목 + 본문 + 댓글 2(이모티콘 없는 짧은 댓글) + 이미지 1


def read_marked_in_extension(tmp_path, paths):
    """확장 화면에서 Excel.readMarked 를 그대로 실행해 결과를 돌려준다."""
    import base64

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile_x"), executable_path=CHROMIUM, headless=True,
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        page = ctx.new_page()
        page.goto(f"chrome-extension://{sw.url.split('/')[2]}/app.html")
        out = [page.evaluate(
            """async (b64) => {
                const bin = atob(b64); const u8 = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                try { return await Excel.readMarked(u8); } catch (e) { return { error: e.message }; }
            }""", base64.b64encode(Path(x).read_bytes()).decode()) for x in paths]
        ctx.close()
    return out


def test_excel_layouts(tmp_path):
    """요약 시트가 먼저 있고 차종별 시트로 나뉜 파일, 'URL' 이 아닌 머리글, 하이퍼링크로만 걸린 주소, 전각 ＋."""
    from openpyxl import Workbook

    wb = Workbook()
    summary = wb.active
    summary.title = "요약"
    summary.append(["차종", "건수"])
    summary.append(["ME1", 2])
    ioniq = wb.create_sheet("ME1")
    ioniq.append(["2026.10.12 차종별 온라인 동향"])  # 머리글 위 제목 줄
    ioniq.append(["커뮤니티명", "차종", "게시일", "구분", "게시글 URL", "주요 내용", "선정"])
    ioniq.append(["아이오닉9 오너스", "ME1", "2026-10-11", "품질", "https://naver.me/AAA", "업데이트 중 시동 불가", "+"])
    ioniq.append(["아이오닉9 오너스", "ME1", "2026-10-11", "품질", "https://naver.me/BBB", "선정 안 됨", ""])
    gv = wb.create_sheet("JK")
    gv.append(["카페명", "모델", "작성일", "유형", "링크", "내용", "체크"])
    gv.append(["GV70 클럽", "JK EV", "2026-10-11", "품질", "바로가기", "가속 시 충격", "＋"])
    gv.cell(row=2, column=5).hyperlink = "https://cafe.naver.com/gv70club/123"
    # 261012 엑셀처럼 URL 열 머리글 칸이 비어 있고, 커뮤니티명 앞에 공백이 있는 경우
    lx = wb.create_sheet("LX3")
    lx.append(["커뮤니티명", "차종", "게시일", "구분", None, "주요 내용"])
    lx.append([" 팰리세이드 피플", "LX3", "2026-10-11", "품질", "https://naver.me/G4d8mM0i", "엔진 경고등 점등", "+"])
    path = tmp_path / "차종별.xlsx"
    wb.save(path)

    [res] = read_marked_in_extension(tmp_path, [path])
    assert "error" not in res, res
    assert res["total"] == 4 and res["sheets"] == ["ME1", "JK", "LX3"]
    assert [(i["car"], i["url"], i["main"], i["cafe"]) for i in res["items"]] == [
        ("ME1", "https://naver.me/AAA", "업데이트 중 시동 불가", "아이오닉9 오너스"),
        ("JK EV", "https://cafe.naver.com/gv70club/123", "가속 시 충격", "GV70 클럽"),
        ("LX3", "https://naver.me/G4d8mM0i", "엔진 경고등 점등", "팰리세이드 피플"),
    ]
