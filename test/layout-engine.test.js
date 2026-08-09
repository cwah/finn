// The layout engine is the heart of the product: it decides every card's shape with
// no user input and no override. These tests pin the rules from CLAUDE.md exactly.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  inferLayout, isMilestone, GRID_MAX, carouselAspect, cropRect, croppedSize, FULL_CROP,
  coverAlign,
} from '../js/layout-engine.js';

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

// ── Cropping ──────────────────────────────────────────────────────
const cropped = (w, h, crop) => ({ ...photo(w, h), crop });

test('a photo with no crop is cropped to all of itself', () => {
  assert.deepEqual(cropRect(photo(1600, 900)), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(croppedSize(photo(1600, 900)), { width: 1600, height: 900 });
});

test('cropped size is the rectangle, not the original', () => {
  const p = cropped(1600, 900, { x: 0.35, y: 0, w: 0.25, h: 1 });
  assert.deepEqual(croppedSize(p), { width: 400, height: 900 });
});

test('cropping a wide photo tall makes it a PORTRAIT card', () => {
  // The whole point: the engine must judge the picture the parent framed, not the file.
  const wide = photo(1600, 900);
  assert.equal(inferLayout({ photos: [wide] }), 'landscape');
  assert.equal(
    inferLayout({ photos: [cropped(1600, 900, { x: 0.35, y: 0, w: 0.25, h: 1 })] }),
    'portrait',
  );
});

test('cropping a tall photo wide makes it a LANDSCAPE card', () => {
  assert.equal(inferLayout({ photos: [photo(900, 1600)] }), 'portrait');
  assert.equal(
    inferLayout({ photos: [cropped(900, 1600, { x: 0, y: 0.4, w: 1, h: 0.2 })] }),
    'landscape',
  );
});

test('a carousel takes its shape from the cropped photos, not the originals', () => {
  // All wide files, all cropped square — the strip should be square, not 16:9.
  const photos = [1, 2, 3, 4, 5].map(() =>
    cropped(1600, 900, { x: 0.2, y: 0, w: 0.5625, h: 1 }));
  assert.equal(carouselAspect(photos), 1);
});

test('a crop cannot escape the photo it belongs to', () => {
  const over = cropRect({ width: 100, height: 100, crop: { x: 0.8, y: 0.9, w: 0.5, h: 0.5 } });
  assert.ok(over.x + over.w <= 1.0001, `${over.x} + ${over.w} runs past the edge`);
  assert.ok(over.y + over.h <= 1.0001, `${over.y} + ${over.h} runs past the edge`);

  const negative = cropRect({ width: 100, height: 100, crop: { x: -0.5, y: -1, w: 0.5, h: 0.5 } });
  assert.ok(negative.x >= 0 && negative.y >= 0);
});

test('a nonsensical crop falls back to the whole photo rather than vanishing', () => {
  for (const bad of [{ w: 0, h: 0 }, { w: -1, h: 1 }, { w: null, h: null }, {}, 'nope']) {
    assert.deepEqual(cropRect({ width: 10, height: 10, crop: bad }), FULL_CROP, JSON.stringify(bad));
  }
  // And a zero-area crop must never produce a zero-sized card.
  assert.deepEqual(croppedSize({ width: 800, height: 600, crop: { x: 0, y: 0, w: 0, h: 0 } }),
    { width: 800, height: 600 });
});

test('cropping is pure — reading a crop does not rewrite the photo', () => {
  const p = cropped(1600, 900, { x: 0.35, y: 0, w: 0.25, h: 1 });
  const before = JSON.stringify(p);
  cropRect(p);
  croppedSize(p);
  inferLayout({ photos: [p] });
  assert.equal(JSON.stringify(p), before);
});

// ── Focal point vs cover crop ─────────────────────────────────────
/** Where the focal point ends up inside the cell, given the anchor coverAlign picks. */
const lands = (f, boxAspect, cellAspect, axis = 'x') => {
  const p = coverAlign({ focalX: f, focalY: f }, boxAspect, cellAspect)[axis];
  const k = axis === 'x'
    ? Math.max(1, boxAspect / cellAspect)
    : Math.max(1, cellAspect / boxAspect);
  return p * (1 - k) + f * k; // fraction across the cell
};

test('a centred focal point stays centred', () => {
  assert.equal(+lands(0.5, 2, 1).toFixed(3), 0.5);
  assert.equal(+lands(0.5, 0.5, 1).toFixed(3), 0.5);
});

test('an off-centre focal point is CENTRED, not merely aligned', () => {
  // The bug this replaced: anchoring at the focal fraction put 0.3 at 30% across the
  // cell. With room to move, it should land dead centre instead.
  assert.equal(+lands(0.3, 2, 1).toFixed(3), 0.5);
  assert.equal(+lands(0.7, 2, 1).toFixed(3), 0.5);
});

test('near an edge it gets as close to centre as covering allows, without a gap', () => {
  // k = 1.33: the photo is only a third wider than the cell, so 0.15 cannot reach the
  // middle. It should move toward it and stop at the edge of what covering permits.
  const at = lands(0.15, 4 / 3, 1);
  assert.ok(at > 0.15, `should move toward centre, stayed at ${at.toFixed(3)}`);
  assert.ok(at <= 0.5, `should not overshoot centre, got ${at.toFixed(3)}`);

  // The anchor itself must stay in 0–1, which is what keeps the cell covered.
  for (const f of [0, 0.15, 0.5, 0.85, 1]) {
    const p = coverAlign({ focalX: f, focalY: f }, 4 / 3, 1);
    assert.ok(p.x >= 0 && p.x <= 1, `anchor ${p.x} would expose a gap`);
    assert.ok(p.y >= 0 && p.y <= 1, `anchor ${p.y} would expose a gap`);
  }
});

test('an axis with no slack has nothing to choose', () => {
  // Square photo in a square cell: it fits exactly, so neither axis can move.
  const p = coverAlign({ focalX: 0.2, focalY: 0.8 }, 1, 1);
  assert.deepEqual(p, { x: 0.5, y: 0.5 });
});

test('the tall axis is anchored independently of the wide one', () => {
  // A wide photo in a square cell overflows horizontally only.
  const p = coverAlign({ focalX: 0.2, focalY: 0.9 }, 2, 1);
  assert.ok(p.x !== 0.5, 'the overflowing axis should be anchored');
  assert.equal(p.y, 0.5, 'the exact-fitting axis has no slack');
});

test('a missing focal point behaves as dead centre', () => {
  assert.deepEqual(coverAlign({}, 2, 1), coverAlign({ focalX: 0.5, focalY: 0.5 }, 2, 1));
  assert.deepEqual(coverAlign(null, 2, 1), coverAlign({ focalX: 0.5, focalY: 0.5 }, 2, 1));
});

test('degenerate aspects degrade to centre rather than NaN', () => {
  for (const [b, c] of [[0, 1], [1, 0], [NaN, 1], [1, NaN]]) {
    assert.deepEqual(coverAlign({ focalX: 0.2 }, b, c), { x: 0.5, y: 0.5 }, `${b}/${c}`);
  }
});

test('the engine is pure — it does not mutate the post it is given', () => {
  const post = { caption: 'hi', photos: [photo(900, 1200)], milestone: null };
  const before = JSON.stringify(post);
  inferLayout(post);
  isMilestone(post);
  assert.equal(JSON.stringify(post), before);
});
