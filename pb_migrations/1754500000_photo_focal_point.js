/// <reference path="../pb_data/types.d.ts" />

// Where a cover-cropped thumbnail should be centred, 0–1 on each axis.
//
// Picked automatically from image content at capture (js/smart-crop.js) and adjustable
// in the compose sheet. Nullable rather than defaulted to 0.5: an absent focal point and
// a deliberate dead-centre one look the same to the renderer, but only one of them means
// "this predates the feature".

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
