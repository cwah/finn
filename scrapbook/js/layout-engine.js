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
 * The rotation in force, in degrees clockwise. Only right angles exist: a photo is held
 * the wrong way round, not askew, and anything else would need the frame to grow to hold
 * the corners. Absent or nonsensical means upright, which is how photos behaved before
 * rotation existed.
 * @returns {0|90|180|270}
 */
export function rotationOf(photo) {
  const q = Math.round(Number(photo?.rotation) / 90);
  return Number.isFinite(q) ? (((q % 4) + 4) % 4) * 90 : 0;
}

/**
 * What the photo measures once turned upright, before any crop.
 *
 * A quarter turn swaps the axes, so this is where a sideways portrait stops claiming to
 * be a landscape. Everything downstream reasons about the *presented* shape, never the
 * stored one.
 * @returns {{width: number, height: number}}
 */
export function orientedSize(photo) {
  const quarterTurned = rotationOf(photo) % 180 !== 0;
  return quarterTurned
    ? { width: photo.height, height: photo.width }
    : { width: photo.width, height: photo.height };
}

/**
 * What the photo measures AFTER rotation and crop — the only size the layout should ever
 * reason about. Cropping a wide photo into a tall frame really does make it a portrait,
 * and so does turning it a quarter turn; the engine has to see both or the card would
 * contradict what the parent framed.
 *
 * Rotation is applied FIRST, so the crop rectangle is expressed against the upright
 * photo. That is the photo the parent was looking at when they dragged the crop, and a
 * crop that shifted when the photo was later turned would be indefensible.
 * @returns {{width: number, height: number}}
 */
export function croppedSize(photo) {
  const c = cropRect(photo);
  const o = orientedSize(photo);
  return { width: o.width * c.w, height: o.height * c.h };
}

/**
 * Carry a crop and a focal point round with the photo as it turns.
 *
 * Both are expressed against the UPRIGHT photo, so turning the photo and leaving them
 * alone would slide the crop onto a different part of the picture. A parent framed a
 * subject, not a pair of coordinates, so the framing turns with it.
 *
 * A quarter turn clockwise sends a point at (x, y) to (1 - y, x); a rectangle's corner
 * becomes its opposite corner, which is why x is built from y AND h.
 *
 * @param {{x, y, w, h}} crop
 * @param {{x, y}} focal in the same upright space
 * @param {number} by degrees clockwise, any multiple of 90
 * @returns {{crop: {x, y, w, h}, focal: {x, y}}}
 */
export function turnFraming(crop, focal, by) {
  const quarters = ((Math.round(Number(by) / 90) % 4) + 4) % 4 || 0;
  let c = { ...crop };
  let f = { ...focal };
  for (let q = 0; q < quarters; q += 1) {
    c = { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w };
    f = { x: 1 - f.y, y: f.x };
  }
  // Rounded, because these values are stored and turned again later: 1 - y - h drifts a
  // little every time, and four turns of an unrounded rectangle do not land back where
  // they started. Three decimals is finer than a pixel on any photo a phone takes.
  const tidy = (v) => Math.round(v * 1000) / 1000;
  return {
    crop: { x: tidy(c.x), y: tidy(c.y), w: tidy(c.w), h: tidy(c.h) },
    focal: { x: tidy(f.x), y: tidy(f.y) },
  };
}

/**
 * Longest a memory may play, in seconds.
 *
 * Thirty, down from sixty, and the reason is the phone rather than the page. Encoding the
 * display copy happens ON DEVICE, in real time through a canvas and MediaRecorder, so a
 * clip costs roughly its own length in wall time before a post can be saved — and a long
 * one was failing outright rather than merely being slow. Halving the cap halves the worst
 * case. Moving that work off the device is in BACKLOG.md; this is the interim.
 *
 * A longer clip is still ACCEPTED, and truncated to the first thirty seconds rather than
 * refused: the parent is told, and can move the window or crop in Photos first. Being sent
 * back to the phone with nothing saved is the worse outcome.
 */
export const MAX_CLIP_SECONDS = 30;

/**
 * The stretch of a video that actually plays, in seconds.
 *
 * Trimming is framing, never destruction — exactly like cropping. The stored file keeps
 * every frame; these two numbers say which of them a memory is, so a trim can be widened,
 * moved or removed forever.
 *
 * The result is always a valid window inside the source and never longer than
 * MAX_CLIP_SECONDS, so a malformed or missing trim degrades to "the first half minute"
 * rather than to an error.
 * @returns {{start: number, end: number, duration: number}}
 */
export function trimRange(video) {
  const source = Number(video?.duration);
  if (!(source > 0)) return { start: 0, end: 0, duration: 0 };

  const start = Math.min(Math.max(Number(video.trimStart) || 0, 0), source);
  const requested = Number(video.trimEnd);
  // An absent or backwards end means "from here on", which the cap then shortens.
  const end = requested > start ? Math.min(requested, source) : source;
  const capped = Math.min(end, start + MAX_CLIP_SECONDS);
  return { start, end: capped, duration: capped - start };
}

/** Whether a media item carries motion at all. A plain photo does not. */
export function hasVideo(photo) {
  return Boolean(photo?.video?.url) && trimRange(photo.video).duration > 0;
}

/**
 * Whether an item should loop silently on screen rather than wait for a tap.
 *
 * A motion photo IS its motion — one that never moved would just be a photo. A longer
 * clip is a video, and several decoders running at once is exactly the battery cost this
 * app avoids elsewhere, so it waits to be asked.
 */
export function isMotion(photo) {
  return hasVideo(photo) && Boolean(photo.video.motion);
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

// ── Light ─────────────────────────────────────────────────────────
// Brightness and contrast are framing too, by the same argument as crop, rotation and
// trim: stored as numbers and applied at render, so the file is never re-encoded and a
// heavy hand costs nothing to undo. The gallery bakes its adjustments into a new file
// because a print is a finished thing; a memory is not.

/** Neither adjustment does anything at 1, which is what every photo starts at. */
const NEUTRAL = 1;

/** Below this a photo is unrecognisable, above it, blown out. The gallery's range. */
const ADJUST_MIN = 0.2;
const ADJUST_MAX = 2;

/**
 * One adjustment, made safe.
 *
 * A stored 0 reads as NEUTRAL rather than as black. That is not defensive coding: adding a
 * `number` field to PocketBase backfills every existing row with 0, so the first deploy
 * would otherwise turn every photo in the scrapbook black at once. The migration fills
 * them in properly; this is what makes the window between the two harmless, and what
 * covers a row written by anything that does not know about these fields yet.
 */
function adjustment(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return NEUTRAL;
  return Math.min(Math.max(n, ADJUST_MIN), ADJUST_MAX);
}

/** What a photo's light settings are, whatever the record does or does not carry. */
export function adjustmentsOf(photo) {
  return {
    brightness: adjustment(photo?.brightness),
    contrast: adjustment(photo?.contrast),
  };
}

/**
 * The CSS filter for a photo's light settings.
 *
 * One function for the card, the lightbox and the editor's live preview, so what a parent
 * sets is exactly what they later see. Three implementations would eventually disagree,
 * and the disagreement would only show up after saving.
 *
 * @returns {string} '' when nothing is adjusted, so the common case sets no filter at all
 *   — and no needless compositing layer with it.
 */
export function lightFilter(photo) {
  const { brightness, contrast } = adjustmentsOf(photo);
  const off = (v) => Math.abs(v - NEUTRAL) < 1e-3;
  if (off(brightness) && off(contrast)) return '';
  const round = (v) => Math.round(v * 1000) / 1000;
  return `brightness(${round(brightness)}) contrast(${round(contrast)})`;
}
