/// <reference path="../pb_data/types.d.ts" />

// The gallery's one config record.
//
// gallery_config is superuser-only for writes, deliberately — these are the words on
// every label in the building and should not be a stray click from being rewritten. But
// that also means the app cannot create the record, and an empty collection is not a
// neutral state: with no config the placard loses the artist line entirely, so every
// drawing hangs anonymously. It is created here so the collection is never empty.
//
// The values are the ones the static manifest carried, so flipping data.js over to
// PocketBase changes where the words come from and not what they say.
//
// birthDate is NOT here and must not be added. It stays on the scrapbook's private
// config, which only signed-in accounts can read; this collection is world-readable and
// putting a child's date of birth in it would undo the reason the two are separate.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('gallery_config');

    // Idempotent: a migration that cannot be run twice is a migration that will
    // eventually be run twice.
    let existing = 0;
    try {
      existing = app.findRecordsByFilter(collection, '', '', 1, 0).length;
    } catch {
      existing = 0;
    }
    if (existing > 0) return;

    const record = new Record(collection);
    record.set('artistName', 'Finn');
    record.set('galleryTitle', 'The Finn Collection');
    record.set('galleryBlurb', 'Permanent collection · Gallery 1');
    record.set('creditLine', 'Gift of the artist');
    record.set('showAge', true);
    app.save(record);
  },
  (app) => {
    // Down removes only what up created. The collection itself belongs to the schema
    // migration and is not this one's to drop.
    try {
      const collection = app.findCollectionByNameOrId('gallery_config');
      for (const record of app.findRecordsByFilter(collection, '', '', 100, 0)) {
        app.delete(record);
      }
    } catch {
      // Nothing to undo.
    }
  },
);
