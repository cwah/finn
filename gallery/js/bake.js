// The geometry of straightening and cropping a photograph of a drawing.
//
// PURE — no DOM, no canvas, no fetch, no randomness. The canvas work in the editor is a
// dozen lines that read a plan out of this file, so all of the arithmetic that can be
// wrong is here, where it can be tested without a browser.
//
// ── The model ────────────────────────────────────────────────────────────────
// A phone photo of a drawing on a table is never square to the paper. So:
//
//   1. rotate the original by a small angle, about its own centre, to straighten it
//   2. crop a rectangle out of the straightened result
//
// Step 1 defines ROTATED SPACE: the axis-aligned bounding box of the rotated image,
// origin at its top-left. A crop is stored as fractions of that box, which keeps it
// meaningful if the same recipe is later applied to a different resolution of the same
// photo.
//
// ── The trap ─────────────────────────────────────────────────────────────────
// Rotating a rectangle leaves four empty wedges in the corners of its bounding box. A
// crop that strays into one bakes a triangle of transparent nothing into the corner of
// the artwork, and on a white mat that is almost invisible until it is printed or
// looked at closely. `cropIsCovered` is the guard, and `largestInscribedCrop` is the
// default that cannot trip it.

const DEG = Math.PI / 180;

/** Small-angle deskew only. Turning a photo on its side is EXIF's job, not this. */
export const MAX_ANGLE = 15;

/** Below this the crop is unusably soft once it is blown back up in a frame. */
export const MIN_CROP = 0.1;

/**
 * The long edge of a baked display copy, in pixels.
 *
 * A phone photo is 4000px across and a frame on screen is rarely more than 1200. The
 * original is kept at full resolution regardless, so this only ever decides how much a
 * visitor downloads, never what is preserved.
 */
export const MAX_EDGE = 2000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A number, or the fallback when there genuinely isn't one.
 *
 * NOT `Number(v) || fallback`, which is the same thing right up until the value is a
 * legitimate zero: `contrast: 0` is a real setting — flat grey — and the `||` idiom
 * silently reads it as "unset" and hands back 1, i.e. untouched. The failure is the
 * worst kind, because the slider moves and the picture does not.
 */
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Degrees, clamped to what a deskew can sensibly be. */
export function usableAngle(angle) {
  const a = Number(angle);
  return Number.isFinite(a) ? clamp(a, -MAX_ANGLE, MAX_ANGLE) : 0;
}

/**
 * The axis-aligned bounding box of a w x h rectangle rotated by `angle` degrees.
 * @returns {{width: number, height: number}}
 */
export function rotatedSize(width, height, angle) {
  const a = usableAngle(angle) * DEG;
  const sin = Math.abs(Math.sin(a));
  const cos = Math.abs(Math.cos(a));
  return {
    width: Math.abs(width) * cos + Math.abs(height) * sin,
    height: Math.abs(width) * sin + Math.abs(height) * cos,
  };
}

/**
 * A point in rotated space, mapped back to a pixel in the original image.
 *
 * The inverse of what the canvas does, and the basis of the coverage test: a crop
 * corner that maps outside 0..width, 0..height is a corner sitting in empty space.
 *
 * @returns {{x: number, y: number}}
 */
export function toOriginal(point, width, height, angle) {
  const a = usableAngle(angle) * DEG;
  const box = rotatedSize(width, height, angle);
  const dx = point.x - box.width / 2;
  const dy = point.y - box.height / 2;
  // Rotate by -a, then back into the original's own frame.
  return {
    x: dx * Math.cos(-a) - dy * Math.sin(-a) + width / 2,
    y: dx * Math.sin(-a) + dy * Math.cos(-a) + height / 2,
  };
}

/**
 * Whether every corner of a crop lands on actual photograph.
 *
 * Both shapes are convex, so testing the four corners tests the whole rectangle: if the
 * corners are inside the rotated quadrilateral, everything between them is too.
 *
 * @param {{x: number, y: number, w: number, h: number}} crop fractions of rotated space
 * @returns {boolean}
 */
export function cropIsCovered(crop, width, height, angle) {
  if (!crop) return false;
  const box = rotatedSize(width, height, angle);
  // A hair of tolerance: the default crop touches the edge exactly, and floating point
  // should not make it fail its own guard.
  const slack = 1e-6 * Math.max(width, height);

  const corners = [
    [crop.x, crop.y], [crop.x + crop.w, crop.y],
    [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h],
  ];
  return corners.every(([fx, fy]) => {
    const p = toOriginal({ x: fx * box.width, y: fy * box.height }, width, height, angle);
    return p.x >= -slack && p.y >= -slack
      && p.x <= width + slack && p.y <= height + slack;
  });
}

/**
 * The largest crop of the original's own proportions that fits inside the rotated image,
 * centred — the sensible thing to show the moment somebody moves the angle slider.
 *
 * The two branches are the standard solution: past a certain angle the limit stops being
 * the corners of the rotated rectangle and becomes its short side, and the formula that
 * is right on one side of that is degenerate on the other.
 *
 * @returns {{x: number, y: number, w: number, h: number}} fractions of rotated space
 */
export function largestInscribedCrop(width, height, angle) {
  const a = Math.abs(usableAngle(angle)) * DEG;
  const box = rotatedSize(width, height, angle);
  if (width <= 0 || height <= 0) return { x: 0, y: 0, w: 1, h: 1 };

  const longer = Math.max(width, height);
  const shorter = Math.min(width, height);
  const sin = Math.abs(Math.sin(a));
  const cos = Math.abs(Math.cos(a));

  let w;
  let h;
  if (shorter <= 2 * sin * cos * longer || Math.abs(sin - cos) < 1e-10) {
    // The short side is the binding constraint; the fitted rectangle is half of it.
    const half = 0.5 * shorter;
    const widthIsLonger = width >= height;
    w = widthIsLonger ? half / sin : half / cos;
    h = widthIsLonger ? half / cos : half / sin;
  } else {
    const cos2 = cos * cos - sin * sin;
    w = (width * cos - height * sin) / cos2;
    h = (height * cos - width * sin) / cos2;
  }

  // Shrink by a whisker before normalising. The analytic answer touches the rotated
  // edges exactly, and "exactly" plus floating point is how a one-pixel transparent
  // sliver ends up baked into a corner.
  const fw = clamp((w / box.width) * (1 - 1e-9), MIN_CROP, 1);
  const fh = clamp((h / box.height) * (1 - 1e-9), MIN_CROP, 1);
  return { x: (1 - fw) / 2, y: (1 - fh) / 2, w: fw, h: fh };
}

/** The full frame, for an unrotated photo that needs no crop at all. */
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/**
 * A crop forced back inside 0..1 and above the minimum size.
 * The editor drags against this so a gesture can never produce an impossible rectangle.
 */
export function usableCrop(crop) {
  const w = clamp(num(crop?.w, 1), MIN_CROP, 1);
  const h = clamp(num(crop?.h, 1), MIN_CROP, 1);
  return {
    x: clamp(num(crop?.x, 0), 0, 1 - w),
    y: clamp(num(crop?.y, 0), 0, 1 - h),
    w,
    h,
  };
}

/**
 * The pixel size of the baked copy, and how much it was scaled down to get there.
 * @returns {{width: number, height: number, scale: number}}
 */
export function outputSize(crop, width, height, angle, maxEdge = MAX_EDGE) {
  const box = rotatedSize(width, height, angle);
  const c = usableCrop(crop);
  const full = { width: c.w * box.width, height: c.h * box.height };
  const longest = Math.max(full.width, full.height);
  // Never upscale: a small original stays its own size rather than being blown up to
  // the cap and pretending to detail it does not have.
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(full.width * scale)),
    height: Math.max(1, Math.round(full.height * scale)),
    scale,
  };
}

/**
 * The exact sequence of canvas operations that turns the original into the display copy.
 *
 * Returned as data so the drawing code is a loop over it and this file stays pure. The
 * order is load-bearing and reads backwards from how it applies: the LAST translate is
 * the one that happens first to the image's own coordinates.
 *
 *   scale      — down to the capped output size
 *   translate  — shift so the crop's top-left sits at the canvas origin
 *   translate  — move to the centre of rotated space
 *   rotate     — the deskew
 *   translate  — back to the original image's top-left
 *
 * @returns {{output: {width, height, scale}, steps: Array}}
 */
export function bakePlan({ width, height, angle = 0, crop = FULL_CROP, maxEdge = MAX_EDGE }) {
  const a = usableAngle(angle);
  const c = usableCrop(crop);
  const box = rotatedSize(width, height, a);
  const output = outputSize(c, width, height, a, maxEdge);

  return {
    output,
    covered: cropIsCovered(c, width, height, a),
    steps: [
      { op: 'scale', x: output.scale, y: output.scale },
      { op: 'translate', x: -c.x * box.width, y: -c.y * box.height },
      { op: 'translate', x: box.width / 2, y: box.height / 2 },
      { op: 'rotate', radians: a * DEG },
      { op: 'translate', x: -width / 2, y: -height / 2 },
      { op: 'drawImage' },
    ],
  };
}

/**
 * The CSS/canvas filter for a brightness and contrast setting.
 *
 * One function for both, on purpose: the live preview sets this on an element's
 * `filter` and the bake sets the identical string on `ctx.filter`, so what is seen is
 * what is written. Two implementations would eventually disagree, and the disagreement
 * would only show up after saving.
 *
 * @param {number} brightness 1 is untouched
 * @param {number} contrast 1 is untouched
 * @returns {string} '' when both are neutral, so nothing is set at all in the common case
 */
export function filterString(brightness = 1, contrast = 1) {
  const b = clamp(num(brightness, 1), 0.2, 2);
  const c = clamp(num(contrast, 1), 0.2, 2);
  if (Math.abs(b - 1) < 1e-3 && Math.abs(c - 1) < 1e-3) return '';
  return `brightness(${round(b)}) contrast(${round(c)})`;
}

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * The recipe as it is stored on the record: enough to reopen the editor exactly where it
 * was left, and nothing that could be recomputed.
 */
export function recipe({ angle = 0, crop = FULL_CROP, brightness = 1, contrast = 1 }) {
  return {
    angle: round(usableAngle(angle)),
    crop: (({ x, y, w, h }) => ({ x: round(x), y: round(y), w: round(w), h: round(h) }))(usableCrop(crop)),
    brightness: round(clamp(num(brightness, 1), 0.2, 2)),
    contrast: round(clamp(num(contrast, 1), 0.2, 2)),
  };
}
