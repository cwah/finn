#!/usr/bin/env python3
"""Static file server for development. Same as `python3 -m http.server`, minus one lie.

    python3 serve.py [port]

CACHING. http.server sends Last-Modified and no Cache-Control, so Chrome caches ES
modules heuristically and a normal reload keeps running the old code — an edit appears
to have no effect, which reads as a bug in the app rather than in the browser. There is
no build step to bust a cache here, so this says no-store and the page always runs what
is on disk.

Scrapbook's copy of this file also implements Range requests, for video. There is no
video here, so that half is deliberately left out rather than carried along dead.

Serving over HTTP rather than opening index.html directly is not optional: ES modules
are blocked by CORS on file://, and history.pushState throws on it, which is how the
whole navigation model works.
"""

import re
import socket
import subprocess
import sys
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()


def routed_address():
    """The interface that would carry traffic off this machine."""
    try:
        # No packet is actually sent; connecting a UDP socket just selects a route.
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(('8.8.8.8', 80))
        address = probe.getsockname()[0]
        probe.close()
        return address
    except OSError:
        return None


def local_addresses():
    """
    Every address this machine can be reached on, wifi first.

    Not just the routed one: a VPN takes the default route, so probing for it on a machine
    running Tailscale hands back a 100.x address that a phone on the same wifi cannot use.
    The address someone actually wants is usually the boring private one.
    """
    found = []
    try:
        out = subprocess.run(['ifconfig'], capture_output=True, text=True, timeout=3).stdout
        if not out:
            out = subprocess.run(['ip', '-4', 'addr'], capture_output=True, text=True,
                                 timeout=3).stdout
        found = re.findall(r'inet (?:addr:)?(\d+\.\d+\.\d+\.\d+)', out)
    except (OSError, subprocess.SubprocessError):
        pass

    routed = routed_address()
    if routed and routed not in found:
        found.append(routed)

    private = ('192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
               '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
               '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.')
    usable = [a for a in dict.fromkeys(found) if not a.startswith('127.')]
    # Ordinary home-network addresses first; 100.x is carrier-grade NAT, which in practice
    # here means a VPN and is only reachable by other machines on it.
    return sorted(usable, key=lambda a: (not a.startswith(private), a))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766

    print(f'  http://localhost:{port}/')
    others = local_addresses()
    for i, address in enumerate(others):
        hint = '   <- try this one from a phone' if i == 0 else ''
        print(f'  http://{address}:{port}/{hint}')
    print(f'\n  bench: http://localhost:{port}/preview.html')
    print('\n  (no-store; Ctrl-C to stop)')

    # Threading, like `python3 -m http.server` itself: a browser opens several
    # connections at once and a slow request would block every other one behind it.
    ThreadingHTTPServer(('0.0.0.0', port), partial(DevHandler, directory='.')).serve_forever()
