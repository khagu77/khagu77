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
<div class="se-component se-video" style="width:300px;height:500px;background:#334455;position:relative">
<img src="{PROFILE}" style="position:absolute;left:130px;top:230px;width:40px;height:40px"><span style="color:#fff">00:11</span></div>
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

# 아주 긴 글: 짧은 줄 120개 + 사이사이 큰 사진. 마지막 줄은 빨간 글씨 — 끝까지 캡처되어야 PPT 에 빨간 글자가 있음
LONG_HTML = ("<html><head><meta charset='utf-8'><style>body{margin:0;font:16px/1.6 sans-serif;color:#222}"
             ".se-main-container p{margin:0} .se-image img{width:700px;height:500px;display:block}</style></head><body>"
             "<div class='article_header' style='width:860px;margin:20px auto'><h3 class='title_text'>아주 긴 수리 후기</h3>"
             "<div class='article_info'>2026.10.13. 10:01 조회 1,032</div></div>"
             "<div class='se-main-container' style='width:860px;margin:0 auto'>"
             + "".join(
                 f"<div class='se-component se-text'><p>{i}번째 줄 하이테크센터 수리 이야기</p></div>"
                 + (f"<div class='se-component se-image'><img src='{PHOTO}'></div>" if i % 20 == 10 else "")
                 for i in range(1, 120))
             + "<div class='se-component se-text'><p style='color:#ff0000;font-weight:bold'>마지막 줄입니다 끝</p></div>"
             "</div></body></html>")

DELETED_HTML = ("<html><body><script>alert('삭제되었거나 존재하지 않는 게시글입니다.');</script>"
                "<p>삭제되었거나 존재하지 않는 게시글입니다.</p></body></html>")

AI_RESULT = {
    "issue": "공조기 자동 작동 및 OFF 불가",
    "spec": "EV",
    "short": "공조기 자동 작동 및 OFF 불가 발생",
    # 일부러 72자를 넘김 → 확장이 한 번 더 맞춰 달라고 요청해야 함
    "body": "출고 2주 된 신차에서 시동을 걸 때마다 공조기가 자동으로 작동하고 OFF 버튼을 눌러도 꺼지지 않아 블루핸즈 예약을 마쳤다며 증상에 대해 문의하는 내용",
    "reaction": "‘저도 같은 증상이에요., 사업소에 가세요.’ 등의 여론",
    "level": "경고",
    "duplicate": "중복 2건",
    "region": "-",
    "comment_picks": [0, 1, 99],
}


SHORTENED = {
    "body": "출고 2주 된 신차에서 시동 시마다 공조기가 자동으로 작동하고 OFF 버튼도 듣지 않아 동일 증상 여부 및 해결 방안 문의",
    "reaction": AI_RESULT["reaction"],
}


def sse_body(text):
    events = [
        ("message_start", {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant",
         "model": "claude-opus-5-5", "content": [], "stop_reason": None, "stop_sequence": None,
         "usage": {"input_tokens": 20000, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
         "usage": {"output_tokens": 1500}}),
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
    # 실제 PowerPoint 템플릿처럼 표 행마다 a16:rowId 를 넣는다 (복제 후 중복되면 PowerPoint 에서 표 수정 불가)
    import re as _re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide2.xml":
                n = iter(range(10000, 99999))
                data = _re.sub(rb"</a:tr>", lambda m: (b'<a:extLst><a:ext uri="{0D108BD9-81ED-4DB2-BD59-A6C34878D82A}">'
                               b'<a16:rowId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" val="%d"/>'
                               b"</a:ext></a:extLst></a:tr>" % next(n)), data)
            zout.writestr(item, data)
    tmp.replace(path)


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
            elif "/longcafe/" in self.path:
                body = LONG_HTML.encode()
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


def run_report(tmp_path: Path, template: Path, excel: Path, out_dir: Path, ai_key="sk-ant-test", count=None,
               folder=False):
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
        # 템플릿이 없으면 설정 창이 저절로 열린다
        page.wait_for_selector("#settings[open]")
        page.set_input_files("#templateFile", str(template))
        page.wait_for_selector("#templateInfo.ok")
        if ai_key:
            page.fill("#aiKey", ai_key)
            page.dispatch_event("#aiKey", "change")
        page.click("#closeSettings")
        page.wait_for_selector("#settings:not([open])", state="attached")
        page.fill("#reportDate", "2026-10-07")
        page.set_input_files("#excelFile", str(excel))
        page.wait_for_selector("#start:not([disabled])")
        if count:  # (총 칸 수, 작성 개수) — 엑셀을 넣으면 총 칸 수는 + 개수로 자동 입력됨
            page.uncheck("#countAll")
            assert page.input_value("#countTotal") == str(count[2]) if len(count) > 2 else True
            page.fill("#countTotal", str(count[0]))
            page.fill("#countMine", str(count[1]))
            if len(count) > 3:
                page.check(f'input[name="countPart"][value="{count[3]}"]')
        page.click("#start")
        page.wait_for_selector("#build:not([disabled])", timeout=180000)
        page.wait_for_selector("#stop[disabled]", timeout=180000)
        page.screenshot(path=str(out_dir / "screen.png"), full_page=True)
        if folder:
            # 폴더 선택 창 대신 브라우저 내부 저장소 폴더를 '고른 폴더'로 쓴다
            page.evaluate("window.showDirectoryPicker = async () => navigator.storage.getDirectory()")
            page.click("#changeFolder")  # 첫 화면 '저장 위치 변경' → 설정 창
            page.click("#pickFolder")
            page.wait_for_selector("#folderInfo.ok")
            page.click("#closeSettings")
            assert "📁" in page.inner_text("#saveWhere")
            page.click("#build")
            page.locator("#summary", has_text="📁").wait_for(timeout=120000)
            name = page.inner_text("#summary").split("/", 1)[1].split(" (")[0]
            b64 = page.evaluate("""async (n) => {
                const dir = await navigator.storage.getDirectory();
                const f = await (await dir.getFileHandle(n)).getFile();
                const u8 = new Uint8Array(await f.arrayBuffer()); let s = "";
                for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
                return btoa(s);
            }""", name)
            target = out_dir / name
            target.write_bytes(__import__("base64").b64decode(b64))
        else:
            with page.expect_download() as dl:
                page.click("#build")
            download = dl.value
            target = out_dir / download.suggested_filename
            download.save_as(target)
        # 작성 완료 알림창: 소요 시간 · 예상 AI 비용
        page.wait_for_selector("#doneDialog[open]")
        done_stats = page.inner_text("#doneStats")
        assert "소요 시간" in done_stats and "예상 AI 비용" in done_stats, done_stats
        if ai_requests:  # AI 를 부른 만큼 비용이 잡힌다
            assert "$0.00" not in done_stats, done_stats
        page.click("#doneOk")
        summary = page.inner_text("#summary") + "\n" + page.inner_text("#stats")
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
    # 끝맺음을 고르는 데 쓰는 정보: 첨부 사진 수, 같은 보고서의 앞선 본문 요약(첫 글이라 비어 있음)
    assert sent["photoCount"] == 2 and sent["recentBodies"] == []  # 사진 1 + 영상 1
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
    import re as _re
    import zipfile
    ids = _re.findall(rb'rowId[^>]*val="(\d+)"', zipfile.ZipFile(out).read("ppt/slides/slide2.xml"))
    assert len(ids) == len(rows) and len(set(ids)) == len(ids)  # 행 ID 중복 없음
    # 칸 수와 상관없이 표 아래 끝선은 템플릿 표 틀 높이에 맞춤
    frame = [sh for sh in slides[1].shapes if sh.has_table][0]
    assert abs(sum(r.height for r in summary_tbl.rows) - frame.height) < 20
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
    # 제목 + 본문 + 댓글 2개(AI 추천) + 첨부 사진 1 + 영상 플레이어 1
    assert len(pics) == 6
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
    # 영상 플레이어 화면도 첨부 이미지처럼 오른쪽 영역에 (세로로 긴 영상은 반 폭)
    right = [p for p in pics if p.left >= 19.8 * cm]
    assert len(right) == 2
    video = [p for p in right if p.height > p.width][0]
    # 본문 사진: 원본 비율(4:3) 그대로, 가로로 긴 사진은 오른쪽 영역 전체 폭(5.8cm), 330ppi
    photo = [p for p in right if p.width > p.height][0]
    # 넘치면 함께 같은 비율로 줄어듦: 사진 ≤ 5.8cm, 세로 영상 폭 = (5.8 − 0.2) / 2 비율
    assert photo.width <= 5.8 * cm + 10
    assert abs(video.width / photo.width - (5.6 / 2) / 5.8) < 0.01
    assert abs(photo.width / photo.height - 4 / 3) < 0.01
    assert abs(photo.image.size[0] / photo.image.size[1] - 4 / 3) < 0.01
    assert abs(photo.image.size[0] / (photo.width / cm / 2.54) - 330) < 2
    for pic in pics:
        assert pic.top >= 2133600 - 10 and pic.top + pic.height <= 6165850 + 10
        # 기본 330ppi 이하로 저장 (캡처 원본보다 키우지는 않음)
        ppi = pic.image.size[0] / (pic.width / cm / 2.54)
        assert ppi <= 331, (pic.name, ppi)

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
    # 작성 개수: 총 10칸 중 1개 작성 → 요약표 10칸(1~9번은 연번만), 상세는 No.10 한 장
    out, ai_requests, _ = run_report(tmp_path, template, excel, tmp_path, ai_key="", count=(10, 1))
    assert ai_requests == []
    slides = list(Presentation(out).slides)
    assert len(slides) == 4
    rows = [[c.text for c in r.cells] for r in [sh for sh in slides[1].shapes if sh.has_table][0].table.rows]
    assert [r[0] for r in rows[1:]] == [str(n) for n in range(1, 11)]
    assert all(all(c == "" for c in r[1:]) for r in rows[1:10])
    assert rows[10][1] == "ME1"
    d1 = slides[3]
    assert "No.10" in [sh.text_frame.text for sh in d1.shapes if sh.has_text_frame]
    texts = [sh.text_frame.text for sh in d1.shapes if sh.has_text_frame]
    assert "■ 아이오닉9(ME1) 신차 검수 시 블랙잉크 차량 크롬 몰딩 조립" in texts
    tbl = [sh for sh in d1.shapes if sh.has_table][0].table
    assert tbl.cell(2, 5).text == "1,234건" and tbl.cell(2, 6).text == "5건"
    assert tbl.cell(3, 1).text.startswith("신차 검수 시 블랙잉크")
    pics = [sh for sh in d1.shapes if sh.shape_type == 13]
    assert len(pics) == 6  # 제목 + 본문 + 댓글 2(이모티콘 없는 짧은 댓글) + 사진 1 + 영상 1


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
    # 머리글 없이 A열 동호회명 · B열 차종 (담당자 기본 양식)
    plain = wb.create_sheet("머리글없음")
    plain.append(["캐스퍼 매니아", "AX", "2026-10-11", "품질", "https://naver.me/xtNJKRiE", "펜더 부식", "+"])
    path = tmp_path / "차종별.xlsx"
    wb.save(path)

    [res] = read_marked_in_extension(tmp_path, [path])
    assert "error" not in res, res
    assert res["total"] == 5 and res["sheets"] == ["ME1", "JK", "LX3", "머리글없음"]
    assert [(i["car"], i["url"], i["main"], i["cafe"]) for i in res["items"]] == [
        ("ME1", "https://naver.me/AAA", "업데이트 중 시동 불가", "아이오닉9 오너스"),
        ("JK EV", "https://cafe.naver.com/gv70club/123", "가속 시 충격", "GV70 클럽"),
        ("LX3", "https://naver.me/G4d8mM0i", "엔진 경고등 점등", "팰리세이드 피플"),
        ("AX", "https://naver.me/xtNJKRiE", "", "캐스퍼 매니아"),
    ]


def test_report_count_last_k(tmp_path):
    """'3개 중 2개 작성': + 글 3개 중 뒤의 2개를 2·3번으로. 1번 글은 캡처하지 않고 연번만 있는 빈 칸.
    2번 자리 글이 삭제된 글이면 그 칸은 빈 칸으로 두고 3번 글은 그대로 3번."""
    from pptx import Presentation

    template = tmp_path / "template.pptx"
    excel = tmp_path / "issues.xlsx"
    make_template(template)
    make_excel(excel)  # + 글: ST1 카페 글 / 삭제된 글 / 보배드림 글
    out, ai_requests, _ = run_report(tmp_path, template, excel, tmp_path, count=(3, 2, 3))
    assert ai_requests == []  # 1번(ST1 카페 글)은 다른 담당자 몫이라 열지도 않음
    slides = list(Presentation(out).slides)
    assert len(slides) == 4  # 상세는 보배드림 글 한 장
    rows = [[c.text for c in r.cells] for r in [sh for sh in slides[1].shapes if sh.has_table][0].table.rows]
    assert [r[0] for r in rows[1:]] == ["1", "2", "3"]
    assert all(c == "" for c in rows[1][1:]) and all(c == "" for c in rows[2][1:])
    assert rows[3][1] == "GN7 PE"
    assert "No.3" in [sh.text_frame.text for sh in slides[3].shapes if sh.has_text_frame]


def test_report_count_first_k(tmp_path):
    """'3개 중 1개 앞부분 작성': + 글 중 첫 번째만 1번으로, 2·3번은 연번만 있는 빈 칸."""
    from pptx import Presentation

    template = tmp_path / "template.pptx"
    excel = tmp_path / "issues.xlsx"
    make_template(template)
    make_excel(excel)  # + 글: ST1 카페 글 / 삭제된 글 / 보배드림 글
    out, ai_requests, summary = run_report(tmp_path, template, excel, tmp_path, count=(3, 1, 3, "front"), folder=True)
    assert out.name == "261007_현대차 온라인 이슈 보고서.pptx" and "📁" in summary  # 고른 폴더에 바로 저장
    assert len(ai_requests) >= 1  # 1번 ST1 카페 글만 캡처·요약
    slides = list(Presentation(out).slides)
    assert len(slides) == 4
    rows = [[c.text for c in r.cells] for r in [sh for sh in slides[1].shapes if sh.has_table][0].table.rows]
    assert [r[0] for r in rows[1:]] == ["1", "2", "3"]
    assert rows[1][1] == "ST1"
    assert all(c == "" for c in rows[2][1:]) and all(c == "" for c in rows[3][1:])
    assert "No.1" in [sh.text_frame.text for sh in slides[3].shapes if sh.has_text_frame]


def se_post(*paras):
    """네이버 에디터처럼: 하나의 글 상자(se-text) 안에 문단(se-text-paragraph)이 이어짐. '___' 는 밑줄 구분선 문단."""
    ps = "".join(f'<p class="se-text-paragraph">{p or "<br>"}</p>' for p in paras)
    return (f'<html><body><div class="se-main-container"><div class="se-component se-text">{ps}</div>'
            "</div></body></html>")


NOTICE_A = ["📍함께하는 [아이오닉9 오너스] 카페", "카페 활동 예의를 지켜주세요.",
            "경우에 따라 카페 운영 회칙에 의거 활동 정지 또는 탈퇴 처리될 수 있습니다.", "______________"]
NOTICE_B = ["📍 함께하는 [아이오닉9 오너스] 카페", "질문은 질문 답변 게시판 이용해 주세요.",
            "글쓰기에서 해당 게시판이 안 보이면 등업이 필요합니다. (글 2개, 댓글 5개, 방문 5회, 좋아요 10회)",
            "카페 활동 예의를 지켜주세요.", "경우에 따라 카페 운영 회칙에 의거 활동 정지 또는 탈퇴 처리될 수 있습니다.",
            "______________"]


@pytest.mark.parametrize("paras, expected_start, gone", [
    # 안내 + 빈 질문 양식 + 구분선들 → 질문 한 줄만 남음
    (NOTICE_A + ["질문에 필요할 경우 작성해주세요.", "______________", "1. 구동방식:", "2. 인승:", "3. 색상:", "4. 등급:",
                 "5. 기타:", "______________", "마이현대앱을 보니 경고등? 점검? 파란손에 가는거 맞을까요?"],
     "마이현대앱을 보니", ["카페", "구동방식", "작성해주세요"]),
    # 안내 + 구분선 → 작성자 본문만
    (NOTICE_B + ["차량 받고 비닐도 안뜯었는데..충전도 안되고 경고등 떠서 하이테크 보내고 6일만에 받았습니다.",
                 "반짝반짝할때 보냈는데 비맞은 자국에 꾸질거리는 모습으로 돌아왔네요.."],
     "차량 받고 비닐도", ["등업", "예의"]),
    # 구분선 없이 안내 문단만 앞에 → 작성자 본문만
    (NOTICE_B[:-1] + ["", "연휴기간 강원도 인제 돔배령 산행후,", "양양에서 차박 하면서 새벽부터 이상증상발생."],
     "연휴기간 강원도", ["회칙", "게시판"]),
    # 양식에 값을 채웠으면 작성자 정보라 남긴다
    (NOTICE_A + ["1. 구동방식: AWD", "2. 인승: 7인승", "______________", "주행 중 소음이 납니다."],
     "1. 구동방식: AWD", ["회칙"]),
])
def test_cafe_notice_removed(paras, expected_start, gone):
    from playwright.sync_api import sync_playwright

    code = (EXT_DIR / "capture.js").read_text()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, headless=True)
        page = browser.new_page()
        page.set_content(se_post(*paras))
        page.add_script_tag(content=code)
        info = page.evaluate("cafePageProbe('info', null, 20, 8, [])")
        hidden = page.evaluate("[...document.querySelectorAll('[data-rpt-boiler]')].length")
        browser.close()
    assert info["bodyText"].startswith(expected_start), info["bodyText"]
    for word in gone:
        assert word not in info["bodyText"], (word, info["bodyText"])
    assert hidden > 0


TODAY_TEXT = ["아침 출근까지 멀쩡했는데", "저녁 퇴근때 시동걸었더니", "내비 화면이 지지직거리면서 계속 깜박거리다를",
              "계속 반복하고 시동껐다켜도 똑같고", "리셋버튼 눌러도 소용이 없네요..", "파란손 가야하는건지...ㅠㅠ"]


@pytest.mark.parametrize("html, expected_start, gone", [
    # 오늘 사례: 안내와 본문이 한 문단 안에서 줄바꿈(<br>)으로만 이어지고, 안내 아래 짧은 가로줄
    ('<div class="se-main-container"><div class="se-component se-text"><p class="se-text-paragraph">'
     + "<br>".join(NOTICE_B[:-1]) + '</p><hr style="width:300px"><p class="se-text-paragraph">'
     + "<br>".join(TODAY_TEXT) + "</p></div></div>", "아침 출근까지", ["카페", "등업", "회칙"]),
    # 안내 상자에 밑줄(테두리)이 있는 경우
    ('<div class="se-main-container"><div style="border-bottom:1px solid #000;width:300px">'
     + "".join(f"<p>{t}</p>" for t in NOTICE_B[:-1]) + "</div>"
     + "".join(f"<p>{t}</p>" for t in TODAY_TEXT) + "</div>", "아침 출근까지", ["예의"]),
    # 📍 가 이모지 그림으로 들어간 경우 (미리 알려 준 안내 문구와 글자만 비교)
    ('<div class="se-main-container"><p><img src="x.png" width="1" height="1">함께하는 [아이오닉9 오너스] 카페</p>'
     + "".join(f"<p>{t}</p>" for t in NOTICE_B[1:-1]) + "".join(f"<p>{t}</p>" for t in TODAY_TEXT) + "</div>",
     "아침 출근까지", ["함께하는"]),
    # 안내 문구가 없는 보통 글은 그대로 (카페라는 말이 있어도)
    ('<div class="se-main-container"><p>카페 회원분들 도움 부탁드립니다.</p><p>주행 중 소음이 계속 납니다.</p>'
     '<p>원인을 모르겠어요.</p></div>', "카페 회원분들", []),
])
def test_cafe_notice_removed_structures(html, expected_start, gone):
    from playwright.sync_api import sync_playwright

    code = (EXT_DIR / "capture.js").read_text()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, headless=True)
        page = browser.new_page()
        page.set_content(f"<html><body>{html}</body></html>")
        page.add_script_tag(content=code)
        info = page.evaluate("cafePageProbe('info', null, 20, 8, SEED_BOILERPLATES)")
        # 가린 뒤 화면에 보이는 글자에도 안내 문구가 없어야 함
        visible = page.evaluate("""() => { const b = document.querySelector('[data-rpt="body"]');
            document.querySelectorAll('[data-rpt-boiler]').forEach(e => e.style.visibility = 'hidden');
            const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); let s = '';
            for (let t = tw.nextNode(); t; t = tw.nextNode()) {
              if (getComputedStyle(t.parentElement).visibility !== 'hidden') s += t.nodeValue; }
            return s; }""")
        browser.close()
    assert info["bodyText"].startswith(expected_start), info["bodyText"]
    for word in gone:
        assert word not in info["bodyText"], (word, info["bodyText"])
        assert word not in visible, (word, visible)


def test_long_body_two_columns(tmp_path):
    """아주 긴 본문(짧은 줄 26개)은 두 단으로 나뉘어 안내선 안(4.56~18.66cm, 댓글 위)에 들어가고, 줄 간격은 자연스럽게."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile_l"), executable_path=CHROMIUM, headless=True,
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        page = ctx.new_page()
        page.goto(f"chrome-extension://{sw.url.split('/')[2]}/app.html")
        res = page.evaluate("""async () => {
            const dpr = 2;
            // 본문: 860px 폭, 16px 글자, 줄 사이 10px, 문단마다 빈 줄
            const mk = (lines, w) => { const c = new OffscreenCanvas(w * dpr, lines * 42 * dpr); const g = c.getContext('2d');
              g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#222'; g.font = `${16 * dpr}px sans-serif`;
              for (let i = 0; i < lines; i++) g.fillText('에어백 경고등이 간헐적으로 확인되고 ' + i, 10 * dpr, (i * 42 + 20) * dpr);
              return c; };
            const bmp = async (c) => createImageBitmap(await c.convertToBlob());
            const body = ImageProc.compactText(await bmp(mk(26, 860)), dpr);
            const header = ImageProc.compactText(await bmp(mk(3, 860)), dpr, { collapse: false });
            const comment = ImageProc.compactText(await bmp(mk(2, 860)), dpr);
            const { placements } = Layout.layout({ header, body, comments: [comment, comment], images: [] });
            const gaps = []; for (let k = 1; k < body.cuts.length; k++) gaps.push(body.cuts[k] - body.cuts[k - 1]);
            return { placements: placements.map(p => ({ kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h })), lineStep: gaps[0] / dpr };
        }""")
        ctx.close()
    cm = 360000
    bodies = [p for p in res["placements"] if p["kind"] == "body"]
    comments = [p for p in res["placements"] if p["kind"] == "comment"]
    assert len(bodies) == 2 and len(comments) == 2
    left, right = sorted(bodies, key=lambda p: p["x"])
    assert abs(left["x"] / cm - 4.56) < 0.01 and left["y"] == right["y"]
    assert left["x"] + left["w"] < right["x"]  # 겹치지 않음
    assert right["x"] + right["w"] <= 18.66 * cm + 10
    top_comment = min(c["y"] for c in comments)
    assert max(left["y"] + left["h"], right["y"] + right["h"]) <= top_comment
    # 빈 줄은 없애되 줄 간격은 글자 높이의 절반 정도로 자연스럽게 (줄당 약 20~30px)
    assert 18 <= res["lineStep"] <= 32, res["lineStep"]


def test_long_post_captured_to_the_end(tmp_path):
    """사진이 많은 아주 긴 글도 본문을 끝까지 캡처하고(마지막 빨간 줄이 PPT 에 있음), 여러 단으로 안내선 안에 놓는다."""
    from pptx import Presentation
    from PIL import Image
    import io

    template = tmp_path / "template.pptx"
    excel = tmp_path / "issues.xlsx"
    make_template(template)
    make_excel(excel, [["전기차 동호회", "JW", "2026-10-13", "품질", "https://cafe.naver.com/longcafe/1", "수리 후기", "+"]])
    out, _, _ = run_report(tmp_path, template, excel, tmp_path, ai_key="")
    d1 = list(Presentation(out).slides)[3]
    cm = 360000
    bodies = [p for p in d1.shapes if p.shape_type == 13 and 4.5 * cm < p.left < 18.7 * cm and p.top > 6.5 * cm]
    assert len(bodies) >= 2, [(p.left / cm, p.top / cm) for p in d1.shapes if p.shape_type == 13]
    for p in bodies:
        assert p.left + p.width <= 18.66 * cm + 10 and p.top + p.height <= 17.13 * cm + 10
    red = lambda pic: any(r > 200 and g < 80 and b < 80 for r, g, b in Image.open(io.BytesIO(pic.image.blob)).convert("RGB").getdata())
    assert any(red(p) for p in bodies), "마지막 줄까지 캡처되지 않음"


def test_media_only_post_layout(tmp_path):
    """본문 글이 없는 글: 가로 영상·사진은 본문 자리(4.56cm~, 제목 아래)에 같은 폭으로, 세로 사진은 오른쪽 영역."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile_m"), executable_path=CHROMIUM, headless=True,
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        page = ctx.new_page()
        page.goto(f"chrome-extension://{sw.url.split('/')[2]}/app.html")
        res = page.evaluate("""() => {
            const it = (w, h) => ({ canvas: new OffscreenCanvas(w, h), cuts: [h], cssWidth: w, cssHeight: h, dpr: 1 });
            const header = it(860, 120), comment = it(860, 60);
            const { placements } = Layout.layout({ header, body: null, comments: [comment, comment],
              images: [it(800, 450), it(800, 450), it(400, 700)] });
            return placements.map(p => ({ kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h, tall: p.item.cssHeight > p.item.cssWidth }));
        }""")
        ctx.close()
    cm = 360000
    wide = [p for p in res if p["kind"] == "image" and not p["tall"]]
    tall = [p for p in res if p["kind"] == "image" and p["tall"]]
    header = [p for p in res if p["kind"] == "header"][0]
    top_comment = min(p["y"] for p in res if p["kind"] == "comment")
    assert len(wide) == 2 and len(tall) == 1
    assert abs(wide[0]["w"] - wide[1]["w"]) < 1  # 같은 폭
    for p in wide:
        assert 4.55 * cm <= p["x"] and p["x"] + p["w"] <= 18.66 * cm + 10
        assert p["y"] >= header["y"] + header["h"] and p["y"] + p["h"] <= top_comment
    assert tall[0]["x"] >= 19.8 * cm  # 세로 사진은 오른쪽 영역
