# 네이버 카페 댓글 수집기

네이버에 한 번 로그인해 두면, 게시글 URL을 입력하는 것만으로 해당 글들의 **댓글/답글을 모두 수집해 엑셀(.xlsx)로 저장**합니다.

## 설치 (최초 1회)

Python 3.9 이상이 필요합니다.

```bash
pip install -r requirements.txt
python -m playwright install chromium
```

## 사용법

### 가장 쉬운 방법 (대화형)

```bash
python naver_cafe_comments.py
```
Windows에서는 `run.bat`을 더블클릭해도 됩니다.

1. 로그인 세션이 없으면 브라우저 창이 뜹니다 → 직접 네이버에 로그인하세요. (창은 로그인이 확인되면 자동으로 닫힙니다)
2. `URL>` 프롬프트에 게시글 URL을 한 줄씩 붙여넣고, 다 넣었으면 빈 줄에서 Enter.
3. 실행한 폴더에 `네이버카페_댓글_YYYYMMDD_HHMMSS.xlsx` 파일이 생성됩니다.

### 명령어로 실행

```bash
# 로그인만 따로 (세션은 naver_profile 폴더에 저장되어 계속 재사용됨)
python naver_cafe_comments.py login

# URL 직접 지정
python naver_cafe_comments.py collect "https://cafe.naver.com/카페주소/12345" "https://cafe.naver.com/ca-fe/cafes/111/articles/222"

# URL 목록 파일(한 줄에 하나, #으로 시작하면 무시) + 저장 파일명 지정
python naver_cafe_comments.py collect -f urls.txt -o 결과.xlsx

# 수집 과정을 브라우저로 보고 싶을 때
python naver_cafe_comments.py collect -f urls.txt --show-browser
```

### 지원하는 URL 형식
- `https://cafe.naver.com/카페주소/게시글번호`
- `https://cafe.naver.com/카페주소?iframe_url_utf8=...` (게시글 열었을 때 주소창 URL)
- `https://cafe.naver.com/ca-fe/cafes/카페ID/articles/게시글번호`
- `https://cafe.naver.com/f-e/cafes/카페ID/articles/게시글번호`
- `https://m.cafe.naver.com/...` (모바일)
- `https://cafe.naver.com/ArticleRead.nhn?clubid=...&articleid=...`

## 엑셀 결과

| 시트 | 내용 |
|---|---|
| **댓글** | 게시글URL, 카페ID, 게시글번호, 게시글제목, 게시글작성자, 순번, 구분(댓글/답글), 댓글ID, 부모댓글ID, 작성자닉네임, 작성자ID, 댓글내용, 작성일시, 삭제여부, 첨부(이미지/스티커) |
| **요약** | 게시글별 댓글 수, 수집 방식, 성공/실패 사유 |

## 동작 방식
1. 로그인한 브라우저 세션(쿠키)으로 네이버 카페의 댓글 API를 페이지 단위로 호출해 전체 댓글을 가져옵니다.
2. API가 막히거나 응답 형식이 바뀐 경우, 자동으로 게시글 화면을 열어 댓글 영역을 읽고 댓글 페이지를 넘기며 수집합니다. (이 방식은 작성자ID가 비어 있을 수 있습니다)

## 주의사항
- **본인이 열람 권한이 있는 글**(가입한 카페의 멤버 공개 글 등)만 수집됩니다.
- 서버 부담을 줄이기 위해 요청 사이에 0.5초 대기합니다(`REQUEST_DELAY`). 너무 짧게 바꾸면 차단될 수 있습니다.
- 수집한 닉네임·댓글 등은 개인정보가 포함될 수 있으니 네이버 이용약관과 카페 규칙, 개인정보보호법을 지켜 사용하세요.
- `naver_profile/` 폴더에는 로그인 정보가 들어 있으니 다른 사람과 공유하지 마세요. 로그아웃하려면 이 폴더를 지우면 됩니다.

## 테스트
```bash
pip install pytest
python -m pytest tests
```
