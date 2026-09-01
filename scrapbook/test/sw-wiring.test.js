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

test('the worker loads the shared wording module', () => {
  // A second copy of these rules would drift, and the drift arrives as wrong words on a
  // lock screen — the one place nobody is looking at the code.
  assert.match(sw, /importScripts\('\/sw-notify\.js'\)/);
});

test('everything the worker calls from that module is defined there', () => {
  // importScripts puts FUNCTION declarations on the global scope — and only those. A
  // `const` would not be reachable, and the failure is a ReferenceError inside a push
  // handler, which is exactly where nobody sees it.
  for (const fn of ['notification', 'landingUrl']) {
    assert.match(sw, new RegExp(`\\b${fn}\\(`), `sw.js should call ${fn}`);
    assert.match(notify, new RegExp(`^function ${fn}\\(`, 'm'),
      `${fn} must be a function declaration, or importScripts will not expose it`);
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
