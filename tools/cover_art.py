#!/usr/bin/env python3
"""Generate the cover for "The Book of DOOM".

An old folio binding: blackened, cracked leather with a stamped panel,
hand-set in IM Fell English, worn gilt rules and metal corner bosses.

Authored once with Pillow and the embedded IM Fell font; the PNG is
committed under web/app/assets/ and copied into the EPUB by
packaging/build_epub.py, so builds stay reproducible without Pillow.

Usage:
    python3 tools/cover_art.py web/app/assets/cover.png
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FELL = os.path.join(ROOT, "web", "app", "assets", "IMFellEnglish-Regular.ttf")
FELL_IT = os.path.join(ROOT, "web", "app", "assets", "IMFellEnglish-Italic.ttf")

BONE = (212, 196, 162)
ASH = (146, 128, 100)
BLOOD = (134, 24, 14)
GOLD = (132, 102, 52)
LEATHER_TOP = (30, 22, 17)
LEATHER_BOTTOM = (10, 8, 7)
PANEL = (12, 9, 7)


def fell(size, italic=False):
    return ImageFont.truetype(FELL_IT if italic else FELL, size)


def tracked_width(draw, text, fnt, tracking):
    return sum(draw.textlength(ch, font=fnt) for ch in text) + tracking * max(0, len(text) - 1)


def ink_layer(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def eroded(layer, rng, strength=90):
    w, h = layer.size
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    for _ in range(w * h // 260):
        x = rng.randrange(w)
        y = rng.randrange(h)
        mp[x, y] = 255 - rng.randrange(strength)
    mask = mask.filter(ImageFilter.GaussianBlur(1.0))
    alpha = layer.split()[3]
    alpha = Image.composite(alpha, Image.new("L", (w, h), 0), mask.point(lambda v: 255 if v > 70 else 0))
    layer.putalpha(alpha)
    return layer


def draw_tracked_hand(img, cx, y, text, fnt, fill, tracking, rng, jitter=2, erode=75):
    layer = ink_layer(img.size)
    d = ImageDraw.Draw(layer)
    x = cx - tracked_width(d, text, fnt, tracking) / 2.0
    for ch in text:
        layer_d = d
        layer_d.text((x + rng.randint(-jitter, jitter), y + rng.randint(-jitter, jitter)),
                     ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + tracking
    return eroded(layer, rng, strength=erode)


def leather(w, h, rng):
    img = Image.new("RGB", (w, h), LEATHER_TOP)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / float(h - 1)
        c = tuple(int(LEATHER_TOP[i] + (LEATHER_BOTTOM[i] - LEATHER_TOP[i]) * t) for i in range(3))
        d.line((0, y, w, y), fill=c)

    px = img.load()
    for _ in range(16000):
        x = rng.randrange(w)
        y = rng.randrange(h)
        v = rng.randrange(-7, 11)
        r, g, b = px[x, y]
        px[x, y] = (max(0, r + v), max(0, g + v), max(0, b + v))
    for _ in range(90000):
        x = rng.randrange(w)
        y = rng.randrange(h)
        v = rng.randrange(5, 17)
        r, g, b = px[x, y]
        px[x, y] = (min(255, r + v), min(255, g + v), min(255, b + v))

    stain = ink_layer((w, h))
    sd = ImageDraw.Draw(stain)
    for _ in range(26):
        sx = rng.randrange(w)
        sy = rng.randrange(h)
        sw = rng.randrange(120, 520)
        sh = rng.randrange(90, 420)
        sd.ellipse((sx - sw // 2, sy - sh // 2, sx + sw // 2, sy + sh // 2),
                   fill=(8, 5, 4, rng.randrange(28, 70)))
    stain = stain.filter(ImageFilter.GaussianBlur(46))
    img = Image.alpha_composite(img.convert("RGBA"), stain).convert("RGB")

    cd = ImageDraw.Draw(img)
    for _ in range(34):
        x = rng.randrange(w)
        y = rng.randrange(h)
        a = rng.uniform(0, math.tau)
        for _step in range(rng.randrange(40, 220)):
            nx = x + math.cos(a) * 5
            ny = y + math.sin(a) * 5
            cd.line((x, y, nx, ny), fill=(6, 4, 3))
            x, y = nx, ny
            a += rng.uniform(-0.35, 0.35)
            if not (0 <= x < w and 0 <= y < h):
                break

    vig = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vig)
    for i in range(300):
        vd.rectangle((i, i, w - 1 - i, h - 1 - i), outline=max(0, 255 - i * 2))
    vig = vig.filter(ImageFilter.GaussianBlur(110))
    return Image.composite(img, Image.new("RGB", (w, h), (0, 0, 0)), vig)


def boss(size, rng):
    layer = ink_layer((size, size))
    d = ImageDraw.Draw(layer)
    c = size / 2.0
    d.ellipse((4, 4, size - 4, size - 4), fill=(44, 34, 22, 255), outline=(84, 66, 36, 255), width=5)
    d.ellipse((size * 0.18, size * 0.18, size * 0.82, size * 0.82),
              fill=(24, 18, 12, 255), outline=(112, 88, 46, 255), width=3)
    d.ellipse((size * 0.38, size * 0.38, size * 0.62, size * 0.62),
              outline=(70, 54, 28, 255), width=3)
    for k in range(6):
        a = math.tau * k / 6.0
        rx = c + size * 0.30 * math.cos(a)
        ry = c + size * 0.30 * math.sin(a)
        rr = size * 0.035
        d.ellipse((rx - rr, ry - rr, rx + rr, ry + rr), fill=(120, 96, 50, 255))
    return eroded(layer, rng, strength=70)


def hand_frame(img, rng):
    d = ImageDraw.Draw(img)
    w, h = img.size
    for inset, width, color in ((76, 7, (152, 30, 16)), (98, 3, (92, 16, 10)), (118, 2, GOLD)):
        pts = []
        n = 240
        for k in range(n):
            t = k / float(n) * 4
            if t < 1:
                x, y = 78 + t * (w - 2 * 78), 78
            elif t < 2:
                x, y = w - 78, 78 + (t - 1) * (h - 2 * 78)
            elif t < 3:
                x, y = w - 78 - (t - 2) * (w - 2 * 78), h - 78
            else:
                x, y = 78, h - 78 - (t - 3) * (h - 2 * 78)
            pts.append((x, y))
        for k in range(0, len(pts) - 4, 3):
            if rng.random() < 0.92:
                d.line(pts[k:k + 4], fill=color, width=width)

    # Worn gilt fleurons at the frame's cardinal points.
    for x, y in ((w // 2, 118), (w // 2, h - 119), (118, h // 2), (w - 119, h // 2)):
        d.polygon(((x, y - 9), (x + 9, y), (x, y + 9), (x - 9, y)), fill=(116, 90, 46))
        d.ellipse((x - 22, y - 3, x - 16, y + 3), fill=(116, 90, 46))
        d.ellipse((x + 16, y - 3, x + 22, y + 3), fill=(116, 90, 46))


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/cover.png"
    W, H = 1600, 2400
    rng = random.Random(13481348)

    img = leather(W, H, rng).convert("RGBA")
    hand_frame(img, rng)
    for (qx, qy) in ((118, 118), (W - 119, 118), (118, H - 119), (W - 119, H - 119)):
        img.alpha_composite(boss(112, rng), (qx - 56, qy - 56))

    cx = W // 2

    # Publisher's line above the panel.
    img.alpha_composite(draw_tracked_hand(
        img, cx, 262, "ID SOFTWARE", fell(34), (140, 116, 84, 225), 16, rng, jitter=1, erode=60))

    # The stamped panel.
    px0, py0, px1, py1 = 236, 430, W - 236, 1980
    panel = Image.new("RGBA", (px1 - px0, py1 - py0), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rectangle((0, 0, panel.width - 1, panel.height - 1), fill=(PANEL[0], PANEL[1], PANEL[2], 150),
                 outline=(132, 24, 14, 235), width=6)
    pd.rectangle((16, 16, panel.width - 17, panel.height - 17), outline=(116, 90, 46, 190), width=2)
    pd.rectangle((24, 24, panel.width - 25, panel.height - 25), outline=(72, 56, 30, 170), width=1)
    for (fx, fy) in ((16, 16), (panel.width - 17, 16), (16, panel.height - 17), (panel.width - 17, panel.height - 17)):
        pd.polygon(((fx, fy - 8), (fx + 8, fy), (fx, fy + 8), (fx - 8, fy)), fill=(128, 100, 52, 220))
    img.alpha_composite(panel, (px0, py0))

    # Panel contents.
    img.alpha_composite(draw_tracked_hand(
        img, cx, 590, "THE BOOK OF", fell(86), (196, 178, 144, 235), 20, rng, jitter=2))

    img.alpha_composite(draw_tracked_hand(
        img, cx, 710, "DOOM", fell(300), (140, 26, 14, 240), 8, rng, jitter=3, erode=90))

    # Rules and fleuron beneath the title.
    rule = ink_layer(img.size)
    rd = ImageDraw.Draw(rule)
    for x in range(cx - 420, cx - 40, 5):
        rd.line((x, 1120, x + 3, 1120 + rng.randint(-2, 2)), fill=(122, 22, 13, 220), width=rng.choice((2, 2, 3)))
    for x in range(cx + 40, cx + 420, 5):
        rd.line((x, 1120, x + 3, 1120 + rng.randint(-2, 2)), fill=(122, 22, 13, 220), width=rng.choice((2, 2, 3)))
    rd.polygon(((cx, 1110), (cx + 12, 1120), (cx, 1130), (cx - 12, 1120)), fill=(150, 30, 16, 235))
    rd.ellipse((cx - 34, 1115, cx - 24, 1125), fill=(128, 100, 52, 220))
    rd.ellipse((cx + 24, 1115, cx + 34, 1125), fill=(128, 100, 52, 220))
    img.alpha_composite(eroded(rule, rng, strength=50))

    img.alpha_composite(draw_tracked_hand(
        img, cx, 1220, "THE SHAREWARE EPISODE", fell(52), (168, 38, 20, 235), 14, rng, jitter=1))
    img.alpha_composite(draw_tracked_hand(
        img, cx, 1330, "KNEE-DEEP IN THE DEAD  ·  E1M1 - E1M9", fell(26), (150, 128, 96, 220), 7, rng, jitter=1))

    img.alpha_composite(draw_tracked_hand(
        img, cx, 1560, "A book that runs itself", fell(62, italic=True), (188, 170, 136, 230), 2, rng, jitter=1))

    # Foot, below the panel.
    img.alpha_composite(draw_tracked_hand(
        img, cx, 2048, "PREPARED BY ARTEM KULYK", fell(34), (176, 146, 96, 230), 11, rng, jitter=1))
    img.alpha_composite(draw_tracked_hand(
        img, cx, 2152, "ID SOFTWARE  ·  THE EPUB PRESS  ·  MMXXVI", fell(26), (146, 124, 92, 220), 8, rng, jitter=1))

    img = img.convert("RGB")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, optimize=True)
    print("wrote %s (%dx%d, %d bytes)" % (out_path, W, H, os.path.getsize(out_path)))


if __name__ == "__main__":
    main()
