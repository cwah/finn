// Reframe one photo, or promote it to lead the post.
//
// Smart-crop already guessed a focal point at capture; this is the correction when it
// guessed wrong. Nothing here crops the file — it only moves the point a cover crop
// centres on, so the original is always kept whole.
//
// The preview deliberately shows a SQUARE crop, because that is the shape that actually
// crops: grid cells. Getting it right there is what matters.

const clamp = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {{url: string, focalX: number, focalY: number}} photo
 * @param {{isMain: boolean}} opts
 * @returns {Promise<{focalX: number, focalY: number, makeMain: boolean}|null>}
 *          null when dismissed without saving
 */
export function openPhotoEditor(photo, { isMain }) {
  const sheet = document.getElementById('photoEditor');
  const stage = sheet.querySelector('.editor-stage');
  const img = sheet.querySelector('.editor-img');
  const dot = sheet.querySelector('.editor-dot');
  const mainBtn = sheet.querySelector('.editor-main');
  const doneBtn = sheet.querySelector('.editor-done');

  let x = photo.focalX ?? 0.5;
  let y = photo.focalY ?? 0.5;
  let makeMain = false;

  function paint() {
    img.style.objectPosition = `${x * 100}% ${y * 100}%`;
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
  }

  function moveTo(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    x = clamp((clientX - r.left) / r.width);
    y = clamp((clientY - r.top) / r.height);
    paint();
  }

  img.src = photo.url;
  paint();

  // Already the lead photo? Then there is nothing to promote.
  mainBtn.hidden = isMain;
  mainBtn.classList.remove('is-chosen');
  mainBtn.textContent = 'Make main photo';

  let dragging = false;

  const onDown = (e) => {
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    moveTo(e.clientX, e.clientY);
    e.preventDefault();
  };
  const onMove = (e) => { if (dragging) moveTo(e.clientX, e.clientY); };
  const onUp = (e) => {
    dragging = false;
    if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  const onMain = () => {
    makeMain = true;
    mainBtn.classList.add('is-chosen');
    mainBtn.textContent = 'Will lead this post';
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  mainBtn.addEventListener('click', onMain);

  sheet.showModal();

  return new Promise((resolve) => {
    let saved = false;
    const finish = () => {
      // Whatever happens, leave no listeners behind — this sheet is reused per photo.
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      mainBtn.removeEventListener('click', onMain);
      sheet.removeEventListener('close', finish);
      img.removeAttribute('src');
      resolve(saved ? { focalX: round(x), focalY: round(y), makeMain } : null);
    };

    doneBtn.addEventListener('click', () => { saved = true; sheet.close(); }, { once: true });
    // Covers ESC and the backdrop as well as Done.
    sheet.addEventListener('close', finish);
  });
}

function round(v) {
  return Math.round(v * 100) / 100;
}
