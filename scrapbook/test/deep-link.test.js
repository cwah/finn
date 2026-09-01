// Landing on one particular memory.
//
//   npm test
//
// The loop here is the dangerous part: "keep loading until you find it" is a request to
// load the entire scrapbook whenever the id is wrong — deleted, mistyped, or a post this
// account cannot see. On a phone, on mobile data, woken by a notification.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wantedPost, pageUntilFound, MAX_PAGES } from '../js/deep-link.js';

/** A timeline that reveals one more post per page, in a fixed order. */
function timeline(ids, { pageSize = 5 } = {}) {
  let shown = 0;
  let calls = 0;
  return {
    calls: () => calls,
    has: (id) => ids.slice(0, shown).includes(id),
    hasMore: () => shown < ids.length,
    loadMore: async () => { calls += 1; shown = Math.min(shown + pageSize, ids.length); },
    reveal: (n) => { shown = n; },
  };
}

// ── Reading the url ───────────────────────────────────────────────

test('a post id is read out of the query string', () => {
  assert.equal(wantedPost('/?post=abc123'), 'abc123');
  assert.equal(wantedPost('https://finn.example.com/?post=abc123&x=1'), 'abc123');
});

test('no post asked for is null, not empty string', () => {
  for (const url of ['/', '/?other=1', '/?post=', '', null, undefined, 'not a url']) {
    assert.equal(wantedPost(url), null, JSON.stringify(url));
  }
});

test('an escaped id comes back decoded', () => {
  assert.equal(wantedPost('/?post=a%20b'), 'a b');
});

// ── Finding the card ──────────────────────────────────────────────

test('a post already on screen needs no loading at all', () => {
  const t = timeline(['a', 'b', 'c']);
  t.reveal(3);
  return pageUntilFound('a', t).then((found) => {
    assert.equal(found, true);
    assert.equal(t.calls(), 0, 'must not fetch what is already there');
  });
});

test('it pages until the post appears, and no further', async () => {
  // Twelve posts, five per page: the twelfth is on the third page.
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const t = timeline(ids);
  assert.equal(await pageUntilFound('p11', t), true);
  assert.equal(t.calls(), 3);
});

test('a post far down is still reached', async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `p${i}`);
  const t = timeline(ids);
  assert.equal(await pageUntilFound('p99', t), true);
});

test('an id that is not there gives up instead of looping', async () => {
  // THE CASE THAT MATTERS. A deleted post, a stale notification, an id from an account
  // that can see something this one cannot.
  const t = timeline(['a', 'b', 'c']);
  assert.equal(await pageUntilFound('nope', t), false);
  assert.ok(t.calls() <= 1, `stopped once the timeline ran out, took ${t.calls()}`);
});

test('a timeline that never ends is still bounded', async () => {
  // A server that always says "there is more" must not turn a bad id into an endless
  // download. This is the bound doing its job.
  let calls = 0;
  const endless = {
    has: () => false,
    hasMore: () => true,
    loadMore: async () => { calls += 1; },
  };
  assert.equal(await pageUntilFound('never', endless), false);
  assert.equal(calls, MAX_PAGES);
});

test('no id asked for does nothing', async () => {
  const t = timeline(['a']);
  assert.equal(await pageUntilFound(null, t), false);
  assert.equal(t.calls(), 0);
});

test('it does not ask for a page the timeline says is not there', async () => {
  const t = { has: () => false, hasMore: () => false, loadMore: async () => { throw new Error('asked anyway'); } };
  assert.equal(await pageUntilFound('x', t), false);
});

test('the post arriving on the very last page is still found', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const t = timeline(ids);
  assert.equal(await pageUntilFound('p9', t), true);
});
