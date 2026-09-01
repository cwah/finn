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
function runMigration({ existing, direction = 'up' }) {
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
    Collection: function Collection(spec) { return collection(spec.name, (spec.fields || []).map((f) => f.name)); },
    TextField: function TextField(spec) { return { name: spec.name, id: `t_${spec.name}` }; },
  };

  const src = readFileSync(SOURCE, 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('migrate', 'Collection', 'TextField', src)(
    sandbox.migrate, sandbox.Collection, sandbox.TextField,
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
