// Frame one photo: choose the crop, choose the focal point, or promote it to lead.
//
// Nothing here alters the uploaded file. A crop is stored as a rectangle and applied at
// render, so it can be widened, moved or removed later — the original is kept whole,
// forever.
//
// Crop and focus are separate modes rather than two drags competing on one surface:
//
//   Crop  — the WHOLE photo, with a rectangle over it. What to keep.
//   Focus — only the cropped result, in a square. Where to centre it when a card's cell
//           is a different shape again, which is the one thing a crop cannot settle.
//
// Both are needed: cropping picks the picture, the focal point survives the second crop
// that a square grid cell imposes on top of it.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1000) / 1000;

/** Smallest crop we allow, as a fraction — below this the result is unusably soft. */
const MIN_CROP = 0.1;

const PRESETS = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
];

/**
 * @param {{url: string, width: number, height: number, focalX?: number, focalY?: number,
 *          crop?: {x,y,w,h}|null}} photo
 * @param {{isMain: boolean}} opts
 * @returns {Promise<{focalX, focalY, crop, makeMain}|null>} null when dismissed
 */
export function openPhotoEditor(photo, { isMain }) {
  const sheet = document.getElementById('photoEditor');
  const modes = sheet.querySelector('.editor-modes');
  const cropPane = sheet.querySelector('.editor-crop');
  const cropImg = sheet.querySelector('.editor-crop-img');
  const rect = sheet.querySelector('.editor-rect');
  const presetBar = sheet.querySelector('.editor-presets');
  const focusPane = sheet.querySelector('.editor-focus');
  const stage = sheet.querySelector('.editor-stage');
  const img = sheet.querySelector('.editor-img');
  const dot = sheet.querySelector('.editor-dot');
  const hint = sheet.querySelector('.editor-hint');
  const mainBtn = sheet.querySelector('.editor-main');
  const doneBtn = sheet.querySelector('.editor-done');

  // Working copy — nothing is committed until Done.
  let crop = { ...(photo.crop || { x: 0, y: 0, w: 1, h: 1 }) };
  let fx = photo.focalX ?? 0.5;
  let fy = photo.focalY ?? 0.5;
  let ratio = null;
  let makeMain = false;
  let mode = 'crop';

  // ── Painting ─────────────────────────────────────────────────────
  function paintCrop() {
    rect.style.left = `${crop.x * 100}%`;
    rect.style.top = `${crop.y * 100}%`;
    rect.style.width = `${crop.w * 100}%`;
    rect.style.height = `${crop.h * 100}%`;
  }

  function paintFocus() {
    // The focus pane previews the cropped result, so it uses the same maths the card does.
    img.style.width = `${100 / crop.w}%`;
    img.style.left = `${(crop.x / crop.w) * -100}%`;
    img.style.top = `${(crop.y / crop.h) * -100}%`;
    stage.style.setProperty('--crop-ar', `${photo.width * crop.w} / ${photo.height * crop.h}`);
    dot.style.left = `${fx * 100}%`;
    dot.style.top = `${fy * 100}%`;
  }

  function setMode(next) {
    mode = next;
    cropPane.hidden = next !== 'crop';
    focusPane.hidden = next !== 'focus';
    hint.textContent = next === 'crop'
      ? 'Drag the corners to choose what to keep.'
      : 'Drag to choose what stays centred in square cards.';
    [...modes.children].forEach((b) => b.classList.toggle('is-on', b.dataset.mode === next));
    if (next === 'focus') paintFocus();
  }

  // ── Crop dragging ────────────────────────────────────────────────
  /** Resize from a corner, keeping the opposite corner pinned. */
  function resizeFrom(corner, px, py) {
    const right = crop.x + crop.w;
    const bottom = crop.y + crop.h;
    let { x, y } = crop;
    let w;
    let h;

    if (corner.includes('w')) { x = Math.min(px, right - MIN_CROP); w = right - x; }
    else { w = Math.max(MIN_CROP, px - crop.x); }
    if (corner.includes('n')) { y = Math.min(py, bottom - MIN_CROP); h = bottom - y; }
    else { h = Math.max(MIN_CROP, py - crop.y); }

    if (ratio) {
      // Honour the preset by deriving the shorter side, in the photo's own proportions.
      const photoAr = photo.width / photo.height;
      h = (w * photoAr) / ratio;
      if (corner.includes('n')) y = bottom - h;
    }

    // Never let a drag push the rectangle off the photo.
    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    crop = { x: clamp01(x), y: clamp01(y), w, h };
    paintCrop();
  }

  let drag = null;
  cropPane.addEventListener('pointerdown', (e) => {
    const r = cropImg.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width);
    const py = clamp01((e.clientY - r.top) / r.height);
    const handle = e.target.dataset?.handle;
    drag = handle ? { kind: 'resize', corner: handle } : { kind: 'move', px, py, from: { ...crop } };
    cropPane.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  cropPane.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = cropImg.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width);
    const py = clamp01((e.clientY - r.top) / r.height);

    if (drag.kind === 'resize') {
      resizeFrom(drag.corner, px, py);
    } else {
      // Move keeps the size and slides within the photo's bounds.
      crop.x = Math.min(Math.max(drag.from.x + (px - drag.px), 0), 1 - crop.w);
      crop.y = Math.min(Math.max(drag.from.y + (py - drag.py), 0), 1 - crop.h);
      paintCrop();
    }
  });

  const endCropDrag = (e) => {
    drag = null;
    if (cropPane.hasPointerCapture?.(e.pointerId)) cropPane.releasePointerCapture(e.pointerId);
  };
  cropPane.addEventListener('pointerup', endCropDrag);
  cropPane.addEventListener('pointercancel', endCropDrag);

  // ── Presets ──────────────────────────────────────────────────────
  presetBar.replaceChildren(...PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'editor-preset';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      ratio = p.ratio;
      [...presetBar.children].forEach((n) => n.classList.toggle('is-on', n === b));
      if (ratio) {
        // Re-shape around the current centre so the subject does not jump.
        const cx = crop.x + crop.w / 2;
        const cy = crop.y + crop.h / 2;
        const photoAr = photo.width / photo.height;
        let w = crop.w;
        let h = (w * photoAr) / ratio;
        if (h > 1) { h = 1; w = (h * ratio) / photoAr; }
        crop = {
          w, h,
          x: clamp01(Math.min(Math.max(cx - w / 2, 0), 1 - w)),
          y: clamp01(Math.min(Math.max(cy - h / 2, 0), 1 - h)),
        };
        paintCrop();
      }
    });
    return b;
  }));
  presetBar.firstElementChild.classList.add('is-on');

  // ── Focus dragging ───────────────────────────────────────────────
  function moveFocus(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    fx = clamp01((clientX - r.left) / r.width);
    fy = clamp01((clientY - r.top) / r.height);
    paintFocus();
  }

  let focusing = false;
  const onFocusDown = (e) => {
    focusing = true;
    stage.setPointerCapture(e.pointerId);
    moveFocus(e.clientX, e.clientY);
    e.preventDefault();
  };
  const onFocusMove = (e) => { if (focusing) moveFocus(e.clientX, e.clientY); };
  const onFocusUp = (e) => {
    focusing = false;
    if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener('pointerdown', onFocusDown);
  stage.addEventListener('pointermove', onFocusMove);
  stage.addEventListener('pointerup', onFocusUp);
  stage.addEventListener('pointercancel', onFocusUp);

  // ── Open ─────────────────────────────────────────────────────────
  cropImg.src = photo.url;
  img.src = photo.url;
  cropPane.style.setProperty('--img-ar', `${photo.width} / ${photo.height}`);
  paintCrop();

  [...modes.children].forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode);
  });
  setMode('crop');

  mainBtn.hidden = isMain;
  mainBtn.classList.remove('is-chosen');
  mainBtn.textContent = 'Make main photo';
  const onMain = () => {
    makeMain = true;
    mainBtn.classList.add('is-chosen');
    mainBtn.textContent = 'Will lead this post';
  };
  mainBtn.addEventListener('click', onMain);

  sheet.showModal();

  return new Promise((resolve) => {
    let saved = false;
    const finish = () => {
      stage.removeEventListener('pointerdown', onFocusDown);
      stage.removeEventListener('pointermove', onFocusMove);
      stage.removeEventListener('pointerup', onFocusUp);
      stage.removeEventListener('pointercancel', onFocusUp);
      mainBtn.removeEventListener('click', onMain);
      sheet.removeEventListener('close', finish);
      cropImg.removeAttribute('src');
      img.removeAttribute('src');

      const whole = crop.w >= 0.999 && crop.h >= 0.999;
      resolve(saved ? {
        focalX: round(fx),
        focalY: round(fy),
        // A crop covering the whole photo is no crop at all — store nothing.
        crop: whole ? null : {
          x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h),
        },
        makeMain,
      } : null);
    };

    doneBtn.addEventListener('click', () => { saved = true; sheet.close(); }, { once: true });
    sheet.addEventListener('close', finish); // covers ESC and the backdrop too
  });
}
