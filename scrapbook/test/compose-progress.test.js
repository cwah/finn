// Where the compose sheet reports slow work.
//
//   npm test
//
// Encoding moved to save, and the progress line was wired up twice: once into the label
// under the media, where the clips are, and once into the Save button. Two places saying
// the same thing is one to read too many — and "Shrinking the video… 40%" in a button
// either wraps or is clipped, while the button's actual job is to say that saving is under
// way, which "Saving…" already does.
//
// Structural, because the alternative is a browser. What is asserted is which surfaces the
// summary is allowed to reach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/capture.js', import.meta.url), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('the encoding summary is shown in exactly one place', () => {
  // Every assignment of encodingSummary() to something's text.
  const targets = [...code.matchAll(/(\w+)\.textContent\s*=\s*encodingSummary\(\)/g)].map((m) => m[1]);
  // Plus the indirect one: paintEncoding computes it, then assigns.
  const indirect = /const news = encodingSummary\(\);[\s\S]{0,200}?(\w+)\.textContent = news/.exec(code);
  if (indirect) targets.push(indirect[1]);

  const unique = [...new Set(targets)];
  assert.deepEqual(unique, ['addLabel'],
    `progress should only ever appear on the label under the media, got: ${unique.join(', ')}`);
});

test('the Save button never shows the shrinking text', () => {
  // THE REPORT. It read "Shrinking the video… 40%" in a button sized for "Saving…".
  assert.doesNotMatch(code, /saveBtn\.textContent\s*=\s*encodingSummary/);
});

test('the Save button still says something while saving', () => {
  // Removing the duplicate must not leave the button silent — a sheet that looks ignored
  // for twenty-five seconds is the message that makes an app look broken.
  assert.match(code, /saveBtn\.textContent = 'Saving…'/);
});

test('progress is still announced as each clip is encoded', () => {
  // The remaining reporter has to actually be called, or the fix would be "delete both".
  assert.match(code, /prepareForUpload\(pending, \(item, done\) => \{[\s\S]*?announceEncoding\(/);
});

test('the announcement is cleared once encoding is done', () => {
  // Otherwise the label keeps saying "Shrinking…" through the upload that follows it.
  assert.match(code, /clearAllEncoding\(\)/);
});
