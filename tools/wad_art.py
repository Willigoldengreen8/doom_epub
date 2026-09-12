"""Extract DOOM art from a shareware WAD and render a polished EPUB cover.

Pure Python: reads the WAD directory, decodes Doom patch-format graphics and
PLAYPAL, and writes PNGs. No external dependencies.
"""
import os
import struct
import zlib

import pixelfont

WAD_MAGIC = b"IWAD"


def read_wad(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != WAD_MAGIC:
        raise ValueError("not an IWAD: %s" % path)
    numlumps, infotableofs = struct.unpack_from("<ii", data, 4)
    lumps = {}
    for i in range(numlumps):
        filepos, size, name = struct.unpack_from("<ii8s", data, infotableofs + i * 16)
        lumps[name.rstrip(b"\0").decode("ascii")] = (filepos, size)
    return data, lumps


def read_lump(data, lumps, name):
    filepos, size = lumps[name]
    return data[filepos:filepos + size]


def read_palette(data, lumps, index=0):
    pal = read_lump(data, lumps, "PLAYPAL")
    base = index * 768
    colors = []
    for i in range(256):
        r, g, b = pal[base + i * 3: base + i * 3 + 3]
        colors.append((r, g, b))
    return colors


def decode_patch(patch, palette):
    """Decode a Doom patch into (width, height, pixels) with alpha-0 gaps."""
    width, height, left, top = struct.unpack_from("<hhhh", patch, 0)
    cols = []
    for x in range(width):
        ofs = struct.unpack_from("<i", patch, 8 + x * 4)[0]
        px = []
        while patch[ofs] != 0xFF:
            topdelta = patch[ofs]
            length = patch[ofs + 1]
            y = topdelta
            for i in range(length):
                px.append((y, palette[patch[ofs + 3 + i]]))
                y += 1
            ofs += length + 4
        cols.append(px)
    return width, height, cols


def write_png(path, w, h, rows, alpha=False):
    """rows: list of bytearray (w*3 or w*4 bytes each)."""
    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw += row

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload +
                struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    color_type = 6 if alpha else 2
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def render_patch_rgba(patch, palette):
    width, height, cols = decode_patch(patch, palette)
    pixels = [[(0, 0, 0, 0)] * width for _ in range(height)]
    for x, col in enumerate(cols):
        for y, (r, g, b) in col:
            if 0 <= y < height:
                pixels[y][x] = (r, g, b, 255)
    return width, height, pixels


def make_cover(out_path, wad_path, title="IN EPUB", subtitle_lines=None,
               banner="TURN THE PAGE TO PLAY", art_lump="TITLEPIC",
               width=1200, height=800, art_scale=2):
    data, lumps = read_wad(wad_path)
    palette = read_palette(data, lumps)
    aw, ah, art = render_patch_rgba(read_lump(data, lumps, art_lump), palette)

    # Background: dark with a subtle red vertical gradient.
    canvas = {}
    for y in range(height):
        t = y / float(height)
        r = int(12 + 46 * t)
        g = int(6 + 10 * t)
        b = int(10 + 8 * t)
        for x in range(width):
            canvas[(x, y)] = (r, g, b)

    # Red frame.
    for x in range(width):
        for y in range(6):
            canvas[(x, y)] = (150, 30, 20)
            canvas[(x, height - 1 - y)] = (150, 30, 20)
    for y in range(height):
        for x in range(6):
            canvas[(x, y)] = (150, 30, 20)
            canvas[(width - 1 - x, y)] = (150, 30, 20)

    # TITLEPIC art, nearest-neighbour scaled.
    sw, sh = aw * art_scale, ah * art_scale
    ax = (width - sw) // 2
    ay = 46
    for y in range(sh):
        for x in range(sw):
            r, g, b, a = art[y // art_scale][x // art_scale]
            if a:
                canvas[(ax + x, ay + y)] = (r, g, b)

    y = ay + sh + 26
    pixelfont.draw_text(canvas, (width - pixelfont.text_width(title, 9)) // 2, y,
                        title, 9, (225, 45, 25))
    y += 9 * pixelfont.GLYPH_H + 20
    for line, scale, color in (subtitle_lines or [
            ("A REAL EBOOK THAT RUNS REAL DOOM", 4, (210, 210, 220)),
            ("SHAREWARE EPISODE 1 - NO NETWORK - SELF CONTAINED", 3, (150, 150, 170)),
    ]):
        pixelfont.draw_text(canvas, (width - pixelfont.text_width(line, scale)) // 2, y,
                            line, scale, color)
        y += scale * 7 + 22
    pixelfont.draw_text(canvas, (width - pixelfont.text_width(banner, 4)) // 2,
                        height - 62, banner, 4, (90, 220, 110))

    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            r, g, b = canvas[(x, y)]
            row += bytes((r, g, b))
        rows.append(row)
    write_png(out_path, width, height, rows)
    return aw, ah


def render_titlepic_png(out_path, wad_path, scale=1):
    data, lumps = read_wad(wad_path)
    palette = read_palette(data, lumps)
    aw, ah, art = render_patch_rgba(read_lump(data, lumps, "TITLEPIC"), palette)
    w, h = aw * scale, ah * scale
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            r, g, b, _a = art[y // scale][x // scale]
            row += bytes((r, g, b))
        rows.append(row)
    write_png(out_path, w, h, rows)
    return w, h


if __name__ == "__main__":
    import sys
    here = os.path.dirname(os.path.abspath(__file__))
    wad = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "wad", "doom1.wad")
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/doom_cover.png"
    print(make_cover(out, wad), "->", out)
