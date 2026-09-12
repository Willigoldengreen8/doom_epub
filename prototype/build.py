#!/usr/bin/env python3
"""Build test.epub: a self-contained, standards-valid EPUB 3 capability test.

Reproducible: regenerates all binary assets (cover PNG, level data, audio,
wasm) from source. No network access required.
"""
import hashlib
import os
import shutil
import struct
import subprocess
import sys
import zipfile
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(ROOT, "test.epub")

# ---------------------------------------------------------------- PNG writer

FONT = {
    " ": ["00000"] * 7,
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
}


def draw_text(px, ox, oy, text, scale, color):
    x = ox
    for ch in text:
        glyph = FONT.get(ch, FONT[" "])
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    for dy in range(scale):
                        for dx in range(scale):
                            px[x + gx * scale + dx, oy + gy * scale + dy] = color
        x += (5 + 1) * scale


def make_cover(path, w=720, h=1080):
    buf = {}
    for y in range(h):
        for x in range(w):
            edge = min(x, y, w - 1 - x, h - 1 - y)
            if edge < 6:
                buf[(x, y)] = (150, 30, 20)
            else:
                t = y / h
                r = int(18 + 60 * t)
                g = int(8 + 14 * t)
                b = int(12 + 10 * t)
                if (y // 60) % 2 == 0:
                    r = min(255, r + 8)
                buf[(x, y)] = (r, g, b)

    draw_text(buf, 120, 180, "DOOM", 24, (210, 40, 24))
    draw_text(buf, 122, 184, "DOOM", 24, (240, 90, 30))
    draw_text(buf, 180, 400, "IN EPUB", 10, (230, 200, 60))
    draw_text(buf, 120, 520, "CAPABILITY TEST", 5, (200, 200, 210))
    draw_text(buf, 120, 600, "SELF CONTAINED", 4, (150, 150, 170))
    draw_text(buf, 120, 650, "NO NETWORK", 4, (150, 150, 170))
    draw_text(buf, 120, 890, "TURN THE PAGE", 5, (90, 200, 110))

    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r, g, b = buf[(x, y)]
            raw += bytes((r, g, b))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


# ---------------------------------------------------------------- level data

LEVEL = [
    "################",
    "#..............#",
    "#..##..##..##..#",
    "#..#....#..#...#",
    "#..#....#..#...#",
    "#....##....#...#",
    "#....##....#...#",
    "#..............#",
    "#..###..###....#",
    "#..............#",
    "#..#..##..#....#",
    "#..#..##..#....#",
    "#..............#",
    "#......##......#",
    "#..............#",
    "################",
]

SPRITES = [(5.5, 5.5, 1), (10.4, 8.6, 2), (2.8, 12.4, 1)]


def fnv1a(data):
    h = 2166136261
    for x in data:
        h ^= x
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def make_level(path):
    body = bytearray()
    for y, row in enumerate(LEVEL):
        for x, ch in enumerate(row):
            body.append(1 + ((x * 7 + y * 3) % 4) if ch == "#" else 0)
    body += struct.pack("<H", len(SPRITES))
    for (sx, sy, st) in SPRITES:
        body += struct.pack("<HHH", int(sx * 256), int(sy * 256), st)
    body += struct.pack("<I", fnv1a(body))
    with open(path, "wb") as f:
        f.write(bytes(body))
    return len(body)


# ---------------------------------------------------------------- audio

def make_audio(path):
    import math
    sr = 22050
    dur = 0.35
    n = int(sr * dur)
    pcm = bytearray()
    for i in range(n):
        t = i / sr
        env = min(1.0, t * 40) * math.exp(-6 * t)
        v = 0.5 * math.sin(2 * math.pi * 440 * t) * env
        pcm += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767))
    hdr = (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " +
           struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16) + b"data" +
           struct.pack("<I", len(pcm)))
    wav = path + ".wav"
    with open(wav, "wb") as f:
        f.write(hdr + pcm)
    afconvert = shutil.which("afconvert")
    if not afconvert:
        raise SystemExit("afconvert not found (macOS required to build audio asset)")
    subprocess.run([afconvert, "-f", "m4af", "-d", "aac", "-b", "64000", wav, path],
                   check=True, capture_output=True)
    os.unlink(wav)
    return os.path.getsize(path)


# ---------------------------------------------------------------- packaging

def build_tree():
    if os.path.exists(BUILD):
        shutil.rmtree(BUILD)
    os.makedirs(os.path.join(BUILD, "OEBPS", "assets"))
    os.makedirs(os.path.join(BUILD, "OEBPS", "js"))
    os.makedirs(os.path.join(BUILD, "META-INF"))
    shutil.copy(os.path.join(SRC, "META-INF", "container.xml"),
                os.path.join(BUILD, "META-INF", "container.xml"))
    for name in ("content.opf", "nav.xhtml", "cover.xhtml", "game.xhtml"):
        shutil.copy(os.path.join(SRC, "OEBPS", name), os.path.join(BUILD, "OEBPS", name))
    shutil.copy(os.path.join(SRC, "OEBPS", "js", "game.js"),
                os.path.join(BUILD, "OEBPS", "js", "game.js"))

    make_cover(os.path.join(BUILD, "OEBPS", "assets", "cover.png"))
    level_bytes = make_level(os.path.join(BUILD, "OEBPS", "assets", "data.bin"))
    audio_bytes = make_audio(os.path.join(BUILD, "OEBPS", "assets", "beep.m4a"))

    emcc = shutil.which("emcc")
    if not emcc:
        raise SystemExit("emcc not found; install Emscripten to build tiny.wasm")
    wasm_out = os.path.join(BUILD, "OEBPS", "assets", "tiny.wasm")
    subprocess.run([emcc, "--no-entry", "-O2", "-s", "STANDALONE_WASM",
                    "-o", wasm_out, os.path.join(SRC, "tiny.c")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return level_bytes, audio_bytes


def zip_epub():
    if os.path.exists(OUT):
        os.unlink(OUT)
    epoch = (1980, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
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
                    z.writestr(info, f.read())


def main():
    level_bytes, audio_bytes = build_tree()
    zip_epub()
    size = os.path.getsize(OUT)
    with open(OUT, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    print("built: %s" % OUT)
    print("bytes: %d  sha256: %s" % (size, digest))
    print("assets: data.bin=%dB beep.m4a=%dB" % (level_bytes, audio_bytes))


if __name__ == "__main__":
    sys.exit(main())
