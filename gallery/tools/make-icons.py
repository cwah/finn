#!/usr/bin/env python3
"""Regenerate the gallery's icons from one of Finn's drawings.

    python3 tools/make-icons.py

Not a build step — the output is committed and this runs only when the icon changes. No
dependencies: `qlmanage` rasterises the SVG and `sips` resamples, both built into macOS,
and the flattening below is stdlib.

WHERE THE IMAGE COMES FROM: `assets/icon-source.svg`, or `.png`, if one is there. The
gallery deserves an icon of its own rather than borrowing a piece from the collection —
an artwork on the home screen implies that artwork is the app.

Failing that it falls back to a drawing, so this always produces something. Rocket to the
Grocery Store is the fallback because it reads clearly at 32px, where the paler drawings
turn to smudge. The fallback is FIXED rather than "whatever is newest": an installed app
whose icon changes underneath someone is worse than one that is out of date.

A NOTE ON SVG SOURCES: qlmanage rasterises onto opaque white, so a transparent SVG
arrives here with its transparency already gone and the flattening below does nothing.
An SVG source must therefore draw its own background — assets/icon-source.svg does.

WHY FLATTEN AT ALL: iOS composites a transparent apple-touch-icon onto BLACK. The drawings are
transparent PNGs once rasterised, so the wall colour is baked in — which also makes the
icon look like a piece hanging in the gallery rather than a cut-out.
"""
import struct
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# Preferred, in order. Drop a file at the first of these and it is used instead.
SOURCES = (
    HERE / 'assets' / 'icon-source.svg',
    HERE / 'assets' / 'icon-source.png',
    HERE / 'art' / '2026-07-30-rocket-grocery.svg',   # fallback: a piece from the wall
)
BACKGROUND = (0xcd, 0xc5, 0xb9)   # --wall, the gallery's own wall colour
# No inset. A purpose-drawn source composes its own margin — the frame in
# assets/icon-source.svg already sits inside its square — and adding more on top is
# exactly how the scrapbook's icon ended up marooned in the middle of a pale disc.
# A source that needs breathing room should be drawn with it.
INSET = 0.0
SIZES = (32, 180, 192, 512)


def read_png(path):
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
        raw.append(0)
        raw += pixels[y * size * 3:(y + 1) * size * 3]
    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def main():
    source = next((s for s in SOURCES if s.exists()), None)
    if source is None:
        raise SystemExit('no icon source — drop one at ' + str(SOURCES[0]))
    if source is SOURCES[-1]:
        print(f'  (no assets/icon-source.* — falling back to {source.name})')
    else:
        print(f'  using {source.relative_to(HERE)}')

    scratch = HERE / 'assets' / '.scratch'
    scratch.mkdir(parents=True, exist_ok=True)

    if source.suffix.lower() == '.svg':
        # qlmanage renders SVG; sips cannot read one at all.
        subprocess.run(['qlmanage', '-t', '-s', '1024', '-o', str(scratch), str(source)],
                       check=True, capture_output=True)
        master = next(scratch.glob('*.png'))
    else:
        master = source

    for size in SIZES:
        inset = round(size * INSET)
        inner = size - inset * 2
        small = scratch / f'{size}.png'
        subprocess.run(['sips', '-Z', str(inner), '--out', str(small), str(master)],
                       check=True, capture_output=True)

        w, h, channels, px = read_png(small)
        br, bg, bb = BACKGROUND
        canvas = bytearray(bytes(BACKGROUND) * size * size)
        # Centred: a rasterised drawing keeps its own proportions, so the shorter side
        # is padded rather than stretched.
        ox, oy = (size - w) // 2, (size - h) // 2
        for y in range(h):
            for x in range(w):
                i = (y * w + x) * channels
                alpha = px[i + 3] if channels == 4 else 255
                if not alpha:
                    continue
                cx, cy = x + ox, y + oy
                if not (0 <= cx < size and 0 <= cy < size):
                    continue
                o = (cy * size + cx) * 3
                canvas[o] = (px[i] * alpha + br * (255 - alpha)) // 255
                canvas[o + 1] = (px[i + 1] * alpha + bg * (255 - alpha)) // 255
                canvas[o + 2] = (px[i + 2] * alpha + bb * (255 - alpha)) // 255

        out = HERE / 'assets' / f'icon-{size}.png'
        write_rgb_png(out, size, canvas)
        print(f'  {out.name}  {size}x{size}  {out.stat().st_size:,} bytes')

    for f in scratch.iterdir():
        f.unlink()
    scratch.rmdir()


if __name__ == '__main__':
    main()
