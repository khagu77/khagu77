# 'YouTube 스크립트 및 영상 파일 추출' 확장프로그램의 윈도우 도우미 (크롬 Native Messaging 호스트)
# Mac 도우미(ytdl_host.sh)와 같은 일을 한다: 확장이 보낸 유튜브 URL 의 영상(.mp4)·음성(.mp3/.m4a)을
# yt-dlp 로 재생 없이 바로 받아 다운로드 폴더에 '날짜_제목.확장자' 로 저장한다.
# 주고받는 메시지: 4바이트 길이(little-endian) + JSON (UTF-8)
#   받음: {"type":"ping"} / {"type":"download","kind":"audio"|"video","height":480,"urls":["https://..."]}
#   보냄: pong / updating / start / title / progress / merging / saved / error / finished
# 설치: '빠른다운로드_도우미설치.bat' → install.ps1 이 이 파일을 %LOCALAPPDATA%\YTScriptHelper 에 두고
#       `ytdl_host.ps1 --install` 로 yt-dlp, Deno, ffmpeg 를 받는다.
# 주의: 표준출력은 메시지 전용이므로 함수 결과가 화면(표준출력)으로 새지 않게 모두 $null 로 버린다.
#       윈도우 PowerShell 5.1 에서도 돌도록 최신 문법은 쓰지 않는다.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$DIR = $PSScriptRoot
$BIN = Join-Path $DIR 'bin'
$CUSTOM_YTDLP = [bool]$env:YTDLP   # 테스트에서 yt-dlp 를 바꿔 끼운 경우 자동 업데이트 안 함
$YTDLP = if ($env:YTDLP) { $env:YTDLP } else { Join-Path $BIN 'yt-dlp.exe' }
$DENO = Join-Path $BIN 'deno.exe'
$FFMPEG = if ($env:VFFMPEG) { $env:VFFMPEG } else { Join-Path $BIN 'ffmpeg.exe' }
$VERSION = 3 # Mac 도우미와 같은 기능 수준 (3: 영상 화질 선택)
$UPDATE_DAYS = 3

function Get-DownloadsFolder {
  if ($env:OUT) { return $env:OUT }
  try {
    $key = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop
    $p = $key.'{374DE290-123F-4565-9164-39C4925E467B}'
    if ($p) { return [Environment]::ExpandEnvironmentVariables($p) }
  } catch {}
  return (Join-Path $env:USERPROFILE 'Downloads')
}

# ---- yt-dlp·Deno·ffmpeg 설치/업데이트 ----
function Get-File($url, $path) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $null = Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
}

function Install-Tools {
  $tmp = Join-Path $DIR '.download'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  $null = New-Item -ItemType Directory -Force -Path $tmp, $BIN
  try {
    Get-File 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' (Join-Path $tmp 'yt-dlp.exe')
    Get-File 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' (Join-Path $tmp 'deno.zip')
    Expand-Archive -Path (Join-Path $tmp 'deno.zip') -DestinationPath (Join-Path $tmp 'deno') -Force
    Move-Item -Force (Join-Path $tmp 'yt-dlp.exe') (Join-Path $BIN 'yt-dlp.exe')
    Move-Item -Force (Join-Path $tmp 'deno\deno.exe') $DENO
  } catch {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return $false
  }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Install-Ffmpeg)) { return $false }
  $null = New-Item -ItemType File -Force -Path (Join-Path $BIN '.updated')
  return $true
}

# ffmpeg 는 처음 한 번만 받는다 (영상·소리 합치기, mp3 변환에만 쓰므로 자주 바꿀 필요 없음)
function Install-Ffmpeg {
  $dest = Join-Path $BIN 'ffmpeg.exe'
  if (Test-Path $dest) { return $true }
  $gz = Join-Path $BIN 'ffmpeg.gz'
  try {
    Get-File 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz' $gz
    $in = [IO.File]::OpenRead($gz)
    $out = [IO.File]::Create("$dest.download")
    $unzip = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $unzip.CopyTo($out)
    $unzip.Close(); $out.Close(); $in.Close()
    Move-Item -Force "$dest.download" $dest
    Remove-Item $gz -Force
    return $true
  } catch {
    Remove-Item $gz, "$dest.download" -Force -ErrorAction SilentlyContinue
    return $false
  }
}

if ($args -contains '--install') {
  if (Install-Tools) { exit 0 } else { exit 1 }
}

# ---- 메시지 주고받기 ----
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()
$utf8 = New-Object Text.UTF8Encoding($false)

function Read-Exact([int]$n) {
  $buf = New-Object byte[] $n
  $got = 0
  while ($got -lt $n) {
    $r = $stdin.Read($buf, $got, $n - $got)
    if ($r -le 0) { return $null }
    $got += $r
  }
  return ,$buf
}

function Read-Message {
  $head = Read-Exact 4
  if ($null -eq $head) { return $null }
  $len = [BitConverter]::ToInt32($head, 0)
  if ($len -le 0) { return '' }
  $body = Read-Exact $len
  if ($null -eq $body) { return $null }
  return $utf8.GetString($body)
}

function Send($obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 5
  $bytes = $utf8.GetBytes($json)
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# 윈도우 명령줄 규칙에 맞게 인자 하나를 따옴표로 감싼다
function Quote-Arg([string]$a) {
  if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('"')
  $slashes = 0
  foreach ($ch in $a.ToCharArray()) {
    if ($ch -eq '\') { $slashes++; continue }
    if ($ch -eq '"') { [void]$sb.Append('\' * ($slashes * 2 + 1)) }
    elseif ($slashes) { [void]$sb.Append('\' * $slashes) }
    $slashes = 0
    [void]$sb.Append($ch)
  }
  [void]$sb.Append('\' * ($slashes * 2))
  [void]$sb.Append('"')
  return $sb.ToString()
}

function Get-JsArgs {
  if (Test-Path $DENO) { return @('--js-runtimes', "deno:$DENO") }
  return @()
}

# 음성: ffmpeg 가 있으면 mp3, 없으면 m4a (변환 없이 바로)
function Get-AudioFormat {
  if (Test-Path $FFMPEG) {
    return @{ ext = 'mp3'; args = @('-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--ffmpeg-location', $FFMPEG) }
  }
  return @{ ext = 'm4a'; args = @('-f', 'bestaudio[ext=m4a]/bestaudio') }
}

# 영상: 고른 화질(세로 픽셀) 이하의 H.264 영상 + AAC 소리를 받아 .mp4 하나로 합친다
function Get-VideoArgs([int]$h) {
  return @('-f', "bv*[vcodec^=avc1][height<=$h]+ba[ext=m4a]/b[ext=mp4][height<=$h]/bv*[height<=$h]+ba/b[height<=$h]/b",
    '--merge-output-format', 'mp4', '--ffmpeg-location', $FFMPEG)
}

function Handle-Line([int]$i, [string]$line) {
  if ($line.StartsWith('PROG')) {
    $pct = ($line -replace '[^0-9.]', '')
    $num = 0.0
    if ([double]::TryParse($pct, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$num)) {
      Send ([ordered]@{ type = 'progress'; index = $i; percent = $num })
    }
  } elseif ($line.StartsWith('TITLE ')) {
    Send ([ordered]@{ type = 'title'; index = $i; title = $line.Substring(6) })
  } elseif ($line.StartsWith('FILE ')) {
    Send ([ordered]@{ type = 'saved'; index = $i; file = $line.Substring(5) })
  } elseif ($line.StartsWith('[Merger]')) {
    Send ([ordered]@{ type = 'merging'; index = $i })
  } elseif ($line.StartsWith('ERROR:')) {
    Send ([ordered]@{ type = 'error'; index = $i; message = $line.Substring(6).Trim() })
  }
}

function Download([int]$i, [string]$url, [string]$kind, [int]$height) {
  $today = Get-Date -Format 'yyyyMMdd'
  $out = Get-DownloadsFolder
  if ($kind -eq 'video') { $fmt = Get-VideoArgs $height } else { $fmt = (Get-AudioFormat).args }
  $all = @($fmt) + @(Get-JsArgs) + @(
    '--no-playlist', '--no-mtime', '--trim-filenames', '150', '--newline', '--no-simulate', '--progress',
    '--encoding', 'utf-8',
    '--progress-template', 'download:PROG %(progress._percent_str)s',
    '--print', 'before_dl:TITLE %(title)s',
    '--print', 'after_move:FILE %(filepath)s',
    '-o', (Join-Path $out "${today}_%(title)s.%(ext)s"),
    '--', $url)
  Send ([ordered]@{ type = 'start'; index = $i })

  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $YTDLP
  $psi.Arguments = (($all | ForEach-Object { Quote-Arg $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.StandardOutputEncoding = $utf8
  $psi.StandardErrorEncoding = $utf8
  $psi.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
  $psi.EnvironmentVariables['PYTHONUTF8'] = '1'
  try {
    $p = [Diagnostics.Process]::Start($psi)
  } catch {
    Send ([ordered]@{ type = 'error'; index = $i; message = "yt-dlp 를 실행하지 못했습니다: $($_.Exception.Message)" })
    return
  }
  $p.StandardInput.Close()
  # 표준출력·표준오류를 함께 실시간으로 읽는다 (yt-dlp 는 진행률/오류를 둘 다에 쓸 수 있음)
  $streams = @($p.StandardOutput, $p.StandardError)
  $tasks = @($streams[0].ReadLineAsync(), $streams[1].ReadLineAsync())
  while ($tasks[0] -or $tasks[1]) {
    $live = [Threading.Tasks.Task[]]@($tasks | Where-Object { $_ })
    $k = [Threading.Tasks.Task]::WaitAny($live)
    $done = $live[$k]
    $s = [Array]::IndexOf($tasks, $done)
    $line = $done.Result
    if ($null -eq $line) { $tasks[$s] = $null; continue }
    Handle-Line $i $line
    $tasks[$s] = $streams[$s].ReadLineAsync()
  }
  $p.WaitForExit()
}

while ($true) {
  $msg = Read-Message
  if ($null -eq $msg) { break }
  try { $m = ConvertFrom-Json $msg } catch { continue }
  if ($m.type -eq 'ping') {
    Send ([ordered]@{ type = 'pong'; ok = (Test-Path $YTDLP); ext = (Get-AudioFormat).ext; video = (Test-Path $FFMPEG); version = $VERSION })
  } elseif ($m.type -eq 'download') {
    # 유튜브가 바뀌어도 받을 수 있게 며칠마다 yt-dlp·Deno 를 최신으로 (실패하면 있던 것으로 계속)
    $stamp = Join-Path $BIN '.updated'
    if (-not $CUSTOM_YTDLP -and (-not (Test-Path $stamp) -or (Get-Item $stamp).LastWriteTime -lt (Get-Date).AddDays(-$UPDATE_DAYS))) {
      Send ([ordered]@{ type = 'updating' })
      $null = Install-Tools
    }
    $kind = if ($m.kind -eq 'video') { 'video' } else { 'audio' }
    $height = 480
    if ($m.height) { $height = [int]$m.height }
    if ($kind -eq 'video' -and -not $CUSTOM_YTDLP) { $null = Install-Ffmpeg }
    $i = 0
    foreach ($url in @($m.urls)) {
      if ($url -match '^https?://') { Download $i $url $kind $height }
      $i++
    }
    Send ([ordered]@{ type = 'finished' })
  }
}
