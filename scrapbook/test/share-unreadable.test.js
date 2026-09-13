// A share that arrives with nothing in it.
//
//   npm test
//
// REPORTED: sharing to Finnbook from Google Photos does nothing.
//
// Android hands over a file with a name and a type but NO BYTES when it cannot produce the
// content — which is routine for a Google Photos item whose original is still in the cloud
// and has not been downloaded to the phone. The service worker filtered those out by size
// and said nothing, so the app opened, found no files, and carried on exactly as if nobody
// had shared anything. The share was not refused; it was discarded in silence, which is
// indistinguishable from the feature being broken.
//
// Nothing can be stored for such a file. But it has to be MENTIONED, and the person told
// what would make it work.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

import { unreadableShareCount, unreadableShareNotice } from '../js/share.js';

test('the count is read from the url the worker redirected to', () => {
  assert.equal(unreadableShareCount('?shared=1&unreadable=2'), 2);
  assert.equal(unreadableShareCount('?shared=1&unreadable=1'), 1);
});

test('a share with nothing unreadable reports nothing', () => {
  for (const search of ['?shared=1', '', '?other=3']) {
    assert.equal(unreadableShareCount(search), 0, JSON.stringify(search));
  }
});

test('junk in the marker is ignored rather than believed', () => {
  // It arrives on a URL, which anyone can edit.
  for (const search of ['?unreadable=abc', '?unreadable=-1', '?unreadable=0', '?unreadable=1.5']) {
    assert.equal(unreadableShareCount(search), 0, search);
  }
});

test('one unreadable item is described in the singular', () => {
  const msg = unreadableShareNotice(1);
  assert.match(msg, /That photo or video/);
  assert.doesNotMatch(msg, /\b1 of those\b/);
});

test('several are counted', () => {
  assert.match(unreadableShareNotice(3), /3 of those photos or videos/);
});

test('the notice names the cause and the remedy', () => {
  // Naming Google Photos matters: it is the app people share from, and the behaviour is
  // specific to its cloud library rather than a general fault in sharing.
  const msg = unreadableShareNotice(1);
  assert.match(msg, /Google Photos/);
  assert.match(msg, /download/i);
});

test('nothing unreadable means no notice at all', () => {
  assert.equal(unreadableShareNotice(0), null);
  assert.equal(unreadableShareNotice(undefined), null);
});

// ── The worker's half ─────────────────────────────────────────────

test('the worker counts what it dropped and puts it on the redirect', () => {
  // Carried on the URL rather than in the cache, because it has to survive the case where
  // NOTHING was stashed — which is exactly the case worth reporting.
  const sw = new URL('../sw.js', import.meta.url);
  const src = require('node:fs').readFileSync(sw, 'utf8');
  assert.match(src, /empty = offered\.length - files\.length/);
  assert.match(src, /unreadable=\$\{empty\}/);
});

test('the app opens the sheet for the notice even with no files', () => {
  // The whole point. A share that produced no files and no explanation is what looked
  // like the app ignoring the share.
  const src = require('node:fs').readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(src, /shared\.length \|\| notice/);
  const capture = require('node:fs').readFileSync(new URL('../js/capture.js', import.meta.url), 'utf8');
  assert.match(capture, /if \(!files\?\.length && !notice\) return;/);
});

test('the marker is cleared from the address bar', () => {
  // Or a reload would re-announce a problem that has already been explained.
  const src = require('node:fs').readFileSync(new URL('../js/share.js', import.meta.url), 'utf8');
  assert.match(src, /searchParams\.delete\('unreadable'\)/);
});
