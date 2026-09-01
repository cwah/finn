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
