// Tap a photo to see the whole thing.
//
// Cards crop to keep the timeline calm, which means the version on screen is never the
// whole picture. The lightbox shows the original at its true aspect ratio — `contain`,
// never `cover`, so nothing is cut off.
//
// Delegated from the timeline rather than bound per image: posts stream in as you
// scroll, and one listener on the container beats re-binding on every page.

// The module owns its markup. Keeping it out of index.html means the preview bench gets
// the lightbox for free, and there is no second copy to drift out of step.
const TEMPLATE = `
  <div class="lightbox-stage">
    <img class="lightbox-img" alt="" decoding="async" />
  </div>
  <button type="button" class="lightbox-prev" aria-label="Previous photo">&#8249;</button>
  <button type="button" class="lightbox-next" aria-label="Next photo">&#8250;</button>
  <button type="button" class="lightbox-close" aria-label="Close">&times;</button>
  <p class="lightbox-count" aria-hidden="true"></p>
`;

function ensureBox() {
  let box = document.getElementById('lightbox');
  if (box) return box;
  box = document.createElement('dialog');
  box.id = 'lightbox';
  box.className = 'lightbox';
  box.setAttribute('aria-label', 'Photo');
  box.innerHTML = TEMPLATE;
  document.body.append(box);
  return box;
}

let group = [];  // the photos of the post that was opened
let index = 0;

/** Back to fit-the-screen. Called on open, on paging, and on zooming out. */
function resetZoom(box) {
  const stage = box.querySelector('.lightbox-stage');
  stage.classList.remove('is-zoomed');
  stage.scrollTo(0, 0);
}

/**
 * Zoom only earns its cursor when the photo is actually being shown smaller than it is.
 * A snapshot that already fits at 1:1 has nothing to zoom to.
 */
function syncZoomAffordance(box) {
  const img = box.querySelector('.lightbox-img');
  const shown = img.getBoundingClientRect();
  const downscaled = img.naturalWidth > Math.ceil(shown.width) + 1;
  img.classList.toggle('can-zoom', downscaled);
}

function render() {
  const box = document.getElementById('lightbox');
  const photo = group[index];
  if (!photo) return;

  const img = box.querySelector('.lightbox-img');
  resetZoom(box);
  img.classList.remove('can-zoom');
  img.src = photo.url;
  img.width = photo.width;
  img.height = photo.height;
  img.alt = photo.alt;

  // Paging controls earn their space only when there is somewhere to page to.
  const many = group.length > 1;
  box.querySelector('.lightbox-prev').hidden = !many;
  box.querySelector('.lightbox-next').hidden = !many;
  const count = box.querySelector('.lightbox-count');
  count.hidden = !many;
  count.textContent = `${index + 1} / ${group.length}`;
}

function step(by) {
  if (group.length < 2) return;
  index = (index + by + group.length) % group.length; // wrap both ways
  render();
}

/** Collect every viewable photo belonging to the same post, in document order. */
function collect(img) {
  const scope = img.closest('.card') || document;
  return [...scope.querySelectorAll(`[data-full][data-group="${CSS.escape(img.dataset.group)}"]`)]
    .map((n) => ({
      url: n.dataset.full,
      width: Number(n.dataset.fullW),
      height: Number(n.dataset.fullH),
      alt: n.alt || '',
    }));
}

/**
 * Wire the lightbox.
 * @param {HTMLElement} timeline container the photos live in
 */
export function initLightbox(timeline) {
  const box = ensureBox();

  timeline.addEventListener('click', (e) => {
    const img = e.target.closest('.card-photo[data-full]');
    if (!img) return;
    group = collect(img);
    index = Math.max(0, group.findIndex((p) => p.url === img.dataset.full));
    render();
    box.showModal();
  });

  box.querySelector('.lightbox-prev').addEventListener('click', () => step(-1));
  box.querySelector('.lightbox-next').addEventListener('click', () => step(1));
  box.querySelector('.lightbox-close').addEventListener('click', () => box.close());

  const stage = box.querySelector('.lightbox-stage');
  const img = box.querySelector('.lightbox-img');

  // Once it loads we know its natural size, so we know whether zoom is worth offering.
  img.addEventListener('load', () => syncZoomAffordance(box));
  window.addEventListener('resize', () => { if (box.open) syncZoomAffordance(box); }, { passive: true });

  // Tap the photo to swap between fit-to-screen and true size.
  img.addEventListener('click', (e) => {
    e.stopPropagation(); // a tap on the photo must not reach the close-on-backdrop handler
    const zoomed = stage.classList.contains('is-zoomed');
    if (zoomed) {
      resetZoom(box);
      return;
    }
    if (!img.classList.contains('can-zoom')) return;

    // Zoom toward the point that was tapped, so the detail you aimed at stays put
    // instead of the view jumping to the middle of the photo.
    const before = img.getBoundingClientRect();
    const fx = (e.clientX - before.left) / before.width;
    const fy = (e.clientY - before.top) / before.height;
    stage.classList.add('is-zoomed');
    stage.scrollTo({
      left: fx * img.naturalWidth - stage.clientWidth / 2,
      top: fy * img.naturalHeight - stage.clientHeight / 2,
    });
  });

  // Clicking the backdrop — anywhere that is not the image or a control — closes it.
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.classList.contains('lightbox-stage')) box.close();
  });

  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    // ESC is handled natively by <dialog>.
  });

  // Swipe between photos on a touch screen — but not while zoomed, where a horizontal
  // drag is panning the photo rather than asking for the next one.
  let startX = null;
  box.addEventListener('pointerdown', (e) => {
    startX = stage.classList.contains('is-zoomed') ? null : e.clientX;
  });
  box.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
  });

  // Drop the big image on close so it is not held in memory behind the scenes.
  box.addEventListener('close', () => {
    resetZoom(box);
    box.querySelector('.lightbox-img').removeAttribute('src');
    group = [];
  });
}
