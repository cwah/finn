// The heart of the product: a PURE function that infers a layout from a post's
// content. No DOM, no fetch, no user input, no override. Unit-testable in isolation.
//
//   inferLayout(post) -> 'quote' | 'portrait' | 'landscape' | 'grid' | 'carousel' | null
//
// null means the post carries nothing renderable (no photos AND no caption); the
// renderer skips it rather than emitting an empty card.
//
// Milestone is a separate, orthogonal treatment (see isMilestone) layered on top of
// whichever base layout is chosen — so it never changes the rules below.

/** Above this many photos a grid stops working and the set becomes a carousel. */
export const GRID_MAX = 4;

/** A photo with no crop is cropped to all of itself. */
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/**
 * The crop rectangle actually in force, normalised 0–1 against the original.
 * Absent, partial or nonsensical values fall back to the whole photo.
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function cropRect(photo) {
  const c = photo?.crop;
  if (!c) return FULL_CROP;
  const w = Number(c.w);
  const h = Number(c.h);
  if (!(w > 0 && h > 0)) return FULL_CROP;
  const x = Math.min(Math.max(Number(c.x) || 0, 0), 1);
  const y = Math.min(Math.max(Number(c.y) || 0, 0), 1);
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/**
 * What the photo measures AFTER its crop — the only size the layout should ever reason
 * about. Cropping a wide photo into a tall frame really does make it a portrait, and the
 * engine has to see that or the card would contradict what the parent framed.
 * @returns {{width: number, height: number}}
 */
export function croppedSize(photo) {
  const c = cropRect(photo);
  return { width: photo.width * c.w, height: photo.height * c.h };
}

/**
 * Decide the base layout for a post from its content alone.
 * Orientation is read from stored width/height — we never load an image to decide.
 * @param {object} post
 * @returns {'quote'|'portrait'|'landscape'|'grid'|'carousel'|null}
 */
export function inferLayout(post) {
  const photos = Array.isArray(post.photos) ? post.photos : [];
  const count = photos.length;

  // 1. No photos + has caption -> quote card. With neither, there is nothing to show.
  if (count === 0) return hasCaption(post) ? 'quote' : null;

  // 2 & 3. Single photo -> orientation from its dimensions AFTER cropping.
  if (count === 1) {
    const { width, height } = croppedSize(photos[0]);
    return height > width ? 'portrait' : 'landscape';
  }

  // 4. 2–4 photos -> grid.
  if (count <= GRID_MAX) return 'grid';

  // 5. More than that -> carousel. A five-cell grid has no arrangement that reads well,
  // and shrinking each photo further defeats the point of taking them.
  return 'carousel';
}

/**
 * The shape a post takes from its LEAD photo — the first one, which "Make main photo"
 * chooses.
 *
 * Used wherever one photo sets the card's shape: the full-width hero cell of a
 * three-photo grid, and every slide of a carousel. (Two- and four-photo grids are square
 * by design and ignore this.)
 *
 * This deliberately follows the lead photo rather than, say, the median of the set. The
 * lead photo is something the parent chose, and cropping it is an explicit statement
 * about shape — a card that ignored that would be contradicting them. Carousels do pay
 * for it: the other slides are cropped to the lead's shape rather than to a compromise.
 * That is the trade for making crop and "make main" mean what they say, and both are
 * within the parent's control.
 *
 * Clamped only against the absurd — 1:3 to 3:1. A single-photo card applies no clamp at
 * all, so anything tighter here would refuse a crop the same photo could have alone,
 * which is the very complaint this function exists to answer. The guard is for a stray
 * panorama forcing every slide of a carousel into a letterbox, not for shapes a parent
 * might plausibly choose.
 *
 * @param {Array<{width: number, height: number, crop?: object}>} photos
 * @returns {number} width / height
 */
export const LEAD_ASPECT_MIN = 1 / 3;
export const LEAD_ASPECT_MAX = 3;

export function leadAspect(photos) {
  const lead = (photos || [])[0];
  if (!lead) return 4 / 3;

  const { width, height } = croppedSize(lead);
  const ar = width / height;
  if (!Number.isFinite(ar) || ar <= 0) return 4 / 3;

  return Math.min(LEAD_ASPECT_MAX, Math.max(LEAD_ASPECT_MIN, Math.round(ar * 100) / 100));
}

/**
 * Where to anchor a photo inside a cell that crops it further, so the focal point ends
 * up as close to the CENTRE of that cell as it can get.
 *
 * The naive approach — anchoring at the focal fraction itself, which is what
 * `object-position` does — puts a focal point of 0.15 at 15% across the cell rather than
 * in the middle of it. That is an alignment, not a centring, and it is not what "the
 * subject stays centred" means to anyone choosing the point.
 *
 * Solving for the anchor `p` that centres the focal point `f`, where `k` is how many
 * times bigger the photo is than the cell on that axis:
 *
 *     p(1 - k) + fk = 0.5   ->   p = (0.5 - fk) / (1 - k)
 *
 * Clamping p to 0–1 is exactly the constraint that the photo keeps covering the cell, so
 * a focal point near an edge settles as close to centre as it can without exposing a gap.
 *
 * @param {{focalX?: number, focalY?: number}} focal 0–1, defaulting to the middle
 * @param {number} boxAspect  width/height of the photo as cropped
 * @param {number} cellAspect width/height of the cell it must cover
 * @returns {{x: number, y: number}} anchor fractions for both axes
 */
export function coverAlign(focal, boxAspect, cellAspect) {
  const fx = Number.isFinite(focal?.focalX) ? focal.focalX : 0.5;
  const fy = Number.isFinite(focal?.focalY) ? focal.focalY : 0.5;
  if (!(boxAspect > 0) || !(cellAspect > 0)) return { x: 0.5, y: 0.5 };

  // Covering means one axis matches exactly and the other overflows; k is the overflow.
  return {
    x: anchor(fx, Math.max(1, boxAspect / cellAspect)),
    y: anchor(fy, Math.max(1, cellAspect / boxAspect)),
  };
}

function anchor(f, k) {
  // k === 1 means this axis fits exactly: there is no slack, so nothing to choose.
  if (!(k > 1)) return 0.5;
  const p = (0.5 - f * k) / (1 - k);
  return Math.min(1, Math.max(0, Math.round(p * 1000) / 1000));
}

/** A caption counts only if it holds something other than whitespace. */
function hasCaption(post) {
  return typeof post.caption === 'string' && post.caption.trim() !== '';
}

/** Whether this post should receive the milestone highlight treatment. */
export function isMilestone(post) {
  return Boolean(post.milestone && post.milestone.isMilestone);
}
