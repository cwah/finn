// Ordering and the arithmetic of the arrows. What breaks quietly here is direction:
// swapping older for newer still passes anything that only checks the index moved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  orderCollection, indexOfId, stepIndex, canStep, neighbourIndices,
} from '../js/collection.js';

const piece = (id, createdOn) => ({ id, createdOn });

const SOME = [
  piece('old', '2025-01-02'),
  piece('new', '2026-07-30'),
  piece('mid', '2026-03-14'),
];

test('the collection is ordered newest first, so index 0 is the landing page', () => {
  assert.deepEqual(orderCollection(SOME).map((a) => a.id), ['new', 'mid', 'old']);
});

test('two pieces made on the same day are ordered by id, not by their place in the file', () => {
  const sameDay = [piece('b', '2026-05-02'), piece('a', '2026-05-02')];
  assert.deepEqual(orderCollection(sameDay).map((a) => a.id), ['b', 'a']);
  assert.deepEqual(orderCollection([...sameDay].reverse()).map((a) => a.id), ['b', 'a']);
});

test('ordering does not modify the array it was given', () => {
  const input = [...SOME];
  orderCollection(input);
  assert.deepEqual(input.map((a) => a.id), ['old', 'new', 'mid']);
});

test('an id that is not in the collection reports -1 rather than 0', () => {
  const list = orderCollection(SOME);
  assert.equal(indexOfId(list, 'mid'), 1);
  assert.equal(indexOfId(list, 'never-drawn'), -1);
  assert.equal(indexOfId(list, null), -1);
});

test('stepping by +1 moves toward EARLIER work, which is later in the list', () => {
  assert.equal(stepIndex(0, 1, 3), 1);
  assert.equal(stepIndex(1, -1, 3), 0);
});

test('stepping clamps at both ends and never wraps around the collection', () => {
  // Wrapping would make "you have reached the beginning" a lie, and would leave the
  // arrows showing as available when they are not.
  assert.equal(stepIndex(2, 1, 3), 2);
  assert.equal(stepIndex(0, -1, 3), 0);
});

test('canStep agrees with stepIndex at the ends, since it is what dims the arrows', () => {
  assert.equal(canStep(0, -1, 3), false);   // already the newest
  assert.equal(canStep(0, 1, 3), true);
  assert.equal(canStep(2, 1, 3), false);    // already the oldest
  assert.equal(canStep(2, -1, 3), true);
});

test('a collection of one has nowhere to go in either direction', () => {
  assert.equal(canStep(0, 1, 1), false);
  assert.equal(canStep(0, -1, 1), false);
  assert.deepEqual(neighbourIndices(0, 1), []);
});

test('an empty collection does not throw and does not produce an index', () => {
  assert.equal(stepIndex(0, 1, 0), 0);
  assert.equal(canStep(0, 1, 0), false);
  assert.deepEqual(neighbourIndices(0, 0), []);
  assert.deepEqual(orderCollection(null), []);
});

test('neighbours are only the pieces either side, and never off the ends', () => {
  assert.deepEqual(neighbourIndices(1, 3), [0, 2]);
  assert.deepEqual(neighbourIndices(0, 3), [1]);
  assert.deepEqual(neighbourIndices(2, 3), [1]);
});
