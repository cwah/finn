// Everything the app fetches must actually be in the image.
//
//   npm test
//
// THE BUG. The Dockerfile copies scrapbook's root files ONE BY ONE — deliberately, so that
// .env, serve.py and the notes stay out of the image. sw-notify.js was added to the repo
// and never added to that list, so production served it as a 404 that PocketBase answered
// with index.html.
//
// The service worker does `importScripts('/sw-notify.js')`. It got HTML, threw a syntax
// error, and COULD NOT INSTALL — so every device silently carried on running the previous
// worker. Notifications still arrived, with the old wording and no deep link, which looks
// exactly like a device that has not updated yet. It cost days of chasing the wrong thing,
// including my telling someone to reopen the app to fix it.
//
// A missing file is invisible on a dev machine, because serve.py serves the whole
// directory. Only the container has an opinion about what was copied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../../deploy/Dockerfile', import.meta.url), 'utf8');
const swSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Does the image copy this path out of scrapbook/? */
function isShipped(file) {
  // Either named outright, or inside a directory the image copies wholesale.
  if (new RegExp(`COPY\\s+scrapbook/${file.replace('.', '\\.')}\\s`).test(dockerfile)) return true;
  const dir = file.split('/')[0];
  return file.includes('/') && new RegExp(`COPY\\s+scrapbook/${dir}/\\s`).test(dockerfile);
}

test('every script the worker importScripts is shipped', () => {
  // The exact failure: a worker that cannot load its own dependency cannot install, and
  // the only symptom is that nothing changes.
  const imports = [...swSource.matchAll(/importScripts\(['"]\/([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'the scan must find the importScripts call to mean anything');
  for (const file of imports) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} should exist in the repo`);
    assert.ok(isShipped(file), `sw.js importScripts /${file}, but the Dockerfile does not copy it`);
  }
});

test('every root-relative asset index.html asks for is shipped', () => {
  const refs = [...indexHtml.matchAll(/(?:src|href)="(?!https?:|\/\/|#|data:)([^"]+)"/g)]
    .map((m) => m[1].replace(/^\.?\//, ''))
    .filter((f) => !f.startsWith('?') && f.length);
  assert.ok(refs.length > 3, `expected several references, found ${refs.length}`);
  const missing = [...new Set(refs)].filter((f) => !isShipped(f));
  assert.deepEqual(missing, [], `index.html references these, but the image does not copy them`);
});

test('the worker itself and the manifest are shipped', () => {
  for (const file of ['sw.js', 'index.html', 'manifest.webmanifest']) {
    assert.ok(isShipped(file), `${file} must be in the image`);
  }
});

test('development-only files are still kept OUT', () => {
  // The one-by-one copy list is what keeps secrets and local tooling out of the container.
  // A future fix for the above must not become `COPY scrapbook/ /pb/pb_public/`.
  for (const file of ['.env', 'serve.py', 'package.json', 'CLAUDE.md']) {
    assert.equal(isShipped(file), false, `${file} must NOT be copied into the image`);
  }
  assert.doesNotMatch(dockerfile, /COPY\s+scrapbook\/\s+\/pb\/pb_public\//,
    'copying the whole directory would ship .env into a public web root');
});
