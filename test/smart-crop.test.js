// The focal-point scoring is the half of smart cropping that can be tested without a
// browser: given a brightness map, does it aim at the interesting part?
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { focalFromLuma } from '../js/smart-crop.js';

const W = 32;
const H = 32;

/** A flat field with an optional patch of fine detail — the thing the heuristic hunts. */
function field({ base = 128, detail = null } = {}) {
  const luma = new Float32Array(W * H).fill(base);
  if (detail) {
    const { x0, y0, size } = detail;
    for (let y = y0; y < y0 + size; y += 1) {
      for (let x = x0; x < x0 + size; x += 1) {
        // Alternating pixels: maximum local contrast, which is what scores.
        luma[y * W + x] = (x + y) % 2 === 0 ? 0 : 255;
      }
    }
  }
  return luma;
}

test('a perfectly flat image has nothing to aim at, so it stays centred', () => {
  assert.deepEqual(focalFromLuma(field(), W, H), { x: 0.5, y: 0.5 });
});

test('detail in the top-left pulls the focus up and left', () => {
  const { x, y } = focalFromLuma(field({ detail: { x0: 4, y0: 4, size: 8 } }), W, H);
  assert.ok(x < 0.5, `x should move left, got ${x}`);
  assert.ok(y < 0.5, `y should move up, got ${y}`);
});

test('detail in the bottom-right pulls the focus down and right', () => {
  const { x, y } = focalFromLuma(field({ detail: { x0: 20, y0: 20, size: 8 } }), W, H);
  assert.ok(x > 0.5, `x should move right, got ${x}`);
  assert.ok(y > 0.5, `y should move down, got ${y}`);
});

test('detail dead centre keeps the focus centred', () => {
  const { x, y } = focalFromLuma(field({ detail: { x0: 12, y0: 12, size: 8 } }), W, H);
  assert.ok(Math.abs(x - 0.5) < 0.06, `x drifted to ${x}`);
  assert.ok(Math.abs(y - 0.5) < 0.06, `y drifted to ${y}`);
});

test('the focus never parks against an edge, however extreme the detail', () => {
  const { x, y } = focalFromLuma(field({ detail: { x0: 1, y0: 1, size: 3 } }), W, H);
  assert.ok(x >= 0.15 && x <= 0.85, `x out of bounds: ${x}`);
  assert.ok(y >= 0.15 && y <= 0.85, `y out of bounds: ${y}`);
});

test('a speck of noise loses to a real subject', () => {
  // A bright pixel in the top-left corner, against a proper detailed region on the
  // right. The subject has far more total energy, so it should win comfortably.
  const luma = field({ detail: { x0: 20, y0: 12, size: 8 } });
  luma[2 * W + 2] = 255;
  const { x } = focalFromLuma(luma, W, H);
  assert.ok(x > 0.5, `the speck pulled focus to ${x}`);
});

test('on a featureless image a single speck IS the subject, but stays bounded', () => {
  // Degenerate input: with nothing else in the frame the centroid lands on the only
  // detail there is, which is defensible. What matters is that the centre pull and the
  // edge clamp keep the framing from slamming into the corner.
  const luma = field();
  luma[2 * W + 2] = 255;
  const { x, y } = focalFromLuma(luma, W, H);
  assert.ok(x >= 0.15 && y >= 0.15, `focus escaped the clamp at ${x}, ${y}`);
});

test('brightness alone is not detail — a smooth gradient has no subject', () => {
  // Left-to-right ramp: constant gradient everywhere, so the energy is uniform and the
  // centroid lands in the middle rather than on the bright end.
  const luma = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) luma[y * W + x] = (x / W) * 255;
  }
  const { x } = focalFromLuma(luma, W, H);
  assert.ok(Math.abs(x - 0.5) < 0.08, `gradient pulled focus to ${x}`);
});

test('malformed input degrades to centre rather than throwing', () => {
  assert.deepEqual(focalFromLuma(new Float32Array(0), 0, 0), { x: 0.5, y: 0.5 });
  assert.deepEqual(focalFromLuma(new Float32Array(4), 32, 32), { x: 0.5, y: 0.5 });
});

test('results are rounded to two decimals, and stable across calls', () => {
  const luma = field({ detail: { x0: 18, y0: 6, size: 6 } });
  const a = focalFromLuma(luma, W, H);
  const b = focalFromLuma(luma, W, H);
  assert.deepEqual(a, b);
  assert.equal(a.x, Math.round(a.x * 100) / 100);
  assert.equal(a.y, Math.round(a.y * 100) / 100);
});
