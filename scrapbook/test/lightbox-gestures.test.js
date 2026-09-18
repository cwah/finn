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

test('a cancelled gesture is forgotten', () => {
  // THE BUG. Without this the start point survived, and the next pointerup was measured
  // from wherever a scroll happened to begin.
  assert.match(js, /addEventListener\('pointercancel', forget\)/);
});

test('the browser is told that sideways movement is ours', () => {
  // The other half. The stage scrolls; without this the gesture never reaches pointerup.
  assert.match(css, /\.lightbox-crop \{ touch-action: pan-y pinch-zoom; \}/);
});

test('a zoomed photo gets its panning back', () => {
  // Zoomed, a horizontal drag IS panning the picture, not a request for the next one.
  assert.match(css, /is-zoomed .lightbox-crop \{ touch-action: auto; \}/);
  assert.match(js, /stage\.classList\.contains\('is-zoomed'\) \? null :/);
});

test('a mostly-vertical drag does not page', () => {
  // Scrolling a tall photo would otherwise skip to the next memory.
  assert.match(js, /Math\.abs\(dx\) > 45 && Math\.abs\(dx\) > Math\.abs\(dy\)/);
});

test('a motion photo still has no transport bar', () => {
  // The badge replaces it; both together would be worse than either.
  assert.match(js, /video\.controls = !photo\.motion/);
  assert.match(js, /video\.loop = photo\.motion/);
});
