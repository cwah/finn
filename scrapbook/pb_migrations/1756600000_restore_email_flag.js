/// <reference path="../pb_data/types.d.ts" />

// Put users.notifyByEmail back, after the push-notification rollback.
//
// Reverting the CODE does not revert the DATABASE. `1756500000_push_subscriptions.js`
// dropped this field, and deleting that file from the repo does not undo it: PocketBase
// records a migration as applied and never looks at the file again. So the restored email
// code would have been reading and writing a column that is not there — getConfig() would
// have reported everyone as opted out, and the toggle would have failed with a 400.
//
// Forward, not a revert of the old file, for the same reason: `1756400000` is recorded as
// applied and will not run again, whatever its contents.
//
// Deliberately additive. `pushSubscriptions` and `config.pushPublicKey` are LEFT ALONE:
// nothing reads them once the push code is gone, dropping a collection destroys whatever
// is in it, and leaving them makes reinstating push a matter of restoring code rather than
// rebuilding schema. An unused table costs nothing; a dropped one cannot be un-dropped.
//
// Everyone comes back opted OUT, which is the same choice the field was created with: a
// notification nobody asked for is worse than one nobody gets, and the people who want it
// can say so.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    if (!users.fields.getByName('notifyByEmail')) {
      users.fields.add(new BoolField({ name: 'notifyByEmail' }));
      app.save(users);
    }
  },

  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const flag = users.fields.getByName('notifyByEmail');
    if (flag) { users.fields.removeById(flag.id); app.save(users); }
  },
);
