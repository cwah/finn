#!/usr/bin/env python3
"""Regenerate the app icons from assets/icon-source.png.

    python3 tools/make-icons.py

Not a build step — the output is committed, and this only runs when the icon changes.
No dependencies: `sips` (built into macOS) resamples, and the flattening below is stdlib.

WHY FLATTEN AT ALL: iOS composites a transparent apple-touch-icon onto BLACK. A cut-out
illustration would arrive on the home screen as a black square with a baby in it, which is
not what a pale sage app should look like. So the background is baked in, using the page's
own colour.

WHY INSET: iOS masks the icon to a rounded square, and this artwork has braids that reach
towards the corners. A few percent of margin keeps them.
"""
import struct
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE / 'assets' / 'icon-source.png'
BACKGROUND = (0xf2, 0xf4, 0xec)   # --bg / theme-color, the page's pale sage
INSET = 0.04                      # fraction of the icon left as margin
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


def build(size, scratch):
    inset = round(size * INSET)
    inner = size - inset * 2
    # sips resamples from the full-resolution master every time, rather than from a
    # smaller intermediate, so the 32px is as good as it can be.
    subprocess.run(['sips', '-Z', str(inner), '--out', str(scratch), str(SOURCE)],
                   check=True, capture_output=True)

    w, h, channels, px = read_png(scratch)
    br, bg, bb = BACKGROUND
    canvas = bytearray(bytes(BACKGROUND) * size * size)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * channels
            alpha = px[i + 3] if channels == 4 else 255
            if not alpha:
                continue
            cx, cy = x + inset, y + inset
            if not (0 <= cx < size and 0 <= cy < size):
                continue
            o = (cy * size + cx) * 3
            canvas[o] = (px[i] * alpha + br * (255 - alpha)) // 255
            canvas[o + 1] = (px[i + 1] * alpha + bg * (255 - alpha)) // 255
            canvas[o + 2] = (px[i + 2] * alpha + bb * (255 - alpha)) // 255

    out = HERE / 'assets' / f'icon-{size}.png'
    write_rgb_png(out, size, canvas)
    print(f'  {out.name}  {size}x{size}  {out.stat().st_size:,} bytes')


if __name__ == '__main__':
    if not SOURCE.exists():
        raise SystemExit(f'no {SOURCE} — drop a square PNG there first')
    scratch = HERE / 'assets' / '.icon-scratch.png'
    try:
        for s in SIZES:
            build(s, scratch)
    finally:
        scratch.unlink(missing_ok=True)
    print('\n  Remember: the sizes are committed, so commit them.')
