/// <reference path="../pb_data/types.d.ts" />

// Sign in with a username OR an email address.
//
// PocketBase 0.23 dropped `username` from auth collections, so there is no such field to
// switch to — it has to be added, filled, made unique, and only then named as something
// people can log in with.
//
// Both are accepted, deliberately. A username is what these two will type; the email is
// the way back in when one of them cannot remember it, and PocketBase is happy to try
// each in turn. Narrowing to `['username']` later is a one-line change.
//
// THE ORDER BELOW IS LOAD-BEARING. A new `text` field reads back as an empty string on
// every existing row — the same trap as `canPost` reading false and a `number` reading 0,
// except it bites three ways at once:
//
//   Create the unique index before the backfill and it collides with itself, because
//   every row shares the same empty username.
//   Name it in identityFields before the backfill and every account's identity is '',
//   so nobody can sign in.
//   Mark it required before the backfill and every existing row is invalid.
//
// So: add the field, fill it, then constrain it.
//
// EVERY STEP IS CONDITIONAL, because this schema may already exist. The change was made
// by hand in the production admin UI before this migration ever ran there, and a
// migration that assumes it is the only way a column can appear will fail on startup —
// which on a container platform means a deploy that will not come up at all. Doing
// nothing where there is nothing to do is the whole point.
//
// "Conditional" has to mean conditional on the SHAPE, not on the names this file would
// have used. The first attempt checked for its own index name, found nothing, added a
// second index over a column that already had one, and Render refused the deploy. What
// already exists was not put there by this file and does not look like it.
//
// Usernames are derived from the email local part — catherine@… becomes `catherine` —
// which is predictable, is what these two would have picked, and is trivially changed
// afterwards in the admin UI.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // 1. The field, permissive for now: every existing row is about to be empty.
    if (!users.fields.getByName('username')) {
      users.fields.add(new TextField({ name: 'username', max: 64 }));
      app.save(users);
    }

    // 2. Fill it, before anything depends on it being unique or present. Scoped to rows
    //    that need it, so a username someone chose by hand is never overwritten.
    app.db().newQuery(`
      UPDATE users
         SET username = lower(substr(email, 1, instr(email, '@') - 1))
       WHERE username = '' OR username IS NULL
    `).execute();

    // 3. Now it can carry the constraints. The index has to exist before PocketBase will
    //    accept the field as an identity — an identity that is not unique is not one.
    const fresh = app.findCollectionByNameOrId('users');
    const field = fresh.fields.getByName('username');
    if (field) field.required = true;

    // Matched on the COLUMN, never on the name. An index over `username` may already
    // exist under a name PocketBase generated for itself when the field was added by
    // hand, and a second definition over the same column is rejected outright:
    //
    //   failed to apply migration ...: indexes: (4: The index definition already exists..)
    //
    // Which is precisely what a name-based check missed, because the names differ.
    const coversUsername = (sql) => /\busername\b/i.test(String(sql));
    if (!fresh.indexes.some(coversUsername)) {
      fresh.indexes = [
        ...fresh.indexes,
        'CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`)',
      ];
    }

    // Username first: it is what the form asks for, and PocketBase tries them in order.
    fresh.passwordAuth.identityFields = ['username', 'email'];
    app.save(fresh);
  },

  (app) => {
    const users = app.findCollectionByNameOrId('users');
    // Email first, or the collection is momentarily left with an identity field that is
    // about to be deleted.
    users.passwordAuth.identityFields = ['email'];
    users.indexes = users.indexes.filter((i) => !i.includes('idx_users_username'));
    app.save(users);

    const fresh = app.findCollectionByNameOrId('users');
    const field = fresh.fields.getByName('username');
    if (field) fresh.fields.removeById(field.id);
    app.save(fresh);
  },
);
