// The drawn frame. None of this checks that it looks good — that is preview.html's
// job. It checks the things that make it render at all, each of which fails silently:
// a broken data URI paints nothing, and a missing corner leaves the 9-slice with
// nothing to slice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAROQUE_VIEWBOX, baroqueSvg, encodeSvg, baroqueUri,
} from '../js/baroque-frame.js';

test('the drawing is one svg at the viewBox the stylesheet slices against', () => {
  const svg = baroqueSvg();
  assert.equal((svg.match(/<svg/g) || []).length, 1);
  assert.ok(svg.includes(`viewBox="0 0 ${BAROQUE_VIEWBOX} ${BAROQUE_VIEWBOX}"`));
});

test('all four corners and all four rails are placed, so the 9-slice has content', () => {
  const svg = baroqueSvg();
  for (const id of ['rail', 'corner']) {
    assert.ok(svg.includes(`<g id="${id}">`), `nothing defines ${id}`);
    const uses = svg.match(new RegExp(`href="#${id}"`, 'g')) || [];
    assert.equal(uses.length, 4, `${id} should be placed four times`);
  }
});

test('the sight opening is knocked out, so the carving cannot land on the artwork', () => {
  // Without fill-rule="evenodd" the inner subpath draws a second square instead of a
  // hole, and the band covers the whole picture.
  assert.ok(baroqueSvg().includes('fill-rule="evenodd"'));
});

test('the encoded URI contains no raw hash, which would truncate it at the fragment', () => {
  const uri = baroqueUri();
  const body = uri.slice(uri.indexOf(',') + 1);
  assert.ok(!body.includes('#'), 'a raw # would cut the SVG short');
});

test('nothing is double-encoded, which would break every internal reference', () => {
  // '%' is escaped before '#', so a pre-escaped '%23' in the markup would become
  // '%2523' and every href="#rail" would resolve to nothing.
  const uri = baroqueUri();
  assert.ok(!uri.includes('%2523'));
  assert.ok(uri.includes('%23rail'), 'the rail reference should survive encoding');
  assert.ok(uri.includes('%23corner'));
  assert.ok(uri.includes('%23g'), 'the gradient reference should survive encoding');
});

test('angle brackets and quotes are escaped so the URI survives a CSS url()', () => {
  const encoded = encodeSvg('<a b="c">');
  assert.equal(encoded, '%3Ca b=%22c%22%3E');
});

test('a literal percent is escaped before anything else is added', () => {
  assert.equal(encodeSvg('50%'), '50%25');
});

test('the same colours always produce byte-identical markup', () => {
  assert.equal(baroqueSvg(), baroqueSvg());
  assert.equal(baroqueUri({ gild: '#c0c0c0' }), baroqueUri({ gild: '#c0c0c0' }));
});

test('recolouring reaches the drawing, since CSS variables cannot', () => {
  const silver = baroqueSvg({ gild: '#c0c0c0' });
  assert.ok(silver.includes('#c0c0c0'));
  assert.ok(!silver.includes('#c9a227'), 'the gold should have been replaced');
});

test('the finished value is a url() a stylesheet can use as-is', () => {
  assert.match(baroqueUri(), /^url\("data:image\/svg\+xml,.+"\)$/);
});
