// The push schema migration, executed rather than read.
//
//   npm test
//
// A migration is the one kind of code here that runs once, unattended, against real data,
// on a box nobody is watching. It gets no second chance and it is the hardest thing to try
// out by hand — which is exactly why this one is driven directly instead of eyeballed.
//
// Two properties, both of which have already gone wrong once in this project:
//
//   IDEMPOTENT. The rollback removed the push code and deliberately KEPT the schema, so
//   production already has this collection while a fresh database has none. One file has
//   to be right in both places.
//
//   ADDITIVE. The original version of this dropped users.notifyByEmail, because the bell
//   was replacing email. The rollback restored the email code and it is live now, so
//   dropping that field today would break a working feature to prepare for one that does
//   not exist yet. Reverting code does not revert schema; that asymmetry is what made the
//   rollback delicate, and this test is the guard against repeating it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = new URL('../pb_migrations/1756700000_push_schema.js', import.meta.url);
const RETIRE = new URL('../pb_migrations/1756800000_retire_email_flag.js', import.meta.url);
const DATES = new URL('../pb_migrations/1756900000_push_subscription_dates.js', import.meta.url);
const PERPERSON = new URL('../pb_migrations/1757000000_subscription_per_person.js', import.meta.url);

/** A PocketBase collection, as much of one as a migration touches. */
function collection(name, fieldNames = []) {
  const fields = fieldNames.map((n, i) => ({ name: n, id: `f${i}` }));
  return {
    name,
    id: `c_${name}`,
    saved: 0,
    fields: {
      getByName: (n) => fields.find((f) => f.name === n) || null,
      add: (f) => fields.push(f),
      removeById: (id) => {
        const i = fields.findIndex((f) => f.id === id);
        if (i >= 0) fields.splice(i, 1);
      },
      names: () => fields.map((f) => f.name),
    },
  };
}

/**
 * Run the migration file's up (or down) against a stub app.
 * The file calls a global `migrate(up, down)`, so it is loaded with that in place.
 */
function runMigration({ existing, direction = 'up', source = SOURCE }) {
  const created = [];
  const deleted = [];
  const app = {
    findCollectionByNameOrId(name) {
      const found = existing.find((c) => c.name === name);
      // PocketBase THROWS for a missing collection; it does not return null. The migration
      // depends on that, so the stub must behave the same way or the test proves nothing.
      if (!found) throw new Error(`no such collection: ${name}`);
      return found;
    },
    save(c) {
      if (!existing.includes(c)) { existing.push(c); created.push(c.name); }
      c.saved = (c.saved || 0) + 1;
    },
    delete(c) {
      deleted.push(c.name);
      const i = existing.indexOf(c);
      if (i >= 0) existing.splice(i, 1);
    },
  };

  let up = null;
  let down = null;
  const sandbox = {
    migrate: (u, d) => { up = u; down = d; },
    BoolField: function BoolField(spec) { return { name: spec.name, id: `b_${spec.name}` }; },
    AutodateField: function AutodateField(spec) { return { name: spec.name, id: `a_${spec.name}` }; },
    Collection: function Collection(spec) { return collection(spec.name, (spec.fields || []).map((f) => f.name)); },
    TextField: function TextField(spec) { return { name: spec.name, id: `t_${spec.name}` }; },
  };

  const src = readFileSync(source, 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('migrate', 'Collection', 'TextField', 'BoolField', 'AutodateField', src)(
    sandbox.migrate, sandbox.Collection, sandbox.TextField, sandbox.BoolField,
    sandbox.AutodateField,
  );

  (direction === 'up' ? up : down)(app);
  return { created, deleted, existing };
}

/** A database that has never seen push. */
const freshDb = () => [
  collection('users', ['name', 'notifyByEmail']),
  collection('config', ['babyName', 'birthDate']),
];

/** Production after the rollback: push schema kept, email code live. */
const productionDb = () => [
  collection('users', ['name', 'notifyByEmail']),
  collection('config', ['babyName', 'birthDate', 'pushPublicKey']),
  collection('pushSubscriptions', ['user', 'endpoint', 'p256dh', 'auth', 'label']),
];

test('a fresh database gains the collection and the key field', () => {
  const { created, existing } = runMigration({ existing: freshDb() });
  assert.ok(created.includes('pushSubscriptions'));
  assert.ok(existing.find((c) => c.name === 'config').fields.getByName('pushPublicKey'));
});

test('running it where the schema already exists changes nothing', () => {
  // THE IDEMPOTENCE CASE. Production kept the collection through the rollback. A migration
  // that tried to create it again would fail the deploy on a unique-name conflict.
  const { created } = runMigration({ existing: productionDb() });
  assert.deepEqual(created, [], 'nothing should be created a second time');
});

test('running it twice in a row is the same as running it once', () => {
  const db = freshDb();
  runMigration({ existing: db });
  const { created } = runMigration({ existing: db });
  assert.deepEqual(created, []);
});

test('users.notifyByEmail SURVIVES — email is still the live feature', () => {
  // THE REGRESSION. The original migration dropped this. Doing so now would break the
  // notifier that the rollback restored, in service of a bell that is not built yet.
  for (const db of [freshDb(), productionDb()]) {
    const { existing } = runMigration({ existing: db });
    const users = existing.find((c) => c.name === 'users');
    assert.ok(users.fields.getByName('notifyByEmail'), 'the email opt-in must remain');
  }
});

test('the subscription endpoint is unique, so one device cannot buzz twice', () => {
  const src = readFileSync(SOURCE, 'utf8');
  assert.match(src, /CREATE UNIQUE INDEX[^\n]*endpoint/);
});

test('a subscription is readable only by the person it belongs to', () => {
  // The endpoint is a capability to wake someone's phone. Every rule must be owner-scoped.
  const src = readFileSync(SOURCE, 'utf8');
  for (const rule of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) {
    const m = src.match(new RegExp(`${rule}:\\s*'([^']*)'`));
    assert.ok(m, `${rule} must be set — an unset rule is PUBLIC`);
    assert.match(m[1], /user = @request\.auth\.id/, `${rule} must be owner-scoped`);
  }
});

test('down removes what up added', () => {
  const db = freshDb();
  runMigration({ existing: db });
  const { deleted, existing } = runMigration({ existing: db, direction: 'down' });
  assert.ok(deleted.includes('pushSubscriptions'));
  assert.equal(existing.find((c) => c.name === 'config').fields.getByName('pushPublicKey'), null);
});

test('down leaves the email opt-in alone as well', () => {
  const db = freshDb();
  runMigration({ existing: db });
  const { existing } = runMigration({ existing: db, direction: 'down' });
  assert.ok(existing.find((c) => c.name === 'users').fields.getByName('notifyByEmail'));
});


// ── Retiring the email flag (1756800000) ──────────────────────────
// Ordering is the point. 1756700000 deliberately kept notifyByEmail alive because the
// rollback had restored the email code and it was still the live feature; this drops it
// only now that the bell has replaced it. Getting these two the wrong way round would
// break a working feature to prepare for one that did not exist yet — which is exactly
// what the original single migration did.

test('retiring drops the email flag', () => {
  const { existing } = runMigration({ existing: freshDb(), source: RETIRE });
  assert.equal(existing.find((c) => c.name === 'users').fields.getByName('notifyByEmail'), null);
});

test('retiring is safe to run twice', () => {
  const db = freshDb();
  runMigration({ existing: db, source: RETIRE });
  assert.doesNotThrow(() => runMigration({ existing: db, source: RETIRE }));
});

test('retiring restores the flag on the way down', () => {
  const db = freshDb();
  runMigration({ existing: db, source: RETIRE });
  runMigration({ existing: db, direction: 'down', source: RETIRE });
  assert.ok(db.find((c) => c.name === 'users').fields.getByName('notifyByEmail'));
});

test('the two migrations run in order leave push schema up and email gone', () => {
  // The end state this whole sequence was aiming at, asserted as one thing.
  const db = freshDb();
  runMigration({ existing: db });                    // 1756700000: add push schema
  runMigration({ existing: db, source: RETIRE });    // 1756800000: drop email flag
  assert.ok(db.find((c) => c.name === 'pushSubscriptions'), 'push schema present');
  assert.ok(db.find((c) => c.name === 'config').fields.getByName('pushPublicKey'));
  assert.equal(db.find((c) => c.name === 'users').fields.getByName('notifyByEmail'), null);
});

test('running them in the WRONG order still ends correctly', () => {
  // Defensive: PocketBase applies by filename order, but a hand-run or a future rename
  // should not silently leave the email flag behind.
  const db = freshDb();
  runMigration({ existing: db, source: RETIRE });
  runMigration({ existing: db });
  assert.equal(db.find((c) => c.name === 'users').fields.getByName('notifyByEmail'), null,
    '1756700000 must not resurrect the flag it never owned');
});


// ── created/updated on subscriptions (1756900000) ─────────────────
// PocketBase 0.39 does not add these by itself; a collection has them only if its
// migration asked. 1756700000 did not, and nothing broke — the API just returns records
// without them and `sort=created` answers 400. It surfaced as being unable to tell a
// subscription made an hour ago from one made before the VAPID pair was rotated, which is
// the question that decides whether a subscription is still valid at all.

test('subscriptions gain created and updated', () => {
  const db = [
    collection('users', ['name']),
    collection('config', ['babyName']),
    collection('pushSubscriptions', ['user', 'endpoint', 'p256dh', 'auth', 'label']),
  ];
  runMigration({ existing: db, source: DATES });
  const subs = db.find((c) => c.name === 'pushSubscriptions');
  assert.ok(subs.fields.getByName('created'), 'created must exist');
  assert.ok(subs.fields.getByName('updated'), 'updated must exist');
});

test('it is safe to run twice', () => {
  const db = [
    collection('users', ['name']),
    collection('config', ['babyName']),
    collection('pushSubscriptions', ['user', 'endpoint']),
  ];
  runMigration({ existing: db, source: DATES });
  runMigration({ existing: db, source: DATES });
  const names = db.find((c) => c.name === 'pushSubscriptions').fields.names();
  assert.equal(names.filter((n) => n === 'created').length, 1, 'not added twice');
});

test('a fresh database ends with dated subscriptions too', () => {
  // The three migrations in filename order, which is the order PocketBase applies them.
  const db = freshDb();
  runMigration({ existing: db });
  runMigration({ existing: db, source: RETIRE });
  runMigration({ existing: db, source: DATES });
  const subs = db.find((c) => c.name === 'pushSubscriptions');
  assert.ok(subs.fields.getByName('created'));
  assert.equal(db.find((c) => c.name === 'users').fields.getByName('notifyByEmail'), null);
});


// ── One subscription per PERSON per device (1757000000) ───────────
// REPORTED: one account's notifications kept turning themselves off after being enabled.
//
// The unique index was on `endpoint` alone, which assumes one endpoint means one
// subscriber. A push endpoint belongs to a browser REGISTRATION, so two people signing in
// on the same browser share it. `savePushSubscription` looks the endpoint up first, but
// `listRule` is `user = @request.auth.id` — so the lookup only ever sees the caller's own
// rows. When the row belonged to the other person it came back empty, the code created
// rather than updated, and the unique index refused it. Enabling threw; the bell went on
// reading the browser's own subscription and said "on".

test('the index is per person AND endpoint, not endpoint alone', () => {
  const src = readFileSync(PERPERSON, 'utf8');
  assert.match(src, /CREATE UNIQUE INDEX[^\n]*\(`user`, `endpoint`\)/);
});

test('the old endpoint-only index is gone', () => {
  const db = [
    collection('users', ['name']),
    collection('config', ['babyName']),
    collection('pushSubscriptions', ['user', 'endpoint']),
  ];
  const before = db.find((c) => c.name === 'pushSubscriptions');
  before.indexes = ['CREATE UNIQUE INDEX `idx_push_endpoint` ON `pushSubscriptions` (`endpoint`)'];
  runMigration({ existing: db, source: PERPERSON });
  const after = db.find((c) => c.name === 'pushSubscriptions');
  const joined = (after.indexes || []).join(' ');
  assert.doesNotMatch(joined, /idx_push_endpoint`? ON `pushSubscriptions` \(`endpoint`\)/,
    'the endpoint-only index must not survive — it is what made two people fight over one row');
  assert.match(joined, /user`, `endpoint/);
});

test('down restores the endpoint-only index', () => {
  const db = [
    collection('users', ['name']),
    collection('config', ['babyName']),
    collection('pushSubscriptions', ['user', 'endpoint']),
  ];
  runMigration({ existing: db, source: PERPERSON });
  runMigration({ existing: db, direction: 'down', source: PERPERSON });
  assert.match((db.find((c) => c.name === 'pushSubscriptions').indexes || []).join(' '), /\(`endpoint`\)/);
});

test('the client asks the question the rules can answer', () => {
  // The lookup has to be scoped to the person, or it cannot see its own row reliably and
  // the upsert turns into a create that the index rejects.
  const dataPb = readFileSync(new URL('../js/data-pb.js', import.meta.url), 'utf8');
  const fn = dataPb.match(/export async function savePushSubscription[\s\S]*?\n\}/)[0];
  assert.match(fn, /user=\$\{pb\.quote\(me\.id\)\} && endpoint=/);
});
