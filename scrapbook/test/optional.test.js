// An enhancement must cost only itself when it fails.
//
//   npm test
//
// THE FAILURE THIS EXISTS FOR. Push notifications were added, and the scrapbook stopped
// loading and the add-post button stopped working. Both at once, because init() is a
// straight line and initNotifications() sat in the middle of it: a throw there abandoned
// initCapture() below and rejected init() above. The whole feature had to be rolled back
// before anyone could use the app again.
//
// The exact throw was never pinned down — which is the point. This does not test for a
// particular bug in the bell; it makes a bug in the bell survivable, and these tests fail
// if that stops being true.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { optional } from '../js/optional.js';

/** Silence the deliberate console.error, and record that it happened. */
function quiet(run) {
  const real = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try { return { value: run(), calls }; } finally { console.error = real; }
}

test('a synchronous throw is contained', () => {
  const { value, calls } = quiet(() => optional('bell', () => { throw new Error('boom'); }));
  assert.equal(value, null);
  assert.equal(calls.length, 1, 'and is reported, not swallowed in silence');
});

test('the steps AFTER a failed enhancement still run', () => {
  // The actual regression: initCapture() never ran, so the add-post button did nothing.
  const ran = [];
  quiet(() => {
    optional('bell', () => { throw new Error('boom'); });
    ran.push('compose wired');
  });
  assert.deepEqual(ran, ['compose wired']);
});

test('a rejected promise is contained too', async () => {
  // The shape that is easy to miss: it fails after optional() has already returned, so a
  // try/catch around the call site would not have caught it.
  const real = console.error;
  console.error = () => {};
  try {
    const result = await optional('bell', async () => { throw new Error('later'); });
    assert.equal(result, null);
  } finally { console.error = real; }
});

test('a rejection does not become an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (err) => seen.push(err);
  process.on('unhandledRejection', onUnhandled);
  const real = console.error;
  console.error = () => {};
  try {
    optional('bell', () => Promise.reject(new Error('nobody caught me')));
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    console.error = real;
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, [], 'the rejection must be handled inside optional()');
});

test('a working enhancement is untouched', () => {
  assert.equal(optional('bell', () => 'wired'), 'wired');
});

test('an async enhancement still yields its value', async () => {
  assert.equal(await optional('bell', async () => 'wired'), 'wired');
});

test('the report names the enhancement, so the console says which one', () => {
  const { calls } = quiet(() => optional('notifications', () => { throw new Error('x'); }));
  assert.match(String(calls[0][0]), /notifications/);
});

test('failure is reported through console.error, not shown to the reader', () => {
  // A parent looking at photos should not be told the bell is unwell. Whoever opens
  // devtools should find out at once.
  const { calls } = quiet(() => optional('bell', () => { throw new Error('x'); }));
  assert.match(String(calls[0][0]), /continues/i);
});
