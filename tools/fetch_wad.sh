#!/bin/sh
# Fetch the DOOM shareware IWAD and verify its checksum.
set -e
cd "$(dirname "$0")/.."
mkdir -p wad
URL="${WAD_URL:-https://github.com/Akbar30Bill/DOOM_wads/raw/master/doom1.wad}"
SHA256="1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771"

if [ -f wad/doom1.wad ] && [ "$(shasum -a 256 wad/doom1.wad | cut -d' ' -f1)" = "$SHA256" ]; then
  echo "wad/doom1.wad already present and verified"
  exit 0
fi

echo "downloading $URL"
curl -sSL -o wad/doom1.wad "$URL"
ACTUAL="$(shasum -a 256 wad/doom1.wad | cut -d' ' -f1)"
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "checksum mismatch: expected $SHA256 got $ACTUAL" >&2
  rm -f wad/doom1.wad
  exit 1
fi
echo "verified wad/doom1.wad ($(wc -c < wad/doom1.wad) bytes)"
