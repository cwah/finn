// Making a photo small enough to send, and small enough to load.
//
// Two different problems that share one piece of arithmetic:
//
//   UPLOAD   a phone photo is 4000x3000 and several megabytes, and the image field refuses
//            anything over 15 MB outright. Verified against production: a 16 MB upload is
//            a 400 with "the maximum allowed file size is 15728640 bytes", and until now
//            that reached a parent as advice about cloud photos.
//
//   PREVIEW  the compose strip shows those same photos at 76 CSS pixels. Decoding ten
//            full-size originals to draw ten thumbnails is tens of megabytes of memory and
//            a visible stall on a phone, for pictures the size of a fingernail.
//
// The maths is separated from the canvas work so it can be tested without a DOM — the
// decision (how big should this end up?) is the part with the edges, and drawing is just
// drawing.

/**
 * The long edge a stored photo is reduced to.
 *
 * Chosen for a DESKTOP viewer: a 2560-wide retina laptop shows the lightbox at up to its
 * own width, and zooming goes to the photo's natural pixels rather than beyond them. So
 * this is "as much as the biggest screen in the house can actually show", not an arbitrary
 * cap — and it takes a typical 4000px phone photo from several MB to about one.
 *
 * The trade is real and worth stating: the stored copy becomes a display copy. The
 * original stays on the phone that took it, which is where the negative has always lived.
 */
export const DISPLAY_EDGE = 2560;

/** What the compose strip and the framing surface need, at 2x for retina. */
export const THUMB_EDGE = 320;

/**
 * Fit a size inside a square bound, keeping its shape.
 *
 * Never enlarges: a photo smaller than the bound is already the best there is, and scaling
 * it up would cost bytes to add nothing. Returns whole pixels, because a canvas sized
 * 1706.6667 is a canvas that quietly rounds and leaves a seam.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} edge longest side allowed
 * @returns {{width: number, height: number, scaled: boolean}}
 */
export function fitWithin(width, height, edge) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  if (!w || !h || !(edge > 0)) return { width: w, height: h, scaled: false };

  const longest = Math.max(w, h);
  if (longest <= edge) return { width: w, height: h, scaled: false };

  const ratio = edge / longest;
  return {
    // At least 1: a panorama 8000x30 would otherwise round its short side to nothing.
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/**
 * Whether a photo is worth re-encoding before it is stored.
 *
 * Two reasons, and either is enough:
 *
 *   it is bigger than any screen will show — pixels nobody will ever see
 *   it is close to the field's limit — where the upload fails outright
 *
 * The size test is deliberately well under 15 MB. A photo of 14.9 MB would technically go
 * through, but it is a slow upload on mobile data for no benefit, and the margin covers a
 * re-encode that comes out slightly larger than expected.
 *
 * @param {{width: number, height: number, size: number}} photo
 * @param {number} maxBytes the largest the store will take
 */
export function needsDownscale({ width, height, size }, maxBytes = 15 * 1024 * 1024) {
  const tooBig = Number(size) > maxBytes * 0.6;
  const tooLarge = Math.max(Number(width) || 0, Number(height) || 0) > DISPLAY_EDGE;
  return Boolean(tooBig || tooLarge);
}

// ── Drawing ───────────────────────────────────────────────────────
// Everything below needs a DOM. Kept apart from the arithmetic above so the decisions
// stay testable, and so this half can be read as "how", not "whether".

/** JPEG quality for a re-encode. High enough that the loss is not visible at any size a
 *  screen will show, low enough to be worth doing at all. */
const QUALITY = 0.85;

/**
 * Decode a file into something a canvas can draw.
 *
 * `createImageBitmap` where it exists: it decodes off the main thread, which on a phone is
 * the difference between a smooth sheet and a locked one while ten photos are read. The
 * <img> path is the fallback, and is what older Safari takes.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch { /* fall through — some builds refuse certain files here but not below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not decode ${file.name || 'that image'}`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (source) => ({
  width: source.naturalWidth || source.width,
  height: source.naturalHeight || source.height,
});

/**
 * Redraw an image at a smaller size, as a JPEG.
 *
 * Always JPEG, whatever went in. A PNG screenshot of a photo is many times the size of the
 * same picture as a JPEG, and a scrapbook holds photographs — the one thing PNG would be
 * right for, sharp-edged graphics, is not what goes in here. Transparency is flattened
 * onto white for the same reason: a JPEG cannot hold it, and unpainted canvas encodes as
 * black, which would turn a transparent PNG into a black rectangle.
 *
 * @param {File|Blob} file
 * @param {number} edge longest side wanted
 * @param {string} name what to call the result
 * @returns {Promise<{file: File, width: number, height: number, scaled: boolean}>}
 */
export async function redraw(file, edge, name) {
  const source = await decode(file);
  try {
    const { width, height } = sizeOf(source);
    const fit = fitWithin(width, height, edge);

    const canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext('2d');
    // Ask for the good resampler. Browsers differ on the default, and the difference
    // between a smooth reduction and a jagged one is visible at these ratios.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, fit.width, fit.height);
    ctx.drawImage(source, 0, 0, fit.width, fit.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('the browser could not re-encode that image');
    return {
      file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
      width: fit.width,
      height: fit.height,
      scaled: fit.scaled,
    };
  } finally {
    // An ImageBitmap holds decoded pixels until it is told not to; ten of these is a lot
    // of memory on a phone.
    source.close?.();
  }
}

/**
 * A small preview of a file, for the compose strip.
 *
 * Returns an object URL the caller owns and must revoke. Falls back to the original file's
 * URL if anything goes wrong — a heavy thumbnail is a performance problem, but no
 * thumbnail is a broken sheet, and the second is much worse.
 */
export async function previewUrl(file) {
  try {
    const small = await redraw(file, THUMB_EDGE, 'thumb.jpg');
    return URL.createObjectURL(small.file);
  } catch {
    return URL.createObjectURL(file);
  }
}

/**
 * A photo reduced to what a screen can show, if it is worth doing.
 *
 * Returns the file UNCHANGED when it is already reasonable, so an ordinary photo is never
 * re-encoded and never loses anything. The name is kept: it carries the date that
 * `filenameDate` reads, and a memory dated from `thumb.jpg` would be dated today.
 *
 * @returns {Promise<{file: File, width: number, height: number, scaled: boolean}>}
 */
export async function forDisplay(file, width, height, maxBytes) {
  if (!needsDownscale({ width, height, size: file.size }, maxBytes)) {
    return { file, width, height, scaled: false };
  }
  try {
    return await redraw(file, DISPLAY_EDGE, file.name || 'photo.jpg');
  } catch {
    // Better to try the upload with the original than to refuse the memory outright: it
    // may well be under the limit anyway, and if it is not, the server says so plainly.
    return { file, width, height, scaled: false };
  }
}
