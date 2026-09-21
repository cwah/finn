// Ordering a day by when things actually happened.
//
//   npm test
//
// REPORTED: posts containing photographs from an evening appeared in the wrong part of
// their day, beside ones from that morning.
//
// The timeline is ordered by `memoryDate`, which is a DAY. Within a day it fell back to
// `created` — when the post was typed up — and those are not the same thing. Photographs
// from an evening, written up the next morning, sat above photographs from that morning
// written up later still, so the day read backwards.
//
// The time was never missing. EXIF writes "YYYY:MM:DD HH:MM:SS" and the reader took the
// first ten characters, because only the day had ever been wanted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { happenedAt, exifDateTime, exifDate } from '../js/media-date.js';
import { insertionIndex } from '../js/sync.js';

const NOON = '2026-08-17T12:00:00.000Z';
const item = (takenOn, clock) => ({
  takenOn,
  takenTime: clock ? new Date(`2026-08-17T${clock}`).toISOString() : null,
});

test('the most recent photograph decides', () => {
  // The same rule the DATE uses: a set of photographs is one memory, and it belongs at the
  // moment it finished happening.
  const when = happenedAt(
    [item('2026-08-17', '09:15:00'), item('2026-08-17', '19:42:00'), item('2026-08-17', '13:00:00')],
    '2026-08-17', NOON,
  );
  assert.equal(when, new Date('2026-08-17T19:42:00').toISOString());
});

test('an evening post sorts above a morning one, whenever they were written up', () => {
  // THE BUG, as an ordering. Both posts are filed on the same day; the evening one must
  // come first in a newest-first timeline regardless of which was typed up first.
  const morning = happenedAt([item('2026-08-17', '08:30:00')], '2026-08-17', NOON);
  const evening = happenedAt([item('2026-08-17', '20:10:00')], '2026-08-17', NOON);
  assert.ok(evening > morning, 'the evening memory must sort later in the day');
});

test('media from another day do not decide this one', () => {
  // A parent who backdates a post, or corrects a wrong date, has said something the files
  // have not — and a clock from some other day says nothing about where this sits.
  const when = happenedAt([item('2026-08-14', '19:00:00')], '2026-08-17', NOON);
  assert.equal(when, NOON, 'the fallback should stand');
});

test('media with no clock fall back too', () => {
  // A filename gives a day at best, and lastModified is when the file landed on the
  // device rather than when the shutter went.
  assert.equal(happenedAt([item('2026-08-17', null)], '2026-08-17', NOON), NOON);
  assert.equal(happenedAt([], '2026-08-17', NOON), NOON);
  assert.equal(happenedAt(null, '2026-08-17', NOON), NOON);
});

test('one photograph with a clock is enough, among many without', () => {
  const when = happenedAt(
    [item('2026-08-17', null), item('2026-08-17', '17:05:00'), { takenOn: '2026-08-17' }],
    '2026-08-17', NOON,
  );
  assert.equal(when, new Date('2026-08-17T17:05:00').toISOString());
});

test('nonsense never becomes a timestamp', () => {
  for (const bad of [{ takenOn: '2026-08-17', takenTime: 'lunchtime' },
    { takenOn: '2026-08-17', takenTime: '' }, null, undefined]) {
    assert.equal(happenedAt([bad], '2026-08-17', NOON), NOON);
  }
});

// ── Reading the clock out of EXIF ─────────────────────────────────

/** A JPEG whose DateTimeOriginal says exactly this. */
function jpegDated(text) {
  const ascii = [...text].map((c) => c.charCodeAt(0));
  const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];
  const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, ...u32(8)];
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 12 + 4;
  const textAt = exifAt + 2 + 12 + 4;
  const ifd0 = [...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt), ...u32(0)];
  const exif = [...u16(1), ...u16(0x9003), ...u16(2), ...u32(ascii.length + 1),
    ...u32(textAt), ...u32(0)];
  const body = [...tiff, ...ifd0, ...exif, ...ascii, 0];
  const size = body.length + 8;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (size >> 8) & 0xff, size & 0xff,
    ...[...'Exif'].map((c) => c.charCodeAt(0)), 0, 0, ...body, 0xff, 0xd9]);
}

test('the clock is read, not just the day', () => {
  const bytes = jpegDated('2026:08:17 19:42:11');
  assert.equal(exifDate(bytes), '2026-08-17', 'the day must still work');
  const when = new Date(exifDateTime(bytes));
  assert.equal(when.getHours(), 19);
  assert.equal(when.getMinutes(), 42);
  assert.equal(when.getSeconds(), 11);
});

test('two photographs an hour apart are an hour apart', () => {
  // The point of reading it at all.
  const early = new Date(exifDateTime(jpegDated('2026:08:17 08:00:00')));
  const late = new Date(exifDateTime(jpegDated('2026:08:17 09:00:00')));
  assert.equal(late - early, 60 * 60 * 1000);
});

test('a photograph with no EXIF has no time', () => {
  assert.equal(exifDateTime(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});

// ── Placing a card that arrives while you are looking ─────────────

test('a new card lands in the right part of its day', () => {
  // Without this it went to the end of its day whatever its photographs said.
  const dates = ['2026-08-18', '2026-08-17', '2026-08-17', '2026-08-16'];
  const times = ['2026-08-18T10:00:00Z', '2026-08-17T20:00:00Z', '2026-08-17T08:00:00Z',
    '2026-08-16T10:00:00Z'];
  // An afternoon memory belongs between the evening one and the morning one.
  assert.equal(insertionIndex(dates, '2026-08-17', times, '2026-08-17T14:00:00Z'), 2);
  // An earlier one than both goes after them, still inside its day.
  assert.equal(insertionIndex(dates, '2026-08-17', times, '2026-08-17T06:00:00Z'), 3);
  // A later one than both goes to the top of its day.
  assert.equal(insertionIndex(dates, '2026-08-17', times, '2026-08-17T23:00:00Z'), 1);
});

test('a different day is still placed by day alone', () => {
  const dates = ['2026-08-18', '2026-08-16'];
  const times = ['2026-08-18T10:00:00Z', '2026-08-16T10:00:00Z'];
  assert.equal(insertionIndex(dates, '2026-08-17', times, '2026-08-17T12:00:00Z'), 1);
});

test('cards with no time of their own are not reordered around', () => {
  // Older posts carry whatever the backfill gave them; one that somehow has nothing must
  // not be jumped over on a guess.
  const dates = ['2026-08-17', '2026-08-17'];
  assert.equal(insertionIndex(dates, '2026-08-17', ['', ''], '2026-08-17T23:00:00Z'), 2);
});

test('it still works with no times at all, as it did before', () => {
  assert.equal(insertionIndex(['2026-08-18', '2026-08-16'], '2026-08-17'), 1);
  assert.equal(insertionIndex([], '2026-08-17'), 0);
});
