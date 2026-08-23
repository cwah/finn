// Reading a date a parent typed. American convention: month first, so "8/14" is the 14th
// of August. Given "today" rather than reading the clock, so the awkward cases are
// testable without waiting for the calendar.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDate } from '../bot/parse-date.js';

/** Monday 17 August 2026. */
const TODAY = new Date(2026, 7, 17);
const on = (text) => parseDate(text, TODAY);

test('a bare month/day is this year', () => {
  assert.equal(on('8/14').date, '2026-08-14');
  assert.equal(on('8/14').hadYear, false);
});

test('month first, always — this is the ambiguous one', () => {
  // Under the other convention this would be the 8th of December.
  assert.equal(on('12/8').date, '2026-12-08');
  assert.equal(on('8/12').date, '2026-08-12');
});

test('separators can be slashes, dashes or dots', () => {
  for (const text of ['8/14', '8-14', '8.14', '08/14']) {
    assert.equal(on(text).date, '2026-08-14', text);
  }
});

test('a two-digit year is this century', () => {
  assert.equal(on('8-14-26').date, '2026-08-14');
  assert.equal(on('8/14/25').date, '2025-08-14');
  assert.equal(on('8/14/26').hadYear, true);
});

test('a four-digit year is taken as written', () => {
  assert.equal(on('8/14/2026').date, '2026-08-14');
  assert.equal(on('3/17/2026').date, '2026-03-17');
});

test('month names work, long or short, with or without a year', () => {
  for (const text of ['august 14', 'August 14', 'aug 14', 'Aug. 14', 'AUG 14']) {
    assert.equal(on(text).date, '2026-08-14', text);
  }
  assert.equal(on('august 14 2026').date, '2026-08-14');
  assert.equal(on('august 14, 2026').date, '2026-08-14');
  assert.equal(on('aug 14 26').date, '2026-08-14');
});

test('an ordinal reads the same as a plain number', () => {
  assert.equal(on('august 14th').date, '2026-08-14');
  assert.equal(on('aug 1st').date, '2026-08-01');
  assert.equal(on('3rd august').date, '2026-08-03');
});

test('day-before-month is accepted when the month is a NAME', () => {
  // No ambiguity is possible: a month name cannot be a day, so refusing it on principle
  // would only be pedantry.
  assert.equal(on('14 august').date, '2026-08-14');
  assert.equal(on('14 august 2026').date, '2026-08-14');
});

test('an ISO date is understood too', () => {
  assert.equal(on('2026-08-14').date, '2026-08-14');
  assert.equal(on('2026-08-14').hadYear, true);
});

test('an ambiguous month abbreviation is refused rather than guessed', () => {
  // "ju" could be June or July, and picking one silently would date a memory wrongly.
  assert.equal(on('ju 14'), null);
  assert.equal(on('ma 3'), null, 'March or May');
  assert.equal(on('jun 14').date, '2026-06-14');
  assert.equal(on('jul 14').date, '2026-07-14');
});

// ── Future dates ──────────────────────────────────────────────────
test('a date after today is flagged, not silently accepted', () => {
  assert.equal(on('8/28').future, true);
  assert.equal(on('8/28').date, '2026-08-28');
});

test('today and the recent past are not the future', () => {
  assert.equal(on('8/17').future, false, 'today itself');
  assert.equal(on('8/16').future, false);
  assert.equal(on('1/1').future, false);
});

test('a bare date that lands ahead by year-assumption is flagged', () => {
  // "12/25" in August most likely means last Christmas, but assuming the current year
  // puts it in the future — which is exactly the ambiguity worth asking about.
  const christmas = on('12/25');
  assert.equal(christmas.date, '2026-12-25');
  assert.equal(christmas.future, true);
  assert.equal(christmas.hadYear, false);
});

test('a future date written with an explicit year is still the future', () => {
  assert.equal(on('8/14/2027').future, true);
});

// ── Nothing usable ────────────────────────────────────────────────
test('an impossible day is not a date', () => {
  assert.equal(on('2/30'), null);
  assert.equal(on('13/5'), null, 'there is no thirteenth month');
  assert.equal(on('feb 30'), null);
  assert.equal(on('4/31'), null);
});

test('a leap day is real in a leap year and not otherwise', () => {
  assert.equal(on('2/29/2028').date, '2028-02-29');
  assert.equal(on('2/29/2026'), null);
});

test('text that is not a date returns nothing', () => {
  // "yesterday" used to belong here and no longer does — see the relative dates below.
  for (const text of ['', '   ', 'the park', 'aug', '14', 'hello 14']) {
    assert.equal(on(text), null, JSON.stringify(text));
  }
  assert.equal(parseDate(null, TODAY), null);
  assert.equal(parseDate(undefined, TODAY), null);
});

test('surrounding whitespace does not matter', () => {
  assert.equal(on('   8/14   ').date, '2026-08-14');
  assert.equal(on('august    14').date, '2026-08-14');
});

test('parsing is pure — the same text always reads the same way', () => {
  assert.deepEqual(on('8/14'), on('8/14'));
});

// ── Counting back from today ──────────────────────────────────────
// TODAY is Monday 17 August 2026 throughout.

test('the everyday words', () => {
  assert.equal(on('yesterday').date, '2026-08-16');
  assert.equal(on('today').date, '2026-08-17');
  assert.equal(on('Yesterday').date, '2026-08-16', 'case does not matter');
});

test('tomorrow parses, and is flagged as the future rather than refused', () => {
  const t = on('tomorrow');
  assert.equal(t.date, '2026-08-18');
  assert.equal(t.future, true);
});

test('a count of days, weeks, months or years back', () => {
  assert.equal(on('3 days ago').date, '2026-08-14');
  assert.equal(on('two weeks ago').date, '2026-08-03');
  assert.equal(on('1 week ago').date, '2026-08-10');
  assert.equal(on('two months ago').date, '2026-06-17');
  assert.equal(on('one year ago').date, '2025-08-17');
});

test('singular and plural read the same, and so do words and digits', () => {
  assert.equal(on('1 day ago').date, on('one day ago').date);
  assert.equal(on('2 weeks ago').date, on('two weeks ago').date);
  assert.equal(on('a week ago').date, '2026-08-10');
  assert.equal(on('an hour ago'), null, 'sub-day units are not a date');
});

test('"a couple of weeks ago" is two', () => {
  assert.equal(on('a couple of weeks ago').date, '2026-08-03');
  assert.equal(on('a couple weeks ago').date, '2026-08-03');
});

test('a vague quantity is refused rather than guessed at', () => {
  // "a few" is a real amount to whoever wrote it, and picking 3 would date a memory
  // wrongly with total confidence.
  assert.equal(on('a few weeks ago'), null);
  assert.equal(on('several days ago'), null);
  assert.equal(on('ages ago'), null);
});

test('last week, last month, last year', () => {
  assert.equal(on('last week').date, '2026-08-10');
  assert.equal(on('last month').date, '2026-07-17');
  assert.equal(on('last year').date, '2025-08-17');
});

test('months count back by day-of-month, clamped to real month lengths', () => {
  // The 31st of March, one month back, is the 28th of February — not the 3rd of March.
  const march31 = new Date(2026, 2, 31);
  assert.equal(parseDate('one month ago', march31).date, '2026-02-28');
  assert.equal(parseDate('1 year ago', new Date(2028, 1, 29)).date, '2027-02-28');
});

test('a weekday means the most recent one, today included', () => {
  // TODAY is a Monday.
  assert.equal(on('friday').date, '2026-08-14');
  assert.equal(on('sunday').date, '2026-08-16');
  assert.equal(on('monday').date, '2026-08-17', 'saying Monday on a Monday means today');
});

test('"last <weekday>" reaches past today to the one before', () => {
  assert.equal(on('last monday').date, '2026-08-10');
  assert.equal(on('last friday').date, '2026-08-14');
});

test('a relative date settles its own year, and says so', () => {
  // The caller uses this: offering "I assumed this year" for "tomorrow" is nonsense.
  assert.equal(on('two weeks ago').relative, true);
  assert.equal(on('8/14').relative, false);
  assert.equal(on('8/14/2026').relative, false);
});

test('words that are not dates are still refused', () => {
  for (const text of ['someday', 'lastweek', 'ago', '5 ago', 'friday the 13th', 'funday']) {
    assert.equal(on(text), null, JSON.stringify(text));
  }
});

test('an absolute date is never misread as a relative one', () => {
  assert.equal(on('8/14').date, '2026-08-14');
  assert.equal(on('1 may').date, '2026-05-01');
  assert.equal(on('may 1').date, '2026-05-01');
});
