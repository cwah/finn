// Bootstrap: load config + first page, wire infinite scroll (IntersectionObserver),
// reveal-on-scroll, battery-friendly parallax (rAF + translate3d), and capture.

import { getConfig, getPosts } from './data.js';
import { renderPost, setMilestoneArt } from './render.js';
import { ageStamp } from './age.js';
import { initCapture, openForEdit } from './capture.js';
import { initScrubber } from './scrubber.js';
import { ensureSignedIn, initSignOut } from './auth.js';
import { initLightbox } from './lightbox.js';
import { initCarousels } from './carousel.js';
import { initMotion, releaseMotion } from './motion-play.js';
import { centreProgress } from './fade.js';
import { assignSides, assignPresets } from './milestone-art.js';
import { pickNewPosts, oldestDate } from './sync.js';

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

// Which drawing each milestone shows, and which side it takes. Both depend on the run of
// milestones rather than on one post — nothing repeats back to back, and pinned artwork
// keeps its side while the rest alternates around it — so both are decided here, once the
// timeline order is known, and re-decided whenever that order changes.
//
// Milestones are interleaved with ordinary cards, so no CSS selector could do either.
function restripeMilestones() {
  const scenes = [...timeline.querySelectorAll('.milestone-scene')];
  const presets = assignPresets(scenes.map((s) => s.dataset.milestoneTitle));
  const sides = assignSides(presets);

  scenes.forEach((scene, i) => {
    setMilestoneArt(scene.querySelector('.milestone-art-wrap'), presets[i]);
    scene.classList.toggle('side-right', sides[i] === 'right');
    scene.classList.toggle('side-left', sides[i] === 'left');
  });
}

function mountCard(card) {
  timeline.append(card);
  revealObserver.observe(card);
  card.querySelectorAll('[data-parallax]').forEach((el) => parallaxObserver.observe(el));
  if (card.classList.contains('milestone-scene')) artObserver.observe(card);
  initCarousels(card);
  initMotion(card);
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
  initMotion(card);
}

// A freshly captured memory can be backdated, so it does not necessarily belong at
// the top — drop it into place by memoryDate among the cards already on screen.
//
// `reveal` is the difference between a memory YOU just made and one that arrived from
// elsewhere. Scrolling to your own is helpful; yanking the page because the other parent
// posted something while you were reading is not.
function insertPost(post, { reveal = true } = {}) {
  loadedPosts.set(post.id, post);
  const card = renderPost(post, birthDate, { currentAuthorId });
  if (!card) return;

  const older = Array.from(timeline.children).find(
    (c) => c.dataset.memoryDate && c.dataset.memoryDate < post.memoryDate,
  );
  if (older) timeline.insertBefore(card, older);
  else timeline.append(card);

  activate(card);
  if (reveal) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  restripeMilestones(); // a milestone inserted mid-timeline flips every side below it
  scrubber.refresh();
}

/** Swap an edited post's card for a freshly rendered one. */
function replacePost(post) {
  const old = [...timeline.children].find((c) => c.dataset.postId === post.id);
  const card = renderPost(post, birthDate, { currentAuthorId });

  // The date may have changed, which moves the card — so drop the old one and re-insert
  // rather than swapping in place, and let insertPost put it where it now belongs.
  if (old) { releaseMotion(old); old.remove(); }
  if (!card) { restripeMilestones(); scrubber.refresh(); return; }
  insertPost(post);
}

/** Drop a deleted post's card. */
function removePost(id) {
  loadedPosts.delete(id);
  const card = [...timeline.children].find((c) => c.dataset.postId === id);
  // Stop decoding before the card goes, or an observed video outlives its own card.
  if (card) { releaseMotion(card); card.remove(); }
  restripeMilestones();
  scrubber.refresh();
}

// ── Memories added somewhere else ─────────────────────────────────
// The Telegram bot and the other parent's phone both write posts this tab knows nothing
// about, so a scrapbook left open goes quietly stale.
//
// Polled rather than pushed. PocketBase can stream changes over SSE, but that is a
// long-lived connection plus reconnection and re-auth handling, for an audience of two
// who post a few times a day — a slow poll is the calmer trade. It runs ONLY while the
// tab is visible, and fires immediately on coming back, which is the case that actually
// matters: the phone goes in a pocket, something is posted, the phone comes out again.
const SYNC_MS = 60000;

let syncTimer = null;
let syncing = false;

async function syncNewPosts() {
  // Paging owns the timeline while it is in flight; two writers would interleave badly.
  if (syncing || loading || document.hidden) return;
  syncing = true;
  try {
    const { items } = await getPosts({ page: 0 });
    const fresh = pickNewPosts(items, {
      known: loadedPosts,
      oldestLoaded: oldestDate(loadedPosts.values()),
      hasMore,
    });
    if (!fresh.length) return;

    // New memories land at the top, above whatever is being read, so the page must not
    // lurch because someone else posted. At the very top there is nothing to hold — the
    // card simply arrives, which is the one moment it is worth seeing.
    //
    // Held by MEASURING a card that is already on screen, not by adding up the height
    // inserted. Browsers do this themselves via scroll anchoring, so adding the height
    // blindly corrects a shift that has already been corrected and moves the page twice
    // as far as it should. Measuring is self-cancelling: where the browser has already
    // held the line the difference is zero and nothing happens, and where it has not,
    // this puts it back.
    const anchor = window.scrollY > 4 ? timeline.querySelector('.timeline-item') : null;
    const anchorTop = anchor?.getBoundingClientRect().top;

    // Oldest first, so each is placed against a timeline that already holds the ones
    // newer than it.
    for (const post of [...fresh].reverse()) insertPost(post, { reveal: false });

    if (anchor?.isConnected) {
      const drift = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(drift) > 1) {
        window.scrollTo({ top: window.scrollY + drift, behavior: 'instant' });
      }
    }
  } catch (err) {
    // A failed poll is not worth telling anyone about: the next one is a minute away,
    // and the timeline on screen is still perfectly good.
    console.warn('could not check for new memories:', err.message);
  } finally {
    syncing = false;
  }
}

function startSync() {
  clearInterval(syncTimer);
  syncTimer = setInterval(syncNewPosts, SYNC_MS);
}

function initSync() {
  startSync();
  document.addEventListener('visibilitychange', () => {
    clearInterval(syncTimer);
    if (document.hidden) return; // nothing decodes, nothing polls, nothing costs battery
    syncNewPosts();
    startSync();
  });
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
  initSync();
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
