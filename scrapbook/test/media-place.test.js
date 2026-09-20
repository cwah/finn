// Reading where a photograph was taken.
//
//   npm test
//
// EXIF stores coordinates in a way nobody would choose: degrees, minutes and seconds, each
// a pair of 32-bit integers to be divided, with the hemisphere in a SEPARATE tag as a
// letter. Every one of those is a chance to be silently wrong — a missed division gives a
// plausible-looking number in the wrong country, and a dropped hemisphere puts a family
// holiday in the southern ocean.
//
// So the parser is tested against real bytes, built here rather than described.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exifLocation, distinctPlaces, agreedPlace, placeLabel } from '../js/media-place.js';

/** A JPEG carrying a GPS IFD, assembled byte by byte. */
function jpegWithGps({ lat = [40, 40, 4152], lon = [73, 56, 3912], latRef = 'N', lonRef = 'W',
                       endian = 'big' } = {}) {
  const parts = [];
  const be = endian === 'big';
  const u16 = (v) => (be ? [(v >> 8) & 0xff, v & 0xff] : [v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v) => (be
    ? [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
    : [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  // Seconds are stored over 100 so a fraction survives whole numbers.
  const rational = (n, d) => [...u32(n), ...u32(d)];

  // EIGHT bytes: the byte-order mark, the magic 42, and the offset of IFD0. Writing only
  // the first four misaligns everything after it — which is what this fixture did at
  // first, and it read as a broken parser rather than a broken fixture.
  const tiff = [...(be ? [0x4d, 0x4d, 0x00, 0x2a] : [0x49, 0x49, 0x2a, 0x00]), ...u32(8)];
  const ifd0At = 8;
  const gpsAt = ifd0At + 2 + 12 + 4;
  const blockAt = gpsAt + 2 + (4 * 12) + 4;
  const latAt = blockAt;
  const lonAt = blockAt + 24;

  const ifd0 = [...u16(1), ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsAt), ...u32(0)];
  const ascii = (ch) => (be ? [ch.charCodeAt(0), 0, 0, 0] : [ch.charCodeAt(0), 0, 0, 0]);
  const gps = [
    ...u16(4),
    ...u16(0x0001), ...u16(2), ...u32(2), ...ascii(latRef),
    ...u16(0x0002), ...u16(5), ...u32(3), ...u32(latAt),
    ...u16(0x0003), ...u16(2), ...u32(2), ...ascii(lonRef),
    ...u16(0x0004), ...u16(5), ...u32(3), ...u32(lonAt),
    ...u32(0),
  ];
  const block = [
    ...rational(lat[0], 1), ...rational(lat[1], 1), ...rational(lat[2], 100),
    ...rational(lon[0], 1), ...rational(lon[1], 1), ...rational(lon[2], 100),
  ];

  const body = [...tiff, ...ifd0, ...gps, ...block];
  const size = body.length + 8;
  parts.push(0xff, 0xd8);                                    // SOI
  parts.push(0xff, 0xe1, (size >> 8) & 0xff, size & 0xff);   // APP1
  parts.push(...[...'Exif'].map((c) => c.charCodeAt(0)), 0, 0);
  parts.push(...body, 0xff, 0xd9);                           // EOI
  return new Uint8Array(parts);
}

test('coordinates come back as degrees, from degrees/minutes/seconds', () => {
  // 40° 40' 41.52" N, 73° 56' 39.12" W — Brooklyn. A parser that forgot to divide the
  // minutes would answer 40.67 vs 80.67 and look almost right.
  const at = exifLocation(jpegWithGps());
  assert.ok(at, 'should find a location');
  assert.ok(Math.abs(at.lat - 40.6782) < 0.001, `lat was ${at.lat}`);
  assert.ok(Math.abs(at.lon + 73.9442) < 0.001, `lon was ${at.lon}`);
});

test('the hemisphere letters are obeyed', () => {
  // Dropping these puts a northern summer in the southern ocean, with no error anywhere.
  const south = exifLocation(jpegWithGps({ latRef: 'S', lonRef: 'E' }));
  assert.ok(south.lat < 0, 'S must be negative');
  assert.ok(south.lon > 0, 'E must be positive');
});

test('little-endian EXIF reads the same as big-endian', () => {
  // Both are seen in the wild; phones differ.
  const big = exifLocation(jpegWithGps({ endian: 'big' }));
  const little = exifLocation(jpegWithGps({ endian: 'little' }));
  assert.ok(Math.abs(big.lat - little.lat) < 0.0001);
  assert.ok(Math.abs(big.lon - little.lon) < 0.0001);
});

test('a photo with no GPS is simply unknown', () => {
  // Most photographs have none, and that is not a failure.
  const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(exifLocation(plain), null);
});

test('nonsense in never becomes a place', () => {
  for (const junk of [null, undefined, new Uint8Array(0), new Uint8Array([1, 2, 3]),
    new Uint8Array(64)]) {
    assert.equal(exifLocation(junk), null);
  }
});

test('a camera with no fix writes zeroes, and zero is not a place', () => {
  // Null Island, off the coast of Ghana, is where a GPS chip says it is when it does not
  // know. Trusting it would put a memory in the Gulf of Guinea.
  const nowhere = exifLocation(jpegWithGps({ lat: [0, 0, 0], lon: [0, 0, 0] }));
  assert.equal(nowhere, null);
});

test('impossible coordinates are refused', () => {
  assert.equal(exifLocation(jpegWithGps({ lat: [95, 0, 0] })), null);
  assert.equal(exifLocation(jpegWithGps({ lon: [200, 0, 0] })), null);
});

// ── Agreeing, the way dates do ────────────────────────────────────

const place = (name, region = 'NY', country = 'US') => ({ name, region, country });

test('photos from one town agree', () => {
  const all = [place('Brooklyn'), place('Brooklyn'), place('Brooklyn')];
  assert.equal(placeLabel(agreedPlace(all)), 'Brooklyn, NY');
});

test('photos from two towns do not, and both are offered', () => {
  // The same bargain as the dates: no right answer to pick, so pick none and offer both.
  const all = [place('Brooklyn'), place('Hoboken', 'NJ')];
  assert.equal(agreedPlace(all), null);
  assert.equal(distinctPlaces(all).length, 2);
});

test('photos without coordinates do not count as disagreement', () => {
  // Most of a post will have no place at all; that must not stop the one that does.
  const all = [place('Brooklyn'), null, undefined, place('Brooklyn')];
  assert.equal(placeLabel(agreedPlace(all)), 'Brooklyn, NY');
});

test('the same town in two countries is two places', () => {
  const all = [place('Springfield', 'IL', 'US'), place('Springfield', '', 'AU')];
  assert.equal(distinctPlaces(all).length, 2);
});

test('a label falls back to the country when there is no region', () => {
  assert.equal(placeLabel(place('Paris', '', 'FR')), 'Paris, FR');
  assert.equal(placeLabel({ name: 'Somewhere' }), 'Somewhere');
  assert.equal(placeLabel(null), '');
});
