// What the compose sheet hands to the uploader.
//
//   npm test
//
// Clips are reduced at SAVE, not when they are picked. Encoding is real time — the clip is
// played through a canvas — so encoding on the way in charged a parent the length of the
// whole film before the editor would open, and encoded minutes the cap means nobody can
// ever watch. Waiting until save means the trim is known, so only the stretch that will
// play has to be encoded, and the wait is bounded by MAX_CLIP_SECONDS however long the
// source was.
//
// The dangerous part is the bookkeeping, not the encoding. Once the file IS the window,
// the numbers that produced it must not be applied to it a second time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node has no MediaRecorder and no document, so the real encoder declines and hands the
// file back unencoded. That is exactly the path worth testing here: the bookkeeping around
// the encode, which is where a mistake silently ruins a memory. The encoder itself is
// covered by video-encode.test.js.
import { prepareForUpload } from '../js/prepare-upload.js';
import { trimRange } from '../js/layout-engine.js';
import { MAX_CLIP_SECONDS } from '../js/clip-limit.js';

const clip = (over = {}) => ({
  videoFile: { name: 'in.mov', size: 50 * 1024 * 1024 },
  duration: 180,
  trimStart: 0,
  trimEnd: 30,
  ...over,
});

test('a photo passes through untouched', async () => {
  const photo = { file: { name: 'a.jpg' }, width: 100, height: 100 };
  const [out] = await prepareForUpload([photo]);
  assert.equal(out, photo, 'the very same object — nothing to do');
});

test('a motion photo is never re-encoded', async () => {
  // It is a still that moves for a moment. Encoding it would cost a decode to gain
  // nothing, and it is the one clip that plays unbidden on the timeline.
  const m = clip({ motion: true });
  const [out] = await prepareForUpload([m]);
  assert.equal(out, m);
});

test('an item already encoded is left alone', async () => {
  // Re-saving after a failed upload must not encode a second time — that is a generation
  // of quality for nothing, and with a baked trim it would cut the clip twice.
  const done = clip({ encoded: true });
  const [out] = await prepareForUpload([done]);
  assert.equal(out, done);
});

test('a clip with no playable window at all is left alone', async () => {
  for (const bad of [clip({ duration: 0, trimEnd: 0 }), clip({ duration: 'soon' })]) {
    const [out] = await prepareForUpload([bad]);
    assert.equal(out, bad, JSON.stringify({ d: bad.duration, e: bad.trimEnd }));
  }
});

test('THE WINDOW IS CAPPED, however the trim arrived', () => {
  // The guarantee the whole change rests on: the wait is bounded by MAX_CLIP_SECONDS no
  // matter how long the source is. A missing or backwards trimEnd means "from here on",
  // and reimplementing that arithmetic by hand is how a three-minute clip would quietly
  // get encoded in full again — which is the bug being fixed.
  for (const odd of [
    { duration: 180, trimStart: 0, trimEnd: undefined },
    { duration: 180, trimStart: 5, trimEnd: 5 },       // zero-length
    { duration: 180, trimStart: 90, trimEnd: 10 },     // backwards
    { duration: 180, trimStart: 0, trimEnd: 999 },     // past the end
    { duration: 180, trimStart: 0, trimEnd: 180 },     // the whole film
  ]) {
    const window = trimRange(odd);
    assert.ok(window.duration <= MAX_CLIP_SECONDS,
      `${JSON.stringify(odd)} -> ${window.duration}s would be encoded`);
  }
});

test('a trim is never applied twice', () => {
  // Once the stored file IS the window, the numbers that produced it must not be applied
  // to it again. Thirty seconds cut from 1:30 and then re-trimmed at 90-120 would leave a
  // memory that is three seconds of itself, and nothing would report an error.
  const cut = { duration: 30, trimStart: 0, trimEnd: 30 };   // what prepareOne writes back
  assert.deepEqual(trimRange(cut), { start: 0, end: 30, duration: 30 });
});

test('the input array is never mutated', async () => {
  // If a save fails the sheet stays open holding these, and pressing Save again must
  // re-cut from the ORIGINAL rather than trim an already-trimmed clip.
  const items = [clip({ trimStart: 10, trimEnd: 40 })];
  const before = JSON.stringify(items.map((i) => ({ ...i, videoFile: null })));
  await prepareForUpload(items);
  const after = JSON.stringify(items.map((i) => ({ ...i, videoFile: null })));
  assert.equal(after, before, 'prepareForUpload must return a new array, not edit this one');
});

test('items keep their order', async () => {
  const items = [clip(), { file: { name: 'a.jpg' } }, clip({ trimStart: 5, trimEnd: 20 })];
  const out = await prepareForUpload(items);
  assert.equal(out.length, 3);
  assert.equal(out[1], items[1]);
});

test('nothing at all is fine', async () => {
  assert.deepEqual(await prepareForUpload([]), []);
  assert.deepEqual(await prepareForUpload(), []);
});
