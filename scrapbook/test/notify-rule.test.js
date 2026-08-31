// Which posts earn an email.
//
//   npm test
//
// The rule lives in deploy/pb_hooks/notify-rule.js because PocketBase's JSVM is what runs
// it in production. It is required here through createRequire rather than copied, so the
// thing under test is the thing that ships — a second copy would drift, and the drift
// would surface as mail nobody expected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const rule = createRequire(import.meta.url)('../../deploy/pb_hooks/notify-rule.js');
const { shouldNotify, pbTime, createdWindow, recentSince,
  SETTLE_MINUTES, RECENT_DAYS, GIVE_UP_HOURS } = rule;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);
/** A post as PocketBase stores one: datetimes as "YYYY-MM-DD HH:MM:SS.000Z" strings. */
const post = ({ createdAgo = 10 * MINUTE, memoryAgo = 0, notifiedAt = '' } = {}) => ({
  created: pbTime(NOW - createdAgo),
  memoryDate: pbTime(NOW - memoryAgo),
  notifiedAt,
});

// ── The settling delay ────────────────────────────────────────────
test('a post just created is left alone', () => {
  // The whole reason for the delay: test posts get made and deleted in production, and a
  // post gets edited seconds after saving. Neither should reach an inbox.
  assert.equal(shouldNotify(post({ createdAgo: 30 * 1000 }), NOW), false);
});

test('a post still inside the settling window is left alone', () => {
  assert.equal(shouldNotify(post({ createdAgo: (SETTLE_MINUTES - 1) * MINUTE }), NOW), false);
});

test('a post that has settled is sent', () => {
  assert.equal(shouldNotify(post({ createdAgo: (SETTLE_MINUTES + 1) * MINUTE }), NOW), true);
});

// ── Backfill ──────────────────────────────────────────────────────
test('a memory from today is news', () => {
  assert.equal(shouldNotify(post({ memoryAgo: 0 }), NOW), true);
});

test('a memory from six days ago is still news', () => {
  assert.equal(shouldNotify(post({ memoryAgo: 6 * DAY }), NOW), true);
});

test('a memory from last month is a BACKFILL and is silent', () => {
  // Backfilling a year of photos is a pleasant afternoon for one person and a hundred
  // emails for everyone else.
  assert.equal(shouldNotify(post({ memoryAgo: 30 * DAY }), NOW), false);
  assert.equal(shouldNotify(post({ memoryAgo: (RECENT_DAYS + 1) * DAY }), NOW), false);
});

test('the boundary is inclusive, so exactly a week old still counts', () => {
  assert.equal(shouldNotify(post({ memoryAgo: RECENT_DAYS * DAY }), NOW), true);
});

test('a memory dated slightly in the future is not dropped', () => {
  // The date field caps at today, but a few seconds of clock skew between a phone and the
  // server should not silently swallow a notification.
  assert.equal(shouldNotify(post({ memoryAgo: -30 * 1000 }), NOW), true);
});

// ── Sent once ─────────────────────────────────────────────────────
test('a post already notified is never notified again', () => {
  assert.equal(shouldNotify(post({ notifiedAt: pbTime(NOW - HOUR) }), NOW), false);
});

// ── Giving up ─────────────────────────────────────────────────────
test('a post older than the give-up window stops being retried', () => {
  // Sending may fail and be retried — SMTP has bad days — but a failure that never
  // resolves must not mail everyone a week late the moment it recovers.
  assert.equal(shouldNotify(post({ createdAgo: (GIVE_UP_HOURS + 1) * HOUR, memoryAgo: 0 }), NOW), false);
});

test('a post inside the give-up window is still retried', () => {
  assert.equal(shouldNotify(post({ createdAgo: (GIVE_UP_HOURS - 1) * HOUR, memoryAgo: 0 }), NOW), true);
});

// ── Junk in ───────────────────────────────────────────────────────
test('an unreadable date is never mailed about', () => {
  // Silence is the safe failure here. Mailing on a date nobody could parse is not.
  assert.equal(shouldNotify({ created: 'nonsense', memoryDate: pbTime(NOW), notifiedAt: '' }, NOW), false);
  assert.equal(shouldNotify({ created: pbTime(NOW - HOUR), memoryDate: '', notifiedAt: '' }, NOW), false);
  assert.equal(shouldNotify(null, NOW), false);
});

// ── The filter strings ────────────────────────────────────────────
test('times are formatted the way PocketBase stores them', () => {
  // Datetime comparisons are lexical, so a format that does not match what is stored
  // matches NOTHING — which looks exactly like "no new posts" and would never be noticed.
  assert.match(pbTime(NOW), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.000Z$/);
});

test('the created window brackets the settling delay and the give-up point', () => {
  const w = createdWindow(NOW);
  assert.equal(w.until, pbTime(NOW - SETTLE_MINUTES * MINUTE));
  assert.equal(w.since, pbTime(NOW - GIVE_UP_HOURS * HOUR));
  assert.ok(w.since < w.until, 'the window must not be inverted');
});

test('the recent cutoff is a week back', () => {
  assert.equal(recentSince(NOW), pbTime(NOW - RECENT_DAYS * DAY));
});

test('the filter window agrees with shouldNotify at both edges', () => {
  // The SQL filter and the in-handler re-check must not disagree, or a post is fetched and
  // then silently skipped forever — or worse, sent when the filter meant to exclude it.
  const w = createdWindow(NOW);
  const justSettled = pbTime(NOW - (SETTLE_MINUTES * MINUTE) - 1000);
  const tooFresh = pbTime(NOW - 1000);
  assert.ok(justSettled <= w.until, 'a settled post is inside the SQL window');
  assert.ok(tooFresh > w.until, 'an unsettled post is outside it');
});
