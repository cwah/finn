// The seams between the page, the worker, and the shared rules.
//
//   npm test
//
// None of this can be executed here — a service worker needs a browser — so what is
// checked is that the two sides AGREE. Every item below is a pair of literals in separate
// files, and every one of them fails silently when they drift: the notification simply
// falls back to its plain wording, on someone's phone, with nothing logged anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const sw = read('../sw.js');
const token = read('../js/sw-token.js');
const app = read('../js/app.js');
const notify = read('../sw-notify.js');

/** The string assigned to a name, e.g. const FOO = 'bar'. */
const literal = (src, name) => (src.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`)) || [])[1];

test('the worker asks the API where the page says it is', () => {
  // THE BUG THE EMULATOR FOUND. The worker fetched `/api/...` same-origin, which is right
  // in production — PocketBase serves the page and the API together — and wrong in
  // development, where the frontend is on serve.py's port and PocketBase is on 8090. The
  // request reached the static file server, came back 404, and every notification lost its
  // author and its deep link with nothing reporting why. The page already solves this in
  // resolveApiBase; the worker is handed the answer rather than guessing it again.
  assert.match(sw, /\$\{who\.apiBase\}\/api\/collections\/posts/);
  assert.doesNotMatch(sw, /fetch\(\s*'\/api\/collections/,
    'a hardcoded same-origin API path is the bug');
  assert.match(read('../js/pb.js'), /publishToken\([^)]*apiUrl\(\)\)/);
});

test('a token cached in the old bare format still works', () => {
  // Devices keep whatever the previous version wrote until the app is next opened. If the
  // worker only understood the new shape, those devices would lose their author line at
  // the exact moment this was meant to fix it.
  assert.match(sw, /A bare token, written by a version of the page/);
  assert.match(sw, /return \{ token: body, apiBase: '' \}/);
});

test('the page and the worker agree on where the token is kept', () => {
  // A worker cannot read localStorage, so the Cache API is the only channel. Two spellings
  // of the cache name means the worker finds nothing and every push loses its detail.
  assert.equal(literal(sw, 'AUTH_CACHE'), literal(token, 'CACHE'));
  assert.equal(literal(sw, 'AUTH_KEY'), literal(token, 'KEY'));
  assert.ok(literal(sw, 'AUTH_CACHE'), 'the names must actually be found');
});

test('the auth cache survives a version bump', () => {
  // THE BUG THIS CAUGHT. `activate` deletes every cache that is not the current version.
  // The auth cache is not versioned — it holds the person's session, not the build — so
  // the sweep would have thrown the token away on every deploy, and every notification
  // until the app was next opened would have quietly lost its author and its deep link.
  assert.match(sw, /const KEEP = \[/);
  assert.match(sw, /!KEEP\.includes\(n\)/);
  const keep = (sw.match(/const KEEP = \[([^\]]*)\]/) || [])[1] || '';
  assert.match(keep, /AUTH_CACHE/);
  assert.match(keep, /SHARE_CACHE/);
});

test('the worker carries its wording itself, with nothing to import', () => {
  // This used to assert the OPPOSITE — that sw.js importScripts'd the wording module — and
  // it was written to catch that file going missing from the image, which it had, for ten
  // days. Inlining removes the failure instead of guarding it: a share arrives as a
  // navigation POST, which starts the worker from scratch, and every top-level import is
  // something that has to be fetched and evaluated before the fetch handler exists at all.
  assert.doesNotMatch(sw, /^\s*importScripts\(/m);
  for (const fn of ['notification', 'landingUrl', 'landingPost', 'batchOf']) {
    assert.match(sw, new RegExp(`^function ${fn}\\(`, 'm'), `${fn} must be defined in sw.js`);
  }
});

test('the deep link the worker builds is the one the app reads', () => {
  // landingUrl writes `?post=`; wantedPost reads it. Two different query names would leave
  // every tap at the top of the timeline, which is precisely what the deep link exists to
  // stop, and it would look like the feature simply does nothing.
  assert.match(notify, /\?post=\$\{encodeURIComponent/);
  assert.match(read('../js/deep-link.js'), /searchParams\.get\('post'\)/);
});

test('the app listens for the message a focused tab gets', () => {
  // A tab that is already open does not reload, so it never reads a query string. The
  // worker posts to it instead, and both ends have to use the same message type.
  assert.match(sw, /postMessage\(\{ type: 'show-post', url \}\)/);
  assert.match(app, /e\.data\?\.type !== 'show-post'/);
});

test('the token is published wherever the session changes', () => {
  // persist() is the single funnel for a token in pb.js. Publishing anywhere else would
  // miss the refresh that happens on every load.
  const pb = read('../js/pb.js');
  assert.match(pb, /function persist\(next\) \{[\s\S]*?publishToken\(/);
});

test('and again on load, not only when it changes', () => {
  // A device whose refresh fails — offline, a flaky morning — would otherwise never seed
  // the cache the worker reads, and every notification on it would fall back to wording
  // with no author and no deep link. "Open the app once" has to actually be enough.
  const pb = read('../js/pb.js');
  assert.match(pb, /let auth = load\(\);[\s\S]{0,600}?publishToken\(auth\?\.token/);
});

test('the worker is re-registered on every load, so an update is noticed', () => {
  // A push arriving on a device that has not opened the app since a deploy runs the OLD
  // worker, with the old wording. register() on an existing registration is what asks the
  // browser to compare the script; updateViaCache:'none' stops the HTTP cache answering
  // that question with yesterday's copy.
  const pwa = read('../js/pwa.js');
  assert.match(pwa, /updateViaCache: 'none'/);
});

test('deep linking cannot take the app down', () => {
  // Paging to a card is a convenience. A scrapbook that would not open because a
  // notification pointed at a deleted post would be a poor trade.
  assert.match(app, /optional\('deep link'/);
});

test('the query is cleared once used', () => {
  // Otherwise a reload scrambles down the page again, and the url a person might share
  // carries a post id that means nothing to anyone else.
  assert.match(app, /history\.replaceState\(null, '', location\.pathname\)/);
});

// ── Photos are cached; the JSON beside them is not ────────────────
// Bandwidth became the binding constraint. The worker deliberately never touched /api/,
// for two reasons that do not apply equally: auth tokens and post JSON are MUTABLE and a
// stale copy would show deleted memories — but a PocketBase file URL carries a filename
// generated at upload, so the bytes at that URL never change. That difference is what
// makes caching one safe and the other not, and the split has to stay exactly there.

test('photo files are served from the cache', () => {
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/files\/'\)/);
  assert.match(sw, /async function serveMedia/);
});

test('the JSON API is still never cached', () => {
  // The whole reason /api/ was excluded. A cached posts list would show memories that
  // were deleted.
  assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return;/);
  assert.doesNotMatch(sw, /startsWith\('\/api\/collections\/'\)[\s\S]{0,80}cache\.put/);
});

test('a range request is left alone, so video seeking still works', () => {
  // Answering a range with a whole cached file breaks scrubbing.
  assert.match(sw, /!request\.headers\.has\('range'\)/);
});

test('only whole images are kept', () => {
  // A 206 is a piece of something; a cached 404 is a photo that never comes back.
  assert.match(sw, /response\.status === 200 && type\.startsWith\('image\/'\)/);
});

test('the photo cache is bounded', () => {
  // A family scrapbook grows without limit, and a cache that grew with it would fill a
  // phone.
  assert.match(sw, /MEDIA_LIMIT/);
  assert.match(sw, /async function trimMedia/);
});

test('the photo cache survives a deploy', () => {
  // The app shell is versioned because it changes; these files never do, and re-fetching
  // every photo on every deploy is the bandwidth this was meant to save.
  const keep = (sw.match(/const KEEP = \[([^\]]*)\]/) || [])[1] || '';
  assert.match(keep, /MEDIA_CACHE/);
});

test('the server tells browsers the files never change', () => {
  const hook = readFileSync(new URL('../../deploy/pb_hooks/cache.pb.js', import.meta.url), 'utf8');
  assert.match(hook, /path\.startsWith\('\/api\/files\/'\)/);
  assert.match(hook, /immutable/);
  // `private`: a family's photographs have no business in a shared cache between here and
  // the phone.
  assert.match(hook, /'private, max-age=\d+, immutable'/);
});

test('code is still revalidated, or a stale module breaks sign-in again', () => {
  const hook = readFileSync(new URL('../../deploy/pb_hooks/cache.pb.js', import.meta.url), 'utf8');
  assert.match(hook, /Cache-Control', 'no-cache'/);
});
