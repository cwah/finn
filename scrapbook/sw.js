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

// Bumped with the bell. A changed sw.js installs a new worker on its own, but activate
// only drops caches that are not this one — so without a bump a browser could keep
// serving its cached copy of the app modules that changed alongside it.
const VERSION = 'scrapbook-v4';

// Where the share sheet's files wait for the page. NOT versioned, and skipped by the
// cleanup below: a share can arrive moments before an update, and dropping it because
// the worker happened to change would lose whatever someone was trying to save.
const SHARE_CACHE = 'share-inbox';
const AUTH_CACHE = 'finnbook-auth';
const AUTH_KEY = '/__session-token';

/** Caches that survive a version bump, because they hold the person's state, not the build's. */
const KEEP = [SHARE_CACHE, AUTH_CACHE];

// The wording and the landing rules, shared verbatim with the tests. A worker cannot
// import an ES module, so this is a classic script loaded the old way — the same
// arrangement as the notifier's rule module on the server.
importScripts('/sw-notify.js');

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
        // KEEP is every cache that is not the app shell. The shell is versioned and old
        // copies are rubbish; these two hold state that belongs to the person, not to the
        // build — a share waiting to be claimed, and the token a push needs to find out
        // who posted. Sweeping them on a version bump would quietly downgrade every
        // notification to the plain wording until the app was next opened.
        names.filter((n) => n !== VERSION && !KEEP.includes(n)).map((n) => caches.delete(n)),
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


// ── Push ──────────────────────────────────────────────────────────
// The notification arrives with NO BODY, on purpose: a push carrying one would have to be
// encrypted per RFC 8291, and the caption would pass through a third-party push service on
// the way. So the server says only "something happened" and the wording lives here.
//
// A push event MUST show a notification. A browser that receives one and is shown nothing
// eventually posts its own "this site was updated in the background" — worse than saying
// nothing, because it is both vague and clearly not ours.

/**
 * The session token the page left for us, or null.
 *
 * A service worker cannot read localStorage, so this is the only way it has of being
 * anyone. Null is a normal outcome — signed out, a fresh install, a browser that refuses
 * site data — and it simply costs the detail, not the notification.
 */
async function sessionToken() {
  try {
    const hit = await caches.open(AUTH_CACHE).then((c) => c.match(AUTH_KEY));
    return hit ? (await hit.text()) || null : null;
  } catch {
    return null;
  }
}

/**
 * What this push is about.
 *
 * The push carries no body, so the detail is fetched here. Newest-created first, with the
 * author expanded — `notification()` decides which of them the push is actually about, by
 * what the server recorded as announced.
 *
 * Every failure returns null and the caller shows the plain wording. A notification that
 * says slightly less is a small loss; one that never appears is not, because a browser
 * shown nothing eventually posts its own "this site was updated in the background".
 */
async function recentPosts() {
  const token = await sessionToken();
  if (!token) return null;
  try {
    const res = await fetch(
      '/api/collections/posts/records?perPage=10&sort=-created&expand=author',
      { headers: { Authorization: token }, cache: 'no-store' },
    );
    if (!res.ok) return null;      // 401 after a token expires is the ordinary case
    const body = await res.json();
    return Array.isArray(body.items) ? body.items : null;
  } catch {
    return null;                   // offline, which a push can outrun
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const posts = await recentPosts();
    const news = notification(posts, Date.now());
    await self.registration.showNotification(news.title, {
      body: news.body,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      // One notification, replaced rather than stacked: three memories in an evening should
      // be one line on the lock screen, not three. Each push recomputes the wording, so the
      // replacement is what says "2 new memories" once a second one arrives.
      tag: 'finnbook-new-memory',
      renotify: true,
      // Where tapping lands. Carried on the notification so notificationclick does not have
      // to fetch it all over again.
      data: { url: landingUrl(news.postId) },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    // Focus the app if it is already open rather than opening a second copy — a scrapbook
    // in two tabs is two timelines that disagree about what has been read.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      // A focused tab does not reload, so the query string alone would do nothing — it is
      // already past the point where it reads one. Telling it directly is what makes the
      // deep link work on the tab someone already had open, which is the common case.
      client.postMessage({ type: 'show-post', url });
      return undefined;
    }
    return self.clients.openWindow(url);
  })());
});
