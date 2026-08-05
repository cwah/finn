// The layout engine is the heart of the product: it decides every card's shape with
// no user input and no override. These tests pin the rules from CLAUDE.md exactly.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inferLayout, isMilestone, GRID_MAX, carouselAspect } from '../js/layout-engine.js';

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

test('rule 5 — more than four photos becomes a carousel, not a cramped grid', () => {
  for (const count of [5, 7, 20]) {
    const photos = Array.from({ length: count }, () => photo(800, 800));
    assert.equal(inferLayout({ photos }), 'carousel', `${count} photos`);
  }
});

test('the grid/carousel boundary sits exactly at GRID_MAX', () => {
  const make = (n) => ({ photos: Array.from({ length: n }, () => photo(800, 800)) });
  assert.equal(inferLayout(make(GRID_MAX)), 'grid');
  assert.equal(inferLayout(make(GRID_MAX + 1)), 'carousel');
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

test('a carousel of one orientation takes exactly that shape', () => {
  assert.equal(carouselAspect([photo(1200, 900), photo(1200, 900)]), 1.33);
  assert.equal(carouselAspect([photo(900, 1200), photo(900, 1200)]), 0.75);
  assert.equal(carouselAspect([photo(800, 800), photo(800, 800)]), 1);
});

test('a mixed carousel lands between the orientations, not on one of them', () => {
  const ar = carouselAspect([
    photo(1200, 800),  // 1.5
    photo(900, 1200),  // 0.75
    photo(800, 800),   // 1.0
    photo(1200, 900),  // 1.33
    photo(1000, 1400), // 0.71
  ]);
  assert.equal(ar, 1, 'median of the five aspects');
  // The point of the exercise: no photo loses more than a third of itself.
  for (const [w, h] of [[1200, 800], [900, 1200], [800, 800], [1200, 900], [1000, 1400]]) {
    const a = w / h;
    const kept = a > ar ? ar / a : a / ar;
    assert.ok(kept >= 0.66, `${w}x${h} kept only ${kept.toFixed(2)}`);
  }
});

test('one extreme photo cannot drag the whole strip to its shape', () => {
  const withPanorama = carouselAspect([
    photo(4000, 800), photo(1200, 900), photo(1200, 900), photo(1200, 900),
  ]);
  assert.ok(withPanorama <= 1.5, `panorama pulled the strip to ${withPanorama}`);
  const withTower = carouselAspect([
    photo(600, 2400), photo(1200, 900), photo(1200, 900), photo(1200, 900),
  ]);
  assert.ok(withTower >= 0.75, `tall photo pulled the strip to ${withTower}`);
});

test('carousel aspect stays inside 3:4 and 3:2 whatever it is fed', () => {
  const cases = [
    [photo(5000, 500)], [photo(500, 5000)], [photo(1, 1)],
    [photo(1200, 800), photo(500, 5000)],
  ];
  for (const photos of cases) {
    const ar = carouselAspect(photos);
    assert.ok(ar >= 0.75 && ar <= 1.5, `${JSON.stringify(photos)} -> ${ar}`);
  }
});

test('carousel aspect degrades to 4:3 on unusable input', () => {
  assert.equal(carouselAspect([]), 4 / 3);
  assert.equal(carouselAspect(null), 4 / 3);
  assert.equal(carouselAspect([{ width: 0, height: 0 }]), 4 / 3);
});

test('the engine is pure — it does not mutate the post it is given', () => {
  const post = { caption: 'hi', photos: [photo(900, 1200)], milestone: null };
  const before = JSON.stringify(post);
  inferLayout(post);
  isMilestone(post);
  assert.equal(JSON.stringify(post), before);
});
