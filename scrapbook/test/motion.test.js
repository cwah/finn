// Motion photos arrive in two shapes and neither announces itself. Apple splits a Live
// Photo into two files that only a matching name ties together; Google appends an mp4 to
// the end of a jpeg. Both have to be recognised from what the file picker hands over.
//
//   npm test

// Pinned BEFORE anything constructs a Date. The UTC-vs-local bug in mp4CreatedAt is
// invisible from a machine running in UTC — the two readings agree there — so a suite that
// inherits the runner's zone would have passed on the broken code and would pass again on
// the next regression. node:test gives each file its own process, so this is local to here.
process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pairLivePhotos, findEmbeddedVideo, looksLikeMotion, MOTION_MAX_SECONDS, mp4Duration,
  mp4CreatedAt,
} from '../js/motion.js';

const f = (name) => ({ name });

// ── Live Photos: two files, one memory ────────────────────────────
test('a still and its movie become one motion photo', () => {
  const out = pairLivePhotos([f('IMG_1234.HEIC'), f('IMG_1234.MOV')]);
  assert.equal(out.length, 1, 'two files, one memory');
  assert.equal(out[0].motion, true);
  assert.equal(out[0].still.name, 'IMG_1234.HEIC');
  assert.equal(out[0].video.name, 'IMG_1234.MOV');
});

test('the movie may arrive first — picker order is not promised', () => {
  const out = pairLivePhotos([f('IMG_1234.MOV'), f('IMG_1234.HEIC')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].motion, true);
});

test('matching ignores case and extension, since only the stem is shared', () => {
  const out = pairLivePhotos([f('img_1234.jpg'), f('IMG_1234.mov')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].motion, true);
});

test('a lone still is a photo and a lone movie is a video', () => {
  const out = pairLivePhotos([f('IMG_1.HEIC'), f('clip.mp4')]);
  assert.deepEqual(out.map((e) => e.motion), [false, false]);
  assert.equal(out[0].still.name, 'IMG_1.HEIC');
  assert.equal(out[1].video.name, 'clip.mp4');
  assert.equal(out[1].still, undefined, 'a video has no still of its own yet');
});

test('several Live Photos at once each keep their own movie', () => {
  const out = pairLivePhotos([
    f('IMG_1.HEIC'), f('IMG_2.HEIC'), f('IMG_1.MOV'), f('IMG_2.MOV'),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.video.name), ['IMG_1.MOV', 'IMG_2.MOV']);
});

test('a claimed movie never also appears on its own', () => {
  // The bug this guards: the still comes after the movie, so the first pass over the list
  // cannot yet know the movie is spoken for.
  const out = pairLivePhotos([f('IMG_1234.MOV'), f('IMG_1234.JPG'), f('other.mp4')]);
  assert.equal(out.length, 2);
  assert.equal(out.filter((e) => e.video?.name === 'IMG_1234.MOV').length, 1);
});

test('order follows the picker, so the lead photo is the one chosen first', () => {
  const out = pairLivePhotos([f('b.jpg'), f('a.jpg'), f('a.mov')]);
  assert.deepEqual(out.map((e) => e.still.name), ['b.jpg', 'a.jpg']);
});

test('nothing to pair is not an error', () => {
  assert.deepEqual(pairLivePhotos([]), []);
  assert.deepEqual(pairLivePhotos(null), []);
  assert.deepEqual(pairLivePhotos([null, undefined]), []);
});

// ── Google motion photos: one file, two halves ────────────────────
/** A jpeg of `padding` bytes, then an mp4 box of `videoBytes`. */
function motionPhoto(padding, videoBytes = 64) {
  const bytes = new Uint8Array(padding + videoBytes);
  bytes[0] = 0xff; bytes[1] = 0xd8; // jpeg SOI, so the still half is plausible
  const size = videoBytes;
  bytes[padding] = (size >>> 24) & 0xff;
  bytes[padding + 1] = (size >>> 16) & 0xff;
  bytes[padding + 2] = (size >>> 8) & 0xff;
  bytes[padding + 3] = size & 0xff;
  bytes.set([0x66, 0x74, 0x79, 0x70], padding + 4); // 'ftyp'
  return bytes;
}

test('the appended mp4 is found, and the split point is where it starts', () => {
  const found = findEmbeddedVideo(motionPhoto(2048));
  assert.deepEqual(found, { offset: 2048, length: 64 });
});

test('an ordinary photo has no video in it', () => {
  const jpeg = new Uint8Array(4096).fill(0x42);
  jpeg[0] = 0xff; jpeg[1] = 0xd8;
  assert.equal(findEmbeddedVideo(jpeg), null);
});

test('a box whose length runs past the end of the file is not a video', () => {
  // Four bytes reading 'ftyp' inside image data would otherwise split a photo in half.
  const bytes = motionPhoto(1024);
  bytes[1024] = 0x7f; // claim an enormous box
  assert.equal(findEmbeddedVideo(bytes), null);
});

test('a plain mp4 is not an EMBEDDED video', () => {
  assert.equal(findEmbeddedVideo(motionPhoto(0, 128)), null);
});

test('junk in, null out — never an exception', () => {
  for (const junk of [null, undefined, new Uint8Array(0), new Uint8Array(11)]) {
    assert.equal(findEmbeddedVideo(junk), null);
  }
});

// ── Motion or video ───────────────────────────────────────────────
test('a moment either side of the shutter is motion; anything longer is a video', () => {
  assert.equal(looksLikeMotion(1.5), true);
  assert.equal(looksLikeMotion(MOTION_MAX_SECONDS), true);
  assert.equal(looksLikeMotion(MOTION_MAX_SECONDS + 0.1), false);
  assert.equal(looksLikeMotion(45), false);
});

test('an unknown duration is not motion — it would loop forever on a guess', () => {
  for (const nothing of [0, -1, null, undefined, NaN, 'short']) {
    assert.equal(looksLikeMotion(nothing), false, String(nothing));
  }
});

// ── How long a clip runs ──────────────────────────────────────────
// The bot cannot decode video, but the length is stated in the mvhd box rather than
// hidden in the frames. Reading it matters more than it sounds: a stored duration of 0
// makes trimRange() report nothing playable and the card falls back to a still, so a
// motion photo that split perfectly still renders as a photo.

const b32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** An mp4 whose moov/mvhd states `duration` ticks at `timescale` ticks per second. */
function mp4({ duration, timescale, version = 0, leadingBoxes = true }) {
  const mvhdBody = version === 1
    ? [1, 0, 0, 0, ...Array(16).fill(0), ...b32(timescale), 0, 0, 0, 0, ...b32(duration)]
    : [0, 0, 0, 0, ...Array(8).fill(0), ...b32(timescale), ...b32(duration)];
  const mvhd = [...b32(mvhdBody.length + 8), 0x6d, 0x76, 0x68, 0x64, ...mvhdBody];
  const moov = [...b32(mvhd.length + 8), 0x6d, 0x6f, 0x6f, 0x76, ...mvhd];

  // A real file has ftyp and a large mdat before moov — the walk has to step over them.
  const ftyp = [...b32(16), 0x66, 0x74, 0x79, 0x70, ...Array(8).fill(0)];
  const mdat = [...b32(64), 0x6d, 0x64, 0x61, 0x74, ...Array(56).fill(0x11)];
  return new Uint8Array(leadingBoxes ? [...ftyp, ...mdat, ...moov] : moov);
}

test('the length is read from the header, past the boxes before it', () => {
  assert.equal(mp4Duration(mp4({ duration: 1400, timescale: 1000 })), 1.4);
  assert.equal(mp4Duration(mp4({ duration: 90000, timescale: 30000 })), 3);
});

test('a 64-bit header states its length the same way', () => {
  assert.equal(mp4Duration(mp4({ duration: 2334, timescale: 1000, version: 1 })), 2.334);
});

test('moov is found wherever it sits — phones put it last', () => {
  assert.equal(mp4Duration(mp4({ duration: 5000, timescale: 1000, leadingBoxes: false })), 5);
});

test('an unreadable length is 0, never a guess', () => {
  // 0 is what the bot checks to decide it cannot store a playable clip at all.
  assert.equal(mp4Duration(mp4({ duration: 0, timescale: 1000 })), 0);
  assert.equal(mp4Duration(mp4({ duration: 1000, timescale: 0 })), 0);
  assert.equal(mp4Duration(mp4({ duration: 0xffffffff, timescale: 1000 })), 0,
    'the unknown-duration sentinel is not a real length');
});

test('junk in, zero out — never an exception', () => {
  for (const junk of [null, undefined, new Uint8Array(0), new Uint8Array(15),
    new Uint8Array(512), new Uint8Array([...Array(64).fill(0xff)])]) {
    assert.equal(mp4Duration(junk), 0);
  }
});

test('a truncated file does not loop forever or throw', () => {
  const full = mp4({ duration: 1400, timescale: 1000 });
  for (let cut = 0; cut < full.length; cut += 1) {
    const d = mp4Duration(full.subarray(0, cut));
    assert.ok(d === 0 || d === 1.4, `cut at ${cut} gave ${d}`);
  }
});

test('a box claiming to run past the end of the file is refused', () => {
  const bytes = mp4({ duration: 1400, timescale: 1000 });
  bytes[0] = 0x7f; // ftyp now claims an enormous size
  assert.equal(mp4Duration(bytes), 0);
});


// ── When a clip was recorded ──────────────────────────────────────
// mvhd counts seconds from 1904-01-01 UTC. What comes back must be the LOCAL calendar day,
// because that is what every other date in this codebase is — including the send date it
// gets compared against.

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/**
 * A minimal moov/mvhd holding one instant.
 *
 * A version-0 mvhd body is 20 bytes — version+flags, creation, modification, timescale,
 * duration — and the reader requires at least 12 of them before it will look. A shorter
 * one is simply refused, which is correct of it and was wrong of the first draft here.
 */
function clipAt(date) {
  const secs = Math.floor(date.getTime() / 1000) + 2082844800;
  const body = [
    0, 0, 0, 0,        // version 0 + flags
    ...u32(secs),      // creation_time
    ...u32(secs),      // modification_time
    ...u32(1000),      // timescale
    ...u32(8000),      // duration
  ];
  const mvhd = [...u32(8 + body.length), 0x6d, 0x76, 0x68, 0x64, ...body];
  return Uint8Array.from([...u32(8 + mvhd.length), 0x6d, 0x6f, 0x6f, 0x76, ...mvhd]);
}

/** Where creation_time sits: moov header, mvhd header, then version+flags. */
const CREATION_AT = 8 + 8 + 4;

test('a clip is dated by the local day it was recorded', () => {
  const noon = new Date(2026, 7, 10, 12, 0, 0); // local, unambiguous in any zone
  assert.equal(mp4CreatedAt(clipAt(noon)), '2026-08-10');
});

test('an evening clip stays on the evening it happened', () => {
  // THE BUG. Read as a UTC day, 19:35 on the 10th in Los Angeles comes back as the 11th —
  // which then looks like a camera clock claiming tomorrow and is discarded outright, so
  // it surfaced as "the date was not inferred" rather than as a date one day off.
  const evening = new Date(2026, 7, 10, 19, 35, 43);
  assert.equal(mp4CreatedAt(clipAt(evening)), '2026-08-10');
});

test('an early-morning clip does not slip to the day before', () => {
  // The mirror image, for anywhere east of Greenwich.
  const earlyHours = new Date(2026, 7, 11, 0, 20, 0);
  assert.equal(mp4CreatedAt(clipAt(earlyHours)), '2026-08-11');
});

test('the last minute of a day belongs to that day', () => {
  assert.equal(mp4CreatedAt(clipAt(new Date(2026, 7, 10, 23, 59, 59))), '2026-08-10');
  assert.equal(mp4CreatedAt(clipAt(new Date(2026, 7, 11, 0, 0, 0))), '2026-08-11');
});

test('an encoder that did not know the time says nothing', () => {
  // 0 means "unset", not 1904 — a memory from the Edwardian era is not the answer.
  const zeroed = clipAt(new Date(2026, 7, 10, 12, 0, 0));
  zeroed.set([0, 0, 0, 0], CREATION_AT);
  assert.equal(mp4CreatedAt(zeroed), null);
});

test('an implausible year is not a date', () => {
  assert.equal(mp4CreatedAt(clipAt(new Date(1970, 0, 2))), null);
});

test('nothing readable is null, not a throw', () => {
  assert.equal(mp4CreatedAt(null), null);
  assert.equal(mp4CreatedAt(new Uint8Array(4)), null);
  assert.equal(mp4CreatedAt(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    13, 14, 15, 16, 17, 18])), null, 'no moov box at all');
});
