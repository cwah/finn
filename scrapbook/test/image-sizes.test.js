// Asking for a picture the size the screen can show.
//
//   npm test
//
// Every photo on the timeline was fetched at 1280px regardless of what was displaying it.
// A phone card is around 390 CSS px wide; at 2x that is 780 device pixels, so most of a
// megapixel was going to the device least able to afford it — and paid for again in
// hosting, which is what brought this up.
//
// The browser chooses, given candidates and the width the picture will occupy. Getting
// `sizes` wrong is what makes srcset pointless: without it a browser assumes the image
// fills the viewport and takes the largest candidate, which is the behaviour being fixed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

import { cardSrcset, cardSizes, CARD_WIDTHS } from '../js/image-sizes.js';

const photo = (over = {}) => ({
  cardUrl: '/api/files/p/1/a.jpg?thumb=1280x1280f',
  cardSet: {
    640: '/api/files/p/1/a.jpg?thumb=640x640f',
    960: '/api/files/p/1/a.jpg?thumb=960x960f',
    1280: '/api/files/p/1/a.jpg?thumb=1280x1280f',
  },
  ...over,
});

test('every candidate is offered, with its real width', () => {
  const set = cardSrcset(photo());
  for (const w of CARD_WIDTHS) {
    assert.match(set, new RegExp(`thumb=${w}x${w}f ${w}w`), `${w} should be offered`);
  }
});

test('the widths match the sizes the server was told to generate', () => {
  // A size PocketBase was not told about is not an error — it silently serves the
  // ORIGINAL. So an srcset naming an undeclared width would quietly do the opposite of
  // what it is for.
  const migration = new URL('../pb_migrations/1757100000_bandwidth_thumbs.js', import.meta.url);
  const src = require('node:fs').readFileSync(migration, 'utf8');
  for (const w of CARD_WIDTHS) {
    if (w === 1280) continue;   // declared by the earlier thumbnail migration
    assert.match(src, new RegExp(`'${w}x${w}f'`), `${w}x${w}f must be declared`);
  }
});

test('a source with no thumbnailer offers nothing rather than a broken set', () => {
  // The mock has one file at one size. A single-candidate srcset buys nothing and an
  // srcset of missing URLs would be worse than none.
  assert.equal(cardSrcset(photo({ cardSet: null })), null);
  assert.equal(cardSrcset({}), null);
  assert.equal(cardSrcset(null), null);
});

test('a partial set still works, as long as there is a choice', () => {
  const set = cardSrcset(photo({ cardSet: { 640: '/a', 1280: '/b' } }));
  assert.equal(set, '/a 640w, /b 1280w');
});

test('one candidate alone is not a choice', () => {
  assert.equal(cardSrcset(photo({ cardSet: { 960: '/only' } })), null);
});

// ── sizes ─────────────────────────────────────────────────────────

test('a lone photo is the full width of a narrow screen, capped on a wide one', () => {
  const sizes = cardSizes(1);
  assert.match(sizes, /100vw/);
  assert.match(sizes, /560px/);
});

test('a photo sharing a card says it is narrower', () => {
  // THE POINT. Two across on a phone is ~195 CSS px, which at 2x wants 640 rather than
  // 960 — another step down, on the photos that come in pairs and threes.
  const two = cardSizes(2);
  assert.match(two, /50vw/);
  assert.match(two, /280px/);
  const three = cardSizes(3);
  assert.match(three, /33vw/);
});

test('a nonsense share is treated as the whole card', () => {
  // Being wrong towards a larger picture is a slower page; being wrong towards a smaller
  // one is a blurry memory.
  for (const odd of [0, -1, 1.5, null, undefined, 'two', NaN]) {
    assert.equal(cardSizes(odd), cardSizes(1), String(odd));
  }
});

test('the breakpoint matches the one the card is actually capped at', () => {
  // 560px is the card's own maximum; a `sizes` that disagreed with the stylesheet would
  // send the browser after the wrong candidate on every desktop view.
  assert.ok(cardSizes(1).includes('560px'));
});
