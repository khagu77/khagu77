# 저장소 안내

- `chrome-extension/` — 카페·유튜브 댓글 수집기 (크롬 확장)
- `youtube-extension/` — YouTube 스크립트 및 영상 파일 추출 (크롬 확장)
- `report-extension/` — 온라인 오전동향 PPT 보고서 작성기 (크롬 확장): 일일 부정 이슈 엑셀의 `+` 행 → 네이버 카페 캡처 → Claude 요약 → 현대차 온라인 이슈 보고서 .pptx
  - **보고서 작성 규칙은 `report-extension/작성규칙.md` 에 있다. 보고서 관련 작업 전에 반드시 읽고, 담당자가 규칙을 새로 말하면 이 문서와 코드를 함께 고친다.**
- 테스트: `CHROMIUM_PATH=/path/to/chromium python -m pytest tests` (보고서 작성기 테스트는 python-pptx, Pillow 필요)
- 사용자 안내 문서(README 등)와 화면 문구는 한국어, 쉬운 말로.
