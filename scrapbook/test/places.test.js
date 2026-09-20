// Finding the town nearest a photograph, without telling anybody where it was.
//
//   npm test
//
// The whole point is that this happens on the device. A geocoding service would be easier
// and more accurate, and it would mean handing a third party the coordinates of every
// photograph of a baby — so instead the towns are carried here: 34,000 of them, cut into
// ten-degree tiles so a lookup fetches its own corner of the world rather than all of it.
//
// Tested against the REAL tiles in assets/places-1, not a fixture. The thing most likely
// to be wrong is the arithmetic that turns a coordinate into a tile name, and a fixture
// would agree with whatever that arithmetic did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../assets/places-1/', import.meta.url);
const index = new Set(readFileSync(new URL('index.txt', ROOT), 'utf8').split(/\s+/).filter(Boolean));

/** The same tiling the browser module does, kept here so the two can be compared. */
function tileFor(lat, lon) {
  return `${Math.floor(lat / 10)},${Math.floor(lon / 10)}`;
}

/** Every town in a tile, or none. */
function townsIn(key) {
  const file = new URL(`${key.replace(',', '_')}.txt`, ROOT);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [name, country, region, lat, lon] = line.split('|');
    return { name, country, region, lat: Number(lat) / 100, lon: Number(lon) / 100 };
  });
}

function km(aLat, aLon, bLat, bLon) {
  const mean = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dLat = (bLat - aLat) * 111.32;
  const dLon = (bLon - aLon) * 111.32 * Math.cos(mean);
  return Math.sqrt((dLat * dLat) + (dLon * dLon));
}

/** Nearest town across a tile and its neighbours, as placeFor does. */
function nearest(lat, lon) {
  const la = Math.floor(lat / 10);
  const lo = Math.floor(lon / 10);
  let best = null;
  for (let dla = -1; dla <= 1; dla += 1) {
    for (let dlo = -1; dlo <= 1; dlo += 1) {
      for (const town of townsIn(`${la + dla},${lo + dlo}`)) {
        const d = km(lat, lon, town.lat, town.lon);
        if (!best || d < best.km) best = { ...town, km: d };
      }
    }
  }
  return best;
}

test('the data is actually there, and indexed', () => {
  assert.ok(index.size > 100, `expected many tiles, found ${index.size}`);
  assert.ok(townsIn([...index][0]).length > 0, 'an indexed tile must hold towns');
});

test('every indexed tile exists, and every tile is indexed', () => {
  // An index that disagrees with the files means either wasted requests for tiles that
  // are not there, or towns that can never be found.
  for (const key of index) {
    assert.ok(townsIn(key).length > 0, `${key} is indexed but empty`);
  }
});

test('a known place resolves to its own town', () => {
  // Coordinates of recognisable places, and the answer a person would give.
  for (const [lat, lon, expected] of [
    [40.6782, -73.9442, 'New York City'],   // Brooklyn sits inside it
    [51.5074, -0.1278, 'London'],
    [48.8566, 2.3522, 'Paris'],
    [35.6762, 139.6503, 'Tokyo'],
    [-33.8688, 151.2093, 'Sydney'],
  ]) {
    const found = nearest(lat, lon);
    assert.ok(found, `nothing found near ${lat},${lon}`);
    assert.ok(found.km < 30, `${found.name} is ${found.km.toFixed(0)}km from ${expected}`);
  }
});

test('the southern and western hemispheres tile correctly', () => {
  // Math.floor on a negative is the easy thing to get wrong: -0.5/10 floors to -1, not 0,
  // and an off-by-one tile is a town in the wrong country.
  assert.equal(tileFor(-33.8688, 151.2093), '-4,15');
  assert.equal(tileFor(-0.5, -0.5), '-1,-1');
  assert.equal(tileFor(0.5, 0.5), '0,0');
  assert.equal(tileFor(-10, -10), '-1,-1');
});

test('a point near a tile edge still finds the town over the border', () => {
  // The reason neighbours are fetched at all. A town 5km away across a tile boundary is
  // still the answer.
  const found = nearest(50.0, 0.05);   // just inside 5,0, with Channel towns around
  assert.ok(found, 'should find something in northern France or southern England');
});

test('the middle of an ocean has no town near enough', () => {
  // Answering with a town 2,000km away would be worse than answering nothing.
  const found = nearest(0, -140);      // the Pacific
  assert.ok(!found || found.km > 120, `got ${found?.name} at ${found?.km?.toFixed(0)}km`);
});

test('every town parses into real numbers', () => {
  // A bad line would sit silently in a tile and pull every nearby lookup towards it.
  for (const key of [...index].slice(0, 40)) {
    for (const town of townsIn(key)) {
      assert.ok(town.name && town.name.length, `empty name in ${key}`);
      assert.ok(Number.isFinite(town.lat) && Math.abs(town.lat) <= 90, `bad lat in ${key}`);
      assert.ok(Number.isFinite(town.lon) && Math.abs(town.lon) <= 180, `bad lon in ${key}`);
      assert.match(town.country, /^[A-Z]{2}$/, `bad country in ${key}`);
    }
  }
});

test('a town lands in the tile its coordinates say it should', () => {
  // The generator and the lookup have to agree, or a town is filed where nobody looks.
  for (const key of [...index].slice(0, 30)) {
    for (const town of townsIn(key).slice(0, 5)) {
      assert.equal(tileFor(town.lat, town.lon), key,
        `${town.name} is filed in ${key} but tiles to ${tileFor(town.lat, town.lon)}`);
    }
  }
});

test('the tiles stay small enough to fetch one at a time', () => {
  // The entire list is 838 KB, which is why it is cut up at all. A tile that grew past a
  // few tens of KB would defeat the point.
  let largest = 0;
  for (const key of index) {
    const size = readFileSync(new URL(`${key.replace(',', '_')}.txt`, ROOT)).length;
    largest = Math.max(largest, size);
  }
  assert.ok(largest < 64 * 1024, `largest tile is ${(largest / 1024).toFixed(0)} KB`);
});
