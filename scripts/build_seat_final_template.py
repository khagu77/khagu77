"""시트 위험 게시물 수집 - 최종 파일 양식(seat-final-template.xlsx) 만들기.

seat-template.xlsx(보고 양식 시트)에 '판단 기준' 시트를 붙인다.
{{키}} 자리는 엑셀을 받을 때 프로그램(seat.js finalCriteria)이 그때의 설정값으로 채운다.

    python scripts/build_seat_final_template.py
"""
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

ROOT = Path(__file__).resolve().parent.parent / "seat-extension"
FONT = "현대산스 Text"
ORANGE = "FFF37021"
ORANGE_LIGHT = "FFFDE7DA"
GRAY = "FFF4F5F7"
RED = "FFE00000"
BLUE = "FF0070C0"
thin = Side(style="thin", color="FFD9DDE3")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def font(**kw):
    return Font(name=FONT, size=kw.pop("size", 10.5), **kw)


def build():
    wb = load_workbook(ROOT / "seat-template.xlsx")
    ws = wb.create_sheet("판단 기준")
    ws.sheet_view.showGridLines = False
    for col, w in {"A": 2, "B": 22, "C": 46, "D": 40, "E": 44, "F": 10}.items():
        ws.column_dimensions[col].width = w
    r = 2

    def title(text, sub):
        nonlocal r
        ws.merge_cells(f"B{r}:F{r}")
        c = ws[f"B{r}"]
        c.value = text
        c.font = font(size=16, bold=True, color="FFFFFFFF")
        c.fill = PatternFill("solid", fgColor=ORANGE)
        c.alignment = Alignment(vertical="center", indent=1)
        ws.row_dimensions[r].height = 34
        r += 1
        ws.merge_cells(f"B{r}:F{r}")
        ws[f"B{r}"].value = sub
        ws[f"B{r}"].font = font(color="FF6B7280")
        ws[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="center", indent=1)
        ws.row_dimensions[r].height = 30
        r += 2

    def section(text):
        nonlocal r
        ws.merge_cells(f"B{r}:F{r}")
        c = ws[f"B{r}"]
        c.value = text
        c.font = font(size=12.5, bold=True, color="FFC4520C")
        c.fill = PatternFill("solid", fgColor=ORANGE_LIGHT)
        c.alignment = Alignment(vertical="center", indent=1)
        c.border = Border(left=Side(style="thick", color=ORANGE))
        ws.row_dimensions[r].height = 24
        r += 1

    def header(*cols):
        nonlocal r
        for i, t in enumerate(cols):
            c = ws.cell(r, 2 + i, t)
            c.font = font(bold=True, color="FF374151")
            c.fill = PatternFill("solid", fgColor=GRAY)
            c.border = BOX
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.row_dimensions[r].height = 22
        r += 1

    def row(*cols, height=None, colors=None, merge_to=None, left_first=False):
        nonlocal r
        for i, t in enumerate(cols):
            c = ws.cell(r, 2 + i, t)
            c.font = font(bold=i == 0 and not left_first, color=(colors or {}).get(i, "FF1B1D21"))
            c.border = BOX
            if i == 0 and left_first:
                c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="left", indent=1)
            else:
                c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center" if (i == 0 or i == 4) else None)
        if merge_to:
            ws.merge_cells(start_row=r, start_column=2 + len(cols) - 1, end_row=r, end_column=merge_to)
            for col in range(2 + len(cols), merge_to + 1):
                ws.cell(r, col).border = BOX
        if height:
            ws.row_dimensions[r].height = height
        r += 1

    def item(label, value, height=None):
        """항목 | 내용(C~E 병합)"""
        row(label, value, height=height, merge_to=6)

    def note(text, height=None):
        nonlocal r
        ws.merge_cells(f"B{r}:F{r}")
        ws[f"B{r}"].value = text
        ws[f"B{r}"].font = font(size=10, color="FF6B7280")
        ws[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="top", indent=1)
        if height:
            ws.row_dimensions[r].height = height
        r += 2

    title("판단 기준 · 수집 기준",
          "LX3 / ME1 / MX5 2·3열 전동 시트 작동 위험 상황 관련 게시물 — 이 파일의 글을 어떤 기준으로 모으고, 고르고, 관련도를 매겼는지 정리한 시트입니다.")

    # 1. 관련도
    section("1. 주제 관련도(%) 판단 기준")
    header("관련도", "판단 기준", "이 구간으로 보는 단서", "예시", "표시")
    rel = [
        ("100%", "2·3열 전동 시트 작동 중 사람·반려동물·물건이 실제로 끼이거나 다친 사고가 명확함 (조사 주제와 완전 일치)",
         "끼였다·눌렸다·다쳤다·멍·피·병원·파손 등 실제 결과가 있고, 그 원인이 2·3열 전동 시트 작동으로 명시됨",
         "\"3열에서 내리는데 2열 원터치 복귀에 아이 발이 끼여 멍이 들었다\"\n\"2열 폴딩에 강아지 다리가 눌려 병원에 다녀왔다\"", "빨강", RED),
        ("85~95%", "실제로 끼일 뻔·다칠 뻔한 아차 사고, 또는 구체적인 위험 상황 묘사",
         "끼일 뻔·다칠 뻔·급히 멈춤·큰일 날 뻔 등 실제로 겪은 장면이 있음\n95%: 사고 직전·반복 경험 / 85%: 한 번의 짧은 아차 경험",
         "\"2열 폴딩 중 아이 손이 들어가 급히 멈췄다\"\n\"3열 복귀 버튼 눌렀는데 아이 발이 있어서 식겁했다\"", "빨강", RED),
        ("70~84%", "전동 시트 작동의 위험성·안전사고 우려·주의 당부, 안전장치(끼임 방지·센서·멈춤) 의문이 글의 주된 내용",
         "위험하다·조심·불안·센서 없음·안 멈춤 등 우려가 글의 중심\n84%: 구체적인 상황을 들어 우려 / 70%: 짧은 우려·당부",
         "\"센서가 없어 보이는데 아이 있는 집은 조심해야 할 것 같다\"\n\"원터치 복귀가 사람 있어도 안 멈추는 것 같아 불안하다\"", "빨강", RED),
        ("40~69%", "다른 이슈 사이에 위험이 일부 언급된 수준, 일반론, 관련 기사·리콜 공지 단순 공유",
         "옵션·품질·출고 등 다른 주제 글 속 한두 문장, 기사 링크 공유\n69%: 위험 문장이 분명함 / 40%: 스치듯 언급",
         "\"옵션 후기… (중략) 3열 탈 때 발 조심하세요\" 한 줄\n\"전동시트 끼임 사고 기사 공유합니다\"", "파랑", BLUE),
        ("10~39%", "전동 시트 작동 이야기지만 안전과 거의 무관 (기능 고장·편의성·소음 등)",
         "느림·소음·작동 안 됨·버튼 위치 등 불편만 있고 사람·물건의 위험 언급이 없음",
         "\"2열 폴딩 속도가 느리고 소리가 난다\"\n\"3열 전동 폴딩이 가끔 안 된다\"", "파랑", BLUE),
        ("0~9%", "주제와 무관",
         "전동 트렁크·도어·선루프·창문 등 다른 장치 이슈, 카시트·가죽·열선·통풍 등 작동과 무관한 시트 이야기",
         "\"전동 트렁크 닫히다 손이 끼였다\"\n\"2열 카시트 추천 부탁드려요\"", "파랑", BLUE),
    ]
    for pct, crit, cue, ex, mark, color in rel:
        row(pct, crit, cue, ex, mark, height=78, colors={0: color, 4: color})
        if pct == "100%":  # 글자 "100%" 는 엑셀이 '텍스트로 저장된 숫자' 오류 삼각형을 띄움 → 숫자 1 + 백분율 서식
            ws.cell(r - 1, 2).value = 1
            ws.cell(r - 1, 2).number_format = "0%"
    note("· 70% 이상은 빨강, 70% 미만은 파랑으로 표시합니다(엑셀 조건부 서식 · 값을 고치면 색도 바뀜).\n"
         "· 같은 구간 안에서는 장면·결과가 구체적일수록, 아이·반려동물 등 피해 대상이 분명할수록, 같은 일이 반복될수록 위쪽 점수를 줍니다.\n"
         "· 관련도는 본문 판독 내용(제목·주요내용 요약·상황 분류·본문 앞부분)을 보고 매깁니다. 판독된 내용에 없는 사실은 근거로 쓰지 않습니다.",
         height=56)

    # 2. 최종 검수
    section("2. 최종 검수 4항목 · 최종 확정 조건")
    header("항목", "검수 내용", "포함으로 보는 경우", "제외로 보는 경우", "")
    checks = [
        ("① 전동 시트 작동 이슈", "전동 시트 작동·조작(전동 폴딩·원터치 워크인·슬라이딩·리클라이닝·복귀)과 관련된 글인지",
         "2·3열 전동 시트의 작동·조작이 글에 나옴", "전동 트렁크(테일게이트)·도어·선루프·창문 등 다른 장치 이슈, 카시트·가죽·열선 등 작동과 무관한 시트 이야기"),
        ("② 작동 중 사고 발생", "작동 중 사람·반려동물·물건의 끼임·눌림·부딪힘·부상·파손이 실제로 있었는지", "실제 사고 경험·목격", "사고 없이 가정·우려만 있음"),
        ("③ 위험성·안전사고 우려", "위험하다·조심하라·끼일 뻔했다·안전장치(센서·멈춤)가 의심된다 등 우려를 말했는지", "우려·주의 당부·안전장치 의문", "불편·고장만 말함"),
        ("④ 타 이슈 중 일부 언급", "여러 다른 이슈를 함께 말한 글이라도 시트 작동 위험·사고·우려가 조금이라도 포함되는지", "한 문장이라도 있으면 해당", "위험·사고·우려 문장이 전혀 없음"),
    ]
    for a, b, c, d in checks:
        row(a, b, c, d, "", height=52, left_first=True)  # 항목 이름은 왼쪽 정렬 (①~④ 번호 줄 맞춤)
    note("· 최종 확정 = ① 에 해당하고, ②·③·④ 중 하나 이상에 해당하는 글.\n"
         "· 최종 확정 여부는 4항목 판정으로 정하며, 관련도는 함께 참고용으로 표시합니다.", height=40)

    # 3. 수집 기준
    section("3. 수집 기준")
    header("항목", "기준", "", "", "")
    ws.merge_cells(start_row=r - 1, start_column=3, end_row=r - 1, end_column=6)
    item("수집 기간", "{{period}}", height=50)
    item("조사 채널", "{{cafes}}", height=180)
    r += 1

    # 4. 포함 여부 · 누락 사유
    section("4. 포함 여부(온라인동향 / 로데이터) · 누락 사유 기준")
    header("항목", "기준", "", "", "")
    ws.merge_cells(start_row=r - 1, start_column=3, end_row=r - 1, end_column=6)
    item("표기", "온라인동향 / 로데이터 순서로 Y(파랑) · N(빨강). 로데이터에 없는 글로는 일일동향을 쓸 수 없어 'Y / N' 조합은 나오지 않음.", height=34)
    item("누락 사유", "온라인 동향에 없는(N) 글만 작성. 글 내용에 근거해 '~로 추정' 으로 끝맺음(실제 사고가 아닌 우려 수준, 아차 상황, 단순 문의, 기사 공유, 로데이터엔 있으나 보고 기준 미달 등).", height=44)
    item("동호회 모니터링 시작일", "{{monitorStart}}", height=44)
    item("로데이터 작성 시작일", "{{rawStart}}", height=44)

    ws.sheet_properties.tabColor = ORANGE
    ws.print_options.horizontalCentered = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    wb.active = 0
    wb.save(ROOT / "seat-final-template.xlsx")
    print("saved", ROOT / "seat-final-template.xlsx", "rows", r)


if __name__ == "__main__":
    build()
