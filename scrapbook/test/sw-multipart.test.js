// Reading a shared file out of the raw request body.
//
//   npm test
//
// WHY THIS EXISTS. `request.formData()` throws on Android for shares it ought to handle —
// confirmed in the container, where a well-formed multipart body carrying no parts raises
// a TypeError rather than returning an empty form. A user sharing an on-device photo from
// Google Photos hit the same thing, and when it throws there is nothing to go on: the
// error says nothing about whether the photo arrived, and the files are lost regardless.
//
// So the worker parses the bytes itself when formData() fails. That code is the last thing
// standing between a shared photo and a share that does nothing, and it runs on a phone
// where nobody can see it fail — which is the whole argument for testing it properly here.
//
// The function is tested AS IT SHIPS: extracted out of sw.js and run, rather than copied.
// It lives inline in the worker on purpose — a file the worker importScripts must also be
// copied into the image, and forgetting that once stopped every device updating for ten
// days.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const fn = src.match(/function parseMultipart\(bytes, contentType\) \{[\s\S]*?\n\}/);
assert.ok(fn, 'parseMultipart must still be in sw.js');

const ctx = createContext({ TextEncoder, TextDecoder, Uint8Array });
// Arrays built inside a vm context belong to its realm, so deepEqual against a main-realm
// array fails on prototype identity alone. Spread results before comparing.
const plain = (arr) => [...arr];
runInContext(`${fn[0]}\nthis.parseMultipart = parseMultipart;`, ctx);
const { parseMultipart } = ctx;

const BOUNDARY = '----WebKitFormBoundaryABC123';
const CT = `multipart/form-data; boundary=${BOUNDARY}`;

/** Build a real multipart body, bytes and all. */
function body(parts, boundary = BOUNDARY) {
  const chunks = [];
  const push = (s) => chunks.push(new TextEncoder().encode(s));
  for (const part of parts) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${part.field}"`);
    if (part.filename !== undefined) push(`; filename="${part.filename}"`);
    push('\r\n');
    if (part.type) push(`Content-Type: ${part.type}\r\n`);
    push('\r\n');
    chunks.push(part.bytes instanceof Uint8Array ? part.bytes : new TextEncoder().encode(part.bytes || ''));
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

test('a single shared photo comes back whole', () => {
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const parts = parseMultipart(body([
    { field: 'media', filename: 'IMG_1234.jpg', type: 'image/jpeg', bytes: photo },
  ]), CT);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].field, 'media');
  assert.equal(parts[0].name, 'IMG_1234.jpg');
  assert.equal(parts[0].type, 'image/jpeg');
  assert.deepEqual([...parts[0].bytes], [...photo], 'the bytes must survive exactly');
});

test('several files keep their order', () => {
  const parts = parseMultipart(body([
    { field: 'media', filename: 'a.jpg', type: 'image/jpeg', bytes: new Uint8Array([1]) },
    { field: 'media', filename: 'b.mp4', type: 'video/mp4', bytes: new Uint8Array([2, 2]) },
    { field: 'media', filename: 'c.png', type: 'image/png', bytes: new Uint8Array([3, 3, 3]) },
  ]), CT);
  assert.deepEqual(plain(parts.map((p) => p.name)), ['a.jpg', 'b.mp4', 'c.png']);
  assert.deepEqual(plain(parts.map((p) => p.bytes.length)), [1, 2, 3]);
});

test('binary that CONTAINS the boundary text is not split on it', () => {
  // A real photo is arbitrary bytes and may contain anything. Splitting on a sequence that
  // is not an actual boundary would truncate the picture — silently, since a JPEG missing
  // its tail still decodes to something.
  const sneaky = new TextEncoder().encode(`padding--${BOUNDARY}padding`);
  const parts = parseMultipart(body([
    { field: 'media', filename: 'x.jpg', type: 'image/jpeg', bytes: sneaky },
  ]), CT);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].bytes.length, sneaky.length, 'the file must not be cut short');
});

test('a text field is ignored — only files are wanted', () => {
  // Sharing apps routinely send a title or a link alongside the picture.
  const parts = parseMultipart(body([
    { field: 'title', bytes: 'A day at the park' },
    { field: 'media', filename: 'p.jpg', type: 'image/jpeg', bytes: new Uint8Array([9]) },
  ]), CT);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'p.jpg');
});

test('a file part with no bytes is reported, not dropped', () => {
  // The cloud-only Google Photos case: named and typed, nothing behind it. The caller
  // counts these to explain them, so the parser must hand them over.
  const parts = parseMultipart(body([
    { field: 'media', filename: 'cloud.jpg', type: 'image/jpeg', bytes: new Uint8Array([]) },
  ]), CT);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].bytes.length, 0);
});

test('a body with no parts yields nothing, without throwing', () => {
  // The exact shape that makes formData() raise a TypeError.
  assert.equal(parseMultipart(body([]), CT).length, 0);
});

test('a quoted boundary is understood', () => {
  const b = 'weird boundary';
  const parts = parseMultipart(body([
    { field: 'media', filename: 'q.jpg', type: 'image/jpeg', bytes: new Uint8Array([7]) },
  ], b), `multipart/form-data; boundary="${b}"`);
  assert.equal(parts.length, 1);
});

test('junk in, nothing out — never an exception', () => {
  // This runs inside a fetch handler. A throw here answers the share with a dead POST.
  for (const [bytes, type] of [
    [new Uint8Array([]), CT],
    [new Uint8Array([1, 2, 3]), CT],
    [body([]), 'text/plain'],
    [body([]), ''],
    [new Uint8Array([1, 2, 3]), undefined],
  ]) {
    assert.doesNotThrow(() => parseMultipart(bytes, type));
    assert.equal(parseMultipart(bytes, type).length, 0);
  }
});

test('a megabyte parses quickly enough for a phone', () => {
  // The scan is anchored on CRLF-dash-dash rather than comparing every byte, because a
  // bare dash is common in photo data and a naive scan over several megabytes is slow
  // enough to notice on a phone.
  const big = new Uint8Array(1024 * 1024).map((_, i) => (i * 7) & 0xff);
  const started = Date.now();
  const parts = parseMultipart(body([
    { field: 'media', filename: 'big.jpg', type: 'image/jpeg', bytes: big },
  ]), CT);
  assert.equal(parts[0].bytes.length, big.length);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
});

test('the worker actually uses it when formData throws', () => {
  assert.match(src, /catch \(err\) \{[\s\S]*?parseMultipart\(raw, type\)/);
  assert.match(src, /why \+= '\.recovered'/);
});
