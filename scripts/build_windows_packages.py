"""윈도우용 배포 압축 파일 2개를 만든다.

  dist/댓글수집기_윈도우용.zip
  dist/유튜브추출기_윈도우용.zip

각 압축 파일 안에는 크롬에 올릴 확장프로그램 폴더와 설치안내서 PDF(docs/windows/*.html 을 변환)가 들어간다.
유튜브추출기에는 빠른 다운로드용 윈도우 도우미(windows-helper)도 함께 넣는다.

  python scripts/build_windows_packages.py
  (PDF 변환에 Playwright Chromium 사용. 기본 브라우저가 없으면 CHROMIUM_PATH 로 지정)
"""
import os
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SKIP = {".DS_Store", "__pycache__", "Thumbs.db"}

PACKAGES = [
    {
        "zip": "댓글수집기_윈도우용",
        "guide": ("guide_comments.html", "설치안내서_댓글수집기.pdf"),
        "items": [(ROOT / "chrome-extension", "댓글수집기_확장프로그램")],
    },
    {
        "zip": "유튜브추출기_윈도우용",
        "guide": ("guide_youtube.html", "설치안내서_유튜브추출기.pdf"),
        "items": [
            (ROOT / "youtube-extension", "유튜브추출기_확장프로그램"),
            (ROOT / "windows-helper" / "빠른다운로드_도우미설치.bat", "빠른다운로드_도우미설치.bat"),
            (ROOT / "windows-helper" / "빠른다운로드_도우미제거.bat", "빠른다운로드_도우미제거.bat"),
            (ROOT / "windows-helper" / "helper", "helper"),
        ],
    },
]


def render_pdfs():
    DIST.mkdir(exist_ok=True)
    exe = os.environ.get("CHROMIUM_PATH")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = browser.new_page()
        for pkg in PACKAGES:
            src, out = pkg["guide"]
            page.goto((ROOT / "docs" / "windows" / src).as_uri())
            page.pdf(path=str(DIST / out), format="A4", print_background=True, prefer_css_page_size=True)
        browser.close()


def add(zf: zipfile.ZipFile, src: Path, arc: str):
    if src.is_dir():
        for f in sorted(src.rglob("*")):
            if f.is_file() and not (SKIP & set(f.relative_to(src).parts)):
                zf.write(f, f"{arc}/{f.relative_to(src).as_posix()}")
    else:
        zf.write(src, arc)


def build():
    render_pdfs()
    for pkg in PACKAGES:
        top = pkg["zip"]
        path = DIST / f"{top}.zip"
        path.unlink(missing_ok=True)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for src, name in pkg["items"]:
                add(zf, src, f"{top}/{name}")
            add(zf, DIST / pkg["guide"][1], f"{top}/{pkg['guide'][1]}")
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    build()
