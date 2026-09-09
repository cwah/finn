// Saying that a clip was shortened.
//
//   npm test
//
// A video longer than the cap is accepted and truncated, never refused — refusing sends a
// parent back to their phone with nothing saved, over a limit they had no way to know
// about. But truncating SILENTLY is its own failure: the first thirty seconds of a
// two-minute clip is frequently the wrong thirty, and the one thing that must not happen
// is finding out later by watching it back.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clipNotice, truncatedClips, MAX_CLIP_SECONDS } from '../js/clip-limit.js';

const clip = (duration, extra = {}) => ({ duration, ...extra });

test('a clip inside the cap says nothing at all', () => {
  // Silence is the common case and has to stay silent, or the notice becomes furniture
  // that nobody reads on the day it matters.
  assert.equal(clipNotice([clip(12), clip(MAX_CLIP_SECONDS)]), null);
});

test('no media at all says nothing', () => {
  assert.equal(clipNotice([]), null);
  assert.equal(clipNotice(), null);
});

test('a photo is not a clip', () => {
  assert.equal(clipNotice([{ width: 100, height: 100 }]), null);
});

test('a long clip is named, with its real length', () => {
  const msg = clipNotice([clip(126.4)]);
  assert.match(msg, /126.4s/);
  assert.match(msg, new RegExp(`${MAX_CLIP_SECONDS} seconds`));
});

test('the notice says what to DO, not just what happened', () => {
  // The trim window can be moved to any thirty seconds, and cropping first avoids the
  // question — a limit stated without a remedy just reads as a refusal.
  const msg = clipNotice([clip(90)]);
  assert.match(msg, /trim/i);
  assert.match(msg, /Photos/);
});

test('several long clips are counted, not listed one by one', () => {
  const msg = clipNotice([clip(90), clip(200), clip(45)]);
  assert.match(msg, /3 videos/);
});

test('only the long ones are counted', () => {
  const msg = clipNotice([clip(90), clip(5), clip(200), clip(1)]);
  assert.match(msg, /2 videos/);
});

test('a motion photo is never counted', () => {
  // It is a still that moves for a moment. Its length is whatever the phone recorded
  // around the shutter — nobody chose it, and nobody can crop it.
  assert.equal(clipNotice([clip(600, { motion: true })]), null);
  assert.deepEqual(truncatedClips([clip(600, { motion: true })]), []);
});

test('a hair over the cap is not worth saying', () => {
  // A phone reporting 30.02 seconds for a thirty-second clip is not news.
  assert.equal(clipNotice([clip(MAX_CLIP_SECONDS + 0.05)]), null);
  assert.ok(clipNotice([clip(MAX_CLIP_SECONDS + 5)]));
});

test('a missing or nonsense duration is not announced', () => {
  // Duration arrives from a decoded file and is occasionally absent. Guessing "too long"
  // from a NaN would tell someone their clip was cut when it was not.
  for (const odd of [clip(undefined), clip(null), clip('long'), clip(NaN), clip(Infinity), {}]) {
    assert.equal(clipNotice([odd]), null, JSON.stringify(odd));
  }
});

test('whole seconds read without a pointless decimal', () => {
  assert.match(clipNotice([clip(90)]), /\b90s\b/);
});

// ── When the browser cannot shrink a video at all ─────────────────
// FOUND ON AN ANDROID EMULATOR, and invisible from a desktop. MediaRecorder has to be able
// to produce MP4/H.264; Android Chrome 124 cannot, so pickMimeType() returns null and
// toDisplayCopy hands the original straight back. Everything downstream then behaves
// exactly as designed — the clip uploads whole, the trim stays metadata, nothing errors —
// and forty megabytes go up a phone connection with nothing said. A big enough clip is how
// an upload fails twice for no visible reason.
//
// WebM is deliberately not accepted instead: MediaRecorder offers it almost everywhere,
// but iPhones cannot play it, and a memory that stores fine and will not play on half the
// family's phones is worse than a large one that plays everywhere.

import { shrinkNotice, mediaNotices } from '../js/clip-limit.js';

/** Control what the browser admits to supporting. */
function recorder(supported) {
  globalThis.MediaRecorder = supported
    ? { isTypeSupported: (t) => t.startsWith('video/mp4') }
    : { isTypeSupported: () => false };
}

const bigClip = (over = {}) => ({
  duration: 20,
  width: 3840,
  height: 2160,
  videoFile: { size: 43 * 1024 * 1024 },
  ...over,
});

test('a browser that CAN shrink says nothing', () => {
  recorder(true);
  assert.equal(shrinkNotice([bigClip()]), null);
});

test('a browser that cannot says so, with the real size', () => {
  recorder(false);
  const msg = shrinkNotice([bigClip()]);
  assert.match(msg, /cannot be made smaller/i);
  assert.match(msg, /43 MB/);
});

test('it says what to do about it', () => {
  // A limit stated without a remedy reads as a refusal.
  recorder(false);
  const msg = shrinkNotice([bigClip()]);
  assert.match(msg, /computer|Photos/);
});

test('a motion photo is never counted', () => {
  // Never re-encoded by design, so its size is not a problem this notice can solve.
  recorder(false);
  assert.equal(shrinkNotice([bigClip({ motion: true })]), null);
});

test('a small clip is not worth mentioning', () => {
  // needsEncoding already decides what is worth shrinking; if it would not have been
  // shrunk anyway, not being able to shrink it costs nothing.
  recorder(false);
  assert.equal(shrinkNotice([bigClip({ width: 640, height: 480, videoFile: { size: 300 * 1024 } })]), null);
});

test('a photo is not a video', () => {
  recorder(false);
  assert.equal(shrinkNotice([{ file: { size: 9e9 }, width: 4000, height: 3000 }]), null);
});

test('several stuck clips are counted and their sizes added up', () => {
  recorder(false);
  const msg = shrinkNotice([bigClip(), bigClip()]);
  assert.match(msg, /Those 2 videos/);
  assert.match(msg, /86 MB/);
});

test('no MediaRecorder at all is handled', () => {
  delete globalThis.MediaRecorder;
  assert.doesNotThrow(() => shrinkNotice([bigClip()]));
});

test('both notices can appear together', () => {
  // A clip over the cap, in a browser that also cannot shrink it: two different facts
  // about the same file, and a parent should hear both.
  recorder(false);
  const long = bigClip({ duration: 120 });
  const both = mediaNotices([long]);
  assert.equal(both.length, 2);
  assert.match(both[0], /only the first 30 seconds/);
  assert.match(both[1], /cannot be made smaller/);
});

test('mediaNotices is empty when there is nothing to say', () => {
  recorder(true);
  assert.deepEqual(mediaNotices([bigClip({ duration: 5 })]), []);
  assert.deepEqual(mediaNotices([]), []);
});
