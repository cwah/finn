// Handing the service worker a token it can use.
//
// A service worker CANNOT READ localStorage — the API simply is not there — and that is
// where the PocketBase session lives. So a worker woken by a push has no credentials, and
// the scrapbook has no public view: every read is authenticated.
//
// The Cache API is reachable from both sides, so the page leaves the current token there
// for the worker to find. Same origin, same browser profile, same lifetime as the session
// it came from — the exposure is the same class as localStorage, which already holds it.
//
// Written on every token change rather than once at sign-in: PocketBase re-issues the
// token on each `auth-refresh`, so a worker reading a stale one gets a 401 and shows the
// plain wording. That is a soft failure, but it is one worth not having every day.

const CACHE = 'finnbook-auth';
/** A path that is never fetched over the network — the cache is the only reader. */
const KEY = '/__session-token';

/** Leave the token where the worker can find it, or clear it on sign-out. */
export async function publishToken(token) {
  if (typeof caches === 'undefined') return; // no Cache API, so no deep detail in pushes
  try {
    const cache = await caches.open(CACHE);
    if (token) await cache.put(KEY, new Response(token, { headers: { 'Content-Type': 'text/plain' } }));
    else await cache.delete(KEY);
  } catch {
    // A private window, a browser with site data disabled, a quota refusal. The
    // notification falls back to wording that needs no fetch; nothing else depends on it.
  }
}

export const TOKEN_CACHE = CACHE;
export const TOKEN_KEY = KEY;
