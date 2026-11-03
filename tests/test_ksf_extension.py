"""'코리아 세일 페스타 차종별 동호회 반응 모니터링' 확장프로그램(ksf-extension) 기본 점검."""
import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "ksf-extension"


@pytest.mark.parametrize("name", ["cafe-common.js", "bg-render.js"])
def test_shared_files_match(name):
    """다른 확장과 함께 쓰는 파일은 같아야 한다 (한쪽만 고치지 않도록)."""
    assert (EXT_DIR / name).read_bytes() == (ROOT / "seat-extension" / name).read_bytes(), name


def test_ui_matches_seat():
    assert (EXT_DIR / "ui.js").read_bytes() == (ROOT / "seat-extension" / "seat-ui.js").read_bytes()


def test_manifest_and_files():
    m = json.loads((EXT_DIR / "manifest.json").read_text())
    assert m["name"] == "코리아 세일 페스타 차종별 동호회 반응 모니터링"
    for other in ["chrome-extension", "seat-extension", "youtube-extension"]:
        other_m = json.loads((ROOT / other / "manifest.json").read_text())
        assert m.get("key") != other_m.get("key")  # 따로 설치·따로 저장
    for f in [*m["icons"].values(), m["background"]["service_worker"], *m["content_scripts"][0]["js"], "ksf.html", "icons/title-bg.jpg"]:
        assert (EXT_DIR / f).exists(), f
    html = (EXT_DIR / "ksf.html").read_text()
    for src in re.findall(r'(?:src|href)="([^"#:]+)"', html):
        assert (EXT_DIR / src).exists(), src
    assert "ksf.html" in (EXT_DIR / "background.js").read_text()


@pytest.mark.parametrize("name", ["ksf.js", "pptfill.js", "xlsx.js", "zip.js"])
def test_syntax(name):
    subprocess.run(["node", "--check", str(EXT_DIR / name)], check=True)


def test_default_cafes():
    """대상 동호회 10곳 (오전 온라인 동향 프로그램과 같은 카페 주소)."""
    src = (EXT_DIR / "ksf.js").read_text()
    for slug in ["01088157554", "blackboxclub", "suddenattackskincafe", "allfm03", "bestcm", "bestani", "mp3vilge", "iroid", "choids", "trailer"]:
        assert f"| {slug}\"" in src, slug
