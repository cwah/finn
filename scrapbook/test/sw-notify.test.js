// What the lock screen says, and where tapping it lands.
//
//   npm test
//
// The module under test is the one the service worker actually loads — required here
// through createRequire, importScripts'd there — so what ships is what was tested. The
// same arrangement as notify-rule.js, for the same reason: two copies of a rule drift, and
// this drift would arrive as wrong words on a lock screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Loaded the way importScripts loads it — evaluated into a global scope — rather than
// through require(). That is what the service worker actually does, and it is also the
// only thing that works: this file lives inside a "type": "module" package, so require()
// would treat it as ESM and its CommonJS export guard would never run. Testing it the way
// it is really loaded avoids both problems at once.
const ctx = createContext({ Date, Number, String, Math, JSON, encodeURIComponent, console });
// `function` declarations become properties of the global object; `const` does not. The
// worker only needs the functions, so the constant is published explicitly — from INSIDE
// the same script, which is the only scope that can see it.
runInContext(
  `${readFileSync(new URL('../sw-notify.js', import.meta.url), 'utf8')}
   this.BATCH_MINUTES = BATCH_MINUTES;`,
  ctx, { filename: 'sw-notify.js' },
);
const { notification, landingPost, landingUrl, BATCH_MINUTES } = ctx;

const NOW = Date.parse('2026-09-01T12:00:00Z');
const MIN = 60 * 1000;
/** PocketBase's own timestamp shape, which is NOT ISO — note the space. */
const pb = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '.000Z');

const post = (over = {}) => ({
  id: 'p1',
  created: pb(NOW - 2 * MIN),
  memoryDate: pb(NOW),
  notifiedAt: pb(NOW - MIN),
  expand: { author: { id: 'u1', name: 'Alex' } },
  ...over,
});

// ── One post ──────────────────────────────────────────────────────

test('one new memory names who added it', () => {
  const n = notification([post()], NOW);
  assert.equal(n.body, 'Alex added a new memory.');
  assert.equal(n.count, 1);
});

test('an author with no name falls back to their email', () => {
  const n = notification([post({ expand: { author: { email: 'sam@example.com' } } })], NOW);
  assert.equal(n.body, 'sam@example.com added a new memory.');
});

test('no author at all still says something true', () => {
  // The expand can simply not come back — PocketBase omits it when the relation is empty
  // or the field was not requested. That is not a reason to show nothing.
  const bare = { id: 'p1', created: pb(NOW - 2 * MIN), memoryDate: pb(NOW), notifiedAt: pb(NOW - MIN) };
  for (const missing of [{ ...bare, expand: {} }, { ...bare, expand: { author: null } }, bare]) {
    const n = notification([missing], NOW);
    assert.equal(n.body, 'A new memory was added.', JSON.stringify(missing.expand));
  }
});

test('a blank name is treated as no name, not as an empty one', () => {
  const n = notification([post({ expand: { author: { name: '   ', email: '' } } })], NOW);
  assert.equal(n.body, 'A new memory was added.');
});

// ── Several posts ─────────────────────────────────────────────────

test('several new memories name NOBODY', () => {
  // Two people posting in one evening is not one person's news, and "Alex and 2 others"
  // is a small privacy leak on a screen anyone walking past can read.
  const n = notification([
    post({ id: 'a', expand: { author: { name: 'Alex' } } }),
    post({ id: 'b', expand: { author: { name: 'Sam' } } }),
  ], NOW);
  assert.equal(n.body, '2 new memories were added.');
  assert.doesNotMatch(n.body, /Alex|Sam/);
});

test('the count is of what was ANNOUNCED, not of what was fetched', () => {
  // The fetch returns a page of recent posts; only the ones this push is about count.
  const n = notification([
    post({ id: 'a' }),
    post({ id: 'b' }),
    post({ id: 'old1', notifiedAt: pb(NOW - 60 * MIN) }),
    post({ id: 'old2', notifiedAt: '' }),
  ], NOW);
  assert.equal(n.count, 2);
});

test('the batch window is what it says it is', () => {
  const justInside = notification([post({ notifiedAt: pb(NOW - (BATCH_MINUTES - 1) * MIN) })], NOW);
  assert.equal(justInside.count, 1);
  assert.equal(justInside.body, 'Alex added a new memory.');
});

// ── Where it lands ────────────────────────────────────────────────

test('tapping lands on the post itself', () => {
  const n = notification([post({ id: 'abc123' })], NOW);
  assert.equal(n.postId, 'abc123');
  assert.equal(landingUrl(n.postId), '/?post=abc123');
});

test('with several, it lands on the newest MEMORY DATE, not the newest post', () => {
  // THE POINT OF THE DEEP LINK. Memory date is where the card sits in the timeline. A post
  // written last (newest `created`) but backdated to June is a long way down the page, and
  // landing there is not where anyone wants to be sent.
  const n = notification([
    post({ id: 'written-last', created: pb(NOW), memoryDate: pb(Date.parse('2026-06-01T12:00:00Z')) }),
    post({ id: 'today', created: pb(NOW - 5 * MIN), memoryDate: pb(NOW) }),
  ], NOW);
  assert.equal(n.postId, 'today');
});

test('same memory date falls back to whichever was written last', () => {
  const day = pb(Date.parse('2026-08-30T12:00:00Z'));
  const n = notification([
    post({ id: 'earlier', memoryDate: day, created: pb(NOW - 9 * MIN) }),
    post({ id: 'later', memoryDate: day, created: pb(NOW - 1 * MIN) }),
  ], NOW);
  assert.equal(n.postId, 'later');
});

test('a post with an unreadable memory date does not win', () => {
  const n = notification([
    post({ id: 'broken', memoryDate: 'whenever' }),
    post({ id: 'good', memoryDate: pb(NOW) }),
  ], NOW);
  assert.equal(n.postId, 'good');
});

// ── Degrading ─────────────────────────────────────────────────────

test('nothing announced falls back to the newest post', () => {
  // A push ARRIVED, so something happened. A browser shown no notification eventually
  // invents its own — "this site was updated in the background" — which is worse than
  // vague, because it is vague AND clearly not ours.
  const n = notification([
    post({ id: 'newest', notifiedAt: '' }),
    post({ id: 'older', notifiedAt: '' }),
  ], NOW);
  assert.equal(n.count, 1);
  assert.equal(n.postId, 'newest', 'the fetch is sorted newest-created first');
});

test('no posts at all still yields a showable notification', () => {
  for (const empty of [[], null, undefined]) {
    const n = notification(empty, NOW);
    assert.equal(n.title, 'Finnbook');
    assert.equal(n.body, 'A new memory was added.');
    assert.equal(n.postId, null);
    assert.equal(landingUrl(n.postId), '/');
  }
});

test('a post id is escaped into the url', () => {
  assert.equal(landingUrl('a b&c'), '/?post=a%20b%26c');
});

test('landingPost of nothing is nothing', () => {
  assert.equal(landingPost([]), null);
});

test('PocketBase timestamps parse — they are not ISO', () => {
  // "2026-09-01 12:00:00.000Z" has a space where ISO has a T. Reading these with a bare
  // Date() has already gone wrong once in this project.
  const n = notification([post({ notifiedAt: '2026-09-01 11:59:00.000Z' })], NOW);
  assert.equal(n.count, 1);
});
