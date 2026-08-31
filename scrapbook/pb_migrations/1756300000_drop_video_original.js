/// <reference path="../pb_data/types.d.ts" />

// Take the archival clip back out again.
//
// `videoOriginal` was added one migration ago and is being removed before anything was
// ever written to it — checked against production first: 90 photo records, none with an
// original stored. So this drops an empty column and loses nothing.
//
// It is a REVERSAL rather than a deletion of the previous migration, because that one has
// already run on production. Removing its file would leave an orphan column behind and
// throw away the down-migration that explains it. The history is worth more honest than
// tidy.
//
// WHY. The original was write-only: every view loads `video`, which is the display copy,
// and crop and trim are applied at render — so a framing change never needed to re-derive
// anything from a negative. Against that it doubled video storage and put a
// tens-of-megabytes background upload on whatever connection a parent happened to be on.
//
// The same reasoning photos already follow: the file is reduced on the way in and the
// original stays on the phone that took it, which is where the negative has always lived.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const field = photos.fields.getByName('videoOriginal');
    if (field) {
      photos.fields.removeById(field.id);
      app.save(photos);
    }
  },

  (app) => {
    // Down puts the field back, empty, exactly as 1756200000 created it.
    const photos = app.findCollectionByNameOrId('photos');
    if (!photos.fields.getByName('videoOriginal')) {
      photos.fields.add(new FileField({
        name: 'videoOriginal',
        maxSelect: 1,
        maxSize: 419430400,
        mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      }));
      app.save(photos);
    }
  },
);
