// Age is never stored per post — it is always derived from one configured birthDate.
// The month-borrow path and the local-vs-UTC date parsing are the two things most
// likely to break quietly, so both are covered here.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ageStamp, dateLabel } from '../js/age.js';

const BIRTH = '2026-01-15';

test('the birth day itself reads as Newborn', () => {
  assert.equal(ageStamp(BIRTH, '2026-01-15'), 'Newborn');
});

test('days-only ages are singular and plural correctly', () => {
  assert.equal(ageStamp(BIRTH, '2026-01-16'), '1 day');
  assert.equal(ageStamp(BIRTH, '2026-01-17'), '2 days');
});

test('an exact month boundary omits the days part', () => {
  assert.equal(ageStamp(BIRTH, '2026-02-15'), '1 month');
  assert.equal(ageStamp(BIRTH, '2026-04-15'), '3 months');
});

test('months and days combine', () => {
  assert.equal(ageStamp(BIRTH, '2026-03-30'), '2 months, 15 days');
  assert.equal(ageStamp(BIRTH, '2026-05-12'), '3 months, 27 days');
});

test('a day-of-month earlier than the birth day borrows a month', () => {
  // Feb 14 has not reached the 15th, so this is 30 days, not "1 month, -1 days".
  assert.equal(ageStamp(BIRTH, '2026-02-14'), '30 days');
});

test('borrowing works across a year boundary', () => {
  assert.equal(ageStamp(BIRTH, '2027-01-14'), '11 months, 30 days');
  assert.equal(ageStamp(BIRTH, '2027-01-15'), '12 months');
});

test('borrowing uses the real length of the preceding month', () => {
  // Borrowed month is February 2026 (28 days), not a flat 30.
  assert.equal(ageStamp('2026-01-31', '2026-03-01'), '1 month, 1 day');
});

test('a leap-day birth still yields a sane stamp', () => {
  assert.equal(ageStamp('2024-02-29', '2024-03-29'), '1 month');
});

test('a memory dated before the birth yields no stamp', () => {
  assert.equal(ageStamp(BIRTH, '2026-01-14'), '');
});

test('invalid input yields no stamp rather than NaN text', () => {
  assert.equal(ageStamp(BIRTH, 'not-a-date'), '');
  assert.equal(ageStamp('not-a-date', '2026-05-01'), '');
});

test('plain ISO dates are read as local calendar days, not UTC midnight', () => {
  // Parsed as UTC, this would render as the previous day anywhere west of UTC.
  assert.equal(dateLabel('2026-05-01'), new Date(2026, 4, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  assert.equal(ageStamp('2026-05-01', '2026-05-01'), 'Newborn');
});

test('Date objects and full timestamps are accepted too', () => {
  assert.equal(ageStamp(new Date(2026, 0, 15), new Date(2026, 1, 15)), '1 month');
  assert.equal(ageStamp(BIRTH, '2026-02-15T18:20:00'), '1 month');
});

test('dateLabel returns empty for unparseable input', () => {
  assert.equal(dateLabel('nope'), '');
});

test('age math is pure — a Date passed in is not mutated', () => {
  const birth = new Date(2026, 0, 15);
  const at = new Date(2026, 4, 12);
  const snapshot = [birth.getTime(), at.getTime()];
  ageStamp(birth, at);
  assert.deepEqual([birth.getTime(), at.getTime()], snapshot);
});
