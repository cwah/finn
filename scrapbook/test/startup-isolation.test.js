// Which startup steps are allowed to fail, and which are not.
//
//   npm test
//
// A structural guard, deliberately. The bug it exists for was a fault in the notification
// bell presenting as a scrapbook that would not load and an add-post button that did
// nothing — because init() is a straight line and an unwrapped enhancement in the middle
// of it takes out everything below AND rejects init() above.
//
// The fix is optional(), and the risk is that the next enhancement gets added without it:
// the code would look perfectly reasonable and would fail the same way. So the rule is
// asserted against the source rather than left as something to remember.
//
// ENHANCEMENTS are things whose absence is survivable — a bell, an install prompt.
// LOAD-BEARING steps are the app itself: sign in, read config, wire compose, bind the
// timeline. Those are deliberately NOT wrapped; if the timeline cannot be bound there is
// nothing worth showing, and hiding that would be worse than failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
/** Comments explain the rule; they must not be able to satisfy it. */
const code = app.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Startup steps whose failure must not take the app down.
 * Add an enhancement here when you add one to init().
 */
const ENHANCEMENTS = ['initPwa', 'initNotifications'];

for (const name of ENHANCEMENTS) {
  test(`${name} is only ever started through optional()`, () => {
    // Not present at all is fine — the feature may not exist yet. Present and called
    // directly is the failure.
    const called = new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'm');
    if (!called.test(code)) return;

    const wrapped = new RegExp(`optional\\(\\s*['"\`][^'"\`]+['"\`]\\s*,\\s*${name}\\s*[),]`);
    assert.ok(
      wrapped.test(code),
      `${name}() is called directly in init(). An enhancement that throws there abandons `
      + 'every step after it and rejects init(). Start it with '
      + `optional('<name>', ${name}) instead.`,
    );
  });
}

test('the load-bearing steps are NOT wrapped', () => {
  // The other half of the rule. optional() around a step the app cannot do without would
  // turn a total failure into a silent partial one, which is harder to notice and harder
  // to diagnose than the crash it replaced.
  for (const essential of ['ensureSignedIn', 'getConfig', 'initCapture']) {
    const wrapped = new RegExp(`optional\\([^)]*${essential}`);
    assert.equal(wrapped.test(code), false,
      `${essential} is load-bearing — its failure must not be swallowed`);
  }
});

test('init() still has a catch, so nothing reaches the user as a blank page', () => {
  assert.match(code, /init\(\)\s*\.catch\(/);
});
