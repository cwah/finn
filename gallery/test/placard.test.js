// The wall label. Most of this file is about lines that should NOT appear: an empty
// element still carries its margin, so a missing field leaves a gap that reads as a
// layout bug rather than as an unknown.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageAt, yearOf, artistLine, accessionOf, placardLines } from '../js/placard.js';

const BIRTH = '2020-04-11';
const CONFIG = { artistName: 'Finn', birthDate: BIRTH, showAge: true, creditLine: 'Gift of the artist' };
const ART = {
  id: 'the-long-cat', title: 'The Long Cat', createdOn: '2025-11-30',
  medium: 'Pencil on cardboard', dimensions: '6 × 24 in', note: 'A stretch.',
};

test('a date after the birthday this year counts the full year', () => {
  assert.equal(ageAt(BIRTH, '2025-11-30'), 5);
  assert.equal(ageAt(BIRTH, '2025-04-11'), 5);
});

test('a date before the birthday this year borrows a year back', () => {
  assert.equal(ageAt(BIRTH, '2025-04-10'), 4);
  assert.equal(ageAt(BIRTH, '2025-01-01'), 4);
});

test('a date before the artist was born gives no age rather than a negative one', () => {
  // A mistyped year in the manifest is exactly how "Finn, age -1" would ship.
  assert.equal(ageAt(BIRTH, '2019-06-01'), null);
});

test('a malformed or missing date gives no age rather than NaN', () => {
  for (const value of ['', 'yesterday', '2025-13', null, undefined, '30/11/2025']) {
    assert.equal(ageAt(BIRTH, value), null, `${value}`);
    assert.equal(ageAt(value, '2025-11-30'), null, `${value}`);
  }
});

test('the year comes from the date, unless the manifest states one', () => {
  assert.equal(yearOf(ART), '2025');
  assert.equal(yearOf({ ...ART, yearLabel: '2025–2026' }), '2025–2026');
  assert.equal(yearOf({ createdOn: 'unknown' }), null);
});

test('the artist line carries the age when it can be worked out', () => {
  assert.equal(artistLine(ART, CONFIG), 'Finn, age 5');
});

test('the artist line drops the age when the gallery turns it off or the date is bad', () => {
  assert.equal(artistLine(ART, { ...CONFIG, showAge: false }), 'Finn');
  assert.equal(artistLine({ createdOn: 'nope' }, CONFIG), 'Finn');
});

test('a stamped age is used when there is no birthDate to derive one from', () => {
  // The PocketBase path: birthDate is private and never reaches the public API, so the
  // admin stamps whole years onto the drawing instead.
  const pb = { ...ART, ageYears: 5 };
  assert.equal(artistLine(pb, { artistName: 'Finn', showAge: true }), 'Finn, age 5');
});

test('a derived age beats a stamped one, because it cannot go stale', () => {
  const stale = { ...ART, ageYears: 99 };
  assert.equal(artistLine(stale, CONFIG), 'Finn, age 5');
});

test('showAge false hides the age whichever source it came from', () => {
  const pb = { ...ART, ageYears: 5 };
  assert.equal(artistLine(pb, { artistName: 'Finn', showAge: false }), 'Finn');
});

test('an accession number is derived from the position within its year', () => {
  const all = [
    { id: 'a', createdOn: '2025-02-01' },
    { id: 'b', createdOn: '2025-09-09' },
    { id: 'c', createdOn: '2026-01-01' },
  ];
  assert.equal(accessionOf(all[0], all), '2025.001');
  assert.equal(accessionOf(all[1], all), '2025.002');
  assert.equal(accessionOf(all[2], all), '2026.001');
});

test('an accession number written in the manifest wins over the derived one', () => {
  assert.equal(accessionOf({ ...ART, accession: '1998.42' }, [ART]), '1998.42');
});

test('a placard omits every line it has nothing to say for', () => {
  const bare = placardLines({ id: 'x', title: 'Untitled Study' }, { artistName: 'Finn' }, []);
  assert.equal(bare.title, 'Untitled Study');
  assert.equal(bare.medium, null);
  assert.equal(bare.dimensions, null);
  assert.equal(bare.note, null);
  assert.equal(bare.year, null);
});

test('a piece with no title is called Untitled rather than left blank', () => {
  assert.equal(placardLines({ id: 'x' }, CONFIG, []).title, 'Untitled');
});

test('a full placard reads the way a museum label does', () => {
  const lines = placardLines(ART, CONFIG, [ART]);
  assert.equal(lines.title, 'The Long Cat');
  assert.equal(lines.artist, 'Finn, age 5');
  assert.equal(lines.year, '2025');
  assert.equal(lines.credit, 'Gift of the artist, 2025  ·  2025.001');
});
