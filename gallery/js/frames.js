// Which frame a drawing hangs in.
//
// PURE — no DOM, no fetch, no randomness. Shaped after scrapbook's milestone-art.js,
// which solves the same problem for sketches: a stable hash picks from a rotated
// candidate list, and a sequencer keeps neighbours from repeating.
//
// The rule the whole file exists to enforce: a given drawing is ALWAYS in the same
// frame. Re-rolling per visit would mean a piece you shared looks different to
// whoever opens the link, and a revisit would feel like a slot machine rather than a
// gallery you know.

/**
 * The complete set. Adding one here, plus a [data-frame] block in frame-styles.css,
 * is all it takes for drawings to start hanging in it.
 *
 * `suits` lists the orientations the frame flatters, best first. It is a preference,
 * not a restriction — every frame stays reachable for every piece (see
 * frameCandidates), because a hard restriction can leave the sequencer with nowhere
 * to go when its only candidate is also its neighbour's.
 */
export const FRAMES = Object.freeze({
  plain: { label: 'Plain oak', mat: true, glass: false, suits: ['landscape', 'square', 'portrait'] },
  thin: { label: 'Thin black', mat: true, glass: true, suits: ['landscape', 'square', 'portrait'] },
  matted: { label: 'Matted white', mat: true, glass: true, suits: ['portrait', 'square'] },
  metal: { label: 'Brushed metal', mat: true, glass: true, suits: ['landscape', 'square'] },
  walnut: { label: 'Walnut', mat: true, glass: false, suits: ['portrait', 'square', 'landscape'] },
  baroque: { label: 'Gilt baroque', mat: false, glass: true, suits: ['portrait', 'square'] },
});

/** @type {string[]} */
export const FRAME_IDS = Object.freeze(Object.keys(FRAMES));

/** Small stable string hash (FNV-1a), so an id always lands on the same frame. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Frames a piece could hang in, best first.
 *
 * Frames that suit the orientation come first — a gilt baroque frame around a 4:1
 * panorama looks like a mistake, not a choice — with that group rotated to start at
 * the hashed pick, so the sequencer has somewhere to go when its first choice would
 * repeat. The frames that do not suit the orientation are kept on the end rather
 * than dropped, so the list is never empty and never one long.
 *
 * @param {string} id the artwork's id
 * @param {'portrait'|'landscape'|'square'} orientation
 * @returns {string[]} non-empty, every entry a key of FRAMES
 */
export function frameCandidates(id, orientation) {
  const fitting = FRAME_IDS.filter((f) => FRAMES[f].suits.includes(orientation));
  const rest = FRAME_IDS.filter((f) => !FRAMES[f].suits.includes(orientation));
  if (fitting.length === 0) return [...rest];
  const start = hash(String(id ?? '')) % fitting.length;
  return [...fitting.slice(start), ...fitting.slice(0, start), ...rest];
}

/**
 * The frame one piece gets, ignoring its neighbours. For looking at a drawing on its
 * own; use assignFrames when the collection order is known.
 * @returns {string} a key of FRAMES
 */
export function frameFor(piece) {
  if (piece?.frame && FRAMES[piece.frame]) return piece.frame;
  return frameCandidates(piece?.id, piece?.orientation)[0];
}

/**
 * Frames for the whole collection, given OLDEST FIRST.
 *
 * No frame repeats on adjacent pieces. Only one artwork is ever on screen here, so a
 * repeat is felt across a click rather than side by side: you press the arrow, the
 * frame is identical, and it reads as "the page didn't change". Same reason scrapbook
 * never repeats a sketch back to back.
 *
 * THE ORDER IS LOAD-BEARING and is the one thing here not to tidy. A new drawing is
 * always the newest, so in a newest-first pass it would land at index 0 and the
 * no-repeat chain would ripple through the entire collection — someone's bookmarked
 * link to a walnut-framed piece would open in brushed metal. Running oldest-first
 * means a new piece can only ever be influenced BY history, never influence it.
 * (Backdating a piece into the middle still shifts everything after it. That is what
 * the `frame` override in the manifest is for.)
 *
 * @param {Array<{id: string, frame?: string|null, orientation: string}>} pieces oldest first
 * @returns {string[]} frame ids, in the same order
 */
export function assignFrames(pieces) {
  let previous = null;
  return (pieces || []).map((piece) => {
    // An explicit override always wins, even when it repeats its neighbour. Someone
    // wrote it down on purpose; it is an instruction, not a suggestion.
    if (piece?.frame && FRAMES[piece.frame]) {
      previous = piece.frame;
      return piece.frame;
    }
    const candidates = frameCandidates(piece?.id, piece?.orientation);
    const choice = candidates.find((c) => c !== previous) ?? candidates[0];
    previous = choice;
    return choice;
  });
}
