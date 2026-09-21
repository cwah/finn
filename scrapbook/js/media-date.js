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
  const text = findDateTimeText(bytes);
  if (!text) return null;
  const match = text.slice(0, 10).match(/^(\d{4}):(\d{2}):(\d{2})$/);
  return match ? plausible(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/**
 * The raw "YYYY:MM:DD HH:MM:SS" out of EXIF, or null.
 *
 * Separated from exifDate so the clock can be read without a second copy of the byte
 * walking — the date and the time are the same nineteen characters, and two parsers
 * reading them apart is exactly how they would come to disagree.
 */
function findDateTimeText(bytes) {
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

  // Nineteen characters when they are there, ten when the tag is short — the date alone is
  // still useful, and a truncated tag is not a reason to discard it.
  const end = Math.min(stamp.offset + 19, bytes.length);
  return String.fromCharCode(...bytes.subarray(stamp.offset, end));
}

/**
 * The same tag, read to the second.
 *
 * The time was always there — EXIF writes "YYYY:MM:DD HH:MM:SS" and exifDate reads the
 * first ten characters of it. Only the day was ever wanted, so the rest was dropped.
 *
 * It is wanted now, to ORDER a day: two posts made on the same afternoon were shown in
 * the order they happened to be typed up, so photographs from an evening could sit above
 * ones from that morning. The time says which came first.
 *
 * Returned as a real instant, read in the timezone of the device doing the reading, which
 * is where the photograph was almost certainly taken. Not for display — nothing shows a
 * photograph's clock time — only for putting a day in order.
 *
 * @returns {string|null} an ISO timestamp
 */
export function exifDateTime(bytes) {
  const day = exifDate(bytes);
  if (!day) return null;

  const at = findDateTimeText(bytes);
  const clock = at && at.match(/^\d{4}:\d{2}:\d{2} (\d{2}):(\d{2}):(\d{2})/);
  if (!clock) return `${day}T00:00:00`;

  const [y, m, d] = day.split('-').map(Number);
  const when = new Date(y, m - 1, d, Number(clock[1]), Number(clock[2]), Number(clock[3]));
  return Number.isNaN(when.getTime()) ? `${day}T00:00:00` : when.toISOString();
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

/**
 * When a memory happened, to the minute — for ordering a day.
 *
 * A scrapbook is ordered by the day a memory belongs to, and within a day it was ordered
 * by when the POST WAS TYPED UP. Those are not the same thing: photographs from an evening
 * written up the next morning sat above photographs from that morning written up later
 * still, and the day read backwards.
 *
 * So when the media themselves say when they happened, they decide. The MOST RECENT item
 * is used, for the same reason the date is: a set of photographs is one memory and it
 * belongs at the moment it finished happening.
 *
 * ONLY WHEN THE MEDIA AGREE WITH THE DAY. A parent who backdates a post to a birthday, or
 * corrects a wrong date, has said something the files have not — and a photograph's clock
 * from some other day says nothing about where this memory sits among that day's others.
 * Then the fallback stands, which is when the post was made.
 *
 * @param {Array<{takenOn: string|null, takenTime: string|null}>} items the post's media
 * @param {string} memoryDate the day the post is filed under, YYYY-MM-DD
 * @param {string} fallback an ISO timestamp for when none of them match
 * @returns {string} an ISO timestamp
 */
export function happenedAt(items, memoryDate, fallback) {
  let latest = null;
  for (const item of items || []) {
    if (!item || item.takenOn !== memoryDate || !item.takenTime) continue;
    const when = new Date(item.takenTime);
    if (Number.isNaN(when.getTime())) continue;
    if (!latest || when > latest) latest = when;
  }
  return latest ? latest.toISOString() : fallback;
}
