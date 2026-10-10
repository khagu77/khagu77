"""유튜브 영상 음성을 직접 받아써서 한글 자막 파일(.srt / .txt)을 만듭니다.

유튜브에 올라온 자막(자동 생성 포함)은 쓰지 않고, 영상 음성을 내려받아
Whisper 음성인식으로 새로 받아씁니다. 그래서 자막이 영상과 다르거나,
영어로만 있거나, 아예 없는 영상에도 쓸 수 있습니다.

사용법:
    python youtube_transcribe.py                 # urls.txt 의 영상 전부
    python youtube_transcribe.py URL [URL ...]   # 지정한 영상만
    python youtube_transcribe.py --model large-v3 URL   # 더 정확하지만 느림

결과는 subtitles 폴더에 "영상제목 [영상ID].srt / .txt" 로 저장됩니다.
"""

import argparse
import sys
from pathlib import Path

from faster_whisper import WhisperModel
from yt_dlp import YoutubeDL

BASE_DIR = Path(__file__).resolve().parent
URLS_FILE = BASE_DIR / "urls.txt"
OUT_DIR = BASE_DIR / "subtitles"
AUDIO_DIR = OUT_DIR / "_audio"


def read_urls(args_urls):
    if args_urls:
        return args_urls
    if not URLS_FILE.exists():
        sys.exit(f"영상 URL을 인자로 주거나 {URLS_FILE.name} 에 한 줄에 하나씩 적어 주세요.")
    lines = URLS_FILE.read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]


def download_audio(url):
    """음성만 내려받습니다. 변환하지 않으므로 ffmpeg 가 없어도 됩니다."""
    opts = {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "outtmpl": str(AUDIO_DIR / "%(id)s.%(ext)s"),
        "restrictfilenames": True,
        "quiet": True,
        "no_warnings": True,
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return info, Path(ydl.prepare_filename(info))


def srt_time(seconds):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def script_time(seconds):
    s = int(seconds)
    h, m = divmod(s // 60, 60)
    return f"{h}:{m:02d}:{s % 60:02d}" if h else f"{m:02d}:{s % 60:02d}"


def safe_name(title):
    bad = '<>:"/\\|?*'
    return "".join("_" if c in bad else c for c in title).strip()[:80]


def transcribe(model, audio_path, info):
    segments, _ = model.transcribe(
        str(audio_path),
        language="ko",
        vad_filter=True,  # 음악·무음 구간에서 엉뚱한 문장이 생기는 것을 줄임
        beam_size=5,
        condition_on_previous_text=False,  # 같은 문장 반복 현상 방지
    )
    duration = info.get("duration") or 0
    srt_lines, txt_lines = [], []
    for i, seg in enumerate(segments, 1):
        text = seg.text.strip()
        if not text:
            continue
        srt_lines += [str(i), f"{srt_time(seg.start)} --> {srt_time(seg.end)}", text, ""]
        txt_lines.append(f"{script_time(seg.start)} {text}")
        if duration:
            print(f"\r  받아쓰는 중... {min(seg.end / duration, 1):.0%}", end="", flush=True)
    print()
    return "\n".join(srt_lines), "\n".join(txt_lines)


def main():
    parser = argparse.ArgumentParser(description="유튜브 영상 한글 자막 만들기")
    parser.add_argument("urls", nargs="*", help="유튜브 영상 URL")
    parser.add_argument("--model", default="medium",
                        help="Whisper 모델: small(빠름) / medium(기본) / large-v3(가장 정확, 느림)")
    args = parser.parse_args()

    urls = read_urls(args.urls)
    OUT_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(exist_ok=True)

    print(f"음성인식 모델({args.model}) 준비 중... 처음 한 번은 모델을 내려받느라 몇 분 걸립니다.")
    model = WhisperModel(args.model, device="auto", compute_type="int8")

    for n, url in enumerate(urls, 1):
        print(f"\n[{n}/{len(urls)}] {url}")
        try:
            info, audio_path = download_audio(url)
            print(f"  제목: {info.get('title')}")
            srt, txt = transcribe(model, audio_path, info)
        except Exception as e:  # 한 영상이 실패해도 나머지는 계속
            print(f"  실패: {e}")
            continue
        stem = f"{safe_name(info.get('title') or info['id'])} [{info['id']}]"
        (OUT_DIR / f"{stem}.srt").write_text(srt, encoding="utf-8-sig")
        (OUT_DIR / f"{stem}.txt").write_text(txt + "\n", encoding="utf-8-sig")
        audio_path.unlink(missing_ok=True)
        print(f"  저장: subtitles/{stem}.srt, .txt")

    print(f"\n완료. 결과 폴더: {OUT_DIR}")


if __name__ == "__main__":
    main()
