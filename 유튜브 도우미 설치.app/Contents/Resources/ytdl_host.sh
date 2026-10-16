#!/bin/bash
# 'YouTube 스크립트 및 영상 파일 추출' 확장프로그램의 Mac 도우미 (크롬 Native Messaging 호스트)
# 확장프로그램이 보낸 유튜브 URL의 음성(.m4a) 또는 영상(.mp4)을 yt-dlp 로 바로 받아(재생·녹화 없이)
# 다운로드 폴더에 저장한다.
# 주고받는 메시지: 4바이트 길이(little-endian) + JSON
#   받음: {"type":"ping"} / {"type":"download","kind":"audio"|"video","height":480,"urls":["https://..."]}
#   보냄: pong / updating / start / title / progress / merging / saved / error / finished
# 설치: '유튜브 도우미 설치.app' 이 이 파일을 ~/Library/Application Support/YTScriptHelper 에 두고
#       `ytdl_host.sh --install` 로 yt-dlp(압축 해제형), Deno(유튜브 받을 때 yt-dlp 가 쓰는 JavaScript 실행기),
#       ffmpeg(영상·소리를 한 .mp4 로 합칠 때 씀)를 받는다.

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/bin"
CUSTOM_YTDLP="${YTDLP:+1}" # 테스트에서 yt-dlp 를 바꿔 끼운 경우 자동 업데이트 안 함
YTDLP="${YTDLP:-$BIN/yt-dlp/yt-dlp_macos}"
DENO="$BIN/deno"
VFFMPEG="${VFFMPEG:-$BIN/ffmpeg}" # 영상 합치기용 (테스트에서 바꿔 끼울 수 있음)
OUT="${OUT:-$HOME/Downloads}"
VERSION=4 # 2: 영상 빠른 다운로드, 3: 영상 화질 선택, 4: 받은 파일의 출처 정보 지우기
UPDATE_DAYS=3

# ---- yt-dlp·Deno 설치/업데이트 ----
# yt-dlp 는 한 파일짜리(yt-dlp_macos)가 아니라 압축 해제형(yt-dlp_macos.zip)을 쓴다. 한 파일짜리는 실행할 때마다
# 파이썬을 임시 폴더에 푸는데, 크롬이 실행한 도우미가 만든 파일엔 '인터넷에서 받음' 표시가 붙어 Mac 이 막는다.
unzip_to() {
  mkdir -p "$2" || return 1
  if command -v ditto > /dev/null; then ditto -x -k "$1" "$2"; else unzip -q -o "$1" -d "$2"; fi
}

install_tools() {
  local tmp="$DIR/.download" arch
  rm -rf "$tmp"
  mkdir -p "$tmp" "$BIN" || return 1
  curl -L --fail -s -o "$tmp/yt-dlp.zip" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip" &&
    unzip_to "$tmp/yt-dlp.zip" "$tmp/yt-dlp" || { rm -rf "$tmp"; return 1; }
  case "$(uname -m)" in arm64 | aarch64) arch=aarch64 ;; *) arch=x86_64 ;; esac
  curl -L --fail -s -o "$tmp/deno.zip" "https://github.com/denoland/deno/releases/latest/download/deno-$arch-apple-darwin.zip" &&
    unzip_to "$tmp/deno.zip" "$tmp/deno" || { rm -rf "$tmp"; return 1; }
  rm -f "$tmp/yt-dlp.zip" "$tmp/deno.zip"
  # 크롬이 실행한 도우미가 받은 파일에 붙는 '인터넷에서 받음' 표시를 지운다 (그대로 두면 Mac 이 실행을 막음)
  xattr -cr "$tmp" 2> /dev/null
  chmod +x "$tmp/yt-dlp/yt-dlp_macos" "$tmp/deno/deno" || { rm -rf "$tmp"; return 1; }
  rm -rf "$BIN/yt-dlp" && mv "$tmp/yt-dlp" "$BIN/yt-dlp" && mv -f "$tmp/deno/deno" "$DENO" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp" "$DIR/yt-dlp_macos" # 예전 버전이 쓰던 한 파일짜리 yt-dlp 정리
  install_ffmpeg
  touch "$BIN/.updated"
}

# ffmpeg 는 처음 한 번만 받는다 (영상·소리 합치기에만 쓰므로 자주 바꿀 필요 없음)
install_ffmpeg() {
  [ -x "$BIN/ffmpeg" ] && return 0
  local arch
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=x64 ;; esac
  curl -L --fail -s "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-$arch.gz" |
    gunzip > "$BIN/ffmpeg.download" || { rm -f "$BIN/ffmpeg.download"; return 1; }
  xattr -c "$BIN/ffmpeg.download" 2> /dev/null
  chmod +x "$BIN/ffmpeg.download"
  # Apple 실리콘 Mac 은 서명 없는 프로그램을 실행하지 않으므로 이 PC 용 임시 서명을 붙인다
  command -v codesign > /dev/null && codesign --force --sign - "$BIN/ffmpeg.download" > /dev/null 2>&1
  mv -f "$BIN/ffmpeg.download" "$BIN/ffmpeg"
}

if [ "$1" = "--install" ]; then
  install_tools
  exit $?
fi

# ---- 메시지 주고받기 ----
read_msg() {
  local len
  len=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' \n')
  [ -n "$len" ] || return 1
  dd bs=1 count="$len" 2>/dev/null
}

send() {
  local LC_ALL=C
  local s="$1"
  local n=${#s}
  # 길이 4바이트는 %b 인자로 만든다 (형식 문자열에 넣으면 % 같은 바이트가 형식으로 해석될 수 있음)
  printf '%b' "$(printf '\\0%03o\\0%03o\\0%03o\\0%03o' $((n & 255)) $((n >> 8 & 255)) $((n >> 16 & 255)) $((n >> 24 & 255)))"
  printf '%s' "$s"
}

# JSON 문자열 안에 넣을 수 있게 \ 와 " 를 이스케이프하고 제어 문자는 뺀다
jstr() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'
}

# ---- 음성 형식: ffmpeg 가 있으면 mp3, 없으면 m4a (변환 없이 바로) ----
FFMPEG=""
for f in "$DIR/ffmpeg" /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do
  if [ -x "$f" ]; then
    FFMPEG="$f"
    break
  fi
done
JS=()
[ -x "$DENO" ] && JS=(--js-runtimes "deno:$DENO")
if [ -n "$FFMPEG" ]; then
  FORMAT=(-x --audio-format mp3 --audio-quality 192K --ffmpeg-location "$FFMPEG")
  EXT="mp3"
else
  FORMAT=(-f "bestaudio[ext=m4a]/bestaudio")
  EXT="m4a"
fi

# 영상: 고른 화질(세로 픽셀) 이하의 H.264 영상 + AAC 소리를 받아 .mp4 하나로 합친다 (QuickTime·아이폰에서 바로 재생)
video_format() {
  local h=$1
  printf '%s\n' -f "bv*[vcodec^=avc1][height<=$h]+ba[ext=m4a]/b[ext=mp4][height<=$h]/bv*[height<=$h]+ba/b[height<=$h]/b" \
    --merge-output-format mp4 --ffmpeg-location "$VFFMPEG"
}

download() {
  local i=$1 url=$2 kind=$3 height=$4 today line pct fmt=()
  today="$(date +%Y%m%d)"
  if [ "$kind" = video ]; then
    while IFS= read -r line; do fmt+=("$line"); done < <(video_format "$height")
  else
    fmt=("${FORMAT[@]}")
  fi
  send "{\"type\":\"start\",\"index\":$i}"
  # 출력 줄을 읽어 진행 상황을 확장프로그램으로 보낸다
  PYTHONIOENCODING=utf-8 "$YTDLP" "${fmt[@]}" "${JS[@]}" \
    --no-playlist --no-mtime --trim-filenames 150 --newline --no-simulate --progress \
    --progress-template "download:PROG %(progress._percent_str)s" \
    --print "before_dl:TITLE %(title)s" \
    --print "after_move:FILE %(filepath)s" \
    -o "$OUT/${today}_%(title)s.%(ext)s" \
    -- "$url" 2>&1 | while IFS= read -r line; do
      case "$line" in
        PROG*)
          pct=$(printf '%s' "$line" | tr -cd '0-9.')
          [ -n "$pct" ] && send "{\"type\":\"progress\",\"index\":$i,\"percent\":$pct}"
          ;;
        TITLE\ *) send "{\"type\":\"title\",\"index\":$i,\"title\":\"$(jstr "${line#TITLE }")\"}" ;;
        FILE\ *) send "{\"type\":\"saved\",\"index\":$i,\"file\":\"$(jstr "${line#FILE }")\"}" ;;
        "[Merger]"*) send "{\"type\":\"merging\",\"index\":$i}" ;;
        ERROR:*) send "{\"type\":\"error\",\"index\":$i,\"message\":\"$(jstr "${line#ERROR: }")\"}" ;;
      esac
    done
}

# 크롬으로 받은 엑셀·txt 파일에서 맥 '출처'(다운로드한 곳) 정보만 지운다. 경로는 base64 로 받는다.
# (내 폴더 안의 .xlsx/.txt/.json 파일만, 다른 내용은 건드리지 않음)
clean_meta() {
  local b64 path
  b64=$(printf '%s' "$1" | grep -o '"b64" *: *"[A-Za-z0-9+/=]*"' | sed -e 's/^"b64" *: *"//' -e 's/"$//')
  path=$(printf '%s' "$b64" | base64 -D 2> /dev/null || printf '%s' "$b64" | base64 -d 2> /dev/null)
  case "$path" in
    "$HOME"/*.xlsx | "$HOME"/*.txt | "$HOME"/*.json) ;;
    *)
      send '{"type":"cleaned","ok":false}'
      return
      ;;
  esac
  if [ -f "$path" ]; then
    xattr -d com.apple.metadata:kMDItemWhereFroms "$path" 2> /dev/null
    send '{"type":"cleaned","ok":true}'
  else
    send '{"type":"cleaned","ok":false}'
  fi
}

while msg=$(read_msg); do
  case "$msg" in
    *'"cleanmeta"'*)
      clean_meta "$msg"
      ;;
    *'"ping"'*)
      ok=false
      [ -x "$YTDLP" ] && ok=true
      video=false
      [ -x "$VFFMPEG" ] && video=true
      send "{\"type\":\"pong\",\"ok\":$ok,\"ext\":\"$EXT\",\"video\":$video,\"version\":$VERSION}"
      ;;
    *'"download"'*)
      # 유튜브가 바뀌어도 받을 수 있게 며칠마다 yt-dlp·Deno 를 최신으로 (실패하면 있던 것으로 계속)
      if [ -z "$CUSTOM_YTDLP" ] && [ -z "$(find "$BIN/.updated" -mtime -"$UPDATE_DAYS" 2> /dev/null)" ]; then
        send '{"type":"updating"}'
        install_tools
        [ -x "$DENO" ] && JS=(--js-runtimes "deno:$DENO")
      fi
      kind=audio
      case "$msg" in *'"kind":"video"'*) kind=video ;; esac
      height=$(printf '%s' "$msg" | grep -o '"height":[0-9]*' | tr -cd '0-9')
      [ -n "$height" ] || height=480
      [ "$kind" = video ] && [ -z "$CUSTOM_YTDLP" ] && install_ffmpeg
      i=0
      for url in $(printf '%s' "$msg" | grep -o 'https\{0,1\}://[^"]*'); do
        download "$i" "$url" "$kind" "$height"
        i=$((i + 1))
      done
      send '{"type":"finished"}'
      ;;
  esac
done
