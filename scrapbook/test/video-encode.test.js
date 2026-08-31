// How big a display copy should be, and whether to make one at all.
//
//   npm test
//
// The recorder itself is not tested here and cannot be: it needs a video to play through
// in real time in a foreground tab. What IS testable is every decision taken before a
// frame is drawn, which is where the mistakes that produce an unplayable file live.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSize, bitrateFor, needsEncoding, estimateSeconds, VIDEO_EDGE, WORTH_ENCODING_BYTES,
} from '../js/video-encode.js';

// ── Frame size ────────────────────────────────────────────────────
test('4K comes down to 1080p', () => {
  assert.deepEqual(encodeSize(3840, 2160), { width: 1920, height: 1080, scaled: true });
});

test('portrait phone video is bounded by its height', () => {
  const out = encodeSize(2160, 3840);
  assert.equal(out.height, 1920);
  assert.equal(out.scaled, true);
});

test('EVERY dimension is even', () => {
  // H.264 stores chroma at half resolution per axis, so an odd side has no legal
  // representation. Encoders round, refuse, or emit a green edge — and none of it shows
  // up until someone tries to play the memory back.
  for (const [w, h] of [[1921, 1081], [1079, 1919], [641, 361], [3841, 2161], [15, 9]]) {
    const out = encodeSize(w, h);
    assert.equal(out.width % 2, 0, `${w}x${h} gave an odd width ${out.width}`);
    assert.equal(out.height % 2, 0, `${w}x${h} gave an odd height ${out.height}`);
  }
});

test('shape is kept within a pixel of the source', () => {
  const out = encodeSize(4080, 3072);
  assert.ok(Math.abs((out.width / out.height) - (4080 / 3072)) < 0.01);
});

test('a clip already small enough is not enlarged', () => {
  // Asking an encoder for more pixels than the source has is asking it to invent them.
  assert.deepEqual(encodeSize(1280, 720), { width: 1280, height: 720, scaled: false });
});

test('rounding is DOWN, never up past the source', () => {
  const out = encodeSize(1922, 1082);
  assert.ok(out.width <= 1922 && out.height <= 1082);
});

test('nothing in, nothing out — never a zero-by-something canvas', () => {
  assert.deepEqual(encodeSize(0, 0), { width: 0, height: 0, scaled: false });
  assert.deepEqual(encodeSize(NaN, 100), { width: 0, height: 0, scaled: false });
});

test('a sliver of a clip still has two pixels to encode', () => {
  const out = encodeSize(4000, 3);
  assert.ok(out.height >= 2, `short side was ${out.height}`);
  assert.equal(out.height % 2, 0);
});

// ── Bitrate ───────────────────────────────────────────────────────
test('bitrate follows the frame size', () => {
  assert.ok(bitrateFor(1920, 1080) > bitrateFor(640, 480));
});

test('1080p lands in a sane H.264 range', () => {
  const b = bitrateFor(1920, 1080);
  assert.ok(b >= 3_000_000 && b <= 6_000_000, `got ${b}`);
});

test('a tiny clip is not starved, a huge one is not indulged', () => {
  assert.ok(bitrateFor(64, 64) >= 800_000);
  assert.ok(bitrateFor(7680, 4320) <= 8_000_000);
});

test('no dimensions still yields a usable number, not NaN', () => {
  assert.ok(Number.isFinite(bitrateFor(0, 0)));
});

// ── Whether to bother ─────────────────────────────────────────────
const MB = 1024 * 1024;

test('a big 4K clip is re-encoded', () => {
  assert.equal(needsEncoding({ width: 3840, height: 2160, size: 58 * MB }), true);
});

test('a long clip at modest size is re-encoded on bytes alone', () => {
  assert.equal(needsEncoding({ width: 1280, height: 720, size: 40 * MB }), true);
});

test('a motion photo passes straight through', () => {
  // A second or two, already tiny. Re-encoding it is a generation of loss to save
  // nothing, and on a phone it is a wait for nothing — encoding runs in real time.
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 2 * MB }), false);
});

test('the size threshold is where it says it is', () => {
  assert.equal(needsEncoding({ width: 800, height: 600, size: WORTH_ENCODING_BYTES + 1 }), true);
  assert.equal(needsEncoding({ width: 800, height: 600, size: WORTH_ENCODING_BYTES - 1 }), false);
});

// ── Telling the parent how long ───────────────────────────────────
test('an estimate is real time plus a little', () => {
  // Encoding consumes frames as the video plays them, so it cannot beat real time. Saying
  // so is what stops a twenty-second wait looking like a hang.
  assert.ok(estimateSeconds(24) >= 24);
  assert.ok(estimateSeconds(24) < 40);
});

test('no duration, no estimate', () => {
  assert.equal(estimateSeconds(0), 0);
  assert.equal(estimateSeconds(undefined), 0);
});

test('the display edge is 1080p, which is more than any view here shows', () => {
  assert.equal(VIDEO_EDGE, 1920);
});

// ── Failing safe ──────────────────────────────────────────────────
// The recorder cannot be exercised here — it needs a clip to play through in real time in
// a foreground tab. What CAN be pinned is that every way out hands the original back, so
// a memory is never lost to a failed optimisation. These run with no DOM at all, which is
// itself one of the failure modes.

import { toDisplayCopy } from '../js/video-encode.js';

const fakeClip = (bytes = 8 * 1024 * 1024) => ({
  name: 'PXL_20260811_023543.mp4',
  size: bytes,
  type: 'video/mp4',
  lastModified: 1_700_000_000_000,
});

test('with no MediaRecorder at all, the original comes straight back', () => {
  // Node has none, which is exactly the shape of an old browser.
  return toDisplayCopy(fakeClip()).then((out) => {
    assert.equal(out.file.name, 'PXL_20260811_023543.mp4');
    assert.equal(out.encoded, false);
  });
});

test('a failure never throws — it degrades', async () => {
  // The whole contract. A bigger file is a disappointment; an exception here would be a
  // memory that refused to save, and those are not the same thing.
  const out = await toDisplayCopy(null);
  assert.equal(out.encoded, false);
  assert.equal(out.file, null);
});

test('the result always has the fields the caller reads', async () => {
  const out = await toDisplayCopy(fakeClip());
  for (const key of ['file', 'width', 'height', 'encoded']) {
    assert.ok(key in out, `missing ${key}`);
  }
  assert.equal(typeof out.encoded, 'boolean');
});
