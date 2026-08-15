// Reading a photo's dimensions from its own header bytes. Node has no canvas, and every
// layout in this app is chosen from stored width/height — so an image the bot cannot
// measure is one it cannot post.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { imageSize } from '../bot/image-size.js';

/** A JPEG carrying one segment before its frame header, to prove the walk works. */
function jpeg(width, height, { marker = 0xc0, withExif = true } = {}) {
  const parts = [0xff, 0xd8]; // SOI
  if (withExif) {
    // APP1/Exif is what a phone actually puts first, and it has to be walked PAST —
    // its payload contains bytes that would otherwise look like a frame header.
    const payload = [0, 64, ...Array(62).fill(0xc0)];
    parts.push(0xff, 0xe1, ...payload);
  }
  parts.push(0xff, marker, 0, 17, 8,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  return new Uint8Array(parts);
}

function png(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  const put32 = (at, v) => bytes.set([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], at);
  put32(16, width);
  put32(20, height);
  return bytes;
}

test('a jpeg reports its size, past the exif segment a phone puts first', () => {
  assert.deepEqual(imageSize(jpeg(4032, 3024)), { width: 4032, height: 3024 });
});

test('a jpeg with no exif works too', () => {
  assert.deepEqual(imageSize(jpeg(800, 600, { withExif: false })), { width: 800, height: 600 });
});

test('progressive and other frame headers are all frame headers', () => {
  // SOF0 baseline, SOF1, SOF2 progressive — a phone may write any of them.
  for (const marker of [0xc0, 0xc1, 0xc2, 0xc3]) {
    assert.deepEqual(imageSize(jpeg(1200, 900, { marker })), { width: 1200, height: 900 },
      `SOF marker 0x${marker.toString(16)}`);
  }
});

test('markers that are NOT frame headers do not report a size', () => {
  // 0xC4 is a Huffman table, not a frame. Reading it as one gives nonsense dimensions.
  assert.equal(imageSize(jpeg(1200, 900, { marker: 0xc4, withExif: false })), null);
});

test('a png reports its size from IHDR', () => {
  assert.deepEqual(imageSize(png(1536, 2752)), { width: 1536, height: 2752 });
});

test('height and width are not transposed', () => {
  // The jpeg header stores HEIGHT first, which is the easy thing to get backwards.
  const tall = imageSize(jpeg(900, 1600));
  assert.equal(tall.width, 900);
  assert.equal(tall.height, 1600);
  assert.ok(tall.height > tall.width, 'a portrait must not come back as a landscape');
});

test('a format we cannot read says so rather than guessing', () => {
  const heic = new Uint8Array(64);
  heic.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0); // ftypheic
  assert.equal(imageSize(heic), null);
});

test('junk in, null out — never an exception', () => {
  for (const junk of [null, undefined, new Uint8Array(0), new Uint8Array(23),
    new Uint8Array(4096)]) {
    assert.equal(imageSize(junk), null);
  }
});

test('a truncated jpeg does not loop forever or throw', () => {
  const full = jpeg(4032, 3024);
  for (let cut = 24; cut < full.length; cut += 1) {
    const size = imageSize(full.subarray(0, cut));
    assert.ok(size === null || (size.width > 0 && size.height > 0), `cut at ${cut}`);
  }
});

test('a zero dimension is as unusable as none at all', () => {
  assert.equal(imageSize(jpeg(0, 100, { withExif: false })), null);
  assert.equal(imageSize(png(100, 0)), null);
});
