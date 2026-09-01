// The hooks, run WITHOUT the globals node hands out for free.
//
//   npm test
//
// THE BUG THIS EXISTS FOR. base64url() called `btoa`, under a comment of mine asserting
// that "btoa exists in the JSVM". It does not. PocketBase's engine is Goja: it implements
// ECMAScript, not the browser's web platform. No btoa, no atob, no TextEncoder, no fetch,
// no Buffer.
//
// So every push died on `btoa is not defined`, thrown inside a cron, where the only trace
// was a line in a container log nobody was reading. From outside it looked exactly like
// "push doesn't work" — no error on any page, no failed request, nothing marked.
//
// vapid.test.js did not catch it and could not have: it runs in node, where btoa is
// perfectly real. THAT is the lesson. A module being pure is not the same as a module
// being portable, and testing it in the wrong environment tests the wrong thing.
//
// These tests run the real hook files inside a vm context whose globals are only what the
// JSVM actually provides. Anything reaching for a web API throws here, on the machine,
// instead of at three in the morning on a container.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const HOOKS = new URL('../../deploy/pb_hooks/', import.meta.url);

/**
 * Goja's world: the ECMAScript standard library, and nothing else.
 *
 * Deliberately a WHITELIST rather than a blacklist of the globals that bit us. The next
 * missing one will be something nobody thought to exclude.
 */
function jsvmContext() {
  const ctx = createContext({
    // ECMAScript built-ins an engine must provide.
    Object, Array, String, Number, Boolean, Math, JSON, Date, RegExp, Error, TypeError,
    Uint8Array, ArrayBuffer, Map, Set, Promise, Symbol, isNaN, isFinite, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent,
    // PocketBase's own additions, stubbed. Nothing here is a browser API.
    module: { exports: {} },
    require: () => { throw new Error('require is not stubbed in this context'); },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  ctx.globalThis = ctx;
  return ctx;
}

/** Load one hook file the way the JSVM would, and hand back its exports. */
function loadInJsvm(name) {
  const ctx = jsvmContext();
  const src = readFileSync(new URL(name, HOOKS), 'utf8');
  runInContext(src, ctx, { filename: name });
  return ctx.module.exports;
}

test('the sandbox really is missing the web APIs — otherwise this proves nothing', () => {
  const ctx = jsvmContext();
  for (const api of ['btoa', 'atob', 'TextEncoder', 'TextDecoder', 'Buffer', 'fetch', 'setTimeout']) {
    assert.equal(runInContext(`typeof ${api}`, ctx), 'undefined', `${api} should be absent`);
  }
  // And node's own test process DOES have btoa, which is exactly why this file exists.
  assert.equal(typeof btoa, 'function');
});

test('vapid.js loads with no web APIs at all', () => {
  // The whole failure, in one line: this threw `btoa is not defined`.
  const vapid = loadInJsvm('vapid.js');
  assert.equal(typeof vapid.base64url, 'function');
  assert.equal(typeof vapid.signingInput, 'function');
});

test('base64url produces correct output without btoa', () => {
  const { base64url } = loadInJsvm('vapid.js');
  // Checked against node's own base64url, which is the independent oracle.
  for (const bytes of [
    [],
    [0],
    [1, 2],
    [1, 2, 3],
    [255, 254, 253, 252],
    [0xfb, 0xff, 0xbf],                    // exercises - and _
    ...Array.from({ length: 20 }, () => Array.from(webcrypto.getRandomValues(new Uint8Array(1 + Math.floor(Math.random() * 70))))),
  ]) {
    const mine = base64url(new Uint8Array(bytes));
    const node = Buffer.from(bytes).toString('base64url');
    assert.equal(mine, node, `for [${bytes.slice(0, 8)}...] length ${bytes.length}`);
  }
});

test('every remainder length is handled — 0, 1 and 2 bytes over', () => {
  // Unpadded base64 is where hand-rolled encoders go wrong: the tail is the special case.
  const { base64url } = loadInJsvm('vapid.js');
  for (let n = 0; n <= 66; n += 1) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37) & 0xff);
    assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'), `${n} bytes`);
  }
});

test('a 65-byte VAPID key encodes to the 87 characters browsers expect', () => {
  const { base64url } = loadInJsvm('vapid.js');
  const key = new Uint8Array(65);
  key[0] = 0x04;
  assert.equal(base64url(key).length, 87);
});

test('text encodes as UTF-8 without TextEncoder', () => {
  const { base64urlText } = loadInJsvm('vapid.js');
  for (const text of ['mailto:someone@example.com', 'plain', 'café', 'naïve — dash', '🍌 banana', '日本語']) {
    assert.equal(base64urlText(text), Buffer.from(text, 'utf8').toString('base64url'), text);
  }
});

test('a surrogate pair is one code point, not two broken ones', () => {
  // Encoding each half separately is what turns an emoji into mojibake.
  const { base64urlText } = loadInJsvm('vapid.js');
  const decoded = Buffer.from(base64urlText('🍌'), 'base64url').toString('utf8');
  assert.equal(decoded, '🍌');
});

test('the whole signing input builds inside the JSVM', () => {
  // The thing the cron actually calls. If any part of the chain reaches for a web API,
  // this is where it shows up.
  const { signingInput, audienceFor } = loadInJsvm('vapid.js');
  const aud = audienceFor('https://fcm.googleapis.com/fcm/send/abc123');
  assert.equal(aud, 'https://fcm.googleapis.com');
  const input = signingInput(aud, 'mailto:someone@example.com', 1893456000);
  const [header, claims] = input.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'ES256');
  const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(parsed.aud, aud);
  assert.equal(parsed.sub, 'mailto:someone@example.com');
});

test('derToJose works with no web APIs either', () => {
  const { derToJose } = loadInJsvm('vapid.js');
  const r = new Uint8Array(32).fill(0x11);
  const s = new Uint8Array(32).fill(0x22);
  const der = new Uint8Array([0x30, 0x44, 0x02, 0x20, ...r, 0x02, 0x20, ...s]);
  assert.equal(derToJose(der).length, 64);
});

test('notify-rule.js loads in the JSVM too', () => {
  // The other pure hook module. Same environment, same requirement.
  const rule = loadInJsvm('notify-rule.js');
  assert.equal(typeof rule.shouldNotify, 'function');
});

test('no hook file mentions a browser-only global', () => {
  // A cheap backstop for the files this cannot execute — notify-send.js and the .pb.js
  // handlers need $app and friends, so they are scanned rather than run.
  const names = ['vapid.js', 'notify-rule.js', 'notify-send.js', 'notify.pb.js'];
  const banned = ['btoa', 'atob', 'TextEncoder', 'TextDecoder', 'Buffer',
    'window', 'document', 'localStorage', 'XMLHttpRequest'];
  for (const name of names) {
    const src = readFileSync(new URL(name, HOOKS), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // A local of the same name is not the global. `notify-send.js` calls its settle span
    // `window`, which is an entirely reasonable word for it — flagging that would train
    // whoever hits it to stop reading this test.
    const local = new Set();
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
    const used = banned.filter((g) => !local.has(g)
      && new RegExp(`(^|[^\\w.$])${g}\\s*[.(\\[]`).test(src));
    assert.deepEqual(used, [], `${name} uses ${used.join(', ')}, which the JSVM lacks`);
  }
});
