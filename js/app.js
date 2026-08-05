// Bootstrap: load config + first page, wire infinite scroll (IntersectionObserver),
// reveal-on-scroll, battery-friendly parallax (rAF + translate3d), and capture.

import { getConfig, getPosts } from './data.js';
import { renderPost } from './render.js';
import { ageStamp } from './age.js';
import { initCapture } from './capture.js';
import { initScrubber } from './scrubber.js';
import { ensureSignedIn, initSignOut } from './auth.js';
import { initLightbox } from './lightbox.js';
import { initCarousels } from './carousel.js';

const timeline = document.getElementById('timeline');
const sentinel = document.getElementById('sentinel');
const scrubber = initScrubber(timeline);

let birthDate = null;
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
    scrubber.update();
    rafPending = false;
  });
}

// ── Milestone sketches: fade in and out, never move ────────────────
// Lit while the scene sits in the middle band of the viewport, so a sketch fades up as
// its card arrives and fades away as it leaves. Opacity only — no scroll-driven
// positioning, so this costs nothing per frame.
const artObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) e.target.classList.toggle('is-lit', e.isIntersecting);
  },
  { rootMargin: '-12% 0px -12% 0px' },
);

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
  items
    .map((post) => renderPost(post, birthDate))
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

// A freshly captured memory can be backdated, so it does not necessarily belong at
// the top — drop it into place by memoryDate among the cards already on screen.
function insertPost(post) {
  const card = renderPost(post, birthDate);
  if (!card) return;

  const older = Array.from(timeline.children).find(
    (c) => c.dataset.memoryDate && c.dataset.memoryDate < post.memoryDate,
  );
  if (older) timeline.insertBefore(card, older);
  else timeline.append(card);

  card.classList.add('is-visible'); // skip the reveal animation for fresh captures
  card.querySelectorAll('[data-parallax]').forEach((el) => parallaxObserver.observe(el));
  if (card.classList.contains('milestone-scene')) artObserver.observe(card);
  initCarousels(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  restripeMilestones(); // a milestone inserted mid-timeline flips every side below it
  scrubber.refresh();
}

async function init() {
  // Nothing is fetched until a parent is in — this scrapbook has no public view.
  await ensureSignedIn();
  initSignOut();

  const config = await getConfig();
  birthDate = config.birthDate;
  document.getElementById('babyName').textContent = config.babyName;
  document.getElementById('babyAge').textContent = ageStamp(birthDate, new Date().toISOString());

  initLightbox(timeline);

  await loadMore();
  pageObserver.observe(sentinel);
  window.addEventListener('scroll', onScroll, { passive: true });
  initCapture({ author: config.currentAuthor }, insertPost);
}

init().catch((err) => {
  console.error(err);
  document.getElementById('babyAge').textContent = 'Could not load memories.';
});
