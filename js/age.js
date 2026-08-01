// Pure age math: birthDate + memoryDate -> human age stamp.
// Age is NEVER stored per post — it is always derived from one configured birthDate.

/**
 * Parse a date input as a LOCAL calendar day. Plain ISO date strings like
 * "2026-05-12" otherwise become UTC midnight, which renders as the previous day
 * west of UTC. Date objects and full ISO timestamps pass through unchanged.
 */
function asLocalDate(value) {
  if (value instanceof Date) return value;
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return new Date(value);
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

  // Borrow a month if the day-of-month hasn't been reached yet.
  let days = at.getDate() - birth.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(at.getFullYear(), at.getMonth(), 0).getDate();
    days += prevMonthDays;
  }

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
