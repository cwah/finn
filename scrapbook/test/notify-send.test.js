// The notifier, as an assembly.
//
//   npm test
//
// The rule had tests and the VAPID maths had tests; what had none was the thing that
// actually runs, and it shipped broken twice — once reading `created` with getString and
// getting nothing, once calling a top-level function a PocketBase hook handler cannot see.
// Both were invisible to unit tests of the parts.
//
// PocketBase's globals are stubbed here. That cannot reproduce the JSVM's scoping, so the
// second failure is guarded structurally instead: notify.pb.js must define nothing of its
// own, because anything it defines is exactly what a handler cannot reach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
const HOOKS = new URL('../../deploy/pb_hooks/', import.meta.url).pathname;

/** A PocketBase record, as much of one as this code touches. */
function record(fields) {
  return {
    id: fields.id || 'rec1',
    get: (name) => fields[name],
    getBool: (name) => Boolean(fields[name]),
    set: (name, value) => { fields[name] = value; },
  };
}

/**
 * A well-formed ECDSA P-256 signature, as openssl would leave it on disk:
 * SEQUENCE { INTEGER r, INTEGER s }, 32 bytes each, high bit clear so neither needs
 * the padding byte. Zeroes will not do — derToJose parses this, and rightly refuses
 * anything that is not really DER.
 */
function derSignature() {
  const r = Array.from({ length: 32 }, (_, i) => (i + 1) & 0x7f);
  const s = Array.from({ length: 32 }, (_, i) => (i + 64) & 0x7f);
  return new Uint8Array([0x30, 0x44, 0x02, 0x20, ...r, 0x02, 0x20, ...s]);
}

/** Install the JSVM globals the module expects, and collect what it did. */
function stubJsvm({ posts = [], subs = [], send = () => ({ statusCode: 201 }), env = {} } = {}) {
  const log = [];
  const saved = [];
  const deleted = [];

  globalThis.__hooks = HOOKS.replace(/\/$/, '');
  globalThis.$app = {
    findRecordsByFilter: (collection) => (collection === 'posts' ? posts : subs),
    save: (rec) => saved.push(rec),
    delete: (rec) => deleted.push(rec),
  };
  globalThis.$os = {
    getenv: (k) => env[k] || '',
    tempDir: () => '/tmp',
    writeFile: () => {},
    readFile: () => derSignature(),
    remove: () => {},
    cmd: () => ({ output: () => '' }),
  };
  globalThis.$http = { send };
  globalThis.DateTime = class { toString() { return 'now'; } };
  globalThis.toString = (v) => String(v);
  globalThis.console = { ...console, log: (...a) => log.push(a.map(String).join(' ')) };

  return { log, saved, deleted };
}

const MINUTE = 60 * 1000;
const pbTime = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '.000Z');

/** A post that qualifies: settled, dated today, unsent. */
const duePost = (over = {}) => record({
  id: 'post1',
  created: pbTime(Date.now() - 10 * MINUTE),
  memoryDate: pbTime(Date.now()),
  notifiedAt: '',
  author: 'author1',
  caption: 'First banana',
  ...over,
});

const subscription = (user, endpoint) => record({
  id: `sub-${user}`, user, endpoint: endpoint || 'https://fcm.googleapis.com/fcm/send/abc',
});

// ── The structural guard ──────────────────────────────────────────
test('the hook file defines NOTHING of its own', () => {
  // THE BUG. A hook handler runs in a pooled runtime that cannot see its file's top-level
  // scope, so anything declared there and called from the handler throws "not defined".
  // The only safe shape is a handler that requires what it needs. A stub cannot reproduce
  // that scoping, so the shape is what gets asserted.
  const src = readFileSync(new URL('../../deploy/pb_hooks/notify.pb.js', import.meta.url), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');   // comments may say anything
  assert.doesNotMatch(code, /^\s*function\s+\w+/m, 'no top-level function declarations');
  assert.doesNotMatch(code, /^\s*(const|let|var)\s+\w+\s*=/m, 'no top-level bindings either');
  assert.match(code, /require\(`\$\{__hooks\}\//, 'the handler must require what it needs');
});

// ── The assembly ──────────────────────────────────────────────────
test('run() is exported and survives a tick with nothing to do', () => {
  stubJsvm({ posts: [] });
  const { run } = require_(`${HOOKS}notify-send.js`);
  assert.equal(typeof run, 'function');
  run(); // must not throw
});

test('a due post with a subscriber sends and is marked', () => {
  const post = duePost();
  const { saved, log } = stubJsvm({
    posts: [post],
    subs: [subscription('someone-else')],
    env: { VAPID_PRIVATE_KEY: 'pem', VAPID_PUBLIC_KEY: 'pub', VAPID_SUBJECT: 'mailto:a@b.c' },
  });
  require_(`${HOOKS}notify-send.js`).run();

  assert.equal(saved.length, 1, 'the post must be marked once sent');
  assert.notEqual(post.get('notifiedAt'), '', 'notifiedAt must be set');
  assert.ok(log.some((l) => l.includes('1 post(s) due')), log.join('\n'));
});

test('the author is not sent their own post', () => {
  const post = duePost();
  const { saved } = stubJsvm({
    posts: [post],
    subs: [subscription('author1')],   // the author, and nobody else
    env: { VAPID_PRIVATE_KEY: 'pem', VAPID_PUBLIC_KEY: 'pub' },
  });
  require_(`${HOOKS}notify-send.js`).run();
  // Marked anyway: with nobody to tell, re-examining it every minute until it ages out
  // would be the only other outcome.
  assert.equal(saved.length, 1);
});

test('a 410 drops the dead subscription', () => {
  // The browser has thrown it away. Keeping it means retrying a dead endpoint every minute
  // for as long as the post is in the window.
  const { deleted } = stubJsvm({
    posts: [duePost()],
    subs: [subscription('someone-else')],
    send: () => ({ statusCode: 410, body: 'gone' }),
    env: { VAPID_PRIVATE_KEY: 'pem', VAPID_PUBLIC_KEY: 'pub' },
  });
  require_(`${HOOKS}notify-send.js`).run();
  assert.equal(deleted.length, 1, 'a 410 must remove the subscription');
});

test('an ordinary failure leaves the post unmarked, to retry', () => {
  const post = duePost();
  const { saved, deleted } = stubJsvm({
    posts: [post],
    subs: [subscription('someone-else')],
    send: () => ({ statusCode: 503, body: 'try later' }),
    env: { VAPID_PRIVATE_KEY: 'pem', VAPID_PUBLIC_KEY: 'pub' },
  });
  require_(`${HOOKS}notify-send.js`).run();
  assert.equal(deleted.length, 0, 'a 503 is not a dead subscription');
  assert.equal(saved.length, 0, 'nothing got through, so it must be tried again');
});

test('missing VAPID keys fail the send rather than the tick', () => {
  const post = duePost();
  const { saved } = stubJsvm({ posts: [post], subs: [subscription('someone-else')], env: {} });
  require_(`${HOOKS}notify-send.js`).run();   // must not throw
  assert.equal(saved.length, 0, 'unconfigured means nothing sent and nothing marked');
});

test('a backfilled post is never sent', () => {
  const old = duePost({ memoryDate: pbTime(Date.now() - 30 * 24 * 3600 * 1000) });
  const { saved, log } = stubJsvm({
    posts: [old],
    subs: [subscription('someone-else')],
    env: { VAPID_PRIVATE_KEY: 'pem', VAPID_PUBLIC_KEY: 'pub' },
  });
  require_(`${HOOKS}notify-send.js`).run();
  assert.equal(saved.length, 0);
  assert.ok(log.some((l) => l.includes('disagree')), 'the filter/rule mismatch must be loud');
});
