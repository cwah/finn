// A share that yields nothing must still say something.
//
//   npm test
//
// REPORTED: sharing from Google Photos opens Finnbook on the timeline, as though nobody
// had shared anything.
//
// Two distinct things can go wrong, and they need different advice:
//
//   the app sends NO FILES          some apps hand over a link rather than the picture
//   the files have NO BYTES         routine for a Google Photos item still in the cloud
//
// Both were discarded in silence. The worker filtered empty files by size and said
// nothing; the app found no files and carried on. A share that produces neither a photo
// nor an explanation is indistinguishable from the feature being broken — which is exactly
// how it was reported.
//
// So the worker now reports what it was handed, and the app ALWAYS answers a share. The
// final branch covers reasons nobody has diagnosed yet: an unexplained failure is still
// better reported than hidden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { shareReport, shareNotice } from '../js/share.js';

const require = createRequire(import.meta.url);
const read = (rel) => require('node:fs').readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── Reading the worker's report ───────────────────────────────────

test('the counts are read off the redirect url', () => {
  assert.deepEqual(shareReport('?shared=1&sent=3&unreadable=2'), { sent: 3, unreadable: 2, why: '' });
});

test('a share that carried nothing is distinguishable from one that carried nothing READABLE', () => {
  // The whole reason both numbers travel.
  assert.deepEqual(shareReport('?shared=1&sent=0&unreadable=0'), { sent: 0, unreadable: 0, why: '' });
  assert.deepEqual(shareReport('?shared=1&sent=2&unreadable=2'), { sent: 2, unreadable: 2, why: '' });
});

test('a missing report is not mistaken for a report of zero', () => {
  // An older worker sends no markers at all. That is unknown, not "sent nothing".
  assert.deepEqual(shareReport('?shared=1'), { sent: null, unreadable: 0, why: '' });
});

test('junk on the url is ignored rather than believed', () => {
  for (const s of ['?sent=abc&unreadable=xyz', '?sent=1.5', '?unreadable=-4']) {
    const r = shareReport(s);
    assert.ok(r.unreadable >= 0, s);
    assert.ok(r.sent === null || Number.isInteger(r.sent), s);
  }
});

// ── What gets said ────────────────────────────────────────────────

test('a share that fully worked says nothing at all', () => {
  assert.equal(shareNotice({ sent: 2, unreadable: 0 }, 2), null);
});

test('files with no bytes name Google Photos and the remedy', () => {
  const msg = shareNotice({ sent: 1, unreadable: 1 }, 0);
  assert.match(msg, /could not be read/i);
  assert.match(msg, /Google Photos/);
  assert.match(msg, /download/i);
});

test('a partial share says what is missing, not that everything failed', () => {
  // Three picked, two arrived: the two are already in the sheet and must not be implied
  // lost as well.
  const msg = shareNotice({ sent: 3, unreadable: 1 }, 2);
  assert.match(msg, /One of those/);
  assert.doesNotMatch(msg, /Nothing came through/);
});

test('an app that sent no files at all gets different advice', () => {
  // Not a cloud problem — a link was shared instead of the picture, and telling someone to
  // download the original would send them somewhere useless.
  const msg = shareNotice({ sent: 0, unreadable: 0 }, 0);
  assert.match(msg, /without the photo or video in it|sends? a link/i);
  assert.doesNotMatch(msg, /Google Photos does that/);
});

test('an unparseable form is the SAME case as no files, not a mystery', () => {
  // Confirmed in the container: an empty multipart POST makes request.formData() throw, so
  // the worker reports -1 rather than 0. That is the commonest real no-photo share, and it
  // must get the useful advice rather than the vague fallback.
  const msg = shareNotice({ sent: -1, unreadable: 0 }, 0);
  assert.match(msg, /without the photo or video in it/);
  assert.doesNotMatch(msg, /Nothing came through/);
});

test('an undiagnosed failure is still reported', () => {
  // THE POINT. Nothing claimed, nothing explained — this is the branch that used to be
  // silence, and silence is what made the bug unfindable.
  const msg = shareNotice({ sent: null, unreadable: 0 }, 0);
  assert.ok(msg && msg.length > 20);
  assert.match(msg, /Nothing came through/);
});

test('every failing shape produces a sentence', () => {
  for (const [report, claimed] of [
    [{ sent: null, unreadable: 0 }, 0],
    [{ sent: -1, unreadable: 0 }, 0],
    [{ sent: 0, unreadable: 0 }, 0],
    [{ sent: 1, unreadable: 1 }, 0],
    [{ sent: 4, unreadable: 2 }, 2],
    [{}, 0],
    [undefined, 0],
  ]) {
    const msg = shareNotice(report, claimed);
    assert.ok(msg, `expected something to be said for ${JSON.stringify(report)}`);
  }
});

// ── The wiring ────────────────────────────────────────────────────

test('the worker reports both numbers on the redirect', () => {
  const sw = read('../sw.js');
  assert.match(sw, /sent=\$\{sent\}&unreadable=\$\{empty\}/);
  assert.match(sw, /empty = offered\.length - files\.length/);
});

test('the app answers EVERY share, not only ones with files', () => {
  const app = read('../js/app.js');
  assert.match(app, /if \(config\.canPost\) openWithFiles\(shared, shareNotice\(/);
  // The old shape — opening only when something arrived — is the bug.
  assert.doesNotMatch(app, /shared\.length && config\.canPost/);
});

test('the compose sheet opens for a notice alone', () => {
  const capture = read('../js/capture.js');
  assert.match(capture, /if \(!files\?\.length && !notice\) return;/);
});

test('the markers are cleared so a reload does not repeat itself', () => {
  const share = read('../js/share.js');
  for (const key of ["'unreadable'", "'sent'"]) {
    assert.ok(share.includes(`searchParams.delete(${key})`), `${key} must be cleared`);
  }
});

// ── Saying what went wrong ────────────────────────────────────────
// REPORTED: sharing an on-device photo from Google Photos gives the "no photo in it"
// message. So request.formData() is THROWING in the worker, not returning an empty form —
// and nobody can open a service worker's console on a phone. The reason is carried out to
// where it can be read back.

test('the reason is read off the url when the worker could not parse the share', () => {
  const r = shareReport('?shared=1&sent=-1&unreadable=0&why=TypeError.0b.none');
  assert.equal(r.why, 'TypeError.0b.none');
});

test('the detail is appended to what the parent sees', () => {
  const msg = shareNotice({ sent: -1, unreadable: 0, why: 'TypeError.0b.none' }, 0);
  assert.match(msg, /without the photo or video in it/);
  assert.match(msg, /detail: TypeError\.0b\.none/);
});

test('a share that simply carried no files says nothing technical', () => {
  // The detail only appears when something actually failed to be read.
  const msg = shareNotice({ sent: 0, unreadable: 0, why: '' }, 0);
  assert.doesNotMatch(msg, /detail:/);
});

test('the reason marker is cleared from the url too', () => {
  assert.ok(read('../js/share.js').includes("searchParams.delete('why')"));
});

test('the worker records the body size and content type, not just the error name', () => {
  // The error name alone does not say whether Android sent a body, sent it under another
  // content type, or sent nothing — and those need different fixes.
  const sw = read('../sw.js');
  assert.match(sw, /const probe = event\.request\.clone\(\)/);
  assert.match(sw, /\$\{raw\.length\}b/);
  assert.match(sw, /content-type/);
});
