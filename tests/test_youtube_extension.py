"""'YouTube 스크립트 및 영상 파일 추출' 확장 통합 테스트.

www.youtube.com 을 로컬 HTTPS 서버로 돌려 가짜 영상 화면(소리 나는 짧은 영상)을 보여주고,
- 스크립트 추출: 영상 소리를 받아 구간으로 잘라 음성인식에 넘기고 "00:00 내용" 줄로 저장하는지
  (음성인식 모델은 내려받을 수 없으므로 작업자만 가짜로 바꿔 넣는다)
- 화면 자막 인식: 화면 아래 한글 자막(움직이는 배경 위, 상자 모양, 영문 번역 줄 포함)을 읽어
  한글 줄만 "00:00 자막" 줄로 저장하는지
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


FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
CAPTIONS = [(0.5, 4, "안녕하세요 반갑습니다"), (8, 12, "오늘은 날씨가 좋습니다")]


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
    # 자막이 아닌 글자 (옮기면 안 됨): 아래 왼쪽 댓글 캡처(흰 바탕 검은 글씨), 아래 오른쪽 효과 글자, 화면 위쪽 글자
    draws += (
        f",drawbox=x=10:y=h-80:w=150:h=60:color=white:t=fill:enable='between(t,0,6)'"
        f",drawtext=fontfile={FONT}:text='댓글 인용':fontsize=22:fontcolor=black:x=20:y=h-62:enable='between(t,0,6)'"
        f",drawtext=fontfile={FONT}:text='깜짝':fontsize=34:fontcolor=yellow:borderw=3:bordercolor=black"
        f":x=w-110:y=h-75:enable='between(t,9,11)'"
        f",drawtext=fontfile={FONT}:text='효과 문구':fontsize=40:fontcolor=white:borderw=3:bordercolor=black"
        f":x=(w-text_w)/2:y=40:enable='between(t,0,22)'"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=25:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-vf", draws, "-c:v", "libvpx", "-b:v", "1M", "-c:a", "libopus", "-shortest", str(path)],
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


@pytest.mark.skipif(not Path(FONT).exists(), reason="한글 글꼴 없음")
def test_screen_captions(tmp_path: Path):
    media = tmp_path / "screenvid01.webm"
    make_captioned_media(media, 23)
    server = start_fake_youtube(tmp_path, {media.name: media})
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, server.server_address[1])
        page = ext_page(ctx, "script.html")
        page.select_option("#mode", "screen")
        assert page.is_hidden("#model") and page.is_visible("#region")
        assert page.input_value("#speed") == "3"
        page.select_option("#speed", "3")
        page.fill("#urls", "https://www.youtube.com/watch?v=screenvid01")
        with page.expect_download(timeout=120000) as dl:
            page.click("#start")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(path)
        output = page.input_value("#output")
        ctx.close()
    server.shutdown()

    assert path.name == f"{date.today():%Y%m%d}_{SAFE_TITLE}.txt"
    lines = path.read_bytes().decode("utf-8-sig").strip().split("\r\n")
    assert lines == output.split("\n")
    print("\n".join(lines))
    assert len(lines) == 4, lines  # 같은 자막을 여러 번 적지 않고, 자막 없는 구간은 비운다
    assert lines == [
        f"{lines[0][:5]} 안녕하세요 반갑습니다",
        f"{lines[1][:5]} 오늘은 날씨가 좋습니다",
        f"{lines[2][:5]} 상자 모양 자막도 읽습니다",
        f"{lines[3][:5]} 실내도 승차감도 좋아졌습니다",
    ], lines
    for line, times in zip(lines, [("00:00", "00:01"), ("00:07", "00:08"), ("00:11", "00:12"), ("00:16", "00:17")]):
        assert line[:5] in times, lines
    # 하단 가운데 자막이 아닌 글자(댓글 캡처, 옆 효과 글자, 위쪽 글자)와 영문 번역 줄은 옮기지 않는다
    for decoy in ("댓글", "인용", "깜짝", "효과", "문구", "weather", "ride", "soft"):
        assert decoy not in "\n".join(lines), lines


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


def test_fast_audio_helper(tmp_path: Path):
    """음성 빠른 다운로드: 확장 → (Native Messaging) → 도우미(ytdl_host.sh) → yt-dlp.
    유튜브 대신 로컬 파일을 받도록 yt-dlp 만 바꿔 끼운다."""
    import shutil as _sh
    ytdlp = _sh.which("yt-dlp")
    if not ytdlp:
        pytest.skip("yt-dlp 없음")
    media = tmp_path / "srv" / "test_audio.m4a"
    media.parent.mkdir()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    "-c:a", "aac", str(media)], check=True)
    srv = subprocess.Popen(["python3", "-m", "http.server", "0", "--bind", "127.0.0.1"], cwd=media.parent,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    port = int(srv.stdout.readline().split("port ")[1].split(" ")[0])
    out = tmp_path / "Downloads"
    out.mkdir()
    fake = tmp_path / "fake_ytdlp.sh"
    fake.write_text(
        "#!/bin/bash\nargs=()\nfor a in \"$@\"; do case \"$a\" in\n"
        f"  https://www.youtube.com/*) args+=(\"http://127.0.0.1:{port}/test_audio.m4a\") ;;\n"
        "  -U) exit 0 ;;\n  *) args+=(\"$a\") ;;\nesac; done\n"
        f"NO_PROXY=127.0.0.1 exec {ytdlp} \"${{args[@]}}\"\n")
    wrapper = tmp_path / "host.sh"
    wrapper.write_text(f"#!/bin/bash\nexport YTDLP='{fake}' OUT='{out}'\n"
                       f"exec '{HELPER_APP / 'Contents/Resources/ytdl_host.sh'}'\n")
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
            page.select_option("#kind", "fast")
            page.locator("#helper", has_text="Mac 도우미가 연결되었습니다").wait_for(timeout=20000)
            page.fill("#urls", "https://youtu.be/abcdefghijk\nhttps://www.youtube.com/watch?v=zyxwvutsrqp&t=10\n없는주소")
            page.click("#start")
            page.locator("#summary", has_text="2 / 3개 음성 파일을").wait_for(timeout=60000)
            status = page.inner_text("#progress tbody")
            ctx.close()
    finally:
        srv.terminate()
    assert status.count("완료") == 2 and "유튜브 영상 주소가 아닙니다" in status, status
    files = list(out.iterdir())
    assert [f.name for f in files] == [f"{date.today():%Y%m%d}_test_audio.m4a"], files
    assert "aac" in subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0",
                                    str(files[0])], capture_output=True, text=True).stdout


def test_fast_audio_helper_missing(tmp_path: Path):
    with sync_playwright() as p:
        ctx = launch(p, tmp_path, EXT_DIR, 1)
        page = ext_page(ctx, "video.html")
        page.select_option("#kind", "fast")
        page.locator("#helper", has_text="Mac 도우미가 설치되어 있지 않습니다").wait_for(timeout=20000)
        page.fill("#urls", "https://youtu.be/abcdefghijk")
        page.click("#start")
        page.locator("#progress tbody", has_text="도우미 설치").wait_for(timeout=20000)
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
    for b in ("Google/Chrome", "Naver/Whale"):
        m = json.loads((sup / b / "NativeMessagingHosts/com.khagu77.ytdl.json").read_text())
        assert m["path"] == str(dest / "ytdl_host.sh") and m["allowed_origins"] == [f"chrome-extension://{EXT_ID}/"]
    assert not (sup / "Microsoft Edge").exists()  # 없는 브라우저는 건드리지 않는다
