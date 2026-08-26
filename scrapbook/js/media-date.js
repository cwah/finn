// When a memory actually happened, read from the media rather than from when it was sent.
//
// A parent photographs something on Friday and gets round to sending it on Sunday. The
// memory belongs on Friday — memoryDate is authored, never inferred from upload time, and
// that principle should hold whichever door a post comes through.
//
// PURE, and shared: the bot reads these from what Telegram delivers, and the compose
// sheet reads them from what the file picker hands over. It lives in js/ rather than bot/
// because that is the direction dependencies already run here — the bot imports from the
// app, never the other way about.
//
// Three sources, because what survives depends on how the file arrived:
//
//   EXIF        the photographer's own timestamp. Present only when the ORIGINAL bytes
//               arrive, i.e. sent as a file. Telegram's re-encode strips it.
//   filename    PXL_20260807_..., IMG_20260814_..., VID_20260814_... Survives the file
//               path too, and is the fallback when EXIF is absent or unreadable.
//
//               A FALLBACK, never a preference: Google names files in UTC while EXIF
//               records local time, so a photo taken at half past ten on a Tuesday
//               evening is named for Wednesday. Checked against real photos here, 11 of
//               13 agreed and both disagreements were the filename being wrong — one a
//               late-night UTC shift, one an edited export named for its edit date.
//   mp4 header  a clip's creation time, in js/motion.js beside the duration parser.
//
// A compressed photo has none of these: Telegram renames it `file_5.jpg` and strips the
// metadata, so the send date is all there is. That is a limit of the compressed path,
// not something to guess around.

/** Dates before this are a clock that was never set, not a memory. */
const EARLIEST = Date.UTC(2000, 0, 1);

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** A real calendar day, and not absurd. Guards against a garbage parse. */
function plausible(y, m, d) {
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return probe.getTime() >= EARLIEST ? iso(y, m, d) : null;
}

// PXL_20260807_123456789.MP.jpg, IMG_20260814_101112.jpg, VID_20260814..., 20260814_1011.jpg
const NAMED = /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/;

/**
 * The date a camera wrote into the filename.
 * @param {string} name
 * @returns {string|null} YYYY-MM-DD
 */
export function filenameDate(name) {
  const match = String(name || '').match(NAMED);
  if (!match) return null;
  return plausible(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * The photographer's timestamp, from the jpeg's EXIF block.
 *
 * Walks: APP1 segment -> "Exif\0\0" -> TIFF header (which states its own endianness) ->
 * IFD0 -> the Exif sub-IFD -> DateTimeOriginal. Falls back to IFD0's DateTime, which is
 * the file's own modification stamp and close enough when the original is missing.
 *
 * @param {Uint8Array} bytes the start of the file is enough — EXIF sits near the front
 * @returns {string|null} YYYY-MM-DD
 */
export function exifDate(bytes) {
  if (!bytes || bytes.length < 16) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // not a jpeg

  // Find the APP1 segment that holds Exif.
  let at = 2;
  let tiff = -1;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan: no metadata past here
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return null;
    if (marker === 0xe1 && at + 10 <= bytes.length
      && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') {
      tiff = at + 10; // past "Exif\0\0"
      break;
    }
    at += 2 + length;
  }
  if (tiff < 0 || tiff + 8 > bytes.length) return null;

  // The TIFF header declares its own byte order, and both are seen in the wild.
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;

  const u16 = (i) => (little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
  const u32 = (i) => (little
    ? ((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0)
    : ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0);

  /** Read an ASCII tag out of the IFD at `ifd`, or return the offset of a sub-IFD. */
  function scan(ifd, wanted) {
    if (ifd + 2 > bytes.length) return null;
    const count = u16(ifd);
    let found = null;
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + (i * 12);
      if (entry + 12 > bytes.length) break;
      const tag = u16(entry);
      if (!wanted.has(tag)) continue;
      const length = u32(entry + 4);
      const value = u32(entry + 8);
      found = { tag, length, value };
      // DateTimeOriginal wins over anything else we might also be looking for.
      if (tag === 0x9003) break;
    }
    return found;
  }

  const ifd0 = tiff + u32(tiff + 4);
  // 0x8769 is the Exif sub-IFD pointer; 0x0132 is IFD0's own DateTime.
  const first = scan(ifd0, new Set([0x8769, 0x0132]));
  let stamp = null;

  if (first?.tag === 0x8769) {
    const exifIfd = tiff + first.value;
    const original = scan(exifIfd, new Set([0x9003]));
    if (original) stamp = { offset: tiff + original.value, length: original.length };
  }
  if (!stamp && first?.tag === 0x0132) {
    stamp = { offset: tiff + first.value, length: first.length };
  }
  // A pointer found first, but with no DateTimeOriginal behind it: fall back to IFD0.
  if (!stamp && first?.tag === 0x8769) {
    const own = scan(ifd0, new Set([0x0132]));
    if (own?.tag === 0x0132) stamp = { offset: tiff + own.value, length: own.length };
  }
  if (!stamp || stamp.offset + 10 > bytes.length) return null;

  // "YYYY:MM:DD HH:MM:SS"
  const text = String.fromCharCode(...bytes.subarray(stamp.offset, stamp.offset + 10));
  const match = text.match(/^(\d{4}):(\d{2}):(\d{2})$/);
  return match ? plausible(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/**
 * The date of the most recent item in a post.
 *
 * "Most recent" because a set of photos is one memory and it belongs on the day it
 * finished happening — the last shot of an afternoon, not the first.
 *
 * @param {Array<string|null>} dates one per item, missing ones as null
 * @returns {string|null}
 */
export function latestDate(dates) {
  let latest = null;
  for (const date of dates || []) {
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

/**
 * The distinct days a set of media covers, oldest first.
 *
 * `latestDate` says which day to use; this says what there was to choose from, which is
 * what the bot needs in order to admit that it chose. Items with no readable date are
 * dropped rather than counted — an unreadable photo is not evidence of another day, it is
 * an absence of evidence, and a parent told "these span 2 days" about one photo and one
 * blank would rightly wonder what the second day was.
 *
 * @param {Array<string|null>} dates one per item, in any order
 * @returns {string[]} unique YYYY-MM-DD, ascending; empty when nothing was readable
 */
export function distinctDates(dates) {
  const seen = new Set();
  for (const date of dates || []) if (date) seen.add(date);
  return [...seen].sort();
}

/**
 * The one date a set of media agrees on, or nothing.
 *
 * Used to decide whether a new post can be dated from what was attached. Unanimity is the
 * whole test: an afternoon's photos share a day and should date the memory, while a set
 * spanning two days has no single answer and should not pretend to. A single item with no
 * readable date is the same situation — nothing to go on.
 *
 * @param {Array<string|null>} dates one per item, in any order
 * @returns {string|null} the agreed YYYY-MM-DD, or null if they differ or any is unknown
 */
export function agreedDate(dates) {
  const list = Array.isArray(dates) ? dates : [];
  if (!list.length) return null;
  const [first] = list;
  if (!first) return null;
  return list.every((d) => d === first) ? first : null;
}
