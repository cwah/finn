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
 * Slide shape for a carousel, inferred from the photos it holds.
 *
 * Every slide has to be the same shape or the card's height jumps as you swipe. A fixed
 * shape is the obvious answer and the wrong one: a 4:3 slide throws away 46% of a tall
 * portrait. So the set picks its own shape — the median aspect, which lands between the
 * orientations in a mixed post and matches exactly when they all agree.
 *
 * Clamped to 3:4–3:2. Beyond that a single panorama or a very tall photo would drag
 * every other slide into an extreme shape.
 *
 * @param {Array<{width: number, height: number}>} photos
 * @returns {number} width / height
 */
export function carouselAspect(photos) {
  const ratios = (photos || [])
    .map((p) => { const s = croppedSize(p); return s.width / s.height; })
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);

  if (!ratios.length) return 4 / 3;

  const mid = Math.floor(ratios.length / 2);
  // Even counts average the middle pair, so one photo cannot swing the whole strip.
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;

  return Math.min(1.5, Math.max(0.75, Math.round(median * 100) / 100));
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
