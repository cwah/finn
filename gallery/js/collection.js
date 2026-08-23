// The collection as an ordered list, and the arithmetic of moving through it.
//
// PURE — no DOM, no fetch, no randomness. Every off-by-one in the navigation lives in
// this file so it can be tested, rather than being spread through app.js where it
// cannot. The one rule worth stating up front: nothing here wraps.

/**
 * The collection in display order: newest first, so index 0 is the landing page.
 *
 * Ties are broken by id descending rather than left to the sort's own stability,
 * because two drawings made on the same day is the normal case, not the edge case,
 * and their order should not depend on how they happen to sit in the JSON file.
 *
 * @param {Array<{id: string, createdOn: string}>} artworks
 * @returns {Array} a new array; the input is not touched
 */
export function orderCollection(artworks) {
  return [...(artworks || [])].sort((a, b) => {
    const byDate = String(b?.createdOn ?? '').localeCompare(String(a?.createdOn ?? ''));
    return byDate !== 0 ? byDate : String(b?.id ?? '').localeCompare(String(a?.id ?? ''));
  });
}

/**
 * Where `id` sits in the ordered list, or -1 when it is not in it.
 * @param {Array<{id: string}>} list
 * @param {string} id
 * @returns {number}
 */
export function indexOfId(list, id) {
  if (!Array.isArray(list) || id == null) return -1;
  return list.findIndex((a) => a?.id === id);
}

/**
 * Step through the list, CLAMPED at both ends.
 *
 * Deliberately does not wrap. Arrowing off the oldest piece back round to the newest
 * would destroy the one thing a chronological archive is for — the feeling of having
 * reached the beginning — and it makes the arrows' disabled state a lie.
 *
 * @param {number} index current position
 * @param {number} delta +1 for an earlier (older) piece, -1 for a later one
 * @param {number} length
 * @returns {number} a valid index, or 0 for an empty collection
 */
export function stepIndex(index, delta, length) {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const from = Number.isFinite(index) ? index : 0;
  const to = from + (Number.isFinite(delta) ? delta : 0);
  return Math.min(Math.max(to, 0), length - 1);
}

/**
 * Whether a step in that direction would actually go anywhere. This is what drives
 * the arrows' aria-disabled state, so it must agree with stepIndex exactly.
 * @returns {boolean}
 */
export function canStep(index, delta, length) {
  if (!Number.isFinite(length) || length <= 0) return false;
  return stepIndex(index, delta, length) !== index;
}

/**
 * The indices either side of `index`, omitting any that fall off the ends.
 * preload.js warms exactly these and nothing further out.
 * @returns {number[]}
 */
export function neighbourIndices(index, length) {
  if (!Number.isFinite(length) || length <= 0) return [];
  return [index - 1, index + 1].filter((i) => i >= 0 && i < length && i !== index);
}
