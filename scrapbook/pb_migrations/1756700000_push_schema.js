/// <reference path="../pb_data/types.d.ts" />

// Step 2 of reinstating push notifications: the schema, and nothing else.
//
// No code reads any of this yet. That is the point of doing it alone — if a deploy breaks
// here, it broke on schema, and there is exactly one thing to look at.
//
// IDEMPOTENT ON PURPOSE, which is not the usual PocketBase habit. Production already has
// this collection and this field: the rollback removed the push CODE and deliberately left
// the schema, because dropping a collection destroys whatever is in it and an unused table
// costs nothing. So this must find them already there and do nothing, while still building
// them from scratch on a fresh database — a new laptop, a rebuilt container, a test run.
//
// A new filename rather than restoring `1756500000_push_subscriptions.js`, because
// PocketBase records applied migrations BY NAME and never looks at the file again. Reusing
// that name would mean production silently skipped whatever this file now says, and the
// two would drift apart with nothing to show for it.
//
// What this deliberately does NOT do: drop `users.notifyByEmail`. The original did, since
// the bell was replacing email outright. But the rollback restored the email code and it
// is live right now, so removing that field here would break a working feature to prepare
// for one that is not built yet. Email goes when the bell actually takes over, not before.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // A browser hands out a SUBSCRIPTION — an endpoint URL at the browser maker's push
    // service, plus two keys — and anyone holding that endpoint can wake the device. So it
    // is a secret, and these rules are the whole of its protection: a person may create and
    // remove their own, and may not read anyone else's.
    let subs = null;
    try {
      subs = app.findCollectionByNameOrId('pushSubscriptions');
    } catch {
      // Not there — which is the normal case everywhere except this one production box.
    }

    if (!subs) {
      app.save(new Collection({
        name: 'pushSubscriptions',
        type: 'base',
        listRule: 'user = @request.auth.id',
        viewRule: 'user = @request.auth.id',
        createRule: '@request.auth.id != "" && user = @request.auth.id',
        updateRule: 'user = @request.auth.id',
        deleteRule: 'user = @request.auth.id',
        fields: [
          {
            type: 'relation',
            name: 'user',
            required: true,
            collectionId: users.id,
            maxSelect: 1,
            cascadeDelete: true, // an account going takes its subscriptions with it
          },
          { type: 'text', name: 'endpoint', required: true, max: 1000 },
          // Not needed to send a push with no body, which is what this will do — kept so a
          // payload could be encrypted later without asking every device to re-subscribe.
          { type: 'text', name: 'p256dh', max: 200 },
          { type: 'text', name: 'auth', max: 200 },
          // What the browser called itself, so a stale subscription can be recognised.
          { type: 'text', name: 'label', max: 200 },
        ],
        indexes: [
          // One row per endpoint. A browser re-issues the same endpoint for the same device
          // and site, so without this, subscribing twice would buzz twice for one memory.
          'CREATE UNIQUE INDEX `idx_push_endpoint` ON `pushSubscriptions` (`endpoint`)',
        ],
      }));
    }

    // The VAPID public key lives on the config record rather than in the code, so rotating
    // the pair is an admin edit instead of a deploy. Public by definition — it is what
    // verifies the server's signature, and every subscription carries it.
    const config = app.findCollectionByNameOrId('config');
    if (!config.fields.getByName('pushPublicKey')) {
      config.fields.add(new TextField({ name: 'pushPublicKey', max: 200 }));
      app.save(config);
    }
  },

  (app) => {
    // Down drops only what a fresh database would have gained here. On the box where these
    // already existed this is still the right inverse: nothing reads them either way.
    try {
      app.delete(app.findCollectionByNameOrId('pushSubscriptions'));
    } catch { /* already gone */ }

    const config = app.findCollectionByNameOrId('config');
    const key = config.fields.getByName('pushPublicKey');
    if (key) {
      config.fields.removeById(key.id);
      app.save(config);
    }
  },
);
