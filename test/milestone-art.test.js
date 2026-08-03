// The milestone sketch is picked, not authored. What matters is that the choice is
// stable, that it always lands on a real preset, and that nothing a parent types can
// reach the drawing — the title decides WHICH stock sketch appears, never what it says.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ART_PRESETS, artPreset, milestoneArtSvg } from '../js/milestone-art.js';

const TITLES = ['First steps', 'Day one', 'First laugh', 'Crawling', 'First tooth', ''];

test('the preset list is the agreed set', () => {
  assert.deepEqual([...ART_PRESETS], [
    'balloons', 'cake', 'blocks', 'donuts', 'dinosaur', 'lemons',
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

test('generating art is pure — no shared state between calls', () => {
  const first = milestoneArtSvg('cake');
  milestoneArtSvg('dinosaur');
  assert.equal(milestoneArtSvg('cake'), first);
});
