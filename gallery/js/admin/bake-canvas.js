// Running a bake plan on a canvas.
//
// Not pure — it touches the DOM and produces a Blob. It is also nearly the whole of the
// impure half of the image work: every number it uses was decided by js/bake.js, which
// is tested, and this file is a loop over the steps that file handed back.
//
// Keeping the split here is what makes the geometry testable at all. There is no canvas
// in node, so anything that lived in this file could only ever be checked by looking.

import { bakePlan, filterString } from '../bake.js';

/**
 * Draw the straightened, cropped, adjusted image.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} image
 * @param {object} plan from bakePlan
 * @param {string} filter from filterString
 */
export function paint(ctx, image, plan, filter) {
  ctx.save();
  ctx.clearRect(0, 0, plan.output.width, plan.output.height);

  // A photo of paper is being rescaled, not pixel art; smoothing is what stops the
  // straightened edges of the drawing looking like a staircase.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ctx.filter takes the SAME string the live preview puts on element.style.filter, so
  // what was on screen is what gets written. Set before drawing; it applies to the draw.
  if (filter) ctx.filter = filter;

  for (const step of plan.steps) {
    if (step.op === 'scale') ctx.scale(step.x, step.y);
    else if (step.op === 'translate') ctx.translate(step.x, step.y);
    else if (step.op === 'rotate') ctx.rotate(step.radians);
    else if (step.op === 'drawImage') ctx.drawImage(image, 0, 0);
  }
  ctx.restore();
}

/** Quality for the stored copy. Measured rather than guessed — see encode(). */
const QUALITY = 0.85;

let _webp = null;

/**
 * Whether this browser can actually ENCODE WebP.
 *
 * Decoding is universal; encoding is not — and canvas.toBlob does not fail when asked for
 * a type it cannot produce. It quietly hands back a PNG, which for a photograph is
 * several times larger than the JPEG it was meant to improve on. So the answer is
 * measured once, by encoding a single pixel and looking at what came back.
 */
async function canEncodeWebp() {
  if (_webp !== null) return _webp;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1; probe.height = 1;
    const blob = await new Promise((r) => probe.toBlob(r, 'image/webp', 0.8));
    _webp = blob?.type === 'image/webp';
  } catch {
    _webp = false;
  }
  return _webp;
}

/** Encode a canvas as small as this browser can manage. */
async function encode(canvas) {
  const type = (await canEncodeWebp()) ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image.'))),
      type, QUALITY);
  });
}

/**
 * The display copy: the corrected image, as a file ready to upload.
 *
 * WebP at 0.85, falling back to JPEG where it cannot be encoded. Measured on three real
 * drawings rather than assumed: at the same 2000px edge, JPEG/0.92 produced 361, 422 and
 * 505 KB; JPEG/0.85 produced 272, 331 and 325; WebP/0.85 produced 153, 187 and 174.
 * About a third of the bytes for no visible difference on a flat wash of paint — which
 * is where lossy compression shows first, and these are mostly flat washes of paint.
 *
 * PNG was never a candidate; these are photographs of paper.
 *
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function bakeDisplay(image, { width, height, angle, crop, brightness, contrast, maxEdge }) {
  const plan = bakePlan({ width, height, angle, crop, maxEdge });

  const canvas = document.createElement('canvas');
  canvas.width = plan.output.width;
  canvas.height = plan.output.height;
  const ctx = canvas.getContext('2d');

  paint(ctx, image, plan, filterString(brightness, contrast));

  const blob = await encode(canvas);
  return { blob, width: plan.output.width, height: plan.output.height };
}

/**
 * Redraw the editor's preview: the whole rotated frame, adjustments applied, at whatever
 * size fits on screen.
 *
 * The preview deliberately shows the FULL rotated bounding box rather than just the
 * crop, corners and all — the empty wedges rotation leaves behind are the thing the crop
 * has to be kept out of, and they are much easier to stay clear of when they are visible.
 */
export function paintPreview(canvas, image, { width, height, angle, brightness, contrast },
  maxEdge, crop = null) {
  // No crop means the whole rotated frame, corners and all — which is what the crop box
  // is dragged around on. Passing one shows the finished result instead.
  const plan = bakePlan({ width, height, angle, crop: crop ?? { x: 0, y: 0, w: 1, h: 1 }, maxEdge });
  canvas.width = plan.output.width;
  canvas.height = plan.output.height;
  paint(canvas.getContext('2d'), image, plan, filterString(brightness, contrast));
  return plan.output;
}

/** An <img> that has finished decoding, from a File the user picked. */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // The object URL is revoked only after the image is decoded and safe to draw from.
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    // Browsers apply EXIF orientation by default, so img.naturalWidth/Height are already
    // the dimensions as rendered. That is what every calculation downstream assumes, and
    // it is why the manifest tool had to read EXIF but this does not.
    img.src = url;
  });
}

/**
 * A small JPEG of the corrected drawing, as base64, for sending to a model.
 *
 * Deliberately not the display copy. That is up to 2000px and a megabyte, the request
 * body would have to carry it base64-encoded at four thirds the size, and the model
 * resizes anything larger than about 1568px on its longest edge anyway. A thousand
 * pixels is plenty to describe a drawing and makes the call quicker and cheaper.
 *
 * @returns {Promise<{data: string, mediaType: string}>} data has no data: prefix
 */
export async function bakeForModel(image, adjust, maxEdge = 1024) {
  const { blob } = await bakeDisplay(image, { ...adjust, maxEdge });
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the image back.'));
    reader.readAsDataURL(blob);
  });
  return { data, mediaType: blob.type || 'image/jpeg' };
}
