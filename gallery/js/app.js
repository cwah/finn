// Bootstrap: load the collection, decide what to show, and wire up the ways to move.
//
// Not pure. Everything with an off-by-one or a rule in it lives in collection.js,
// frames.js, placard.js, gesture.js and deep-link.js; what is left here is history,
// events and timing.

import { getGallery } from './data.js';
import {
  orderCollection, indexOfId, stepIndex, canStep, neighbourIndices,
} from './collection.js';
import { assignFrames } from './frames.js';
import { orientationOf } from './art-fit.js';
import { placardLines } from './placard.js';
import { swipeIntent } from './gesture.js';
import { artIdFromUrl, urlForIndex } from './deep-link.js';
import { APP_ROOT } from './paths.js';
import { renderArtwork, renderNav } from './render.js';
import { preloadNeighbours } from './preload.js';

const FADE_OUT = 140;

const refs = {
  stage: document.querySelector('.stage'),
  artwork: document.querySelector('.artwork'),
  art: document.querySelector('.art'),
  placard: document.querySelector('.placard'),
  gallery: document.querySelector('.gallery'),
  older: document.querySelector('[data-nav="older"]'),
  newer: document.querySelector('[data-nav="newer"]'),
  status: document.querySelector('[role="status"]'),
};

/** @type {{list: Array, frames: Object<string,string>, config: object}} */
let gallery = { list: [], frames: {}, config: {} };
let current = 0;

/** Motion is a preference, and it is allowed to change while the page is open. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function start() {
  const { config, artworks } = await getGallery();

  const list = orderCollection(artworks);

  // Frames are assigned OLDEST first — see the long comment in frames.js. Getting
  // this backwards is invisible until someone's bookmarked link changes frames.
  const oldestFirst = [...list].reverse();
  const chosen = assignFrames(oldestFirst.map((a) => ({
    id: a.id,
    frame: a.frame,
    orientation: orientationOf(a.image?.width, a.image?.height),
  })));
  const frames = Object.fromEntries(oldestFirst.map((a, i) => [a.id, chosen[i]]));

  gallery = { list, frames, config };

  // A collection can now genuinely be empty — the static manifest always had five
  // drawings in it, PocketBase starts with none. Without this the wall renders a blank
  // 4:5 frame and an empty placard, which looks like a bug rather than like a gallery
  // waiting for its first piece.
  if (list.length === 0) {
    showEmpty();
    return;
  }

  // An unknown or missing ?art= falls back to the newest piece, and rewrites the URL
  // so a dead link does not sit in the address bar looking like it worked.
  const asked = artIdFromUrl(location.search);
  const found = asked ? indexOfId(list, asked) : -1;
  if (asked && found < 0) history.replaceState({ index: 0 }, '', './');
  // immediate: there is nothing on the wall yet to fade out of, and spending 140ms
  // fading from blank to blank delays the one paint the visitor actually waited for.
  show(found >= 0 ? found : 0, { replace: true, immediate: true });

  wire();
}

/** Nothing has been hung yet. Say so, rather than showing an empty frame. */
function showEmpty() {
  refs.artwork.hidden = true;
  refs.older.hidden = true;
  refs.newer.hidden = true;
  refs.placard.replaceChildren();

  const title = document.createElement('h1');
  title.className = 'placard-title';
  title.textContent = gallery.config?.galleryTitle || 'The collection';
  const note = document.createElement('p');
  note.className = 'placard-note';
  note.textContent = 'Nothing is hanging yet.';
  refs.placard.append(title, note);
  refs.status.textContent = 'The collection is empty.';
}

/** Put a piece on the wall. */
function paint(index) {
  const artwork = gallery.list[index];
  if (!artwork) return;

  renderArtwork(refs, {
    artwork,
    frame: gallery.frames[artwork.id] ?? 'plain',
    lines: placardLines(artwork, gallery.config, gallery.list),
    index,
    total: gallery.list.length,
  });

  renderNav(refs, {
    canOlder: canStep(index, 1, gallery.list.length),
    canNewer: canStep(index, -1, gallery.list.length),
  });

  preloadNeighbours(gallery.list, neighbourIndices(index, gallery.list.length));
}

/**
 * Move to a position, fading through the swap.
 *
 * The assembly's SIZE changes between a portrait and a landscape piece, and size
 * cannot be animated — so the swap happens while it is invisible and only opacity and
 * transform ever move.
 *
 * The timeout is NOT decoration and must not be replaced with a transitionend
 * listener. base.css disables every transition under prefers-reduced-motion, and a
 * transition that never runs never fires transitionend — navigation would dead-lock
 * for exactly the visitors who need it to work. Under Reduce Motion the wait is 0 and
 * the swap is instant, which is the correct behaviour anyway.
 */
function show(index, { replace = false, silent = false, immediate = false } = {}) {
  const target = Math.min(Math.max(index, 0), Math.max(gallery.list.length - 1, 0));
  const changing = target !== current || replace;
  current = target;

  if (!silent) {
    // urlForIndex stays pure and app-relative; anchoring it to the app root is this
    // file's job, because only the impure half knows where the app is mounted.
    const url = new URL(urlForIndex(gallery.list, target), APP_ROOT);
    const state = { index: target };
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  }

  if (!changing) return;

  if (immediate) {
    paint(target);
    refs.stage.dataset.swapping = 'false';
    return;
  }

  const wait = reducedMotion.matches ? 0 : FADE_OUT;
  refs.stage.dataset.swapping = 'true';
  setTimeout(() => {
    paint(target);
    // Let the new artwork land before fading it in, so the browser has a frame to
    // apply the swapped size in while it is still invisible.
    requestAnimationFrame(() => { refs.stage.dataset.swapping = 'false'; });
  }, wait);
}

/** One step through the collection. +1 is earlier work, -1 is later. */
function step(delta) {
  const next = stepIndex(current, delta, gallery.list.length);
  if (next !== current) show(next);
}

function wire() {
  refs.older.addEventListener('click', () => step(1));
  refs.newer.addEventListener('click', () => step(-1));

  document.addEventListener('keydown', (event) => {
    // Leave the browser's own shortcuts alone, and stay out of the way of anything
    // that takes typing. There are no fields today; there will be.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    if (event.key === 'ArrowLeft') step(1);
    else if (event.key === 'ArrowRight') step(-1);
    else if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(gallery.list.length - 1);
    else return;
    event.preventDefault();
  });

  // Swipe. The thresholds are in gesture.js; this only measures.
  //
  // Touch and pen only. A mouse drag across the picture is someone trying to select
  // or save it, or just moving the cursor with the button down — turning the page out
  // from under them is startling, and a mouse already has both arrows and the keyboard.
  let from = null;
  refs.gallery.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    from = { x: event.clientX, y: event.clientY, at: performance.now() };
  });
  refs.gallery.addEventListener('pointerup', (event) => {
    if (!from) return;
    const intent = swipeIntent(event.clientX - from.x, event.clientY - from.y,
      performance.now() - from.at);
    from = null;
    if (intent) step(intent);
  });
  refs.gallery.addEventListener('pointercancel', () => { from = null; });

  // Back and forward walk the collection, which is what a visitor expects from a
  // page that changes its URL.
  addEventListener('popstate', (event) => {
    const index = Number.isFinite(event.state?.index)
      ? event.state.index
      : Math.max(indexOfId(gallery.list, artIdFromUrl(location.search)), 0);
    show(index, { silent: true });
  });
}

start().catch((error) => {
  console.error(error);
  refs.placard.replaceChildren();
  const message = document.createElement('p');
  message.className = 'placard-note';
  message.textContent = 'The collection could not be loaded.';
  refs.placard.append(message);
});
