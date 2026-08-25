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

/**
 * The display copy: the corrected image, as a file ready to upload.
 *
 * JPEG rather than PNG — these are photographs of paper, where PNG is several times the
 * size for no visible gain. Quality 0.92 is high enough that the compression is not
 * visible on a flat wash of crayon, which is where JPEG shows first.
 *
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function bakeDisplay(image, { width, height, angle, crop, brightness, contrast }) {
  const plan = bakePlan({ width, height, angle, crop });

  const canvas = document.createElement('canvas');
  canvas.width = plan.output.width;
  canvas.height = plan.output.height;
  const ctx = canvas.getContext('2d');

  paint(ctx, image, plan, filterString(brightness, contrast));

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image.'))),
      'image/jpeg', 0.92);
  });
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
export function paintPreview(canvas, image, { width, height, angle, brightness, contrast }, maxEdge) {
  // A full-frame "crop" turns the plan into a plain rotate-and-fit.
  const plan = bakePlan({ width, height, angle, crop: { x: 0, y: 0, w: 1, h: 1 }, maxEdge });
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
