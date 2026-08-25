// Straightening and cropping. The failure this file exists for is silent: a crop that
// strays past the edge of a rotated photo bakes a transparent wedge into a corner of the
// artwork, which on a pale mat nobody notices until it is framed and looked at closely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ANGLE, MIN_CROP, FULL_CROP,
  usableAngle, rotatedSize, toOriginal, cropIsCovered, largestInscribedCrop,
  usableCrop, outputSize, bakePlan, filterString, recipe, constrainToPhoto,
} from '../js/bake.js';

const ANGLES = [-15, -7.5, -3, -0.4, 0, 0.4, 3, 7.5, 15];
const SIZES = [[2048, 1536], [1536, 2048], [1600, 1600], [2400, 600], [600, 2400]];

test('a deskew is a small angle; turning a photo on its side is EXIF\'s job', () => {
  assert.equal(usableAngle(90), MAX_ANGLE);
  assert.equal(usableAngle(-90), -MAX_ANGLE);
  assert.equal(usableAngle(2.5), 2.5);
});

test('a missing or nonsense angle is no rotation rather than NaN', () => {
  for (const bad of [undefined, null, NaN, 'sideways', {}]) {
    assert.equal(usableAngle(bad), 0, `${bad}`);
  }
});

test('an unrotated image has a bounding box of exactly its own size', () => {
  const box = rotatedSize(2048, 1536, 0);
  assert.equal(Math.round(box.width), 2048);
  assert.equal(Math.round(box.height), 1536);
});

test('rotating always grows the bounding box, never shrinks it', () => {
  for (const [w, h] of SIZES) {
    for (const angle of ANGLES.filter((a) => a !== 0)) {
      const box = rotatedSize(w, h, angle);
      assert.ok(box.width >= w - 1e-6 && box.height >= h - 1e-6,
        `${w}x${h} at ${angle} shrank`);
    }
  }
});

test('a bounding box is the same whichever way the image was tilted', () => {
  const left = rotatedSize(2048, 1536, -6);
  const right = rotatedSize(2048, 1536, 6);
  assert.ok(Math.abs(left.width - right.width) < 1e-9);
  assert.ok(Math.abs(left.height - right.height) < 1e-9);
});

test('the centre of rotated space maps to the centre of the original', () => {
  for (const angle of ANGLES) {
    const box = rotatedSize(2048, 1536, angle);
    const p = toOriginal({ x: box.width / 2, y: box.height / 2 }, 2048, 1536, angle);
    assert.ok(Math.abs(p.x - 1024) < 1e-6 && Math.abs(p.y - 768) < 1e-6, `at ${angle}`);
  }
});

test('the corners of a rotated bounding box are empty space, not photograph', () => {
  // This is the wedge the whole file guards against. At any real angle the very corner
  // of the bounding box is outside the picture.
  for (const angle of [-9, -3, 3, 9]) {
    assert.equal(cropIsCovered(FULL_CROP, 2048, 1536, angle), false, `at ${angle}`);
  }
});

test('the full frame is covered when there is no rotation at all', () => {
  assert.equal(cropIsCovered(FULL_CROP, 2048, 1536, 0), true);
});

test('the default crop is always inside the photograph, at every angle and shape', () => {
  // The property that matters most: whatever the editor opens with must never be a
  // rectangle that bakes a transparent corner.
  for (const [w, h] of SIZES) {
    for (const angle of ANGLES) {
      const crop = largestInscribedCrop(w, h, angle);
      assert.equal(cropIsCovered(crop, w, h, angle), true,
        `${w}x${h} at ${angle} was not covered`);
    }
  }
});

test('the default crop is centred, and is the whole frame when nothing is rotated', () => {
  const crop = largestInscribedCrop(2048, 1536, 0);
  assert.ok(Math.abs(crop.w - 1) < 1e-6 && Math.abs(crop.h - 1) < 1e-6);
  assert.ok(Math.abs(crop.x) < 1e-6 && Math.abs(crop.y) < 1e-6);
});

test('the default crop keeps more of the picture at a small angle than a large one', () => {
  const gentle = largestInscribedCrop(2048, 1536, 2);
  const steep = largestInscribedCrop(2048, 1536, 14);
  assert.ok(gentle.w * gentle.h > steep.w * steep.h);
});

test('a crop is forced back inside the frame rather than allowed off the edge', () => {
  const escaped = usableCrop({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
  assert.ok(escaped.x + escaped.w <= 1 + 1e-9);
  assert.ok(escaped.y + escaped.h <= 1 + 1e-9);
});

test('a crop cannot be shrunk below the point where the result is unusably soft', () => {
  const tiny = usableCrop({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 });
  assert.equal(tiny.w, MIN_CROP);
  assert.equal(tiny.h, MIN_CROP);
});

test('a missing crop is the whole frame rather than nothing', () => {
  assert.deepEqual(usableCrop(undefined), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(usableCrop(null), { x: 0, y: 0, w: 1, h: 1 });
});

test('a large photo is scaled down for the visitor, keeping its proportions', () => {
  const out = outputSize(FULL_CROP, 4000, 3000, 0, 2000);
  assert.equal(out.width, 2000);
  assert.equal(out.height, 1500);
  assert.ok(out.scale < 1);
});

test('a small photo is never blown up to the cap', () => {
  const out = outputSize(FULL_CROP, 800, 600, 0, 2000);
  assert.deepEqual([out.width, out.height, out.scale], [800, 600, 1]);
});

test('cropping half the width halves the baked width', () => {
  const out = outputSize({ x: 0.25, y: 0, w: 0.5, h: 1 }, 2000, 1000, 0, 4000);
  assert.equal(out.width, 1000);
  assert.equal(out.height, 1000);
});

test('a bake plan ends by drawing the image, after every transform is set up', () => {
  const plan = bakePlan({ width: 2048, height: 1536, angle: 3 });
  assert.equal(plan.steps.at(-1).op, 'drawImage');
  assert.equal(plan.steps.filter((s) => s.op === 'drawImage').length, 1);
  assert.equal(plan.steps[0].op, 'scale');
});

test('a bake plan reports whether its crop would leave an empty corner', () => {
  assert.equal(bakePlan({ width: 2048, height: 1536, angle: 6 }).covered, false);
  const safe = largestInscribedCrop(2048, 1536, 6);
  assert.equal(bakePlan({ width: 2048, height: 1536, angle: 6, crop: safe }).covered, true);
});

test('an untouched image asks for no filter at all', () => {
  assert.equal(filterString(1, 1), '');
  assert.equal(filterString(), '');
});

test('brightness and contrast produce one string for both the preview and the bake', () => {
  // The same string is set on element.style.filter and on ctx.filter, so what is seen
  // is what gets written. Two implementations would eventually disagree.
  assert.equal(filterString(1.2, 0.9), 'brightness(1.2) contrast(0.9)');
});

test('filters are clamped to the range a photo of paper can survive', () => {
  assert.equal(filterString(99, 99), 'brightness(2) contrast(2)');
  assert.equal(filterString(-5, 0), 'brightness(0.2) contrast(0.2)');
});

test('a stored recipe round-trips through the guards it was built with', () => {
  const stored = recipe({ angle: 2.3456, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    brightness: 1.15, contrast: 1.05 });
  assert.equal(stored.angle, 2.346);
  assert.deepEqual(stored.crop, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  assert.equal(stored.brightness, 1.15);
});

test('a recipe from nothing is a neutral one, not a broken one', () => {
  const stored = recipe({});
  assert.equal(stored.angle, 0);
  assert.equal(stored.brightness, 1);
  assert.equal(stored.contrast, 1);
  assert.deepEqual(stored.crop, { x: 0, y: 0, w: 1, h: 1 });
});

test('a legitimate zero is a setting, not a missing value', () => {
  // Number(v) || fallback reads 0 as unset. contrast: 0 is flat grey — a real thing to
  // ask for — and treating it as "untouched" moves the slider without moving the image.
  assert.equal(filterString(1, 0), 'brightness(1) contrast(0.2)');
  assert.equal(usableCrop({ x: 0, y: 0, w: 0, h: 0 }).w, MIN_CROP);
  assert.equal(recipe({ brightness: 0 }).brightness, 0.2);
});

test('a crop dragged off the photo is stopped at the edge, not merely flagged', () => {
  // Rotation leaves empty wedges in the corners of the bounding box. The interface
  // should make those unreachable rather than allow them and complain.
  const [w, h, angle] = [2048, 1536, 8];
  const good = largestInscribedCrop(w, h, angle);
  const overshoot = { x: 0, y: 0, w: 1, h: 1 };
  const held = constrainToPhoto(overshoot, good, w, h, angle);
  assert.equal(cropIsCovered(held, w, h, angle), true);
});

test('a legal drag is passed through exactly as asked', () => {
  const [w, h, angle] = [2048, 1536, 0];
  const want = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  assert.deepEqual(constrainToPhoto(want, want, w, h, angle), usableCrop(want));
});

test('a diagonal drag blocked on one axis still slides along the other', () => {
  // The behaviour that makes an edge feel like a wall rather than like glue.
  //
  // The starting crop has to have slack to slide INTO: largestInscribedCrop is
  // maximal and touches every edge, so nothing can move from there in any direction.
  // This one is narrowed horizontally — room to the sides, none above.
  const [w, h, angle] = [2000, 1000, 10];
  const full = largestInscribedCrop(w, h, angle);
  const good = usableCrop({ ...full, x: full.x + 0.05, w: full.w - 0.1 });
  assert.equal(cropIsCovered(good, w, h, angle), true, 'the premise: the start is legal');

  // Push hard upward (illegal, the height is still maximal) and slightly right (legal).
  const want = { ...good, x: good.x + 0.02, y: 0 };
  const held = constrainToPhoto(want, good, w, h, angle);
  assert.equal(cropIsCovered(held, w, h, angle), true);
  assert.ok(held.x > good.x, 'the legal axis should still have moved');
  assert.ok(held.y > 0.001, 'the blocked axis should not have gone to the top edge');
});

test('constraining never returns something the editor would reject', () => {
  const [w, h] = [1600, 1200];
  for (const angle of [-12, -5, 0, 5, 12]) {
    const good = largestInscribedCrop(w, h, angle);
    for (const want of [{ x: -0.5, y: -0.5, w: 1.4, h: 1.4 }, { x: 0.99, y: 0.99, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 1, h: 1 }, { x: 0.4, y: 0.4, w: 0.01, h: 0.01 }]) {
      const held = constrainToPhoto(want, good, w, h, angle);
      assert.equal(cropIsCovered(held, w, h, angle), true, `${angle} ${JSON.stringify(want)}`);
      assert.deepEqual(held, usableCrop(held));
    }
  }
});

test('an already-illegal starting crop is recovered from rather than walked back to', () => {
  const [w, h, angle] = [2048, 1536, 9];
  const bad = { x: 0, y: 0, w: 1, h: 1 };
  const held = constrainToPhoto({ x: 0, y: 0, w: 1, h: 1 }, bad, w, h, angle);
  assert.equal(cropIsCovered(held, w, h, angle), true);
});
