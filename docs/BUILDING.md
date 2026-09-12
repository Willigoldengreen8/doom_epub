# Building doom.epub from source

## Requirements

- macOS or Linux
- [Emscripten](https://emscripten.org/) 6.0.9 (`emcc` on `PATH`, provides its
  own `wasm-ld`); the pinned version is what releases are built and verified
  with, though newer versions should build as well
- Python 3.8+ (standard library only)
- `epubcheck` 5.3.0 (optional, for validation)
- `afconvert` (macOS) is *not* needed; the EPUB has no generated audio assets

The shareware IWAD is committed at `wad/doom1.wad`
(SHA-256 `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771`).
If it is missing, `tools/fetch_wad.sh` downloads and verifies it.

## One-shot build

```sh
git clone --recurse-submodules https://github.com/artemkulyk/doom_epub.git
cd doom_epub
./build_all.sh
# -> dist/doom.epub, validated by epubcheck
```

`engine/doomgeneric` is a git submodule pinned to the exact upstream commit the
project was built and tested against. The two local patches in `engine/patches/`
are applied automatically by `web/engine/build_engine.sh`.

## Building the engine only

```sh
./web/engine/build_engine.sh            # sound + OPL2 music (default)
WITH_SOUND=0 ./web/engine/build_engine.sh   # silent build, ~750 KB smaller
```

Outputs `web/engine/doom.js` and `web/engine/doom.wasm`.

## Packaging only

```sh
python3 packaging/build_epub.py
epubcheck dist/doom.epub
```

The cover is authored once by `tools/cover_art.py` and the frontispiece plate
is a committed JPEG under `web/app/assets/`, so the packager needs no Pillow.
`tools/wad_art.py` can still render the IWAD's title screen when a
title-screen image is wanted.

## Testing without a reader

`tools/cdp_test.js` drives the packaged `build/OEBPS` container in headless
Chrome over the DevTools protocol, including synthetic keyboard, mouse and touch
input:

```sh
python3 -m http.server 8741 --directory build/OEBPS &
node tools/cdp_test.js --url http://127.0.0.1:8741/game.xhtml \
  --wait 13000 --click 400 250 \
  --key Enter --wait 1600 --key Enter --wait 1600 \
  --key Enter --wait 1600 --key Enter --wait 3000 \
  --shot /tmp/game.png
```

## Reproducibility notes

- ZIP timestamps are pinned to 1980-01-01; builds are byte-for-byte stable for a
  fixed toolchain.
- `mimetype` is the first entry and stored uncompressed, per OCF.
- All runtime assets are generated or copied from sources in this repository.

## Continuous integration and releases

`.github/workflows/ci.yml` builds and validates every push and pull request:
Emscripten 6.0.9, Python 3.12, EPUBCheck 5.3.0 and the packaged EPUB as a build
artifact. `.github/workflows/release.yml` runs on tags matching `v*`, builds
twice and compares the two SHA-256 digests before creating the GitHub release
with `doom.epub` and `doom.epub.sha256` attached.
