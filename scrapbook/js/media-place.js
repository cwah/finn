// Where a photograph was taken, from the photograph.
//
// EXIF carries coordinates in a GPS sub-IFD, in a shape nobody would choose: degrees,
// minutes and seconds, each a pair of 32-bit integers to be divided, with the hemisphere
// in a separate tag as the letter N, S, E or W. Reading it is fiddly but entirely local —
// nothing leaves the device, which is the whole reason it is done this way.
//
// The TIFF walking is deliberately a copy of the shape in media-date.js rather than a
// shared abstraction. They read different tags in different sub-IFDs and the common part
// is twenty lines of byte arithmetic; factoring it would tangle two things that only look
// alike, and the date reader is well tested where it stands.

/** Whether a pair of coordinates could be a real place. */
function plausible(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Null Island. A camera that has a GPS chip but no fix writes zeroes, and the Gulf of
  // Guinea is not where anybody's photographs are.
  if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) return null;
  return { lat, lon };
}

/**
 * Coordinates from a JPEG's EXIF, or null.
 *
 * @param {Uint8Array} bytes the head of the file — a few hundred KB is plenty
 * @returns {{lat: number, lon: number}|null}
 */
export function exifLocation(bytes) {
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

  /** Every entry of an IFD, by tag. */
  function entries(ifd) {
    const found = new Map();
    if (ifd + 2 > bytes.length) return found;
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + (i * 12);
      if (entry + 12 > bytes.length) break;
      found.set(u16(entry), { type: u16(entry + 2), length: u32(entry + 4), value: u32(entry + 8) });
    }
    return found;
  }

  /** Degrees, minutes and seconds — three RATIONALs, each a numerator over a denominator. */
  function degrees(entry) {
    if (!entry || entry.type !== 5 || entry.length < 3) return NaN;
    const base = tiff + entry.value;
    if (base + 24 > bytes.length) return NaN;
    let total = 0;
    for (let i = 0; i < 3; i += 1) {
      const num = u32(base + (i * 8));
      const den = u32(base + (i * 8) + 4);
      if (!den) return NaN;
      total += (num / den) / (60 ** i);   // degrees, then minutes, then seconds
    }
    return total;
  }

  /** The hemisphere letter, stored as a one-character ASCII tag inline. */
  function letter(entry) {
    if (!entry) return '';
    // Four bytes or fewer live in the entry itself rather than at an offset.
    const at2 = entry.length <= 4 ? 0 : tiff + entry.value;
    const code = entry.length <= 4 ? (entry.value >>> (little ? 0 : 24)) & 0xff : bytes[at2];
    return String.fromCharCode(code).toUpperCase();
  }

  // 0x8825 is the GPS sub-IFD pointer, hanging off IFD0.
  const ifd0 = entries(tiff + u32(tiff + 4));
  const pointer = ifd0.get(0x8825);
  if (!pointer) return null;

  const gps = entries(tiff + pointer.value);
  const lat = degrees(gps.get(0x0002));
  const lon = degrees(gps.get(0x0004));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const south = letter(gps.get(0x0001)) === 'S';
  const west = letter(gps.get(0x0003)) === 'W';
  return plausible(south ? -lat : lat, west ? -lon : lon);
}

/**
 * The places a set of media agree on, if they agree.
 *
 * The same shape as the date logic, and for the same reason: a post is one memory, so a
 * single place can be filled in for it — but when the media disagree there is no right
 * answer to pick, and guessing one is worse than offering both.
 *
 * Coordinates are compared as PLACES, not as numbers: two photographs taken an hour apart
 * in the same town are never at the same coordinates, and treating them as different
 * locations would make the common case look like disagreement.
 */
export function distinctPlaces(places) {
  const seen = [];
  for (const place of places || []) {
    if (!place || !place.name) continue;
    if (!seen.some((p) => p.name === place.name && p.region === place.region
      && p.country === place.country)) {
      seen.push(place);
    }
  }
  return seen;
}

/** The one place they all agree on, or null when they do not. */
export function agreedPlace(places) {
  const distinct = distinctPlaces(places);
  return distinct.length === 1 ? distinct[0] : null;
}

/** "Brooklyn, NY" — or "Brooklyn, US" where there is no useful region. */
export function placeLabel(place) {
  if (!place || !place.name) return '';
  const tail = place.region || place.country || '';
  return tail ? `${place.name}, ${tail}` : place.name;
}
