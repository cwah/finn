// Every listener the editor adds, it must also remove — by a name that exists.
//
//   npm test
//
// THE BUG. Renaming the trim handlers updated where they are ADDED and not where they are
// REMOVED, so `finish()` referred to `onTrimTyped`, which no longer existed. In a module
// that is a ReferenceError, and it was thrown BEFORE the `resolve()` at the end of the
// same function — so the promise never settled, `await openPhotoEditor(...)` never
// returned, and `pending[i]` was never written back.
//
// Every edit was silently discarded: crop, rotation, brightness, trim. It surfaced as
// "the crop box resets when I reopen the photo", which points at the crop and not at a
// teardown function forty lines away. Nothing failed loudly, nothing logged, and
// `node --check` is perfectly happy with a name that is never declared.
//
// The sheet is REUSED between opens, so its listeners must come off or they stack: open
// the editor five times and the fifth photo gets five handlers, each closing over an older
// photo. That makes add/remove symmetry a standing requirement rather than tidiness, and
// it is what this asserts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/photo-editor.js', import.meta.url), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `x.addEventListener('type', handler)` as [type, handler]. */
function listeners(kind) {
  const found = [];
  const re = new RegExp(`${kind}\\(\\s*'([^']+)'\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*[),]`, 'g');
  for (const m of code.matchAll(re)) found.push([m[1], m[2]]);
  return found;
}

/** Names declared in the file — const/let/var/function, at any indentation. */
function declared() {
  const names = new Set();
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop().trim();
      if (n) names.add(n);
    }
  }
  return names;
}

const added = listeners('addEventListener');
const removed = listeners('removeEventListener');
const names = declared();

test('the file really does add listeners — the scan is not vacuous', () => {
  assert.ok(added.length > 10, `expected many listeners, found ${added.length}`);
  assert.ok(removed.length > 5, `expected teardown, found ${removed.length}`);
});

test('every handler named in removeEventListener actually exists', () => {
  // THE BUG, exactly. `node --check` accepts an undeclared name; it only fails when the
  // line runs, and this one runs inside teardown, past the point anyone is watching.
  const ghosts = removed.filter(([, fn]) => !names.has(fn));
  assert.deepEqual(ghosts.map(([t, f]) => `${t} -> ${f}`), [],
    'removeEventListener refers to a name that is not declared: it will throw at teardown, '
    + 'before resolve(), and every edit will be silently lost');
});

test('every handler named in addEventListener actually exists', () => {
  const ghosts = added.filter(([, fn]) => !names.has(fn));
  assert.deepEqual(ghosts.map(([t, f]) => `${t} -> ${f}`), []);
});

test('every listener added to the shared sheet is removed again', () => {
  // The sheet outlives one open. A handler left behind closes over the photo it was made
  // for, so the next open has two, and the one after that three.
  const off = new Set(removed.map(([type, fn]) => `${type}:${fn}`));
  const leaked = added
    .map(([type, fn]) => `${type}:${fn}`)
    // Listeners on elements created fresh per open go with the element; these are the
    // ones bound to the persistent sheet and its controls.
    .filter((pair) => !off.has(pair))
    .filter((pair) => !/^loadedmetadata:|^timeupdate:|^ended:|^seeking:/.test(pair));
  assert.deepEqual(leaked, [],
    'these are added to the reused sheet but never removed — they stack on every open');
});

test('the trim handlers in particular are symmetric', () => {
  // Named outright because this is the trio that broke, and the rename that broke them is
  // the kind of edit that will happen again.
  for (const fn of ['onTrimInput', 'commitTrim', 'onTrimKey']) {
    assert.ok(added.some(([, f]) => f === fn), `${fn} should be added`);
    assert.ok(removed.some(([, f]) => f === fn), `${fn} should be removed`);
  }
});

test('resolve() is reachable — nothing throws between teardown and it', () => {
  // The failure was not the missing name as such, it was WHERE it was: the last statement
  // of the same function is the resolve that the caller is awaiting.
  assert.match(code, /resolve\(saved \?/);
});
