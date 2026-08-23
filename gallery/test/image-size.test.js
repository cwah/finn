// Measuring a file. The failure this pins is silent and specific: a phone photo of a
// portrait drawing measures as landscape, because a JPEG's frame header records the
// size BEFORE the EXIF rotation that the browser will apply when it renders it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, exifOrientation } from '../tools/image-size.js';

/** A JPEG with a frame header, and optionally an EXIF orientation before it. */
function jpeg({ width, height, orientation = null, littleEndian = true }) {
  const parts = [Buffer.from([0xff, 0xd8])];

  if (orientation != null) {
    const tiff = Buffer.alloc(8 + 2 + 12 + 4);
    let at = 0;
    if (littleEndian) { tiff.write('II', at); tiff.writeUInt16LE(42, at + 2); tiff.writeUInt32LE(8, at + 4); }
    else { tiff.write('MM', at); tiff.writeUInt16BE(42, at + 2); tiff.writeUInt32BE(8, at + 4); }
    at = 8;
    const w16 = (v, o) => (littleEndian ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
    const w32 = (v, o) => (littleEndian ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
    w16(1, at);                    // one entry
    w16(0x0112, at + 2);           // Orientation
    w16(3, at + 4);                // type SHORT
    w32(1, at + 6);                // count
    w16(orientation, at + 10);     // the value, at the START of the value field
    w32(0, at + 14);               // no next IFD

    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const app1 = Buffer.alloc(4);
    app1.writeUInt8(0xff, 0); app1.writeUInt8(0xe1, 1);
    app1.writeUInt16BE(body.length + 2, 2);
    parts.push(app1, body);
  }

  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0); sof.writeUInt8(0xc0, 1);
  sof.writeUInt16BE(8, 2);          // segment length
  sof.writeUInt8(8, 4);             // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

test('a plain jpeg reports the dimensions in its frame header', () => {
  const size = imageSize(jpeg({ width: 2048, height: 1536 }));
  assert.equal(size.width, 2048);
  assert.equal(size.height, 1536);
  assert.equal(size.orientation, null);
});

test('an upright orientation leaves the dimensions alone', () => {
  const size = imageSize(jpeg({ width: 2048, height: 1536, orientation: 1 }));
  assert.deepEqual([size.width, size.height], [2048, 1536]);
});

test('a quarter-turned photo reports the size the BROWSER will lay out, not the header size', () => {
  // This is the whole point of the file. Orientation 6 is a phone held upright.
  for (const orientation of [5, 6, 7, 8]) {
    const size = imageSize(jpeg({ width: 2048, height: 1536, orientation }));
    assert.deepEqual([size.width, size.height], [1536, 2048], `orientation ${orientation}`);
  }
});

test('a flipped but unturned photo keeps its dimensions', () => {
  for (const orientation of [2, 3, 4]) {
    const size = imageSize(jpeg({ width: 2048, height: 1536, orientation }));
    assert.deepEqual([size.width, size.height], [2048, 1536], `orientation ${orientation}`);
  }
});

test('orientation is read under either byte order, since both are seen in the wild', () => {
  assert.equal(exifOrientation(jpeg({ width: 10, height: 20, orientation: 6, littleEndian: true })), 6);
  assert.equal(exifOrientation(jpeg({ width: 10, height: 20, orientation: 6, littleEndian: false })), 6);
});

test('a png is measured from its IHDR chunk', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.write('IHDR', 12);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(600, 20);
  assert.deepEqual(imageSize(png), { width: 800, height: 600, orientation: null });
});

test('an svg is measured from its width and height attributes', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="600"></svg>');
  const size = imageSize(svg);
  assert.deepEqual([size.width, size.height], [2400, 600]);
});

test('an svg sized only by its viewBox still yields a usable ratio', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"></svg>');
  const size = imageSize(svg);
  assert.deepEqual([size.width, size.height], [300, 400]);
});

test('a file that cannot be measured says so rather than guessing', () => {
  assert.equal(imageSize(Buffer.from('not an image at all')), null);
  assert.equal(imageSize(Buffer.alloc(4)), null);
  assert.equal(imageSize(null), null);
});
