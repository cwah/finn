// The gilt baroque frame, drawn as an SVG and handed to CSS border-image.
//
// PURE — no DOM, no fetch, no randomness. Every other frame in the set is CSS
// gradients, because plain, thin, matted, metal and walnut are geometric and CSS
// renders them convincingly. Carved gilt is not geometric, so this one is drawn.
//
// It lives in JS rather than as a static string in the stylesheet for one specific
// reason: CSS custom properties and currentColor DO NOT cross into a data: URI. The
// SVG is a separate document and there is no variable pass-through, so the only way
// to recolour it — silver, antique gold — is to interpolate the colours into the
// markup here.
//
// ── The 9-slice contract ─────────────────────────────────────────────────────
// The drawing is 300x300 and frame-styles.css slices it at 32%, which is 96 units.
// So the ornament band is the ring within 96 units of the edge, and the middle
// square (96..204) is never painted — border-image is used WITHOUT the `fill`
// keyword, and anything drawn there would land on top of the artwork.
//
//   corner tiles: the four 96x96 squares      <- drawn once, rotated
//   edge tiles:   the 96..204 band on each side <- drawn once, rotated, tiled by `round`
//
// Because every side is one group rotated about the centre, the four rails and four
// corners cannot drift out of agreement with each other.

export const BAROQUE_VIEWBOX = 300;
export const BAROQUE_BAND = 96;

/** Gold, top-lit. Overridable so the same carving can hang as silver or antique. */
export const BAROQUE_COLORS = Object.freeze({
  highlight: '#f2ddA0'.toLowerCase(),
  gild: '#c9a227',
  shade: '#7c5f18',
  deep: '#5a4310',
});

/** One acanthus leaf of the rail run, `w` wide, standing on the baseline. */
function leaf(x, w) {
  const half = w / 2;
  return `M${x},64 C${x + w * 0.11},42 ${x + w * 0.3},25 ${x + half},17`
    + ` C${x + w - w * 0.3},25 ${x + w - w * 0.11},42 ${x + w},64 Z`;
}

/** The top rail: a leaf run over a bead-and-reel, filling x 96..204 exactly. */
function rail() {
  const LEAVES = 4;
  const w = 108 / LEAVES;
  const leaves = Array.from({ length: LEAVES }, (_, i) => leaf(96 + i * w, w)).join('');
  const veins = Array.from({ length: LEAVES }, (_, i) => {
    const cx = 96 + i * w + w / 2;
    return `M${cx},60 L${cx},22`;
  }).join('');
  const BEADS = 8;
  const step = 108 / BEADS;
  const beads = Array.from({ length: BEADS }, (_, i) =>
    `<circle cx="${(96 + step / 2 + i * step).toFixed(2)}" cy="76" r="4.6"/>`).join('');
  return `<g id="rail">`
    + `<path d="${leaves}" fill="url(#g)" stroke="${'%CARVE%'}" stroke-width="1.4"/>`
    + `<path d="${veins}" stroke="${'%CARVE%'}" stroke-width="1.6" fill="none" opacity=".55"/>`
    + `<g fill="url(#g)" stroke="${'%CARVE%'}" stroke-width="1.1">${beads}</g>`
    + `</g>`;
}

/** The top-left corner: a rosette on the mitre, with the mitre joint drawn in. */
function corner() {
  // One petal pointing up from the centre of the 96x96 box, then rotated eight ways.
  const petal = 'M48,48 C52.5,34 51.5,22 48,12 C44.5,22 43.5,34 48,48 Z';
  const petals = Array.from({ length: 8 }, (_, i) =>
    `<use href="#petal" transform="rotate(${i * 45} 48 48)"/>`).join('');
  return `<g id="corner">`
    // The 45-degree mitre, where two lengths of moulding meet. Cheap, and its absence
    // is one of the things that makes a CSS frame look printed rather than built.
    + `<path d="M0,0 L96,96" stroke="${'%CARVE%'}" stroke-width="2" opacity=".5"/>`
    + `<circle cx="48" cy="48" r="34" fill="none" stroke="${'%CARVE%'}" stroke-width="1.6" opacity=".45"/>`
    + `<defs><path id="petal" d="${petal}"/></defs>`
    + `<g fill="url(#g)" stroke="${'%CARVE%'}" stroke-width="1.2">${petals}</g>`
    + `<circle cx="48" cy="48" r="9.5" fill="url(#boss)" stroke="${'%CARVE%'}" stroke-width="1.4"/>`
    + `</g>`;
}

/**
 * The frame as SVG markup.
 *
 * Only colours are interpolated. The geometry is fixed path data, exactly like
 * scrapbook's milestone-art.js — nothing a person types can reach the drawing.
 *
 * @param {{highlight?: string, gild?: string, shade?: string, deep?: string}} [colors]
 * @returns {string}
 */
export function baroqueSvg(colors = {}) {
  const c = { ...BAROQUE_COLORS, ...colors };
  const V = BAROQUE_VIEWBOX;
  const B = BAROQUE_BAND;

  // Rotations about the centre. 90deg maps (x,y) -> (300-y, x), which carries the
  // top-left corner box onto the top-right one and the top rail onto the right rail.
  const around = (id) => Array.from({ length: 4 }, (_, i) =>
    `<use href="#${id}" transform="rotate(${i * 90} ${V / 2} ${V / 2})"/>`).join('');

  const body = `${rail()}${corner()}`.replaceAll('%CARVE%', c.deep);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}" width="${V}" height="${V}">`
    + `<defs>`
    // Gradients only — no filters. A filter inside a border-image source is
    // re-rasterised at every distinct border width, and it shows on a phone.
    + `<linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1">`
    + `<stop offset="0" stop-color="${c.highlight}"/>`
    + `<stop offset=".38" stop-color="${c.gild}"/>`
    + `<stop offset=".72" stop-color="${c.shade}"/>`
    + `<stop offset="1" stop-color="${c.gild}"/>`
    + `</linearGradient>`
    + `<linearGradient id="boss" x1="0" y1="0" x2="0.6" y2="1">`
    + `<stop offset="0" stop-color="${c.highlight}"/>`
    + `<stop offset="1" stop-color="${c.shade}"/>`
    + `</linearGradient>`
    + `</defs>`
    // The band itself: the full square with the sight opening knocked out of it.
    // evenodd is what makes the inner subpath a hole rather than a second square.
    + `<path d="M0,0 H${V} V${V} H0 Z M${B},${B} V${V - B} H${V - B} V${B} Z"`
    + ` fill-rule="evenodd" fill="url(#g)"/>`
    // Fillets: a raised lip at the outer edge and another at the sight edge. Two
    // lines, and they do most of the work of making the band read as moulding.
    + `<rect x="5" y="5" width="${V - 10}" height="${V - 10}" fill="none"`
    + ` stroke="${c.deep}" stroke-width="3" opacity=".7"/>`
    + `<rect x="82" y="82" width="${V - 164}" height="${V - 164}" fill="none"`
    + ` stroke="${c.deep}" stroke-width="3.5" opacity=".8"/>`
    + `<rect x="12" y="12" width="${V - 24}" height="${V - 24}" fill="none"`
    + ` stroke="${c.highlight}" stroke-width="1.6" opacity=".5"/>`
    + `<defs>${body}</defs>`
    + around('rail')
    + around('corner')
    + `</svg>`;
}

/**
 * Percent-encode the characters that break inside a url() data: URI.
 *
 * `#` is the one that actually bites: in a data URI it starts a FRAGMENT, so a raw
 * `fill="#c9a227"` truncates the document and the frame silently renders as nothing.
 * `%` must be replaced first or it would double-encode the escapes added after it.
 *
 * @param {string} svg
 * @returns {string}
 */
export function encodeSvg(svg) {
  // NOTE the order, and note that the markup above must contain PLAIN '#'. Writing a
  // pre-escaped '%23' up there instead looks like it saves a step and does the
  // opposite: '%' is escaped first, so '%23' becomes '%2523', every href="#rail"
  // resolves to nothing, and the frame renders as a bare gold band with no carving
  // on it and no error in the console.
  return String(svg)
    .replace(/\s+/g, ' ')
    .replaceAll('%', '%25')
    .replaceAll('#', '%23')
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('"', '%22');
}

/**
 * The finished value for the --frame-image custom property.
 * @param {object} [colors] see BAROQUE_COLORS
 * @returns {string} `url("data:image/svg+xml,...")`
 */
export function baroqueUri(colors) {
  return `url("data:image/svg+xml,${encodeSvg(baroqueSvg(colors))}")`;
}
