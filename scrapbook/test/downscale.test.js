// How big a photo should end up, before any canvas is involved.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitWithin, needsDownscale, DISPLAY_EDGE, THUMB_EDGE } from '../js/downscale.js';

// ── Fitting inside a bound ────────────────────────────────────────
test('a landscape photo is bounded by its width', () => {
  const out = fitWithin(4000, 3000, 2560);
  assert.deepEqual(out, { width: 2560, height: 1920, scaled: true });
});

test('a portrait photo is bounded by its height', () => {
  const out = fitWithin(3000, 4000, 2560);
  assert.deepEqual(out, { width: 1920, height: 2560, scaled: true });
});

test('shape is kept, which is what stops a photo being squashed', () => {
  const out = fitWithin(4080, 3072, 2560);
  assert.ok(Math.abs((out.width / out.height) - (4080 / 3072)) < 0.001);
});

test('a photo already inside the bound is left exactly alone', () => {
  // Not merely "not enlarged" — untouched, so nothing is re-encoded for no reason.
  assert.deepEqual(fitWithin(1200, 900, 2560), { width: 1200, height: 900, scaled: false });
});

test('one exactly on the bound is not scaled', () => {
  assert.deepEqual(fitWithin(2560, 1440, 2560), { width: 2560, height: 1440, scaled: false });
});

test('a panorama keeps at least one pixel on its short side', () => {
  // 8000x30 at a 2560 bound is 9.6px tall, and rounding that to 0 is a canvas that throws.
  const out = fitWithin(8000, 30, 2560);
  assert.equal(out.width, 2560);
  assert.ok(out.height >= 1, `short side was ${out.height}`);
});

test('whole pixels only', () => {
  const out = fitWithin(4001, 3001, 2560);
  assert.equal(out.width, Math.round(out.width));
  assert.equal(out.height, Math.round(out.height));
});

test('nonsense in, nothing out — never a NaN canvas', () => {
  assert.deepEqual(fitWithin(0, 0, 2560), { width: 0, height: 0, scaled: false });
  assert.deepEqual(fitWithin(NaN, 100, 2560), { width: 0, height: 100, scaled: false });
  assert.deepEqual(fitWithin(100, 100, 0), { width: 100, height: 100, scaled: false });
});

// ── Whether to re-encode at all ───────────────────────────────────
const MB = 1024 * 1024;

test('a big phone photo is downscaled', () => {
  assert.equal(needsDownscale({ width: 4000, height: 3000, size: 4 * MB }), true);
});

test('a photo near the field limit is downscaled even if small in pixels', () => {
  // The case that produced the 400: dimensions are fine, bytes are not.
  assert.equal(needsDownscale({ width: 2000, height: 1500, size: 14 * MB }), true);
});

test('a modest photo is left as it is', () => {
  // Re-encoding this would lose quality and save nothing.
  assert.equal(needsDownscale({ width: 1600, height: 1200, size: 800 * 1024 }), false);
});

test('the byte threshold sits well below the limit, not at it', () => {
  // A 14.9 MB photo technically uploads, but slowly and for no benefit — and a re-encode
  // that comes out slightly larger than expected must not sail past the ceiling.
  assert.equal(needsDownscale({ width: 800, height: 600, size: 9.5 * MB }), true);
  assert.equal(needsDownscale({ width: 800, height: 600, size: 2 * MB }), false);
});

test('the limit is a parameter, so the rule follows the schema', () => {
  assert.equal(needsDownscale({ width: 800, height: 600, size: 4 * MB }, 5 * MB), true);
  assert.equal(needsDownscale({ width: 800, height: 600, size: 4 * MB }, 50 * MB), false);
});

test('the display bound is bigger than the thumbnail bound', () => {
  // Guards against someone "tidying" the constants into agreement: they answer different
  // questions — what a big screen shows, and what a 76px strip needs.
  assert.ok(DISPLAY_EDGE > THUMB_EDGE);
});
