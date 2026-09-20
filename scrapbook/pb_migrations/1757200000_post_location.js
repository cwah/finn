/// <reference path="../pb_data/types.d.ts" />

// Where a memory happened.
//
// One free-text line on the post, not coordinates. The scrapbook wants "Brooklyn, NY", not
// 40.6782/-73.9442 — a place is a thing you recognise, and storing the numbers would mean
// keeping the exact spot a baby was photographed, which is more than is needed for any of
// this and more than anyone would want kept.
//
// Text rather than a relation to a places table for the same reason the caption is text:
// it is written once, read often, and never queried. A parent can correct it or type one
// the photographs did not know.

migrate(
  (app) => {
    const posts = app.findCollectionByNameOrId('posts');
    if (!posts.fields.getByName('location')) {
      posts.fields.add(new TextField({ name: 'location', max: 120 }));
      app.save(posts);
    }
  },

  (app) => {
    const posts = app.findCollectionByNameOrId('posts');
    const field = posts.fields.getByName('location');
    if (field) { posts.fields.removeById(field.id); app.save(posts); }
  },
);
