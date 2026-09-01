/// <reference path="../pb_data/types.d.ts" />

// Give pushSubscriptions a created/updated stamp.
//
// Found while trying to answer "is push working?" and being unable to tell a subscription
// made an hour ago from one made before the VAPID pair was rotated — which is precisely
// the question that matters, because rotating the key pair invalidates every subscription
// taken out under the old one. The rows were there; nothing said when.
//
// PocketBase 0.39 does NOT add created/updated by itself. They are ordinary `autodate`
// fields and a collection only has them if its migration asked for them, which
// 1756700000 did not. Nothing broke, which is why it went unnoticed: the API simply
// returns records without those keys, and `sort=created` answers 400.
//
// Backfilled as empty for the rows that already exist — there is no honest value to invent
// for them. A subscription with no `created` is one that predates this migration, which is
// itself the useful signal.

migrate(
  (app) => {
    const subs = app.findCollectionByNameOrId('pushSubscriptions');
    if (!subs.fields.getByName('created')) {
      subs.fields.add(new AutodateField({ name: 'created', onCreate: true, onUpdate: false }));
    }
    if (!subs.fields.getByName('updated')) {
      subs.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
    }
    app.save(subs);
  },

  (app) => {
    const subs = app.findCollectionByNameOrId('pushSubscriptions');
    for (const name of ['created', 'updated']) {
      const f = subs.fields.getByName(name);
      if (f) subs.fields.removeById(f.id);
    }
    app.save(subs);
  },
);
