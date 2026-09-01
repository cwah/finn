// Typing a moment in a clip.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTimecode, formatTimecode, settleTrim } from '../js/timecode.js';

// ── Reading what someone typed ────────────────────────────────────
test('plain seconds', () => {
  assert.equal(parseTimecode('12'), 12);
  assert.equal(parseTimecode('0'), 0);
});

test('minutes and seconds', () => {
  assert.equal(parseTimecode('1:04'), 64);
  assert.equal(parseTimecode('3:00'), 180);
  assert.equal(parseTimecode('10:30'), 630);
});

test('fractions, which is the whole point on a long clip', () => {
  // A three-minute video puts half a second behind every pixel of the bar. Tenths are
  // reachable by typing and by nothing else.
  assert.equal(parseTimecode('1:04.5'), 64.5);
  assert.equal(parseTimecode('12.25'), 12.25);
  assert.equal(parseTimecode('0:04.1'), 4.1);
});

test('the shapes people actually type', () => {
  assert.equal(parseTimecode(':30'), 30);
  assert.equal(parseTimecode(' 1:04 '), 64);
  assert.equal(parseTimecode('.5'), 0.5);
});

test('junk is null, NOT zero', () => {
  // Zero is a legitimate start time. Treating "abc" as "the beginning" would silently
  // rewrite a trim someone was midway through typing.
  assert.equal(parseTimecode('abc'), null);
  assert.equal(parseTimecode(''), null);
  assert.equal(parseTimecode('  '), null);
  assert.equal(parseTimecode('1:2:3'), null);
  assert.equal(parseTimecode('-5'), null);
  assert.equal(parseTimecode(null), null);
  assert.equal(parseTimecode(undefined), null);
});

// ── Writing it back ───────────────────────────────────────────────
test('formatting is minutes and tenths', () => {
  assert.equal(formatTimecode(64.5), '1:04.5');
  assert.equal(formatTimecode(5), '0:05.0');
  assert.equal(formatTimecode(180), '3:00.0');
  assert.equal(formatTimecode(0), '0:00.0');
});

test('seconds are always two digits, so the field does not jitter', () => {
  assert.match(formatTimecode(9.4), /^\d+:\d\d\.\d$/);
  assert.match(formatTimecode(61), /^\d+:\d\d\.\d$/);
});

test('a round trip survives', () => {
  for (const s of [0, 4.1, 12.25, 64.5, 180]) {
    const back = parseTimecode(formatTimecode(s));
    assert.ok(Math.abs(back - s) < 0.06, `${s} -> ${formatTimecode(s)} -> ${back}`);
  }
});

test('nonsense in never produces NaN out', () => {
  assert.equal(formatTimecode(NaN), '0:00.0');
  assert.equal(formatTimecode(-5), '0:00.0');
});

// ── Settling a typed pair ─────────────────────────────────────────
const D = { duration: 180 };

test('a legal pair is left alone', () => {
  assert.deepEqual(settleTrim({ start: 10, end: 20 }, D), { start: 10, end: 20 });
});

test('nothing escapes the clip', () => {
  assert.deepEqual(settleTrim({ start: -5, end: 999 }, D), { start: 0, end: 180 });
});

test('an end typed BEFORE the start moves the OTHER handle', () => {
  // A normal thing to type on the way to something valid. Fighting the keystroke would be
  // worse than holding the other end out of its way.
  const out = settleTrim({ start: 50, end: 20 }, { ...D, moved: 'end' });
  assert.ok(out.start <= out.end, 'must come out in order');
  assert.equal(out.end, 20, 'the handle being typed keeps its value');
});

test('and the same the other way round', () => {
  const out = settleTrim({ start: 100, end: 40 }, { ...D, moved: 'start' });
  assert.equal(out.start, 100, 'the handle being typed keeps its value');
  assert.ok(out.end >= out.start);
});

test('a minimum length is kept', () => {
  const out = settleTrim({ start: 10, end: 10 }, { ...D, minClip: 0.5, moved: 'start' });
  assert.ok(out.end - out.start >= 0.5 - 1e-9, `got ${out.end - out.start}`);
});

test('at the very end of a clip the start gives way instead', () => {
  // There is no room after 180s, so the only legal answer moves the start backwards.
  const out = settleTrim({ start: 180, end: 180 }, { ...D, minClip: 0.5, moved: 'start' });
  assert.ok(out.end <= 180);
  assert.ok(out.end - out.start >= 0.5 - 1e-9);
});

test('a clip shorter than the minimum degrades rather than inverting', () => {
  const out = settleTrim({ start: 0, end: 0.2 }, { duration: 0.2, minClip: 0.5 });
  assert.ok(out.start <= out.end);
  assert.ok(out.end <= 0.2);
});

test('no duration, no trim', () => {
  assert.deepEqual(settleTrim({ start: 1, end: 2 }, { duration: 0 }), { start: 0, end: 0 });
});
