// A crop preset has to mean the shape you see.
//
//   npm test
//
// REPORTED: choosing 1:1 on a motion photo gave a crop box that was not square. It was not
// about motion at all — the photo had been ROTATED, and that is what breaks it.
//
// A crop is stored as fractions of the picture, and the crop rectangle is drawn as a
// percentage of the pane. The pane takes the ORIENTED aspect, so it turns with the photo.
// The preset maths used photo.width / photo.height, which does not. On anything turned a
// quarter the two disagree by exactly the rotation, and 1:1 comes out oblong — by the
// photo's own aspect ratio, so a 4:3 photo gave a 16:9-ish box.
//
// The arithmetic is reproduced here rather than imported because it lives inside the
// editor's closure, next to the DOM. What is pinned is the RULE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** The aspect the picture is shown at, which is what a preset must work in. */
function orientedAspect(photo, rotation) {
  const quarter = rotation % 180 !== 0;
  return quarter ? photo.height / photo.width : photo.width / photo.height;
}

/** Shape a crop to a preset, the way the editor does. */
function applyPreset(crop, photo, rotation, ratio) {
  const shownAr = orientedAspect(photo, rotation);
  let w = crop.w;
  let h = (w * shownAr) / ratio;
  if (h > 1) { h = 1; w = (h * ratio) / shownAr; }
  return { w, h };
}

/** What that crop actually LOOKS like on screen: fractions times the shown aspect. */
function shownRatio(crop, photo, rotation) {
  return (crop.w / crop.h) * orientedAspect(photo, rotation);
}

const landscape = { width: 4000, height: 3000 };   // 4:3
const portrait = { width: 3000, height: 4000 };

test('1:1 is square on an unrotated photo', () => {
  const crop = applyPreset({ w: 0.8, h: 0.8 }, landscape, 0, 1);
  assert.ok(Math.abs(shownRatio(crop, landscape, 0) - 1) < 1e-9);
});

test('1:1 is square on a photo turned a quarter', () => {
  // THE BUG. With the unrotated aspect this came out at 4:3 * 4:3 = 1.78 — a widescreen
  // box for a square preset.
  for (const rotation of [90, 270, -90]) {
    const crop = applyPreset({ w: 0.8, h: 0.8 }, landscape, rotation, 1);
    const seen = shownRatio(crop, landscape, rotation);
    assert.ok(Math.abs(seen - 1) < 1e-9, `rotation ${rotation} gave ${seen.toFixed(3)}`);
  }
});

test('the old maths really did get it wrong, by the photo aspect squared', () => {
  // Kept as the specification of the bug: using the unrotated aspect on a turned photo.
  const wrongAr = landscape.width / landscape.height;       // what the code used
  const h = (0.8 * wrongAr) / 1;
  const seen = (0.8 / h) * orientedAspect(landscape, 90);   // what the screen showed
  assert.ok(Math.abs(seen - 1) > 0.4, `expected visibly wrong, got ${seen.toFixed(3)}`);
});

test('every preset holds, rotated or not', () => {
  for (const ratio of [1, 4 / 3, 3 / 4]) {
    for (const photo of [landscape, portrait]) {
      for (const rotation of [0, 90, 180, 270]) {
        const crop = applyPreset({ w: 0.6, h: 0.6 }, photo, rotation, ratio);
        const seen = shownRatio(crop, photo, rotation);
        assert.ok(Math.abs(seen - ratio) < 1e-9,
          `${ratio.toFixed(2)} at ${rotation}° on ${photo.width}x${photo.height} gave ${seen.toFixed(3)}`);
      }
    }
  }
});

test('a crop that would overflow is pulled back, keeping its shape', () => {
  // Deriving the other side can exceed the picture; the fix must not distort to fit.
  const crop = applyPreset({ w: 1, h: 1 }, portrait, 0, 4 / 3);
  assert.ok(crop.w <= 1 && crop.h <= 1);
  assert.ok(Math.abs(shownRatio(crop, portrait, 0) - 4 / 3) < 1e-9);
});

test('the editor uses the oriented aspect in BOTH places', () => {
  // Presets are applied when a preset is tapped and again when a corner is dragged. The
  // first version fixed one and left the other, which would have looked fixed until
  // someone resized the box.
  const src = readFileSync(new URL('../js/photo-editor.js', import.meta.url), 'utf8');
  // Call sites only — the definition matches the same text.
  assert.equal((src.match(/= orientedAspect\(\);/g) || []).length, 2);
  assert.doesNotMatch(src, /const photoAr = photo\.width \/ photo\.height/,
    'the rotation-blind aspect must be gone');
});
