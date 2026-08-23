// Artwork dimensions -> the custom properties that size the framed assembly.
//
// PURE — no DOM, no fetch, no randomness. The geometry itself is CSS (see
// artwork.css), but the numbers fed into it are decided here, which is the only way
// to get any of this under test without a browser.

/** Below this much difference from square, a piece is treated as square. */
const SQUARE_BAND = 0.06;

/** Ratios past this start losing mat, so a panorama does not become a bathmat. */
const TAPER_FROM = 2.6;
const TAPER_TO = 4.5;
const MAT_FLOOR = 0.55;

const FALLBACK = Object.freeze({ width: 4, height: 5 });

/**
 * Dimensions we are willing to build a layout on.
 *
 * A manifest is hand-typed, so 0, a negative, a string and a missing field all
 * genuinely happen — and any of them poisons the calc() chain in artwork.css into
 * invalid-at-computed-value-time, which collapses the artwork to nothing with no
 * error in the console. Falling back to a portrait 4:5 is always better than that.
 *
 * @returns {{width: number, height: number}}
 */
export function usableSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    // A ratio past 20:1 is a typo, not a drawing.
    && w / h < 20 && h / w < 20;
  return ok ? { width: w, height: h } : { ...FALLBACK };
}

/**
 * 'portrait' | 'landscape' | 'square'.
 *
 * The dead band matters: a phone photo of a square drawing is never exactly square,
 * and without it a 1.004:1 piece is called landscape and picks from a different set
 * of frames than the visually identical piece beside it.
 *
 * @returns {'portrait'|'landscape'|'square'}
 */
export function orientationOf(width, height) {
  const { width: w, height: h } = usableSize(width, height);
  const ratio = w / h;
  if (Math.abs(ratio - 1) <= SQUARE_BAND) return 'square';
  return ratio > 1 ? 'landscape' : 'portrait';
}

/**
 * How much of the normal mat an extreme aspect ratio should keep, 1 down to 0.55.
 *
 * A full mat around a 4:1 panorama is wider than the drawing is tall, which stops
 * reading as framing and starts reading as a mistake. Ordinary ratios are untouched.
 *
 * @returns {number} between MAT_FLOOR and 1
 */
export function matScale(width, height) {
  const { width: w, height: h } = usableSize(width, height);
  const extremity = Math.max(w / h, h / w);
  if (extremity <= TAPER_FROM) return 1;
  const t = Math.min((extremity - TAPER_FROM) / (TAPER_TO - TAPER_FROM), 1);
  return Number((1 - t * (1 - MAT_FLOOR)).toFixed(4));
}

/**
 * The custom properties render.js writes onto the .artwork element.
 *
 * Returned as a plain object of property names so the caller is a loop of
 * setProperty and nothing else — and so this file can be tested without a DOM.
 *
 * @param {{width: number, height: number}} image
 * @returns {Object<string, string>}
 */
export function artVars(image) {
  const { width, height } = usableSize(image?.width, image?.height);
  return {
    '--art-w': String(width),
    '--art-h': String(height),
    '--mat-scale': String(matScale(width, height)),
  };
}
