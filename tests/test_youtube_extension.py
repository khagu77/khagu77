"""'YouTube 스크립트 및 영상 파일 추출' 확장 통합 테스트.

www.youtube.com 을 로컬 HTTPS 서버로 돌려 가짜 영상 화면(소리 나는 짧은 영상)을 보여주고,
- 스크립트 추출: 영상 소리를 받아 구간으로 잘라 음성인식에 넘기고 "[00:00] 내용" 줄로 저장하는지
  (음성인식 모델은 내려받을 수 없으므로 작업자만 가짜로 바꿔 넣는다)
- 화면 자막 인식: 화면 아래 한글 자막(움직이는 배경 위, 상자 모양, 영문 번역 줄 포함)을 읽어
  한글 줄만 "[00:00] 자막" 줄로 저장하는지
- 영상 파일 다운로드: "날짜_제목.mp4" 파일이 화면·소리를 담아 저장되는지
를 확인한다. 확장 로딩에는 일반 Chromium 이 필요하므로 CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import json
import os
import shutil
import ssl
import subprocess
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

EXT_DIR = Path(__file__).resolve().parent.parent / "youtube-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")

TITLE = "테스트 영상: 1/2편"
SAFE_TITLE = "테스트 영상_ 1_2편"

# 받은 구간마다 "구간N 길이초" 를 돌려주는 가짜 음성인식 작업자
FAKE_WORKER = """
let n = 0;
self.onmessage = ({ data }) => {
  if (data.type === "load") {
    self.postMessage({ type: "progress", file: "model.onnx", loaded: 5e6, total: 1e7 });
    self.postMessage({ type: "ready" });
  } else if (data.type === "run") {
    n++;
    let peak = 0;
    for (const v of data.audio) peak = Math.max(peak, Math.abs(v));
    const sec = (data.audio.length / 16000).toFixed(0);
    self.postMessage({ type: "result", id: data.id, chunks: [
      { start: 0, text: ` 구간${n} 길이${sec}초 소리${peak > 0.05 ? "있음" : "없음"}` },
      { start: 2.4, text: "  " },
    ] });
  }
};
"""

WATCH_HTML = """<!doctype html><html><head><title>{title} - YouTube</title></head><body>
<h1 class="ytd-watch-metadata">{title}</h1>
<div id="movie_player"><video src="/media/{name}" autoplay></video></div>
</body></html>"""


def make_media(path: Path, seconds: int, gap=None):
    """테스트 화면 + 440Hz 소리. gap=(시작, 끝) 이면 그 구간은 무음."""
    vol = f"volume=enable='between(t,{gap[0]},{gap[1]})':volume=0" if gap else "anull"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=25:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-af", vol, "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", "-shortest", str(path)],
        check=True,
    )


FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
CAPTIONS = [(0.5, 4, "안녕하세요 반갑습니다"), (8, 12, "오늘은 날씨가 좋습니다")]


STICKY_SUBS = ["차량이 많이 늘었습니다", "출퇴근 시간이 문제입니다", "대책을 마련하겠습니다", "협조를 부탁드립니다"]


def make_captioned_media(path: Path, seconds: int):
    """움직이는 화면 아래쪽에 흰 글자·검은 테두리 자막을 박은 영상."""
    draws = ",".join(
        f"drawtext=fontfile={FONT}:text='{text}':fontsize=30:fontcolor=white:borderw=3:bordercolor=black"
        f":x=(w-text_w)/2:y=h-60:enable='between(t,{a},{b})'"
        for a, b, text in CAPTIONS
    )
    # 한글 줄 아래 영문 번역 줄 (영문 줄은 빼고 한글만 옮겨야 함)
    draws += (
        f",drawtext=fontfile={FONT}:text='The weather is nice today':fontsize=24:fontcolor=white:borderw=3"
        f":bordercolor=black:x=(w-text_w)/2:y=h-28:enable='between(t,8,12)'"
    )
    # 테두리 없이 어두운 반투명 상자 위에 나오는 자막
    draws += (
        f",drawtext=fontfile={FONT}:text='상자 모양 자막도 읽습니다':fontsize=28:fontcolor=white:box=1"
        f":boxcolor=black@0.7:boxborderw=10:x=(w-text_w)/2:y=h-60:enable='between(t,12,16)'"
    )
    # 작은 글씨로 한글 줄 바로 아래에 영문 줄이 붙어 나오는 자막 (실제 리뷰 영상 형태)
    draws += (
        f",drawtext=fontfile={FONT}:text='실내도 승차감도 좋아졌습니다':fontsize=19:fontcolor=white:borderw=2"
        f":bordercolor=black:x=(w-text_w)/2:y=h-50:enable='between(t,17,21)'"
        f",drawtext=fontfile={FONT}:text='The ride feels much softer too':fontsize=17:fontcolor=white:borderw=2"
        f":bordercolor=black:x=(w-text_w)/2:y=h-29:enable='between(t,17,21)'"
    )
    # 자막 바로 위에 함께 나오는 발언자 소개 (옮기면 안 됨, 아래 자막만 옮김)
    draws += (
        f",drawtext=fontfile={FONT}:text='국회의원 김철수':fontsize=20:fontcolor=white:borderw=2"
        f":bordercolor=black:x=(w-text_w)/2:y=h-82:enable='between(t,22,26)'"
        f",drawtext=fontfile={FONT}:text='주택 공급을 늘리겠습니다':fontsize=26:fontcolor=white:borderw=3"
        f":bordercolor=black:x=(w-text_w)/2:y=h-50:enable='between(t,22,26)'"
    )
    # 문구 모양으로는 알 수 없지만 아래 자막이 바뀌는 동안 계속 떠 있는 고정 표시 (옮기면 안 됨)
    draws += (
        f",drawtext=fontfile={FONT}:text='도로교통 연구소 인터뷰':fontsize=20:fontcolor=white:borderw=2"
        f":bordercolor=black:x=(w-text_w)/2:y=h-82:enable='between(t,27,35)'"
    )
    for k, sub in enumerate(STICKY_SUBS):
        draws += (
            f",drawtext=fontfile={FONT}:text='{sub}':fontsize=26:fontcolor=white:borderw=3"
            f":bordercolor=black:x=(w-text_w)/2:y=h-50:enable='between(t,{27 + 2 * k},{28.9 + 2 * k})'"
        )
    # 자막이 아닌 글자 (옮기면 안 됨): 아래 왼쪽 댓글 캡처(흰 바탕 검은 글씨), 아래 오른쪽 효과 글자, 화면 위쪽 글자
    draws += (
        f",drawbox=x=10:y=h-80:w=150:h=60:color=white:t=fill:enable='between(t,0,6)'"
        f",drawtext=fontfile={FONT}:text='댓글 인용':fontsize=22:fontcolor=black:x=20:y=h-62:enable='between(t,0,6)'"
        f",drawtext=fontfile={FONT}:text='깜짝':fontsize=34:fontcolor=yellow:borderw=3:bordercolor=black"
        f":x=w-110:y=h-75:enable='between(t,9,11)'"
        f",drawtext=fontfile={FONT}:text='효과 문구':fontsize=40:fontcolor=white:borderw=3:bordercolor=black"
        f":x=(w-text_w)/2:y=40:enable='between(t,0,36)'"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=25:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-vf", draws, "-c:v", "libvpx", "-b:v", "1M", "-c:a", "libopus", "-shortest", str(path)],
        check=True,
    )


def start_fake_youtube(tmp_path: Path, media: dict, pages=None):
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=www.youtube.com",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )

    posts = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            posts.append((self.path, data))
            params = data.get("params", "")
            client = data.get("context", {}).get("client", {})
            body, code = b"{}", 400
            if self.path.startswith("/youtubei/v1/get_transcript") and params.startswith("PARAMS_"):
                if params != "PARAMS_pageonlyvid" or client.get("fromPage"):
                    body, code = json.dumps(get_transcript_response(params[7:]), ensure_ascii=False).encode(), 200
            elif self.path.startswith("/youtubei/v1/player"):
                code = 200
                if data.get("videoId") == "androidvid1" and client.get("clientName") == "ANDROID":
                    body = json.dumps({"videoDetails": {"title": TITLE}, "captions": {"playerCaptionsTracklistRenderer": {
                        # 업로더가 올린 영어 번역 자막이 먼저, 한국어는 자동 생성 → 한국어를 골라야 한다
                        "captionTracks": [
                            {"languageCode": "en", "baseUrl": "https://www.youtube.com/api/timedtext?v=androidvid1&lang=en&fmt=srv3"},
                            {"languageCode": "ko", "kind": "asr",
                             "baseUrl": "https://www.youtube.com/api/timedtext?v=androidvid1&lang=ko&fmt=srv3"}]}}}).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/api/timedtext") and "androidvid1" in self.path:
                # 예전 XML 형식 (json3 는 안 줌), 글자는 HTML 엔티티가 두 번 감싸져 있다
                ok = "fmt=" not in self.path
                # 자막 파일은 2초짜리 짧은 줄로 잘게 나뉘어 있다 (문장 단위로 합쳐야 함)
                body = ('<?xml version="1.0" encoding="utf-8" ?><transcript>'
                        '<text start="0.5" dur="2">모바일 앱 방식으로</text>'
                        '<text start="2.5" dur="2">&amp;#39;받았어요&amp;#39;</text>'
                        '<text start="62" dur="2">몇일 걸렸어요</text></transcript>').encode()
                if "lang=en" in self.path:
                    body = ('<?xml version="1.0" encoding="utf-8" ?><transcript>'
                            '<text start="0.5" dur="2">English translation</text></transcript>').encode()
                self.send_response(200 if ok else 404)
                self.send_header("Content-Type", "text/xml")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path.startswith("/api/timedtext"):
                body = json.dumps({"events": [
                    {"tStartMs": 0, "segs": [{"utf8": "자막 데이터로"}, {"utf8": " 받았어요"}]},
                    {"tStartMs": 1500, "segs": [{"utf8": "\n"}]},
                    {"tStartMs": 65000, "segs": [{"utf8": "두 번째 줄 할수있다"}]}]}, ensure_ascii=False).encode()
                self.send_response(200 if "fmt=json3" in self.path else 404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path.startswith("/media/"):
                body = media[self.path.split("/")[-1]].read_bytes()
                ctype = "video/webm"
            else:
                vid = self.path.split("v=")[-1][:11]
                html = (pages or {}).get(vid) or WATCH_HTML.format(title=TITLE, name=f"{vid}.webm")
                if callable(html):
                    html = html()
                body = html.encode()
                ctype = "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            if ctype.startswith("text/html"):  # 실제 유튜브처럼 다른 사이트 안에 넣지 못하게
                self.send_header("X-Frame-Options", "SAMEORIGIN")
                self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
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
    server.posts = posts
    return server


def launch(p, tmp_path, ext_dir, port):
    return p.chromium.launch_persistent_context(
        str(tmp_path / "profile"),
        executable_path=CHROMIUM,
        headless=True,
        args=[
            f"--disable-extensions-except={ext_dir}",
            f"--load-extension={ext_dir}",
            f"--host-resolver-rules=MAP www.youtube.com 127.0.0.1:{port}",
            "--no-proxy-server",
            "--ignore-certificate-errors",
            "--autoplay-policy=no-user-gesture-required",
        ],
        accept_downloads=True,
    )


def run_script_and_save_row(page, tmp_path, timeout=120000):
    """[스크립트 만들기] → 완료 알림 → 1번 줄 [.txt] 로 교정본을 받는다. 수집 중 자동 다운로드가 없어야 한다."""
    downloads, dialogs = [], []
    page.on("download", lambda d: downloads.append(d))
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    page.click("#start")
    page.locator("#summary", has_text="수집했습니다").wait_for(timeout=timeout)
    page.wait_for_timeout(1500)
    assert downloads == [], [d.suggested_filename for d in downloads]  # 자동으로 받지 않음
    assert dialogs and "스크립트 수집을 마쳤습니다" in dialogs[0], dialogs
    with page.expect_download(timeout=10000) as dl:
        page.locator("#progress tbody tr").nth(0).locator("button", has_text=".txt").click()
    path = tmp_path / dl.value.suggested_filename
    dl.value.save_as(path)
    return path


def ext_page(ctx, path):
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    page = ctx.new_page()
    page.goto(f"chrome-extension://{sw.url.split('/')[2]}/{path}")
    return page


def test_script(tmp_path: Path):
    ext = tmp_path / "ext"
    shutil.copytree(EXT_DIR, ext, ignore=shutil.ignore_patterns("*.wasm"))
    (ext / "script-worker.js").write_text(FAKE_WORKER, encoding="utf-8")
    media = tmp_path / "scriptvid01.webm"
    make_media(media, 36, gap=(21.5, 23))  # 28초 안쪽에서 가장 조용한 22초 부근에서 잘려야 한다
    server = start_fake_youtube(tmp_path, {media.name: media})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, ext, server.server_address[1])
        page = ext_page(ctx, "script.html")
        assert page.locator(".menu a.active").inner_text() == "스크립트 추출"
        assert page.input_value("#mode") == "transcript"  # 기본은 유튜브 스크립트 가져오기
        page.select_option("#mode", "speech")
        page.fill("#urls", "https://youtu.be/scriptvid01")
        path = run_script_and_save_row(page, tmp_path)
        output = page.input_value("#output")
        status = page.inner_text("#progress tbody")
        ctx.close()
    server.shutdown()

    assert path.name == f"{date.today():%Y%m%d}_{SAFE_TITLE}.txt"
    raw = path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw  # 메모장용 BOM + CRLF
    lines = raw.decode("utf-8-sig").strip().split("\r\n")
    assert lines == output.split("\n"), status
    assert len(lines) == 2, lines
    assert lines[0].startswith("[00:00] 구간1 길이2") and lines[0].endswith("소리있음")
    t2 = lines[1].split(" ")[0]
    assert t2 in ("[00:21]", "[00:22]", "[00:23]"), lines  # 무음 구간에서 잘림
    assert lines[1].endswith("소리있음")


# 유튜브 영상 페이지 흉내: 설명란 '…더보기'를 누르면 '스크립트 표시' 버튼이 생기고,
# 그것을 누르면 오른쪽에 스크립트 패널이 (조금 늦게) 그려진다. transcript=False 면 스크립트 버튼이 없다.
TRANSCRIPT_SEGS = [("0:00", "안녕하세요 여러분"), ("0:05", "오늘은   팰리세이드\n시승기입니다"),
                   ("0:09", "이렇게 됬어요 할수있다"), ("1:02:03", "끝까지 봐주셔서 감사합니다")]


def get_transcript_response(vid):
    """유튜브 get_transcript 응답 흉내 (transcriptSegmentRenderer 목록)."""
    segs = []
    for t, x in TRANSCRIPT_SEGS:
        sec = 0
        for part in t.split(":"):
            sec = sec * 60 + int(part)
        segs.append({"transcriptSegmentRenderer": {
            "startMs": str(sec * 1000), "endMs": str(sec * 1000 + 3000),
            "snippet": {"runs": [{"text": x}]}, "startTimeText": {"simpleText": t}}})
    if vid == "transcrvid1":  # 챕터 머리글 (두 가지 형태)
        segs.insert(0, {"transcriptSectionHeaderRenderer": {"startMs": "0", "snippet": {"simpleText": "오프닝"}}})
        segs.insert(4, {"transcriptSectionHeaderRenderer": {"startMs": "3723000", "sectionHeader": {
            "sectionHeaderViewModel": {"headline": {"content": "마무리"}}}}})
    return {"actions": [{"updateEngagementPanelAction": {"content": {"transcriptRenderer": {"content": {
        "transcriptSearchPanelRenderer": {"body": {"transcriptSegmentListRenderer": {"initialSegments": segs}}}}}}}}]}


# 유튜브 영상 페이지 흉내.
# - api=True: 페이지 데이터(ytInitialData)에 '스크립트 표시'용 요청 정보가 있어 get_transcript 로 바로 받을 수 있다.
# - 화면: 설명란 '…더보기'를 누르면 '스크립트 표시' 버튼이, 그것을 누르면 오른쪽 스크립트 패널이 그려진다.
#   실제 유튜브처럼 화면 그리기는 requestAnimationFrame 으로 해서, 보이지 않는 뒤쪽 탭에서는 그려지지 않는다.
# - transcript=False 면 '스크립트 표시' 버튼이 없다. captions=False 면 자막이 아예 없는 영상.
def transcript_page(vid, transcript=True, api=False, captions=None, modern=False, timedtext=False, page_only=False):
    """modern=True: 새 스크립트 화면처럼 줄에 클래스 이름이 없고 읽어주기용 시간 글자('9초')가 붙어 있다.
    timedtext=True: 자막 트랙 주소(baseUrl)가 있어 자막 데이터를 직접 받을 수 있다."""
    captions = transcript or timedtext if captions is None else captions
    segs_js = json.dumps(TRANSCRIPT_SEGS, ensure_ascii=False)
    def label(t):
        p = [int(x) for x in t.split(":")]
        sec = p[-1] + (p[-2] * 60 if len(p) > 1 else 0) + (p[-3] * 3600 if len(p) > 2 else 0)
        h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
        return " ".join(x for x in [f"{h}시간" if h else "", f"{m}분" if m else "", f"{s}초" if s or not (h or m) else ""] if x)
    if modern:
        seg_html = ("'<transcript-segment-view-model><div>' + t + '</div><div>' + "
                    "{lab}[t] + '</div><span>' + x + '</span></transcript-segment-view-model>'").format(
            lab=json.dumps({t: label(t) for t, _ in TRANSCRIPT_SEGS}, ensure_ascii=False))
    else:
        seg_html = ("'<ytd-transcript-segment-renderer><div class=\"segment-timestamp\">' + t + '</div>"
                    "<yt-formatted-string class=\"segment-text\">' + x + '</yt-formatted-string></ytd-transcript-segment-renderer>'")
    section = ('<ytd-video-description-transcript-section-renderer><h2>스크립트</h2><ytd-button-renderer>'
               '<button aria-label="스크립트 표시">스크립트 표시</button></ytd-button-renderer>'
               '</ytd-video-description-transcript-section-renderer>') if transcript else ""
    initial_data = {"contents": {}, "engagementPanels": []}
    if api:
        initial_data["engagementPanels"].append({"engagementPanelSectionListRenderer": {
            "panelIdentifier": "engagement-panel-searchable-transcript",
            "content": {"continuationItemRenderer": {"continuationEndpoint": {
                "getTranscriptEndpoint": {"params": f"PARAMS_{vid}"}}}}}})
    player = {"videoDetails": {"title": TITLE}}
    if captions:
        track = {"languageCode": "ko", "kind": "asr"}
        if timedtext:
            track["baseUrl"] = f"https://www.youtube.com/api/timedtext?v={vid}&lang=ko"
        player["captions"] = {"playerCaptionsTracklistRenderer": {"captionTracks": [track]}}
    client = {"clientName": "WEB", "clientVersion": "2.0"}
    if page_only:  # 페이지 안의 유튜브 설정으로 보낸 요청만 받아 주는 영상 (확장에서 바로 보낸 요청은 거절)
        client["fromPage"] = True
    cfg = {"INNERTUBE_API_KEY": "KEY", "INNERTUBE_CONTEXT": {"client": client},
           "INNERTUBE_CONTEXT_CLIENT_NAME": 1, "INNERTUBE_CLIENT_VERSION": "2.0"}
    return f"""<!doctype html><html><head><title>{TITLE} - YouTube</title>
<script>
var ytcfg = {{ d: {json.dumps(cfg)}, get(k) {{ return this.d[k]; }} }};
var ytInitialPlayerResponse = {json.dumps(player, ensure_ascii=False)};
var ytInitialData = {json.dumps(initial_data)};
</script></head><body>
<ytd-watch-metadata><h1 class="ytd-watch-metadata">{TITLE}</h1>
<div id="description"><ytd-text-inline-expander id="description-inline-expander">영상 설명입니다
<tp-yt-paper-button id="expand">...더보기</tp-yt-paper-button><div id="more"></div></ytd-text-inline-expander></div>
</ytd-watch-metadata>
<div id="movie_player"><video src="/media/{vid}.webm" autoplay></video></div>
<div id="panels"></div>
<script>
document.getElementById("expand").addEventListener("click", () => requestAnimationFrame(() => {{
  document.getElementById("more").innerHTML = '{section}';
  const b = document.querySelector('button[aria-label="스크립트 표시"]');
  if (b) b.addEventListener("click", () => setTimeout(() => requestAnimationFrame(() => {{
    const panel = document.createElement("ytd-engagement-panel-section-list-renderer");
    panel.setAttribute("target-id", "engagement-panel-searchable-transcript");
    for (const [t, x] of {segs_js}) panel.insertAdjacentHTML("beforeend", {seg_html});
    document.getElementById("panels").appendChild(panel);
  }}), 700));
}}));
</script></body></html>"""


@pytest.mark.skipif(not Path(FONT).exists(), reason="한글 글꼴 없음")
def test_youtube_transcript(tmp_path: Path):
    """유튜브 스크립트 가져오기:
    - 스크립트가 있는 영상은 패널 내용을 그대로 (교정본 + 원본), 수집 중 자동 다운로드 없음, 끝나면 완료 알림
    - 처음엔 스크립트가 안 보이다가 나중에 보이는 영상은 [재시도]로 수집
    - 스크립트가 없는 영상은 [화면 자막으로]로 수집
    - [전체 스크립트 한 파일로 받기]: 모든 영상을 구분선으로 나눠 한 파일에"""
    media = tmp_path / "notranscr01.webm"
    make_captioned_media(media, 23)
    flaky_hits = []

    def flaky():  # 처음 네 번(수집: 바로 받기 + 보이지 않는 틀, 전체 다시 수집: 같은 두 번)은 버튼이 없고, 다섯 번째부터 보인다
        flaky_hits.append(1)
        return transcript_page("flakyvideo1", len(flaky_hits) > 4, captions=True, modern=True)

    # transcrvid1: 데이터로 바로 받음(뒤쪽 탭) / flakyvideo1: 데이터가 없어 화면 버튼으로, 세 번째에야 버튼이 보임
    # notranscr01: 자막이 아예 없음 → 바로 '스크립트 없음'
    # captionvid1: 스크립트 버튼·요청 정보는 없지만 자막 데이터로 받음
    pages = {"transcrvid1": transcript_page("transcrvid1", api=True), "flakyvideo1": flaky,
             "notranscr01": transcript_page("notranscr01", False),
             "captionvid1": transcript_page("captionvid1", False, timedtext=True),
             # pageonlyvid: 확장에서 바로 보낸 요청은 거절 → 수집 화면 안 보이지 않는 틀의 페이지 안에서 받음
             "pageonlyvid": transcript_page("pageonlyvid", False, api=True, captions=True, page_only=True),
             # androidvid1: 모바일 앱 방식으로 받은 자막 목록의 자막 파일(XML)
             "androidvid1": transcript_page("androidvid1", False, captions=True)}
    server = start_fake_youtube(tmp_path, {media.name: media}, pages)
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        page = ext_page(ctx, "script.html")
        assert page.input_value("#mode") == "transcript" and page.input_value("#fallback") == "ask"
        assert page.is_hidden("#speed") and page.is_hidden("#model")
        assert page.is_disabled("#saveAll")
        downloads, dialogs, opened = [], [], []
        ctx.on("page", lambda pg: opened.append(pg))
        page.on("download", lambda d: downloads.append(d))
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

        # 확장이 여는 탭(창 번호·앞에 보이는지)을 기록
        page.evaluate("""() => { window.__created = [];
          chrome.tabs.onCreated.addListener((t) => window.__created.push({ url: t.pendingUrl || t.url, windowId: t.windowId, active: t.active }));
          chrome.tabs.onUpdated.addListener((id, info) => { if (info.url) window.__created.push({ url: info.url, tabId: id, update: true }); }); }""")
        my_window = page.evaluate("chrome.windows.getCurrent().then((w) => w.id)")
        page.fill("#urls", "https://www.youtube.com/watch?v=transcrvid1\nhttps://youtu.be/flakyvideo1\n"
                           "https://youtu.be/notranscr01\nhttps://youtu.be/captionvid1\n"
                           "https://youtu.be/pageonlyvid\nhttps://youtu.be/androidvid1")
        page.click("#start")
        page.locator("#summary", has_text="수집했습니다").wait_for(timeout=120000)
        page.wait_for_timeout(1500)
        assert downloads == [], [d.suggested_filename for d in downloads]  # 자동으로 받지 않음
        assert len(dialogs) == 1 and "스크립트 수집을 마쳤습니다" in dialogs[0] and "성공 4개 · 스크립트 없음 2개" in dialogs[0], dialogs
        rows = page.locator("#progress tbody tr")
        assert "완료 · 6줄 · 교정 2곳" in rows.nth(0).inner_text()  # 챕터 2줄 포함
        for k in (1, 2):
            assert "스크립트를 찾지 못했습니다" in rows.nth(k).inner_text()
            assert rows.nth(k).locator("button", has_text="재시도").count() == 1
            assert rows.nth(k).locator("button", has_text="화면에서 가져오기").count() == 1
        assert len(flaky_hits) == 2  # 바로 받기 → 보이지 않는 틀 (화면 버튼은 누르지 않음)
        # 자동 수집 중에는 탭·창을 하나도 띄우지 않는다 (다른 작업 방해 금지)
        assert page.evaluate("window.__created") == []
        assert page.evaluate("chrome.windows.getAll().then((ws) => ws.length)") == 1
        assert page.locator("iframe").count() == 0  # 보이지 않는 틀은 쓰고 나면 지운다
        # 5번은 바로 받기는 거절됐지만 보이지 않는 틀 안의 영상 페이지에서 받았다
        assert "완료" in rows.nth(4).inner_text()
        assert any(path.startswith("/youtubei/v1/get_transcript") and d["context"]["client"].get("fromPage")
                   for path, d in server.posts), server.posts
        # 1번은 화면을 그리지 않고 get_transcript 로 받았다 (유튜브 화면과 같은 요청)
        tr = [d for path, d in server.posts if path.startswith("/youtubei/v1/get_transcript")]
        assert tr and tr[0]["params"] == "PARAMS_transcrvid1" and tr[0]["context"]["client"]["clientName"] == "WEB", server.posts
        assert tr[0]["context"]["client"]["clientVersion"] == "2.0"  # 페이지의 클라이언트 버전 그대로
        # 진행 목록의 주소는 새 탭으로 여는 링크
        link = rows.nth(0).locator("a")
        assert link.get_attribute("href") == "https://www.youtube.com/watch?v=transcrvid1"
        assert link.get_attribute("target") == "_blank"
        assert "완료" in rows.nth(3).inner_text() and "완료" in rows.nth(5).inner_text()

        # [수집 안 된 영상 전체 다시 수집]: 이때도 탭을 띄우지 않는다 (2, 3번 모두 여전히 없음)
        assert page.inner_text("#retryFailed") == "수집 안 된 영상 전체 다시 수집 (2개)"
        page.click("#retryFailed")
        page.locator("#summary", has_text="다시 수집: 0 / 2개 성공").wait_for(timeout=120000)
        assert len(dialogs) == 2 and "수집 안 된 영상 다시 수집을 마쳤습니다" in dialogs[1], dialogs
        assert page.evaluate("window.__created") == [] and len(flaky_hits) == 4
        # [화면에서 가져오기]: 사용자가 누른 경우에만 유튜브 탭을 띄워 버튼을 직접 누른다
        rows.nth(1).locator("button", has_text="화면에서 가져오기").click()
        rows.nth(1).locator(".status", has_text="완료").wait_for(timeout=60000)
        created = page.evaluate("window.__created")
        tabs = [c for c in created if not c.get("update")]
        assert len(tabs) == 1 and "flakyvideo1" in tabs[0]["url"] and tabs[0]["windowId"] == my_window, created
        assert page.inner_text("#retryFailed") == "수집 안 된 영상 전체 다시 수집 (1개)"
        # 스크립트가 없는 영상: [화면 자막으로]
        rows.nth(2).locator("button", has_text="화면 자막으로").click()
        rows.nth(2).locator(".status", has_text="완료").wait_for(timeout=120000)
        page.wait_for_timeout(1000)
        assert downloads == [] and len(dialogs) == 2  # 줄 버튼 재수집 때는 자동 다운로드·알림 없음
        assert page.is_hidden("#retryFailed")  # 모두 수집함

        rows.nth(0).locator("button", has_text="보기").click()
        output = page.input_value("#output")
        # 줄의 [.txt]: 교정본 + 원본
        rows.nth(0).locator("button", has_text=".txt").click()
        page.wait_for_timeout(2500)
        row_files = []
        for k, d in enumerate(downloads):
            path = tmp_path / f"row{k}_{d.suggested_filename}"
            d.save_as(path)
            row_files.append((d.suggested_filename, path))
        # [전체 스크립트 받기]: 기본은 엑셀(첨부 양식), 텍스트 묶음도 고를 수 있다
        assert page.input_value("#saveFormat") == "xlsx"
        note = page.locator("#xlsxNote")
        assert note.is_visible() and "linesquare--monitor.web.app" in note.inner_text() and "일괄 등록이 가능한 파일" in note.inner_text()
        assert note.evaluate("(el) => getComputedStyle(el).color") == "rgb(217, 48, 37)"  # 빨간 글씨
        assert note.locator("a").get_attribute("target") == "_blank"
        with page.expect_download(timeout=10000) as dl:
            page.click("#saveAll")
        xlsx_name = dl.value.suggested_filename
        xlsx_path = tmp_path / "all.xlsx"
        dl.value.save_as(xlsx_path)
        page.select_option("#saveFormat", "txt")
        assert page.is_hidden("#xlsxNote")  # 텍스트를 고르면 엑셀 안내는 숨김
        with page.expect_download(timeout=10000) as dl:
            page.click("#saveAll")
        all_name = dl.value.suggested_filename
        all_path = tmp_path / "all.txt"
        dl.value.save_as(all_path)
        ctx.close()
    server.shutdown()

    read = lambda p: p.read_bytes().decode("utf-8-sig").strip().split("\r\n")
    base = f"{date.today():%Y%m%d}_{SAFE_TITLE}"
    assert [n for n, _ in row_files] == [f"{base}.txt", f"{base}_원본.txt"], row_files
    fixed0, original = read(row_files[0][1]), read(row_files[1][1])
    # 교정본: 겹친 공백·줄바꿈 정리, 됬→됐, 할수있다→할 수 있다 / 원본: 패널 글자 그대로
    fixed = ["[00:00] 안녕하세요 여러분", "[00:05] 오늘은 팰리세이드 시승기입니다",
             "[00:09] 이렇게 됐어요 할 수 있다", "[1:02:03] 끝까지 봐주셔서 감사합니다"]
    # 1번 영상은 챕터가 있어 "챕터 N: 제목" 줄이 들어간다
    assert fixed0 == ["챕터 1: 오프닝", *fixed[:3], "챕터 2: 마무리", fixed[3]], fixed0
    assert original[3] == "[00:09] 이렇게 됬어요 할수있다", original
    assert output.split("\n") == fixed0  # 화면 출력칸도 교정본

    assert all_name == f"{date.today():%Y%m%d}_유튜브스크립트_6개.txt"
    text = all_path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
    blocks = text.strip().split("\n\n\n")
    assert len(blocks) == 6, text
    sep = "=" * 60
    vids = ["transcrvid1", "flakyvideo1", "notranscr01", "captionvid1", "pageonlyvid", "androidvid1"]
    for k, (vid, block) in enumerate(zip(vids, blocks), 1):
        head = block.split("\n")
        assert head[0] == sep and head[3] == sep, block
        assert head[1] == f"[{k}/6] {TITLE}" and head[2] == f"https://www.youtube.com/watch?v={vid}", block
    assert blocks[0].split("\n")[4:] == fixed0
    # 새 스크립트 화면: 줄 앞의 읽어주기용 시간 글자('9초', '1시간 2분 3초')는 빠진다
    assert blocks[1].split("\n")[4:] == fixed, blocks[1]
    assert blocks[3].split("\n")[4:] == ["[00:00] 자막 데이터로 받았어요", "[01:05] 두 번째 줄 할 수 있다"], blocks[3]
    assert blocks[4].split("\n")[4:] == fixed, blocks[4]
    assert blocks[5].split("\n")[4:] == [
        "[00:00] 모바일 앱 방식으로 '받았어요'", "[01:02] 며칠 걸렸어요"], blocks[5]
    assert "안녕하세요 반갑습니다" in blocks[2] and "오늘은 날씨가 좋습니다" in blocks[2], blocks[2]

    # 엑셀: 첨부 양식('스크립트 입력' 시트, A: URL / B: 스크립트) 그대로, 영상마다 한 줄
    assert xlsx_name == f"{date.today():%Y%m%d}_유튜브스크립트_6개.xlsx"
    ws = load_workbook(xlsx_path)["스크립트 입력"]
    assert [c.value for c in ws[1]] == ["URL", "스크립트"]
    assert ws["A1"].font.b and ws["A1"].fill.fgColor.rgb == "FF003082" and ws["A1"].font.color.rgb == "FFFFFFFF"
    for ref in ("A2", "B2", "A7", "B7"):  # 새로 넣은 줄도 양식 서식: 맑은 고딕 10, 위쪽 맞춤, 테두리·채우기 없음
        c = ws[ref]
        assert c.font.name == "맑은 고딕" and c.font.sz == 10 and not c.font.b, ref
        assert c.alignment.vertical == "top" and c.border.left.style is None and c.fill.fill_type is None, ref
    assert ws["B7"].alignment.wrap_text and not ws["A7"].alignment.wrap_text
    assert ws.auto_filter.ref == "A1:B7"  # 필터도 마지막 줄까지
    import zipfile  # 필터 숨은 이름도 같은 범위
    assert "'스크립트 입력'!$A$1:$B$7</definedName>" in zipfile.ZipFile(xlsx_path).read("xl/workbook.xml").decode()
    assert ws.column_dimensions["B"].width == 120 and ws.freeze_panes == "A2"
    rows_x = [(r[0].value, r[1].value) for r in ws.iter_rows(min_row=2)]
    assert [a for a, _ in rows_x] == [f"https://www.youtube.com/watch?v={v}" for v in vids]
    for (_, b), block in zip(rows_x, blocks):  # B칸 = 텍스트 묶음의 해당 영상 내용과 같다
        assert b == "\n".join(block.split("\n")[4:]), (b, block)


def claude_sse(text):
    """Claude API 스트리밍 응답(SSE) 흉내: text 하나를 돌려준다."""
    events = [
        ("message_start", {"type": "message_start", "message": {
            "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
            "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                           "usage": {"output_tokens": 20}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {e}\ndata: {json.dumps(d, ensure_ascii=False)}\n\n" for e, d in events)


def test_ai_correction(tmp_path: Path):
    """AI 교정(Claude API): 설정 저장, 요청 내용(모델·대체 모델·구조화된 출력·키), 결과 반영, 키 오류 시 기본 교정본."""
    server = start_fake_youtube(tmp_path, {}, {"transcrvid1": transcript_page("transcrvid1", api=True)})
    calls = []
    mode = {"fail": False}

    def claude(route):
        req = route.request
        calls.append({"headers": req.headers, "body": json.loads(req.post_data)})
        if mode["fail"]:
            route.fulfill(status=401, content_type="application/json", body=json.dumps(
                {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}))
            return
        lines = json.loads(calls[-1]["body"]["messages"][0]["content"].split("\n\n", 1)[1])["lines"]
        route.fulfill(status=200, content_type="text/event-stream",
                      body=claude_sse(json.dumps({"lines": [f"AI:{t}" for t in lines]}, ensure_ascii=False)))

    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        ctx.route("https://api.anthropic.com/**", claude)
        page = ext_page(ctx, "script.html")
        page.on("dialog", lambda d: d.accept())
        assert not page.is_checked("#aiOn") and page.is_hidden("#aiKey")  # 기본은 꺼짐
        assert page.evaluate("getComputedStyle(document.querySelector('#start'), '::before').content") == "none"  # AI 교정이 꺼져 있으면 💰 없음
        page.check("#aiOn")
        assert page.evaluate("getComputedStyle(document.querySelector('#start'), '::before').content") == '"💰 "'  # 비용이 드는 버튼 앞에 💰
        page.fill("#aiKey", "sk-ant-test-key")
        assert page.input_value("#aiModel") == "claude-opus-5-5"
        page.fill("#urls", "https://www.youtube.com/watch?v=transcrvid1")
        page.click("#start")
        page.locator("#summary", has_text="수집했습니다").wait_for(timeout=60000)
        row = page.locator("#progress tbody tr").nth(0)
        assert "완료 · 6줄 · AI 교정" in row.inner_text(), row.inner_text()
        output = page.input_value("#output").split("\n")
        # 설정은 이 PC 크롬에 저장되어 다시 열어도 남아 있다
        page.reload()
        assert page.is_checked("#aiOn") and page.input_value("#aiKey") == "sk-ant-test-key"
        assert page.evaluate("getComputedStyle(document.querySelector('#start'), '::before').content") == '"💰 "'  # 다시 열어도 💰 유지
        # 키가 틀리면 기본 교정본으로
        mode["fail"] = True
        page.fill("#urls", "https://www.youtube.com/watch?v=transcrvid1")
        page.click("#start")
        page.locator("#summary", has_text="수집했습니다").wait_for(timeout=60000)
        row = page.locator("#progress tbody tr").nth(0)
        failed_status = row.inner_text()
        failed_output = page.input_value("#output").split("\n")
        ctx.close()
    server.shutdown()

    # AI 결과가 그대로 반영 (시간·챕터 줄 구성은 유지)
    assert output == ["챕터 1: AI:오프닝", "[00:00] AI:안녕하세요 여러분", "[00:05] AI:오늘은 팰리세이드 시승기입니다",
                      "[00:09] AI:이렇게 됐어요 할 수 있다", "챕터 2: AI:마무리", "[1:02:03] AI:끝까지 봐주셔서 감사합니다"], output
    req = calls[0]
    assert req["headers"]["x-api-key"] == "sk-ant-test-key"
    assert "server-side-fallback-2026-07-01" in req["headers"].get("anthropic-beta", "")
    assert req["headers"].get("anthropic-dangerous-direct-browser-access") == "true"
    body = req["body"]
    assert body["model"] == "claude-opus-5-5" and body["fallbacks"] == "default" and body["stream"] is True
    assert body["output_config"]["effort"] == "low" and body["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in body and "temperature" not in body
    assert "자동차" in body["system"]
    sent = json.loads(body["messages"][0]["content"].split("\n\n", 1)[1])["lines"]
    assert "이렇게 됐어요 할 수 있다" in sent  # 기본 규칙 교정본을 AI 에 보낸다
    assert "API 키가 올바르지 않습니다" in failed_status and "기본 교정본 사용" in failed_status, failed_status
    assert "[00:09] 이렇게 됐어요 할 수 있다" in failed_output and not any("AI:" in l for l in failed_output)


def make_review_xlsx(path: Path):
    """사용자의 스크립트 분석 RAW 파일처럼 생긴 엑셀: '스크립트 RAW'(머리글 없음, A~H) + 분석 결과 + 분할 원문 시트."""
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "스크립트 RAW"
    url = lambda v: f"https://www.youtube.com/watch?v={v}"
    rows = [
        (1, "채널A", "팰리세이드 시승기", "2026-10-10", url("aaaaaaaaaaa"),
         "[0:00] 안녕하세요 여러분\n[0:05] 오늘은 시승기 입니다\n[1:02:03] 할수있다", "비판", "negative"),
        (2, "채널B", "관련 없는 영상", "2026-10-10", url("bbbbbbbbbbb"), "[0:00] 해당없는 내용", "해당없음", "non_negative"),
        (3, "채널C", "ASMR", "2026-10-10", url("ccccccccccc"), "ASMR 영상", "ASMR 영상", "non_negative"),
        (4, "채널D", "긴 영상", "2026-10-10", url("ddddddddddd"), "[0:00] 잘린 앞부분", "부정/비난", "negative"),
    ]
    for row in rows:
        ws.append(row)
    wb.create_sheet("전체 분석 결과").append(["항목", "값"])
    split = wb.create_sheet("전체 스크립트 분할 원문")
    split.append(["URL", "제목", "분할 순번", "원문"])
    split.append([url("aaaaaaaaaaa"), "팰리세이드 시승기", "1", rows[0][5]])
    split.append([url("bbbbbbbbbbb"), "관련 없는 영상", "1", rows[1][5]])
    split.append([url("ddddddddddd"), "긴 영상", "2", " 이어지는 뒷부분\n[9:00] 정말 됬어요"])
    split.append([url("ddddddddddd"), "긴 영상", "1", "[0:00] 좋아요\n\n[0:10] 앞부분 끝"])
    wb.save(path)


def test_ai_review(tmp_path: Path):
    """스크립트 AI 검열: G열 '해당없음'·스크립트 없는 행은 빼고, 나머지를 시간 표시를 살려 교정해
    모니터링 사이트 양식('스크립트 입력': URL / 스크립트 / 분할번호 + '작성 안내')의 _modify.xlsx 로 받는다."""
    src = tmp_path / "20261011_스크립트분석_RAW.xlsx"
    make_review_xlsx(src)
    sent = []

    def claude(route):
        body = json.loads(route.request.post_data)
        lines = json.loads(body["messages"][0]["content"].split("\n\n", 1)[1])["lines"]
        sent.append(lines)
        route.fulfill(status=200, content_type="text/event-stream",
                      body=claude_sse(json.dumps({"lines": [f"AI:{t}" for t in lines]}, ensure_ascii=False)))

    server = start_fake_youtube(tmp_path, {})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        ctx.route("https://api.anthropic.com/**", claude)
        page = ext_page(ctx, "review.html")
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        page.set_input_files("#reviewFile", str(src))
        info = page.locator("#fileInfo", has_text="검토 대상")
        info.wait_for(timeout=10000)
        text = info.inner_text()
        assert "검토 대상 2행" in text and "'해당없음' 1행" in text and "없는 행 1행" in text, text
        assert "20261011_스크립트분석_RAW_modify.xlsx" in text, text
        assert page.locator("#progress tbody tr").count() == 2
        page.fill("#aiKey", "sk-ant-test-key")
        page.click("#start")
        page.locator("#summary", has_text="2 / 2행 교정").wait_for(timeout=60000)
        assert "예상 요금" in dialogs[0] and "AI 검토를 마쳤습니다" in dialogs[1], dialogs
        assert "완료 (2조각)" in page.locator("#progress tbody tr").nth(1).inner_text()
        with page.expect_download(timeout=10000) as dl:
            page.click("#saveModify")
        out = tmp_path / dl.value.suggested_filename
        dl.value.save_as(out)
        ctx.close()
    server.shutdown()

    assert out.name == "20261011_스크립트분석_RAW_modify.xlsx"
    flat = [t for chunk in sent for t in chunk]
    assert "해당없는 내용" not in flat and "할 수 있다" in flat and "정말 됐어요" in flat, flat  # 기본 교정 후 AI 에 보냄
    assert "잘린 앞부분" not in flat  # 분할 원문이 있으면 잘린 F열 대신 조각을 쓴다
    wb = load_workbook(out)
    assert wb.sheetnames == ["스크립트 입력", "작성 안내"]
    ws = wb["스크립트 입력"]
    assert [c.value for c in ws[1]] == ["URL", "스크립트", "분할번호"]
    got = [[c.value for c in r] for r in ws.iter_rows(min_row=2)]
    assert got == [
        ["https://www.youtube.com/watch?v=aaaaaaaaaaa",
         "[0:00] AI:안녕하세요 여러분\n[0:05] AI:오늘은 시승기 입니다\n[1:02:03] AI:할 수 있다", None],
        ["https://www.youtube.com/watch?v=ddddddddddd", "[0:00] AI:좋아요\n\n[0:10] AI:앞부분 끝", 1],
        ["https://www.youtube.com/watch?v=ddddddddddd", " AI:이어지는 뒷부분\n[9:00] AI:정말 됐어요", 2],
    ], got
    # 양식 서식 그대로: 머리글 남색·흰 굵은 맑은 고딕 10, 내용 맑은 고딕 10 가운데(세로), 열 너비, 틀 고정, URL 링크
    h = ws["A1"]
    assert h.font.b and h.font.sz == 10 and h.font.color.rgb == "FFFFFFFF" and h.fill.fgColor.rgb == "FF003082"
    assert h.alignment.horizontal == "center"
    for ref in ("A2", "B2", "A4", "B4"):
        c = ws[ref]
        assert c.font.name == "맑은 고딕" and c.font.sz == 10 and c.alignment.vertical == "center", ref
        assert c.border.left.style is None and c.fill.fill_type is None, ref
    assert [ws.column_dimensions[c].width for c in "ABC"] == [55, 120, 12] and ws.freeze_panes == "A2"
    assert ws["A3"].hyperlink.target == "https://www.youtube.com/watch?v=ddddddddddd"
    assert wb["작성 안내"]["A1"].value == "URL은 유지하고 스크립트만 수정하세요. 빈 스크립트는 기존 값을 보존합니다."


@pytest.mark.skipif(not Path(FONT).exists(), reason="한글 글꼴 없음")
def test_screen_captions(tmp_path: Path):
    media = tmp_path / "screenvid01.webm"
    make_captioned_media(media, 37)
    server = start_fake_youtube(tmp_path, {media.name: media})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        page = ext_page(ctx, "script.html")
        page.select_option("#mode", "screen")
        assert page.is_hidden("#model") and page.is_visible("#region")
        assert page.input_value("#speed") == "3"
        page.select_option("#speed", "3")
        page.fill("#urls", "https://www.youtube.com/watch?v=screenvid01")
        path = run_script_and_save_row(page, tmp_path)
        output = page.input_value("#output")
        ctx.close()
    server.shutdown()

    assert path.name == f"{date.today():%Y%m%d}_{SAFE_TITLE}.txt"
    lines = path.read_bytes().decode("utf-8-sig").strip().split("\r\n")
    assert lines == output.split("\n")
    print("\n".join(lines))
    assert len(lines) == 9, lines  # 같은 자막을 여러 번 적지 않고, 자막 없는 구간은 비운다
    assert lines[:5] == [
        f"{lines[0][:7]} 안녕하세요 반갑습니다",
        f"{lines[1][:7]} 오늘은 날씨가 좋습니다",
        f"{lines[2][:7]} 상자 모양 자막도 읽습니다",
        f"{lines[3][:7]} 실내도 승차감도 좋아졌습니다",
        f"{lines[4][:7]} 주택 공급을 늘리겠습니다",
    ], lines
    # 고정 표시 아래 자막: 고정 표시는 빠지고 자막만 남는다 (작은 글씨라 한두 글자 오인식은 허용)
    from difflib import SequenceMatcher
    for line, sub in zip(lines[5:], STICKY_SUBS):
        got = line[8:].replace(" ", "")
        assert SequenceMatcher(None, got, sub.replace(" ", "")).ratio() >= 0.85, (line, sub)
    for line, times in zip(lines, [("00:00", "00:01"), ("00:07", "00:08"), ("00:11", "00:12"), ("00:16", "00:17"),
                                    ("00:21", "00:22"), ("00:26", "00:27"), ("00:28", "00:29"),
                                    ("00:30", "00:31"), ("00:32", "00:33")]):
        assert line[:7] in [f"[{t}]" for t in times], lines
    # 하단 가운데 자막이 아닌 글자(댓글 캡처, 옆 효과 글자, 위쪽 글자)와 영문 번역 줄은 옮기지 않는다
    for decoy in ("댓글", "인용", "깜짝", "효과", "문구", "weather", "ride", "soft", "국회의원", "김철수", "연구소", "인터뷰"):
        assert decoy not in "\n".join(lines), lines


def test_video(tmp_path: Path):
    media = tmp_path / "videovid001.webm"
    make_media(media, 6)
    server = start_fake_youtube(tmp_path, {media.name: media})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        page = ext_page(ctx, "video.html")
        assert page.input_value("#kind") == "fastvideo"  # 기본은 영상 빠른 다운로드
        page.select_option("#kind", "video")
        page.fill("#urls", "https://www.youtube.com/watch?v=videovid001")
        with ctx.expect_event("download", timeout=60000) as dl:
            page.click("#start")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        page.locator("#summary", has_text="저장했습니다").wait_for(timeout=60000)
        status = page.inner_text("#progress tbody")
        ctx.close()
    server.shutdown()

    assert path.stem == f"{date.today():%Y%m%d}_{SAFE_TITLE}", status
    assert path.suffix in (".mp4", ".webm")
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, text=True).stdout)
    kinds = {s["codec_type"] for s in probe["streams"]}
    assert kinds == {"video", "audio"}
    assert 5.5 < float(probe["format"].get("duration", 0) or 0) < 7.5


def test_audio(tmp_path: Path):
    media = tmp_path / "audiovid001.webm"
    make_media(media, 6)
    server = start_fake_youtube(tmp_path, {media.name: media})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        page = ext_page(ctx, "video.html")
        assert page.locator(".menu a.active").inner_text() == "영상·음성 파일 다운로드"
        page.select_option("#kind", "audio")
        page.fill("#urls", "https://www.youtube.com/watch?v=audiovid001")
        with ctx.expect_event("download", timeout=60000) as dl:
            page.click("#start")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        page.locator("#summary", has_text="음성 파일을 다운로드 폴더에 저장했습니다").wait_for(timeout=60000)
        status = page.inner_text("#progress tbody")
        ctx.close()
    server.shutdown()

    assert path.name == f"{date.today():%Y%m%d}_{SAFE_TITLE}.mp3", status
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, text=True).stdout)
    assert [s["codec_name"] for s in probe["streams"]] == ["mp3"]
    assert probe["streams"][0]["channels"] == 2
    assert 5.5 < float(probe["format"]["duration"]) < 7.5
    # 440Hz 소리가 실제로 들어 있는지 (무음 파일이 아닌지)
    vol = subprocess.run(["ffmpeg", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    mean = float(vol.split("mean_volume:")[1].split("dB")[0])
    assert mean > -40, vol


HELPER_APP = Path(__file__).resolve().parent.parent / "유튜브 도우미 설치.app"
EXT_ID = "pjmcafienhpdbpljglddhaknajaekhcm"


WIN_HOST = Path(__file__).resolve().parent.parent / "windows-helper" / "helper" / "ytdl_host.ps1"
PWSH = os.environ.get("PWSH_PATH") or shutil.which("pwsh")


def run_fast_helper(tmp_path: Path, kind: str, media_name: str, make_cmd, quality=None, windows=False):
    """빠른 다운로드: 확장 → (Native Messaging) → 도우미(ytdl_host.sh 또는 윈도우용 ytdl_host.ps1) → yt-dlp.
    유튜브 대신 로컬 파일을 받도록 yt-dlp 만 바꿔 끼운다. → (상태 글, 받은 파일들)
    windows=True 면 윈도우 도우미(PowerShell)를 리눅스용 PowerShell(pwsh)로 실행해 같은 흐름을 확인한다."""
    if windows and not PWSH:
        pytest.skip("pwsh 없음")
    import shutil as _sh
    ytdlp = _sh.which("yt-dlp")
    if not ytdlp:
        pytest.skip("yt-dlp 없음")
    media = tmp_path / "srv" / media_name
    media.parent.mkdir()
    subprocess.run(make_cmd(media), check=True)
    srv = subprocess.Popen(["python3", "-m", "http.server", "0", "--bind", "127.0.0.1"], cwd=media.parent,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    port = int(srv.stdout.readline().split("port ")[1].split(" ")[0])
    out = tmp_path / "Downloads"
    out.mkdir()
    fake = tmp_path / "fake_ytdlp.sh"
    fake.write_text(
        f"#!/bin/bash\nprintf '%s\\n' \"$@\" >> '{tmp_path / 'ytdlp_args.log'}'\n"
        "args=()\nfor a in \"$@\"; do case \"$a\" in\n"
        f"  https://www.youtube.com/*) args+=(\"http://127.0.0.1:{port}/{media_name}\") ;;\n"
        "  -U) exit 0 ;;\n  *) args+=(\"$a\") ;;\nesac; done\n"
        f"NO_PROXY=127.0.0.1 exec {ytdlp} \"${{args[@]}}\"\n")
    wrapper = tmp_path / "host.sh"
    host_cmd = (f"'{PWSH}' -NoProfile -NonInteractive -File '{WIN_HOST}'" if windows
                else f"'{HELPER_APP / 'Contents/Resources/ytdl_host.sh'}'")
    wrapper.write_text(f"#!/bin/bash\nexport YTDLP='{fake}' OUT='{out}' VFFMPEG='{_sh.which('ffmpeg')}'\n"
                       f"exec {host_cmd}\n")
    fake.chmod(0o755)
    wrapper.chmod(0o755)
    hosts = tmp_path / "profile" / "NativeMessagingHosts"
    hosts.mkdir(parents=True)
    (hosts / "com.khagu77.ytdl.json").write_text(json.dumps({
        "name": "com.khagu77.ytdl", "description": "test", "path": str(wrapper), "type": "stdio",
        "allowed_origins": [f"chrome-extension://{EXT_ID}/"]}))
    try:
        with sync_playwright() as p:
            ctx = launch(p, tmp_path, EXT_DIR, 1)
            page = ext_page(ctx, "video.html")
            assert page.url.startswith(f"chrome-extension://{EXT_ID}/")  # manifest key 로 ID 고정
            page.select_option("#kind", kind)
            if kind == "fastvideo":
                assert page.input_value("#quality") == "480" and page.is_visible("#quality")  # 기본 480p
                assert "10분 영상 기준" in page.inner_text("#qualityHint")
                if quality:
                    page.select_option("#quality", quality)
            else:
                assert page.is_hidden("#quality")
            # 윈도우 도우미는 ffmpeg 를 함께 설치하므로 음성을 mp3 로 저장한다
            ext = "mp4" if kind == "fastvideo" else ("mp3" if windows else "m4a")
            page.locator("#helper", has_text=f"Mac 도우미가 연결되었습니다. 다운로드 폴더에 날짜_제목.{ext}").wait_for(
                timeout=20000)
            page.fill("#urls", "https://youtu.be/abcdefghijk\nhttps://www.youtube.com/watch?v=zyxwvutsrqp&t=10\n없는주소")
            page.click("#start")
            what = "영상" if kind == "fastvideo" else "음성"
            page.locator("#summary", has_text=f"2 / 3개 {what} 파일을").wait_for(timeout=60000)
            status = page.inner_text("#progress tbody")
            ctx.close()
    finally:
        srv.terminate()
    assert status.count("완료") == 2 and "유튜브 영상 주소가 아닙니다" in status, status
    return status, list(out.iterdir())


def codecs(path: Path):
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0",
                           str(path)], capture_output=True, text=True).stdout.split()


def test_fast_audio_helper(tmp_path: Path):
    _, files = run_fast_helper(tmp_path, "fast", "test_audio.m4a", lambda m: [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-c:a", "aac", str(m)])
    assert [f.name for f in files] == [f"{date.today():%Y%m%d}_test_audio.m4a"], files
    assert codecs(files[0]) == ["aac"]


def test_fast_video_helper(tmp_path: Path):
    _, files = run_fast_helper(tmp_path, "fastvideo", "test_video.mp4", lambda m: [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=4",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(m)], quality="720")
    args = (tmp_path / "ytdlp_args.log").read_text()
    assert "height<=720" in args and "height<=1080" not in args and "--merge-output-format" in args, args
    assert [f.name for f in files] == [f"{date.today():%Y%m%d}_test_video.mp4"], files
    assert sorted(codecs(files[0])) == ["aac", "h264"]


def test_fast_audio_windows_helper(tmp_path: Path):
    _, files = run_fast_helper(tmp_path, "fast", "test_audio.m4a", lambda m: [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-c:a", "aac", str(m)], windows=True)
    assert [f.name for f in files] == [f"{date.today():%Y%m%d}_test_audio.mp3"], files
    assert codecs(files[0]) == ["mp3"]


def test_fast_video_windows_helper(tmp_path: Path):
    _, files = run_fast_helper(tmp_path, "fastvideo", "test_video.mp4", lambda m: [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=4",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(m)], quality="1080", windows=True)
    args = (tmp_path / "ytdlp_args.log").read_text()
    assert "height<=1080" in args and "--merge-output-format" in args and "TITLE %(title)s" in args, args
    assert [f.name for f in files] == [f"{date.today():%Y%m%d}_test_video.mp4"], files
    assert sorted(codecs(files[0])) == ["aac", "h264"]


def test_windows_helper_files():
    """윈도우 도우미 파일: PowerShell 5.1 이 한글을 깨뜨리지 않게 UTF-8 BOM + CRLF, .bat 은 영문만."""
    root = WIN_HOST.parent.parent
    for ps1 in (root / "helper").glob("*.ps1"):
        data = ps1.read_bytes()
        assert data.startswith(b"\xef\xbb\xbf"), ps1
        assert b"\r\n" in data and data.count(b"\n") == data.count(b"\r\n"), ps1
    for bat in list(root.glob("*.bat")) + list((root / "helper").glob("*.bat")):
        data = bat.read_bytes()
        assert data.isascii(), bat  # 한글이 들어가면 윈도우 cmd 가 코드페이지에 따라 깨뜨림
        assert data.count(b"\n") == data.count(b"\r\n"), bat
    host_bat = (root / "helper" / "ytdl_host.bat").read_text()
    assert "ytdl_host.ps1" in host_bat and "-ExecutionPolicy Bypass" in host_bat


def test_fast_audio_helper_missing(tmp_path: Path):
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, 1)
        page = ext_page(ctx, "video.html")
        page.select_option("#kind", "fast")
        page.locator("#helper", has_text="Mac 도우미가 설치되어 있지 않습니다").wait_for(timeout=20000)
        page.fill("#urls", "https://youtu.be/abcdefghijk")
        page.click("#start")
        page.locator("#progress tbody", has_text="빠른다운로드_도우미설치").wait_for(timeout=20000)
        ctx.close()


def test_helper_installer(tmp_path: Path):
    """설치 앱: 도우미·yt-dlp 를 두고 크롬(과 설치된 다른 브라우저)에 등록하는지. (osascript 는 Mac 에만 있어 무시됨)"""
    home = tmp_path / "home"
    (home / "Library/Application Support/Naver/Whale").mkdir(parents=True)
    r = subprocess.run([str(HELPER_APP / "Contents/MacOS/install")], env={**{k: v for k, v in os.environ.items() if "proxy" in k.lower() or k.startswith("SSL") or k.startswith("CURL")},
                            "HOME": str(home), "PATH": "/usr/bin:/bin"},
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr
    sup = home / "Library/Application Support"
    dest = sup / "YTScriptHelper"
    assert os.access(dest / "ytdl_host.sh", os.X_OK)
    # 압축 해제형 yt-dlp (실행할 때 파이썬을 풀지 않음) + Deno
    assert os.access(dest / "bin/yt-dlp/yt-dlp_macos", os.X_OK)
    assert (dest / "bin/yt-dlp/_internal/Python.framework").is_dir()
    assert os.access(dest / "bin/deno", os.X_OK) and (dest / "bin/deno").stat().st_size > 10_000_000
    assert (dest / "bin/.updated").exists() and not (dest / ".download").exists()
    # 영상 합치기용 ffmpeg (Mac 용 실행 파일)
    assert os.access(dest / "bin/ffmpeg", os.X_OK) and (dest / "bin/ffmpeg").read_bytes()[:4] == b"\xcf\xfa\xed\xfe"
    for b in ("Google/Chrome", "Naver/Whale"):
        m = json.loads((sup / b / "NativeMessagingHosts/com.khagu77.ytdl.json").read_text())
        assert m["path"] == str(dest / "ytdl_host.sh") and m["allowed_origins"] == [f"chrome-extension://{EXT_ID}/", "chrome-extension://edngphpmbgehcodhafhapdapdncnkcba/"]
    assert not (sup / "Microsoft Edge").exists()  # 없는 브라우저는 건드리지 않는다


def test_helper_cleanmeta(tmp_path: Path):
    """맥 도우미: 받은 엑셀의 '출처'(kMDItemWhereFroms) 정보만 지운다. 내 폴더 밖·다른 형식 파일은 거부.
    리눅스에는 xattr 명령이 없으므로 같은 이름의 가짜 명령으로 불린 인자를 확인한다."""
    import base64
    import struct

    home = tmp_path / "home"
    target = home / "Downloads" / "팰리세이드 모니터링" / "20261015_채널별 댓글 raw data_취합본 (1).xlsx"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"PK")
    outside = tmp_path / "outside.xlsx"
    outside.write_bytes(b"PK")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "xattr.log"
    (bin_dir / "xattr").write_text(f"#!/bin/bash\nprintf '%s\\n' \"$@\" >> '{log}'\n")
    (bin_dir / "xattr").chmod(0o755)

    def ask(path):
        msg = json.dumps({"action": "cleanmeta", "b64": base64.b64encode(str(path).encode()).decode()}).encode()
        env = {**os.environ, "HOME": str(home), "PATH": f"{bin_dir}:{os.environ['PATH']}"}
        p = subprocess.run([str(HELPER_APP / "Contents/Resources/ytdl_host.sh")], input=struct.pack("<I", len(msg)) + msg,
                           capture_output=True, env=env, timeout=30)
        n = struct.unpack("<I", p.stdout[:4])[0]
        return json.loads(p.stdout[4:4 + n])

    assert ask(target) == {"type": "cleaned", "ok": True}
    assert log.read_text().splitlines() == ["-d", "com.apple.metadata:kMDItemWhereFroms", str(target)]
    log.unlink()
    assert ask(outside) == {"type": "cleaned", "ok": False}  # 내 폴더 밖
    assert ask(home / "Downloads" / "x.sh") == {"type": "cleaned", "ok": False}  # 엑셀·txt 가 아님
    assert not log.exists()
    install = (HELPER_APP / "Contents/MacOS/install").read_text()
    assert "edngphpmbgehcodhafhapdapdncnkcba" in install  # 댓글수집기도 도우미에 등록


def test_clean_after_download(tmp_path: Path):
    """확장(백그라운드): 화면이 받을 파일 이름을 적어 두면, 저장이 끝났을 때 그 파일 경로로 도우미에 '출처 지우기'를
    부탁하고(화면을 옮겨도 계속), 결과를 화면 아래 알림으로 보여준다. 도우미가 예전 버전이면 다시 설치하라고 알린다."""
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, 1)
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        page = ext_page(ctx, "script.html")
        page.evaluate("registerClean('20261016_유튜브스크립트_3개.xlsx')")
        stub = """(version) => {
          globalThis.__forceCleanMeta = true;
          globalThis.__sent = [];
          chrome.runtime.sendNativeMessage = async (host, msg) => {
            __sent.push([host, msg.action, msg.b64 ? new TextDecoder().decode(Uint8Array.from(atob(msg.b64), c => c.charCodeAt(0))) : '']);
            return msg.action === 'ping' ? { type: 'pong', version } : { type: 'cleaned', ok: true };
          };
          chrome.downloads.search = async ({ id }) => [{ id, filename: id === 1
            ? '/Users/a/Downloads/20261016_유튜브스크립트_3개 다른.xlsx'
            : '/Users/a/Downloads/20261016_유튜브스크립트_3개 (2).xlsx' }];
        }"""
        sw.evaluate(stub, 4)
        # 이름이 비슷한 다른 파일은 건드리지 않음 → 기다리던 파일('… (2).xlsx')만 지움
        assert sw.evaluate("onDownloadChangedForClean({ id: 1, state: { current: 'complete' } })") is None
        assert sw.evaluate("onDownloadChangedForClean({ id: 2, state: { current: 'complete' } })") == {"ok": True}
        assert sw.evaluate("__sent") == [["com.khagu77.ytdl", "ping", ""],
                                         ["com.khagu77.ytdl", "cleanmeta", "/Users/a/Downloads/20261016_유튜브스크립트_3개 (2).xlsx"]]
        page.locator("#cleanNotice", has_text="출처' 정보를 지웠습니다").wait_for(timeout=5000)
        # 한 번 처리한 이름은 다시 처리하지 않음
        assert sw.evaluate("onDownloadChangedForClean({ id: 2, state: { current: 'complete' } })") is None
        # 도우미가 예전 버전(3)이면 지우지 않고 다시 설치하라고 알림
        page.evaluate("registerClean('20261016_유튜브스크립트_3개.xlsx')")
        sw.evaluate(stub, 3)
        assert sw.evaluate("onDownloadChangedForClean({ id: 2, state: { current: 'complete' } })") == {"ok": False, "reason": "old"}
        assert [m[1] for m in sw.evaluate("__sent")] == ["ping"]
        page.locator("#cleanNotice", has_text="도우미설치.app").wait_for(timeout=5000)
        ctx.close()
