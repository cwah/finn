// The milestone sketch is generated, not authored, so the things worth pinning are:
// which subject a title picks, that the output is deterministic, and that nothing a
// parent types can escape into the markup.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { milestoneArt, artSubject } from '../js/milestone-art.js';

test('a short title spells itself out in blocks', () => {
  assert.equal(artSubject('Day one'), 'blocks'); // DAYONE — six letters
  assert.equal(artSubject('Crawl'), 'blocks');
});

test('a long title falls back to balloons', () => {
  assert.equal(artSubject('First steps'), 'balloons'); // FIRSTSTEPS — ten letters
  assert.equal(artSubject('First laugh'), 'balloons');
});

test('an empty or letterless title still draws something', () => {
  assert.equal(artSubject(''), 'balloons');
  assert.equal(artSubject(null), 'balloons');
  assert.equal(artSubject('123 !!'), 'balloons');
});

test('blocks draw one lettered cube per letter, punctuation ignored', () => {
  const svg = milestoneArt("Day one!");
  const glyphs = [...svg.matchAll(/>([A-Z])<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(glyphs, ['D', 'A', 'Y', 'O', 'N', 'E']);
});

test('the sketch is deterministic — same title, identical markup', () => {
  assert.equal(milestoneArt('Day one'), milestoneArt('Day one'));
  assert.equal(milestoneArt('First steps'), milestoneArt('First steps'));
});

test('different titles draw different block sketches', () => {
  assert.notEqual(milestoneArt('Crawl'), milestoneArt('Day one'));
});

test('output is a single svg carrying the band viewBox', () => {
  const svg = milestoneArt('Day one');
  assert.match(svg, /^<svg class="milestone-art" viewBox="0 0 560 78"/);
  assert.match(svg, /<\/svg>$/);
  assert.equal(svg.split('<svg').length - 1, 1);
});

test('it is monochrome — every stroke defers to currentColor', () => {
  for (const title of ['Day one', 'First steps']) {
    const svg = milestoneArt(title);
    assert.match(svg, /stroke="currentColor"/);
    // No literal colour anywhere, so the band's CSS is the only source of hue.
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}/i);
    assert.doesNotMatch(svg, /rgb\(/i);
  }
});

test('a title cannot inject markup — only [A-Z] reaches the text nodes', () => {
  const svg = milestoneArt('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(svg, /<img/);
  assert.doesNotMatch(svg, /onerror/);
  assert.ok(!svg.includes('alert'));
});

test('a quote-laden title cannot break out of an attribute', () => {
  const svg = milestoneArt('a" onload="evil()');
  assert.doesNotMatch(svg, /onload/);
  // Every quote in the output belongs to an attribute we wrote ourselves.
  assert.equal(svg.split('"').length % 2, 1);
});

test('generating art is pure — no shared state between calls', () => {
  const first = milestoneArt('Crawl');
  milestoneArt('Something else entirely');
  assert.equal(milestoneArt('Crawl'), first);
});
