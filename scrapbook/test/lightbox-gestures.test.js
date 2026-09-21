// Opening a photo, and moving between them.
//
//   npm test
//
// Three things reported at once, all about the expanded view:
//
//   the play badge sat in the corner of the SCREEN rather than on the picture
//   the previous arrow opened wearing a focus ring, looking selected for no reason
//   swiping between photos did nothing on a phone
//
// The swipe is the interesting one. The code was there and correct; the stage scrolls, so
// the browser claimed a horizontal drag for itself and ended the gesture with
// `pointercancel` — an event nothing listened for, which also left the start point set so
// the NEXT gesture was measured from a stale one. The fix is half CSS (`touch-action`
// tells the browser that sideways movement over the picture is ours) and half here.
//
// Structural, because the behaviour was verified in a real browser against the preview
// bench — swipe, reverse swipe, a vertical drag, and a cancelled gesture, on a group of
// six. What these guard is that the pieces stay wired that way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../js/lightbox.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/lightbox.css', import.meta.url), 'utf8');

test('the badge is on the picture, not the viewport', () => {
  // Inside .lightbox-crop, which IS the visible photograph — and a sibling of the rotor,
  // never a child, because the rotor is what turns.
  assert.match(js, /<div class="rotor"><\/div>\s*(<!--[\s\S]*?-->\s*)?<button[^>]*lightbox-motion/);
  assert.match(css, /\.lightbox-motion \{[^}]*position: absolute/);
  assert.doesNotMatch(css, /\.lightbox-motion \{[^}]*position: fixed/);
});

test('the badge sits in the lower-right, where the card puts it', () => {
  const rule = css.match(/\.lightbox-motion \{[^}]*\}/)[0];
  assert.match(rule, /right:/);
  assert.match(rule, /bottom:/);
});

test('nothing opens wearing a focus ring', () => {
  // showModal focuses the first focusable descendant, which was the previous arrow.
  // Focus has to land somewhere for arrow keys and Escape, so it goes to the container.
  assert.match(js, /stage\.focus\(\{ preventScroll: true \}\)/);
  assert.match(js, /class="lightbox-stage" tabindex="-1"/);
  assert.match(css, /\.lightbox-stage:focus \{ outline: none; \}/);
});

test('a cancelled gesture is forgotten, and the picture put back', () => {
  // Without this the start point survived and the next pointerup was measured from
  // wherever a scroll began. Now it must also return the track, or the photograph is left
  // hanging half off the screen.
  assert.match(js, /addEventListener\('pointercancel',[\s\S]{0,160}settleTrack\(box, 0, \{ animate: true \}\)/);
});

test('the browser is told that sideways movement is ours', () => {
  // The other half. The stage scrolls; without this the gesture never reaches pointerup.
  assert.match(css, /\.lightbox-crop \{ touch-action: pan-y pinch-zoom; \}/);
});

test('a zoomed photo gets its panning back', () => {
  // Zoomed, a horizontal drag IS panning the picture, not a request for the next one.
  assert.match(css, /is-zoomed[^{]*\.lightbox-crop \{ touch-action: auto; \}/);
  assert.match(css, /is-zoomed .lightbox-track \{ transform: none; \}/);
  // And the gesture never starts in the first place.
  assert.match(js, /if \(stage\.classList\.contains\('is-zoomed'\)\) return;/);
});

test('a mostly-vertical drag is a scroll, and is let go of', () => {
  // Decided once, as soon as the direction is obvious, rather than at the end: a drag that
  // has been claimed as a scroll must stop moving the picture immediately.
  assert.match(js, /if \(Math\.abs\(dy\) > Math\.abs\(dx\)\) \{ drag = null; return; \}/);
});

test('a motion photo still has no transport bar', () => {
  // The badge replaces it; both together would be worse than either.
  assert.match(js, /video\.controls = !photo\.motion/);
  assert.match(js, /video\.loop = photo\.motion/);
});

// ── The picture follows the finger ────────────────────────────────
// The swipe used to be a threshold: nothing moved until you let go, and then a transition
// played. The backlog asked for the photo to follow the swipe instead, which needs the
// neighbours already on screen — so the lightbox is a track of three panes that slides,
// rather than one crop box that is replaced.
//
// Verified in a browser against the preview bench on a group of six: the track follows
// part-way through a drag, a real drag advances, a small wobble springs back, a vertical
// drag is let go of as a scroll, and a dot jumps straight to its photo.

test('there are three panes: the photo, and the one either side', () => {
  assert.match(js, /data-pane="-1"/);
  assert.match(js, /data-pane="0"/);
  assert.match(js, /data-pane="1"/);
});

test('the track moves with the finger, not after it', () => {
  // settleTrack on every pointermove, with no transition — the transition class is only
  // added when letting go. A transition during the drag is exactly the lag this replaced.
  assert.match(js, /addEventListener\('pointermove'[\s\S]{0,700}settleTrack\(box, blocked/);
  assert.match(js, /track\.classList\.toggle\('is-settling', animate\)/);
  assert.match(css, /\.lightbox-track\.is-settling \{\s*transition: transform/);
});

test('a neighbour does not start playing', () => {
  // Three decoders for one photograph, and sound from a clip nobody is watching.
  assert.match(js, /video\.autoplay = active/);
  assert.match(js, /fillRotor\(rotor, photo, offset === 0\)/);
});

test('the ends resist instead of sliding into nothing', () => {
  // There is no photo beyond the last, so the drag answers the finger but obviously is
  // not going anywhere.
  assert.match(js, /const blocked = \(wanted > 0 && !group\[index - 1\]\)/);
  assert.match(js, /blocked \? wanted \* 0\.25 : wanted/);
});

test('a flick has to be a real movement', () => {
  // At 12px anything quick counted, so a thumb that slipped a few pixels changed the
  // photograph — caught in the browser, where a 30px drag advanced it.
  assert.match(js, /Math\.abs\(dx\) > 40 && Math\.abs\(dx\) \/ elapsed > 0\.4/);
});

test('a tap is not a swipe', () => {
  // Below the movement threshold nothing should happen at all, or every tap nudges.
  assert.match(js, /if \(!drag\.moving\) \{ drag = null; return; \}/);
});

test('dots say which photo this is, and jump to it', () => {
  assert.match(js, /dot\.className = 'lightbox-dot'/);
  assert.match(js, /dot\.addEventListener\('click', \(\) => \{ index = i; render\(\); \}\)/);
  assert.match(css, /\.lightbox-dot\.is-on/);
});

test('too many photos fall back to a count', () => {
  // A row of twenty specks is not an indicator.
  assert.match(js, /group\.length <= 12/);
});

test('the dots are bigger than they look', () => {
  // 8px is not a touch target; the ring around it is.
  assert.match(css, /\.lightbox-dot::before[\s\S]{0,140}width: 32px/);
});

// ── Two bugs the first version shipped with ───────────────────────
// Reported as "no finger following" and "the last image is skipped". They were separate
// faults that looked like one, and the browser test that passed had checked the DOT index
// rather than which photograph was actually on screen — so both went out.

test('the track is offset by a whole pane, so the middle one is in the middle', () => {
  // THE FIRST BUG. Three panes sit side by side; the one being looked at is the second,
  // so the track has to start one pane-width to the left. Positioned from zero it showed
  // whichever pane came first — the PREVIOUS photo, as soon as there was one.
  // The `- 1` is the part that matters: the step width gained the padding later, and the
  // offset has to keep pace with it or the two disagree by 32px a photo.
  assert.match(css, /translate3d\(\s*calc\(\(var\(--slide, 0\) - 1\) \*/);
});

test('an end pane keeps its place in the track', () => {
  // And the reason the bug only appeared after the first photo: hiding the empty pane took
  // it out of flow, which shifted everything after it and accidentally looked correct at
  // photo one. It is emptied now, never removed.
  assert.doesNotMatch(css, /\.lightbox-pane\[hidden\] \{ display: none; \}/);
  assert.doesNotMatch(js, /pane\.hidden = !photo/);
});

test('the swipe commit is absolute, and cancellable', () => {
  // THE SECOND BUG. `index += dir` inside the settle was a second edit applied later to
  // whatever index had become — so two quick swipes, or a swipe then an arrow, applied
  // both and skipped a photograph. The destination is decided when the gesture ends.
  assert.match(js, /const target = index \+ dir;/);
  assert.match(js, /commitTimer = window\.setTimeout\(\(\) => \{ index = target; render\(\); \}/);
  // Comments explain the fix and would otherwise match it.
  const code = js.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /index \+= dir/);
});

test('anything that changes the photo cancels a pending settle', () => {
  // An arrow or a dot tapped mid-settle is the new truth; the old commit must not land on
  // top of it a moment later.
  assert.match(js, /function render\(\) \{[\s\S]{0,260}window\.clearTimeout\(commitTimer\)/);
});

test('the whole stage accepts the gesture, not only the picture', () => {
  // touch-action has to be on the element the finger starts on AND its scrolling ancestor.
  // On the crop alone, a swipe beginning in the space around a photo was claimed by the
  // browser — which is most of the screen on a phone.
  assert.match(css, /\.lightbox-stage,\s*\n\.lightbox-crop \{ touch-action: pan-y pinch-zoom; \}/);
});

// ── A video is still a picture to swipe ───────────────────────────
// REPORTED: swiping did nothing on videos or motion photos. The gesture excluded `video`
// outright, so that controls would own their own taps — but on a post of clips the picture
// IS the video, leaving nowhere to start the gesture at all.

test('a swipe may start on the media', () => {
  assert.doesNotMatch(js, /closest\('button, video'\)/);
  assert.match(js, /if \(e\.target\.closest\('button'\)\) return;/);
});

test('only the control bar is left to the browser', () => {
  // Where a sideways drag is scrubbing rather than paging. Everything above it is a
  // photograph.
  assert.match(js, /if \(media && media\.controls\)/);
  assert.match(js, /e\.clientY > box2\.bottom - CONTROL_BAR/);
});

test('a motion photo is swipeable all over, having no controls', () => {
  // It is a still that moves; there is nothing to scrub.
  assert.match(css, /\.lightbox-crop video:not\(\[controls\]\) \{ touch-action: pan-y pinch-zoom; \}/);
});

// ── Nothing of the neighbours shows ───────────────────────────────
// The panes either side sit one PANE-width away, and a pane is the width of the stage's
// CONTENT — so each neighbour stopped short of the screen edge by exactly the stage's
// padding, and its edge showed there. The dots say there are others; their edges do not
// need to.

test('a pane step is a whole screen, padding included', () => {
  // Measured at 1200px against a 1200px stage. If the step and the screen disagree, the
  // picture either lags the finger or overshoots it.
  assert.match(css, /--lb-pad:/);
  assert.match(css, /gap: calc\(var\(--lb-pad\) \* 2\)/);
  assert.match(css, /\(var\(--slide, 0\) - 1\) \* \(100% \+ \(var\(--lb-pad\) \* 2\)\)/);
});

test('the padding is written once and reused', () => {
  // A literal 16px in the transform and a different one in the padding would put the
  // neighbours back on screen, silently.
  assert.match(css, /padding: calc\(env\(safe-area-inset-top\) \+ 56px\) var\(--lb-pad\)/);
});

test('the stage clips instead of scrolling sideways', () => {
  // The track is three panes wide; `auto` let the neighbours be scrolled to as well as
  // seen. Zoomed, the photograph really is bigger than the screen and scrolling is the
  // point, so it comes back then.
  assert.match(css, /\.lightbox-stage \{[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.lightbox-stage\.is-zoomed \{\s*overflow: auto;\s*\}/);
});
