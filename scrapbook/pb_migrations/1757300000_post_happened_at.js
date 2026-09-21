/// <reference path="../pb_data/types.d.ts" />

// When a memory happened, to the minute.
//
// The timeline is ordered by `memoryDate`, which is a DAY, and within a day it fell back
// to `created` — when the post was typed up. Those are different things, and the
// difference shows: photographs from an evening, written up the next morning, sat above
// photographs from that morning written up later still. The day read backwards.
//
// This holds the moment the memory actually happened, taken from the most recent
// photograph in it when the photographs agree with the day it is filed under. It is a
// SORT KEY and nothing else — nothing displays it, and no page reasons about it.
//
// BACKFILLED FROM `created`, which is exactly what the ordering used before, so every post
// that already exists keeps the position it already had. Without the backfill they would
// have no value at all and sort to one end of their day in a heap.

migrate(
  (app) => {
    const posts = app.findCollectionByNameOrId('posts');
    if (!posts.fields.getByName('happenedAt')) {
      posts.fields.add(new DateField({ name: 'happenedAt' }));
      app.save(posts);
    }

    // Every existing post, in place. A scrapbook is small enough that this is one pass.
    const all = app.findRecordsByFilter('posts', 'id != ""', 'created', 5000, 0);
    for (const post of all) {
      if (post.get('happenedAt')) continue;
      post.set('happenedAt', post.get('created'));
      app.save(post);
    }
  },

  (app) => {
    const posts = app.findCollectionByNameOrId('posts');
    const field = posts.fields.getByName('happenedAt');
    if (field) { posts.fields.removeById(field.id); app.save(posts); }
  },
);
