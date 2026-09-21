// Asking for the size of picture a screen can actually show.
//
// Every photo on the timeline was fetched at 1280px, whatever was displaying it. A phone
// card is around 390 CSS px wide; at 2x that is 780 device pixels, so most of a megapixel
// was being sent to the device least able to afford it — and paid for again in hosting.
//
// `srcset` hands the browser the candidates and lets it choose, which it does better than
// any guess here: it knows the pixel ratio, the viewport, and whether the connection is
// slow enough to prefer a smaller one.

/**
 * The widths a CARD may be served at. Declared in pb_migrations.
 *
 * Capped at 960 on purpose, and 1280 is deliberately absent. A card is at most 560 CSS px
 * and usually around 390 on a phone; 960 is between 1.7x and 2.5x density depending on the
 * screen, which is sharp, and 1280 is 465 KB of photograph for a thumbnail on a page that
 * shows dozens. Capping the CANDIDATES does what understating `sizes` cannot: a static
 * `sizes` is multiplied by the device's pixel ratio, so shading it down punishes a 2x
 * screen to restrain a 3x one. This holds the ceiling steady for both.
 *
 * The lightbox is where a photograph is meant to be looked at, and it offers 2048.
 */
export const CARD_WIDTHS = [640, 960];

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
  // TRUTHFULLY. An understated width shades the request on every device equally, which
  // means shading a 2x screen to restrain a 3x one — the ceiling belongs on the candidate
  // list, not here. Told the truth, a browser picks the smallest candidate that covers the
  // screen it actually has.
  const vw = Math.round(100 / across);
  const wide = Math.round(560 / across);
  return `(max-width: 600px) ${vw}vw, ${wide}px`;
}
