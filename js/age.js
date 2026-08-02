// Pure age math: birthDate + memoryDate -> human age stamp.
// Age is NEVER stored per post — it is always derived from one configured birthDate.

/**
 * Parse a date input as a LOCAL calendar day, floored to midnight.
 *
 * Two hazards this handles: a plain ISO date string like "2026-05-12" otherwise
 * becomes UTC midnight, which renders as the previous day west of UTC; and a value
 * carrying a time-of-day would leave a part-day remainder that rounds age up by one.
 * Age and date labels are calendar-day concepts, so the clock time is dropped.
 */
function asLocalDate(value) {
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
  if (isNaN(d)) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const MS_PER_DAY = 86400000;

/**
 * The same day-of-month, n months on, clamped to the target month's real length —
 * so one month after Jan 31 is Feb 28, not an overflow into March.
 */
function addMonthsClamped(date, months) {
  const targetMonth = date.getMonth() + months;
  const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDay));
}

/**
 * Human-readable age at a given memory date, e.g. "4 months, 2 days" or "Newborn".
 * @param {string|Date} birthDate  ISO date the baby was born
 * @param {string|Date} memoryDate ISO date the moment happened
 * @returns {string}
 */
export function ageStamp(birthDate, memoryDate) {
  const birth = asLocalDate(birthDate);
  const at = asLocalDate(memoryDate);
  if (isNaN(birth) || isNaN(at) || at < birth) return '';

  let months =
    (at.getFullYear() - birth.getFullYear()) * 12 +
    (at.getMonth() - birth.getMonth());

  // Walk back to the last monthly anniversary at or before the memory, then count the
  // remaining days off that. Subtracting day-of-month directly would need a borrow that
  // can itself come up short — Jan 31 to Mar 1 borrows only 28 days and lands negative.
  let anniversary = addMonthsClamped(birth, months);
  if (anniversary > at) {
    months -= 1;
    anniversary = addMonthsClamped(birth, months);
  }
  // Round: a DST shift inside the span makes the raw difference an hour off a whole day.
  const days = Math.round((at - anniversary) / MS_PER_DAY);

  if (months <= 0 && days === 0) return 'Newborn';

  const parts = [];
  if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  return parts.join(', ');
}

/** Short date label for a memory, e.g. "May 1". */
export function dateLabel(memoryDate) {
  const d = asLocalDate(memoryDate);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
