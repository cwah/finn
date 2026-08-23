// Turning a drag into a page turn.
//
// PURE — no DOM, no fetch, no randomness. Tiny, and separate from app.js on purpose:
// it is an off-by-one machine with three thresholds, and folding it into the event
// listener is exactly how it would stop being tested.

/**
 * What a completed drag meant.
 *
 * +1 = show an EARLIER piece, -1 = a later one, 0 = not a swipe.
 *
 * Dragging to the RIGHT pulls the strip rightward and reveals what lies to its left,
 * which in this collection is the older work — the same thing the left arrow does.
 * That is the direction every touch UI uses and the opposite of what the sign of dx
 * suggests, so it is worth being explicit about.
 *
 * The two guards are what stop a lazy vertical scroll or a slow reposition of the
 * finger from turning the page: the drag has to be mostly horizontal, and it has to
 * be quick. A slow horizontal drag is someone thinking, not someone swiping.
 *
 * @param {number} dx pixels moved horizontally, positive rightward
 * @param {number} dy pixels moved vertically
 * @param {number} dt milliseconds from pointerdown to pointerup
 * @returns {-1|0|1}
 */
export function swipeIntent(dx, dy, dt) {
  const x = Number(dx);
  const y = Number(dy);
  const t = Number(dt);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return 0;
  if (t > 700) return 0;
  if (Math.abs(x) < 45) return 0;
  if (Math.abs(x) < Math.abs(y) * 1.4) return 0;
  return x > 0 ? 1 : -1;
}
