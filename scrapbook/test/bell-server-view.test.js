// The bell has to mean "the scrapbook will send to this device", not "this device asked".
//
//   npm test
//
// THE FAILURE THIS EXISTS FOR. pushState() reads the browser's own subscription, which says
// only that this device once asked to be told. When the server's row went away — dropped by
// a push that looked dead, or written under the other parent's account — the two came apart:
// the browser stayed subscribed, the bell went on reading "on", and nothing arrived. Nobody
// could have known. There was no reading anywhere that disagreed.
//
// So `on` now means confirmed against the server, and a third state says so when it is not.
//
// Driven through a stubbed fetch rather than by mocking modules, because the whole point is
// the round trip: what the SERVER says about the row is the thing under test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const ME = { id: 'parent1', name: 'Alex', email: 'alex@example.com', canPost: true };
const ENDPOINT = 'https://push.example.com/sub/abc';

// Seeded before pb.js is imported, because it reads the token once at module load.
globalThis.localStorage = {
  store: { 'scrapbook.auth': JSON.stringify({ token: 't0ken', record: ME }) },
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = v; },
  removeItem(k) { delete this.store[k]; },
};
globalThis.location = {
  protocol: 'https:', hostname: 'finn.example.com', origin: 'https://finn.example.com',
  search: '',
};

/** A PocketBase-shaped list response. */
const listOf = (items) => ({
  items, page: 1, perPage: items.length || 1, totalItems: items.length, totalPages: 1,
});

/**
 * @param {{rows?: number, confirmFails?: boolean}} opts
 *   rows          how many subscription rows the server admits to holding
 *   confirmFails  the CONFIRMATION read fails, while the upsert before it succeeds — which
 *                 is the case worth isolating: healPush() returning cleanly is exactly what
 *                 used to be mistaken for proof that the server had the row
 */
function server({ rows = 1, confirmFails = false } = {}) {
  const calls = [];
  // The upsert reads before it writes, so the confirmation is the SECOND read. Failing the
  // first would throw inside healPush and never reach the code under test.
  let reads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    calls.push(`${init.method || 'GET'} ${path.replace('https://finn.example.com', '')}`);

    const json = (body) => ({
      ok: true, status: 200, headers: new Map(), json: async () => body,
      text: async () => JSON.stringify(body),
    });

    if (path.includes('/collections/config/records')) {
      return json(listOf([{ babyName: 'Finn', birthDate: '2026-01-01', pushPublicKey: 'BKEY' }]));
    }
    if (path.includes('/collections/pushSubscriptions/records')) {
      if (init.method === 'POST' || init.method === 'PATCH') return json({ id: 'row1' });
      reads += 1;
      if (confirmFails && reads > 1) throw new TypeError('network down');
      return json(listOf(rows > 0 ? [{ id: 'row1', user: ME.id, endpoint: ENDPOINT }] : []));
    }
    if (path.includes('auth-refresh')) return json({ token: 't0ken', record: ME });
    return json({});
  };
  return calls;
}

function element(id) {
  return {
    id, hidden: false, title: '', textContent: '', disabled: false,
    attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    classes: {},
    classList: { toggle(name, on) { this.owner.classes[name] = Boolean(on); } },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}

function dom() {
  const btn = element('notifyBtn');
  const lab = element('notifyLabel');
  const nte = element('notifyNote');
  nte.hidden = true;
  btn.classList.owner = btn;
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener() {},
    getElementById: (id) => (
      id === 'notifyBtn' ? btn : id === 'notifyLabel' ? lab : id === 'notifyNote' ? nte : null
    ),
  };
  return { btn, label: lab, note: nte };
}

/** A device that is subscribed, and a count of how often it was asked to subscribe again. */
function subscribedBrowser() {
  const state = { subscribeCalls: 0 };
  const sub = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
  };
  globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'test-agent',
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => sub,
            subscribe: async () => { state.subscribeCalls += 1; return sub; },
          },
        }),
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => sub,
            subscribe: async () => { state.subscribeCalls += 1; return sub; },
          },
        }),
      },
    },
  });
  globalThis.window = { PushManager: function PushManager() {} };
  return state;
}

const { initNotifications } = await import('../js/auth.js');

test('the server holding the row is what "on" means', async () => {
  server({ rows: 1 });
  subscribedBrowser();
  const { btn, label, note } = dom();
  await initNotifications();

  assert.equal(label.textContent, 'Notifications on');
  assert.equal(btn.attrs['aria-pressed'], 'true');
  assert.equal(note.hidden, true);
});

test('subscribed here but unknown to the server is NOT "on"', async () => {
  // The exact reading that used to be a lie. The browser is subscribed, so every check the
  // bell used to make passes — and nothing would ever arrive.
  server({ rows: 0 });
  subscribedBrowser();
  const { btn, label, note } = dom();
  await initNotifications();

  assert.equal(label.textContent, 'Notifications may not arrive');
  assert.equal(btn.attrs['aria-pressed'], 'false');
  assert.equal(btn.classes['is-unconfirmed'], true);

  // Said on the screen without being asked, unlike `blocked`: nobody chose this state and
  // there is no other way to find out about it.
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /no record of it/i);
});

test('being unable to ask does not become a warning', async () => {
  // A bell that cried "broken" on every brief disconnection would be ignored within a week,
  // and then useless on the day it was right. No answer is not the same as "no".
  server({ rows: 1, confirmFails: true });
  subscribedBrowser();
  const { label, note } = dom();
  await initNotifications();

  assert.equal(label.textContent, 'Notifications on');
  assert.equal(note.hidden, true);
});

test('tapping an unconfirmed bell records it rather than subscribing twice', async () => {
  // `unconfirmed` is not "off". Falling through to the toggle would read it as "not on" and
  // hand this device a second subscription, which is how one phone becomes two rows and two
  // buzzes. The fix is to record the subscription that already exists.
  const calls = server({ rows: 0 });
  const browserState = subscribedBrowser();
  const { btn } = dom();
  await initNotifications();

  calls.length = 0;
  await btn.listeners.click();

  assert.equal(browserState.subscribeCalls, 0, 'must not subscribe a second time');
  assert.ok(
    calls.some((c) => /^(POST|PATCH) .*pushSubscriptions/.test(c)),
    `should have written the row; calls were ${JSON.stringify(calls)}`,
  );
});
