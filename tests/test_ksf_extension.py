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
    for f in [*m["icons"].values(), m["background"]["service_worker"], *m["content_scripts"][0]["js"], "ksf.html", "ksf-db.html",
              "icons/title-bg.jpg", "icons/dash-banner.jpg", "templates/posts-template.xlsx", "templates/comments-template.xlsx"]:
        assert (EXT_DIR / f).exists(), f
    for page in ["ksf.html", "ksf-db.html"]:
        html = (EXT_DIR / page).read_text()
        for src in re.findall(r'(?:src|href)="([^"#:]+)"', html):
            assert (EXT_DIR / src).exists(), (page, src)
    assert "ksf.html" in (EXT_DIR / "background.js").read_text()


@pytest.mark.parametrize("name", ["ksf.js", "ksf-tabs.js", "ksf-db.js", "dashboard.js", "pptfill.js", "xlsx.js", "xlsx-out.js", "zip.js", "db-store.js"])
def test_syntax(name):
    subprocess.run(["node", "--check", str(EXT_DIR / name)], check=True)


def test_default_cafes():
    """대상 동호회 10곳 (오전 온라인 동향 프로그램과 같은 카페 주소)."""
    src = (EXT_DIR / "ksf.js").read_text()
    for slug in ["01088157554", "blackboxclub", "avantemd", "suddenattackskincafe", "allfm03", "bestcm", "bestani", "mp3vilge", "iroid", "choids", "trailer"]:
        assert f"| {slug}\"" in src, slug


def test_excel_templates_match_issue_report():
    """게시물·댓글 엑셀 4종은 이슈 모니터링 보고서 작성 프로그램과 같은 양식 (머리글)."""
    from openpyxl import load_workbook
    posts = load_workbook(EXT_DIR / "templates" / "posts-template.xlsx").active
    assert [c.value for c in posts[1]][:5] == ["No", "출처", "제목", "작성시간", "Link"]
    comments = load_workbook(EXT_DIR / "templates" / "comments-template.xlsx").active
    assert [c.value for c in comments[2]][:3] == ["domain", "text", "성향"]


def test_dashboard_banner_is_pinned():
    """메일에 붙여 넣는 대시보드의 차량 그림은 커밋 번호로 고정한 주소 (보낸 메일의 그림이 바뀌지 않게)."""
    src = (EXT_DIR / "dashboard.js").read_text()
    m = re.search(r'DASH_BANNER_URL = "https://raw\.githubusercontent\.com/khagu77/khagu77/([0-9a-f]{40})/ksf-extension/icons/dash-banner\.jpg"', src)
    assert m, "고정 주소가 없습니다"


def test_keyword_combos():
    """조합 키워드: 줄 = 검색어 · 띄어쓰기 = 그리고 · A|B = 또는 · -단어 = 빼기 (이슈 보고서 프로그램과 같은 규칙)."""
    src = (EXT_DIR / "ksf.js").read_text()
    start = src.index("function keywordPlan(")
    end = src.index("\nfunction queries()", start)
    js = src[start:end].replace('text = $("#keywords").value', "text")
    js += """
const r = keywordPlan("코세페|코리아세일페스타 보상\\n할인\\n-보험\\n# 메모");
console.log(JSON.stringify(r));
"""
    out = subprocess.run(["node", "-e", js], check=True, capture_output=True, text=True).stdout
    r = json.loads(out)
    assert r["queries"] == ["코세페 보상", "코리아세일페스타 보상", "할인"]
    assert r["minus"] == ["보험"]
