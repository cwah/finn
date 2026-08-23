// Frame one photo: choose the crop, choose the focal point, or promote it to lead.
//
// Nothing here alters the uploaded file. A crop is stored as a rectangle and applied at
// render, so it can be widened, moved or removed later — the original is kept whole,
// forever.
//
// Both settings live on ONE surface, the whole photo:
//
//   drag a corner  — resize the crop
//   drag elsewhere — move the crop
//   tap            — set the focal point
//
// A tap is distinguished from a drag by whether the pointer travelled, which keeps the
// two gestures from competing without asking the parent to pick a mode first.
//
// The focal point still earns its place alongside the crop: cropping picks the picture,
// but a square grid cell crops again on top of that, and the focal point is what decides
// where THAT crop centres.

import { MAX_CLIP_SECONDS, rotationOf, turnFraming } from './layout-engine.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1000) / 1000;

/** Smallest crop we allow, as a fraction — below this the result is unusably soft. */
const MIN_CROP = 0.1;

/** Pointer travel, in px, above which a gesture is a drag rather than a tap. */
const TAP_SLOP = 6;

const PRESETS = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
];

/**
 * @param {{url, width, height, focalX?, focalY?, crop?, rotation?,
 *          videoUrl?, duration?, trimStart?, trimEnd?}} photo
 * @param {{isMain: boolean}} opts
 * @returns {Promise<{focalX, focalY, crop, rotation, trimStart, trimEnd, makeMain}|null>}
 *          null when dismissed
 */
export function openPhotoEditor(photo, { isMain }) {
  const sheet = document.getElementById('photoEditor');
  const pane = sheet.querySelector('.editor-crop');
  let cropImg = sheet.querySelector('.editor-crop-img');
  const rect = sheet.querySelector('.editor-rect');
  const dot = sheet.querySelector('.editor-dot');
  const presetBar = sheet.querySelector('.editor-presets');
  const mainBtn = sheet.querySelector('.editor-main');
  const doneBtn = sheet.querySelector('.editor-done');
  const rotor = sheet.querySelector('.editor-rotor');
  const rotateBtns = [...sheet.querySelectorAll('.editor-rotate')];
  const trimPane = sheet.querySelector('.editor-trim');
  const trimBar = sheet.querySelector('.editor-trim-bar');
  const trimRangeEl = sheet.querySelector('.editor-trim-range');
  const trimRead = sheet.querySelector('.editor-trim-read');

  // Working copy — nothing is committed until Done.
  let crop = { ...(photo.crop || { x: 0, y: 0, w: 1, h: 1 }) };

  // The focal point is held in PHOTO space here, not crop space, so the dot stays on the
  // subject while the crop is dragged around it. It is converted back on save.
  let fpx = crop.x + (photo.focalX ?? 0.5) * crop.w;
  let fpy = crop.y + (photo.focalY ?? 0.5) * crop.h;

  let ratio = null;
  let makeMain = false;

  // Rotation is framing too: stored as degrees and applied at render, so the file is
  // never re-encoded and turning a photo the wrong way costs nothing to undo.
  let rotation = rotationOf(photo);

  // Trimming, for a clip. Seconds into the SOURCE file, which keeps every frame.
  const duration = Number(photo.duration) || 0;
  const isClip = Boolean(photo.videoUrl) && duration > 0;
  let trimStart = Math.min(Math.max(Number(photo.trimStart) || 0, 0), duration);
  let trimEnd = Number(photo.trimEnd) > trimStart
    ? Math.min(Number(photo.trimEnd), duration)
    : Math.min(duration, trimStart + MAX_CLIP_SECONDS);

  // ── Painting ─────────────────────────────────────────────────────
  /** Seconds as a clock: 8 -> 0:08. */
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  /**
   * The photo's shape as PRESENTED — turned, before cropping. The crop rectangle is
   * expressed against this, so a crop keeps framing what it framed when it was dragged
   * and turning the photo afterwards does not re-frame the picture.
   */
  function oriented() {
    const quarter = rotation % 180 !== 0;
    return quarter
      ? { width: photo.height, height: photo.width }
      : { width: photo.width, height: photo.height };
  }

  function paint() {
    rect.style.left = `${crop.x * 100}%`;
    rect.style.top = `${crop.y * 100}%`;
    rect.style.width = `${crop.w * 100}%`;
    rect.style.height = `${crop.h * 100}%`;
    dot.style.left = `${fpx * 100}%`;
    dot.style.top = `${fpy * 100}%`;

    // The surface takes the turned shape, and the rotor turns the media inside it.
    const o = oriented();
    pane.style.setProperty('--img-ar', `${o.width} / ${o.height}`);
    rotor.style.setProperty('--rot', rotation);
    rotor.style.setProperty('--oar', o.width / o.height);
    rotor.style.aspectRatio = `${o.width} / ${o.height}`;
    rotor.classList.toggle('is-quarter', rotation % 180 !== 0);

    if (!isClip) return;
    const left = (trimStart / duration) * 100;
    const right = (trimEnd / duration) * 100;
    trimRangeEl.style.left = `${left}%`;
    trimRangeEl.style.width = `${right - left}%`;
    trimBar.querySelector('[data-trim="start"]').style.left = `${left}%`;
    trimBar.querySelector('[data-trim="end"]').style.left = `${right}%`;
    const length = trimEnd - trimStart;
    trimRead.textContent =
      `${clock(trimStart)} – ${clock(trimEnd)} · ${length.toFixed(1)}s`
      + (length >= MAX_CLIP_SECONDS - 0.05 ? ' (the longest a memory can play)' : '');
  }

  /** A focal point outside the crop describes nothing, so keep it within. */
  function confineFocus() {
    fpx = Math.min(Math.max(fpx, crop.x), crop.x + crop.w);
    fpy = Math.min(Math.max(fpy, crop.y), crop.y + crop.h);
  }

  /** Pointer position as a fraction of the photo. */
  function at(e) {
    const r = cropImg.getBoundingClientRect();
    return { px: clamp01((e.clientX - r.left) / r.width), py: clamp01((e.clientY - r.top) / r.height) };
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

    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    crop = { x: clamp01(x), y: clamp01(y), w, h };
    confineFocus();
    paint();
  }

  let drag = null;

  const onDown = (e) => {
    const { px, py } = at(e);
    const handle = e.target.dataset?.handle;
    drag = {
      kind: handle ? 'resize' : 'move',
      corner: handle,
      px,
      py,
      from: { ...crop },
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    pane.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!drag) return;
    if (!drag.moved) {
      // Until the pointer has actually travelled, this could still be a tap.
      const far = Math.abs(e.clientX - drag.startX) > TAP_SLOP
        || Math.abs(e.clientY - drag.startY) > TAP_SLOP;
      if (!far) return;
      drag.moved = true;
    }

    const { px, py } = at(e);
    if (drag.kind === 'resize') {
      resizeFrom(drag.corner, px, py);
    } else {
      crop.x = Math.min(Math.max(drag.from.x + (px - drag.px), 0), 1 - crop.w);
      crop.y = Math.min(Math.max(drag.from.y + (py - drag.py), 0), 1 - crop.h);
      confineFocus();
      paint();
    }
  };

  const onUp = (e) => {
    if (!drag) return;
    // A tap — the pointer never travelled — means "focus here" rather than a crop edit.
    // Handles are excluded: a tap on one is a mis-hit, not a request to move the focus.
    if (!drag.moved && drag.kind !== 'resize') {
      const { px, py } = at(e);
      fpx = px;
      fpy = py;
      confineFocus(); // a tap outside the crop lands on its nearest edge
      paint();
    }
    drag = null;
    if (pane.hasPointerCapture?.(e.pointerId)) pane.releasePointerCapture(e.pointerId);
  };

  pane.addEventListener('pointerdown', onDown);
  pane.addEventListener('pointermove', onMove);
  pane.addEventListener('pointerup', onUp);
  pane.addEventListener('pointercancel', onUp);

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
        confineFocus();
        paint();
      }
    });
    return b;
  }));
  presetBar.firstElementChild.classList.add('is-on');

  // ── Rotating ─────────────────────────────────────────────────────
  /**
   * Turn the photo a quarter, and carry the crop and the focal point round with it.
   *
   * Both are expressed against the upright photo, so leaving them alone would slide the
   * crop somewhere else the moment the photo turned. Rotating them by the same quarter
   * keeps the rectangle over the same part of the picture, which is the only behaviour
   * that can be defended: the parent framed a subject, not a set of coordinates.
   */
  function turn(by) {
    const turned = turnFraming(crop, { x: fpx, y: fpy }, by);
    crop = turned.crop;
    fpx = turned.focal.x;
    fpy = turned.focal.y;
    rotation = (rotation + by + 360) % 360;
    paint();
  }

  const onRotate = (e) => turn(Number(e.currentTarget.dataset.turn));
  rotateBtns.forEach((b) => b.addEventListener('click', onRotate));

  // ── Trimming ─────────────────────────────────────────────────────
  /** Shortest a clip may be — below this it reads as a stutter rather than a moment. */
  const MIN_CLIP = 0.5;

  let dragTrim = null;

  function trimAt(e) {
    const box = trimBar.getBoundingClientRect();
    return clamp01((e.clientX - box.left) / box.width) * duration;
  }

  function onTrimDown(e) {
    const handle = e.target.closest('[data-trim]');
    if (!handle) return;
    dragTrim = handle.dataset.trim;
    trimBar.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onTrimMove(e) {
    if (!dragTrim) return;
    const t = trimAt(e);
    if (dragTrim === 'start') {
      trimStart = Math.min(t, trimEnd - MIN_CLIP);
      // A minute is the most that can play, so pushing the start along drags the end.
      if (trimEnd - trimStart > MAX_CLIP_SECONDS) trimEnd = trimStart + MAX_CLIP_SECONDS;
    } else {
      trimEnd = Math.max(t, trimStart + MIN_CLIP);
      if (trimEnd - trimStart > MAX_CLIP_SECONDS) trimStart = trimEnd - MAX_CLIP_SECONDS;
    }
    trimStart = Math.max(0, trimStart);
    trimEnd = Math.min(duration, trimEnd);
    paint();
    // Show the frame being chosen — a trim handle you cannot see is a guess.
    if (cropImg.tagName === 'VIDEO') {
      cropImg.currentTime = dragTrim === 'start' ? trimStart : trimEnd;
    }
  }

  const onTrimUp = () => { dragTrim = null; };

  trimPane.hidden = !isClip;
  if (isClip) {
    trimBar.addEventListener('pointerdown', onTrimDown);
    trimBar.addEventListener('pointermove', onTrimMove);
    trimBar.addEventListener('pointerup', onTrimUp);
    trimBar.addEventListener('pointercancel', onTrimUp);
  }

  // ── Open ─────────────────────────────────────────────────────────
  // A clip is framed on its own frames rather than on a poster: dragging a trim handle
  // has to show what is being chosen.
  if (isClip) {
    const video = document.createElement('video');
    video.className = 'editor-crop-img rotor-media';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = photo.videoUrl;
    video.addEventListener('loadedmetadata', () => { video.currentTime = trimStart; });
    cropImg.replaceWith(video);
    cropImg = video;
  } else {
    cropImg.src = photo.url;
  }
  paint();

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
      pane.removeEventListener('pointerdown', onDown);
      pane.removeEventListener('pointermove', onMove);
      pane.removeEventListener('pointerup', onUp);
      pane.removeEventListener('pointercancel', onUp);
      mainBtn.removeEventListener('click', onMain);
      rotateBtns.forEach((b) => b.removeEventListener('click', onRotate));
      trimBar.removeEventListener('pointerdown', onTrimDown);
      trimBar.removeEventListener('pointermove', onTrimMove);
      trimBar.removeEventListener('pointerup', onTrimUp);
      trimBar.removeEventListener('pointercancel', onTrimUp);
      sheet.removeEventListener('close', finish);

      // The surface is shared between opens, so a clip's <video> has to give the <img>
      // back — otherwise the next photo would be handed a video element to display.
      cropImg.removeAttribute('src');
      if (cropImg.tagName === 'VIDEO') {
        cropImg.pause();
        const img = document.createElement('img');
        img.className = 'editor-crop-img rotor-media';
        img.alt = '';
        cropImg.replaceWith(img);
        cropImg = img;
      }

      const whole = crop.w >= 0.999 && crop.h >= 0.999;
      resolve(saved ? {
        // Back to crop space, which is what the renderer positions against.
        focalX: round(clamp01((fpx - crop.x) / crop.w)),
        focalY: round(clamp01((fpy - crop.y) / crop.h)),
        // A crop covering the whole photo is no crop at all — store nothing.
        crop: whole ? null : {
          x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h),
        },
        rotation,
        // Only a clip carries a trim; null leaves a still's fields untouched.
        trimStart: isClip ? round(trimStart) : null,
        trimEnd: isClip ? round(trimEnd) : null,
        makeMain,
      } : null);
    };

    doneBtn.addEventListener('click', () => { saved = true; sheet.close(); }, { once: true });
    sheet.addEventListener('close', finish); // covers ESC and the backdrop too
  });
}
