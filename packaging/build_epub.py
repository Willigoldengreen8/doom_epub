#!/usr/bin/env python3
"""Reproducibly assemble dist/doom.epub from source assets.

Inputs:
  web/app/*            XHTML, CSS, boot JS, legal texts, OPF
  web/src/player.js    player core
  web/engine/doom.js   Emscripten glue (built by web/engine/build_engine.sh)
  web/engine/doom.wasm engine binary
  wad/doom1.wad        shareware IWAD

Output:
  build/               unpacked container (useful for local testing)
  dist/doom.epub       the distributable book
"""
import hashlib
import os
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

APP = os.path.join(ROOT, "web", "app")
BUILD = os.path.join(ROOT, "build")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "doom.epub")
WAD = os.path.join(ROOT, "wad", "doom1.wad")
ENGINE = os.path.join(ROOT, "web", "engine")

CONTAINER_XML = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""


def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def write_legal_page(src, dst, title):
    import html
    with open(src, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    doc = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
  <meta charset="utf-8"/>
  <title>%s</title>
  <link rel="stylesheet" type="text/css" href="../css/style.css"/>
</head>
<body class="legal">
  <h1>%s</h1>
  <pre>%s</pre>
</body>
</html>
""" % (html.escape(title), html.escape(title), html.escape(text))
    with open(dst, "w", encoding="utf-8") as f:
        f.write(doc)


def build_tree():
    if os.path.exists(BUILD):
        shutil.rmtree(BUILD)
    oebps = os.path.join(BUILD, "OEBPS")
    for sub in ("css", "js", "assets", "legal"):
        os.makedirs(os.path.join(oebps, sub))
    os.makedirs(os.path.join(BUILD, "META-INF"))

    with open(os.path.join(BUILD, "META-INF", "container.xml"), "w") as f:
        f.write(CONTAINER_XML)

    for name in ("content.opf", "nav.xhtml", "cover.xhtml", "halftitle.xhtml",
                 "frontispiece.xhtml", "titlepage.xhtml", "copyright.xhtml",
                 "contents.xhtml", "about.xhtml", "controls.xhtml", "part.xhtml",
                 "game.xhtml", "colophon.xhtml"):
        copy(os.path.join(APP, name), os.path.join(oebps, name))
    copy(os.path.join(APP, "css", "style.css"), os.path.join(oebps, "css", "style.css"))
    copy(os.path.join(APP, "js", "boot.js"), os.path.join(oebps, "js", "boot.js"))
    copy(os.path.join(ROOT, "web", "src", "player.js"), os.path.join(oebps, "js", "player.js"))
    copy(os.path.join(ENGINE, "doom.js"), os.path.join(oebps, "js", "doom.js"))
    copy(os.path.join(ENGINE, "doom.wasm"), os.path.join(oebps, "assets", "doom.wasm"))
    copy(WAD, os.path.join(oebps, "assets", "doom1.wad"))
    write_legal_page(
        os.path.join(APP, "legal", "NOTICE.txt"),
        os.path.join(oebps, "legal", "notice.xhtml"), "Legal Notice")
    write_legal_page(
        os.path.join(ROOT, "engine", "doomgeneric", "LICENSE"),
        os.path.join(oebps, "legal", "gpl.xhtml"), "GNU General Public License v2")

    # Artwork is authored once by tools/cover_art.py and committed under
    # web/app/assets/ so the build needs no imaging library.
    for art in ("cover.png", "doom.jpg", "IMFellEnglish-Regular.ttf", "IMFellEnglish-Italic.ttf"):
        copy(os.path.join(APP, "assets", art), os.path.join(oebps, "assets", art))

    sizes = {}
    for dirpath, _dirs, files in os.walk(oebps):
        for name in files:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, oebps).replace(os.sep, "/")
            sizes[rel] = os.path.getsize(full)
    return sizes


def zip_epub():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(OUT):
        os.unlink(OUT)
    epoch = (1980, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        info = zipfile.ZipInfo("mimetype", date_time=epoch)
        info.compress_type = zipfile.ZIP_STORED
        z.writestr(info, "application/epub+zip")
        for dirpath, _dirs, files in os.walk(BUILD):
            for name in sorted(files):
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, BUILD).replace(os.sep, "/")
                if rel == "mimetype":
                    continue
                info = zipfile.ZipInfo(rel, date_time=epoch)
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(full, "rb") as f:
                    z.writestr(info, f.read(), compresslevel=9)
    return os.path.getsize(OUT)


def main():
    sizes = build_tree()
    total = zip_epub()
    with open(OUT, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    print("built: %s" % OUT)
    print("epub:  %d bytes  sha256 %s" % (total, digest))
    print("container contents:")
    for rel in sorted(sizes, key=lambda r: -sizes[r]):
        print("  %9d  %s" % (sizes[rel], rel))


if __name__ == "__main__":
    main()
