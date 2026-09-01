// Service worker for the scrapbook.
//
// It exists mainly so the app is installable — added to a phone's home screen it opens
// standalone, which for something checked one-handed while holding a baby is the whole
// point. Offline is a secondary benefit and a deliberately modest one.
//
// NETWORK FIRST FOR EVERYTHING IT TOUCHES. This is not the usual advice, and it is
// deliberate: a stale cached module already broke sign-in on this app once, when a deploy
// renamed a form field and browsers kept the old JavaScript. A service worker cache is
// worse than an HTTP cache in that respect — it survives a hard reload, so the usual way
// out of the problem does not work. So: online, you always get what was deployed; the
// cache is only ever consulted when the network fails.
//
// TWO THINGS ARE NEVER TOUCHED:
//
//   /api/      auth tokens, private posts, and family photos. None of it belongs in a
//              cache on disk, and a stale one would show memories that were deleted.
//   /gallery/  a separate app with its own worker. This worker's scope is the whole
//              origin and would otherwise shadow it.

const VERSION = 'scrapbook-v2';

// Where the share sheet's files wait for the page. NOT versioned, and skipped by the
// cleanup below: a share can arrive moments before an update, and dropping it because
// the worker happened to change would lose whatever someone was trying to save.
const SHARE_CACHE = 'share-inbox';

// Only the entry point is precached. Listing every stylesheet and module would be a
// second copy of the file tree, silently wrong the moment one is added — everything else
// is cached the first time it is successfully fetched.
const SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      // Take over immediately rather than waiting for every tab to close. Safe here
      // because the fetch handler prefers the network, so a half-updated app cannot
      // serve a mix of old and new code.
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
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

  // Before the GET-only guard below: a share is the one POST this worker answers.
  if (request.method === 'POST' && target.pathname === '/share-target') {
    event.respondWith(receiveShare(event, '/?shared=1'));
    return;
  }

  if (request.method !== 'GET') return;

  const url = target;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/gallery/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opaque and error responses are not worth keeping; a 404 cached as the app
        // shell is how a working site starts serving nothing.
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // A navigation with nothing cached for that exact URL still deserves the app
        // rather than the browser's offline page.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('offline and not cached');
      }),
  );
});
