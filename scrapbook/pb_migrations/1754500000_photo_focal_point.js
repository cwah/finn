/// <reference path="../pb_data/types.d.ts" />

// Where a cover-cropped thumbnail should be centred, 0–1 on each axis.
//
// Picked automatically from image content at capture (js/smart-crop.js) and adjustable
// in the compose sheet.
//
// NOTE: these were left optional on the assumption that existing rows would read back as
// null. They do not — PocketBase backfills a new number field with 0, which the renderer
// reads as "crop to the top-left corner". 1754600000_backfill_focal_centre.js repairs
// that. Adding a numeric field to a populated collection needs an explicit backfill.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');

    photos.fields.add(
      new NumberField({ name: 'focalX', min: 0, max: 1 }),
      new NumberField({ name: 'focalY', min: 0, max: 1 }),
    );

    app.save(photos);
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    for (const name of ['focalX', 'focalY']) {
      const field = photos.fields.getByName(name);
      if (field) photos.fields.removeById(field.id);
    }
    app.save(photos);
  },
);
