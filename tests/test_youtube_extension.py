"""'YouTube 스크립트 및 영상 파일 추출' 확장 통합 테스트.

www.youtube.com 을 로컬 HTTPS 서버로 돌려 가짜 영상 화면(소리 나는 짧은 영상)을 보여주고,
- 스크립트 추출: 영상 소리를 받아 구간으로 잘라 음성인식에 넘기고 "00:00 내용" 줄로 저장하는지
  (음성인식 모델은 내려받을 수 없으므로 작업자만 가짜로 바꿔 넣는다)
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


def start_fake_youtube(tmp_path: Path, media: dict):
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=www.youtube.com",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/media/"):
                body = media[self.path.split("/")[-1]].read_bytes()
                ctype = "video/webm"
            else:
                vid = self.path.split("v=")[-1][:11]
                body = WATCH_HTML.format(title=TITLE, name=f"{vid}.webm").encode()
                ctype = "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
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
        page.fill("#urls", "https://youtu.be/scriptvid01")
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        page.locator("#summary", has_text="저장했습니다").wait_for()
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
    assert lines[0].startswith("00:00 구간1 길이2") and lines[0].endswith("소리있음")
    t2 = lines[1].split(" ")[0]
    assert t2 in ("00:21", "00:22", "00:23"), lines  # 무음 구간에서 잘림
    assert lines[1].endswith("소리있음")


def test_video(tmp_path: Path):
    media = tmp_path / "videovid001.webm"
    make_media(media, 6)
    server = start_fake_youtube(tmp_path, {media.name: media})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        page = ext_page(ctx, "video.html")
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
