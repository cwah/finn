#!/usr/bin/env python3
"""Regenerate the app icons from assets/icon-source.png.

    python3 tools/make-icons.py

Not a build step — the output is committed, and this only runs when the icon changes.
No dependencies: `sips` (built into macOS) resamples, and the flattening below is stdlib.

WHY FLATTEN AT ALL: iOS composites a transparent apple-touch-icon onto BLACK. A cut-out
illustration would arrive on the home screen as a black square with a baby in it, which is
not what a pale sage app should look like. So the background is baked in, using the page's
own colour.

WHY NO INSET: an earlier version added 4% of margin so a rounded mask would not clip the
braids. That was the wrong trade. The source already carries 7-9% of transparent margin of
its own, a round home-screen mask keeps only the middle ~71%, and the three together left
the face marooned in the middle of a pale disc. So the artwork is TRIMMED to its own
content and fills the square edge to edge — a clipped braid-tip costs less than a face too
small to recognise.
"""
import struct
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# Preferred, in order. An SVG wins where both exist: it is the drawn mark, and a
# photograph or illustration is the thing being replaced rather than the default.
SOURCES = (
    HERE / 'assets' / 'icon-source.svg',
    HERE / 'assets' / 'icon-source.png',
)
BACKGROUND = (0xf2, 0xf4, 0xec)   # --bg / theme-color, the page's pale sage
SIZES = (32, 180, 192, 512)


def read_png(path):
    """Decode an 8-bit non-interlaced PNG to (width, height, channels, pixels)."""
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path} is not a PNG')
    pos, idat, meta = 8, b'', None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            w, h, depth, colour, _, _, interlace = struct.unpack('>IIBBBBB', body)
            if depth != 8 or interlace:
                raise SystemExit('only 8-bit, non-interlaced PNGs are supported')
            meta = (w, h, colour)
        elif kind == b'IDAT':
            idat += body
        elif kind == b'IEND':
            break
        pos += 12 + length

    w, h, colour = meta
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
    raw = zlib.decompress(idat)

    # Undo the per-scanline filters. Each line names its own, and most reference the
    # pixel to the left and the line above, so this has to run in order.
    stride = w * channels
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif ftype == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, channels, out


def write_rgb_png(path, size, pixels):
    def chunk(kind, body):
        crc = zlib.crc32(kind + body) & 0xffffffff
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', crc)

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none. These are small; the saving is not worth the code.
        raw += pixels[y * size * 3:(y + 1) * size * 3]

    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def content_box(w, h, channels, px):
    """The smallest rectangle holding every pixel that is not transparent."""
    if channels != 4:
        return 0, 0, w - 1, h - 1
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w
        for x in range(w):
            if px[(row + x) * 4 + 3] > 8:   # 8, not 0: ignore anti-aliasing dust
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    return (0, 0, w - 1, h - 1) if maxx < 0 else (minx, miny, maxx, maxy)


def build(size, scratch, master):
    # Resample from the full-resolution master every time, rather than from a smaller
    # intermediate, so the 32px is as good as it can be.
    subprocess.run(['sips', '-Z', str(size), '--out', str(scratch), str(master)],
                   check=True, capture_output=True)
    w, h, channels, px = read_png(scratch)

    # Trim the source's own transparent margin, then take the SQUARE that contains the
    # content, so the drawing is not distorted and is centred on itself rather than on
    # whatever empty space the artist left.
    minx, miny, maxx, maxy = content_box(w, h, channels, px)
    side = max(maxx - minx + 1, maxy - miny + 1)
    ox = minx - (side - (maxx - minx + 1)) // 2
    oy = miny - (side - (maxy - miny + 1)) // 2

    br, bg, bb = BACKGROUND
    canvas = bytearray(bytes(BACKGROUND) * size * size)
    for cy in range(size):
        sy = oy + cy * side // size
        for cx in range(size):
            sx = ox + cx * side // size
            if not (0 <= sx < w and 0 <= sy < h):
                continue
            i = (sy * w + sx) * channels
            alpha = px[i + 3] if channels == 4 else 255
            if not alpha:
                continue
            o = (cy * size + cx) * 3
            canvas[o] = (px[i] * alpha + br * (255 - alpha)) // 255
            canvas[o + 1] = (px[i + 1] * alpha + bg * (255 - alpha)) // 255
            canvas[o + 2] = (px[i + 2] * alpha + bb * (255 - alpha)) // 255

    out = HERE / 'assets' / f'icon-{size}.png'
    write_rgb_png(out, size, canvas)
    print(f'  {out.name}  {size}x{size}  {out.stat().st_size:,} bytes')


if __name__ == '__main__':
    source = next((s for s in SOURCES if s.exists()), None)
    if source is None:
        raise SystemExit('no icon source — drop one at ' + str(SOURCES[0]))
    print(f'  using {source.relative_to(HERE)}')

    scratch = HERE / 'assets' / '.icon-scratch.png'
    rendered = None
    try:
        if source.suffix.lower() == '.svg':
            # sips cannot read an SVG at all; qlmanage rasterises one. Note that it
            # composites onto opaque WHITE, so an SVG source must draw its own
            # background — the flattening below will have nothing left to do.
            out = HERE / 'assets' / '.svg-render'
            out.mkdir(exist_ok=True)
            subprocess.run(['qlmanage', '-t', '-s', '1024', '-o', str(out), str(source)],
                           check=True, capture_output=True)
            rendered = next(out.glob('*.png'))
            master = rendered
        else:
            master = source

        for s in SIZES:
            build(s, scratch, master)
    finally:
        scratch.unlink(missing_ok=True)
        if rendered:
            rendered.unlink(missing_ok=True)
            rendered.parent.rmdir()
    print('\n  Remember: the sizes are committed, so commit them.')
