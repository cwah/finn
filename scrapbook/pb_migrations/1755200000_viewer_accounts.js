/// <reference path="../pb_data/types.d.ts" />

// Viewer accounts: people who can see the scrapbook but not add to it.
//
// Until now "signed in" and "may post" were the same thing — posts.createRule was simply
// `@request.auth.id != ""`. That was fine while the only accounts were two parents and a
// bot, but it means any account handed out to a grandparent could also write.
//
// `canPost` splits the two. Everything else already followed from authorship and needs no
// change: posts and photos are update/delete-scoped to their author, and a viewer authors
// nothing, so there is nothing for them to edit either.
//
// THE BACKFILL IS THE WHOLE RISK HERE. A new `bool` field reads back as FALSE on every
// existing row — the same trap that once cropped the oldest photos to their top-left
// corner (see 1754600000_backfill_focal_centre). Adding this field without the UPDATE
// below would revoke posting from both parents AND the Telegram bot, and the failure
// would look like the app quietly breaking rather than like a permissions change.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new BoolField({ name: 'canPost' }));
    app.save(users);

    // Every account that exists today is a parent or the bot, and all of them post.
    // New accounts default to false, which is the right way round: a viewer is created
    // by doing nothing, and posting is granted deliberately.
    app.db().newQuery('UPDATE users SET canPost = 1').execute();

    // Creating is now a privilege rather than a consequence of being signed in.
    const posts = app.findCollectionByNameOrId('posts');
    posts.createRule = '@request.auth.id != "" && @request.auth.canPost = true';
    app.save(posts);

    // Photos matter as much as posts: photos.createRule is deliberately NOT author-scoped
    // (the bot attaches photos to a parent's post), so without this a viewer could still
    // add photos to someone else's memory.
    const photos = app.findCollectionByNameOrId('photos');
    photos.createRule = '@request.auth.id != "" && @request.auth.canPost = true';
    app.save(photos);
  },

  (app) => {
    const posts = app.findCollectionByNameOrId('posts');
    posts.createRule = '@request.auth.id != ""';
    app.save(posts);

    const photos = app.findCollectionByNameOrId('photos');
    photos.createRule = '@request.auth.id != ""';
    app.save(photos);

    const users = app.findCollectionByNameOrId('users');
    const field = users.fields.getByName('canPost');
    if (field) users.fields.removeById(field.id);
    app.save(users);
  },
);
