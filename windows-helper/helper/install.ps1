# '빠른다운로드_도우미설치.bat' 이 실행하는 설치 스크립트 (윈도우).
# 'YouTube 스크립트 및 영상 파일 추출' 확장프로그램이 영상·음성을 재생 없이 바로 받을 수 있게
# 도우미(ytdl_host.ps1)와 yt-dlp·Deno·ffmpeg 를 %LOCALAPPDATA%\YTScriptHelper 에 설치하고,
# 크롬·엣지·웨일·브레이브에 도우미를 등록한다(현재 사용자 레지스트리, 관리자 권한 필요 없음).
# 다시 실행하면 yt-dlp·Deno 를 최신으로 바꾼다.  -Uninstall 로 실행하면 도우미를 지운다.
param([switch]$Uninstall)

$HOST_NAME = 'com.khagu77.ytdl'
$EXT_ID = 'pjmcafienhpdbpljglddhaknajaekhcm' # 확장프로그램 manifest.json 의 key 로 고정된 ID
$SRC = $PSScriptRoot
$DEST = Join-Path $env:LOCALAPPDATA 'YTScriptHelper'
$TITLE = '유튜브 빠른다운로드 도우미'
$BROWSERS = @(
  'Software\Google\Chrome', 'Software\Google\Chrome Beta', 'Software\Microsoft\Edge',
  'Software\Naver\Whale', 'Software\BraveSoftware\Brave-Browser', 'Software\Chromium'
)

function Show-Message([string]$text, [string]$icon) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $null = [System.Windows.Forms.MessageBox]::Show($text, $TITLE, 'OK', $icon)
  } catch {
    Write-Host $text
  }
}

function Fail([string]$why) {
  Show-Message "설치하지 못했습니다.`n`n$why" 'Error'
  exit 1
}

if ($Uninstall) {
  foreach ($b in $BROWSERS) {
    Remove-Item -Path "HKCU:\$b\NativeMessagingHosts\$HOST_NAME" -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Path $DEST -Recurse -Force -ErrorAction SilentlyContinue
  Show-Message '도우미를 지웠습니다.' 'Information'
  exit 0
}

Write-Host ''
Write-Host '  유튜브 빠른다운로드 도우미를 설치합니다.'
Write-Host '  yt-dlp, Deno, ffmpeg 를 내려받는 중입니다 (약 200MB, 몇 분 걸릴 수 있습니다)...'
Write-Host '  이 창을 닫지 말고 기다려 주세요.'
Write-Host ''

try {
  $null = New-Item -ItemType Directory -Force -Path $DEST
  Copy-Item -Force (Join-Path $SRC 'ytdl_host.ps1') (Join-Path $DEST 'ytdl_host.ps1')
  Copy-Item -Force (Join-Path $SRC 'ytdl_host.bat') (Join-Path $DEST 'ytdl_host.bat')
} catch {
  Fail "도우미 파일을 복사할 수 없습니다: $DEST"
}

& (Join-Path $DEST 'ytdl_host.ps1') --install
if ($LASTEXITCODE -ne 0) { Fail 'yt-dlp 를 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 실행해 주세요.' }

$manifestPath = Join-Path $DEST "$HOST_NAME.json"
$manifest = [ordered]@{
  name = $HOST_NAME
  description = 'YouTube 스크립트 및 영상 파일 추출 - 빠른 다운로드 도우미'
  path = (Join-Path $DEST 'ytdl_host.bat')
  type = 'stdio'
  allowed_origins = @("chrome-extension://$EXT_ID/")
}
# 크롬은 BOM 이 붙은 JSON 을 읽지 못하므로 BOM 없는 UTF-8 로 저장
[IO.File]::WriteAllText($manifestPath, (ConvertTo-Json -InputObject $manifest), (New-Object Text.UTF8Encoding($false)))

$registered = 0
foreach ($b in $BROWSERS) {
  try {
    $key = "HKCU:\$b\NativeMessagingHosts\$HOST_NAME"
    $null = New-Item -Path $key -Force
    Set-Item -Path $key -Value $manifestPath
    $registered++
  } catch {}
}
if ($registered -eq 0) { Fail '브라우저에 도우미를 등록하지 못했습니다.' }

Show-Message ("설치를 마쳤습니다.`n`n크롬에서 확장프로그램의 '영상·음성 파일 다운로드' 화면을 새로고침한 뒤 " +
  "저장 형식에서 '영상 빠른 다운로드' 또는 '음성 빠른 다운로드'를 고르세요.") 'Information'
exit 0
