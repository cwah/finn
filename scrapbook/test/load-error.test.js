// Which failure a parent is told about.
//
//   npm test
//
// THE BUG. `pb.refresh()` returns null on a 401 — a stale token, handled, sign-in screen —
// and RETHROWS everything else. A fetch() that never reached the server rejects with a
// plain TypeError, which is not a 401 and not a PbError, so it went up through
// requireSession() and ensureSignedIn() into init().catch(), which said "Could not load
// memories." A redeploy takes the server away for a window; every scrapbook loading inside
// that window said the memories could not be loaded, which reads like they are gone.
//
// signIn() had always distinguished the two ("Cannot reach the scrapbook server"). The
// startup path never did.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isUnreachable, loadMessage, canRetry } from '../js/load-error.js';

/** What pb.js throws when PocketBase answers with a status. */
const pbError = (status) => Object.assign(new Error(`PocketBase said ${status}`), { status });

/** What fetch() rejects with when nothing answered. */
const networkError = () => new TypeError('Failed to fetch');

test('a fetch that never reached the server is unreachable', () => {
  assert.equal(isUnreachable(networkError()), true);
});

test('a server that answered is NOT unreachable, whatever it said', () => {
  for (const status of [400, 401, 403, 404, 500, 503]) {
    assert.equal(isUnreachable(pbError(status)), false, `status ${status}`);
  }
});

test('a 503 is the server answering, not the server being absent', () => {
  // Worth pinning: it is tempting to lump 5xx in with "down". It is not — the server is
  // there and talking, so "check your connection" would send someone the wrong way.
  assert.equal(isUnreachable(pbError(503)), false);
});

test('the unreachable message does not claim the memories failed to load', () => {
  const msg = loadMessage(networkError());
  assert.doesNotMatch(msg, /memor/i, 'must not imply the memories are the problem');
  assert.match(msg, /reach/i);
});

test('a real server error still says memories could not load', () => {
  assert.equal(loadMessage(pbError(500)), 'Could not load memories.');
});

test('retry is offered when another go might work, and not otherwise', () => {
  assert.equal(canRetry(networkError()), true);
  assert.equal(canRetry(pbError(500)), false);
});

test('junk thrown from anywhere is treated as unreachable', () => {
  // Nothing here should ever throw a bare string or undefined, but the catch is the last
  // thing standing between a parent and a blank page: it must not itself fall over.
  for (const junk of [undefined, null, 'boom', 0, {}, { status: 'nope' }]) {
    assert.equal(isUnreachable(junk), true, `for ${JSON.stringify(junk)}`);
    assert.equal(typeof loadMessage(junk), 'string');
  }
});
