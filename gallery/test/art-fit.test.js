// Dimensions in, custom properties out. The quiet failure here is a bad manifest
// value reaching the CSS: calc() drops the whole chain at computed-value time and
// the artwork collapses to its floor with nothing in the console to say why.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usableSize, orientationOf, matScale, artVars } from '../js/art-fit.js';

test('ordinary dimensions are passed through untouched', () => {
  assert.deepEqual(usableSize(2048, 1536), { width: 2048, height: 1536 });
});

test('a zero, a negative, a NaN or a missing dimension falls back to a portrait shape', () => {
  for (const [w, h] of [[0, 100], [100, 0], [-4, 5], [NaN, 5], [undefined, 5], ['x', 'y']]) {
    assert.deepEqual(usableSize(w, h), { width: 4, height: 5 }, `${w}x${h}`);
  }
});

test('a ratio past 20:1 is treated as a typo rather than a drawing', () => {
  assert.deepEqual(usableSize(4000, 10), { width: 4, height: 5 });
});

test('a near-square photo counts as square, since no phone photo is exactly square', () => {
  assert.equal(orientationOf(1000, 1000), 'square');
  assert.equal(orientationOf(1004, 1000), 'square');
  assert.equal(orientationOf(1000, 1004), 'square');
});

test('past the dead band, orientation is decided by which side is longer', () => {
  assert.equal(orientationOf(2048, 1536), 'landscape');
  assert.equal(orientationOf(1536, 2048), 'portrait');
});

test('ordinary ratios keep the whole mat', () => {
  assert.equal(matScale(1536, 2048), 1);
  assert.equal(matScale(2048, 1536), 1);
  assert.equal(matScale(1000, 1000), 1);
});

test('an extreme panorama loses mat, so the mat is never wider than the drawing is tall', () => {
  const long = matScale(2400, 600);   // 4:1
  assert.ok(long < 1, 'a 4:1 piece should lose some mat');
  assert.ok(long >= 0.55, 'but never more than the floor');
});

test('a tall piece tapers exactly as much as the wide piece of the same ratio', () => {
  assert.equal(matScale(2400, 600), matScale(600, 2400));
});

test('artVars names the properties the stylesheet actually reads', () => {
  const vars = artVars({ width: 1200, height: 1600 });
  assert.deepEqual(Object.keys(vars).sort(), ['--art-h', '--art-w', '--mat-scale']);
  assert.equal(vars['--art-w'], '1200');
  assert.equal(vars['--art-h'], '1600');
});

test('artVars always yields numbers CSS can multiply, even from a broken manifest', () => {
  for (const image of [null, undefined, {}, { width: 0, height: 0 }, { width: 'a', height: 'b' }]) {
    for (const value of Object.values(artVars(image))) {
      assert.ok(Number.isFinite(Number(value)), `${value} is not a number`);
      assert.ok(Number(value) > 0);
    }
  }
});
