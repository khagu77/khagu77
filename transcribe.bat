@echo off
chcp 65001 > nul
cd /d "%~dp0"
pip install -q -U yt-dlp faster-whisper
python youtube_transcribe.py %*
pause
