// Typing a trim time, without the trim moving under you.
//
//   npm test
//
// THE BUG. The typed start/end fields applied their value on every `input` event. Clearing
// the end field to retype it walks through the intermediate strings, and TWO of them parse
// to zero:
//
//     "0:12" -> 12      the value that was there
//     "0:1"  -> 1
//     "0:"   -> 0       <- still a valid parse
//     ""     -> null    only now is it refused
//
// So by the third backspace the end was 0, the minimum-clip rule dragged the START down to
// 0 to keep the window valid, and the trim someone had already set was gone before they
// typed the first digit of its replacement. Typing forwards did the same in miniature:
// entering "30" applied 3 on the way past.
//
// The fix is not a cleverer parse — every one of those strings IS a valid timecode. It is
// that a half-typed field is not a request. Values are read on blur or Enter, and the
// maximum-length rule is applied then too, for the same reason: enforcing a maximum
// against a number someone is halfway through typing fights them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseTimecode, settleTrim } from '../js/timecode.js';

const MIN_CLIP = 0.5;
const DURATION = 120;

/** Apply one field value the way the editor does on commit. */
function apply(trim, which, text) {
  const typed = parseTimecode(text);
  if (typed === null) return trim;   // cleared or unreadable: nothing moves
  const wanted = which === 'start'
    ? { start: typed, end: trim.end }
    : { start: trim.start, end: typed };
  return settleTrim(wanted, { duration: DURATION, minClip: MIN_CLIP, moved: which });
}

/** Every intermediate string as a field is cleared one backspace at a time. */
const backspaces = (text) => {
  const steps = [];
  for (let i = text.length; i >= 0; i -= 1) steps.push(text.slice(0, i));
  return steps;
};

test('the intermediate strings really do parse to zero', () => {
  // The premise. If this ever stops being true the bug changes shape, and the test above
  // it should be reread rather than deleted.
  assert.equal(parseTimecode('0:'), 0);
  assert.equal(parseTimecode('0'), 0);
  assert.equal(parseTimecode(''), null);
});

test('applying every keystroke DESTROYS a trim — the behaviour being fixed', () => {
  // Kept as the specification of the bug. This is what the old `input` handler did.
  let trim = { start: 40, end: 52 };
  for (const step of backspaces('0:12')) trim = apply(trim, 'end', step);
  assert.equal(trim.start, 0, 'the start was dragged to zero');
  assert.notEqual(trim.start, 40);
});

test('committing once, at the end, leaves the start alone', () => {
  // The same keystrokes, read only when the field is finished.
  const before = { start: 40, end: 52 };
  const steps = backspaces('0:12');
  const after = apply(before, 'end', steps[steps.length - 1]);   // only the final value
  assert.deepEqual(after, before, 'an emptied field changes nothing');
});

test('clearing and retyping keeps the start that was already set', () => {
  const before = { start: 40, end: 52 };
  const retyped = apply(apply(before, 'end', ''), 'end', '1:10');
  assert.equal(retyped.start, 40, 'the start survives');
  assert.equal(retyped.end, 70);
});

test('typing a number forwards does not apply its prefix', () => {
  // "30" passes through "3". Committed once, only 30 is ever seen.
  const before = { start: 10, end: 20 };
  assert.equal(apply(before, 'end', '30').end, 30);
  assert.notEqual(apply(before, 'end', '30').end, 3);
});

// ── The wiring ────────────────────────────────────────────────────
// A structural guard: the whole fix is which event does the applying, and that is a single
// line which a future edit could quietly put back.

const editor = readFileSync(new URL('../js/photo-editor.js', import.meta.url), 'utf8');
const code = editor.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test("the 'input' event only validates — it must not commit", () => {
  const onInput = code.match(/addEventListener\('input',\s*(\w+)\)/g) || [];
  const trimInput = onInput.filter((l) => /onTrimInput/.test(l));
  assert.equal(trimInput.length, 1, "the trim fields' input handler should be onTrimInput");
  assert.doesNotMatch(code, /addEventListener\('input',\s*commitTrim\)/,
    'committing on input is the bug: it applies half-typed numbers');
});

test('committing is bound to blur, and Enter is routed to it', () => {
  assert.match(code, /addEventListener\('blur',\s*commitTrim\)/);
  assert.match(code, /addEventListener\('keydown',\s*onTrimKey\)/);
  assert.match(code, /key === 'Enter'/);
});

test('the validate-only handler assigns nothing to the trim', () => {
  // It may add or remove a class and nothing else. An assignment here is the bug returning.
  const body = code.match(/const onTrimInput = \(e\) => \{([\s\S]*?)\n  \};/);
  assert.ok(body, 'onTrimInput should still exist');
  assert.doesNotMatch(body[1], /trimStart\s*=|trimEnd\s*=|settleTrim|paint\(\)/,
    'onTrimInput must not change or repaint the trim');
});
