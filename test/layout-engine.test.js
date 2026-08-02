// The layout engine is the heart of the product: it decides every card's shape with
// no user input and no override. These tests pin the rules from CLAUDE.md exactly.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inferLayout, isMilestone } from '../js/layout-engine.js';

/** A photo is only ever consulted for its stored dimensions. */
const photo = (width, height) => ({ id: 'x', url: 'x.jpg', width, height, alt: null });

test('rule 1 — no photos + a caption is a quote card', () => {
  assert.equal(inferLayout({ caption: 'Every little thing you do is magic.', photos: [] }), 'quote');
});

test('rule 1 — no photos and no caption has nothing to render', () => {
  assert.equal(inferLayout({ caption: null, photos: [] }), null);
  assert.equal(inferLayout({ caption: '', photos: [] }), null);
  assert.equal(inferLayout({ caption: '   \n  ', photos: [] }), null, 'whitespace is not a caption');
});

test('rule 2 — one photo taller than it is wide is portrait', () => {
  assert.equal(inferLayout({ photos: [photo(900, 1200)] }), 'portrait');
});

test('rule 3 — one photo at least as wide as it is tall is landscape', () => {
  assert.equal(inferLayout({ photos: [photo(1200, 800)] }), 'landscape');
});

test('rule 3 — a square photo is landscape, since the rule is width >= height', () => {
  assert.equal(inferLayout({ photos: [photo(800, 800)] }), 'landscape');
});

test('rule 4 — two to four photos is a grid', () => {
  for (const count of [2, 3, 4]) {
    const photos = Array.from({ length: count }, () => photo(800, 800));
    assert.equal(inferLayout({ photos }), 'grid', `${count} photos`);
  }
});

test('rule 4 — more than four photos is still a grid (the renderer caps at four)', () => {
  assert.equal(inferLayout({ photos: Array.from({ length: 7 }, () => photo(800, 800)) }), 'grid');
});

test('a caption never overrides a photo layout', () => {
  assert.equal(inferLayout({ caption: 'Tiny yawns.', photos: [photo(900, 1200)] }), 'portrait');
});

test('rule 5 — milestone is orthogonal and leaves the base layout untouched', () => {
  const post = { caption: 'First steps!', photos: [photo(900, 1200)], milestone: { isMilestone: true, title: 'First steps' } };
  assert.equal(inferLayout(post), 'portrait');
  assert.equal(isMilestone(post), true);
});

test('milestone is false for ordinary posts', () => {
  assert.equal(isMilestone({ milestone: null }), false);
  assert.equal(isMilestone({}), false);
  assert.equal(isMilestone({ milestone: { isMilestone: false } }), false);
});

test('a missing photos array is treated as no photos', () => {
  assert.equal(inferLayout({ caption: 'hi' }), 'quote');
  assert.equal(inferLayout({}), null);
});

test('the engine is pure — it does not mutate the post it is given', () => {
  const post = { caption: 'hi', photos: [photo(900, 1200)], milestone: null };
  const before = JSON.stringify(post);
  inferLayout(post);
  isMilestone(post);
  assert.equal(JSON.stringify(post), before);
});
