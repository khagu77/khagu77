#!/bin/bash
# 유튜브 음성 빠른 다운로드 (Mac)
# Finder 에서 더블클릭하면 터미널이 열립니다. 유튜브 URL을 붙여넣고 엔터를 두 번 누르면
# 영상을 재생하지 않고 음성 파일만 바로 받아 "다운로드" 폴더에 20261010_유튜브제목.m4a 로 저장합니다.
# (ffmpeg 가 설치돼 있으면 .mp3 로 저장)
# 처음 한 번은 yt-dlp(유튜브 다운로드 도구)를 이 폴더의 tools 에 내려받고, 이후에는 실행할 때마다 최신으로 업데이트합니다.

cd "$(dirname "$0")" || exit 1
TOOLS="$PWD/tools"
OUT="${OUT:-$HOME/Downloads}"
YTDLP="${YTDLP:-$TOOLS/yt-dlp_macos}"
URLS="$TOOLS/audio_urls.txt"
TODAY="$(date +%Y%m%d)"
mkdir -p "$TOOLS" "$OUT"

finish() {
  echo
  read -r -p "엔터를 누르면 창을 닫습니다." _
  exit "$1"
}

# 1) yt-dlp 준비
if [ ! -x "$YTDLP" ]; then
  echo "yt-dlp 내려받는 중… (처음 한 번만)"
  if ! curl -L --fail --progress-bar -o "$YTDLP" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"; then
    rm -f "$YTDLP"
    echo "yt-dlp 를 내려받지 못했습니다. 인터넷 연결을 확인해 주세요."
    finish 1
  fi
  chmod +x "$YTDLP"
else
  echo "yt-dlp 최신 버전 확인 중…"
  "$YTDLP" -U > /dev/null 2>&1 || true
fi

# 2) ffmpeg 가 있으면 mp3, 없으면 m4a (변환 없이 바로 저장)
FFMPEG=""
for f in "$TOOLS/ffmpeg" /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg "$(command -v ffmpeg 2>/dev/null)"; do
  if [ -n "$f" ] && [ -x "$f" ]; then
    FFMPEG="$f"
    break
  fi
done
if [ -n "$FFMPEG" ]; then
  FORMAT=(-x --audio-format mp3 --audio-quality 192K --ffmpeg-location "$FFMPEG")
  KIND="mp3"
else
  FORMAT=(-f "bestaudio[ext=m4a]/bestaudio")
  KIND="m4a"
fi

# 3) URL 받기: 실행할 때 준 URL, 없으면 터미널에 붙여넣기
if [ "$#" -gt 0 ]; then
  printf '%s\n' "$@" > "$URLS"
else
  echo
  echo "음성으로 받을 유튜브 URL을 붙여넣으세요. (여러 개면 한 줄에 하나씩)"
  echo "다 넣었으면 빈 줄에서 엔터를 한 번 더 누르세요."
  : > "$URLS"
  while IFS= read -r line; do
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -z "$line" ] && break
    printf '%s\n' "$line" >> "$URLS"
  done
fi
COUNT="$(grep -c . "$URLS" || true)"
if [ "$COUNT" -eq 0 ]; then
  echo "URL이 없습니다."
  finish 1
fi

# 4) 내려받기
echo
echo "${COUNT}개 영상의 음성을 받습니다 → $OUT  (${TODAY}_유튜브제목.${KIND})"
echo
"$YTDLP" "${FORMAT[@]}" \
  --no-playlist --no-mtime --trim-filenames 150 \
  -o "$OUT/${TODAY}_%(title)s.%(ext)s" \
  -a "$URLS"
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  echo "완료했습니다. 다운로드 폴더를 엽니다."
  command -v open > /dev/null && open "$OUT"
  finish 0
else
  echo "일부 영상을 받지 못했습니다. 위 메시지를 확인해 주세요."
  echo "(yt-dlp 가 유튜브 변경을 따라가지 못한 경우, 잠시 뒤 다시 실행하면 자동 업데이트로 해결되는 경우가 많습니다)"
  finish 1
fi
