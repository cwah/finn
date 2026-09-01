// Turning what is in the compose sheet into what gets stored.
//
// One job: encode each clip down to a display copy, and ONLY the stretch of it that will
// ever play.
//
// This used to happen the moment a video was picked, which was wrong twice over. It made
// adding a clip cost its own length in wall time before the editor would open — three
// minutes of watching a percentage climb for a memory that plays for thirty seconds — and
// it encoded the whole film, most of which the cap means nobody can ever see. It also had
// to guess the window before the parent had chosen it, so it always guessed the opening.
//
// Doing it at save fixes all three: the editor opens as fast as a poster can be drawn, the
// window is known, and the encode is bounded by MAX_CLIP_SECONDS however long the source
// was.
//
// THE TRADE. When a clip IS re-encoded, the stored file becomes the chosen window and the
// trim is baked in — so the trim can be narrowed later but not moved outside what was
// kept. That is a real loss against "trimming is framing, never destruction", and it is
// accepted for the same reason the original is already discarded: the phone that filmed it
// still has the whole thing, and the alternative is storing minutes of video to keep the
// option of re-cutting a memory nobody is re-cutting. A clip small enough to be left alone
// is NOT baked — it keeps every frame and its trim stays what it always was, a pair of
// numbers.

import { toDisplayCopy } from './video-encode.js';
import { trimRange } from './layout-engine.js';

/**
 * @param {object[]} photos the compose sheet's items
 * @param {(item: object, done: number) => void} [onProgress] per-clip, 0..1
 * @returns {Promise<object[]>} items ready to upload — a NEW array; the input is untouched
 */
export async function prepareForUpload(photos, onProgress) {
  const out = [];
  // Sequential, deliberately. Each encode plays a video in real time through a canvas;
  // running several at once does not finish sooner, it just makes every one of them
  // stutter and compete for the same decoder.
  for (const photo of photos || []) {
    out.push(await prepareOne(photo, onProgress));
  }
  return out;
}

/** One item. Anything that is not an unencoded clip passes straight through. */
async function prepareOne(photo, onProgress) {
  if (!photo?.videoFile || photo.motion || photo.encoded) return photo;

  // trimRange, not arithmetic here. It already decides what a missing, backwards or
  // absurd trim means, and it CAPS the window at MAX_CLIP_SECONDS — which is the whole
  // guarantee this change rests on. Reimplementing it would have meant a clip whose
  // trimEnd was absent quietly encoding the full three minutes again, which is the thing
  // being fixed.
  const { start, end, duration: span } = trimRange({
    duration: photo.duration, trimStart: photo.trimStart, trimEnd: photo.trimEnd,
  });
  if (!(span > 0)) return photo;

  const display = await toDisplayCopy(photo.videoFile, {
    motion: false,
    start,
    end,
    onProgress: (done) => onProgress?.(photo, done),
  });

  // Left alone — too small to be worth a generation of quality, or the browser cannot
  // record. The whole file is stored and the trim stays metadata, exactly as before.
  if (!display.encoded) return { ...photo, videoFile: display.file };

  // Re-encoded: the file IS the window now, so the trim that produced it must not be
  // applied a second time. Leaving the old numbers here would play the first seconds of
  // an already-trimmed clip — a trim applied twice, which is how a memory ends up being
  // three seconds of itself.
  return {
    ...photo,
    videoFile: display.file,
    duration: span,
    trimStart: 0,
    trimEnd: span,
    encoded: true,
  };
}
