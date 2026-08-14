// The milestone sketch is picked, not authored. What matters is that the choice is
// stable, that it always lands on a real preset, and that nothing a parent types can
// reach the drawing — the title decides WHICH stock sketch appears, never what it says.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ART_PRESETS, artPreset, milestoneArtSvg, artSide, assignSides,
  isBirthday, presetCandidates, assignPresets,
} from '../js/milestone-art.js';

const TITLES = ['First steps', 'Day one', 'First laugh', 'Crawling', 'First tooth', ''];

/** A title that prefers the dinosaur, so the pinned-artwork rules can be exercised.
 *  Not a fixed string in each test: which title hashes where moves whenever the preset
 *  set changes, and chasing that through a dozen assertions is noise. */
const DINO_TITLE = 'First word';

test('the preset list is the agreed set', () => {
  assert.deepEqual([...ART_PRESETS], [
    'balloons', 'cake', 'blocks', 'donuts', 'dinosaur',
  ]);
});

test('every title lands on a real preset', () => {
  for (const title of [...TITLES, null, undefined, '!!!', 'a'.repeat(200)]) {
    assert.ok(ART_PRESETS.includes(artPreset(title)), `${title} -> ${artPreset(title)}`);
  }
});

test('the choice is deterministic — the same title always draws the same sketch', () => {
  for (const title of TITLES) {
    assert.equal(artPreset(title), artPreset(title));
    assert.equal(milestoneArtSvg(artPreset(title)), milestoneArtSvg(artPreset(title)));
  }
});

test('different titles spread across the presets rather than piling on one', () => {
  const titles = [
    'First steps', 'Day one', 'First laugh', 'Crawling', 'First tooth',
    'First word', 'Rolled over', 'First haircut', 'Sat up', 'First swim',
    'Waved hello', 'Blew a kiss',
  ];
  const used = new Set(titles.map(artPreset));
  assert.ok(used.size >= 4, `only used ${used.size} presets: ${[...used].join(', ')}`);
});

test('every preset renders a single square svg', () => {
  for (const preset of ART_PRESETS) {
    const svg = milestoneArtSvg(preset);
    assert.match(svg, /^<svg class="milestone-art" viewBox="0 0 120 120"/, preset);
    assert.match(svg, /<\/svg>$/, preset);
    assert.equal(svg.split('<svg').length - 1, 1, preset);
    // Something is actually drawn.
    assert.ok(/<(path|circle|g)\b/.test(svg), `${preset} draws nothing`);
  }
});

test('an unknown preset falls back rather than rendering an empty frame', () => {
  const svg = milestoneArtSvg('unicorns');
  assert.equal(svg, milestoneArtSvg('balloons'));
});

test('the drawings are monochrome — every stroke defers to currentColor', () => {
  for (const preset of ART_PRESETS) {
    const svg = milestoneArtSvg(preset);
    assert.match(svg, /stroke="currentColor"/, preset);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}/i, preset);
    assert.doesNotMatch(svg, /rgb\(/i, preset);
  }
});

test('no title text reaches the drawing', () => {
  // The blocks preset is the only one with glyphs, and they are the fixed letters A B C.
  const glyphs = (svg) => [...svg.matchAll(/>([^<>]*)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(glyphs(milestoneArtSvg('blocks')), ['A', 'B', 'C']);
  for (const preset of ART_PRESETS.filter((p) => p !== 'blocks')) {
    assert.deepEqual(glyphs(milestoneArtSvg(preset)), [], preset);
  }
});

test('a title cannot inject markup, because it never reaches the svg at all', () => {
  const svg = milestoneArtSvg(artPreset('<img src=x onerror=alert(1)>'));
  assert.doesNotMatch(svg, /<img/);
  assert.doesNotMatch(svg, /onerror/);
  assert.ok(!svg.includes('alert'));
  // Whatever it picked is still one of the stock drawings, untouched.
  assert.ok(ART_PRESETS.some((p) => milestoneArtSvg(p) === svg));
});

// ── Birthdays ─────────────────────────────────────────────────────
test('a birthday is recognised however it is written', () => {
  for (const title of [
    'Birthday!', 'First birthday', 'Happy birthday Finn', "Finn's 1st birthday",
    'bday', 'B-day party', 'She turns one', 'Turned 2 today', 'One year old',
  ]) {
    assert.ok(isBirthday(title), `${title} should read as a birthday`);
  }
});

test('milestones that merely mention time are not birthdays', () => {
  // "Three months old" is a milestone, but spending the cake on it would leave nothing
  // for the real thing.
  for (const title of [
    'Three months old', 'First steps', 'Rolled over', 'First tooth',
    'Day one', 'Sat up', 'First swim',
  ]) {
    assert.equal(isBirthday(title), false, `${title} should not read as a birthday`);
  }
});

test('a birthday only ever gets cake or balloons', () => {
  for (const title of ['Birthday!', 'First birthday', 'bday', 'One year old', 'Turns two']) {
    const candidates = presetCandidates(title);
    assert.deepEqual([...candidates].sort(), ['balloons', 'cake'], title);
    assert.ok(['cake', 'balloons'].includes(artPreset(title)), title);
  }
});

test('the same birthday always prefers the same one of the two', () => {
  assert.equal(artPreset('First birthday'), artPreset('First birthday'));
});

test('adjacent birthdays take different drawings rather than repeating', () => {
  const [a, b] = assignPresets(['First birthday', 'First birthday']);
  assert.notEqual(a, b);
  assert.ok(['cake', 'balloons'].includes(a));
  assert.ok(['cake', 'balloons'].includes(b));
});

// ── Never twice in a row ──────────────────────────────────────────
test('a drawing never repeats on adjacent milestones', () => {
  // Titles that all prefer the same drawing on their own.
  const sameChoice = ART_PRESETS.map(() => DINO_TITLE); // all prefer the same drawing
  const presets = assignPresets(sameChoice);
  for (let i = 1; i < presets.length; i += 1) {
    assert.notEqual(presets[i], presets[i - 1], `repeat at ${i}: ${presets}`);
  }
});

test('dinosaurs specifically never appear twice in a row', () => {
  assert.equal(artPreset(DINO_TITLE), 'dinosaur', 'fixture should prefer dinosaur');
  const presets = assignPresets([DINO_TITLE, DINO_TITLE, DINO_TITLE]);
  assert.equal(presets[0], 'dinosaur');
  assert.notEqual(presets[1], 'dinosaur');
  assert.equal(presets.filter((p, i) => p === 'dinosaur' && presets[i - 1] === 'dinosaur').length, 0);
});

test('a milestone keeps its own preference when it does not clash', () => {
  const titles = [DINO_TITLE, 'First steps', 'First laugh'];
  assert.deepEqual(assignPresets(titles), titles.map(artPreset));
});

test('inserting a milestone may change its neighbours — the documented trade', () => {
  const before = assignPresets([DINO_TITLE, DINO_TITLE]);
  const after = assignPresets([DINO_TITLE, 'First steps', DINO_TITLE]);
  assert.notEqual(before[1], after[2], 'the later one is free to prefer dinosaur again');
  assert.equal(after[2], 'dinosaur');
});

test('assigning presets copes with empty and malformed input', () => {
  assert.deepEqual(assignPresets([]), []);
  assert.deepEqual(assignPresets(null), []);
  assert.ok(ART_PRESETS.includes(assignPresets([undefined])[0]));
});

// ── Which side the artwork takes ──────────────────────────────────
test('pinned artwork always gets the side it asked for', () => {
  assert.equal(artSide('dinosaur'), 'right');
  for (const sides of [
    assignSides(['dinosaur']),
    assignSides(['balloons', 'dinosaur']),
    assignSides(['balloons', 'cake', 'dinosaur']),
    assignSides(['dinosaur', 'dinosaur']),
  ]) {
    assert.ok(sides.every((s) => s === 'left' || s === 'right'), 'every side is valid');
  }
  assert.deepEqual(assignSides(['dinosaur']), ['right']);
  assert.equal(assignSides(['balloons', 'cake', 'dinosaur'])[2], 'right');
  assert.equal(assignSides(['cake', 'dinosaur'])[1], 'right');
});

test('unpinned artwork has no side of its own', () => {
  for (const preset of ART_PRESETS.filter((p) => p !== 'dinosaur')) {
    assert.equal(artSide(preset), null, preset);
  }
});

test('unpinned artwork alternates', () => {
  assert.deepEqual(
    assignSides(['balloons', 'cake', 'blocks', 'donuts']),
    ['right', 'left', 'right', 'left'],
  );
});

test('alternation resumes from whichever side a pinned piece took', () => {
  // dinosaur pins right, so the next unpinned one must go left rather than blindly
  // continuing an index-based stripe.
  assert.deepEqual(assignSides(['dinosaur', 'cake']), ['right', 'left']);
  assert.deepEqual(assignSides(['cake', 'dinosaur', 'cake']), ['right', 'right', 'left']);
});

test('two pinned neighbours share a side — the documented limit', () => {
  // Fixed artwork on the same side can overlap when both are visible. Nothing here can
  // prevent that; the point is that it is a consequence of pinning, not a bug.
  assert.deepEqual(assignSides(['dinosaur', 'dinosaur']), ['right', 'right']);
});

test('assigning sides copes with unknown or missing presets', () => {
  assert.deepEqual(assignSides([]), []);
  assert.deepEqual(assignSides(null), []);
  assert.deepEqual(assignSides([undefined, 'nope']), ['right', 'left']);
});

test('generating art is pure — no shared state between calls', () => {
  const first = milestoneArtSvg('cake');
  milestoneArtSvg('dinosaur');
  assert.equal(milestoneArtSvg('cake'), first);
});
