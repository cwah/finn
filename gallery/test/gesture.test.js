// Drag to page turn. The direction is the thing worth pinning: it is the opposite of
// what the sign of dx suggests, and a swap would pass any test that only checks
// "something happened".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swipeIntent } from '../js/gesture.js';

test('dragging right reveals what lies to the left, which is the EARLIER work', () => {
  assert.equal(swipeIntent(120, 4, 200), 1);
});

test('dragging left moves toward later work', () => {
  assert.equal(swipeIntent(-120, 4, 200), -1);
});

test('a tap is not a swipe', () => {
  assert.equal(swipeIntent(0, 0, 90), 0);
});

test('a short drag is a wobble, not a page turn', () => {
  assert.equal(swipeIntent(30, 2, 150), 0);
  assert.equal(swipeIntent(44, 0, 150), 0);
  assert.equal(swipeIntent(46, 0, 150), 1);
});

test('a mostly vertical drag is a scroll, even when it travels far sideways', () => {
  assert.equal(swipeIntent(60, 200, 250), 0);
});

test('a slow drag is someone repositioning their finger, not swiping', () => {
  assert.equal(swipeIntent(200, 0, 900), 0);
  assert.equal(swipeIntent(200, 0, 690), 1);
});

test('nonsense measurements do not turn the page', () => {
  for (const args of [[NaN, 0, 100], [100, NaN, 100], [100, 0, NaN], [undefined, undefined, undefined]]) {
    assert.equal(swipeIntent(...args), 0);
  }
});
