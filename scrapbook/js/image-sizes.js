// Asking for the size of picture a screen can actually show.
//
// Every photo on the timeline was fetched at 1280px, whatever was displaying it. A phone
// card is around 390 CSS px wide; at 2x that is 780 device pixels, so most of a megapixel
// was being sent to the device least able to afford it — and paid for again in hosting.
//
// `srcset` hands the browser the candidates and lets it choose, which it does better than
// any guess here: it knows the pixel ratio, the viewport, and whether the connection is
// slow enough to prefer a smaller one.

/** The widths the server has thumbnails for. Declared in pb_migrations. */
export const CARD_WIDTHS = [640, 960, 1280];

/**
 * `srcset` for a card photo, or null when there is nothing to choose between.
 *
 * Null rather than a one-entry set: a browser given a single candidate gains nothing, and
 * the mock data source has no thumbnailer at all.
 */
export function cardSrcset(photo) {
  const set = photo?.cardSet;
  if (!set) return null;
  const parts = CARD_WIDTHS
    .filter((w) => set[w])
    .map((w) => `${set[w]} ${w}w`);
  return parts.length > 1 ? parts.join(', ') : null;
}

/**
 * What width the picture will be DISPLAYED at, as a `sizes` attribute.
 *
 * Without this a browser assumes the image fills the viewport and picks the largest
 * candidate, which throws away most of the benefit. The card is the full width of a narrow
 * screen and capped on a wide one — the same two cases the stylesheet describes.
 *
 * A photo sharing a card with others is narrower still, and saying so lets the browser
 * drop another step. `share` is how many across it sits.
 */
export function cardSizes(share = 1) {
  const across = Number.isInteger(share) && share > 1 ? share : 1;
  if (across === 1) return '(max-width: 600px) 100vw, 560px';
  // Integer percentages: a browser only needs an estimate, and an exact fraction invites
  // a precision nobody has.
  const part = Math.round(100 / across);
  return `(max-width: 600px) ${part}vw, ${Math.round(560 / across)}px`;
}
