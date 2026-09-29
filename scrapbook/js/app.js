// Bootstrap: load config + first page, wire infinite scroll (IntersectionObserver),
// reveal-on-scroll, battery-friendly parallax (rAF + translate3d), and capture.

import { getConfig, getPosts } from './data.js';
import { renderPost, setMilestoneArt } from './render.js';
import { ageStamp } from './age.js';
import { initCapture, openForEdit, openWithFiles } from './capture.js';
import { initScrubber } from './scrubber.js';
import { ensureSignedIn, initSignOut, initNotifications } from './auth.js';
import { initLightbox } from './lightbox.js';
import { initCarousels } from './carousel.js';
import { initMotion, releaseMotion } from './motion-play.js';
import { centreProgress } from './fade.js';
import { assignSides, assignPresets } from './milestone-art.js';
import { pickNewPosts, oldestDate, insertionIndex, pickUnseen } from './sync.js';
import { initPwa } from './pwa.js';
import { optional } from './optional.js';
import { wantedPost, pageUntilFound } from './deep-link.js';
import { claimSharedFiles, cameFromShare, shareReport, shareNotice } from './share.js';

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

/**
 * Put a card where its date says it goes, among the cards already there.
 *
 * Shared by paging and by insertion, because they were never really doing different
 * things — paging simply got away with appending for as long as pages arrived in order.
 */
function placeCard(card) {
  const cards = [...timeline.children];
  const dates = cards.map((c) => c.dataset.memoryDate || null);
  const times = cards.map((c) => c.dataset.happenedAt || '');
  const at = insertionIndex(dates, card.dataset.memoryDate, times, card.dataset.happenedAt || '');
  const before = timeline.children[at];
  if (before) timeline.insertBefore(card, before);
  else timeline.append(card);
}

function mountCard(card) {
  placeCard(card);
  revealObserver.observe(card);
  card.querySelectorAll('[data-parallax]').forEach((el) => parallaxObserver.observe(el));
  if (card.classList.contains('milestone-scene')) artObserver.observe(card);
  initCarousels(card);
  initMotion(card);
}

/**
 * Bring one post into view, loading pages until it is there.
 *
 * Used by a notification tap. The card may be a long way down: a memory backdated to June
 * is the newest thing that happened and sits months below the fold, which is exactly the
 * case where landing at the top is no help.
 *
 * Silent when it cannot find it. A deleted post, or a stale notification, should leave
 * someone at the top of their scrapbook rather than being told about an id.
 */
async function showPost(id) {
  const cardFor = (postId) => timeline.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
  const found = await pageUntilFound(id, {
    has: (postId) => Boolean(cardFor(postId)),
    hasMore: () => hasMore,
    loadMore,
  });
  if (!found) return false;

  const card = cardFor(id);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // A brief mark, because arriving mid-timeline is disorienting on its own — several
  // cards are on screen and nothing says which one was the point.
  card.classList.add('is-linked');
  setTimeout(() => card.classList.remove('is-linked'), 2400);
  return true;
}

async function loadMore() {
  if (loading || !hasMore) return;
  loading = true;
  // try/finally, or one failed fetch leaves `loading` true for the rest of the session and
  // paging stops for good — silently, since nothing here reports an error.
  try {
    const { items, hasMore: more } = await getPosts({ page });

    // Anything already on screen is dropped rather than added a second time. Pages are
    // fetched by offset, so a post inserted into the middle of the timeline shifts every
    // row below it down one and the next page hands back a card already displayed.
    const unseen = pickUnseen(items, loadedPosts);
    unseen.forEach((post) => loadedPosts.set(post.id, post));
    unseen
      // renderPost returns null for posts with nothing to show — skip those.
      .map((post) => renderPost(post, birthDate, { currentAuthorId }))
      .filter(Boolean)
      .forEach(mountCard);

    // From the SERVER's answer, not from how many survived the filter — a page that was
    // entirely duplicates is still a page, and there may well be more behind it.
    hasMore = more;
    page += 1;
  } finally {
    loading = false;
  }
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

  placeCard(card);
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
  // Before the gate, deliberately. Registration is not a privilege: the worker is what
  // makes the app installable and what receives the system share sheet, and both have to
  // work for someone whose session has simply expired. Gated behind sign-in, a signed-out
  // visitor got no worker at all — so sharing a photo to the app would have had nothing
  // listening for it.
  // Wrapped: the worker makes the app installable and receives the share sheet, and both
  // matter — but neither is worth the timeline for. Registration touches browser APIs that
  // vary by platform and by whether the page is secure, which is exactly the kind of thing
  // that throws on one device and nowhere else.
  optional('pwa', initPwa);

  // Nothing is fetched until a parent is in — this scrapbook has no public view.
  await ensureSignedIn();
  initSignOut();

  const config = await getConfig();
  // Wrapped, and this is the line the whole rollback was about. The bell is the most
  // optional thing on the page and it sits between reading config and wiring the compose
  // button, so an unguarded throw here took out the add-post button and the timeline with
  // it — two symptoms, neither pointing at notifications.
  optional('notifications', initNotifications);
  birthDate = config.birthDate;
  currentAuthorId = config.currentAuthor?.id || null;
  // Neither the heading nor the tab title is assigned here. Both say "Finnbook", both are
  // written in index.html, and both stay put — filling either from config is what made
  // them change under the reader mid-load. `config.babyName` is still the record's field;
  // nothing on this page displays it. The AGE below the heading is Finn's, and that does
  // have to be worked out.
  document.getElementById('babyAge').textContent = ageStamp(birthDate, new Date().toISOString());

  initLightbox(timeline);

  await loadMore();
  pageObserver.observe(sentinel);
  initSync();

  // A notification tap arrives as ?post=<id>. Wrapped: paging to a card is a convenience,
  // and a scrapbook that would not open because a deep link misbehaved would be a poor
  // trade. The query is cleared either way, so a reload is an ordinary visit rather than
  // a second scramble down the page.
  const asked = wantedPost(location.href);
  if (asked) {
    optional('deep link', () => showPost(asked));
    history.replaceState(null, '', location.pathname);
  }

  // The same tap, on a tab that was ALREADY open. It does not reload, so it never reads a
  // query string; the worker tells it instead.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'show-post') return;
    const id = wantedPost(e.data.url);
    if (id) optional('deep link', () => showPost(id));
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  initCapture({ author: config.currentAuthor, canPost: config.canPost }, {
    onCreate: insertPost,
    onUpdate: replacePost,
    onDelete: removePost,
  });

  // Anything handed over by the system share sheet.
  //
  // AFTER initCapture, and that is the whole point: openWithFiles does not exist until
  // then. Placed before it, this claimed the files — emptying the cache and stripping the
  // URL flag — and handed them to the no-op the export starts life as. The share was not
  // ignored, it was destroyed, silently, which is what "sharing does nothing" looked like.
  //
  // Claimed after sign-in too, because the gate blocks above and the files keep perfectly
  // well in the meantime: sharing to a signed-out scrapbook should end in the compose
  // sheet, not in a lost photo.
  // Read BEFORE cameFromShare, which clears the markers out of the address bar.
  const report = shareReport();

  // TEMPORARY, and the half the worker cannot tell us: if the worker never ran, the page
  // still loaded, so a page line with no matching worker line proves the share POST never
  // reached the service worker at all. Restored alongside the worker's, because sharing
  // works on one phone and not on another and nothing else has been able to say why.
  if (location.search) {
    fetch('/share-debug', {
      method: 'POST',
      body: JSON.stringify({
        at: 'page',
        search: location.search.slice(0, 200),
        report,
        canPost: config.canPost,
        controlled: Boolean(navigator.serviceWorker?.controller),
        // Whether this is the installed app or a browser tab, and which worker is in
        // charge — both differ between the two phones and neither is visible server-side.
        standalone: Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches),
        ua: (navigator.userAgent || '').slice(0, 160),
      }),
      headers: { 'content-type': 'application/json' },
    }).catch(() => {});
  }
  if (cameFromShare()) {
    const shared = await claimSharedFiles();
    // ALWAYS opened, for a parent who can post. Someone who picked photos elsewhere and
    // chose Finnbook has already said what they want; landing on the timeline as though
    // nothing happened is the one outcome that reads as the feature being broken — and it
    // is what "sharing does nothing" turned out to mean. shareNotice returns null only
    // when everything actually arrived.
    if (config.canPost) openWithFiles(shared, shareNotice(report, shared.length));
  }

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
