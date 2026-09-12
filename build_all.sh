#!/bin/sh
# Reproducible one-shot build: engine -> EPUB -> validation.
#
# Requirements: emscripten (emcc), python3, epubcheck (optional but checked).
# The shareware IWAD is committed at wad/doom1.wad; if missing, run
# tools/fetch_wad.sh first.
set -e
cd "$(dirname "$0")"

if [ ! -f wad/doom1.wad ]; then
  echo "==> fetching shareware IWAD"
  tools/fetch_wad.sh
fi

echo "==> building engine (WITH_SOUND=${WITH_SOUND:-1})"
WITH_SOUND="${WITH_SOUND:-1}" ./web/engine/build_engine.sh

echo "==> packaging EPUB"
python3 packaging/build_epub.py

echo "==> validating"
if command -v epubcheck >/dev/null 2>&1; then
  epubcheck dist/doom.epub
else
  echo "epubcheck not found; skipping validation"
fi

echo "==> done: dist/doom.epub"
