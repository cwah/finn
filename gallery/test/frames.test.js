// Which frame a drawing hangs in.
//
// The test that matters most is the last one: adding a new drawing must not change
// what any older piece hangs in. If that regresses, every link anyone has shared
// quietly starts showing a different frame, and nothing else in the suite notices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES, FRAME_IDS, frameCandidates, frameFor, assignFrames } from '../js/frames.js';

const piece = (id, orientation = 'portrait', frame = null) => ({ id, orientation, frame });

test('a given drawing always lands on the same frame', () => {
  assert.equal(frameFor(piece('the-long-cat')), frameFor(piece('the-long-cat')));
  assert.equal(frameFor(piece('a', 'landscape')), frameFor(piece('a', 'landscape')));
});

test('every candidate list is non-empty and names only frames that exist', () => {
  for (const orientation of ['portrait', 'landscape', 'square', 'nonsense']) {
    const candidates = frameCandidates('some-id', orientation);
    assert.ok(candidates.length > 0);
    for (const id of candidates) assert.ok(id in FRAMES, `${id} is not a frame`);
  }
});

test('every frame stays reachable, so the sequencer always has somewhere to go', () => {
  // Frames that do not suit the orientation are demoted, never dropped. Dropping them
  // is how a run of same-orientation pieces would end up with no legal choice.
  const candidates = frameCandidates('x', 'landscape');
  assert.equal(candidates.length, FRAME_IDS.length);
  assert.deepEqual([...candidates].sort(), [...FRAME_IDS].sort());
});

test('frames that suit the orientation are offered before ones that do not', () => {
  // baroque does not suit a landscape piece, so it must not be the first offer.
  assert.notEqual(frameCandidates('anything', 'landscape')[0], 'baroque');
});

test('a dozen drawings use most of the set rather than clustering on one frame', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `piece-${i}`);
  const chosen = assignFrames(ids.map((id, i) =>
    piece(id, ['portrait', 'landscape', 'square'][i % 3])));
  assert.ok(new Set(chosen).size >= 4, `only used ${new Set(chosen).size} frames`);
});

test('no two drawings next to each other in the collection share a frame', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const chosen = assignFrames(ids.map((id, i) =>
    piece(id, ['portrait', 'landscape', 'square'][i % 3])));
  for (let i = 1; i < chosen.length; i += 1) {
    assert.notEqual(chosen[i], chosen[i - 1], `repeat at ${i}`);
  }
});

test('a frame named in the manifest is honoured even when it repeats its neighbour', () => {
  // An override is an instruction, not a suggestion — someone wrote it down on purpose.
  const chosen = assignFrames([piece('a', 'portrait', 'walnut'), piece('b', 'portrait', 'walnut')]);
  assert.deepEqual(chosen, ['walnut', 'walnut']);
});

test('a frame named in the manifest that does not exist falls back instead of throwing', () => {
  const chosen = assignFrames([piece('a', 'portrait', 'mahogany-deluxe')]);
  assert.ok(chosen[0] in FRAMES);
});

test('adding a new drawing does not change the frame of any drawing already hung', () => {
  // assignFrames runs OLDEST first precisely so this holds. Reverse that order and
  // this is the test that fails — see the comment on assignFrames.
  const existing = Array.from({ length: 9 }, (_, i) =>
    piece(`p${i}`, ['portrait', 'landscape', 'square'][i % 3]));
  const before = assignFrames(existing);
  const after = assignFrames([...existing, piece('brand-new', 'square')]);
  assert.deepEqual(after.slice(0, before.length), before);
});

test('missing, null and empty ids pick a real frame rather than throwing', () => {
  for (const id of [undefined, null, '']) {
    assert.ok(frameFor(piece(id)) in FRAMES);
  }
  assert.deepEqual(assignFrames(null), []);
  assert.deepEqual(assignFrames(undefined), []);
});
