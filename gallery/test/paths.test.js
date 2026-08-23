// Where the app thinks it is. These are cheap, and they pin the one property the
// whole file exists for: that nothing resolves against the document, so the app is
// correct at any mount point — including one without a trailing slash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ROOT, fromRoot } from '../js/paths.js';

test('the app root is the directory above js/, not the module directory itself', () => {
  assert.ok(APP_ROOT.href.endsWith('/'), 'a root must end in a slash to resolve against');
  assert.ok(!APP_ROOT.href.endsWith('/js/'));
});

test('an app-relative path lands under the app root', () => {
  assert.ok(fromRoot('data/artworks.json').endsWith('/data/artworks.json'));
  assert.ok(fromRoot('art/the-long-cat.svg').endsWith('/art/the-long-cat.svg'));
  assert.equal(fromRoot('data/artworks.json'), `${APP_ROOT.href}data/artworks.json`);
});

test('an absolute URL is left exactly as it is', () => {
  // This is what lets the same call site serve both sources: the static manifest
  // writes relative paths and data-pb.js writes full /api/files/... URLs.
  const absolute = 'https://finn.example/api/files/gallery_artworks/abc/cat.jpg';
  assert.equal(fromRoot(absolute), absolute);
});

test('a root-absolute path is honoured rather than nested under the mount point', () => {
  assert.ok(fromRoot('/elsewhere/cat.jpg').endsWith('/elsewhere/cat.jpg'));
});

test('a missing path resolves to the app root instead of throwing', () => {
  assert.equal(fromRoot(null), APP_ROOT.href);
  assert.equal(fromRoot(undefined), APP_ROOT.href);
  assert.equal(fromRoot(''), APP_ROOT.href);
});

test('the deep-link forms resolve to the app root, not the origin root', () => {
  // The regression this guards: at /gallery (no trailing slash) './' used to resolve
  // to '/', pointing the gallery's own landing link at the scrapbook.
  const mounted = new URL('http://host/gallery/');
  assert.equal(new URL('./', mounted).href, 'http://host/gallery/');
  assert.equal(new URL('?art=the-long-cat', mounted).href, 'http://host/gallery/?art=the-long-cat');
});
