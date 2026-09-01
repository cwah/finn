// Where the app decides the API lives.
//
//   npm test
//
// THE BUG, and it was sticky in the worst way. resolveApiBase() probed the page's own
// origin once and REMEMBERED the answer for the life of the page. The probe can fail for
// reasons that have nothing to do with where the API is — a service worker claiming the
// page mid-flight, a second without signal, a redeploy — and any failure pinned the base
// to `http://<host>:8090`. On an https page that address is mixed content, which the
// browser blocks outright, and nothing is listening on it anyway. So every request after
// one unlucky probe failed, and kept failing, and the app said it could not reach a server
// that was up and answering the whole time.
//
// On https the question has only one valid answer, so it is no longer asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Load pb.js fresh with a given page location, so the module-level cache starts empty. */
async function freshPb({ protocol, hostname, health }) {
  globalThis.location = { protocol, hostname, origin: `${protocol}//${hostname}` };
  globalThis.localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  let probes = 0;
  globalThis.fetch = async (url) => {
    probes += 1;
    if (health === 'throw') throw new TypeError('Failed to fetch');
    return { ok: health === 'ok', status: health === 'ok' ? 200 : 404, json: async () => ({}) };
  };
  // A distinct query each time defeats the ES-module cache.
  const mod = await import(`../js/pb.js?t=${Math.random()}`);
  return { mod, probes: () => probes };
}

test('on https the base is same-origin, without asking', async () => {
  const { mod, probes } = await freshPb({ protocol: 'https:', hostname: 'finn.example.com', health: 'ok' });
  assert.equal(await mod.resolveApiBase(), '');
  assert.equal(probes(), 0, 'nothing to ask — the answer cannot be anything else');
});

test('a failed probe can no longer strand an https page on :8090', async () => {
  // The exact failure. Before this, one rejected fetch pinned the base to a blocked
  // mixed-content URL and the app never recovered, not even across reloads.
  const { mod } = await freshPb({ protocol: 'https:', hostname: 'finn.example.com', health: 'throw' });
  const base = await mod.resolveApiBase();
  assert.equal(base, '');
  assert.doesNotMatch(base, /8090/);
  assert.doesNotMatch(base, /^http:/, 'never plain http from an https page');
});

test('local http dev still finds PocketBase on its own port', async () => {
  // The arrangement the probe exists for: frontend on serve.py, PocketBase separate.
  const { mod } = await freshPb({ protocol: 'http:', hostname: 'localhost', health: '404' });
  assert.equal(await mod.resolveApiBase(), 'http://localhost:8090');
});

test('a local container serving its own page is same-origin', async () => {
  const { mod } = await freshPb({ protocol: 'http:', hostname: '127.0.0.1', health: 'ok' });
  assert.equal(await mod.resolveApiBase(), '');
});

test('the answer is worked out once and reused', async () => {
  const { mod, probes } = await freshPb({ protocol: 'http:', hostname: 'localhost', health: 'ok' });
  await mod.resolveApiBase();
  await mod.resolveApiBase();
  await mod.resolveApiBase();
  assert.equal(probes(), 1);
});
