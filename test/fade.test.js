// The curve that fades milestone artwork in and out with scroll. Pure geometry, so the
// shape can be pinned here rather than eyeballed in a browser.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { centreProgress } from '../js/fade.js';

const VH = 800;
const H = 400;

/** Place a card's centre at a fraction of the viewport and read the progress back. */
const at = (centreFraction, height = H, vh = VH) =>
  centreProgress(centreFraction * vh - height / 2, height, vh);

test('a card centred on screen is fully lit', () => {
  assert.equal(at(0.5), 1);
});

test('a card just off screen is fully dark', () => {
  // Its top edge exactly at the bottom of the viewport, and vice versa.
  assert.equal(centreProgress(VH, H, VH), 0);
  assert.equal(centreProgress(-H, H, VH), 0);
});

test('it never goes negative, however far off screen', () => {
  for (const top of [VH * 3, -VH * 3, 1e6, -1e6]) {
    const p = centreProgress(top, H, VH);
    assert.ok(p >= 0 && p <= 1, `top ${top} gave ${p}`);
  }
});

test('it rises approaching the centre and falls leaving it', () => {
  const rising = [0.95, 0.85, 0.7, 0.5].map((f) => at(f));
  for (let i = 1; i < rising.length; i += 1) {
    assert.ok(rising[i] > rising[i - 1], `not rising at ${i}: ${rising}`);
  }
  const falling = [0.5, 0.3, 0.15, 0.05].map((f) => at(f));
  for (let i = 1; i < falling.length; i += 1) {
    assert.ok(falling[i] < falling[i - 1], `not falling at ${i}: ${falling}`);
  }
});

test('it is symmetric — coming and going look the same', () => {
  for (const d of [0.1, 0.2, 0.35]) {
    assert.equal(at(0.5 + d).toFixed(6), at(0.5 - d).toFixed(6));
  }
});

test('it eases rather than ramping, so nothing snaps on at the edges', () => {
  // Smoothstep sits below a straight line in the first half of the ramp.
  const linearAt = (f) => {
    const travel = (VH + H) / 2;
    const offset = (f * VH - VH / 2) / travel;
    return Math.max(0, 1 - Math.abs(offset));
  };
  const f = 0.95;
  assert.ok(centreProgress(f * VH - H / 2, H, VH) < linearAt(f), 'should ease in below linear');
});

test('a tall card stays lit over more scrolling than a short one', () => {
  // Measured by how far its CENTRE can sit from the viewport's while still lit — not by
  // a shared `top`, where a tall card's centre is pushed further away and it reads as
  // dimmer. The lit span is viewportHeight + cardHeight, so height extends it.
  const litAt = (centreOffset, h) => centreProgress(VH / 2 + centreOffset - h / 2, h, VH);

  assert.ok(litAt(600, 900) > 0, 'a tall card should still be lit 600px off centre');
  assert.equal(litAt(600, 100), 0, 'a short card should be dark by then');

  // Both are brightest dead centre regardless of height.
  assert.equal(litAt(0, 900), 1);
  assert.equal(litAt(0, 100), 1);
});

test('degenerate input is dark rather than NaN', () => {
  assert.equal(centreProgress(0, 400, 0), 0);
  assert.equal(centreProgress(0, -1, VH), 0);
  assert.equal(centreProgress(0, 400, NaN), 0);
});
