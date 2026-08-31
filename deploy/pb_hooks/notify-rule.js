// Which posts deserve an email, and when.
//
// Kept apart from the hook that sends, and written as a plain CommonJS module, so the
// rule can be tested from node. PocketBase's JSVM `require()`s it; the test suite in
// scrapbook/test does the same through createRequire. One copy, two runtimes — a second
// copy would eventually disagree with the first, and the disagreement would show up as
// mail nobody expected.
//
// THREE THINGS HAVE TO BE TRUE, and each answers a different way of getting this wrong:
//
//   settled     the post was created at least SETTLE_MINUTES ago. Test posts get made and
//               deleted in production, and a post gets edited straight after saving; both
//               are normal, and neither should reach anyone's inbox. Waiting is what turns
//               "a post exists" into "a post was meant".
//   recent      its memoryDate is within RECENT_DAYS. Backfilling a year of photos is a
//               pleasant afternoon for whoever is doing it and a hundred emails for
//               everyone else.
//   unsent      it has not been notified already.
//
// And one that bounds the damage rather than describing intent:
//
//   fresh       the post was created within GIVE_UP_HOURS. Sending is allowed to fail and
//               be retried — SMTP has bad days — but a failure that never resolves must
//               stop trying rather than mail everyone a week late when it recovers.

const SETTLE_MINUTES = 5;
const RECENT_DAYS = 7;
const GIVE_UP_HOURS = 24;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * PocketBase's own datetime format: "2026-08-31 12:34:56.000Z".
 *
 * Comparisons on a datetime column are lexical, so the format has to match what is stored
 * or a filter silently matches nothing — which for a notifier looks exactly like "no new
 * posts" and would never be noticed.
 */
function pbTime(date) {
  return new Date(date).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '.000Z');
}

/** The window a post must have been created in to be worth mailing about. */
function createdWindow(now = Date.now()) {
  return {
    // Old enough to have settled...
    until: pbTime(now - SETTLE_MINUTES * MINUTE),
    // ...but not so old that a long outage would flood everyone on recovery.
    since: pbTime(now - GIVE_UP_HOURS * HOUR),
  };
}

/** The oldest memory date that still counts as news rather than as a backfill. */
function recentSince(now = Date.now()) {
  return pbTime(now - RECENT_DAYS * DAY);
}

/**
 * Whether one post should be mailed about, given the clock.
 *
 * The filter does this work in SQL for the common case; this exists so the rule can be
 * stated once, tested directly, and re-checked in the handler against values that have
 * already been read.
 *
 * @param {{created: string, memoryDate: string, notifiedAt: string}} post
 * @param {number} now milliseconds
 */
function shouldNotify(post, now = Date.now()) {
  if (!post || post.notifiedAt) return false;

  const created = Date.parse(String(post.created || '').replace(' ', 'T'));
  const memory = Date.parse(String(post.memoryDate || '').replace(' ', 'T'));
  if (!Number.isFinite(created) || !Number.isFinite(memory)) return false;

  const age = now - created;
  if (age < SETTLE_MINUTES * MINUTE) return false;   // still settling
  if (age > GIVE_UP_HOURS * HOUR) return false;      // too late to be news

  // A memory dated in the FUTURE is still news — the date field accepts today at most,
  // but a clock skew of a few seconds should not silently drop a notification.
  return (now - memory) <= RECENT_DAYS * DAY;
}

module.exports = {
  SETTLE_MINUTES,
  RECENT_DAYS,
  GIVE_UP_HOURS,
  pbTime,
  createdWindow,
  recentSince,
  shouldNotify,
};
