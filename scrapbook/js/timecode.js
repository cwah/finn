// Reading and writing a moment in a clip.
//
// A drag is the wrong instrument for a long video. The trim bar is a few hundred pixels
// wide however it is styled, so a three-minute clip puts more than half a second behind
// every pixel — the handle moves in jumps larger than the thing being chosen. Typing the
// number is the only way to say "start at 1:04.5" and mean it.
//
// So this parses what a person would actually write, rather than one canonical format:
//
//   "12"        twelve seconds
//   "1:04"      a minute and four
//   "1:04.5"    and a half
//   "0:04.25"   quarter-second precision, which is finer than a drag can reach
//   ":30"       thirty seconds, for anyone who starts with the colon
//
// PURE, so every awkward input can be tested without a video element.

/**
 * Seconds from a typed timecode, or null when it is not one.
 *
 * Null rather than 0 for junk, deliberately: 0 is a legitimate start time, and treating
 * "abc" as "the beginning" would silently rewrite a trim someone was midway through
 * typing.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function parseTimecode(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // Optional minutes, then seconds with an optional fraction. Nothing else.
  //
  // The minutes are `\d*` and not `\d+`: ":30" is a real thing people type, and requiring
  // a digit before the colon rejected it outright.
  const match = /^(?:(\d*):)?(\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;

  const [, mins, secs, frac] = match;
  // The pattern is satisfiable by the empty string and by a lone ":", neither of which is
  // a time. SOMETHING numeric has to be present.
  if (!mins && !secs && !frac) return null;

  const value = (Number(mins || 0) * 60)
    + Number(secs || 0)
    + Number(frac ? `0.${frac}` : 0);

  return Number.isFinite(value) ? value : null;
}

/**
 * A timecode for display: "1:04.5".
 *
 * One decimal place, because that is the precision a parent is choosing at — tenths are
 * visible in a clip, hundredths are not, and a field that reads "1:04.53" invites fiddling
 * with a digit that changes nothing.
 */
export function formatTimecode(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(total / 60);
  const secs = total - mins * 60;
  const shown = secs.toFixed(1).padStart(4, '0');
  return `${mins}:${shown}`;
}

/**
 * Settle a typed pair into a legal trim.
 *
 * The rules are the ones the bar already enforces by construction, made explicit so typing
 * cannot produce something dragging could not: inside the clip, in order, and at least
 * MIN_CLIP apart. A typed end BEFORE the start is the interesting case — it is a normal
 * thing to type on the way to something valid, and the honest response is to hold the
 * other handle out of its way rather than to reject the keystroke.
 *
 * @param {{start: number, end: number}} wanted
 * @param {{duration: number, minClip?: number, moved?: 'start'|'end'}} bounds
 * @returns {{start: number, end: number}}
 */
export function settleTrim(wanted, { duration, minClip = 0.5, moved = 'start' }) {
  const span = Math.max(0, Number(duration) || 0);
  if (!span) return { start: 0, end: 0 };

  const gap = Math.min(minClip, span);
  let start = Math.min(Math.max(Number(wanted.start) || 0, 0), span);
  let end = Math.min(Math.max(Number(wanted.end) || 0, 0), span);

  if (end - start < gap) {
    // Whichever handle was NOT just moved gives way. Pushing the one being typed into
    // would fight the person mid-keystroke.
    if (moved === 'start') {
      end = Math.min(span, start + gap);
      if (end - start < gap) start = Math.max(0, end - gap);
    } else {
      start = Math.max(0, end - gap);
      if (end - start < gap) end = Math.min(span, start + gap);
    }
  }
  return { start, end };
}
