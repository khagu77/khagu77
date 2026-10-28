"""싼타페 페이스리프트(MX5 F/L) 가격 언급 게시물 수집 - 배포용 압축 파일을 만든다.

  dist/MX5FL_가격여론수집기.zip
    MX5FL_가격여론수집기/MX5FL_가격여론수집기_확장프로그램/   (크롬에 올릴 폴더 = price-extension)
    MX5FL_가격여론수집기/설치안내서_MX5FL_가격여론수집기.pdf   (docs/price/guide_price.html 을 변환)

  python scripts/build_price_package.py
  (PDF 변환에 Playwright Chromium 사용. 기본 브라우저가 없으면 CHROMIUM_PATH 로 지정)
"""
import os
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
TOP = "MX5FL_가격여론수집기"
GUIDE = "설치안내서_MX5FL_가격여론수집기.pdf"
SKIP = {".DS_Store", "__pycache__", "Thumbs.db"}


def build():
    DIST.mkdir(exist_ok=True)
    exe = os.environ.get("CHROMIUM_PATH")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = browser.new_page()
        page.goto((ROOT / "docs" / "price" / "guide_price.html").as_uri())
        page.pdf(path=str(DIST / GUIDE), format="A4", print_background=True, prefer_css_page_size=True)
        browser.close()
    path = DIST / f"{TOP}.zip"
    path.unlink(missing_ok=True)
    src = ROOT / "price-extension"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file() and not (SKIP & set(f.relative_to(src).parts)):
                zf.write(f, f"{TOP}/{TOP}_확장프로그램/{f.relative_to(src).as_posix()}")
        zf.write(DIST / GUIDE, f"{TOP}/{GUIDE}")
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    build()
