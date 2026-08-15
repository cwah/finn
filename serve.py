#!/usr/bin/env python3
"""Static file server for development. Same as `python3 -m http.server`, minus two lies.

    python3 serve.py [port]

1. CACHING. http.server sends Last-Modified and no Cache-Control, so Chrome caches ES
   modules heuristically and a normal reload keeps running the old code — an edit appears
   to have no effect, which reads as a bug in the app rather than in the browser. There is
   no build step to bust a cache here, so this says no-store and the page always runs what
   is on disk.

2. RANGE REQUESTS. http.server ignores the Range header and answers 200 with the whole
   file, which quietly breaks video. A phone records its `moov` atom at the END of the
   file, so a browser reads metadata by asking for the tail — and it seeks, including to
   the `#t=` fragment a trim uses, by asking for the middle. Without ranges it has to
   download everything before it can play anything, and cannot seek at all.

   PocketBase (Go) serves ranges correctly, so uploaded video is unaffected. This is only
   for files served straight off disk, which is what preview.html uses.
"""

import re
import sys
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

RANGE = re.compile(r'^bytes=(\d*)-(\d*)$')


class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        # Advertised so the browser knows seeking is on offer at all.
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def send_head(self):
        """Answer a Range request with 206 and the slice; everything else as usual."""
        header = self.headers.get('Range')
        match = RANGE.match(header.strip()) if header else None
        if not match:
            return super().send_head()

        path = self.translate_path(self.path)
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None

        try:
            size = f.seek(0, 2)
            first, last = match.group(1), match.group(2)
            if first:
                start = int(first)
                end = int(last) if last else size - 1
            else:
                # "bytes=-500" means the LAST 500 bytes — how a player finds a trailing
                # moov atom without knowing where it is.
                start = max(0, size - int(last or 0))
                end = size - 1
            end = min(end, size - 1)

            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                f.close()
                return None

            f.seek(start)
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            # copyfile() would send the rest of the file, so hand back only the slice.
            return _Slice(f, end - start + 1)
        except Exception:
            f.close()
            raise


class _Slice:
    """A read-only view of `length` bytes, so copyfile stops at the end of the range."""

    def __init__(self, f, length):
        self._f = f
        self._left = length

    def read(self, n=-1):
        if self._left <= 0:
            return b''
        if n is None or n < 0:
            n = self._left
        chunk = self._f.read(min(n, self._left))
        self._left -= len(chunk)
        return chunk

    def close(self):
        self._f.close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'http://localhost:{port}/index.html  (no-store, ranges; Ctrl-C to stop)')
    # Threading, like `python3 -m http.server` itself: a browser opens several
    # connections at once, and a video stream held open on a single-threaded server
    # blocks every other request behind it.
    ThreadingHTTPServer(('', port), partial(DevHandler, directory='.')).serve_forever()
