/// <reference path="../pb_data/types.d.ts" />

// Keep the original clip beside the one that gets shown.
//
// A darkroom keeps the negative and the print, and for the same reason: the print is what
// goes on the wall, and the negative is what you go back to. Here:
//
//   video          the DISPLAY copy — 1080p H.264, and what every view loads. Unchanged
//                  in meaning, so nothing that reads it needs touching, and rows written
//                  before this migration are simply their own display copy.
//   videoOriginal  whatever came off the phone. Uploaded in the background AFTER the
//                  memory is safe, because it is the slow one and nothing waits for it.
//
// Deliberately the way round that leaves `video` as the thing already being read. The
// alternative — `video` becomes the original and a new field holds the display copy —
// would have every existing row silently serving 4K to a phone until something backfilled
// them, and would rename a field that a dozen call sites already use correctly.
//
// A FileField is optional by default and absent reads as an empty string, which is what
// every existing row will have and exactly what "no original kept" should mean. No
// backfill: unlike a `number`, where 0 meant "the top-left corner", empty here means
// absent and absent is the truth.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');

    // Conditional on the SHAPE, as every migration here now is: a field added by hand in
    // the admin UI is still the field, and a second definition is rejected outright.
    if (!photos.fields.getByName('videoOriginal')) {
      photos.fields.add(new FileField({
        name: 'videoOriginal',
        maxSelect: 1,
        // Room for the untouched thing. A minute of 4K off a modern phone is comfortably
        // over 200 MB, and the whole point of this field is that it is not reduced.
        maxSize: 419430400, // 400 MB
        mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      }));
      app.save(photos);
    }
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const field = photos.fields.getByName('videoOriginal');
    if (field) {
      photos.fields.removeById(field.id);
      app.save(photos);
    }
  },
);
