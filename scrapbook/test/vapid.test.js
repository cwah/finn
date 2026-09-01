// Signing a VAPID token.
//
//   npm test
//
// The signature itself is openssl's job in production. What is tested here is the byte
// work around it — and the DER conversion in particular, which is the piece that fails
// only SOMETIMES and would therefore pass a casual test and break in the wild.
//
// The oracle is node's own crypto — but by VERIFYING, not by comparing. ECDSA is
// randomised: signing the same bytes twice gives two different valid signatures, so
// "convert the DER one and check it equals the JOSE one" compares two unrelated numbers
// and fails every time. That was the first version of this file, and the failure was the
// test's, not the code's. What a converted signature has to do is verify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const vapid = createRequire(import.meta.url)('../../deploy/pb_hooks/vapid.js');
const { base64url, base64urlText, derToJose, audienceFor, signingInput } = vapid;

/** A P-256 key pair, as VAPID uses. */
function keyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

// ── The DER conversion ────────────────────────────────────────────
/** Sign in DER, convert, and ask node whether the result is a valid signature. */
function convertsAndVerifies(privateKey, publicKey, data) {
  const der = crypto.sign('sha256', data, { key: privateKey, dsaEncoding: 'der' });
  const jose = derToJose(new Uint8Array(der));
  const ok = crypto.verify('sha256', data,
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jose));
  return { ok, der, jose };
}

test('a converted DER signature verifies', () => {
  const { privateKey, publicKey } = keyPair();
  assert.equal(convertsAndVerifies(privateKey, publicKey, Buffer.from('header.payload')).ok, true);
});

test('and does so for two hundred signatures, not one lucky one', () => {
  // THE WHOLE POINT. A leading 0x00 appears when the top bit of r is set, which is about
  // half the time; a SHORT integer when there are leading zero bits, which is rarer. One
  // sample proves nothing — these are the shapes that pass a demo and fail in the wild.
  const { privateKey, publicKey } = keyPair();
  let sawPadded = 0;
  let sawShort = 0;

  for (let i = 0; i < 200; i += 1) {
    const { ok, der } = convertsAndVerifies(privateKey, publicKey, Buffer.from(`message-${i}`));
    assert.equal(ok, true, `signature ${i} did not verify after conversion`);
    const rLen = der[3];
    if (rLen === 33) sawPadded += 1;
    if (rLen < 32) sawShort += 1;
  }
  // A green run that never met an awkward integer would prove very little, so say so.
  assert.ok(sawPadded > 0, `never met a sign-padded integer in 200 (${sawPadded}/${sawShort})`);
});

test('the result is always exactly 64 bytes', () => {
  const { privateKey } = keyPair();
  for (let i = 0; i < 50; i += 1) {
    const der = crypto.sign('sha256', Buffer.from(`x${i}`), { key: privateKey, dsaEncoding: 'der' });
    assert.equal(derToJose(new Uint8Array(der)).length, 64);
  }
});

test('junk is refused rather than silently mis-signed', () => {
  // A wrong signature is rejected by the push service with a bare 401 and no explanation.
  // Failing here, where the cause is visible, is much the better place.
  assert.throws(() => derToJose(new Uint8Array([1, 2, 3])));
  assert.throws(() => derToJose(new Uint8Array(0)));
  assert.throws(() => derToJose(null));
  assert.throws(() => derToJose(new Uint8Array([0x30, 0x06, 0x03, 0x01, 0x01, 0x03, 0x01, 0x01])));
});

// ── base64url ─────────────────────────────────────────────────────
test('base64url uses the URL alphabet and drops padding', () => {
  const bytes = new Uint8Array([251, 255, 190, 0]);
  const out = base64url(bytes);
  assert.doesNotMatch(out, /[+/=]/, `got ${out}`);
  assert.equal(Buffer.from(out.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length, 4);
});

test('text round-trips through base64url', () => {
  const encoded = base64urlText('{"alg":"ES256"}');
  const back = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  assert.equal(back, '{"alg":"ES256"}');
});

// ── The audience ──────────────────────────────────────────────────
test('the audience is the ORIGIN, never the path', () => {
  // The path IS the subscription secret; putting it in a claim would leak it, and push
  // services reject a token whose audience carries one anyway.
  assert.equal(
    audienceFor('https://fcm.googleapis.com/fcm/send/abc123:XYZ'),
    'https://fcm.googleapis.com',
  );
  assert.equal(
    audienceFor('https://web.push.apple.com/QRS/tuv'),
    'https://web.push.apple.com',
  );
});

test('a port is part of the origin', () => {
  assert.equal(audienceFor('https://push.example.com:8443/x/y'), 'https://push.example.com:8443');
});

test('a non-endpoint is refused', () => {
  assert.throws(() => audienceFor('not a url'));
  assert.throws(() => audienceFor(''));
  assert.throws(() => audienceFor(null));
});

// ── The token ─────────────────────────────────────────────────────
test('the signing input is two base64url segments', () => {
  const input = signingInput('https://fcm.googleapis.com', 'mailto:a@b.c', 1_800_000_000);
  const parts = input.split('.');
  assert.equal(parts.length, 2);
  for (const p of parts) assert.doesNotMatch(p, /[+/=]/);
});

test('the header declares ES256, which is what VAPID requires', () => {
  const [header] = signingInput('https://x.example', 'mailto:a@b.c', 1).split('.');
  const decoded = JSON.parse(Buffer.from(header, 'base64url').toString());
  assert.equal(decoded.alg, 'ES256');
  assert.equal(decoded.typ, 'JWT');
});

test('the claims carry aud, exp and sub', () => {
  const [, payload] = signingInput('https://x.example', 'mailto:a@b.c', 1_800_000_000.7).split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.aud, 'https://x.example');
  assert.equal(claims.sub, 'mailto:a@b.c');
  assert.equal(claims.exp, 1_800_000_000, 'exp must be a whole number of seconds');
});

test('a whole token verifies against the public key', () => {
  // End to end for everything except openssl: build the input, sign it the way the hook
  // will, convert, and check a verifier accepts the result.
  const { privateKey, publicKey } = keyPair();
  const input = signingInput('https://fcm.googleapis.com', 'mailto:finn@example.com',
    Math.floor(Date.now() / 1000) + 3600);
  const der = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'der' });
  const jose = derToJose(new Uint8Array(der));
  const ok = crypto.verify('sha256', Buffer.from(input),
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jose));
  assert.equal(ok, true, 'the converted signature must verify');
});
