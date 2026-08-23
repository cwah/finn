// Reading and writing the address bar. The rule being pinned is that the newest piece
// has exactly ONE address — otherwise the link people share rots the day a new
// drawing arrives and it stops being the newest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artIdFromUrl, urlForIndex } from '../js/deep-link.js';

const LIST = [{ id: 'newest' }, { id: 'middle' }, { id: 'oldest' }];

test('an art parameter names the piece to show', () => {
  assert.equal(artIdFromUrl('?art=the-long-cat'), 'the-long-cat');
  assert.equal(artIdFromUrl('art=the-long-cat'), 'the-long-cat');
});

test('a piece id survives being escaped and unescaped', () => {
  const id = 'a piece/with odd&characters';
  const round = artIdFromUrl(urlForIndex([{ id: 'x' }, { id }], 1));
  assert.equal(round, id);
});

test('the bare landing page asks for no particular piece', () => {
  for (const search of ['', '?', null, undefined, '?other=1']) {
    assert.equal(artIdFromUrl(search), null, `${search}`);
  }
});

test('an empty art parameter is treated as absent rather than as an id', () => {
  assert.equal(artIdFromUrl('?art='), null);
});

test('the newest piece lives at the bare URL and nowhere else', () => {
  assert.equal(urlForIndex(LIST, 0), './');
});

test('every other piece gets its own address', () => {
  assert.equal(urlForIndex(LIST, 1), '?art=middle');
  assert.equal(urlForIndex(LIST, 2), '?art=oldest');
});

test('an index that is not in the collection falls back to the landing page', () => {
  assert.equal(urlForIndex(LIST, 99), './');
  assert.equal(urlForIndex(LIST, -1), './');
  assert.equal(urlForIndex(null, 1), './');
});
