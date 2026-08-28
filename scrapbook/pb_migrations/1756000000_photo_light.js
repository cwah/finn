/// <reference path="../pb_data/types.d.ts" />

// Brightness and contrast on a photo.
//
// Framing, not development: stored as numbers and applied at render, exactly like crop,
// rotation and the video trim. The file is never re-encoded, so a heavy hand costs nothing
// to undo — which is the opposite of the gallery, where an adjustment is baked into a new
// file because a print is a finished thing.
//
// THE ORDER MATTERS, and for the sharpest version of the trap this codebase keeps hitting:
// a new `number` field backfills every existing row with 0, and 0 brightness is BLACK. Add
// the field and stop there and every photo in the scrapbook goes black the moment the
// column exists. So the rows are filled in immediately afterwards, in the same migration.
//
// `lightFilter()` also reads a stored 0 as neutral, which covers the seconds between the
// two statements and any row written by something that predates these fields. Belt and
// braces, deliberately: the failure here is every memory at once.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');

    // Conditional on the SHAPE, not on this file having been the one to add it — the same
    // lesson as the username index. A field someone added by hand in the admin UI is
    // still the field, and a second definition would be rejected outright.
    if (!photos.fields.getByName('brightness')) {
      photos.fields.add(new NumberField({ name: 'brightness', min: 0.2, max: 2 }));
    }
    if (!photos.fields.getByName('contrast')) {
      photos.fields.add(new NumberField({ name: 'contrast', min: 0.2, max: 2 }));
    }
    app.save(photos);

    // Now make the backfilled zeros mean what they should. Scoped to rows that need it, so
    // an adjustment someone has already made is never flattened back to neutral.
    app.db().newQuery(`
      UPDATE photos
         SET brightness = 1
       WHERE brightness IS NULL OR brightness = 0
    `).execute();
    app.db().newQuery(`
      UPDATE photos
         SET contrast = 1
       WHERE contrast IS NULL OR contrast = 0
    `).execute();
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    for (const name of ['brightness', 'contrast']) {
      const field = photos.fields.getByName(name);
      if (field) photos.fields.removeById(field.id);
    }
    app.save(photos);
  },
);
