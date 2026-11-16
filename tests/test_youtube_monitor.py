"""''현대차 위기론' 유튜브 콘텐츠 모니터링' 확장프로그램(youtube-monitor-extension) 통합 테스트.

유튜브(채널 안 검색·최신 영상·전체 검색·다음 쪽·영상 화면)·썸네일·Claude API 를 가짜 응답으로 바꿔
수집 → DB → 대시보드(메일 복사) → 엑셀(썸네일·차트)까지 확인한다. CHROMIUM_PATH 가 없으면 건너뛴다.
"""
import io
import json
import os
import re
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "youtube-monitor-extension"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
needs_chromium = pytest.mark.skipif(not CHROMIUM, reason="CHROMIUM_PATH 미설정")
KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)


def test_manifest():
    m = json.loads((EXT_DIR / "manifest.json").read_text())
    assert m["name"] == "'현대차 위기론' 관련 부정적 프레임의 유튜브 콘텐츠 모니터링"
    for other in ["chrome-extension", "seat-extension"]:
        assert m["key"] != json.loads((ROOT / other / "manifest.json").read_text())["key"]
    for f in [*m["icons"].values(), m["background"]["service_worker"], "icons/banner.jpg", "app.html"]:
        assert (EXT_DIR / f).exists(), f
    html = (EXT_DIR / "app.html").read_text()
    for src in re.findall(r'<script src="([^"]+)"', html):
        assert (EXT_DIR / src).exists(), src


def vr(vid, title, ago, views, ch_name="", ch_id="", snippet="", short=False):
    """검색·채널 검색 결과의 videoRenderer"""
    o = {
        "videoId": vid,
        "title": {"runs": [{"text": title}]},
        "publishedTimeText": {"simpleText": ago},
        "viewCountText": {"simpleText": f"조회수 {views:,}회"},
        "navigationEndpoint": {"commandMetadata": {"webCommandMetadata": {"url": f"/shorts/{vid}" if short else f"/watch?v={vid}"}}},
    }
    if ch_name:
        o["longBylineText"] = {"runs": [{"text": ch_name, "navigationEndpoint": {"browseEndpoint": {"browseId": ch_id}}}]}
    if snippet:
        o["detailedMetadataSnippets"] = [{"snippetText": {"runs": [{"text": snippet}]}}]
    return {"videoRenderer": o}


def lockup(vid, title, ago, views_txt):
    return {"richItemRenderer": {"content": {"lockupViewModel": {
        "contentId": vid, "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
        "metadata": {"lockupMetadataViewModel": {"title": {"content": title}, "metadata": {"contentMetadataViewModel": {"metadataRows": [{"metadataParts": [
            {"text": {"content": views_txt}, "accessibilityLabel": f"조회수 {views_txt}회"}, {"text": {"content": ago}, "accessibilityLabel": ago}]}]}}}},
    }}}}


def shorts(vid, title, second):
    return {"shortsLockupViewModel": {"overlayMetadata": {"primaryText": {"content": title}, "secondaryText": {"content": second}},
                                      "onTap": {"innertubeCommand": {"reelWatchEndpoint": {"videoId": vid}}}}}


def page(data, player=None):
    s = '<html><head><script>var ytcfg={"INNERTUBE_API_KEY":"KEY","INNERTUBE_CLIENT_VERSION":"2.20261112.10.00"};</script></head><body>'
    if player:
        s += f"<script>var ytInitialPlayerResponse = {json.dumps(player, ensure_ascii=False)};</script>"
    s += f"<script>var ytInitialData = {json.dumps(data, ensure_ascii=False)};</script></body></html>"
    return s


CH = {
    "managedch": ("UCmanaged000000000000000", "관리채널A"),
    "econch": ("UCecon000000000000000000", "경제채널B"),
    "newch": ("UCother00000000000000000", "크랩 KLAB"),  # 나중에 관리 채널로 추가 ('빠진 것만 채우기')
}
# 영상 ID → (제목, 채널 ID, 채널 이름, 며칠 전, 조회수, 좋아요, 댓글 수, 설명)
VIDEOS = {
    "mgdNeg00001": ("현대차 비상! 내수 판매 추락의 진짜 이유", "UCmanaged000000000000000", "관리채널A", 3, 120000, 3400, 512,
                    "현대차 내수 판매가 급감하고 있습니다.\n가격 인상과 옵션 논란으로 소비자들이 등을 돌렸다는 분석입니다.\n#현대차 #위기\n문의: a@b.com"),
    "econNeg0001": ("뭔가 단단히 착각하고 있다 현대차가 산으로 가는 이유", "UCecon000000000000000000", "경제채널B", 10, 880000, 15000, 2301,
                    "현대차의 전략 오판을 짚어 봅니다. 중국차와 테슬라의 공세 속 현대차의 대응이 늦었다는 지적입니다."),
    "econOld0001": ("현대차 위기 오래된 영상", "UCecon000000000000000000", "경제채널B", 120, 5000, 10, 3, "기간 밖"),
    "econOff0001": ("반도체 이야기", "UCecon000000000000000000", "경제채널B", 2, 7000, 50, 9, "반도체 이야기"),
    "srchNeg0001": ("\"이 돈이면 테슬라 사지\"…역대급 위기라는 현대차 상황", "UCother00000000000000000", "크랩 KLAB", 1, 2753610, 41000, 6200,
                    "아반떼·투싼 등 신차 가격이 오르며 현대차에 대한 소비자 불만이 커지고 있습니다."),
    "newNeg00001": ("현대차 위기 3부, 끝없는 추락", "UCother00000000000000000", "크랩 KLAB", 4, 99000, 800, 77, "현대차가 흔들리고 있습니다."),
    "srchMid0001": ("현대차 신형 투싼 시승기", "UCother11111111111111111", "카리뷰", 5, 30000, 900, 120, "신형 투싼을 타 봤습니다. 승차감이 좋아졌습니다."),
    "shortNeg001": ("현대차 망했다? #shorts", "UCother22222222222222222", "쇼츠채널", 20, 141000, 2000, 88, "현대차 위기 쇼츠"),
    "page2Neg001": ("현대차 주가 폭락 이유", "UCother33333333333333333", "주식채널", 30, 45000, 700, 210, "현대차 주가가 급락했습니다."),
    "page2Old001": ("현대차 위기 예전 이야기", "UCother33333333333333333", "주식채널", 200, 1000, 5, 1, "예전"),
    "page2Old002": ("현대차 위기 더 예전 이야기", "UCother33333333333333333", "주식채널", 300, 1000, 5, 1, "예전"),
}


BLOCKED = {"hits": 0, "done": False}


def ago(days):
    return f"{days}일 전" if days < 7 else f"{days // 7}주 전" if days < 30 else f"{days // 30}개월 전"


def watch_page(vid):
    title, ch_id, ch_name, days, views, likes, comments, desc = VIDEOS[vid]
    pub = (NOW - timedelta(days=days)).replace(hour=19, minute=30, second=0, microsecond=0)
    handle = {v[0]: k for k, v in CH.items()}.get(ch_id, "")
    player = {
        "playabilityStatus": {"status": "OK"},
        "videoDetails": {"videoId": vid, "title": title, "author": ch_name, "channelId": ch_id, "viewCount": str(views), "shortDescription": desc, "lengthSeconds": "600"},
        "microformat": {"playerMicroformatRenderer": {"publishDate": pub.isoformat(), "ownerProfileUrl": f"http://www.youtube.com/@{handle}" if handle else ""}},
    }
    data = {
        "contents": {"twoColumnWatchNextResults": {"results": {"results": {"contents": [
            {"videoPrimaryInfoRenderer": {"videoActions": {"menuRenderer": {"topLevelButtons": [{"segmentedLikeDislikeButtonViewModel": {"likeButtonViewModel": {
                "likeButtonViewModel": {"toggleButtonViewModel": {"toggleButtonViewModel": {"defaultButtonViewModel": {"buttonViewModel": {
                    "title": "1.2천", "accessibilityText": f"다른 사용자 {likes:,}명과 함께 이 동영상에 좋아요 표시"}}}}}}}}]}}}},
        ]}}}},
        "engagementPanels": [{"engagementPanelSectionListRenderer": {"panelIdentifier": "engagement-panel-comments-section",
                                                                    "header": {"engagementPanelTitleHeaderRenderer": {"title": {"runs": [{"text": "댓글"}]}, "contextualInfo": {"runs": [{"text": f"{comments:,}"}]}}}}}],
    }
    return page(data, player)


def channel_meta(handle):
    cid, name = CH[handle]
    return {"metadata": {"channelMetadataRenderer": {"title": name, "externalId": cid, "vanityChannelUrl": f"http://www.youtube.com/@{handle}", "channelUrl": f"https://www.youtube.com/channel/{cid}"}}}


def yt_route(route, calls):
    url = route.request.url
    u = urlparse(url)
    calls.append(unquote(url))
    if u.path.startswith("/youtubei/"):
        return route.fulfill(status=403, body="")  # 확장에서 보내는 유튜브 내부 API 는 실제로 403
    if u.path == "/results":
        q = parse_qs(u.query)["search_query"][0]
        m = re.search(r"after:(\S+) before:(\S+)", q)
        lo, hi = (datetime.fromisoformat(m.group(1)).date(), datetime.fromisoformat(m.group(2)).date()) if m else (None, None)
        items = []
        for v in ["srchNeg0001", "srchMid0001", "econNeg0001", "shortNeg001", "page2Neg001", "page2Old001", "page2Old002", "xxOffTopic1"]:
            title, ch_id, ch_name, days = VIDEOS[v][:4] if v in VIDEOS else ("오늘의 날씨", "UCwx0000000000000000000", "날씨", 1)
            d = (NOW - timedelta(days=days)).date()
            if m and not (lo < d < hi):
                continue
            if not m and days > 7:
                continue
            if v == "shortNeg001":
                items.append({"reelShelfRenderer": {"items": [shorts(v, title, f"조회수 14만회 · {ago(days)}")]}})
            else:
                items.append(vr(v, title, ago(days), VIDEOS.get(v, (0, 0, 0, 0, 10))[4], ch_name, ch_id, VIDEOS[v][7][:30] if v in VIDEOS else ""))
        data = {"contents": {"sectionListRenderer": {"contents": [{"itemSectionRenderer": {"contents": items}}]}}}
        return route.fulfill(status=200, content_type="text/html", body=page(data))
    m = re.match(r"^/@([^/]+)/(search|videos)$", u.path)
    if m:
        handle, kind = m.groups()
        cid, name = CH[handle]
        data = channel_meta(handle)
        if kind == "search":
            items = [vr(v, VIDEOS[v][0], ago(VIDEOS[v][3]), VIDEOS[v][4], snippet=VIDEOS[v][7][:40]) for v in VIDEOS if VIDEOS[v][1] == cid]
        else:
            items = [lockup(v, VIDEOS[v][0], ago(VIDEOS[v][3]), "12만") for v in VIDEOS if VIDEOS[v][1] == cid]
        data["contents"] = {"twoColumnBrowseResultsRenderer": {"tabs": [{"tabRenderer": {"content": {"richGridRenderer": {"contents": items}}}}]}}
        return route.fulfill(status=200, content_type="text/html", body=page(data))
    if u.path == "/watch":
        vid = parse_qs(u.query)["v"][0]
        if vid == "srchNeg0001" and not BLOCKED["done"]:
            # 처음 한 번은 유튜브가 봇 확인 화면으로 넘김 → 확장은 막힘으로 알아채고 기다림
            BLOCKED["hits"] += 1
            return route.fulfill(status=302, headers={"Location": "https://www.google.com/sorry/index?continue=x"}, body="")
        if vid not in VIDEOS:
            return route.fulfill(status=200, content_type="text/html", body=page({}, {"playabilityStatus": {"status": "ERROR", "reason": "동영상을 사용할 수 없습니다"}}))
        return route.fulfill(status=200, content_type="text/html", body=watch_page(vid))
    return route.fulfill(status=404, body="")


def thumb_jpeg():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (320, 180), (200, 30, 30)).save(buf, "JPEG")
    return buf.getvalue()


def ai_route(route, calls):
    req = json.loads(route.request.post_data)
    calls.append(req)
    items = json.loads(req["messages"][0]["content"].split("\n\n", 1)[1])
    out = []
    for it in items:
        neg = any(w in it["제목"] for w in ["비상", "착각", "위기", "망했", "폭락"])
        out.append({"id": it["id"], "summary": f"AI요약: {it['제목'][:20]}", "relevant": "시승기" not in it["제목"], "tone": "부정" if neg else "중립",
                    "frame": "판매·내수 부진" if "내수" in it["제목"] else "기타"})
    body = {"content": [{"type": "text", "text": json.dumps({"items": out}, ensure_ascii=False)}], "stop_reason": "end_turn", "usage": {"input_tokens": 1000, "output_tokens": 200}}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body, ensure_ascii=False))


@needs_chromium
def test_collect_dashboard_excel(tmp_path):
    from openpyxl import load_workbook
    from playwright.sync_api import sync_playwright

    calls, ai_calls = [], []
    jpeg = thumb_jpeg()
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), executable_path=CHROMIUM, headless=True, timezone_id="Asia/Seoul",
            args=[f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}", "--no-proxy-server"],
            accept_downloads=True, permissions=["clipboard-read", "clipboard-write"],
        )
        ctx.route("https://www.youtube.com/**", lambda r: yt_route(r, calls))
        ctx.route("https://i.ytimg.com/**", lambda r: r.fulfill(status=200, content_type="image/jpeg", body=jpeg))
        ctx.route("https://api.anthropic.com/**", lambda r: ai_route(r, ai_calls))
        ctx.route("https://www.google.com/**", lambda r: r.abort())
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        pg = ctx.new_page()
        pg.goto(f"chrome-extension://{ext_id}/app.html#settings")
        start = (NOW - timedelta(days=75)).strftime("%Y-%m-%d")
        pg.evaluate(
            """([start]) => chrome.storage.local.set({ hmAiKey: 'sk-test', hmSettings: { ...DEFAULTS, start, managed: '관리채널A | https://www.youtube.com/@managedch',
               econ: '경제채널B | https://www.youtube.com/@econch', channelQueries: '현대차', queries: '현대차 위기', searchWindow: 30, sound: false } })""",
            [start],
        )
        pg.reload()
        pg.goto(f"chrome-extension://{ext_id}/app.html#collect")
        pg.click("#run")
        # 봇 확인으로 막히면 안내가 뜨고, '지금 다시 시도'로 이어서 읽음
        pg.wait_for_selector("#block:not([hidden])", timeout=120000)
        assert "유튜브가 요청을 잠시 막았습니다" in pg.inner_text("#block")
        # 수집 중: 위쪽 띠 · 탭 제목 · 새로고침/닫기 확인 창 · F5 막기
        assert pg.is_visible("#runBar") and pg.title().startswith("⏳ 수집 중")
        assert pg.evaluate("(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()")
        assert pg.evaluate("(() => { const e = new KeyboardEvent('keydown', { key: 'F5', cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; })()")
        BLOCKED["done"] = True
        pg.click("#blockRetry")
        pg.wait_for_selector("#block", state="hidden", timeout=30000)
        pg.wait_for_function("() => /^(✔|오류)/.test(document.querySelector('#stage').textContent)", timeout=180000)
        log = pg.inner_text("#log")
        assert not pg.is_visible("#runBar") and not pg.title().startswith("⏳")
        assert not pg.evaluate("(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()")
        assert "오류" not in pg.inner_text("#stage"), log

        # 채널 안 검색·최신 영상, 전체 검색 + 다음 쪽(오래된 영상이 나와 3쪽은 안 봄)
        assert any("/@managedch/search?query=현대차" in c for c in calls)
        assert any("/@econch/videos" in c for c in calls)
        assert any(c.startswith("https://www.youtube.com/results?search_query=") and "현대차" in c and "sp=CAI" in c for c in calls), calls
        assert not any("/youtubei/" in c for c in calls), log  # 막히는 내부 API 는 쓰지 않음
        assert BLOCKED["hits"] >= 1 and "막힘이 풀려" in log and "srchNeg0001 읽기 실패" not in log, log
        windows = [c for c in calls if "/results?" in c and "after:" in c]
        assert len(windows) == 3, windows  # 75일을 30일씩 → 3구간 (+ 기간 지정 없는 최신순 1번)
        watched = {parse_qs(urlparse(c).query)["v"][0] for c in calls if "/watch?" in c}
        assert "econOld0001" not in watched and "xxOffTopic1" not in watched and "econOff0001" not in watched  # 기간 밖·주제 밖은 열지 않음
        assert ai_calls and ai_calls[0]["model"] == "claude-sonnet-5-5" and ai_calls[0]["output_config"]["format"]["type"] == "json_schema"

        vids = {v["id"]: v for v in pg.evaluate("DB.all()")}
        assert set(vids) == {"mgdNeg00001", "econNeg0001", "srchNeg0001", "srchMid0001", "shortNeg001", "page2Neg001"}, log
        assert vids["mgdNeg00001"]["group"] == "managed" and vids["econNeg0001"]["group"] == "econ" and vids["srchNeg0001"]["group"] == "other"
        assert vids["econNeg0001"]["comments"] == 2301 and vids["econNeg0001"]["likes"] == 15000 and vids["econNeg0001"]["views"] == 880000
        assert vids["srchNeg0001"]["include"] and not vids["srchMid0001"]["include"]
        assert vids["mgdNeg00001"]["summary"].startswith("AI요약") and vids["mgdNeg00001"]["ai"]["frame"] == "판매·내수 부진"
        assert vids["shortNeg001"]["isShort"]

        # 대시보드: 숫자·꺾은선·메일 복사
        pg.goto(f"chrome-extension://{ext_id}/app.html#dash")
        pg.wait_for_selector("#dashBody svg polyline")
        body = pg.inner_text("#dashBody")
        assert "부정 프레임 콘텐츠" in body and "5건" in body.replace("\n", "") or "5\n건" in body, body
        assert "경제채널B" in body and "관리채널A" in body
        pg.click("#copyMail")
        html = pg.evaluate("navigator.clipboard.read().then(async (items) => { for (const it of items) if (it.types.includes('text/html')) return (await it.getType('text/html')).text(); return ''; })")
        assert "raw.githubusercontent.com" in html and "<svg" in html and "chrome-extension://" not in html
        assert 'class="hit"' not in html  # 마우스 안내용 칸은 메일에 넣지 않음
        assert "복사했습니다" in pg.inner_text("#dashInfo")

        # 엑셀
        with pg.expect_download() as dl:
            pg.click("#xlsxDash")
        path = tmp_path / "out.xlsx"
        dl.value.save_as(path)

        # 관리 채널을 하나 더 넣고 '빠진 것만 채우기' → 새 채널만 훑고, 검색·이미 훑은 채널·이미 읽은 영상은 다시 안 함
        pg.goto(f"chrome-extension://{ext_id}/app.html#collect")
        pg.evaluate("""() => chrome.storage.local.get('hmSettings').then(({ hmSettings }) => chrome.storage.local.set({ hmSettings: {
            ...hmSettings, managed: hmSettings.managed + '\\n크랩 | https://www.youtube.com/@newch' } }))""")
        pg.reload()
        n0 = len(calls)
        pg.click("#fill")
        pg.wait_for_function("() => /^(✔|오류)/.test(document.querySelector('#stage').textContent)", timeout=120000)
        new_calls = calls[n0:]
        log2 = pg.inner_text("#log")
        assert any("/@newch/search" in c for c in new_calls), new_calls
        assert not any("/@managedch/" in c or "/@econch/" in c or "/results?" in c for c in new_calls), new_calls
        watched2 = {parse_qs(urlparse(c).query)["v"][0] for c in new_calls if "/watch?" in c}
        assert watched2 == {"newNeg00001"}, (watched2, log2)
        assert "2곳은 건너뜀" in log2, log2
        vids2 = {v["id"]: v for v in pg.evaluate("DB.all()")}
        assert vids2["newNeg00001"]["group"] == "managed" and vids2["newNeg00001"]["include"]
        assert vids2["srchNeg0001"]["group"] == "managed"  # 전에 '기타'로 들어온 같은 채널 영상도 '관리'로 (다시 읽지 않고)
        ctx.close()

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        assert sum(n.startswith("xl/media/") for n in names) == 5  # 포함 5건의 썸네일
        assert "xl/charts/chart1.xml" in names and "xl/charts/chart2.xml" in names
        drawing = z.read("xl/drawings/drawing1.xml").decode()
        assert drawing.count("<xdr:pic>") == 5 and 'cx="914400"' in drawing  # 96px 폭
    wb = load_workbook(path)
    assert wb.sheetnames == ["모니터링 리스트", "일자별 발행 추이", "주간 추이", "채널별 현황"]
    ws = wb["모니터링 리스트"]
    assert [c.value for c in ws[3]][:11] == ["No.", "발행일", "썸네일", "채널명", "구분", "제목", "URL", "조회수", "좋아요", "댓글 수", "내용 요약"]
    rows = [[c.value for c in r] for r in ws.iter_rows(min_row=4, max_row=8)]
    assert [r[0] for r in rows] == [1, 2, 3, 4, 5]
    assert all(isinstance(r[1], datetime) for r in rows)
    assert rows == sorted(rows, key=lambda r: r[1])  # 발행일 순
    assert {r[6] for r in rows} == {f"https://www.youtube.com/watch?v={v}" for v in ["mgdNeg00001", "econNeg0001", "srchNeg0001", "shortNeg001", "page2Neg001"]}
    econ = next(r for r in rows if r[6].endswith("econNeg0001"))
    assert econ[3] == "경제채널B" and econ[4] == "경제" and econ[7] == 880000 and econ[8] == 15000 and econ[9] == 2301 and econ[11] == "부정"
    assert econ[10].startswith("AI요약")
    assert ws.cell(row=4, column=7).hyperlink.target.startswith("https://www.youtube.com/watch?v=")  # URL 칸은 링크
    assert ws.cell(row=4, column=6).hyperlink is None  # 제목은 링크 없이 글자만
    assert ws.row_dimensions[4].height == 46
    days = wb["일자별 발행 추이"]
    assert isinstance(days["A7"].value, datetime) and days["B7"].value in "월화수목금토일" and days["C6"].value == "발행 수"
    total = sum(r[2].value or 0 for r in days.iter_rows(min_row=7) if isinstance(r[0].value, datetime))
    assert total == 5
    ch = wb["채널별 현황"]
    assert ch["B4"].value and ch["D4"].value >= 1


def test_xlsx_opens_in_libreoffice(tmp_path):
    """엑셀 작성기가 만든 파일(그림·차트 포함)이 표준에 맞는지: LibreOffice 로 열어 다시 저장되는지 확인"""
    import shutil
    import subprocess
    if not shutil.which("soffice") or not shutil.which("node"):
        pytest.skip("soffice/node 없음")
    script = tmp_path / "make.js"
    out = tmp_path / "t.xlsx"
    script.write_text(f"""
const X = require({json.dumps(str(EXT_DIR / 'xlsx-pro.js'))});
const fs = require('fs');
const jpg = fs.readFileSync({json.dumps(str(EXT_DIR / 'icons' / 'banner.jpg'))});
const days = [...Array(20)].map((_, i) => new Date(2026, 8, 1 + i));
X.build({{ sheets: [
  {{ name: '리스트', cols: [6, 16, 15], rows: [[{{ v: '제목', s: 'title' }}], {{ h: 46, cells: [{{ v: 1, s: 'textC' }}, {{ v: new Date(2026, 8, 1, 9, 30), s: 'datetime' }}, {{ v: '', s: 'thumb' }}] }}],
    merges: ['A1:C1'], links: [{{ r: 1, c: 0, url: 'https://www.youtube.com/watch?v=abc' }}], images: [{{ r: 1, c: 2, bytes: jpg, w: 96, h: 54, dx: 7, dy: 4 }}], freeze: {{ row: 1 }}, filter: 'A1:C2' }},
  {{ name: '추이', rows: days.map((d, i) => [{{ v: d, s: 'day' }}, {{ v: i % 5, s: 'num' }}]),
    charts: [{{ from: {{ r: 0, c: 3 }}, to: {{ r: 20, c: 12 }}, title: '일자별', cat: {{ r1: 0, r2: 19, c: 0, values: days.map(X.serial) }},
      series: [{{ name: '발행 수', r1: 0, r2: 19, c: 1, color: '#2a78d6', marker: true, values: days.map((_, i) => i % 5) }}] }}] }},
] }}).then((b) => fs.writeFileSync({json.dumps(str(out))}, b));
""")
    subprocess.run(["node", str(script)], check=True)
    r = subprocess.run(["soffice", "--headless", "--convert-to", "ods", "--outdir", str(tmp_path), str(out)], capture_output=True, text=True, timeout=120)
    assert (tmp_path / "t.ods").exists(), r.stdout + r.stderr
    with zipfile.ZipFile(tmp_path / "t.ods") as z:
        content = z.read("content.xml").decode()
        assert "draw:image" in content or any(n.startswith("Pictures/") for n in z.namelist())
        assert "chart" in content
