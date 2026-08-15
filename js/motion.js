// Motion photos: a still frame that also moves.
//
// PURE where it matters. `pairLivePhotos` and `findEmbeddedVideo` take plain descriptors
// and bytes and return plain results — no DOM, no File objects, no decoding — so the two
// fiddly formats can be tested without a phone. The thin wrappers that read real Files
// are at the bottom and do nothing but fetch bytes and call the pure part.
//
// Two makers, two formats, one result:
//
//   Apple  — a Live Photo shares out as TWO files, IMG_1234.HEIC and IMG_1234.MOV.
//            They arrive side by side in the picker and are matched by name.
//   Google — a motion photo is ONE jpeg with an mp4 appended after the image data.
//            The video has to be found by scanning for its container header.
//
// Anything we cannot pair or find is simply a photo, which is what it looks like anyway.

/** Motion is a moment either side of the shutter — a clip longer than this is a video. */
export const MOTION_MAX_SECONDS = 6;

const STILL = /\.(jpe?g|heic|heif|png)$/i;
const MOVIE = /\.(mov|mp4|m4v)$/i;

/** Everything before the extension: "IMG_1234.HEIC" -> "IMG_1234". */
function stem(name) {
  return String(name || '').replace(/\.[^.]*$/, '').toLowerCase();
}

/**
 * Match Live Photo stills to their movies.
 *
 * iOS hands over both halves as separate files with the same name, and nothing else says
 * they belong together — so the name IS the relationship. A still with no movie, or a
 * movie with no still, passes through on its own; neither is an error, and a lone movie
 * is just a video.
 *
 * @param {Array<{name: string}>} files as chosen, in picker order
 * @returns {Array<{still?: object, video?: object, motion: boolean}>} one entry per memory
 */
export function pairLivePhotos(files) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const movies = new Map();
  for (const file of list) {
    if (MOVIE.test(file.name)) movies.set(stem(file.name), file);
  }

  const claimed = new Set();
  const out = [];
  for (const file of list) {
    if (MOVIE.test(file.name)) {
      // Held back only if a still claimed it below; otherwise it is a video in its own right.
      if (!claimed.has(file)) out.push({ video: file, motion: false, pending: file });
      continue;
    }
    const partner = STILL.test(file.name) ? movies.get(stem(file.name)) : null;
    if (partner) {
      claimed.add(partner);
      out.push({ still: file, video: partner, motion: true });
    } else {
      out.push({ still: file, motion: false });
    }
  }
  // A movie that a still claimed must not also appear on its own. The first pass cannot
  // know, because the still may come after the movie in picker order.
  return out.filter((entry) => !(entry.pending && claimed.has(entry.pending)))
    .map(({ pending, ...entry }) => entry);
}

/**
 * Find the mp4 appended to a Google motion photo.
 *
 * The file is a valid jpeg followed by a valid mp4. An mp4 begins with a `ftyp` box: four
 * bytes of length, then the ASCII "ftyp". Scanning for that signature past the start of
 * the file finds the video without parsing either container — and checking the length
 * field points somewhere sane rejects the same four letters appearing inside image data.
 *
 * XMP metadata records the offset properly, but it is written differently by different
 * Android versions (MicroVideoOffset, then Container:Directory) and is absent on some
 * files that still carry a video. The signature is the one thing every version shares.
 *
 * @param {Uint8Array} bytes the whole file
 * @returns {{offset: number, length: number}|null} null when it is an ordinary photo
 */
export function findEmbeddedVideo(bytes) {
  if (!bytes || bytes.length < 12) return null;

  // From 5, so a box at offset 0 cannot match: a plain mp4 is not an embedded one.
  for (let i = 5; i + 8 <= bytes.length; i += 1) {
    if (bytes[i] !== 0x66 || bytes[i + 1] !== 0x74) continue;        // 'f', 't'
    if (bytes[i + 2] !== 0x79 || bytes[i + 3] !== 0x70) continue;    // 'y', 'p'

    const start = i - 4;
    const size = (bytes[start] << 24 | bytes[start + 1] << 16
      | bytes[start + 2] << 8 | bytes[start + 3]) >>> 0;
    // The box has to fit in what remains, and be big enough to hold its own header.
    if (size < 8 || start + size > bytes.length) continue;
    return { offset: start, length: bytes.length - start };
  }
  return null;
}

/**
 * Whether a clip is short enough to be a motion photo rather than a video.
 * The distinction decides whether it loops on screen or waits for a tap.
 */
export function looksLikeMotion(seconds) {
  return Number(seconds) > 0 && Number(seconds) <= MOTION_MAX_SECONDS;
}

/** Walk the boxes at `from` and hand back the payload range of the first `type` found. */
function findBox(bytes, type, from, to) {
  let at = from;
  while (at + 8 <= to) {
    const size = ((bytes[at] << 24) | (bytes[at + 1] << 16)
      | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    // A 64-bit size is declared by a 1 in the 32-bit field; 0 means "to the end".
    const header = size === 1 ? 16 : 8;
    const length = size === 1
      ? Number((BigInt(((bytes[at + 8] << 24) | (bytes[at + 9] << 16)
        | (bytes[at + 10] << 8) | bytes[at + 11]) >>> 0) << 32n)
        + BigInt(((bytes[at + 12] << 24) | (bytes[at + 13] << 16)
          | (bytes[at + 14] << 8) | bytes[at + 15]) >>> 0))
      : (size === 0 ? to - at : size);
    if (!(length >= header) || at + length > to) return null;
    if (name === type) return { start: at + header, end: at + length };
    at += length;
  }
  return null;
}

/**
 * How long an mp4 runs, in seconds, read from its header.
 *
 * The bot needs this and cannot decode video: node has no canvas and no media element.
 * But the length is not in the frames, it is stated in the `mvhd` box — a timescale and a
 * duration counted in it — so it can simply be read.
 *
 * This is not a nicety. A stored duration of 0 makes `trimRange()` report nothing
 * playable, `hasVideo()` return false, and the card fall back to a plain still: a motion
 * photo that split correctly and then rendered as a photo anyway.
 *
 * @param {Uint8Array} bytes the whole file, or at least through its moov box
 * @returns {number} seconds, or 0 when it cannot be read
 */
export function mp4Duration(bytes) {
  if (!bytes || bytes.length < 16) return 0;

  const moov = findBox(bytes, 'moov', 0, bytes.length);
  if (!moov) return 0;
  const mvhd = findBox(bytes, 'mvhd', moov.start, moov.end);
  if (!mvhd) return 0;

  const at = mvhd.start;
  if (at + 20 > bytes.length) return 0;
  const read32 = (i) =>
    ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;

  // version(1) + flags(3), then two timestamps whose width depends on the version.
  const version = bytes[at];
  const stamps = version === 1 ? 16 : 8;
  const timescale = read32(at + 4 + stamps);
  const duration = version === 1
    // A 64-bit duration only matters for files far longer than anything here; the low
    // word is enough and avoids BigInt for a value that will always be small.
    ? read32(at + 4 + stamps + 8)
    : read32(at + 4 + stamps + 4);

  if (!(timescale > 0) || !(duration > 0)) return 0;
  // 0xffffffff is the "unknown duration" sentinel, not a real length.
  if (duration === 0xffffffff) return 0;
  return Math.round((duration / timescale) * 1000) / 1000;
}

// ── Reading real files ────────────────────────────────────────────
// Everything above is pure. Below is the only part that touches a File.

/**
 * Split a Google motion photo into its still and its video.
 * Returns the original file unchanged when there is no video inside.
 *
 * @param {File} file
 * @returns {Promise<{still: File|Blob, video: Blob|null}>}
 */
export async function splitMotionPhoto(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const found = findEmbeddedVideo(bytes);
  if (!found) return { still: file, video: null };

  return {
    // The still half is a complete jpeg on its own — the mp4 simply follows it.
    still: new Blob([bytes.subarray(0, found.offset)], { type: 'image/jpeg' }),
    video: new Blob([bytes.subarray(found.offset)], { type: 'video/mp4' }),
  };
}
