/// <reference path="../pb_data/types.d.ts" />

// Email when a new memory is posted.
//
// Two fields, and the interesting decision is the default.
//
//   users.notifyByEmail  whether this person wants the mail.
//   posts.notifiedAt     when it was sent, so it is sent once. Empty means "not yet".
//
// OPT-IN, NOT OPT-OUT. A new `bool` reads back as false on every existing row, and here
// that is exactly what should happen: nobody is signed up for email by a deploy. This is
// the opposite of `canPost`, where the same false backfill would have revoked posting from
// both parents and needed repairing in the same migration — the rule is not "always
// backfill a bool", it is "work out what false MEANS for this field". False here means
// "has not asked to be emailed", which is true of everyone until they say otherwise.
//
// So there is deliberately no backfill, and the feature does nothing at all until someone
// turns it on. That is the right way round for anything that sends mail.
//
// `notifiedAt` is a date and empty on every existing row, which reads as "never notified".
// Combined with the hook's own window — it only looks at posts created in the last day —
// that means turning this on cannot mail anyone about the entire back catalogue.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    if (!users.fields.getByName('notifyByEmail')) {
      users.fields.add(new BoolField({ name: 'notifyByEmail' }));
      app.save(users);
    }

    const posts = app.findCollectionByNameOrId('posts');
    if (!posts.fields.getByName('notifiedAt')) {
      posts.fields.add(new DateField({ name: 'notifiedAt' }));
      app.save(posts);
    }
  },

  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const flag = users.fields.getByName('notifyByEmail');
    if (flag) { users.fields.removeById(flag.id); app.save(users); }

    const posts = app.findCollectionByNameOrId('posts');
    const stamp = posts.fields.getByName('notifiedAt');
    if (stamp) { posts.fields.removeById(stamp.id); app.save(posts); }
  },
);
