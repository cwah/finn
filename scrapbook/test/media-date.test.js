// When a memory actually happened, read from the media rather than from when it was sent.
// A photo taken on Friday and sent on Sunday belongs on Friday.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filenameDate, exifDate, latestDate, agreedDate, distinctDates } from '../js/media-date.js';

// ── The camera's filename ─────────────────────────────────────────
test('the date a camera wrote into the filename is read', () => {
  assert.equal(filenameDate('PXL_20260807_123456789.MP.jpg'), '2026-08-07');
  assert.equal(filenameDate('IMG_20260814_101112.jpg'), '2026-08-14');
  assert.equal(filenameDate('VID_20260814_101112.mp4'), '2026-08-14');
  assert.equal(filenameDate('20260814_1011.jpg'), '2026-08-14');
});

test('a filename with no date in it gives nothing', () => {
  for (const name of ['file_5.jpg', 'IMG_1234.HEIC', 'photo.png', '', null, undefined]) {
    assert.equal(filenameDate(name), null, JSON.stringify(name));
  }
});

test('eight digits that are not a date are refused', () => {
  // A serial number must not become a memory's date.
  assert.equal(filenameDate('IMG_99999999.jpg'), null);
  assert.equal(filenameDate('20261332_1011.jpg'), null, 'no thirteenth month');
  assert.equal(filenameDate('20260230_1011.jpg'), null, 'February has no 30th');
  assert.equal(filenameDate('19991231_1011.jpg'), null, 'before any plausible baby photo');
});

// ── EXIF ──────────────────────────────────────────────────────────
/**
 * A jpeg carrying an APP1/Exif block whose DateTimeOriginal is `stamp`.
 * @param {string} stamp "YYYY:MM:DD HH:MM:SS"
 */
function jpegWithExif(stamp, { little = true, tag = 0x9003 } = {}) {
  const out = [0xff, 0xd8]; // SOI
  const tiff = [];
  const u16 = (n) => (little ? [n & 255, (n >> 8) & 255] : [(n >> 8) & 255, n & 255]);
  const u32 = (n) => (little
    ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]
    : [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);

  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));

  // IFD0: one entry pointing at the Exif sub-IFD, which sits right after it.
  const ifd0At = 8;
  const ifd0Size = 2 + 12 + 4;
  const subAt = ifd0At + ifd0Size;
  const subSize = 2 + 12 + 4;
  const stampAt = subAt + subSize;

  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(subAt), ...u32(0));
  tiff.push(...u16(1), ...u16(tag), ...u16(2), ...u32(20), ...u32(stampAt), ...u32(0));
  for (const ch of `${stamp}\0`) tiff.push(ch.charCodeAt(0));

  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0" + tiff
  out.push(0xff, 0xe1, ...u16BE(payload.length + 2), ...payload);
  out.push(0xff, 0xda); // start of scan
  return new Uint8Array(out);
}
const u16BE = (n) => [(n >> 8) & 255, n & 255];

test('the photographer’s own timestamp is read from EXIF', () => {
  assert.equal(exifDate(jpegWithExif('2026:08:07 14:32:11')), '2026-08-07');
});

test('EXIF is read whichever byte order the camera wrote', () => {
  // Both are seen in the wild, and the TIFF header declares which.
  assert.equal(exifDate(jpegWithExif('2026:08:07 14:32:11', { little: true })), '2026-08-07');
  assert.equal(exifDate(jpegWithExif('2026:08:07 14:32:11', { little: false })), '2026-08-07');
});

test('a file with no EXIF gives nothing rather than a guess', () => {
  const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xda, 0, 0, 0, 0, 0, 0]);
  assert.equal(exifDate(plain), null);
});

test('a nonsensical EXIF date is refused', () => {
  assert.equal(exifDate(jpegWithExif('2026:13:07 14:32:11')), null);
  assert.equal(exifDate(jpegWithExif('1998:08:07 14:32:11')), null, 'an unset clock');
  assert.equal(exifDate(jpegWithExif('notadate hh:mm:ss')), null);
});

test('junk in, null out — never an exception', () => {
  for (const junk of [null, undefined, new Uint8Array(0), new Uint8Array(15),
    new Uint8Array(512).fill(0xff)]) {
    assert.equal(exifDate(junk), null);
  }
});

test('a truncated jpeg does not loop forever or throw', () => {
  const full = jpegWithExif('2026:08:07 14:32:11');
  for (let cut = 0; cut < full.length; cut += 1) {
    const got = exifDate(full.subarray(0, cut));
    assert.ok(got === null || got === '2026-08-07', `cut at ${cut} gave ${got}`);
  }
});

// ── Which of several items dates the post ─────────────────────────
test('the most recent item dates the memory', () => {
  // A set of photos is one memory, and it belongs on the day it finished happening.
  assert.equal(latestDate(['2026-08-05', '2026-08-07', '2026-08-06']), '2026-08-07');
});

test('items with no date of their own are simply skipped', () => {
  assert.equal(latestDate([null, '2026-08-05', undefined]), '2026-08-05');
});

test('nothing datable gives nothing', () => {
  assert.equal(latestDate([]), null);
  assert.equal(latestDate([null, null]), null);
  assert.equal(latestDate(null), null);
});

test('a late-night photo is why EXIF outranks the filename', () => {
  // Google names files in UTC; EXIF records local time. A photo taken at 22:32 on the
  // 17th is named for the 18th, so preferring the filename would file it a day late.
  // Checked against real photos: 11 of 13 agreed, and both disagreements were the
  // filename being wrong. fetchItem reads EXIF first for exactly this reason.
  assert.equal(exifDate(jpegWithExif('2026:03:17 22:32:31')), '2026-03-17');
  assert.equal(filenameDate('PXL_20260318_023231976.jpg'), '2026-03-18');
});

// ── Whether a set of media can date a memory ──────────────────────
test('one item with a date, dates the memory', () => {
  assert.equal(agreedDate(['2026-08-07']), '2026-08-07');
});

test('several from the same day date it too', () => {
  // An afternoon's photos share a day, and that day is the memory.
  assert.equal(agreedDate(['2026-08-07', '2026-08-07', '2026-08-07']), '2026-08-07');
});

test('several from different days date nothing', () => {
  // There is no single answer, so it must not invent one.
  assert.equal(agreedDate(['2026-08-07', '2026-08-09']), null);
  assert.equal(agreedDate(['2026-08-09', '2026-08-07', '2026-08-07']), null);
});

test('one unreadable item spoils the agreement', () => {
  // Not "the others agree, so use theirs": the unreadable one may be from another day
  // entirely, and quietly ignoring it would date the memory on a guess.
  assert.equal(agreedDate([null]), null);
  assert.equal(agreedDate(['2026-08-07', null]), null);
  assert.equal(agreedDate([null, '2026-08-07']), null);
});

test('nothing attached, nothing inferred', () => {
  assert.equal(agreedDate([]), null);
  assert.equal(agreedDate(null), null);
  assert.equal(agreedDate(undefined), null);
});

// ── What there was to choose from ─────────────────────────────────
test('one day is one day, however many photos', () => {
  assert.deepEqual(distinctDates(['2026-08-07', '2026-08-07', '2026-08-07']), ['2026-08-07']);
});

test('several days come back oldest first', () => {
  // Ascending so the bot can say "8/7 to 8/9" without sorting it again at the call site.
  assert.deepEqual(
    distinctDates(['2026-08-09', '2026-08-07', '2026-08-09']),
    ['2026-08-07', '2026-08-09'],
  );
});

test('unreadable items are not a day', () => {
  // An absence of evidence, not evidence of another day: one photo and one blank spans
  // one day, and telling a parent otherwise invites them to hunt for a second.
  assert.deepEqual(distinctDates(['2026-08-07', null]), ['2026-08-07']);
  assert.deepEqual(distinctDates([null, null]), []);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(distinctDates([]), []);
  assert.deepEqual(distinctDates(null), []);
});
