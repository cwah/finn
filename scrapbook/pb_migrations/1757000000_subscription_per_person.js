/// <reference path="../pb_data/types.d.ts" />

// A subscription belongs to a PERSON AND a device, not to a device alone.
//
// The unique index was on `endpoint` by itself, which assumed one endpoint means one
// subscriber. It does not: a push endpoint belongs to a browser REGISTRATION, and two
// people signing into the scrapbook in the same browser — a shared tablet, a laptop on the
// kitchen table — share that registration and therefore that endpoint.
//
// With the old index that made them fight over one row. `savePushSubscription` looks the
// endpoint up first, but `pushSubscriptions.listRule` is `user = @request.auth.id`, so the
// lookup can only ever see the CALLER'S OWN rows. When the row belonged to the other
// person the lookup came back empty, the code created instead of updating, and the unique
// index rejected it — so enabling notifications threw, while the bell went on reading the
// browser's own subscription and cheerfully said "on".
//
// The result was someone turning notifications on, being told they were on, and never
// hearing anything again — and the other person's row quietly changing hands.
//
// Two rows for one device is the CORRECT answer here. Both people asked to be told. The
// service worker tags every notification the same way, so the device still shows one line.

migrate(
  (app) => {
    const subs = app.findCollectionByNameOrId('pushSubscriptions');
    subs.indexes = [
      // One row per person per device, rather than one row per device.
      'CREATE UNIQUE INDEX `idx_push_user_endpoint` ON `pushSubscriptions` (`user`, `endpoint`)',
    ];
    app.save(subs);
  },

  (app) => {
    const subs = app.findCollectionByNameOrId('pushSubscriptions');
    subs.indexes = [
      'CREATE UNIQUE INDEX `idx_push_endpoint` ON `pushSubscriptions` (`endpoint`)',
    ];
    app.save(subs);
  },
);
