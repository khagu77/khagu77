"""온라인 이슈 보고서 작성기(report-extension) 통합 테스트.

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

PROFILE = ("data:image/svg+xml;base64," + __import__("base64").b64encode(
    b'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle cx="18" cy="18" r="18" fill="#cc00ff"/></svg>').decode())
STICKER = ("data:image/svg+xml;base64," + __import__("base64").b64encode(
    b'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#00ff00"/></svg>').decode())


def comment_li(nick, text, cls="", extra=""):
    # 하트·… 버튼(주황)은 댓글 칸 오른쪽 밖으로 살짝 튀어나와 있다
    return (f'<li class="CommentItem {cls}" style="position:relative">'
            '<button class="comment_tool" style="position:absolute;right:-30px;top:0;width:16px;height:16px;'
            f'border:0;background:#ff8800"></button><div class="comment_thumb"><img src="{PROFILE}" width="36" height="36"></div>'
            f'<a class="comment_nickname">{nick}</a>{extra}<span class="text_comment">{text}</span>'
            '<span class="comment_info_date">2026.10.06. 11:00</span></li>')


# 한 줄씩 띄어 쓴 본문 + 첨부 이미지 1장 + 댓글 3개
ARTICLE_HTML = f"""<html><head><meta charset="utf-8"><meta property="og:url" content="https://cafe.naver.com/allfm01/2157343"><style>
body{{margin:0;font:16px/1.6 sans-serif;color:#222;background:#fff}}
.top{{position:fixed;top:0;left:0;right:0;height:40px;background:#03c75a}}
.wrap{{width:860px;margin:60px auto}}
.article_header{{border-bottom:1px solid #ddd;padding:10px 0}}
.avatar{{display:inline-block;width:40px;height:40px;border-radius:50%;background:#00ccaa;vertical-align:middle}}
.title_text{{font-size:26px;margin:0}}
.se-main-container p{{margin:0}}
.se-image img{{width:400px;height:300px;display:block}}
li.CommentItem{{list-style:none;padding:8px 0;border-bottom:1px solid #eee}}
</style></head><body><div class="top"></div><div class="wrap">
<div class="ArticleContentBox"><a class="link_board" href="/ca-fe/cafes/1/menus/5">ST1 질문 게시판 &gt;</a>
<div class="article_header"><h3 class="title_text">ST1 공조기가 혼자 켜집니다</h3></div>
<div class="WriterInfo"><span class="avatar"></span><a href="/ca-fe/cafes/1/members/abc"><span class="nickname">파주ll작성자</span></a></div>
<div class="article_info"><span class="date">2026.10.06. 10:00</span> <span class="count">조회 1,234</span></div>
<div class="article_container"><div class="se-main-container">
<p>출고 2주 된 ST1 입니다.</p><p><br></p><p><br></p>
<p>시동만 걸면 공조기가 자동으로 켜지고</p><p><br></p><p><br></p><p><br></p>
<p>OFF 버튼을 눌러도 꺼지지 않습니다.</p>
<div class="se-component se-image"><img src="{PHOTO}"></div>
<p>블루핸즈 예약했습니다.</p></div></div>
<div class="ArticleTool"><a class="button_comment">댓글 5</a></div>
<div class="CommentBox"><ul>
{comment_li("회원1", "저도 같은 증상이에요")}
{comment_li("회원2", "저도요 ㅠ", "CommentItem--reply")}
{comment_li("파주ll작성자", "감사합니다", extra='<em class="comment_writer">작성자</em>')}
{comment_li("회원3", "사업소 가세요")}
{comment_li("회원4", "ㅋㅋ", extra=f'<div class="CommentItem__sticker"><img src="{STICKER}" width="80" height="80"></div>')}
</ul></div></div></div></body></html>"""

AI_RESULT = {
    "issue": "공조기 자동 작동 및 OFF 불가",
    "short": "공조기 자동 작동 및 OFF 불가 발생",
    "body": "출고 2주 된 차량에서 공조기가 자동으로 작동하고 OFF가 되지 않는다며 증상에 대해 문의하는 내용",
    "reaction": "'저도 같은 증상이다, 사업소에 가라' 등의 여론",
    "level": "경고",
    "duplicate": "중복 2건",
    "region": "-",
    "comment_picks": [0, 1, 99],
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
            # 예전 카페 화면: 바깥 페이지 안의 cafe_main 틀(iframe)에 게시글이 들어 있다
            if "/members/" in self.path or "/menus/" in self.path:
                titles = (["[파주] 출고 후기", "타이어 공기압 문의"] if "/members/" in self.path
                          else ["공조기 자동으로 켜짐", "공조기 OFF 안 됨", "와이퍼 소음"])
                body = ("<html><body><ul>" + "".join(
                    f'<li><a href="/ca-fe/cafes/1/articles/{100 + i}">{t}</a> <span>2026.09.2{i}.</span></li>'
                    for i, t in enumerate(titles)) + "</ul></body></html>").encode()
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
            ai_requests.append(json.loads(route.request.post_data))
            route.fulfill(status=200, headers={"content-type": "text/event-stream"},
                          body=sse_body(json.dumps(AI_RESULT, ensure_ascii=False)))

        ctx.route("https://api.anthropic.com/**", anthropic)
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
    assert len(ai_requests) == 1  # 카페 글만 AI 요약 (보배드림은 캡처·요약 안 함)
    sent = json.loads(ai_requests[0]["messages"][0]["content"].split("\n\n", 1)[1])
    assert "OFF 버튼을 눌러도" in sent["body"]
    # 대댓글·작성자 댓글은 빼고, 이모티콘 댓글은 표시해서 보낸다
    assert [(c["text"], c["hasSticker"]) for c in sent["comments"]] == [
        ("저도 같은 증상이에요", False), ("사업소 가세요", False), ("ㅋㅋ", True)]
    assert sent["author"] == "파주ll작성자" and sent["postDate"] == "2026-10-06"
    assert [p["title"] for p in sent["authorPosts"]] == ["[파주] 출고 후기", "타이어 공기압 문의"]
    assert len(sent["boardPosts"]) == 3 and sent["boardPosts"][0]["date"].startswith("2026.09.2")

    prs = Presentation(out)
    slides = list(prs.slides)
    assert len(slides) == 5  # 표지 / 요약표 / 구분 정의 / 상세 2건
    assert any("2026.10.07" in sh.text_frame.text for sh in slides[0].shapes if sh.has_text_frame)
    summary_tbl = [sh for sh in slides[1].shapes if sh.has_table][0].table
    rows = [[c.text for c in r.cells] for r in summary_tbl.rows]
    assert rows[1][:6] == ["1", "ST1", "품질", "공조기 자동 작동 및 OFF 불가 발생", "5", "중복 2건"]
    assert rows[2][:2] == ["2", "GN7 PE"] and rows[2][4] == "확인"
    assert len(rows) == 3

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
    assert tbl.cell(3, 1).text.startswith("출고 2주 된 차량에서")
    assert "댓글 반응 : '저도 같은 증상이다" in tbl.cell(3, 1).text

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
    for p in comment_pics:
        assert has(p, lambda r, g, b: r > 150 and g < 80 and b > 200), "댓글 프로필 아이콘 없음"
        assert has(p, lambda r, g, b: r > 200 and 90 < g < 170 and b < 80), "하트·… 버튼이 잘림"
    # 제목 캡처에 게시판 이름 아래 제목 · 작성자 아이콘(청록)이 한 장으로
    header_pic = min(pics, key=lambda p: p.top)
    assert has(header_pic, lambda r, g, b: r < 60 and g > 170 and 130 < b < 210), "제목 캡처에 작성자 아이콘 없음"
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
