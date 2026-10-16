#!/bin/bash
# 유튜브 확장의 AI 교정에 쓰는 Anthropic 공식 JavaScript SDK 를 브라우저용 파일 하나로 묶는다.
#   → youtube-extension/lib/anthropic-sdk.min.js (전역 Anthropic)
set -e
VERSION="${1:-0.133.0}"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y > /dev/null
npm install --silent "@anthropic-ai/sdk@$VERSION" esbuild
printf 'import Anthropic from "@anthropic-ai/sdk";\nglobalThis.Anthropic = Anthropic;\n' > entry.js
npx esbuild entry.js --bundle --minify --format=iife --platform=browser --target=chrome110 --outfile=anthropic-sdk.min.js
DEST="$(cd "$(dirname "$0")/.." && pwd)/youtube-extension/lib"
cp anthropic-sdk.min.js "$DEST/anthropic-sdk.min.js"
cp node_modules/@anthropic-ai/sdk/LICENSE "$DEST/LICENSE-anthropic-sdk.txt"
echo "done: @anthropic-ai/sdk@$VERSION"
