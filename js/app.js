// Bootstrap: load config + first page, wire infinite scroll (IntersectionObserver),
// reveal-on-scroll, battery-friendly parallax (rAF + translate3d), and capture.

import { getConfig, getPosts } from './data.js';
import { renderPost } from './render.js';
import { ageStamp } from './age.js';
import { initCapture, openForEdit } from './capture.js';
import { initScrubber } from './scrubber.js';
import { ensureSignedIn, initSignOut } from './auth.js';
import { initLightbox } from './lightbox.js';
import { initCarousels } from './carousel.js';
import { centreProgress } from './fade.js';

const timeline = document.getElementById('timeline');
const sentinel = document.getElementById('sentinel');
const scrubber = initScrubber(timeline);

let birthDate = null;
let currentAuthorId = null; // decides which cards offer an edit button
let loadedPosts = new Map(); // id -> post, so an edit can reopen what is on screen
let page = 0;
let loading = false;
let hasMore = true;

// ── Reveal cards as they scroll into view ──────────────────────────
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        revealObserver.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
);

// ── Parallax: only animate photos currently on screen ──────────────
const parallaxActive = new Set();
const parallaxObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) parallaxActive.add(e.target);
      else parallaxActive.delete(e.target);
    }
  },
  { threshold: 0 },
);

let rafPending = false;
function onScroll() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    const vh = window.innerHeight;
    parallaxActive.forEach((img) => {
      const frame = img.parentElement;
      const rect = frame.getBoundingClientRect();
      // -1 (entering bottom) .. 1 (leaving top)
      const progress = (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2);
      const shift = Math.max(-1, Math.min(1, progress)) * -16; // px drift
      img.style.transform = `translate3d(0, ${shift}px, 0)`;
    });
    paintArt(vh);
    scrubber.update();
    rafPending = false;
  });
}

// ── Milestone artwork: stationary, fading with scroll ──────────────
// The artwork never moves. It fades up as its card comes into view, is clearest when the
// card is the thing you are looking at, and fades away as the card leaves.
//
// Opacity only — nothing is repositioned — and only for scenes actually on screen, which
// the observer tracks so the per-frame work stays proportional to what is visible.
const artActive = new Set();
const artObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        artActive.add(e.target);
      } else {
        artActive.delete(e.target);
        e.target.style.setProperty('--art-progress', 0); // fully out once off screen
      }
    }
    // Paint immediately: a card already on screen at load never gets a scroll event.
    paintArt();
  },
  { rootMargin: '15% 0px' }, // start fading before the card's edge reaches the viewport
);

/** Opacity only — nothing here is repositioned. See centreProgress for the curve. */
function paintArt(vh = window.innerHeight) {
  artActive.forEach((scene) => {
    const rect = scene.getBoundingClientRect();
    const p = centreProgress(rect.top, rect.height, vh);
    scene.style.setProperty('--art-progress', p.toFixed(3));
  });
}

// Sides alternate down the timeline. Milestones are interleaved with ordinary cards, so
// no CSS selector can count them — assign after mounting, when the order is known.
function restripeMilestones() {
  timeline.querySelectorAll('.milestone-scene').forEach((scene, i) => {
    scene.classList.toggle('side-right', i % 2 === 0);
    scene.classList.toggle('side-left', i % 2 === 1);
  });
}

function mountCard(card) {
  timeline.append(card);
  revealObserver.observe(card);
  card.querySelectorAll('[data-parallax]').forEach((el) => parallaxObserver.observe(el));
  if (card.classList.contains('milestone-scene')) artObserver.observe(card);
  initCarousels(card);
}

async function loadMore() {
  if (loading || !hasMore) return;
  loading = true;
  const { items, hasMore: more } = await getPosts({ page });
  // renderPost returns null for posts with nothing to show — skip those.
  items.forEach((post) => loadedPosts.set(post.id, post));
  items
    .map((post) => renderPost(post, birthDate, { currentAuthorId }))
    .filter(Boolean)
    .forEach(mountCard);
  hasMore = more;
  page += 1;
  loading = false;
  restripeMilestones();
  // New cards changed the document height and added months — re-measure once, here,
  // rather than from the scroll path.
  scrubber.refresh();
}

// Pull the next page when the sentinel nears the viewport.
const pageObserver = new IntersectionObserver(
  (entries) => { if (entries[0].isIntersecting) loadMore(); },
  { rootMargin: '600px 0px' },
);

/** Attach the observers a freshly built card needs, and skip the reveal animation. */
function activate(card) {
  card.classList.add('is-visible');
  card.querySelectorAll('[data-parallax]').forEach((el) => parallaxObserver.observe(el));
  if (card.classList.contains('milestone-scene')) artObserver.observe(card);
  initCarousels(card);
}

// A freshly captured memory can be backdated, so it does not necessarily belong at
// the top — drop it into place by memoryDate among the cards already on screen.
function insertPost(post) {
  loadedPosts.set(post.id, post);
  const card = renderPost(post, birthDate, { currentAuthorId });
  if (!card) return;

  const older = Array.from(timeline.children).find(
    (c) => c.dataset.memoryDate && c.dataset.memoryDate < post.memoryDate,
  );
  if (older) timeline.insertBefore(card, older);
  else timeline.append(card);

  activate(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  restripeMilestones(); // a milestone inserted mid-timeline flips every side below it
  scrubber.refresh();
}

/** Swap an edited post's card for a freshly rendered one. */
function replacePost(post) {
  const old = [...timeline.children].find((c) => c.dataset.postId === post.id);
  const card = renderPost(post, birthDate, { currentAuthorId });

  // The date may have changed, which moves the card — so drop the old one and re-insert
  // rather than swapping in place, and let insertPost put it where it now belongs.
  if (old) old.remove();
  if (!card) { restripeMilestones(); scrubber.refresh(); return; }
  insertPost(post);
}

/** Drop a deleted post's card. */
function removePost(id) {
  loadedPosts.delete(id);
  const card = [...timeline.children].find((c) => c.dataset.postId === id);
  if (card) card.remove();
  restripeMilestones();
  scrubber.refresh();
}

async function init() {
  // Nothing is fetched until a parent is in — this scrapbook has no public view.
  await ensureSignedIn();
  initSignOut();

  const config = await getConfig();
  birthDate = config.birthDate;
  currentAuthorId = config.currentAuthor?.id || null;
  document.getElementById('babyName').textContent = config.babyName;
  document.getElementById('babyAge').textContent = ageStamp(birthDate, new Date().toISOString());

  initLightbox(timeline);

  await loadMore();
  pageObserver.observe(sentinel);
  window.addEventListener('scroll', onScroll, { passive: true });
  initCapture({ author: config.currentAuthor }, {
    onCreate: insertPost,
    onUpdate: replacePost,
    onDelete: removePost,
  });

  // Delegated, because cards stream in as you scroll — one listener beats re-binding.
  timeline.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-post]');
    if (!btn) return;
    const post = loadedPosts.get(btn.dataset.editPost);
    if (post) openForEdit(post);
  });
}

init().catch((err) => {
  console.error(err);
  document.getElementById('babyAge').textContent = 'Could not load memories.';
});
