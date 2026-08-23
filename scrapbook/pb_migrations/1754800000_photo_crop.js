/// <reference path="../pb_data/types.d.ts" />

// The crop rectangle a parent chose for a photo: { x, y, w, h }, normalised 0–1 against
// the original. Non-destructive by design — the uploaded file is never altered, so a
// crop can be widened, moved or removed at any point, forever.
//
// One json field rather than four numbers: a rectangle is one value, and the four parts
// are meaningless apart. It also sidesteps the trap the focal point fell into — a new
// `number` column backfills existing rows with 0, whereas an absent json value reads as
// empty, and cropRect() in the engine already treats anything falsy as "the whole
// photo". Existing photos therefore need no backfill.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    photos.fields.add(new JSONField({ name: 'crop', maxSize: 200 }));
    app.save(photos);
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const field = photos.fields.getByName('crop');
    if (field) photos.fields.removeById(field.id);
    app.save(photos);
  },
);
