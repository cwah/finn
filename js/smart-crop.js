// Where should a cover-cropped thumbnail be centred?
//
// Photos are shown cropped in two places — grid cells and the portrait/landscape frame —
// and a centre crop regularly cuts the baby's head off. This picks a focal point from
// the image's own content, which the renderer feeds to `object-position`. The stored
// file is never touched; only the framing changes.
//
// Split in two on purpose:
//   focalFromLuma() — PURE scoring, no DOM, unit-tested
//   detectFocalPoint() — the thin canvas wrapper that feeds it
//
// The heuristic: detail attracts the eye. Compute local contrast per pixel, then take
// the energy-weighted centroid. Faces, eyes and patterned clothing carry far more local
// contrast than sky, walls or blankets, so the centroid lands on the subject without
// anything as heavy as face detection.

/** Analysis runs on a thumbnail this size — enough signal, trivial cost. */
const SAMPLE = 64;

/** Never park the focus hard against an edge; a sliver of context always reads better. */
const MIN = 0.15;
const MAX = 0.85;

/** How strongly the centre is favoured when an image has no clear subject. */
const CENTRE_PULL = 0.35;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Focal point from a downscaled luma map.
 *
 * @param {ArrayLike<number>} luma per-pixel brightness 0–255, row-major, length w*h
 * @param {number} w
 * @param {number} h
 * @returns {{x: number, y: number}} normalised 0–1, clamped away from the edges
 */
export function focalFromLuma(luma, w, h) {
  if (!w || !h || luma.length < w * h) return { x: 0.5, y: 0.5 };

  let sum = 0;
  let sx = 0;
  let sy = 0;

  // Local contrast: |horizontal gradient| + |vertical gradient|. Skipping the border
  // costs nothing and avoids special-casing the edges.
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const energy = Math.abs(luma[i + 1] - luma[i - 1]) + Math.abs(luma[i + w] - luma[i - w]);
      if (energy === 0) continue;
      sum += energy;
      sx += energy * x;
      sy += energy * y;
    }
  }

  // A flat image — a sleeping baby on a plain blanket — has nothing to aim at.
  if (sum === 0) return { x: 0.5, y: 0.5 };

  const cx = sx / sum / (w - 1);
  const cy = sy / sum / (h - 1);

  // Pull back toward the middle so a little noise in a corner cannot yank the framing.
  const x = cx + (0.5 - cx) * CENTRE_PULL;
  const y = cy + (0.5 - cy) * CENTRE_PULL;

  return { x: round(clamp(x, MIN, MAX)), y: round(clamp(y, MIN, MAX)) };
}

/** Two decimals is finer than any thumbnail can show, and keeps the records tidy. */
function round(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Pick a focal point for an image file. Falls back to dead centre if anything about the
 * decode or canvas read fails — a centre crop is the old behaviour, never an error.
 *
 * @param {File|Blob} file
 * @returns {Promise<{x: number, y: number}>}
 */
export async function detectFocalPoint(file) {
  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: SAMPLE,
      resizeHeight: SAMPLE,
      resizeQuality: 'low',
    });

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Rec. 601 luma, which tracks perceived brightness far better than a flat average.
    const luma = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    return focalFromLuma(luma, width, height);
  } catch {
    return { x: 0.5, y: 0.5 };
  }
}
