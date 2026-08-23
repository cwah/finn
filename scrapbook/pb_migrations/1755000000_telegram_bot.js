/// <reference path="../pb_data/types.d.ts" />

// Everything the Telegram bot needs, plus a hole it made visible.
//
// 1. users.telegramId — maps a Telegram sender to the parent it belongs to, so a memory
//    sent from a phone is attributed to the person who sent it rather than to "the bot".
//    Editable in the admin UI, which is where accounts are managed anyway.
//
// 2. users createRule -> superuser only. PocketBase ships auth collections with PUBLIC
//    signup (an empty rule). For a private scrapbook that is a hole: anyone who could
//    reach the API could create an account and then read every memory, because the read
//    rules only ask that you are signed in. It has been open since Phase 2 and only
//    mattered while the server stayed on localhost. Closing it before a bot starts
//    talking to the outside world.
//
// 3. photos createRule -> any signed-in account, matching posts.
//    The bot signs in as its own account but writes posts authored BY a parent, so
//    `post.author = @request.auth.id` would reject its photos. This is the same trade
//    already made for posts: with an audience of two who trust each other, restricting
//    who may ATTACH a photo buys nothing. Update and delete stay author-scoped, so the
//    boundary that matters — nobody rewrites anyone else's memories — is untouched.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new TextField({ name: 'telegramId', max: 32 }));
    users.createRule = null;
    users.indexes = [
      ...users.indexes,
      'CREATE UNIQUE INDEX `idx_users_telegramId` ON `users` (`telegramId`) WHERE `telegramId` != \'\'',
    ];
    app.save(users);

    const photos = app.findCollectionByNameOrId('photos');
    photos.createRule = '@request.auth.id != ""';
    app.save(photos);
  },

  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const field = users.fields.getByName('telegramId');
    if (field) users.fields.removeById(field.id);
    users.createRule = '';
    users.indexes = users.indexes.filter((i) => !i.includes('idx_users_telegramId'));
    app.save(users);

    const photos = app.findCollectionByNameOrId('photos');
    photos.createRule = 'post.author = @request.auth.id';
    app.save(photos);
  },
);
