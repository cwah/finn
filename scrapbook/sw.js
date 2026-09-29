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
//   /api/collections/, /api/files/ WITH A RANGE, and everything else under /api/.
//              Auth tokens and post JSON are mutable, and a stale copy would show
//              memories that were deleted. Video is excluded separately because seeking
//              is a range request, and answering one from a whole cached file breaks it.
//
// THE ONE EXCEPTION IS /api/files/ IMAGES, added when bandwidth became the binding
// constraint. A PocketBase file URL carries a filename generated at upload, so the bytes
// at a given URL never change — which is what makes a cache safe here and unsafe for the
// JSON beside it. They are already on disk in the HTTP cache; this only stops them being
// fetched twice.
//   /gallery/  a separate app with its own worker. This worker's scope is the whole
//              origin and would otherwise shadow it.

// Bumped with the bell. A changed sw.js installs a new worker on its own, but activate
// only drops caches that are not this one — so without a bump a browser could keep
// serving its cached copy of the app modules that changed alongside it.
const VERSION = 'scrapbook-v9';

// Where the share sheet's files wait for the page. NOT versioned, and skipped by the
// cleanup below: a share can arrive moments before an update, and dropping it because
// the worker happened to change would lose whatever someone was trying to save.
const SHARE_CACHE = 'share-inbox';
const AUTH_CACHE = 'finnbook-auth';

// Photos, kept across deploys — the app shell is versioned because it changes, and these
// never do. Bounded, because a family scrapbook grows without limit and a cache that
// grows with it would quietly fill a phone.
const MEDIA_CACHE = 'finnbook-media';
const MEDIA_LIMIT = 500;
const AUTH_KEY = '/__session-token';

/** Caches that survive a version bump, because they hold the person's state, not the build's. */
const KEEP = [SHARE_CACHE, AUTH_CACHE, MEDIA_CACHE];

// ── What a notification says, and where tapping it goes ───────────
// INLINE, and it was a separate file loaded with importScripts until sharing broke.
//
// A share arrives as a navigation POST, and answering it means the browser STARTING this
// worker from scratch — at which point every top-level statement runs, including an
// import that has to be fetched and evaluated before the fetch handler exists at all.
// That file was also missing from the image for ten days, during which no worker could
// install anywhere; sharing stopped working the day after the first one finally did.
//
// Whether the import is slow, fails, or merely has to happen, it is work standing between
// a shared photograph and the handler meant to catch it. There is nothing here that
// justifies the risk: it is a hundred lines of text.
//
// Kept identical otherwise, and tested by extracting it from this file — see
// test/sw-notify.test.js.

// --- shared with sw-notify.js: keep identical (test/sw-notify.test.js) ---
/** How recently a post must have been announced to count as part of this push. */
const BATCH_MINUTES = 10;

/** PocketBase's "2026-09-01 05:10:30.118Z" -> ms, or NaN. */
function pbTime(value) {
  if (!value) return NaN;
  return new Date(String(value).trim().replace(' ', 'T')).getTime();
}

/**
 * Which posts this push is about.
 *
 * The worker cannot be told directly — there is no payload — so it asks the server what
 * was announced recently. `notifiedAt` is the server's own record of having sent
 * something, which makes it the honest answer to "what is this push for".
 *
 * A post with no notifiedAt is not counted: it has not been announced, so it is not what
 * anyone is being told about. If NOTHING qualifies, the newest post is used rather than
 * showing nothing — a push arrived, so something happened, and a browser that is shown no
 * notification eventually invents its own.
 */
function batchOf(posts, now) {
  const cutoff = now - BATCH_MINUTES * 60 * 1000;
  const announced = (posts || []).filter((p) => {
    const at = pbTime(p && p.notifiedAt);
    return Number.isFinite(at) && at >= cutoff && at <= now + 60 * 1000;
  });
  if (announced.length) return announced;
  const newest = (posts || [])[0];
  return newest ? [newest] : [];
}

/** The author's display name, if the record carried one. */
function authorName(post) {
  const a = post && post.expand && post.expand.author;
  if (!a) return null;
  const name = (a.name || '').trim() || (a.email || '').trim();
  return name || null;
}

/**
 * Which post tapping the notification should land on.
 *
 * By MEMORY DATE, not creation date, because that is where the card sits in the timeline —
 * the thing a person is being sent to look at. A post backdated to last month is the most
 * recent thing that happened and is also a long way down the page, which is exactly the
 * case where being dropped at the top is useless.
 */
function landingPost(batch) {
  let best = null;
  for (const post of batch) {
    if (!best) { best = post; continue; }
    const a = pbTime(post.memoryDate);
    const b = pbTime(best.memoryDate);
    if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) best = post;
    // A tie on the day goes to whichever was written last, so two memories from the same
    // afternoon land on the newer one.
    else if (a === b && pbTime(post.created) > pbTime(best.created)) best = post;
  }
  return best;
}

/**
 * The whole notification, from a page of posts.
 *
 * @param {object[]} posts newest-created first, with `expand.author`
 * @param {number} now epoch ms
 * @returns {{title: string, body: string, postId: string|null, count: number}}
 */
function notification(posts, now) {
  const batch = batchOf(posts, now);
  const target = landingPost(batch);

  // NOBODY IS NAMED when several arrived. Two people posting in the same evening is not
  // one person's news, and "Alex and 2 others" is both clumsy and a small privacy leak on
  // a lock screen anyone can read. One post is different: knowing who it was IS the news.
  if (batch.length > 1) {
    return {
      title: 'Finnbook',
      body: `${batch.length} new memories were added.`,
      postId: target ? target.id : null,
      count: batch.length,
    };
  }

  const who = batch.length === 1 ? authorName(batch[0]) : null;
  return {
    title: 'Finnbook',
    // The fallback is not a failure: an author can be missing because the expand was not
    // returned, and "A new memory was added." is true either way.
    body: who ? `${who} added a new memory.` : 'A new memory was added.',
    postId: target ? target.id : null,
    count: batch.length,
  };
}

/** Where tapping it should open. */
function landingUrl(postId) {
  return postId ? `/?post=${encodeURIComponent(postId)}` : '/';
}
// --- end shared ---

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
/**
 * Parse a multipart body by hand.
 *
 * A FALLBACK FOR `request.formData()`, which throws on Android for shares it ought to
 * handle — confirmed in the container, where a well-formed multipart body with no parts
 * raises a TypeError rather than returning an empty form. When it throws there is no way
 * to tell from the error whether anything useful arrived, and the files are lost either
 * way. Reading the bytes ourselves is the only answer that does not depend on it.
 *
 * Deliberately INLINE rather than a module of its own: a file the worker importScripts
 * must also be copied into the image, and forgetting that once stopped every device from
 * updating for ten days. Nothing new to ship, nothing new to forget.
 *
 * @returns {{name: string, type: string, bytes: Uint8Array}[]} the parts that carry files
 */
function parseMultipart(bytes, contentType) {
  const found = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!found) return [];
  const boundary = `--${(found[1] || found[2]).trim()}`;

  const encoder = new TextEncoder();
  const marker = encoder.encode(boundary);
  const at = (i, seq) => {
    for (let j = 0; j < seq.length; j += 1) if (bytes[i + j] !== seq[j]) return false;
    return true;
  };

  // Boundaries are found by scanning, but the scan is anchored on `\r\n--` first: a bare
  // `-` is common in photo bytes and a naive byte-by-byte compare over several megabytes
  // is slow enough to matter on a phone.
  const starts = [];
  if (at(0, marker)) starts.push(0);
  const anchor = encoder.encode('\r\n--');
  for (let i = 0; i <= bytes.length - marker.length - 2; i += 1) {
    if (bytes[i] !== 13 || !at(i, anchor)) continue;
    if (at(i + 2, marker)) { starts.push(i + 2); i += marker.length; }
  }

  const parts = [];
  for (let k = 0; k < starts.length - 1; k += 1) {
    let from = starts[k] + marker.length;
    if (bytes[from] === 13 && bytes[from + 1] === 10) from += 2;   // the CRLF after it
    const to = starts[k + 1] - 2;                                   // drop the trailing CRLF
    if (to <= from) continue;

    // Headers end at a blank line. They are ASCII, so only that stretch is decoded.
    let split = -1;
    for (let i = from; i < to - 3; i += 1) {
      if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
        split = i; break;
      }
    }
    if (split < 0) continue;

    const head = new TextDecoder().decode(bytes.subarray(from, split));
    const disposition = /name="([^"]*)"/i.exec(head);
    const filename = /filename="([^"]*)"/i.exec(head);
    const type = /content-type:\s*([^\r\n]+)/i.exec(head);
    // Only file parts matter here; a plain text field has no filename.
    if (!disposition || !filename) continue;

    parts.push({
      field: disposition[1],
      name: filename[1] || 'shared',
      type: (type && type[1].trim()) || 'application/octet-stream',
      bytes: bytes.subarray(split + 4, to),
    });
  }
  return parts;
}

async function receiveShare(event, redirectTo) {
  let empty = 0;
  let sent = -1;   // -1 means the body could not be read as a form at all
  let why = '';
  let files = [];
  let threw = false;
  let bodyBytes = -1;

  // Cloned BEFORE anything reads the body: a body can only be read once, and what the
  // bytes contain is the only way to check what formData() claims about them.
  const probe = event.request.clone();

  try {
    const form = await event.request.formData();
    const offered = form.getAll('media').filter(Boolean);
    files = offered.filter((f) => f.size);
    // COUNTED, NOT JUST DROPPED. Android hands over a file with a name and a type but no
    // bytes when it cannot produce the content — the normal outcome for a Google Photos
    // item still in the cloud.
    empty = offered.length - files.length;
    sent = offered.length;

    if (!sent) {
      // Which fields WERE there. A form that reads fine but holds no `media` is otherwise
      // indistinguishable from a share that carried no photo, and a worker's console
      // cannot be opened on a phone.
      const seen = [];
      for (const key of form.keys()) if (!seen.includes(key)) seen.push(key);
      why = seen.length ? `fields:${seen.join('+')}` : 'empty-form';

      // Taken anyway, whatever field they arrived under: the name is ours to declare but
      // the sharing app's to honour. A FormData value is a string or a file.
      const anywhere = [];
      for (const value of form.values()) if (typeof value !== 'string') anywhere.push(value);
      if (anywhere.length) {
        files = anywhere.filter((f) => f.size);
        empty = anywhere.length - files.length;
        sent = anywhere.length;
        why += '.taken-anyway';
      }
    }
  } catch (err) {
    console.warn('share: formData failed; the bytes will be read directly:', err);
    why = (err && err.name) || 'error';
    threw = true;
  }

  // THE BYTES, when the form yielded nothing — whether it threw or simply came back empty.
  //
  // An empty form is not proof of an empty body. formData() on Android already misreports
  // a share once: it throws on a body with no parts rather than returning an empty form.
  // So before believing that Chrome sent nothing, the body is parsed directly. If the photo
  // is in there, this is where it is found.
  if (!files.length) {
    try {
      const type = probe.headers.get('content-type') || '';
      const raw = new Uint8Array(await probe.arrayBuffer());
      bodyBytes = raw.length;
      if (threw) why += `.${raw.length}b.${(type || 'none').split(';')[0]}`;

      const all = parseMultipart(raw, type);
      const named = all.filter((part) => part.field === 'media');
      const parts = named.length ? named : all;
      if (!named.length && all.length) why += '.taken-anyway';
      const carried = parts.filter((part) => part.bytes.length);
      if (parts.length) {
        sent = parts.length;
        empty = parts.length - carried.length;
      }
      if (carried.length) {
        files = carried.map((part) => new File([part.bytes], part.name, { type: part.type }));
        why += threw ? '.recovered' : '.rescued-from-bytes';
      }
    } catch {
      why += '.bytes-unreadable';
    }
  }

  try {
    const cache = await caches.open(SHARE_CACHE);
    // Cleared even when nothing new arrived: a share that was never opened should not turn
    // up attached to this one.
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
    console.warn('share: could not stash the files:', err);
    why = why ? `${why}.unstashable` : 'unstashable';
    files = [];
  }

  // TEMPORARY, AGAIN. Removed once sharing worked; restored because it did not work for
  // everyone. One phone shares fine and another reports empty-form on the same worker, the
  // same manifest and the same WebAPK — so the question is no longer "what happens" but
  // "what do these two devices differ in", and that is what this line carries.
  try {
    await fetch('/share-debug', {
      method: 'POST',
      body: JSON.stringify({
        at: 'worker',
        sent, empty, why, threw, bodyBytes,
        stashed: files.length,
        method: event.request.method,
        // The boundary format is part of this: it is Chrome's own, and it differs between
        // Chrome versions, which is one of the few things that can differ here.
        contentType: event.request.headers.get('content-type') || null,
        ua: (self.navigator && self.navigator.userAgent || '').slice(0, 160),
      }),
      headers: { 'content-type': 'application/json' },
    });
  } catch { /* a diagnostic must never break the thing it is watching */ }

  // Carried on the URL rather than in the cache: it has to survive even when nothing was
  // stashed, which is exactly the case worth reporting.
  const target = `${redirectTo}&sent=${sent}&unreadable=${empty}`
    + (why ? `&why=${encodeURIComponent(why)}` : '');
  return Response.redirect(target, 303);
}

/**
 * A photo, from the cache if it is there.
 *
 * CACHE FIRST, which is the opposite of everything else this worker does — and safe for
 * the same reason the rest is not. A PocketBase file URL contains a filename generated at
 * upload, so the bytes never change; there is no stale version to be served. The app's own
 * code is network-first precisely because it DOES change.
 *
 * Only images are kept. A video arrives in ranges and is far too big to hold.
 */
async function serveMedia(request) {
  let cache = null;
  try {
    cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch {
    return fetch(request);   // no storage available; the network still works
  }

  const response = await fetch(request);
  const type = response.headers.get('content-type') || '';
  // 200 only: a 206 is a piece of something, and a 404 cached is a photo that never comes
  // back. Images only, for the reason above.
  if (response.status === 200 && type.startsWith('image/')) {
    try {
      await cache.put(request, response.clone());
      await trimMedia(cache);
    } catch { /* quota, private mode — the photo still loads */ }
  }
  return response;
}

/** Keep the photo cache from growing without end. */
async function trimMedia(cache) {
  const keys = await cache.keys();
  if (keys.length <= MEDIA_LIMIT) return;
  // Oldest first: cache.keys() returns them in insertion order, and the oldest photo is
  // the one furthest down a timeline nobody is scrolling.
  for (const old of keys.slice(0, keys.length - MEDIA_LIMIT)) await cache.delete(old);
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

  // Photos: served from the cache when they are in it, because the bytes behind a file URL
  // never change. A range request is left alone — that is video seeking, and answering it
  // with a whole file breaks it.
  if (url.pathname.startsWith('/api/files/') && !request.headers.has('range')) {
    event.respondWith(serveMedia(request));
    return;
  }
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
async function session() {
  try {
    const hit = await caches.open(AUTH_CACHE).then((c) => c.match(AUTH_KEY));
    if (!hit) return null;
    const body = (await hit.text()) || '';
    if (!body) return null;
    try {
      const parsed = JSON.parse(body);
      return parsed && parsed.token ? { token: parsed.token, apiBase: parsed.apiBase || '' } : null;
    } catch {
      // A bare token, written by a version of the page from before the base was included.
      // Devices keep this until the app is next opened, and same-origin is the right guess
      // for the only place that matters — production serves both from one origin.
      return { token: body, apiBase: '' };
    }
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
  const who = await session();
  if (!who) return null;
  try {
    // The base comes from the page, which already had to work it out. Hardcoding a
    // same-origin path here was right in production and wrong in development, where the
    // request reached the static file server instead and came back 404 — so every
    // notification lost its author and its deep link, for a reason nothing reported.
    const res = await fetch(
      `${who.apiBase}/api/collections/posts/records?perPage=10&sort=-created&expand=author`,
      { headers: { Authorization: who.token }, cache: 'no-store' },
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
