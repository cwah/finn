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
// THREE PANES, not one. A swipe that follows the finger has to have something to follow
// it WITH: the photo either side must already be on screen, just beyond the edge, or the
// gesture is an animation played after the fact rather than the picture moving under your
// thumb. The track slides; the panes stay put within it.
const TEMPLATE = `
  <div class="lightbox-stage" tabindex="-1">
    <div class="lightbox-track">
      <div class="lightbox-pane" data-pane="-1" aria-hidden="true">
        <div class="lightbox-crop"><div class="rotor"></div></div>
      </div>
      <div class="lightbox-pane" data-pane="0">
        <div class="lightbox-crop">
          <div class="rotor"></div>
          <!-- On the picture, in its lower-right corner — the same place the card puts it,
               so the gesture does not move when a memory is expanded. A sibling of the
               rotor rather than a child: the rotor is what turns, and a control inside it
               would end up down the side of a photograph someone had rotated. -->
          <button type="button" class="lightbox-motion video-badge video-badge--motion is-playing"
                  hidden aria-label="Pause this motion photo"></button>
        </div>
      </div>
      <div class="lightbox-pane" data-pane="1" aria-hidden="true">
        <div class="lightbox-crop"><div class="rotor"></div></div>
      </div>
    </div>
  </div>
  <button type="button" class="lightbox-prev" aria-label="Previous photo">&#8249;</button>
  <button type="button" class="lightbox-next" aria-label="Next photo">&#8250;</button>
  <button type="button" class="lightbox-close" aria-label="Close">&times;</button>
  <nav class="lightbox-dots" aria-label="Photos"></nav>
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
// A swipe settles before it commits, so the new photo appears once the movement has
// finished. That wait is cancellable, and MUST be: a tap on an arrow or a dot while one is
// pending would otherwise have the old commit land on top of it a moment later.
let commitTimer = null;

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
  const stage = box.querySelector('.lightbox-stage');
  const room = available(stage);
  for (const pane of box.querySelectorAll('.lightbox-pane')) {
    layoutPane(stage, room, pane);
  }
}

/**
 * Size one pane's crop box to the photo in it.
 *
 * Per pane rather than for the current photo alone: the neighbours are on screen the
 * moment a swipe starts, and one sized to the wrong picture would stretch as it arrived.
 */
function layoutPane(stage, room, pane) {
  const frame = pane.querySelector('.lightbox-crop');
  const photo = group[Number(pane.dataset.pane) + index];
  if (!photo) {
    frame.style.width = '0px';
    frame.style.height = '0px';
    return;
  }

  const cropW = photo.width * photo.crop.w;
  const cropH = photo.height * photo.crop.h;
  const fit = Math.min(1, room.w / cropW, room.h / cropH);
  // Only the photo being LOOKED AT can be zoomed, so only it is ever shown at its own
  // pixels; a neighbour is always fitted.
  const current = pane.dataset.pane === '0';
  const scale = current && stage.classList.contains('is-zoomed') ? 1 : fit;

  frame.style.width = `${cropW * scale}px`;
  frame.style.height = `${cropH * scale}px`;

  // Zoom is only worth offering when the crop is actually being shown smaller than it is,
  // and never for a video, whose taps belong to its own controls.
  const zoomable = current && fit < 1 && !photo.video
    && !stage.classList.contains('is-zoomed');
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
function fillRotor(rotor, photo, active = true) {
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
  // A MOTION PHOTO GETS NO CONTROL BAR. It is a still that moves for a moment — there is
  // no length to scrub and nothing to seek, so a transport bar is furniture over a
  // photograph. It also sits INSIDE the rotor, so on a picture turned a quarter the bar
  // ends up down the side, which is how this was noticed.
  video.controls = !photo.motion;
  video.loop = photo.motion;
  video.muted = photo.motion;    // a loop with sound is not a photograph
  video.playsInline = true;
  // A neighbour is on screen but not being watched: it shows its poster and stays quiet,
  // or three decoders run for one photograph.
  video.autoplay = active;
  video.poster = photo.url;
  video.src = `${photo.video}#t=${photo.trim.start.toFixed(2)},${photo.trim.end.toFixed(2)}`;
  if (photo.light) video.style.filter = photo.light;
  rotor.append(video);
  return video;
}

/** Fill one pane with whichever photo sits at that offset, or empty it. */
function renderPane(box, offset) {
  const pane = box.querySelector(`.lightbox-pane[data-pane="${offset}"]`);
  const frame = pane.querySelector('.lightbox-crop');
  const rotor = pane.querySelector('.rotor');
  const photo = group[index + offset];

  // An end pane is EMPTIED, never removed from the layout. Taking it out of flow shifts
  // every pane after it, so the middle one stopped being in the middle — and since the
  // track is positioned by whole pane-widths, the viewer then showed the PREVIOUS photo
  // and appeared to skip one. It stays, holding nothing.
  if (!photo) {
    rotor.querySelector('video')?.pause();
    rotor.replaceChildren();
    return null;
  }

  // Same crop maths the cards use: oversize the image and offset it until the chosen
  // region fills the frame.
  frame.style.setProperty('--cx', photo.crop.x);
  frame.style.setProperty('--cy', photo.crop.y);
  frame.style.setProperty('--cw', photo.crop.w);
  frame.style.setProperty('--ch', photo.crop.h);

  const video = fillRotor(rotor, photo, offset === 0);
  // A motion photo loops inside its trim; a clip plays its stretch once and stops.
  // `video.loop` still covers an UNTRIMMED motion photo, where there is no sub-range and
  // the native mechanism is the right one.
  if (video && offset === 0) holdToTrim(video, photo.trim, null, { loop: photo.motion });
  return video;
}

/** Dots under the picture, or a count when there are too many to dot. */
function paintDots(box) {
  const dots = box.querySelector('.lightbox-dots');
  const count = box.querySelector('.lightbox-count');
  const many = group.length > 1;
  // Past a dozen the dots stop saying anything a number does not say better, and start
  // being a row of specks too small to aim at.
  const dotted = many && group.length <= 12;

  dots.hidden = !dotted;
  count.hidden = !many || dotted;
  count.textContent = `${index + 1} / ${group.length}`;

  if (!dotted) { dots.replaceChildren(); return; }
  dots.replaceChildren(...group.map((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'lightbox-dot';
    dot.classList.toggle('is-on', i === index);
    dot.setAttribute('aria-label', `Photo ${i + 1} of ${group.length}`);
    if (i === index) dot.setAttribute('aria-current', 'true');
    dot.addEventListener('click', () => { index = i; render(); });
    return dot;
  }));
}

function render() {
  const box = document.getElementById('lightbox');
  if (!group[index]) return;

  // Whatever brought us here — a swipe, an arrow, a dot — is now the truth, and any
  // settle still waiting to commit is stale.
  window.clearTimeout(commitTimer);

  resetZoom(box);
  settleTrack(box, 0);            // back to centre, with no animation

  renderPane(box, -1);
  const video = renderPane(box, 0);
  renderPane(box, 1);
  layout(box);

  // A motion photo gets the same small badge it has on the card, and nothing else: it is a
  // still that moves, so the only thing worth offering is a way to stop it.
  const photo = group[index];
  const motionBtn = box.querySelector('.lightbox-motion');
  motionBtn.hidden = !(video && photo.motion);
  if (!motionBtn.hidden) {
    const playing = () => !video.paused;
    const paint = () => {
      motionBtn.classList.toggle('is-playing', playing());
      motionBtn.setAttribute('aria-label',
        playing() ? 'Pause this motion photo' : 'Play this motion photo');
    };
    paint();
    // Replaced rather than added to: render() runs again for every photo paged to, and a
    // listener left behind would pause a clip the viewer has already moved past.
    motionBtn.onclick = () => {
      if (playing()) video.pause(); else video.play().catch(() => {});
      paint();
    };
    video.onplay = paint;
    video.onpause = paint;
  } else {
    motionBtn.onclick = null;
  }

  // Paging controls earn their space only when there is somewhere to page to.
  const many = group.length > 1;
  box.querySelector('.lightbox-prev').hidden = !many;
  box.querySelector('.lightbox-next').hidden = !many;
  paintDots(box);
}

/**
 * Put the track at an offset, in pane-widths.
 *
 * `0` is the photo being looked at. Dragging moves it a fraction either way; letting go
 * settles it to a whole number, and `commit` is what turns that into a new index.
 */
function settleTrack(box, panes, { animate = false } = {}) {
  const track = box.querySelector('.lightbox-track');
  track.classList.toggle('is-settling', animate);
  track.style.setProperty('--slide', String(panes));
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
        motion: n.dataset.motion === 'true',
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
    // showModal hands focus to the first focusable thing it finds, which was the previous
    // arrow — so every expanded photo opened with a ring drawn around it, looking selected
    // for no reason. The stage takes it instead: focus has to land somewhere for the arrow
    // keys and Escape to work, and a container shows nothing.
    stage.focus({ preventScroll: true });
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

  // THE PICTURE FOLLOWS THE FINGER. Not a threshold and an animation afterwards: the
  // track moves as you move, the next photo comes in from the edge, and letting go either
  // completes the movement or returns it. The difference is whether the gesture feels like
  // moving a photograph or like operating a control that plays a transition at you.
  //
  // Not while zoomed, where a horizontal drag is panning the photo instead.
  //
  // The stage scrolls, so the browser claims sideways drags unless told otherwise — see
  // `touch-action` on .lightbox-crop. Without it the gesture ends in `pointercancel` and
  // never reaches pointerup, which is why this did nothing on a phone for a long time.
  let drag = null;

  const paneWidth = () => stage.clientWidth || 1;

  const endDrag = (dx) => {
    const width = paneWidth();
    const moved = dx / width;
    // A third of the way, or a flick — a short fast movement is as clear an instruction as
    // a long slow one, and demanding distance from both makes a phone feel stiff.
    //
    // A flick still has to be a real movement. At 12px it was not: anything quick enough
    // counted, so a thumb that slipped a few pixels changed the photograph. 40 is past
    // what a tap wanders by and well short of what a deliberate drag covers.
    const elapsed = Math.max(1, performance.now() - drag.at);
    const flick = Math.abs(dx) > 40 && Math.abs(dx) / elapsed > 0.4;
    const far = Math.abs(moved) > 0.33;
    const dir = dx < 0 ? 1 : -1;
    const canGo = Boolean(group[index + dir]);

    drag = null;
    if ((far || flick) && canGo) {
      // Carry the movement through, then swap in the new photo once it has arrived. The
      // pane it lands on is already showing it, so the change is invisible.
      //
      // The destination is worked out NOW and set absolutely. `index += dir` inside the
      // wait was a second, later edit to whatever index happened to be by then — so two
      // quick swipes, or a swipe followed by an arrow, applied both and skipped a photo.
      const target = index + dir;
      settleTrack(box, -dir, { animate: true });
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(() => { index = target; render(); }, 180);
    } else {
      settleTrack(box, 0, { animate: true });   // back where it was
    }
  };

  box.addEventListener('pointerdown', (e) => {
    if (stage.classList.contains('is-zoomed')) return;
    if (e.target.closest('button, video')) return;   // controls own their own taps
    drag = { x: e.clientX, y: e.clientY, at: performance.now(), moving: false };
  });

  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    // Wait until the direction is obvious. Deciding on the first pixel would steal
    // vertical scrolls and make every tap a tiny slide.
    if (!drag.moving) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; }   // that is a scroll
      drag.moving = true;
    }
    // Resisted at the ends: it still moves, so the gesture is answered, but it is
    // obviously not going anywhere.
    const wanted = dx / paneWidth();
    const blocked = (wanted > 0 && !group[index - 1]) || (wanted < 0 && !group[index + 1]);
    settleTrack(box, blocked ? wanted * 0.25 : wanted);
  });

  const release = (e) => {
    if (!drag) return;
    if (!drag.moving) { drag = null; return; }      // a tap, not a swipe
    endDrag(e.clientX - drag.x);
  };
  box.addEventListener('pointerup', release);
  // A cancelled gesture must be forgotten AND the track put back, or the picture is left
  // hanging half way off the screen.
  box.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag = null;
    settleTrack(box, 0, { animate: true });
  });

  // Drop the big image on close so it is not held in memory behind the scenes.
  box.addEventListener('close', () => {
    resetZoom(box);
    img.removeAttribute('src');
    group = [];
  });
}
