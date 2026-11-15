# 카페·유튜브 댓글 수집기 — 작업 규칙

## [필수] 네이버 로그인이 풀려 있으면 수집을 시작하지 않는다 (2026-11-15 담당자 요청)
1. 네이버 카페 글이 들어 있는데 로그인이 풀려 있으면(`chrome.cookies.get({url:"https://www.naver.com", name:"NID_AUT"})` 없음) 수집을 시작하지 않는다.
   유튜브·네이버 뉴스·자동차 커뮤니티(뽐뿌 등)만 수집할 때는 막지 않는다.
2. 빨간 전체 화면 경고(깜빡임) + 🚨 + "네이버 로그인이 풀려 있습니다!" + "로그인하기 전에는 수집을 시작하지 않습니다"
   + 버튼 [🔑 네이버 로그인 열기] [로그인했어요 · 다시 확인] [🔇 소리 끄기] [수집 취소].
3. 긴급 사운드: WebAudio 사이렌, 처음 1분은 3초마다, 그 뒤 20초마다, [소리 끄기] 전까지.
4. 3초마다 로그인을 다시 확인해, 로그인되면 초록색 "✅ 네이버 로그인 확인! 수집을 시작합니다"로 바꾸고 닫은 뒤 수집 시작. [수집 취소]면 시작하지 않음.
5. 수집 도중 로그인이 풀리거나(다음 카페 글 전에 확인) 글이 네이버 로그인 화면으로 넘어가면 같은 경고. 로그인되면 그 글부터 이어서,
   [수집 취소]면 멈추고 남은 글은 '이어 하기'로 남긴다.
6. 위쪽 로그인 표시는 `chrome.cookies.onChanged`(NID_AUT)로 바로 바꾼다.
7. 이 확장에는 자동(예약) 수집이 없다. 자동 수집을 넣게 되면 바탕화면 알림(requireInteraction, priority 2)과 최대 3시간 기다리기도 함께 넣는다.
- 코드: `login-alarm.js`(경고·사이렌), `app.js`의 `start()`·`run()`, 스타일 `comment.css` · 테스트 `tests/test_comment_extension.py::test_naver_login_alarm`

## 공통 파일
cafe-common.js·channels.js·template.js·xlsx.js·bg-render.js·db-store.js·db.js·app.css 는 LX3 수집기(chrome-extension)와 같이 쓴다.
이 확장 전용 화면·스타일은 app.html·db.html·app.js·comment.css·login-alarm.js 에 둔다.
