// Looping a motion photo inside its trim.
//
//   npm test
//
// A motion photo is the one thing on a card that plays by itself, and it is the one place
// the trim was never enforced: `holdToTrim` pauses at the end, which is right for a video
// asked to play once and wrong for a loop, and native `loop` restarts the FILE. So a
// trimmed motion photo played the whole take and the trim looked as though it had never
// saved.
//
// Tested against a stub element rather than in a browser, deliberately. What matters is
// the rule — where playback is allowed to be — and a stub can be driven to the exact
// instant that matters instead of waiting for a real decoder to arrive there.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wireMotionTrim, markOnScreen, onVisibility } from '../js/motion-play.js';

/** The slice of <video> this rule touches, and nothing else. */
function fakeVideo({ trimStart = 0.8, trimEnd = 1.8, duration = 2.334 } = {}) {
  const listeners = new Map();
  return {
    dataset: {
      motion: 'true',
      ...(trimStart == null ? {} : { trimStart: String(trimStart) }),
      ...(trimEnd == null ? {} : { trimEnd: String(trimEnd) }),
    },
    duration,
    currentTime: 0,
    paused: true,
    loop: true, // as the renderer sets it for a motion photo
    playCount: 0,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    play() { this.paused = false; this.playCount += 1; return Promise.resolve(); },
    pause() { this.paused = true; },
    /** Drive the element to a moment and let it tell its listeners. */
    advanceTo(t) {
      this.currentTime = t;
      for (const fn of listeners.get('timeupdate') || []) fn();
    },
    fire(type) { for (const fn of listeners.get(type) || []) fn(); },
    has(type) { return (listeners.get(type) || []).length > 0; },
  };
}

test('native loop is turned off — it cannot express a sub-range', () => {
  // The whole reason the trim did nothing: `loop` restarts the file, not the trim.
  const v = fakeVideo();
  wireMotionTrim(v);
  assert.equal(v.loop, false);
});

test('reaching the end of the trim goes back to its start', () => {
  const v = fakeVideo();
  wireMotionTrim(v);
  markOnScreen(v);
  v.advanceTo(1.81);
  assert.equal(v.currentTime, 0.8);
});

test('and keeps playing — a loop goes round, it does not stop', () => {
  // This is the difference from holdToTrim, which pauses. A motion photo that stopped
  // after one pass would be a video with extra steps.
  const v = fakeVideo();
  wireMotionTrim(v);
  markOnScreen(v);
  v.advanceTo(1.9);
  assert.equal(v.playCount, 1);
});

test('it never runs past the trim end', () => {
  const v = fakeVideo();
  wireMotionTrim(v);
  markOnScreen(v);
  const seen = [];
  for (const t of [0.9, 1.2, 1.5, 1.79, 1.82, 1.0, 1.85]) {
    v.advanceTo(t);
    seen.push(v.currentTime);
  }
  assert.ok(seen.every((t) => t <= 1.8), `stayed inside the trim, saw ${seen.join(', ')}`);
});

test('running out of file rewinds too', () => {
  // timeupdate fires a few times a second, so a trim ending on the last frame can run out
  // before it is noticed. `ended` is the backstop.
  const v = fakeVideo({ trimEnd: 2.334 });
  wireMotionTrim(v);
  markOnScreen(v);
  v.currentTime = 2.334;
  v.fire('ended');
  assert.equal(v.currentTime, 0.8);
});

test('seeking behind the start is pulled back into range', () => {
  const v = fakeVideo();
  wireMotionTrim(v);
  v.currentTime = 0.2;
  v.fire('seeking');
  assert.equal(v.currentTime, 0.8);
});

test('an untrimmed motion photo is left entirely alone', () => {
  // trimEnd 0 means "to the end" — there is no sub-range, so native loop is the right
  // mechanism and nothing here should interfere with it.
  const v = fakeVideo({ trimStart: 0, trimEnd: 0 });
  wireMotionTrim(v);
  assert.equal(v.loop, true, 'native loop should still do the work');
  assert.equal(v.has('timeupdate'), false);
});

test('a backwards trim is not a trim', () => {
  const v = fakeVideo({ trimStart: 1.5, trimEnd: 0.5 });
  wireMotionTrim(v);
  assert.equal(v.loop, true);
});

test('wiring twice does not stack a second set of listeners', () => {
  // initMotion is explicitly safe to call again on the same card, and re-running the
  // observer over an already-wired video must not double every rewind.
  const v = fakeVideo();
  wireMotionTrim(v);
  wireMotionTrim(v);
  markOnScreen(v);
  v.advanceTo(1.9);
  assert.equal(v.playCount, 1, 'one rewind, not two');
});


// ── Scrolling away ────────────────────────────────────────────────
// Both kinds stop when they leave the screen. Only one of them starts again by itself,
// and the difference is what keeps a tapped clip from replaying every time it is scrolled
// back to.

/** Enough of a <video> for the visibility rule, with the kind it is. */
function onCard({ motion = false, playing = false } = {}) {
  const v = fakeVideo();
  v.dataset.motion = motion ? 'true' : 'false';
  v.paused = !playing;
  v.muted = !playing; // a clip someone started with sound is the interesting case
  return v;
}

test('a video that scrolls out of view stops', () => {
  // THE BUG. Only motion photos were watched, so a tapped clip played on — and since
  // sound arrived, talked on — from a card no longer on screen.
  const v = onCard({ playing: true });
  onVisibility(v, false);
  assert.equal(v.paused, true);
});

test('and goes silent with it', () => {
  // A clip that is not playing is muted, without exception: one left unmuted and paused
  // just off screen would speak the moment anything started it again, which is the
  // surprise the muted default exists to prevent.
  const v = onCard({ playing: true });
  onVisibility(v, false);
  assert.equal(v.muted, true);
});

test('scrolling BACK does not start it again', () => {
  // Coming into view is not a request to play. Restarting here would make a video
  // impossible to leave paused, and would undo the tap that stopped it.
  const v = onCard();
  onVisibility(v, true);
  assert.equal(v.paused, true);
  assert.equal(v.playCount, 0);
});

test('a motion photo does start itself when it comes into view', () => {
  // It IS its motion — one that never moved would just be a photo.
  const v = onCard({ motion: true });
  onVisibility(v, true);
  assert.equal(v.playCount, 1);
});

test('a motion photo stops when it leaves, like everything else', () => {
  const v = onCard({ motion: true, playing: true });
  onVisibility(v, false);
  assert.equal(v.paused, true);
});
