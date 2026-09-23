// The notification bell, and what it must survive.
//
//   npm test
//
// THE STEP THAT BROKE THE APP. initNotifications() sits between reading config and wiring
// the compose button, so when push went in the first time a fault here took out the
// add-post button and the timeline together, and the whole feature had to be rolled back.
//
// optional() in app.js is the structural half of the fix. This is the other half: the bell
// itself should not be the thing that fails. Both are needed — the wrapper turns a
// catastrophe into a missing bell, and these tests are what keep the bell there.
//
// Driven through globals rather than by mocking modules, because pushState() reads its
// answer from Notification, navigator and window. Setting those IS the test setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.location = { protocol: 'https:', hostname: 'finn.example.com', origin: 'https://finn.example.com' };

/** A button and label, recording what was done to them. */
function element(id) {
  return {
    id,
    hidden: false,
    title: '',
    textContent: '',
    disabled: false,
    attrs: {},
    classes: new Set(),
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    classList: {
      toggle: (name, on) => { if (on) element.prototype; },
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}

/** Put a document in place with the bell's two elements, or without them. */
function dom({ button = true, label = true, note = true } = {}) {
  const btn = button ? element('notifyBtn') : null;
  const lab = label ? element('notifyLabel') : null;
  // Where a blocked permission gets explained. Starts hidden, exactly as the markup does.
  const nte = note ? element('notifyNote') : null;
  if (nte) nte.hidden = true;
  if (btn) btn.classList = { toggle: () => {} };
  globalThis.document = {
    getElementById: (id) => (
      id === 'notifyBtn' ? btn : id === 'notifyLabel' ? lab : id === 'notifyNote' ? nte : null
    ),
  };
  return { btn, label: lab, note: nte };
}

/** Put the browser's three push capabilities in a known state. */
function browser({ notification = 'default', worker = true, pushManager = true,
                   subscription = null, getRegistration = null, standalone = null,
                   requestPermission = null } = {}) {
  globalThis.Notification = notification === 'absent'
    ? undefined
    // Reads .permission live rather than closing over the initial value: a real browser
    // resolves this against whatever the permission NOW is, which is the whole point of the
    // recovery test below.
    : { permission: notification,
        requestPermission: async () => requestPermission ?? globalThis.Notification.permission };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'test',
      ...(worker ? {
        serviceWorker: {
          getRegistration: getRegistration
            || (async () => ({ pushManager: { getSubscription: async () => subscription } })),
        },
      } : {}),
    },
  });
  globalThis.window = pushManager ? { PushManager: function PushManager() {} } : {};
  // Installed-to-home-screen or in a tab. Absent by default, as it is in a plain tab.
  if (standalone !== null) {
    globalThis.window.matchMedia = (q) => ({ matches: standalone && q.includes('standalone') });
  }
}

const { initNotifications } = await import('../js/auth.js');

test('with no subscription the bell says notifications are off', async () => {
  browser({ notification: 'default' });
  const { btn, label } = dom();
  await initNotifications();
  assert.equal(label.textContent, 'Notifications off');
  assert.equal(btn.attrs['aria-pressed'], 'false');
});

test('with a subscription it says they are on', async () => {
  browser({ notification: 'granted', subscription: { endpoint: 'https://example.com/x' } });
  const { btn, label } = dom();
  await initNotifications();
  assert.equal(label.textContent, 'Notifications on');
  assert.equal(btn.attrs['aria-pressed'], 'true');
});

test('a browser that cannot do push hides the bell rather than lying', async () => {
  browser({ notification: 'absent' });
  const { btn } = dom();
  await initNotifications();
  assert.equal(btn.hidden, true);
});

test('blocked says where to go, since the button cannot fix it', async () => {
  // Permission refused cannot be re-requested from script. A bell that offered to turn
  // notifications on would silently do nothing, which is worse than saying so.
  browser({ notification: 'denied' });
  const { btn, label } = dom();
  await initNotifications();
  assert.equal(label.textContent, 'Notifications blocked');
  assert.match(btn.title, /site settings/i);
});

// ── What it must survive ──────────────────────────────────────────

test('no bell in the DOM at all is fine', async () => {
  // The gallery shares this module and has no bell.
  browser({});
  dom({ button: false });
  await assert.doesNotReject(() => Promise.resolve(initNotifications()));
});

test('a missing label does not take the bell down', async () => {
  // paint() runs on every state change including the first, so reading .textContent off a
  // null would throw straight out of initNotifications — and before optional() existed,
  // straight out of init().
  browser({});
  const { btn } = dom({ label: false });
  await assert.doesNotReject(() => Promise.resolve(initNotifications()));
  assert.equal(btn.attrs['aria-pressed'], 'false', 'the button is still painted');
});

test('a browser that throws when asked for its registration is survived', async () => {
  // Real behaviour in some embedded webviews. pushState() rejects, refresh() catches it
  // and settles on 'off' rather than letting it escape.
  browser({ getRegistration: async () => { throw new Error('no worker here'); } });
  const { label } = dom();
  await assert.doesNotReject(() => Promise.resolve(initNotifications()));
  assert.equal(label.textContent, 'Notifications off');
});

test('initNotifications RETURNS its promise, so optional() can contain it', async () => {
  // THE GAP THIS CLOSES. It used to end with a bare `refresh();`. A rejection from an
  // unawaited call escapes the wrapper entirely and surfaces as an unhandled rejection,
  // with the bell stuck on whatever it last said — the wrapping would have looked right
  // and covered nothing.
  browser({});
  dom();
  const returned = initNotifications();
  assert.ok(returned && typeof returned.then === 'function',
    'must hand back the promise it started');
  await returned;
});

test('a failure inside the bell is contained by optional()', async () => {
  // The two halves together, which is the only thing that actually matters.
  const { optional } = await import('../js/optional.js');
  browser({ getRegistration: async () => { throw new Error('boom'); } });
  dom();
  const real = console.error;
  console.error = () => {};
  try {
    const ran = [];
    await optional('notifications', initNotifications);
    ran.push('compose wired');
    assert.deepEqual(ran, ['compose wired'], 'startup continues past a broken bell');
  } finally { console.error = real; }
});


// ── Being blocked has to be VISIBLE, and has to be recoverable ────
//
// The bell's label is screen-reader only and btn.title is a tooltip, so on a phone a
// blocked permission reached nobody: tapping the bell did nothing, with no explanation
// anywhere. That is how a reinstall — which drops Android's notification grant — looked
// like the app being broken.

test('tapping a blocked bell explains itself somewhere visible', async () => {
  browser({ notification: 'denied' });
  const { note } = dom();
  const { btn } = { btn: document.getElementById('notifyBtn') };
  await initNotifications();

  // Nothing before anyone asks: a deliberate "no" should not be nagged at on every load.
  assert.equal(note.hidden, true);

  await btn.listeners.click();
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /blocked/i);
});

test('an installed app is sent to Android settings, not the browser\'s', async () => {
  // A WebAPK is an Android app, and its notification permission is Android's. Sending
  // someone to Chrome's site settings sends them where the setting is not.
  browser({ notification: 'denied', standalone: true });
  const { note } = dom();
  await initNotifications();
  await document.getElementById('notifyBtn').listeners.click();

  assert.match(note.textContent, /Settings/);
  assert.match(note.textContent, /Apps/);
  assert.doesNotMatch(note.textContent, /site settings/i);
});

test('in a tab it is sent to the browser\'s site settings', async () => {
  browser({ notification: 'denied', standalone: false });
  const { note } = dom();
  await initNotifications();
  await document.getElementById('notifyBtn').listeners.click();
  assert.match(note.textContent, /site settings/i);
});

test('a bell blocked at load works again once permission is granted', async () => {
  // It used to return early on every click, and state was only re-read on load — so
  // following the instructions and allowing notifications left the bell still refusing,
  // with no hint that a reload was what it wanted.
  browser({ notification: 'denied' });
  const { btn, label, note } = dom();
  await initNotifications();
  assert.equal(label.textContent, 'Notifications blocked');

  // Allowed in system settings, which the page never hears about.
  Notification.permission = 'default';
  await btn.listeners.click();

  assert.notEqual(label.textContent, 'Notifications blocked');
  assert.equal(note.hidden, true);
});
