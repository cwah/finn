// The two data sources must offer the same shape.
//
//   npm test
//
// data.js picks an implementation and re-exports a fixed list of names by DESTRUCTURING
// it. A name on that list that the chosen module does not export is not a small problem:
// destructuring a missing export is a module-level failure, so app.js never evaluates, and
// the page shows nothing at all. No error in the UI, no partial render, no clue — the same
// blank result as a syntax error.
//
// The comment at the top of data.js has always said "keep them in step when either
// changes". This checks it instead of asking.
//
// Especially worth having while push is being reinstated a piece at a time: step 3 adds
// three names to that list, and the mock is the easy one to forget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// pb.js reads storage as it loads; data-mock.js does not, but both are pulled in below.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.location = { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' };

const source = readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');

/** The names data.js destructures out of whichever implementation it picked. */
function reExportedNames() {
  const block = source.match(/export const \{([\s\S]*?)\} = impl;/);
  assert.ok(block, 'data.js must still re-export by destructuring — this test reads that list');
  return block[1]
    .split(',')
    .map((s) => s.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean);
}

const names = reExportedNames();

test('data.js re-exports a non-trivial list', () => {
  assert.ok(names.length >= 8, `expected the real list, got ${names.join(', ')}`);
});

for (const impl of ['data-pb.js', 'data-mock.js']) {
  test(`${impl} exports every name data.js re-exports`, async () => {
    const mod = await import(`../js/${impl}`);
    const missing = names.filter((n) => !(n in mod));
    assert.deepEqual(
      missing, [],
      `${impl} is missing ${missing.join(', ')}. Destructuring a missing export fails the `
      + 'whole module graph: app.js never runs and the page renders nothing.',
    );
  });
}

test('the two implementations agree with each other exactly', async () => {
  // Either direction is a bug. A name in the mock but not in PocketBase means a feature
  // that works in development and vanishes in production, which is the worse direction and
  // the one nobody notices until it is deployed.
  const pb = await import('../js/data-pb.js');
  const mock = await import('../js/data-mock.js');
  const isFn = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
  assert.deepEqual(isFn(mock), isFn(pb));
});

test('every re-exported name is callable in both', async () => {
  for (const impl of ['data-pb.js', 'data-mock.js']) {
    const mod = await import(`../js/${impl}`);
    for (const n of names) {
      assert.equal(typeof mod[n], 'function', `${impl}.${n} should be a function`);
    }
  }
});
