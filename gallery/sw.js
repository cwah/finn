// Service worker for the gallery.
//
// The gallery is five drawings, a JSON file and some CSS. That makes it a far better
// offline candidate than the scrapbook next door: it is small, entirely static, and
// there is nothing private in it. A visitor on a train can still look at the collection.
//
// Its scope is `/gallery/` — a worker can only ever control its own directory and below,
// which is exactly the isolation wanted here. The scrapbook's worker covers the rest of
// the origin and explicitly skips this path.
//
// TWO STRATEGIES, chosen per kind of thing:
//
//   Code and data — NETWORK FIRST. A stale cached module already broke sign-in on the
//   scrapbook once, and a service worker cache survives a hard reload, so there would be
//   no way out of it from the browser. Online you always get what was deployed.
//
//   Drawings — CACHE FIRST. Their filenames carry the date they were made and their
//   contents never change, so a cached copy is not merely acceptable, it is correct. It
//   is also what makes the gallery genuinely usable offline rather than an empty frame.

const VERSION = 'gallery-v3';

// Where the share sheet's file waits for admin.html. Not versioned, and skipped by the
// cleanup below, so an update cannot swallow a drawing someone was part-way through
// sharing.
const SHARE_CACHE = 'share-inbox';

const SHELL = ['./', './index.html', './data/artworks.json'];

/** Artwork and icons: fixed content under a dated name, safe to serve from cache. */
function isImmutable(pathname) {
  return /\/art\/|\/icon-\d+\.png$/.test(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL).catch(() => {});

    // Precache the collection itself, read from the manifest rather than a list kept
    // here — a hardcoded list would be wrong the day a drawing is added, and the whole
    // point is that the gallery works with no network at all.
    try {
      const res = await fetch('./data/artworks.json', { cache: 'no-store' });
      const { artworks = [] } = await res.json();
      // `image.src` is the contract's shape — a nested object, not a bare string. Guessed
      // at first, which threw inside this try and cached nothing at all, silently. The
      // path is relative to the app root, which for a worker is its own scope.
      const files = artworks
        .map((a) => a.image && a.image.src)
        .filter(Boolean)
        .map((src) => new URL(src, self.registration.scope));
      await Promise.all(files.map((u) => cache.add(u).catch(() => {})));
    } catch { /* the drawings will be cached as they are viewed instead */ }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== VERSION && n !== SHARE_CACHE).map((n) => caches.delete(n)),
      ))
      .then(() => self.clients.claim()),
  );
});


// ── The share sheet ───────────────────────────────────────────────
// A share target POSTs multipart form data at the app. Nothing here is a server, so the
// worker is what receives it: park the files where a page can find them, then answer
// with a redirect so the browser lands on an ordinary page instead of a POST result.
//
// 303 rather than 302, deliberately: it is the status that says "go and GET this
// instead", and without it a reload would re-submit the share.
async function receiveShare(event, redirectTo) {
  try {
    const form = await event.request.formData();
    const files = form.getAll('media').filter((f) => f && f.size);
    const cache = await caches.open(SHARE_CACHE);
    // Clear first: a share that was never opened should not turn up attached to this one.
    for (const old of await cache.keys()) await cache.delete(old);
    await Promise.all(files.map((file, i) => cache.put(
      new Request(`${self.registration.scope}__shared/${i}`),
      new Response(file, {
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-share-name': encodeURIComponent(file.name || `shared-${i}`),
          'x-share-modified': String(file.lastModified || Date.now()),
        },
      }),
    )));
  } catch (err) {
    // Losing the files is bad; leaving the browser on a dead POST is worse.
    console.warn('share failed:', err);
  }
  return Response.redirect(redirectTo, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const target = new URL(request.url);

  // A shared drawing goes straight to the admin page, which is the only thing here that
  // can do anything with one.
  if (request.method === 'POST' && target.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(event, `${self.registration.scope}admin.html?shared=1`));
    return;
  }

  if (request.method !== 'GET') return;

  const url = target;
  if (url.origin !== self.location.origin) return;
  // The gallery can read from PocketBase; that is live data and never cached.
  if (url.pathname.startsWith('/api/')) return;

  if (isImmutable(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('offline and not cached');
      }),
  );
});
