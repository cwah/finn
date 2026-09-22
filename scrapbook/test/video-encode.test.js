// How big a display copy should be, and whether to make one at all.
//
//   npm test
//
// The recorder itself is not tested here and cannot be: it needs a video to play through
// in real time in a foreground tab. What IS testable is every decision taken before a
// frame is drawn, which is where the mistakes that produce an unplayable file live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  encodeSize, bitrateFor, needsEncoding, estimateSeconds, toDisplayCopy,
  VIDEO_EDGE, WORTH_ENCODING_BYTES,
} from '../js/video-encode.js';

// ── Frame size ────────────────────────────────────────────────────
test('4K comes down to 720p', () => {
  assert.deepEqual(encodeSize(3840, 2160), { width: 1280, height: 720, scaled: true });
});

test('portrait phone video is bounded by its height', () => {
  const out = encodeSize(2160, 3840);
  assert.equal(out.height, 1280);
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

test('a wasteful motion photo IS encoded now', () => {
  // It deliberately was not, on the grounds that these are short and play unprompted, so a
  // size rule put a four-second wait on the commonest thing anyone posts to save a couple
  // of megabytes.
  //
  // Measured against the real library, those couple of megabytes are the whole problem: a
  // Pixel writes them at around fourteen megabits a second — 2.3 MB for 1.4 seconds — and
  // they AUTOPLAY, so every viewer scrolling the timeline pays for every one. The poster
  // waits two seconds once. With a monthly bandwidth limit reached, that trade inverted.
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 2.3 * MB, duration: 1.4, motion: true }), true);
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 4.1 * MB, duration: 2.3, motion: true }), true);
});

test('a motion photo already thrifty is still left alone', () => {
  // Real examples too: 0.6 MB for 2.0 seconds is 2.5 Mbps, which is below what this app
  // would re-encode TO. Putting it through a generation of loss would gain nothing.
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 0.6 * MB, duration: 2.0, motion: true }), false);
});

test('a small clip that is not a motion photo also passes through', () => {
  // 2 MB over 10 seconds is 1.6 Mbps — already modest.
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 2 * MB, duration: 10 }), false);
});

test('a short clip that is small but extravagant is caught', () => {
  // THE CASE THE SIZE RULE MISSED. Under any sensible byte threshold, and still costing
  // several times what it needs to.
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 2.5 * MB, duration: 1.5 }), true);
});

test('with no duration to judge by, size decides as it always did', () => {
  // Duration comes from a decode, and a caller may not have one yet.
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 40 * MB }), true);
  assert.equal(needsEncoding({ width: 1080, height: 1440, size: 1 * MB }), false);
});

test('big dimensions alone are not a reason to re-encode', () => {
  // They were, and with a 720p edge that fired on every portrait phone clip — including
  // ones already cheaper than anything this would produce. Re-encoding those costs a
  // generation of quality and saves nothing. encodeSize still bounds whatever IS encoded.
  assert.equal(needsEncoding({ width: 3840, height: 2160, size: 1 * MB, duration: 10 }), false);
});

test('a motion photo is declined without even decoding it', async () => {
  // The cheapest exit there is: no <video>, no metadata wait, no decode.
  const out = await toDisplayCopy({ name: 'live.mp4', size: 40 * MB }, { motion: true });
  assert.equal(out.encoded, false);
  assert.equal(out.file.name, 'live.mp4');
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

test('the display edge is 720p, which is more than any view here shows', () => {
  // A card is at most 560 CSS px and the expanded view is fitted to the screen. 1080p was
  // paying for detail no surface in this app displays — at 1080p the same clip costs
  // 16 MB for thirty seconds, at 720p about 7.
  assert.equal(VIDEO_EDGE, 1280);
});

// ── Failing safe ──────────────────────────────────────────────────
// The recorder cannot be exercised here — it needs a clip to play through in real time in
// a foreground tab. What CAN be pinned is that every way out hands the original back, so
// a memory is never lost to a failed optimisation. These run with no DOM at all, which is
// itself one of the failure modes.


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

// ── Encoding only the window ──────────────────────────────────────
// Encoding is real time, so the length of the window IS the wait. Encoding a whole
// three-minute file to show thirty seconds of it cost a parent three minutes for two and a
// half minutes nobody could ever watch — the cap means the rest is unreachable.

test('the encoder accepts a window to encode', () => {
  // A signature check, not a behaviour one: node has no MediaRecorder, so the encode
  // itself cannot run here. What is worth pinning is that the option exists and is named
  // as the caller in prepare-upload.js expects.
  const src = readFileSync(new URL('../js/video-encode.js', import.meta.url), 'utf8');
  assert.match(src, /start = 0, end = Infinity/, 'toDisplayCopy must take a window');
});

test('the draw loop stops at the end of the window, not the end of the file', () => {
  const src = readFileSync(new URL('../js/video-encode.js', import.meta.url), 'utf8');
  assert.match(src, /video\.currentTime >= to/,
    'without this it plays the whole file and the window buys nothing');
});

test('the stall ceiling is sized to the window, not the source', () => {
  // A thirty-second window out of a two-hour file must not be given two hours of rope
  // before it is called stalled.
  const src = readFileSync(new URL('../js/video-encode.js', import.meta.url), 'utf8');
  assert.match(src, /span \* 3000/);
  assert.doesNotMatch(src, /video\.duration \|\| 0\) \* 3000/);
});

test('it seeks to the start before recording', () => {
  // Recording from a decoder still sitting at frame zero captures the wrong opening, and
  // on a long file that is a second or two of the wrong thing.
  const src = readFileSync(new URL('../js/video-encode.js', import.meta.url), 'utf8');
  assert.match(src, /once\(video, 'seeked'/);
});
