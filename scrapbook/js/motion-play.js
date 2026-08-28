// Playback on cards: motion photos loop while they are on screen, and a video plays in
// place when its badge is tapped.
//
// A motion photo IS its motion — one that never moved would just be a photo. A video is
// different: several decoders running at once is exactly the battery cost this app avoids
// everywhere else, so a video shows its poster and its length until someone asks for it.
//
// Driven by IntersectionObserver, never by a scroll listener, for the same reason paging
// and the milestone artwork are. Playback is also given up entirely while the tab is
// hidden: a looping video in a background tab decodes frames nobody is watching.

/** Enough of the card on screen to be worth spending a decoder on. */
const VISIBLE = 0.35;

/** Someone who asked for less movement gets the poster frame, which is the same picture
 *  holding still. Read live rather than cached — the setting can change mid-session. */
const wantsStillness = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Whether the tab is out of sight. Nothing should decode behind another window.
 *
 * Reached through `globalThis` so the trim rule below can be tested without a DOM. In a
 * browser this is `document.hidden` and nothing else; with no document there is no tab to
 * be hidden behind, so false is the right answer as well as the convenient one.
 */
const outOfSight = () => globalThis.document?.hidden ?? false;

let observer = null;
const playing = new Set();

/**
 * Motion photos someone has deliberately stopped.
 *
 * A manual pause has to outlast scrolling away and back, or the observer would restart
 * the loop the moment the card returned and the button would look broken. Held apart from
 * `playing`, which is only about what is on screen.
 */
const heldStill = new WeakSet();

/** The trimmed stretch of a card's video, as the renderer wrote it. */
function trimOf(video) {
  const start = Number(video.dataset.trimStart) || 0;
  const end = Number(video.dataset.trimEnd) || 0;
  return end > start ? { start, end } : null;
}

/** Exposed for tests: whether the observer currently considers a video on screen. */
export function markOnScreen(video) {
  playing.add(video);
}

function play(video) {
  playing.add(video);
  if (outOfSight() || wantsStillness() || heldStill.has(video)) return;
  // Start inside the trim, not wherever it was left. Coming back to a card that scrolled
  // away mid-loop would otherwise resume outside the chosen stretch.
  const trim = trimOf(video);
  if (trim && (video.currentTime < trim.start || video.currentTime >= trim.end)) {
    video.currentTime = trim.start;
  }
  // Autoplay can still be refused (a data-saver setting, a battery-saver mode). The
  // poster stays, which is exactly what a still would have shown, so there is nothing
  // to report and nothing to fix.
  video.play().catch(() => {});
}

/**
 * Loop a motion photo INSIDE its trim.
 *
 * `holdToTrim` is the video version and pauses at the end, which is right for something
 * that was asked to play once. A motion photo is a loop, so it has to go round again.
 *
 * Native `loop` cannot express a sub-range: it restarts the FILE, so a trimmed motion
 * photo played the whole take and the trim looked as though it had not saved at all. The
 * `#t=start,end` fragment sets the opening position and nothing more — no browser enforces
 * the end across a loop. So the attribute goes and the range is kept here.
 */
export function wireMotionTrim(video) {
  if (video.dataset.trimWired) return;
  video.dataset.trimWired = 'true';

  const trim = trimOf(video);
  if (!trim) return;

  video.loop = false;

  const rewind = () => {
    video.currentTime = trim.start;
    // Only keep going if this card is still the one on screen and nobody stopped it.
    if (playing.has(video) && !outOfSight() && !wantsStillness() && !heldStill.has(video)) {
      video.play().catch(() => {});
    }
  };

  video.addEventListener('timeupdate', () => {
    if (video.currentTime >= trim.end) rewind();
  });
  // timeupdate fires a few times a second, so a trim ending at the last frame can run out
  // before it notices. `ended` is the backstop.
  video.addEventListener('ended', rewind);
  video.addEventListener('seeking', () => {
    if (video.currentTime < trim.start) video.currentTime = trim.start;
  });
}

function stop(video) {
  playing.delete(video);
  video.pause();
}

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) play(entry.target);
      else stop(entry.target);
    }
  }, { threshold: VISIBLE });

  // Leaving the tab should cost nothing; coming back should pick up where it was.
  document.addEventListener('visibilitychange', () => {
    for (const video of playing) {
      if (outOfSight() || wantsStillness() || heldStill.has(video)) video.pause();
      else video.play().catch(() => {});
    }
  });
  return observer;
}

/**
 * Keep playback inside the trimmed range.
 *
 * The `#t=start,end` media fragment asks for exactly this, and browsers honour the start
 * reliably but the end only sometimes — so the end is enforced here too. Trimming is
 * framing, not destruction: the file still holds every frame, and this is what makes the
 * memory the stretch the parent chose rather than the whole take.
 *
 * Shared by the cards and the lightbox, because a trim has to mean the same thing in both.
 */
export function holdToTrim(video, { start, end }, onEnd) {
  if (!(end > start)) return;
  video.addEventListener('timeupdate', () => {
    if (video.currentTime < end) return;
    video.pause();
    video.currentTime = start; // ready to play again from the top of the trim
    if (onEnd) onEnd();
  });
  // Scrubbing behind the start, or replaying, lands back inside the range.
  video.addEventListener('seeking', () => {
    if (video.currentTime < start) video.currentTime = start;
  });
}

/**
 * Play a video in place on its card.
 *
 * A video still does not play by ITSELF — several decoders running unasked is the battery
 * cost this app avoids everywhere else — but expanding it to watch four seconds was a lot
 * of ceremony. The badge is the small, explicit ask; tapping the picture still expands.
 */
function wireBadge(badge) {
  if (badge.dataset.wired) return;
  badge.dataset.wired = 'true';

  const box = badge.parentElement.querySelector('.crop-box');
  const video = box?.querySelector('video');
  if (!video) return;

  const trim = {
    start: Number(video.dataset.trimStart) || 0,
    end: Number(video.dataset.trimEnd) || 0,
  };
  const reset = () => {
    badge.classList.remove('is-playing');
    badge.setAttribute('aria-label', `Play, ${badge.dataset.length}`);
  };
  holdToTrim(video, trim, reset);
  video.addEventListener('pause', reset);

  badge.addEventListener('click', (e) => {
    // The badge sits over the picture, whose own tap opens the lightbox.
    e.stopPropagation();
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.currentTime < trim.start || video.currentTime >= trim.end) {
      video.currentTime = trim.start;
    }
    badge.classList.add('is-playing');
    badge.setAttribute('aria-label', 'Pause');
    playing.add(video);
    video.play().catch(reset); // refused playback must not leave a pause icon showing
  });
}

/**
 * Stop or restart a looping motion photo.
 *
 * Without this the only thing a motion photo offered on hover was "expand", and a loop
 * you cannot stop is the kind of small thing that makes a page tiring to sit with. The
 * button hides itself again unless it is holding the photo still — a paused loop with no
 * visible control would just look stuck.
 */
function wireMotionBadge(badge) {
  if (badge.dataset.wired) return;
  badge.dataset.wired = 'true';

  const video = badge.parentElement.querySelector('.crop-box video');
  if (!video) return;

  const paint = () => {
    const held = heldStill.has(video);
    badge.classList.toggle('is-playing', !held);
    badge.parentElement.classList.toggle('is-held', held);
    badge.setAttribute('aria-label', held ? 'Play this motion photo' : 'Pause this motion photo');
  };

  badge.addEventListener('click', (e) => {
    e.stopPropagation(); // the picture underneath expands; the button does not
    if (heldStill.has(video)) {
      heldStill.delete(video);
      play(video);
    } else {
      heldStill.add(video);
      video.pause();
    }
    paint();
  });
  paint();
}

/**
 * Wire up playback for a freshly built card: loop its motion photos, and let its videos
 * play in place. Safe to call again on the same card.
 */
export function initMotion(root) {
  root.querySelectorAll('.video-badge--motion').forEach(wireMotionBadge);
  root.querySelectorAll('.video-badge:not(.video-badge--motion)').forEach(wireBadge);

  const videos = root.querySelectorAll('video[data-motion="true"]');
  if (!videos.length) return;
  const io = ensureObserver();
  videos.forEach((video) => {
    wireMotionTrim(video);
    io.observe(video);
  });
}

/** Release a card's videos when it leaves the timeline, so nothing decodes off-screen. */
export function releaseMotion(root) {
  if (!observer) return;
  root.querySelectorAll('video[data-motion="true"]').forEach((video) => {
    observer.unobserve(video);
    playing.delete(video);
  });
}
