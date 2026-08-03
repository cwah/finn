// Bootstrap: load config + first page, wire infinite scroll (IntersectionObserver),
// reveal-on-scroll, battery-friendly parallax (rAF + translate3d), and capture.

import { getConfig, getPosts } from './data.js';
import { renderPost } from './render.js';
import { ageStamp } from './age.js';
import { initCapture } from './capture.js';
import { initScrubber } from './scrubber.js';

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
    parallaxActive.forEach((el) => {
      const frame = el.parentElement;
      const rect = frame.getBoundingClientRect();
      // -1 (entering bottom) .. 1 (leaving top)
      const progress = (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2);
      const t = Math.max(-1, Math.min(1, progress));
      // Photos drift vertically inside their frame; the milestone sketch drifts
      // sideways, which reads better in a band only 78px tall.
      el.style.transform = el.dataset.parallax === 'x'
        ? `translate3d(${t * 20}px, 0, 0)`
        : `translate3d(0, ${t * -16}px, 0)`;
    });
    scrubber.update();
    rafPending = false;
  });
}

function mountCard(card) {
  timeline.append(card);
  revealObserver.observe(card);
  card.querySelectorAll('[data-parallax]').forEach((el) => parallaxObserver.observe(el));
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
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  scrubber.refresh();
}

async function init() {
  const config = await getConfig();
  birthDate = config.birthDate;
  document.getElementById('babyName').textContent = config.babyName;
  document.getElementById('babyAge').textContent = ageStamp(birthDate, new Date().toISOString());

  await loadMore();
  pageObserver.observe(sentinel);
  window.addEventListener('scroll', onScroll, { passive: true });
  // Phase 2 replaces config.currentAuthor with the signed-in PocketBase account.
  initCapture({ author: config.currentAuthor }, insertPost);
}

init();
