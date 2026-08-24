/// <reference path="../pb_data/types.d.ts" />

// Sign in with a username instead of an email address.
//
// PocketBase 0.23 dropped `username` from auth collections, so there is no such field to
// switch to — it has to be added, filled, made unique, and only then named as the thing
// people log in with.
//
// THE ORDER BELOW IS LOAD-BEARING. A new `text` field reads back as an empty string on
// every existing row — the same shape of trap as `canPost` reading false and a `number`
// reading 0. Three consequences follow, and each one breaks a different way:
//
//   Create the unique index before the backfill and it collides with itself, because
//   every row shares the same empty username.
//   Set identityFields before the backfill and nobody can sign in at all, since every
//   account's identity is the empty string.
//   Mark the field required before the backfill and existing rows are invalid.
//
// So: add the field, fill it, then make it unique, required, and the identity.
//
// Usernames are derived from the email local part — catherine@… becomes `catherine` —
// which is predictable, matches what these two people would have picked, and is trivially
// changed afterwards in the admin UI.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // 1. The field, permissive for now: every existing row is about to be empty.
    users.fields.add(new TextField({ name: 'username', max: 64 }));
    app.save(users);

    // 2. Fill it, before anything depends on it being unique or present.
    app.db().newQuery(`
      UPDATE users
         SET username = lower(substr(email, 1, instr(email, '@') - 1))
       WHERE username = '' OR username IS NULL
    `).execute();

    // 3. Now it can carry the constraints. The index has to exist before PocketBase will
    //    accept the field as an identity — an identity that is not unique is not one.
    const fresh = app.findCollectionByNameOrId('users');
    const field = fresh.fields.getByName('username');
    field.required = true;
    fresh.indexes = [
      ...fresh.indexes,
      'CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`)',
    ];
    fresh.passwordAuth.identityFields = ['username'];
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
