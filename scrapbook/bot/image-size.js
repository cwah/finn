// Intrinsic dimensions, read from an image's own header bytes.
//
// PURE, and dependency-free by necessity: the browser gets dimensions by decoding an
// image on a canvas, and node has neither. Every layout in this app is chosen from stored
// width/height, so a photo the bot cannot measure is a photo it cannot post — which is
// exactly why it used to refuse images sent as files.
//
// Only the formats a phone actually sends, read from the header and nothing more:
//
//   JPEG — walk the marker segments to the frame header (SOFn), which carries the size.
//   PNG  — the IHDR chunk is always first, at a fixed offset.
//
// Anything else returns null and the sender is told, rather than a guess being stored.

/** SOF markers carry the frame size. SOF4/8/12 (0xC4, 0xC8, 0xCC) are NOT frame headers. */
const isFrameHeader = (marker) =>
  (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegSize(bytes) {
  let i = 2; // past the SOI marker
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; } // resync over padding
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone markers carry no payload
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (isFrameHeader(marker)) {
      // ff, marker, length(2), precision(1), height(2), width(2)
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + length;
  }
  return null;
}

function pngSize(bytes) {
  // 8-byte signature, then the IHDR chunk: length(4), 'IHDR', width(4), height(4).
  if (bytes.length < 24) return null;
  const read32 = (at) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  return { width: read32(16), height: read32(20) };
}

/**
 * @param {Uint8Array} bytes the start of the file is enough — a few KB will do
 * @returns {{width: number, height: number}|null} null when it cannot be read
 */
export function imageSize(bytes) {
  // Enough for a signature and a first segment header. PNG needs more and checks itself;
  // a small jpeg is perfectly readable well before 24 bytes.
  if (!bytes || bytes.length < 12) return null;

  const size = (bytes[0] === 0xff && bytes[1] === 0xd8) ? jpegSize(bytes)
    : (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
      ? pngSize(bytes)
      : null;

  // A zero dimension is as unusable as no dimension at all.
  return size && size.width > 0 && size.height > 0 ? size : null;
}
