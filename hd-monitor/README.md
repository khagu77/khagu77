# 현대차 온라인 이슈 모니터링 시스템

언론 · 네이버 동호회 · 블로그 · 유튜브 · 자동차 커뮤니티(보배드림·클리앙·뽐뿌)에서 현대차·제네시스 관련 게시물을 **5분마다** 모으고,
품질·안전 등 이슈 키워드로 분류해 **대시보드**와 **카테고리별 목록**으로 보여 주며, 주요 키워드가 걸리면 **카카오톡**으로 알려 줍니다.

- 접속 주소: **https://hd-issue-monitor.web.app** (Firebase 프로젝트 `linesquare--monitor` 안의 별도 사이트)
- 화면만 미리 보기: 주소 끝에 `?demo` → 예시 데이터로 모든 화면·모션 확인 (예: `https://hd-issue-monitor.web.app/?demo`)

## 기존 유튜브 모니터링 시스템과 분리

같은 Firebase 프로젝트를 쓰지만 서로 건드리지 않습니다.

| 구분 | 이 시스템 | 기존 시스템 |
|---|---|---|
| 호스팅 사이트 | `hd-issue-monitor` (대상 이름 `hdmon`) | 기존 사이트 그대로 |
| Firestore | 별도 데이터베이스 **`hdmon`** | `(default)` 그대로 |
| Functions | 코드 묶음(codebase) **`hdmon`**, 서울 리전 | 기존 함수 그대로 |
| 로그인 계정 | 프로젝트 공용 (같은 이메일로 두 시스템 모두 로그인 가능) | |

> 사용자 삭제는 기본적으로 **이 시스템에서만** 지웁니다. 로그인 계정까지 지우면 기존 시스템에도 로그인할 수 없으니 주의하세요.

## 자동 배포 (GitHub Actions · 추천)

`hd-monitor` 폴더가 바뀌어 저장소에 올라오면 `.github/workflows/hd-monitor-deploy.yml` 이 자동으로 배포합니다.
처음 실행할 때 호스팅 사이트(`hd-issue-monitor`)와 데이터베이스(`hdmon`)가 없으면 자동으로 만듭니다. 필요한 것은 서비스 계정 키 하나입니다.

1. Google Cloud 콘솔(프로젝트 `linesquare--monitor`) → IAM 및 관리자 → 서비스 계정 → **서비스 계정 만들기** (이름 예: `github-deploy`)
2. 역할 3개: **Firebase 관리자** · **편집자** · **서비스 계정 사용자**
3. 만든 서비스 계정 → 키 → 키 추가 → 새 키 만들기 → **JSON** (파일이 내려받아짐)
4. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: 내려받은 JSON 파일 내용 전체를 붙여넣기
5. Actions 탭 → 'Deploy hd-monitor' → 실패한 실행의 **Re-run jobs** (또는 다음 변경이 올라오면 자동 실행)

> 키 파일은 시크릿에 넣은 뒤 PC에서 지워 두세요. 조직 정책으로 키 만들기가 막혀 있으면 아래 수동 배포를 쓰세요.

## 처음 배포하기 (수동 · PC에서 1회)

준비: Node.js 22, Firebase CLI (`npm i -g firebase-tools`), `firebase login` (linesquare--monitor 접근 가능한 계정)

1. 저장소를 받아 이 폴더로 이동

```bash
cd hd-monitor
```

2. 호스팅 사이트 만들기

```bash
firebase hosting:sites:create hd-issue-monitor
```

3. 전용 데이터베이스 만들기 (서울)

```bash
firebase firestore:databases:create hdmon --location=asia-northeast3
```

4. 서버 패키지 설치

```bash
cd functions && npm install && cd ..
```

5. 배포 (이 시스템 것만)

```bash
firebase deploy --only hosting:hdmon,functions:hdmon,firestore
```

> `firebase.json` 의 firestore 항목에는 `hdmon` 데이터베이스만 적혀 있어 기존 `(default)` 데이터베이스 규칙은 바뀌지 않습니다.

6. Firebase 콘솔 → Authentication → 로그인 방법에서 **이메일/비밀번호**가 켜져 있는지 확인 (기존 시스템에서 이미 켰다면 그대로)
7. Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 `hd-issue-monitor.web.app` 이 없으면 추가
8. https://hd-issue-monitor.web.app 접속 → **가입 신청** → 맨 처음 가입한 사람이 자동으로 **관리자**
9. 설정 → **API 키**에 키를 넣으면 5분 안에 수집이 시작됩니다

## 넣어야 하는 키 (설정 → API 키)

| 키 | 어디서 | 비용 |
|---|---|---|
| (선택) 네이버 검색 API | 새 앱에는 '검색' API 가 더 이상 없음 → **넣지 않아도 됨**. 키가 없으면 네이버 검색 결과 화면을 직접 읽음 | 무료 |
| YouTube Data API 키 | Google Cloud 콘솔(같은 프로젝트) → YouTube Data API v3 사용 → API 키 | 무료 · 하루 10,000단위 (검색 1회 100) |
| Gemini API 키 | aistudio.google.com | 무료 한도 안에서 사용 |
| Claude API 키 | platform.claude.com | Gemini 한도 초과·오류 때만 사용 (유료) |
| 카카오 REST API 키 · 클라이언트 시크릿 | developers.kakao.com → 내 애플리케이션 | 무료 ('나에게 보내기') |

카카오 앱 설정: 카카오 로그인 ON · Redirect URI `https://hd-issue-monitor.web.app/kakao.html` · 동의항목 '카카오톡 메시지 전송' · 플랫폼 Web 사이트 도메인 `https://hd-issue-monitor.web.app`.
알림 받을 사람은 각자 **내 알림 → 카카오톡 연결**을 한 번 누르면 됩니다.

## 동작 방식

### 수집 (5분마다 `collectTick`)
- **네이버 뉴스·블로그·카페글**: 네이버 검색 결과 화면(최신순·최근 1일)을 직접 읽음 — 5분마다 36개 검색씩 돌아가며, 접근 제한이 감지되면 15분~2시간 자동으로 쉼. (예전 앱의 검색 API 키를 넣으면 API 사용) 키워드 그룹 중 '수집 검색어'가 켜진 단어로 검색하고, 하루 사용량을 5분 단위로 나눠 검색어를 돌아가며 씀 (설정 → 수집에 예상 주기 표시)
  - 카페글은 로그인 없이 비가입 카페 글도 제목·요약이 나옴 → 아이디·비밀번호 저장이 필요 없고 차단 걱정이 없음
  - 가입하지 않은 카페 글에는 **🔍 검색** 뱃지 → 네이버 검색 결과에서 열기
- **관심 유튜브 48곳**: 채널 RSS로 10분마다 (무료·무제한). **인싸케이**는 '필수 수집' → 키워드와 관계없이 모든 영상 저장·알림
- **유튜브 전체**: YouTube Data API 검색 (하루 단위를 5분 단위로 나눠 씀)
- **보배드림·클리앙·뽐뿌**: 게시판 목록 1~2쪽, 제목에 현대차 관련어·이슈어가 있는 글만

### 분류
- 키워드 문법: `+` `,` 줄바꿈 = 또는 · `*` = 그리고 (예: `팰리세이드*끼임`) · 띄어쓰기·대소문자 무시
- 키워드 그룹 (기존 시스템 키워드를 나눠 넣음): 현대차 관련 기본어 / 일반 차량 사고·화재 / 품질·안전 / LX3 전동 시트 / 서비스·멤버십·정책 / 신차·유출 / 비교 차종(기아·타사, 기본 꺼짐) / 제외어
- '현대차 단어 필요'가 켜진 그룹은 현대차 관련 기본어가 함께 있을 때만 걸림
- **이슈** = 이슈 그룹 키워드가 걸린 글 → 언론·동호회·블로그·유튜브·커뮤니티 카테고리 / **가비지** = 안 걸린 글 / **전체** = 둘 다
- 언론 기사는 제목 유사도 80% 이상이면 대표 기사 아래 '유사 n건'으로 묶음 (목록의 '유사 기사 묶기')
- **가비지 보관**: 기본 3개월이 지난 가비지 글은 매일 새벽 4시 10분에 자동 삭제 (설정 → 수집·알림·AI에서 1개월~1년·지우지 않음). 중요 표시·메모 단 글은 보관하고, 일별 가비지 건수 통계는 남음
- 기본 성향(긍정·중립·부정·단순비난)은 단어 사전 규칙 → 목록에서 **AI 성향 재분석** (Gemini → 한도 초과 시 Claude)

### 카카오톡 알림
- '카톡 알림'이 켜진 그룹 키워드가 걸린 새 글 (기본: 일반 차량 사고·화재, 품질·안전, LX3 전동 시트 + 필수 수집 채널)
- 24시간 안에 보낸 알림과 제목이 80% 이상 비슷하면 보내지 않음 (대표 1건만)
- 형식: `📰 [언론]` `☕ [동호회] 카페이름` `▶️ [유튜브] 채널이름` `🚗 [보배드림]` `💬 [클리앙]` `🛒 [뽐뿌]` + 제목 + 키워드 + URL, '게시물 보기' 버튼

### 권한
- 관리자: 설정·사용자 관리·지금 수집·다시 분류 / 담당자: 성향 지정·메모·중요·숨김·AI 분석 / 열람자: 보기·검색·엑셀

## 개발

```bash
cd functions && npm test
```

```bash
cd public && python3 -m http.server 8080
```

- 테스트: 키워드 문법·유사도·분류·게시판/RSS/네이버 결과 읽기·알림 문구
- 두 번째 명령 후 http://localhost:8080/?demo 로 화면 확인 (Firebase 없이)
- 분류 코드(`functions/src/keywords.js` 등)는 화면에서도 같이 씀 → 고친 뒤 `cd functions && npm run sync-shared`

| 파일 | 내용 |
|---|---|
| `functions/index.js` | 예약 수집 · 로그인 프로필 · 사용자 관리 · API 키 · 카카오 · AI · 다시 분류 |
| `functions/src/collectors/` | 네이버 · 유튜브 · 커뮤니티 수집기 |
| `functions/src/classify.js` | 키워드 매칭 → 이슈/가비지 · 카테고리 · 성향 |
| `functions/src/store.js` | 저장 · 언론 유사 기사 묶기 · 일별 통계 · 실시간 피드 |
| `functions/src/alerts.js`, `kakao.js` | 카카오톡 알림 |
| `functions/src/ai.js` | Gemini → Claude 성향 분석 |
| `public/js/views/` | 대시보드 · 게시물 · 설정 · 사용자 · 내 알림 · 로그인 화면 |
| `firestore.rules` | 승인된 사용자만 읽기, 권한별 수정 범위, API 키·카카오 토큰은 서버 전용 |
