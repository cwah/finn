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

/**
 * Give up a video that has gone off screen.
 *
 * The sound is handed back with it. A clip that is not playing is silent, without
 * exception — otherwise a video left unmuted and paused just off screen would speak the
 * moment anything started it again, which is precisely the surprise the muted default
 * exists to prevent. Restarting it is one tap, and that tap can ask for sound again.
 *
 * A motion photo is muted already and has no sound control, so this costs it nothing.
 */
function stop(video) {
  playing.delete(video);
  video.pause();
  video.muted = true;
}

/**
 * What being on or off screen means for a video.
 *
 * The two kinds part company here, and the asymmetry is the whole point:
 *
 *   OFF SCREEN  both stop, always. A video that carried on playing — and, since sound
 *               arrived, carried on TALKING — from somewhere above the fold is the
 *               clearest case of the app doing something nobody asked for.
 *   ON SCREEN   only a motion photo starts itself, because a motion photo IS its motion.
 *               A video was tapped once and has to be tapped again: scrolling back to a
 *               card is not a request to play what is on it.
 *
 * Exported for tests — the rule is worth pinning, and an IntersectionObserver is not
 * something a test can move a card past.
 */
export function onVisibility(video, visible) {
  if (!visible) {
    stop(video);
    return;
  }
  if (video.dataset.motion === 'true') play(video);
}

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) onVisibility(entry.target, entry.isIntersecting);
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
export function holdToTrim(video, { start, end }, onEnd, { loop = false } = {}) {
  if (!(end > start)) return;

  // NATIVE `loop` CANNOT EXPRESS A SUB-RANGE — it restarts the FILE — so when the caller
  // wants a loop it is done here, and the native one is turned off so the two cannot
  // fight. Without this a trimmed motion photo played its stretch once and stopped, which
  // is right for a clip asked to play and wrong for a photograph that moves.
  if (loop) video.loop = false;

  const atEnd = () => {
    if (loop) {
      video.currentTime = start;
      video.play().catch(() => {});
      return;
    }
    video.pause();
    video.currentTime = start; // ready to play again from the top of the trim
    if (onEnd) onEnd();
  };

  video.addEventListener('timeupdate', () => {
    if (video.currentTime >= end) atEnd();
  });
  // timeupdate fires only a few times a second, so a trim ending on the last frame can run
  // out before it is noticed. `ended` is the backstop.
  video.addEventListener('ended', atEnd);
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
      // Out of `playing` as well as paused: that set is what the tab resumes from when it
      // comes back to the front, and a clip stopped on purpose must stay stopped.
      playing.delete(video);
      video.pause();
      return;
    }
    badge.classList.add('is-playing');
    badge.setAttribute('aria-label', 'Pause');
    // Whatever else was audible gives way to the clip being started deliberately.
    silenceOthers(video);
    // play() settles a tick later, so `paused` is still true on the next line — the
    // rejection is the only honest signal that playback was refused.
    playFromTrim(video).catch(reset);
  });
}

/**
 * Turn a card's sound on or off.
 *
 * Muted is where every clip starts, and where the next one starts too: the setting belongs
 * to the video, not to the session. A parent who unmuted one memory has not asked the rest
 * of the timeline to make noise as they scroll past it.
 *
 * `muted` is set as a PROPERTY here, never the attribute. The attribute is what lets a
 * motion photo autoplay at all, and removing it from an element the browser has already
 * agreed to play is asking for that permission to be reconsidered.
 */
function wireSoundBadge(badge) {
  if (badge.dataset.wired) return;
  badge.dataset.wired = 'true';

  const box = badge.parentElement.querySelector('.crop-box');
  const video = box?.querySelector('video');
  if (!video) { badge.hidden = true; return; }

  const paint = () => {
    badge.classList.toggle('is-muted', video.muted);
    badge.setAttribute('aria-pressed', String(!video.muted));
    badge.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
  };

  badge.addEventListener('click', (e) => {
    // The badge sits over the picture, whose own tap opens the lightbox.
    e.stopPropagation();
    video.muted = !video.muted;
    if (!video.muted) {
      // Unmuting is the ask, so it is also the moment to play — pressing "sound on" and
      // watching a still frame stay still would read as the button being broken.
      silenceOthers(video);
      if (video.paused) playFromTrim(video).catch(() => {});
    }
    paint();
  });

  video.addEventListener('volumechange', paint);
  paint();
}

/**
 * Leave one video making noise, at most.
 *
 * Two clips talking over each other is nobody's idea of a scrapbook, and with sound the
 * mistake is much louder than with pictures. The others are muted rather than paused: a
 * parent who started one deliberately should not have it stopped from under them.
 */
function silenceOthers(keep) {
  for (const other of document.querySelectorAll('video[data-motion="false"]')) {
    if (other !== keep) other.muted = true;
  }
}

/**
 * Start a clip inside its trim, wherever it was left.
 * @returns {Promise<void>} rejects if the browser refuses, so callers can put the UI back
 */
function playFromTrim(video) {
  const trim = trimOf(video);
  if (trim && (video.currentTime < trim.start || video.currentTime >= trim.end)) {
    video.currentTime = trim.start;
  }
  playing.add(video);
  return video.play();
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
  root.querySelectorAll('.video-badge--sound').forEach(wireSoundBadge);
  root.querySelectorAll('.video-badge:not(.video-badge--motion):not(.video-badge--sound)')
    .forEach(wireBadge);

  // EVERY video, not just the looping ones. Watching only motion photos was what let a
  // tapped clip play on after its card had been scrolled away from.
  const videos = root.querySelectorAll('video');
  if (!videos.length) return;
  const io = ensureObserver();
  videos.forEach((video) => {
    // Only a loop needs the trim kept by hand; a video is held to it by holdToTrim, which
    // pauses at the end instead of going round again.
    if (video.dataset.motion === 'true') wireMotionTrim(video);
    io.observe(video);
  });
}

/** Release a card's videos when it leaves the timeline, so nothing decodes off-screen. */
export function releaseMotion(root) {
  if (!observer) return;
  root.querySelectorAll('video').forEach((video) => {
    observer.unobserve(video);
    playing.delete(video);
  });
}
