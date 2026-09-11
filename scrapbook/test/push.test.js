// Subscribing this device, and the four things the bell can say.
//
//   npm test
//
// Step 3 of reinstating push: the module exists and is imported, but nothing calls it yet.
// Tested now, before anything depends on it, so that when the bell is wired up in step 4
// the only new thing is the wiring.
//
// keyBytes is the piece most able to fail QUIETLY. A key decoded to the wrong bytes still
// subscribes happily; the push is rejected much later by a service that says only 401, at
// which point the encoding is the last place anyone looks.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.location = { protocol: 'https:', hostname: 'finn.example.com', origin: 'https://finn.example.com' };

const { keyBytes, pushSupported, pushState } = await import('../js/push.js');

/** Put the three push capabilities in a known state. */
function browser({ notification = 'default', worker = true, pushManager = true, subscription = null } = {}) {
  globalThis.Notification = notification === 'absent'
    ? undefined
    : { permission: notification, requestPermission: async () => notification };
  // defineProperty, not assignment: node exposes `navigator` as a getter-only global, so
  // `globalThis.navigator = ...` throws in a module's strict mode.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'test',
      ...(worker ? {
        serviceWorker: {
          getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }),
        },
      } : {}),
    },
  });
  globalThis.window = pushManager ? { PushManager: function PushManager() {} } : {};
}

// ── keyBytes ──────────────────────────────────────────────────────

test('a real 65-byte VAPID key decodes to 65 bytes', () => {
  // The uncompressed P-256 point every push service expects: 0x04 then two 32-byte
  // coordinates. The wrong length is the failure that gets a bare 401 later.
  const key = 'BPY9739cazgYjFeAv64oW8M3x2SiPKlWedhnE6g4aPm2xgsqqY4bqyaekE3VHp-w_smiQdwdHniJ2DHlnWb-Np8';
  const bytes = keyBytes(key);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 0x04, 'an uncompressed point starts with 0x04');
});

test('it returns a Uint8Array, which is what subscribe() insists on', () => {
  // Handing subscribe() the string it was given fails with a DOMException that says
  // nothing about encoding.
  assert.ok(keyBytes('AAAA') instanceof Uint8Array);
});

test('base64url is not base64 — - and _ are decoded, not rejected', () => {
  // THE ENCODING TRAP. Standard atob() would throw on these characters or, worse, some
  // engines quietly produce different bytes. A VAPID key contains them routinely.
  const withDashes = keyBytes('-_-_');
  const equivalent = keyBytes('+/+/'.replace(/\+/g, '-').replace(/\//g, '_'));
  assert.deepEqual([...withDashes], [...equivalent]);
  assert.equal(withDashes.length, 3);
});

test('missing padding is supplied', () => {
  // base64url drops '='. Feeding an unpadded string to atob() throws.
  for (const [input, length] of [['AA', 1], ['AAA', 2], ['AAAA', 3], ['AAAAAA', 4]]) {
    assert.equal(keyBytes(input).length, length, `for ${input}`);
  }
});

test('the bytes are the actual decoded value, not their char codes', () => {
  // 'AQID' is 0x01 0x02 0x03. An off-by-one here would be invisible until a push failed.
  assert.deepEqual([...keyBytes('AQID')], [1, 2, 3]);
});

// ── pushSupported ─────────────────────────────────────────────────

test('all three capabilities present means supported', () => {
  browser({});
  assert.equal(pushSupported(), true);
});

test('no Notification API means unsupported', () => {
  browser({ notification: 'absent' });
  assert.equal(pushSupported(), false);
});

test('no service worker means unsupported', () => {
  // Safari on iPhone until the app is installed to the home screen — the common real case.
  browser({ worker: false });
  assert.equal(pushSupported(), false);
});

test('no PushManager means unsupported', () => {
  browser({ pushManager: false });
  assert.equal(pushSupported(), false);
});

// ── pushState ─────────────────────────────────────────────────────

test('an unsupported browser says so rather than off', async () => {
  browser({ notification: 'absent' });
  assert.equal(await pushState(), 'unsupported');
});

test('denied permission is BLOCKED, which is not the same as off', async () => {
  // The distinction that matters: permission refused cannot be asked for again from
  // script, so a bell offering to turn it on would silently do nothing. Conflating the
  // two is how that button gets built.
  browser({ notification: 'denied' });
  assert.equal(await pushState(), 'blocked');
});

test('blocked beats any existing subscription', async () => {
  browser({ notification: 'denied', subscription: { endpoint: 'https://example.com/x' } });
  assert.equal(await pushState(), 'blocked');
});

test('granted with a subscription is on', async () => {
  browser({ notification: 'granted', subscription: { endpoint: 'https://example.com/x' } });
  assert.equal(await pushState(), 'on');
});

test('granted with no subscription is off, not on', async () => {
  // Permission is not a subscription. Another device having subscribed says nothing about
  // this one — the bell reflects THIS browser.
  browser({ notification: 'granted' });
  assert.equal(await pushState(), 'off');
});

test('default permission with no subscription is off', async () => {
  browser({ notification: 'default' });
  assert.equal(await pushState(), 'off');
});

// ── A rotated key strands every existing subscription ─────────────
// REPORTED: notifications stop arriving, and turning the bell off and on does not help.
// Rotating the VAPID pair invalidates every subscription taken out under the old one, but
// the browser keeps handing the old one back — getSubscription() knows nothing about whose
// key it was. So the server signs with the new key, the push service rejects it, and the
// bell goes on reading the browser's subscription and saying "on".

const { matchesKey } = await import('../js/push.js');

/** A subscription carrying the key it was created with, as the spec provides. */
const subWithKey = (bytes) => ({ options: { applicationServerKey: new Uint8Array(bytes).buffer } });
const KEY = 'BPY9739cazgYjFeAv64oW8M3x2SiPKlWedhnE6g4aPm2xgsqqY4bqyaekE3VHp-w_smiQdwdHniJ2DHlnWb-Np8';

test('a subscription taken out with the current key matches', () => {
  assert.equal(matchesKey(subWithKey(keyBytes(KEY)), KEY), true);
});

test('one taken out with a DIFFERENT key does not', () => {
  // The whole bug: this is the case that must be noticed and re-subscribed.
  const other = keyBytes(KEY).slice();
  other[10] ^= 0xff;
  assert.equal(matchesKey(subWithKey(other), KEY), false);
});

test('a key of the wrong length does not match either', () => {
  assert.equal(matchesKey(subWithKey([1, 2, 3]), KEY), false);
});

test('a browser that does not expose the key is given the benefit of the doubt', () => {
  // Throwing away a working subscription over a missing field would be worse than the bug
  // being fixed — the person would lose notifications that were arriving perfectly well.
  assert.equal(matchesKey({ options: {} }, KEY), true);
  assert.equal(matchesKey({}, KEY), true);
  assert.equal(matchesKey(null, KEY), true);
});
