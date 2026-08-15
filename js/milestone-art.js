// Decorative sketch that sits beside a milestone card, out on the page background.
//
//   artPreset(title)      -> one of ART_PRESETS, chosen deterministically
//   milestoneArtSvg(name) -> SVG markup for that preset
//
// The drawing never contains anything a parent typed. It is picked from a fixed set,
// so the title only decides WHICH stock drawing appears, never what it says.
//
// Every preset now has real artwork in assets/. The SVG drawings below remain as the
// fallback for a preset added without a file — milestoneArtSvg is what render.js uses
// when ART_IMAGES has no entry — so a new preset is never blank while its art is drawn.
//
// PURE — no DOM, no fetch, no randomness. Every drawing is fixed geometry, and the
// preset choice is a hash of the title, so a milestone always shows the same sketch.

/**
 * Real artwork, keyed by preset. A preset listed here uses its file; anything missing
 * falls back to the SVG below, so a preset can be added before its drawing exists.
 *
 * The files are ALPHA MASKS, not pictures: greyscale-plus-alpha PNGs whose alpha carries
 * the drawing. CSS applies them with `mask-image`, so they take `--accent-ink` and a
 * palette change cannot leave the artwork behind as a black shape. Storing only the alpha
 * also cuts the payload to a fraction — the colour channels were never read.
 *
 * Dimensions live here so the wrapper can take the artwork's shape without waiting for
 * the file to load. Keep them in step with the files.
 *
 * An entry may pin itself to one `side`. Artwork is not symmetric — a drawing that faces
 * or leans one way looks wrong flipped to the other edge — so a piece that only works on
 * one side says so, and the alternation works around it.
 */
export const ART_IMAGES = Object.freeze({
  balloons: { src: 'assets/balloon.png', width: 900, height: 1147 },
  cake: { src: 'assets/cake.png', width: 900, height: 779 },
  blocks: { src: 'assets/blocks.png', width: 900, height: 555 },
  donuts: { src: 'assets/donut.png', width: 900, height: 375 },
  dinosaur: { src: 'assets/dino.png', width: 900, height: 717, side: 'right' },
});

/** @returns {{src: string, width: number, height: number, side?: string}|null} */
export function artImage(preset) {
  return ART_IMAGES[preset] || null;
}

/** @returns {'left'|'right'|null} null when the artwork is happy on either side. */
export function artSide(preset) {
  const side = ART_IMAGES[preset]?.side;
  return side === 'left' || side === 'right' ? side : null;
}

const other = (side) => (side === 'right' ? 'left' : 'right');

/**
 * Which side each milestone's artwork takes, in timeline order.
 *
 * Pinned artwork always gets the side it asked for; everything else alternates around it.
 * That matters more than it looks, because the artwork is fixed to the viewport: two
 * milestones visible at once on the SAME side sit on top of each other.
 *
 * Free artwork therefore looks BOTH ways — at what came before it and at the next pinned
 * piece. Looking only backwards is not enough: an opening `cake` would take the default
 * right, and a `dinosaur` after it is pinned right and cannot move, so the pair clashed.
 * Since alternation fixes a whole run of free pieces from its first one, there are only
 * two possible runs, and picking between them is enough to dodge a pin ahead.
 *
 * It cannot always be avoided: two PINNED neighbours both take their own side, and a free
 * run of the wrong length between two pins has no arrangement that clears both ends. Then
 * the clash is placed at the trailing end, so the run still reads as alternating from
 * where it started. Pin sparingly.
 *
 * @param {string[]} presets in timeline order
 * @returns {Array<'left'|'right'>}
 */
export function assignSides(presets) {
  const list = presets || [];
  const pinned = list.map(artSide);
  const sides = [];
  let previous = null;

  for (let i = 0; i < list.length;) {
    if (pinned[i]) {
      sides.push(pinned[i]);
      previous = pinned[i];
      i += 1;
      continue;
    }

    // The stretch of free artwork up to the next pinned piece, which it has to clear.
    let end = i;
    while (end < list.length && !pinned[end]) end += 1;
    const run = end - i;
    const next = pinned[end] || null;

    // Only the first side is a real choice — the rest follow from it. Prefer to alternate
    // away from what came before, so that constraint wins if both cannot be met.
    const candidates = previous ? [other(previous), previous] : ['right', 'left'];
    let best = candidates[0];
    let fewest = Infinity;
    for (const first of candidates) {
      const last = run % 2 ? first : other(first);
      const clashes = (first === previous ? 1 : 0) + (last === next ? 1 : 0);
      if (clashes < fewest) [fewest, best] = [clashes, first];
    }

    for (let k = 0; k < run; k += 1) sides.push(k % 2 ? other(best) : best);
    previous = sides[sides.length - 1];
    i = end;
  }
  return sides;
}

/** The complete set. Adding one here is all it takes for titles to start picking it. */
export const ART_PRESETS = Object.freeze([
  'balloons',
  'cake',
  'blocks',
  'donuts',
  'dinosaur',
]);

/** Everything is drawn in this square, sized by CSS. */
const BOX = 120;

/** Small stable string hash (FNV-1a), so a title always lands on the same preset. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Titles that are about a birthday. Kept deliberately tight: "three months old" is a
 * milestone but not a birthday, and matching it would spend the cake on the wrong thing.
 */
const BIRTHDAY = /\b(birthdays?|bday|b-day)\b|\bturn(?:s|ed|ing)?\s+(?:one|two|three|1|2|3)\b|\b(?:one|first|1st)\s+year\s+old\b/i;

/** The two drawings that mean "birthday". Nothing else should be chosen for one. */
const BIRTHDAY_PRESETS = Object.freeze(['cake', 'balloons']);

export function isBirthday(title) {
  return BIRTHDAY.test(String(title || ''));
}

/**
 * Drawings a title could take, best first.
 *
 * A birthday gets cake or balloons and nothing else — some milestones mean something
 * specific, and a birthday drawn as a dinosaur is just wrong. Everything else falls back
 * to the hash, expressed as the full list rotated to start at the hashed choice, so the
 * sequencer has somewhere to go when its first pick would repeat.
 *
 * @param {string} title
 * @returns {string[]} non-empty, every entry a member of ART_PRESETS
 */
export function presetCandidates(title) {
  const h = hash(String(title || ''));

  if (isBirthday(title)) {
    // Which of the two leads is still the title's choice, so the same birthday always
    // prefers the same drawing.
    return h % 2 ? [...BIRTHDAY_PRESETS].reverse() : [...BIRTHDAY_PRESETS];
  }

  const start = h % ART_PRESETS.length;
  return [...ART_PRESETS.slice(start), ...ART_PRESETS.slice(0, start)];
}

/**
 * Which stock drawing a milestone gets, ignoring its neighbours. Use assignPresets when
 * the timeline order is known — this is for looking at one title on its own.
 * @param {string} title
 * @returns {string} a member of ART_PRESETS
 */
export function artPreset(title) {
  return presetCandidates(title)[0];
}

/**
 * Drawings for a run of milestones, in timeline order.
 *
 * No drawing repeats on adjacent milestones. That matters most for artwork pinned to a
 * side — two pinned neighbours would place their artwork in the same fixed spot and sit
 * on top of each other — but back-to-back repeats look like a bug regardless, so the rule
 * applies to all of them.
 *
 * A consequence worth knowing: a milestone's drawing depends on its neighbours, so
 * inserting one between two others can change what they show. That is the trade for never
 * repeating, and the drawings are decorative.
 *
 * @param {string[]} titles in timeline order
 * @returns {string[]}
 */
export function assignPresets(titles) {
  let previous = null;
  return (titles || []).map((title) => {
    const candidates = presetCandidates(title);
    const choice = candidates.find((c) => c !== previous) ?? candidates[0];
    previous = choice;
    return choice;
  });
}

// ── The drawings ───────────────────────────────────────────────────
// Stroke-only and unfilled so they read as sketches, and every stroke inherits
// currentColor so the palette is decided entirely in CSS.

/** One balloon: body, knot, and a curling string down to a common point. */
function balloon(cx, cy, r, tailX, tailY) {
  const ry = r * 1.18;
  return (
    `<path d="M${cx} ${cy - ry}` +
    `C${cx + r * 1.3} ${cy - ry * 0.6} ${cx + r * 1.05} ${cy + ry * 0.7} ${cx} ${cy + ry}` +
    `C${cx - r * 1.05} ${cy + ry * 0.7} ${cx - r * 1.3} ${cy - ry * 0.6} ${cx} ${cy - ry}Z"/>` +
    `<path d="M${cx - 3} ${cy + ry}L${cx} ${cy + ry + 5}L${cx + 3} ${cy + ry}"/>` +
    `<path d="M${cx} ${cy + ry + 5}Q${cx + 8} ${(cy + tailY) / 2} ${tailX} ${tailY}"/>`
  );
}

/** A block with a single stock letter, drawn slightly off-square by hand. */
function block(x, y, size, letter, tilt) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  return (
    `<g transform="rotate(${tilt} ${cx} ${cy})">` +
    `<path d="M${x + 1} ${y}L${x + size} ${y + 1.5}L${x + size - 1.5} ${y + size}L${x} ${y + size - 1}Z"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" ` +
    `font-size="15" font-weight="700" stroke="none" fill="currentColor">${letter}</text>` +
    `</g>`
  );
}

const DRAWINGS = {
  balloons: () =>
    balloon(40, 40, 15, 60, 106) +
    balloon(70, 30, 13, 62, 106) +
    balloon(90, 52, 12, 64, 106),

  cake: () =>
    // plate, two tiers with a piped edge, and a lit candle
    '<path d="M18 102H102"/>' +
    '<path d="M30 102V80H90V102"/>' +
    '<path d="M30 80q7-6 15 0t15 0t15 0t15 0"/>' +
    '<path d="M44 80V60H76V80"/>' +
    '<path d="M44 60q8-6 16 0t16 0"/>' +
    '<path d="M60 60V44"/>' +
    '<path d="M60 44c-5-4-1-9 0-11c1 2 5 7 0 11Z"/>',

  // Named "ABC" blocks: the letters are part of the stock drawing, not the title.
  blocks: () =>
    block(30, 66, 28, 'A', -3) +
    block(62, 66, 28, 'B', 2) +
    block(46, 36, 28, 'C', -1.5),

  donuts: () =>
    '<circle cx="46" cy="50" r="24"/><circle cx="46" cy="50" r="9"/>' +
    '<path d="M38 34l3-5M56 40l5-3M34 56l-5 2M52 64l2 5"/>' +
    '<circle cx="80" cy="82" r="18"/><circle cx="80" cy="82" r="7"/>' +
    '<path d="M74 70l2-4M90 78l4-2M70 90l-4 2"/>',

  dinosaur: () =>
    // long-neck: rounded body, neck sweeping up to a head that meets it, tail and legs
    '<path d="M30 62C20 66 14 76 16 84c2 10 16 14 30 12c14-2 22-10 21-19"/>' +
    '<path d="M67 77c-1-6-6-11-14-13c-8-2-17-3-23-2"/>' +
    '<path d="M67 70c2-14 4-24 10-32"/>' +
    '<circle cx="83" cy="30" r="9"/>' +
    '<circle cx="86" cy="27" r="1.6" stroke="none" fill="currentColor"/>' +
    '<path d="M16 82c-6 0-11-5-13-13"/>' +
    '<path d="M30 96v10M44 98v9M58 96v10"/>',

};

/**
 * Markup for one stock drawing.
 * @param {string} preset a member of ART_PRESETS; anything else falls back to balloons
 * @returns {string} SVG markup
 */
export function milestoneArtSvg(preset) {
  const draw = DRAWINGS[preset] || DRAWINGS.balloons;
  return (
    `<svg class="milestone-art" viewBox="0 0 ${BOX} ${BOX}" fill="none" ` +
    `stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${draw()}</svg>`
  );
}
