/// <reference path="../pb_data/types.d.ts" />

// Step 5: email is gone, so its opt-in goes with it.
//
// This is the drop that 1756700000 deliberately did NOT do. The order matters and is the
// whole reason push went back in piece by piece: the field had to survive until the bell
// actually replaced it, because the rollback had restored the email code and it was live.
// Now nothing reads `notifyByEmail` — no toggle, no data-layer function, no hook — and a
// field the UI never touches is exactly the sort of thing that convinces the next reader
// there are two notification systems.
//
// Nothing is lost with it. The restore migration re-added the flag as a fresh bool, so
// every account has been false since; there is no opted-in population to strip.
//
// `posts.notifiedAt` STAYS. It means "this post has been announced", which is as true of a
// push as it was of an email, and dropping it would re-announce every post inside the
// 24-hour window on the next deploy.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const flag = users.fields.getByName('notifyByEmail');
    if (flag) {
      users.fields.removeById(flag.id);
      app.save(users);
    }
  },

  (app) => {
    const users = app.findCollectionByNameOrId('users');
    if (!users.fields.getByName('notifyByEmail')) {
      users.fields.add(new BoolField({ name: 'notifyByEmail' }));
      app.save(users);
    }
  },
);
