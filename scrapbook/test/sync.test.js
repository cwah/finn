// Picking up memories added elsewhere while the scrapbook is open. The timeline is paged
// newest-first, so "what is safe to insert right now" has a sharp edge: a post older than
// anything on screen belongs in a page that has not been fetched yet.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickNewPosts, oldestDate, insertionIndex, pickUnseen } from '../js/sync.js';

const post = (id, memoryDate) => ({ id, memoryDate });

/** The timeline holds these three, newest first. */
const loaded = [post('c', '2026-08-10'), post('b', '2026-08-05'), post('a', '2026-08-01')];
const known = new Map(loaded.map((p) => [p.id, p]));

const state = (over = {}) => ({
  known,
  oldestLoaded: '2026-08-01',
  hasMore: true,
  ...over,
});

test('a memory posted elsewhere is picked up', () => {
  const fresh = post('new', '2026-08-12');
  assert.deepEqual(pickNewPosts([fresh, ...loaded], state()), [fresh]);
});

test('what is already on screen is left alone', () => {
  // A post made in THIS tab comes back through the same fetch a moment later.
  assert.deepEqual(pickNewPosts(loaded, state()), []);
});

test('a post older than the timeline is left to paging', () => {
  // Inserting it now would put it ABOVE the older posts that have not loaded yet, and
  // the next page would then arrive underneath it out of order.
  const backdated = post('old', '2026-07-20');
  assert.deepEqual(pickNewPosts([backdated], state()), []);
});

test('once everything is loaded there is no page below, so anything may be placed', () => {
  const backdated = post('old', '2026-07-20');
  assert.deepEqual(pickNewPosts([backdated], state({ hasMore: false })), [backdated]);
});

test('a post sharing the oldest loaded date still belongs on screen', () => {
  // The boundary is inclusive: that date is already represented in the timeline.
  const sameDay = post('same', '2026-08-01');
  assert.deepEqual(pickNewPosts([sameDay], state()), [sameDay]);
});

test('a backdated post that still falls inside the timeline is picked up', () => {
  const between = post('mid', '2026-08-07');
  assert.deepEqual(pickNewPosts([between], state()), [between]);
});

test('an empty timeline takes whatever arrives', () => {
  const fresh = post('new', '2026-08-12');
  assert.deepEqual(
    pickNewPosts([fresh], { known: new Map(), oldestLoaded: null, hasMore: true }),
    [fresh],
  );
});

test('order is preserved, so the caller decides how to place them', () => {
  const a = post('n1', '2026-08-14');
  const b = post('n2', '2026-08-13');
  assert.deepEqual(pickNewPosts([a, b], state()), [a, b]);
});

test('junk in, nothing out — never an exception', () => {
  assert.deepEqual(pickNewPosts(null, state()), []);
  assert.deepEqual(pickNewPosts(undefined, state()), []);
  assert.deepEqual(pickNewPosts([null, undefined, {}], state()), []);
  assert.deepEqual(pickNewPosts([post('x', '2026-08-12')], {}), [post('x', '2026-08-12')]);
});

// ── The boundary itself ───────────────────────────────────────────
test('the oldest date on screen is found whatever order posts come in', () => {
  assert.equal(oldestDate(loaded), '2026-08-01');
  assert.equal(oldestDate([...loaded].reverse()), '2026-08-01');
});

test('nothing on screen has no oldest date', () => {
  assert.equal(oldestDate([]), null);
  assert.equal(oldestDate(null), null);
  assert.equal(oldestDate([{}, null]), null);
});

test('it reads a Map’s values, which is what the timeline actually holds', () => {
  assert.equal(oldestDate(known.values()), '2026-08-01');
});

// ── Where a card goes ─────────────────────────────────────────────
// The timeline runs newest first. These pin the ORDER rule that paging and insertion now
// share; appending blindly was right only for as long as pages arrived in order.

test('a memory newer than everything goes to the top', () => {
  assert.equal(insertionIndex(['2026-07-14', '2026-06-01'], '2026-08-01'), 0);
});

test('a memory older than everything is appended', () => {
  assert.equal(insertionIndex(['2026-07-14', '2026-06-01'], '2026-05-01'), 2);
});

test('a backdated memory lands between the two it belongs between', () => {
  assert.equal(insertionIndex(['2026-07-14', '2026-06-30', '2026-06-01'], '2026-06-17'), 2);
});

test('a memory joins the END of its own day, not the front', () => {
  // Same date is neither older nor newer, so it follows the ones already there — which is
  // the order they were added in.
  assert.equal(insertionIndex(['2026-07-14', '2026-07-14', '2026-06-01'], '2026-07-14'), 2);
});

test('an empty timeline takes anything at position 0', () => {
  assert.equal(insertionIndex([], '2026-07-14'), 0);
  assert.equal(insertionIndex(null, '2026-07-14'), 0);
});

test('cards with no date are stepped over, never treated as older', () => {
  // A card the renderer gave no date is not evidence of anything; placing a memory above
  // it on that basis would put it in the wrong decade as easily as the wrong week.
  assert.equal(insertionIndex([null, '2026-06-01'], '2026-07-01'), 1);
});

// ── A page, minus what is already showing ─────────────────────────

test('a page already on screen adds nothing', () => {
  const known = new Map([['a', 1], ['b', 1]]);
  assert.deepEqual(pickUnseen([{ id: 'a' }, { id: 'b' }], known), []);
});

test('the shifted page keeps only what is genuinely new', () => {
  // THE BUG. A backdated post pushes every row below it down one, so the next page hands
  // back a card already displayed — appended a second time, that is the duplicate.
  const known = new Map([['new', 1], ['p3', 1]]);
  assert.deepEqual(
    pickUnseen([{ id: 'new' }, { id: 'p2' }, { id: 'p1' }], known).map((p) => p.id),
    ['p2', 'p1'],
  );
});

test('order is preserved, and junk is dropped', () => {
  const known = new Map();
  assert.deepEqual(
    pickUnseen([{ id: 'x' }, null, {}, { id: 'y' }], known).map((p) => p.id),
    ['x', 'y'],
  );
});

test('nothing in, nothing out', () => {
  assert.deepEqual(pickUnseen(null, new Map()), []);
  assert.deepEqual(pickUnseen([{ id: 'a' }], null), [{ id: 'a' }]);
});
