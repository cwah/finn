/// <reference path="../pb_data/types.d.ts" />

// Only the parent who wrote a memory can change or remove it.
//
// Until now update and delete were open to either signed-in parent, which was fine when
// nothing in the app could edit. Now that it can, the rule needs to mean something: the
// author is recorded per post precisely so attribution is real, and edits should respect
// that rather than letting one parent quietly rewrite the other's words.
//
// Photos are scoped through their post's author, so the same boundary covers the photos
// attached to a memory without duplicating the rule.
//
// Creation is deliberately left as "any signed-in parent". Enforcing author = caller
// there would change a path that already works, and with an audience of two who trust
// each other it buys nothing.

migrate(
  (app) => {
    const posts = app.findCollectionByNameOrId('posts');
    posts.updateRule = 'author = @request.auth.id';
    posts.deleteRule = 'author = @request.auth.id';
    app.save(posts);

    const photos = app.findCollectionByNameOrId('photos');
    photos.createRule = 'post.author = @request.auth.id';
    photos.updateRule = 'post.author = @request.auth.id';
    photos.deleteRule = 'post.author = @request.auth.id';
    app.save(photos);
  },

  (app) => {
    const AUTHED = '@request.auth.id != ""';

    const posts = app.findCollectionByNameOrId('posts');
    posts.updateRule = AUTHED;
    posts.deleteRule = AUTHED;
    app.save(posts);

    const photos = app.findCollectionByNameOrId('photos');
    photos.createRule = AUTHED;
    photos.updateRule = AUTHED;
    photos.deleteRule = AUTHED;
    app.save(photos);
  },
);
