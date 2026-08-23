/// <reference path="../pb_data/types.d.ts" />

// Video, motion photos and rotation.
//
// A media row is still a photo row: the poster frame IS the photo, which is literally
// true for a motion photo and true by construction for a video, whose poster is grabbed
// at upload. Everything that already reads width/height — the layout engine, the crop
// box, coverAlign — therefore keeps working with no idea that motion exists.
//
// Non-destructive, exactly like `crop`:
//
//   trimStart/trimEnd  which stretch of the file a memory is. The file keeps every frame,
//                      so a trim can be widened, moved or removed forever.
//   rotation           degrees clockwise, applied at render. The stored file is never
//                      re-encoded, so turning a photo the wrong way costs nothing to undo.
//
// On the number-field trap that cost us once already (see 1754600000_backfill_focal_centre):
// a new `number` backfills existing rows with 0, NOT null. Here that is deliberate and
// safe for all three — 0 degrees means upright, and a 0/0 trim on a row with no video is
// never read, because trimRange() returns nothing playable without a duration. No backfill
// is needed, unlike the focal point, where 0 meant "top-left corner" and was wrong.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');

    photos.fields.add(new FileField({
      name: 'video',
      maxSelect: 1,
      // 60s of phone video, with headroom for the untrimmed source we deliberately keep.
      maxSize: 209715200, // 200 MB
      mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    }));

    // Of the SOURCE file, in seconds. The playable window is trimStart..trimEnd within it.
    photos.fields.add(new NumberField({ name: 'duration', min: 0 }));
    photos.fields.add(new NumberField({ name: 'trimStart', min: 0 }));
    photos.fields.add(new NumberField({ name: 'trimEnd', min: 0 }));

    // Whether it loops on screen (a motion photo) or waits for a tap (a video).
    // Stored rather than derived from duration: it is a statement about what the file IS,
    // and trimming a video down to two seconds must not silently turn it into wallpaper.
    photos.fields.add(new BoolField({ name: 'isMotion' }));

    // 0 | 90 | 180 | 270, clockwise. rotationOf() snaps anything else to upright.
    photos.fields.add(new NumberField({ name: 'rotation', min: 0, max: 359 }));

    app.save(photos);
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    for (const name of ['video', 'duration', 'trimStart', 'trimEnd', 'isMotion', 'rotation']) {
      const field = photos.fields.getByName(name);
      if (field) photos.fields.removeById(field.id);
    }
    app.save(photos);
  },
);
