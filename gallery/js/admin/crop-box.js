// Choosing the crop, by dragging it.
//
// Not pure — it is a pointer interaction. Every rule it enforces lives in js/bake.js
// (`usableCrop` for the limits, `cropIsCovered` for the corners), so this file only
// converts pointers into fractions and asks that file whether the result is legal.
//
// One surface, two gestures, no mode switch — the same arrangement as the scrapbook's
// photo editor, which had to solve this once already:
//
//   drag a corner   — resize
//   drag elsewhere  — move the whole box
//
// Adapted rather than imported. The two apps share an origin and a database and no code,
// and a crop box is small enough that a copy is cheaper than a dependency between them.

import { usableCrop, cropIsCovered, MIN_CROP } from '../bake.js';

const CORNERS = ['nw', 'ne', 'sw', 'se'];

/**
 * @param {HTMLElement} root the overlay, sized and positioned exactly over the preview
 * @param {{onChange: (crop: object, covered: boolean) => void}} options
 */
export function initCropBox(root, { onChange }) {
  let crop = { x: 0, y: 0, w: 1, h: 1 };
  let source = { width: 1, height: 1, angle: 0 };

  const box = document.createElement('div');
  box.className = 'crop-box';
  const handles = CORNERS.map((corner) => {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `crop-handle crop-handle--${corner}`;
    handle.dataset.corner = corner;
    // Reachable without a pointer. The arrow keys nudge the corner they belong to.
    handle.setAttribute('aria-label', `Crop ${corner.toUpperCase()} corner`);
    box.append(handle);
    return handle;
  });
  root.replaceChildren(box);

  /** Push the box's fractions into CSS, and tell the page what changed. */
  function apply({ notify = true } = {}) {
    crop = usableCrop(crop);
    box.style.left = `${crop.x * 100}%`;
    box.style.top = `${crop.y * 100}%`;
    box.style.width = `${crop.w * 100}%`;
    box.style.height = `${crop.h * 100}%`;

    const covered = cropIsCovered(crop, source.width, source.height, source.angle);
    box.dataset.covered = String(covered);
    if (notify) onChange?.(crop, covered);
  }

  let drag = null;

  function fractionsFrom(event) {
    const rect = root.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / (rect.width || 1),
      y: (event.clientY - rect.top) / (rect.height || 1),
    };
  }

  function onDown(event) {
    // Ignore secondary buttons: a right-click should open a menu, not move the crop.
    if (event.button !== 0) return;
    const corner = event.target instanceof HTMLElement ? event.target.dataset.corner : null;
    drag = { corner: corner ?? null, from: fractionsFrom(event), start: { ...crop } };
    event.target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onMove(event) {
    if (!drag) return;
    const at = fractionsFrom(event);
    const dx = at.x - drag.from.x;
    const dy = at.y - drag.from.y;

    if (!drag.corner) {
      // Move. Clamped by usableCrop, so the box stops at the edge instead of leaving it.
      crop = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
    } else {
      // Resize. Each corner moves its own two edges; the opposite two stay put, which is
      // what makes the gesture feel like dragging that corner rather than the whole box.
      const s = drag.start;
      let { x, y, w, h } = s;
      if (drag.corner.includes('w')) {
        x = Math.min(s.x + dx, s.x + s.w - MIN_CROP);
        w = s.w - (x - s.x);
      } else {
        w = Math.max(s.w + dx, MIN_CROP);
      }
      if (drag.corner.includes('n')) {
        y = Math.min(s.y + dy, s.y + s.h - MIN_CROP);
        h = s.h - (y - s.y);
      } else {
        h = Math.max(s.h + dy, MIN_CROP);
      }
      crop = { x, y, w, h };
    }
    apply();
  }

  function onUp() { drag = null; }

  box.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  // Keyboard nudging, so the crop is not pointer-only.
  for (const handle of handles) {
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.05 : 0.01;
      const corner = handle.dataset.corner;
      const moves = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
        ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const [dx, dy] = move;
      const s = { ...crop };
      let { x, y, w, h } = s;
      if (corner.includes('w')) { x = Math.min(s.x + dx, s.x + s.w - MIN_CROP); w = s.w - (x - s.x); }
      else { w = Math.max(s.w + dx, MIN_CROP); }
      if (corner.includes('n')) { y = Math.min(s.y + dy, s.y + s.h - MIN_CROP); h = s.h - (y - s.y); }
      else { h = Math.max(s.h + dy, MIN_CROP); }
      crop = { x, y, w, h };
      apply();
    });
  }

  return {
    /** Point the box at a new image, or a new angle on the same one. */
    setSource(next) { source = { ...source, ...next }; apply({ notify: false }); },
    setCrop(next) { crop = usableCrop(next); apply(); },
    getCrop() { return { ...crop }; },
    isCovered() { return cropIsCovered(crop, source.width, source.height, source.angle); },
  };
}
