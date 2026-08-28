// Tap a photo to see the whole thing.
//
// "The whole thing" means the picture that was FRAMED, not the file it came from: the
// crop rectangle is applied here exactly as it is on a card, so opening a photo never
// reveals parts a parent deliberately cropped away. Zooming likewise zooms the crop, to
// its own natural pixels — the crop's pixels, not the original's.
//
// Sizes are computed in JS rather than left to CSS. `max-width`/`max-height` cannot fit
// a box whose contents are positioned by crop maths, and the numbers needed — the crop's
// pixel size and the space available — are both known here. It runs on open, on paging,
// on zoom and on resize, never per frame.
//
// Delegated from the timeline rather than bound per image: posts stream in as you
// scroll, and one listener on the container beats re-binding on every page.

// The trim is enforced by the same helper the cards use, so a trimmed clip means the
// same thing whether it is played in place or expanded.
import { holdToTrim } from './motion-play.js';

// The module owns its markup. Keeping it out of index.html means the preview bench gets
// the lightbox for free, and there is no second copy to drift out of step.
const TEMPLATE = `
  <div class="lightbox-stage">
    <div class="lightbox-crop">
      <div class="rotor"></div>
    </div>
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

/** Space inside the stage, once its padding is taken off. */
function available(stage) {
  const cs = getComputedStyle(stage);
  return {
    w: stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

/**
 * Size the crop box: fitted to the screen, or at the crop's own natural pixels when
 * zoomed. Never scaled UP to fit — a photo smaller than the screen is shown as it is.
 */
function layout(box) {
  const photo = group[index];
  if (!photo) return;

  const stage = box.querySelector('.lightbox-stage');
  const frame = box.querySelector('.lightbox-crop');
  const cropW = photo.width * photo.crop.w;
  const cropH = photo.height * photo.crop.h;
  const room = available(stage);

  const fit = Math.min(1, room.w / cropW, room.h / cropH);
  const scale = stage.classList.contains('is-zoomed') ? 1 : fit;

  frame.style.width = `${cropW * scale}px`;
  frame.style.height = `${cropH * scale}px`;

  // Zoom is only worth offering when the crop is actually being shown smaller than it is,
  // and never for a video, whose taps belong to its own controls.
  const zoomable = fit < 1 && !photo.video && !stage.classList.contains('is-zoomed');
  frame.classList.toggle('can-zoom', zoomable);
}

function resetZoom(box) {
  const stage = box.querySelector('.lightbox-stage');
  stage.classList.remove('is-zoomed');
  stage.scrollTo(0, 0);
}

/**
 * Build the media for the photo on show, into the rotor that turns it.
 *
 * Rebuilt per photo rather than reused, because a still is an <img> and a video is a
 * <video> — and because leaving the previous element in place would keep a video
 * decoding after it had been paged away from.
 */
function fillRotor(rotor, photo) {
  const quarter = photo.rotation % 180 !== 0;
  // Stop whatever was playing before its element is dropped, so nothing decodes on
  // after it has been paged away from.
  rotor.querySelector('video')?.pause();
  rotor.replaceChildren();
  rotor.classList.toggle('is-quarter', quarter);
  rotor.style.setProperty('--rot', photo.rotation);

  // NO SWAP HERE. `collect` reads data-full-w/h, which render.js already wrote as
  // orientedSize — the shape the picture PRESENTS, not the shape the file measures. This
  // turned them a second time, so a 4000x3000 photo stored at rotation 90 gave the rotor a
  // landscape aspect ratio while the crop frame around it was correctly portrait, and the
  // picture was squashed to fit. The card looked right throughout, because it builds the
  // same rotor from orientedSize without swapping — see rotor() in render.js, which this
  // must agree with.
  //
  // `quarter` still matters: it is what tells the CSS to lay the media across the rotor's
  // other axis before turning it. Only the dimensions were already handled.
  rotor.style.setProperty('--oar', photo.width / photo.height);
  rotor.style.aspectRatio = `${photo.width} / ${photo.height}`;

  if (!photo.video) {
    const img = document.createElement('img');
    img.className = 'lightbox-img rotor-media';
    img.decoding = 'async';
    img.src = photo.url;
    img.alt = photo.alt;
    // The same filter the card used. Expanding a photo must not develop it differently.
    if (photo.light) img.style.filter = photo.light;
    rotor.append(img);
    return null;
  }

  // Expanding a video plays it: the lightbox is the player, which is why the card is not.
  const video = document.createElement('video');
  video.className = 'lightbox-img rotor-media';
  video.controls = true;
  video.playsInline = true;
  video.autoplay = true;
  video.poster = photo.url;
  video.src = `${photo.video}#t=${photo.trim.start.toFixed(2)},${photo.trim.end.toFixed(2)}`;
  if (photo.light) video.style.filter = photo.light;
  rotor.append(video);
  return video;
}

function render() {
  const box = document.getElementById('lightbox');
  const photo = group[index];
  if (!photo) return;

  const frame = box.querySelector('.lightbox-crop');
  const rotor = box.querySelector('.rotor');

  resetZoom(box);

  // Same crop maths the cards use: oversize the image and offset it until the chosen
  // region fills the frame.
  frame.style.setProperty('--cx', photo.crop.x);
  frame.style.setProperty('--cy', photo.crop.y);
  frame.style.setProperty('--cw', photo.crop.w);
  frame.style.setProperty('--ch', photo.crop.h);

  const video = fillRotor(rotor, photo);
  if (video) holdToTrim(video, photo.trim);
  layout(box);

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
    .map((n) => {
      const [x, y, w, h] = (n.dataset.crop || '0 0 1 1').split(' ').map(Number);
      const [start, end] = (n.dataset.trim || '0 0').split(' ').map(Number);
      return {
        url: n.dataset.full,
        // The size the picture PRESENTS: already turned, so the fit maths needs no
        // special case for a rotated photo.
        width: Number(n.dataset.fullW),
        height: Number(n.dataset.fullH),
        crop: { x, y, w, h },
        rotation: Number(n.dataset.rotation) || 0,
        light: n.dataset.light || '',
        video: n.dataset.video || null,
        trim: { start, end },
        alt: n.alt || '',
      };
    });
}

/**
 * Wire the lightbox.
 * @param {HTMLElement} timeline container the photos live in
 */
export function initLightbox(timeline) {
  const box = ensureBox();
  const stage = box.querySelector('.lightbox-stage');
  const frame = box.querySelector('.lightbox-crop');

  timeline.addEventListener('click', (e) => {
    const clicked = e.target.closest('.card-photo[data-full]');
    if (!clicked) return;
    group = collect(clicked);
    index = Math.max(0, group.findIndex((p) => p.url === clicked.dataset.full));
    render();
    box.showModal();
    layout(box); // the stage has real dimensions only once the dialog is open
  });

  box.querySelector('.lightbox-prev').addEventListener('click', () => step(-1));
  box.querySelector('.lightbox-next').addEventListener('click', () => step(1));
  box.querySelector('.lightbox-close').addEventListener('click', () => box.close());

  // The media is rebuilt per photo, so the listener goes on the container. `load` does
  // not bubble, hence the capture phase; a video reports `loadedmetadata` instead, which
  // is the moment its real dimensions are known.
  frame.addEventListener('load', () => layout(box), true);
  frame.addEventListener('loadedmetadata', () => layout(box), true);
  window.addEventListener('resize', () => { if (box.open) layout(box); }, { passive: true });

  // Closing must stop playback — a dialog that is not on screen is not a player.
  box.addEventListener('close', () => frame.querySelector('video')?.pause());

  // Tap the photo to swap between fit-to-screen and the crop's true size.
  frame.addEventListener('click', (e) => {
    e.stopPropagation(); // a tap on the photo must not reach the close-on-backdrop handler
    // A video owns its own taps: play, pause, scrub. Zooming out from under the controls
    // would make them unusable, so a video is shown fitted and stays that way.
    if (frame.querySelector('video')) return;
    if (stage.classList.contains('is-zoomed')) {
      resetZoom(box);
      layout(box);
      return;
    }
    if (!frame.classList.contains('can-zoom')) return;

    // Zoom toward the point that was tapped, so the detail you aimed at stays put
    // instead of the view jumping to the middle of the photo.
    const before = frame.getBoundingClientRect();
    const fx = (e.clientX - before.left) / before.width;
    const fy = (e.clientY - before.top) / before.height;
    stage.classList.add('is-zoomed');
    layout(box);
    stage.scrollTo({
      left: fx * frame.offsetWidth - stage.clientWidth / 2,
      top: fy * frame.offsetHeight - stage.clientHeight / 2,
    });
  });

  // Clicking the backdrop — anywhere that is not the photo or a control — closes it.
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target === stage) box.close();
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
    img.removeAttribute('src');
    group = [];
  });
}
