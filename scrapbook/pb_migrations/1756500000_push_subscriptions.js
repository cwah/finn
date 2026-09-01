/// <reference path="../pb_data/types.d.ts" />

// Push notifications, in place of email.
//
// A browser hands out a SUBSCRIPTION — an endpoint URL at the browser maker's push service,
// plus two keys — and anyone holding that endpoint can wake the device. So it is a secret,
// and the rules below are the whole of its protection: a person may create and remove their
// own, and may not read anyone else's.
//
// The endpoint is unique. Browsers re-issue the same one for the same device and site, so
// subscribing twice must update rather than accumulate, or one post becomes two buzzes.
//
// `notifyByEmail` goes: the bell replaces it, and a field the UI no longer touches is the
// kind of thing that confuses the next reader into thinking there are two systems.
// `posts.notifiedAt` STAYS — it means "this post has been announced", which is as true of a
// push as it was of an email, and dropping it would re-announce everything within the
// 24-hour window on the next deploy.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    const subs = new Collection({
      name: 'pushSubscriptions',
      type: 'base',
      // Own rows only. The endpoint is a capability to wake someone's phone; there is no
      // reason for one account to see another's, and every reason not to.
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
        // Not needed to send a push with no body, which is what this does — kept so a
        // payload could be encrypted later without asking every device to re-subscribe.
        { type: 'text', name: 'p256dh', max: 200 },
        { type: 'text', name: 'auth', max: 200 },
        // What the browser called itself, so a stale subscription can be recognised.
        { type: 'text', name: 'label', max: 200 },
      ],
      indexes: [
        // One row per endpoint. A browser re-issues the same endpoint for the same device,
        // so without this, subscribing twice would buzz twice for one memory.
        'CREATE UNIQUE INDEX `idx_push_endpoint` ON `pushSubscriptions` (`endpoint`)',
      ],
    });
    app.save(subs);

    // The VAPID public key lives on the config record rather than in the code, so
    // rotating the key pair is an admin edit instead of a deploy. Public by definition —
    // it is what verifies the server's signature, and every subscription carries it.
    const config = app.findCollectionByNameOrId('config');
    if (!config.fields.getByName('pushPublicKey')) {
      config.fields.add(new TextField({ name: 'pushPublicKey', max: 200 }));
      app.save(config);
    }

    // Email is replaced, not kept alongside.
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
    const config = app.findCollectionByNameOrId('config');
    const key = config.fields.getByName('pushPublicKey');
    if (key) { config.fields.removeById(key.id); app.save(config); }

    const subs = app.findCollectionByNameOrId('pushSubscriptions');
    if (subs) app.delete(subs);
  },
);
