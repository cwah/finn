// Intrinsic dimensions, read from an image's own header bytes.
//
// PURE, and dependency-free by necessity: node has no image decoder, and there is no
// build step here to add one. Ported from scrapbook's bot/image-size.js, with two
// additions this project needs — SVG, and EXIF orientation.
//
//   JPEG — walk the marker segments to the frame header (SOFn), which carries the size
//   PNG  — the IHDR chunk is always first, at a fixed offset
//   SVG  — the width and height attributes on the root element
//
// ── The EXIF trap ────────────────────────────────────────────────────────────
// A JPEG's SOF header carries PRE-ROTATION dimensions, but browsers default to
// `image-orientation: from-image` and render the photo rotated. So a phone photo of a
// portrait drawing measures as landscape here, the manifest records 4:3, and the
// frame comes out the wrong shape with the artwork cropped inside it — with nothing
// anywhere reporting an error.
//
// Scrapbook sidesteps this by storing a rotation field and applying it at render.
// finnart has no editor, so the fix has to happen at the point of measurement:
// orientations 5-8 are the ones that transpose the image, and their dimensions are
// swapped before they are ever written down.

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
 * The width and height attributes off an <svg> root.
 *
 * Only plain pixel values. An SVG sized in percent or in physical units has no
 * intrinsic pixel size to record, and guessing one would put a wrong ratio in the
 * manifest, which is the thing this file exists to avoid.
 */
function svgSize(bytes) {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('utf8');
  const open = /<svg\b[^>]*>/i.exec(head);
  if (!open) return null;
  const attr = (name) => {
    const found = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, 'i')
      .exec(open[0]);
    return found ? Number(found[1]) : null;
  };
  const width = attr('width');
  const height = attr('height');
  if (width && height) return { width, height };

  // No width/height, but a viewBox gives the ratio, and for a vector the ratio is the
  // only thing the layout actually needs.
  const box = /\bviewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i.exec(open[0]);
  return box ? { width: Number(box[1]), height: Number(box[2]) } : null;
}

/**
 * The EXIF Orientation tag (0x0112) of a JPEG, 1-8, or null.
 *
 * The IFD walk is scrapbook’s, from scrapbook/js/media-date.js. The difference is the read:
 * that file wants ASCII tags, and Orientation is a SHORT — u16 at the start of the
 * value field, which is where a 2-byte value sits under either byte order.
 *
 * @param {Uint8Array} bytes
 * @returns {number|null}
 */
export function exifOrientation(bytes) {
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

  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > bytes.length) return null;
  const count = u16(ifd0);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + (i * 12);
    if (entry + 12 > bytes.length) break;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/**
 * Dimensions as a BROWSER will lay the file out — that is, after EXIF rotation.
 *
 * @param {Uint8Array} bytes the start of the file; a few KB is plenty
 * @returns {{width: number, height: number, orientation: number|null}|null}
 */
export function imageSize(bytes) {
  if (!bytes || bytes.length < 12) return null;

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

  const size = isJpeg ? jpegSize(bytes) : isPng ? pngSize(bytes) : svgSize(bytes);
  if (!size || !size.width || !size.height) return null;

  const orientation = isJpeg ? exifOrientation(bytes) : null;
  // 5, 6, 7 and 8 are the quarter-turns. They transpose the image, so what the header
  // calls width is what the browser will lay out as height.
  const turned = orientation != null && orientation >= 5 && orientation <= 8;

  return {
    width: turned ? size.height : size.width,
    height: turned ? size.width : size.height,
    orientation,
  };
}
