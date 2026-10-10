#!/bin/bash
# 'YouTube 스크립트 및 영상 파일 추출' 확장프로그램의 Mac 도우미 (크롬 Native Messaging 호스트)
# 확장프로그램이 보낸 유튜브 URL의 음성을 yt-dlp 로 바로 받아(재생·녹음 없이) 다운로드 폴더에 저장한다.
# 주고받는 메시지: 4바이트 길이(little-endian) + JSON
#   받음: {"type":"ping"} / {"type":"download","urls":["https://..."]}
#   보냄: pong / start / title / progress / saved / error / finished
# 설치: '유튜브 도우미 설치.app' 이 이 파일과 yt-dlp 를 ~/Library/Application Support/YTScriptHelper 에 둔다.

DIR="$(cd "$(dirname "$0")" && pwd)"
YTDLP="${YTDLP:-$DIR/yt-dlp_macos}"
OUT="${OUT:-$HOME/Downloads}"

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
if [ -n "$FFMPEG" ]; then
  FORMAT=(-x --audio-format mp3 --audio-quality 192K --ffmpeg-location "$FFMPEG")
  EXT="mp3"
else
  FORMAT=(-f "bestaudio[ext=m4a]/bestaudio")
  EXT="m4a"
fi

download() {
  local i=$1 url=$2 today line pct
  today="$(date +%Y%m%d)"
  send "{\"type\":\"start\",\"index\":$i}"
  # 출력 줄을 읽어 진행 상황을 확장프로그램으로 보낸다
  PYTHONIOENCODING=utf-8 "$YTDLP" "${FORMAT[@]}" \
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
        ERROR:*) send "{\"type\":\"error\",\"index\":$i,\"message\":\"$(jstr "${line#ERROR: }")\"}" ;;
      esac
    done
}

while msg=$(read_msg); do
  case "$msg" in
    *'"ping"'*)
      ok=false
      [ -x "$YTDLP" ] && ok=true
      send "{\"type\":\"pong\",\"ok\":$ok,\"ext\":\"$EXT\"}"
      ;;
    *'"download"'*)
      "$YTDLP" -U > /dev/null 2>&1 # 유튜브가 바뀌어도 받을 수 있게 매번 최신으로
      i=0
      for url in $(printf '%s' "$msg" | grep -o 'https\{0,1\}://[^"]*'); do
        download "$i" "$url"
        i=$((i + 1))
      done
      send '{"type":"finished"}'
      ;;
  esac
done
