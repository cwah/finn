// Telling someone their clip was shortened.
//
// A video longer than the cap is ACCEPTED and truncated, never refused. Refusing sends a
// parent back to their phone with nothing saved, over a limit they had no way to know
// about; truncating keeps the memory and costs them the tail of it.
//
// But truncating silently is its own failure. The first thirty seconds of a two-minute
// clip is frequently the wrong thirty — the walking, the laughing, the candle is usually
// not at the front — so the one thing that must not happen is the parent finding out later
// by watching it back.
//
// So: say it, name which clip, and say what to do about it. The trim window can be moved
// to any thirty seconds in the editor, and cropping in Photos first avoids the question.

import { MAX_CLIP_SECONDS } from './layout-engine.js';
import { needsEncoding, pickMimeType } from './video-encode.js';

export { MAX_CLIP_SECONDS };

/** Seconds, to one decimal, without a pointless ".0". */
function seconds(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The clips that will not play in full.
 *
 * A motion photo is never counted: it is a still that moves for a moment, its length is
 * whatever the phone recorded around the shutter, and nobody chose it.
 */
export function truncatedClips(items = []) {
  return (items || []).filter((item) => {
    if (!item || item.motion) return false;
    const duration = Number(item.duration);
    // The tenth of a second of slack matters: a clip the phone reports as 30.02 seconds is
    // not something anyone needs telling about.
    return Number.isFinite(duration) && duration > MAX_CLIP_SECONDS + 0.1;
  });
}

/**
 * What to say about them, or null when there is nothing to say.
 *
 * @param {object[]} items the media currently in the compose sheet
 * @returns {string|null}
 */
export function clipNotice(items = []) {
  const long = truncatedClips(items);
  if (!long.length) return null;

  const limit = `${MAX_CLIP_SECONDS} seconds`;
  const advice = 'Drag the trim bar to choose which part plays, or crop it in Photos first.';

  if (long.length === 1) {
    return `That video is ${seconds(long[0].duration)}s long — only the first ${limit} `
      + `will play. ${advice}`;
  }
  return `${long.length} videos are longer than ${limit} — only the first ${limit} of each `
    + `will play. ${advice}`;
}

/** Megabytes, to one decimal, for a sentence rather than a spec sheet. */
function mb(bytes) {
  return `${Math.round((Number(bytes) || 0) / 104857.6) / 10} MB`;
}

/**
 * When this browser cannot shrink a video at all.
 *
 * `MediaRecorder` has to be able to produce MP4/H.264. Where it cannot — Android Chrome
 * still could not at version 124 — `toDisplayCopy` hands the original straight back, and
 * everything downstream works exactly as designed: the clip uploads whole, the trim stays
 * metadata, nothing errors. It is simply forty megabytes going up a phone connection with
 * no indication that anything unusual is happening, and a big enough clip is how an upload
 * fails twice for no visible reason.
 *
 * WebM is deliberately NOT accepted as a substitute. `MediaRecorder` offers it almost
 * everywhere, but iPhones cannot play it back, and a memory that stores fine and will not
 * play on half the family's phones is worse than a large one that plays everywhere.
 *
 * So the answer is to say so. Known at the moment the clip is added — it needs no decode,
 * only the file's size and what the browser admits to supporting.
 */
export function shrinkNotice(items = []) {
  if (pickMimeType()) return null;   // it can shrink; nothing to say

  const stuck = (items || []).filter((item) => {
    if (!item || item.motion || !item.videoFile) return false;
    return needsEncoding({
      width: item.width, height: item.height, size: item.videoFile.size, motion: false,
      duration: item.duration,
    });
  });
  if (!stuck.length) return null;

  const total = stuck.reduce((sum, i) => sum + (i.videoFile.size || 0), 0);
  const what = stuck.length === 1 ? 'That video' : `Those ${stuck.length} videos`;
  return `${what} cannot be made smaller in this browser, so ${stuck.length === 1 ? 'it' : 'they'} `
    + `will upload at full size (${mb(total)}). A large upload can fail on a slow connection — `
    + 'Chrome on a computer will shrink it, or crop it in Photos first.';
}

/** Everything worth saying about the media just added, in order. */
export function mediaNotices(items = []) {
  return [clipNotice(items), shrinkNotice(items)].filter(Boolean);
}
