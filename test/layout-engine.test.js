// The layout engine is the heart of the product: it decides every card's shape with
// no user input and no override. These tests pin the rules from CLAUDE.md exactly.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  inferLayout, isMilestone, GRID_MAX, leadAspect, cropRect, croppedSize, FULL_CROP,
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

test('the lead photo sets the shape, whatever the rest of the set looks like', () => {
  assert.equal(leadAspect([photo(1200, 900), photo(900, 1200)]), 1.33);
  assert.equal(leadAspect([photo(900, 1200), photo(1200, 900)]), 0.75);
  assert.equal(leadAspect([photo(800, 800)]), 1);
});

test('cropping the lead photo reshapes the card', () => {
  // The bug this fixes: the shape ignored the crop, so cropping changed nothing.
  const wide = photo(1600, 900);
  assert.equal(leadAspect([wide]), 1.78);
  assert.equal(leadAspect([cropped(1600, 900, { x: 0.35, y: 0, w: 0.25, h: 1 })]), 0.44);
});

test('reordering changes the shape, since "make main photo" moves a photo to the front', () => {
  const wide = photo(1600, 900);
  const tall = photo(900, 1600);
  assert.notEqual(leadAspect([wide, tall]), leadAspect([tall, wide]));
});

test('the clamp catches the absurd without refusing a plausible crop', () => {
  // A stray panorama must not letterbox every slide of a carousel.
  assert.ok(leadAspect([photo(6000, 800)]) <= 3, 'panorama not clamped');
  assert.ok(leadAspect([photo(800, 6000)]) >= 1 / 3, 'tall photo not clamped');

  // But every shape a parent might deliberately crop to has to survive intact —
  // anything narrower than a single-photo card would allow is the bug, not the fix.
  for (const [w, h, expected] of [
    [400, 900, 0.44],   // a narrow slice
    [900, 1600, 0.56],  // 9:16
    [2, 3, 0.67],       // 2:3
    [3, 4, 0.75],       // 3:4
    [16, 9, 1.78],      // 16:9
    [2, 1, 2],          // 2:1
  ]) {
    assert.equal(leadAspect([photo(w, h)]), expected, `${w}:${h} was altered`);
  }
});

test('lead aspect degrades to 4:3 on unusable input', () => {
  assert.equal(leadAspect([]), 4 / 3);
  assert.equal(leadAspect(null), 4 / 3);
  assert.equal(leadAspect([{ width: 0, height: 0 }]), 4 / 3);
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

test('a carousel takes its shape from the cropped lead photo, not the original file', () => {
  const photos = [1, 2, 3, 4, 5].map(() =>
    cropped(1600, 900, { x: 0.2, y: 0, w: 0.5625, h: 1 }));
  assert.equal(leadAspect(photos), 1);
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
