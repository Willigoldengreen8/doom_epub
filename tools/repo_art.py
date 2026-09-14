#!/usr/bin/env python3
"""Generate the repository icon and the social preview card.

Both are authored once with Pillow from committed assets (the frontispiece
engraving and the IM Fell fonts) and committed under docs/assets/, so the
repository carries its own artwork without regenerating it at build time.

Usage:
    python3 tools/repo_art.py
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import cover_art as art  # noqa: E402  (palette, fonts, leather)

PLATE = os.path.join(ROOT, "web", "app", "assets", "doom.jpg")
OUT = os.path.join(ROOT, "docs", "assets")

PARCHMENT_TOP = (244, 233, 208)
PARCHMENT_BOTTOM = (228, 212, 180)
PARCHMENT_EDGE = (198, 178, 144)
RED = (139, 26, 16)
DEEP_RED = (122, 22, 13)
GOLD = (138, 106, 53)


def parchment(w, h, rng):
    img = Image.new("RGB", (w, h), PARCHMENT_TOP)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / float(h - 1)
        c = tuple(int(PARCHMENT_TOP[i] + (PARCHMENT_BOTTOM[i] - PARCHMENT_TOP[i]) * t)
                  for i in range(3))
        d.line((0, y, w, y), fill=c)
    px = img.load()
    for _ in range(w * h // 40):
        x = rng.randrange(w)
        y = rng.randrange(h)
        v = rng.randrange(-10, 7)
        r, g, b = px[x, y]
        px[x, y] = (max(0, r + v), max(0, g + v), max(0, b + v))
    vig = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vig)
    for i in range(120):
        vd.rectangle((i, i, w - 1 - i, h - 1 - i), outline=max(0, 255 - i * 3))
    vig = vig.filter(ImageFilter.GaussianBlur(40))
    return Image.composite(img, Image.new("RGB", (w, h), PARCHMENT_EDGE), vig)


def plate_square(size):
    im = Image.open(PLATE).convert("RGB")
    w, h = im.size
    left = (w - h) // 2
    return im.crop((left, 0, left + h, h)).resize((size, size), Image.LANCZOS)


def tracked(draw, cx, cy, text, font, fill, tracking):
    width = sum(draw.textlength(ch, font=font) for ch in text) + tracking * max(0, len(text) - 1)
    x = cx - width / 2.0
    for ch in text:
        draw.text((x, cy), ch, font=font, fill=fill, anchor="lm")
        x += draw.textlength(ch, font=font) + tracking


def icon():
    size = 512
    img = parchment(size, size, random.Random(7))
    img.paste(plate_square(400), (56, 56))
    d = ImageDraw.Draw(img)
    d.rectangle((44, 44, size - 45, size - 45), outline=RED, width=4)
    d.rectangle((30, 30, size - 31, size - 31), outline=GOLD, width=2)
    for (x, y) in ((44, 44), (size - 45, 44), (44, size - 45), (size - 45, size - 45)):
        d.polygon(((x, y - 6), (x + 6, y), (x, y + 6), (x - 6, y)), fill=(150, 30, 16))
    return img


def social():
    w, h = 1280, 640
    img = art.leather(w, h, random.Random(99)).convert("RGB")
    d = ImageDraw.Draw(img)

    d.rectangle((26, 26, w - 27, h - 27), outline=DEEP_RED, width=4)
    d.rectangle((40, 40, w - 41, h - 41), outline=GOLD, width=1)

    d.rectangle((52, 72, 548, 568), fill=(12, 9, 7), outline=(132, 24, 14), width=4)
    d.rectangle((60, 80, 540, 560), outline=(116, 90, 46), width=2)
    img.paste(plate_square(460), (70, 90))

    cx = 884
    cx_text = cx + 6

    tracked(d, cx_text, 172, "THE BOOK OF", art.fell(40), (196, 178, 144), 14)
    d.text((cx_text, 300), "DOOM", font=art.fell(170), fill=(150, 30, 16), anchor="mm")

    for x0, x1 in ((cx_text - 250, cx_text - 60), (cx_text + 60, cx_text + 250)):
        d.line((x0, 392, x1, 392), fill=DEEP_RED, width=3)
    d.polygon(((cx_text, 380), (cx_text + 12, 392), (cx_text, 404), (cx_text - 12, 392)),
              fill=(150, 30, 16))
    d.ellipse((cx_text - 44, 387, cx_text - 32, 399), fill=GOLD)
    d.ellipse((cx_text + 32, 387, cx_text + 44, 399), fill=GOLD)

    d.text((cx_text, 462), "A real ebook that runs real DOOM",
           font=art.fell(42, italic=True), fill=(188, 170, 136), anchor="mm")
    tracked(d, cx_text, 540, "github.com/artemkulyk/doom_epub",
            art.fell(24), (146, 124, 92), 5)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    ic = icon()
    ic_path = os.path.join(OUT, "icon.png")
    ic.save(ic_path, optimize=True)
    sp = social()
    sp_path = os.path.join(ROOT, "docs", "social-preview.png")
    sp.save(sp_path, optimize=True)
    for path in (ic_path, sp_path):
        print("wrote %s (%dx%d, %d bytes)" % (path, path and Image.open(path).size[0],
                                              Image.open(path).size[1], os.path.getsize(path)))


if __name__ == "__main__":
    main()