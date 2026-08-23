// Reading a date a parent typed, in whatever shape they typed it.
//
// PURE, and given "today" rather than reading the clock, so the awkward cases — a bare
// "8/14", a two-digit year, a date that lands in the future — are testable without
// waiting for the calendar to cooperate.
//
// AMERICAN CONVENTION: month first. "8/14" is the 14th of August, never the 8th of
// December. This is stated because it is genuinely ambiguous and half the world reads it
// the other way; the app has two users and they both read it this way.

import { addMonthsClamped } from '../js/age.js';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "aug", "Aug.", "AUGUST" -> 8, or 0 when it is not a month at all. */
function monthNumber(word) {
  const name = String(word || '').toLowerCase().replace(/\.$/, '');
  if (!name) return 0;
  const exact = MONTHS.indexOf(name);
  if (exact >= 0) return exact + 1;
  // Abbreviations, but only unambiguous ones: "ju" could be June or July.
  const matches = MONTHS.filter((m) => m.startsWith(name));
  return matches.length === 1 ? MONTHS.indexOf(matches[0]) + 1 : 0;
}

/**
 * A two-digit year is this century. Every memory in a baby scrapbook is within a couple
 * of years of now, so "26" is 2026 and there is no plausible reading as 1926.
 */
function fullYear(value) {
  const n = Number(value);
  return n < 100 ? 2000 + n : n;
}

/** Whether y-m-d is a real calendar day — catches the 31st of February. */
function isRealDate(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Small numbers as words, because "two weeks ago" is how people write it. */
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const NAMED_DAY = /^(today|yesterday|tomorrow)$/i;
const AGO = /^(\d+|[a-z]+)\s+(day|week|month|year)s?\s+ago$/i;
const LAST_UNIT = /^last\s+(week|month|year)$/i;
const WEEKDAY = /^(?:(last|past)\s+)?([a-z]+)$/i;

/** Midnight on the day `days` before `from`. */
const shiftDays = (from, days) =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);

/**
 * Dates written by counting back from today, rather than stated outright.
 *
 * Relative dates settle their own year — "two weeks ago" is never ambiguous about which
 * year it means — which is why the result says so, and the caller does not offer to
 * explain that it assumed the current one.
 *
 * @returns {Date|null} midnight on the day meant
 */
function relativeDate(raw, today) {
  // "A couple" is two. Normalised to a numeral up front rather than threaded through the
  // pattern, where a multi-word count fights the single-word one it has to sit beside.
  const text = raw.toLowerCase().replace(/^a couple(?:\s+of)?\s+/, '2 ');
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const named = text.match(NAMED_DAY);
  if (named) {
    const offset = { today: 0, yesterday: -1, tomorrow: 1 }[named[1]];
    return shiftDays(midnight, offset);
  }

  const ago = text.match(AGO);
  if (ago) {
    const count = /^\d+$/.test(ago[1]) ? Number(ago[1]) : NUMBER_WORDS[ago[1]];
    // An unrecognised word — "a few weeks ago" — is refused rather than guessed at. It
    // is a real quantity to the writer and picking a number would date a memory wrongly.
    if (!count) return null;
    const unit = ago[2];
    if (unit === 'day') return shiftDays(midnight, -count);
    if (unit === 'week') return shiftDays(midnight, -count * 7);
    if (unit === 'month') return addMonthsClamped(midnight, -count);
    return addMonthsClamped(midnight, -count * 12);
  }

  const lastUnit = text.match(LAST_UNIT);
  if (lastUnit) {
    if (lastUnit[1] === 'week') return shiftDays(midnight, -7);
    return addMonthsClamped(midnight, lastUnit[1] === 'month' ? -1 : -12);
  }

  const weekday = text.match(WEEKDAY);
  if (weekday) {
    const wanted = WEEKDAYS.indexOf(weekday[2]);
    if (wanted < 0) return null;
    // A bare weekday is the most recent one, today included — say "friday" ON a Friday
    // and you mean today. "Last friday" reaches past it to the one before.
    let back = (midnight.getDay() - wanted + 7) % 7;
    if (weekday[1] && back === 0) back = 7;
    return shiftDays(midnight, -back);
  }
  return null;
}

const NUMERIC = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/;
const ISO_FORM = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const MONTH_FIRST = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{2,4}))?$/i;
const DAY_FIRST = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,?\s*(\d{2,4}))?$/i;

/**
 * Read a date out of free text.
 *
 * @param {string} text what followed the tag
 * @param {Date} today the day to reckon "this year" and "in the future" against
 * @returns {{date: string, hadYear: boolean, relative: boolean, future: boolean}|null}
 *          null when nothing date-shaped was written. `relative` says the day was counted
 *          back from today, which settles its own year — so the caller should not offer
 *          to explain that it assumed the current one.
 */
export function parseDate(text, today = new Date()) {
  const raw = String(text || '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;

  let y;
  let m;
  let d;
  let hadYear = false;
  let relative = false;

  const isoMatch = raw.match(ISO_FORM);
  const numeric = raw.match(NUMERIC);
  const monthFirst = raw.match(MONTH_FIRST);
  const dayFirst = raw.match(DAY_FIRST);

  if (isoMatch) {
    [, y, m, d] = isoMatch.map(Number);
    hadYear = true;
  } else if (numeric) {
    // Month first, by convention stated above.
    m = Number(numeric[1]);
    d = Number(numeric[2]);
    hadYear = numeric[3] !== undefined;
    y = hadYear ? fullYear(numeric[3]) : today.getFullYear();
  } else if (monthFirst && monthNumber(monthFirst[1])) {
    m = monthNumber(monthFirst[1]);
    d = Number(monthFirst[2]);
    hadYear = monthFirst[3] !== undefined;
    y = hadYear ? fullYear(monthFirst[3]) : today.getFullYear();
  } else if (dayFirst && monthNumber(dayFirst[2])) {
    // "14 august" is unambiguous even under the month-first rule — a month name cannot
    // be a day — so it is accepted rather than refused on principle.
    d = Number(dayFirst[1]);
    m = monthNumber(dayFirst[2]);
    hadYear = dayFirst[3] !== undefined;
    y = hadYear ? fullYear(dayFirst[3]) : today.getFullYear();
  } else {
    // Nothing stated outright — try counting back from today instead.
    const when = relativeDate(raw, today);
    if (!when) return null;
    y = when.getFullYear();
    m = when.getMonth() + 1;
    d = when.getDate();
    relative = true;
  }

  if (!isRealDate(y, m, d)) return null;

  // "Future" is decided on calendar days, not instants: a memory dated today is not in
  // the future at nine in the morning and past by teatime.
  const asDay = new Date(y, m - 1, d);
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return { date: iso(y, m, d), hadYear, relative, future: asDay > todayDay };
}
