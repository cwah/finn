// The layout engine is the heart of the product: it decides every card's shape with
// no user input and no override. These tests pin the rules from CLAUDE.md exactly.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  inferLayout, isMilestone, GRID_MAX, leadAspect, cropRect, croppedSize, FULL_CROP,
  coverAlign, rotationOf, orientedSize, trimRange, hasVideo, isMotion, MAX_CLIP_SECONDS,
  turnFraming, lightFilter, adjustmentsOf } from '../js/layout-engine.js';

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

// ── Rotation ──────────────────────────────────────────────────────
test('rotation snaps to a right angle, and anything odd means upright', () => {
  assert.equal(rotationOf({ rotation: 90 }), 90);
  assert.equal(rotationOf({ rotation: 270 }), 270);
  assert.equal(rotationOf({ rotation: -90 }), 270, 'anticlockwise comes round the other way');
  assert.equal(rotationOf({ rotation: 450 }), 90, 'more than a full turn wraps');
  for (const odd of [undefined, null, 'sideways', NaN, {}]) {
    assert.equal(rotationOf({ rotation: odd }), 0, String(odd));
  }
  assert.equal(rotationOf(null), 0);
});

test('a quarter turn swaps the axes; a half turn does not', () => {
  const p = photo(1600, 900);
  assert.deepEqual(orientedSize({ ...p, rotation: 0 }), { width: 1600, height: 900 });
  assert.deepEqual(orientedSize({ ...p, rotation: 90 }), { width: 900, height: 1600 });
  assert.deepEqual(orientedSize({ ...p, rotation: 180 }), { width: 1600, height: 900 });
  assert.deepEqual(orientedSize({ ...p, rotation: 270 }), { width: 900, height: 1600 });
});

test('turning a landscape upright makes it a PORTRAIT card', () => {
  // The whole point: the card has to agree with the picture the parent is looking at.
  const sideways = { ...photo(1600, 900), rotation: 90 };
  assert.equal(inferLayout({ photos: [sideways] }), 'portrait');
  assert.equal(inferLayout({ photos: [photo(1600, 900)] }), 'landscape', 'and back again');
});

test('the crop is measured against the UPRIGHT photo, not the stored one', () => {
  // Rotation happens first, so a crop keeps framing what it framed when it was dragged.
  const p = { ...photo(1600, 900), rotation: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 } };
  // Upright it is 900x1600; half its height is 900x800.
  assert.deepEqual(croppedSize(p), { width: 900, height: 800 });
});

test('a crop keeps its meaning when the photo is turned', () => {
  // Because rotation is applied first, "a tall quarter" stays a tall quarter of whatever
  // the parent is looking at. Turning a photo must not re-frame the picture they chose.
  const tallQuarter = { x: 0.25, y: 0, w: 0.25, h: 1 };
  const wide = { ...photo(1600, 900), crop: tallQuarter };

  assert.deepEqual(croppedSize(wide), { width: 400, height: 900 });
  assert.deepEqual(croppedSize({ ...wide, rotation: 90 }), { width: 225, height: 1600 });
  for (const rotation of [0, 90, 180, 270]) {
    assert.equal(inferLayout({ photos: [{ ...wide, rotation }] }), 'portrait',
      `a tall quarter is a portrait at ${rotation} degrees`);
  }
});

test('rotation alone can flip the card, with no crop involved', () => {
  const wide = photo(1600, 900);
  assert.equal(inferLayout({ photos: [wide] }), 'landscape');
  assert.equal(inferLayout({ photos: [{ ...wide, rotation: 90 }] }), 'portrait');
  assert.equal(inferLayout({ photos: [{ ...wide, rotation: 180 }] }), 'landscape');
});

// ── Trimming ──────────────────────────────────────────────────────
const clip = (duration, extra = {}) => ({ url: 'v.mp4', duration, ...extra });

test('an untrimmed clip plays all of itself, up to the cap', () => {
  assert.deepEqual(trimRange(clip(12)), { start: 0, end: 12, duration: 12 });
});

test('nothing ever plays for longer than the cap', () => {
  // Written against MAX_CLIP_SECONDS rather than a number. The cap moved from 60 to 30 —
  // encoding the display copy happens on the phone, in real time, so the ceiling is a
  // property of the device and will move again if that work moves off it.
  const long = trimRange(clip(600));
  assert.equal(long.duration, MAX_CLIP_SECONDS);
  assert.deepEqual(long, { start: 0, end: MAX_CLIP_SECONDS, duration: MAX_CLIP_SECONDS });

  // Capped from wherever the trim starts, not from the beginning of the file.
  assert.deepEqual(trimRange(clip(600, { trimStart: 100, trimEnd: 500 })),
    { start: 100, end: 100 + MAX_CLIP_SECONDS, duration: MAX_CLIP_SECONDS });
});

test('the cap is thirty seconds', () => {
  // Pinned on its own, so changing it is a decision rather than a side effect. It is the
  // interim answer to on-device encoding being slow; see BACKLOG.md.
  assert.equal(MAX_CLIP_SECONDS, 30);
});

test('a trim is a window inside the source, and holds its shape', () => {
  assert.deepEqual(trimRange(clip(30, { trimStart: 5, trimEnd: 12.5 })),
    { start: 5, end: 12.5, duration: 7.5 });
});

test('a nonsensical trim degrades to the opening minute rather than erroring', () => {
  for (const odd of [
    clip(30, { trimStart: -5 }),
    clip(30, { trimStart: 'soon' }),
    clip(30, { trimEnd: 0 }),
    clip(30, { trimEnd: 5, trimStart: 20 }),   // backwards
    clip(30, { trimEnd: 999 }),                // past the end of the file
  ]) {
    const r = trimRange(odd);
    assert.ok(r.start >= 0 && r.end <= 30 && r.duration > 0, JSON.stringify(odd));
    assert.ok(r.duration <= MAX_CLIP_SECONDS);
  }
});

test('a missing or broken clip has no playable range', () => {
  for (const nothing of [null, undefined, {}, clip(0), clip(-1), clip('long')]) {
    assert.equal(trimRange(nothing).duration, 0, JSON.stringify(nothing));
  }
});

// ── Motion ────────────────────────────────────────────────────────
test('a plain photo carries no motion', () => {
  assert.equal(hasVideo(photo(800, 600)), false);
  assert.equal(isMotion(photo(800, 600)), false);
  assert.equal(hasVideo(null), false);
});

test('a motion photo loops; a video waits to be asked', () => {
  const still = photo(1200, 1600);
  const motion = { ...still, video: clip(2.5, { motion: true }) };
  const video = { ...still, video: clip(45) };

  assert.equal(isMotion(motion), true);
  assert.equal(isMotion(video), false, 'a longer clip is a video, and video costs battery');
  assert.equal(hasVideo(video), true);
});

test('a video with nothing playable is treated as a still', () => {
  const broken = { ...photo(800, 600), video: clip(0, { motion: true }) };
  assert.equal(hasVideo(broken), false);
  assert.equal(isMotion(broken), false);
});

test('a video still picks its layout from the poster, like any photo', () => {
  const tall = { ...photo(1080, 1920), video: clip(20) };
  assert.equal(inferLayout({ photos: [tall] }), 'portrait');
  const wideTurned = { ...photo(1920, 1080), video: clip(20), rotation: 270 };
  assert.equal(inferLayout({ photos: [wideTurned] }), 'portrait');
});

// ── Turning the framing with the photo ────────────────────────────
test('a crop turns with the photo, staying over the same part of the picture', () => {
  // The top-left quarter, turned clockwise, is the top-RIGHT quarter.
  const { crop } = turnFraming({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5 }, 90);
  assert.deepEqual(crop, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
});

test('a quarter turn swaps a rectangle onto its other axis', () => {
  const { crop } = turnFraming({ x: 0.25, y: 0, w: 0.25, h: 1 }, { x: 0.5, y: 0.5 }, 90);
  assert.deepEqual(crop, { x: 0, y: 0.25, w: 1, h: 0.25 }, 'a tall slice becomes a wide one');
});

test('four quarter turns is where you started', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const focal = { x: 0.7, y: 0.3 };
  let out = { crop, focal };
  for (let i = 0; i < 4; i += 1) out = turnFraming(out.crop, out.focal, 90);
  assert.deepEqual(out.crop, crop);
  assert.deepEqual(out.focal, focal);
});

test('turning by 180 or -90 agrees with turning by quarters', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const focal = { x: 0.7, y: 0.3 };

  const twice = turnFraming(...Object.values(turnFraming(crop, focal, 90)), 90);
  assert.deepEqual(turnFraming(crop, focal, 180), twice);

  const thrice = turnFraming(...Object.values(twice), 90);
  assert.deepEqual(turnFraming(crop, focal, -90), thrice, 'anticlockwise is three clockwise');
});

test('the focal point stays inside the crop it belongs to', () => {
  const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.6 };
  const focal = { x: 0.4, y: 0.3 }; // inside
  const out = turnFraming(crop, focal, 90);
  assert.ok(out.focal.x >= out.crop.x && out.focal.x <= out.crop.x + out.crop.w, 'x');
  assert.ok(out.focal.y >= out.crop.y && out.focal.y <= out.crop.y + out.crop.h, 'y');
});

test('turning is pure — it does not rewrite what it was given', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const focal = { x: 0.7, y: 0.3 };
  const before = JSON.stringify({ crop, focal });
  turnFraming(crop, focal, 90);
  assert.equal(JSON.stringify({ crop, focal }), before);
});

test('turning by nothing changes nothing', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const focal = { x: 0.7, y: 0.3 };
  for (const by of [0, 360, null, undefined, NaN, 'sideways']) {
    assert.deepEqual(turnFraming(crop, focal, by), { crop, focal }, String(by));
  }
});


// ── Brightness and contrast ───────────────────────────────────────
// Held as numbers and applied at render, like crop and rotation. The card, the lightbox
// and the editor's preview all read this one function, so what is set is what is seen.

test('an untouched photo sets no filter at all', () => {
  // '' rather than "brightness(1) contrast(1)": the common case should not create a
  // compositing layer on every photo in the timeline for no visible effect.
  assert.equal(lightFilter({ brightness: 1, contrast: 1 }), '');
  assert.equal(lightFilter({}), '');
  assert.equal(lightFilter(null), '');
});

test('an adjustment becomes a filter', () => {
  assert.equal(lightFilter({ brightness: 1.2, contrast: 0.9 }), 'brightness(1.2) contrast(0.9)');
});

test('one adjusted still carries the other, so the filter is complete', () => {
  assert.equal(lightFilter({ brightness: 1.2 }), 'brightness(1.2) contrast(1)');
  assert.equal(lightFilter({ contrast: 0.8 }), 'brightness(1) contrast(0.8)');
});

test('a stored 0 is NEUTRAL, not black', () => {
  // THE MIGRATION TRAP. Adding a `number` field backfills every existing row with 0, so
  // reading 0 as a real brightness would turn the whole scrapbook black on deploy. The
  // migration backfills 1; this is what makes the window between deploy and migrate
  // harmless, and covers anything writing a row without these fields.
  assert.equal(lightFilter({ brightness: 0, contrast: 0 }), '');
  assert.equal(adjustmentsOf({ brightness: 0 }).brightness, 1);
});

test('nonsense reads as neutral rather than breaking the photo', () => {
  assert.equal(lightFilter({ brightness: NaN, contrast: 'bright' }), '');
  assert.equal(lightFilter({ brightness: undefined }), '');
});

test('extremes are clamped to something still recognisable as the photo', () => {
  assert.equal(lightFilter({ brightness: 99, contrast: 99 }), 'brightness(2) contrast(2)');
  assert.equal(lightFilter({ brightness: -5, contrast: 0.01 }), 'brightness(0.2) contrast(0.2)');
});

test('adjustmentsOf always answers with both, whatever it was given', () => {
  assert.deepEqual(adjustmentsOf(undefined), { brightness: 1, contrast: 1 });
  assert.deepEqual(adjustmentsOf({ brightness: 1.5, contrast: 0.7 }), { brightness: 1.5, contrast: 0.7 });
});
