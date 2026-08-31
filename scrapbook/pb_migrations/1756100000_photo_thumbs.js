/// <reference path="../pb_data/types.d.ts" />

// Thumbnail sizes for stored photos.
//
// PocketBase will resize a stored image on request — `?thumb=320x320f` — but ONLY for
// sizes named in the field's own `thumbs` list. Ask for anything else and it does not
// error: it quietly serves the ORIGINAL, at full size. Checked against production before
// writing this, because "it returned 200" would otherwise have looked like success:
//
//   ?thumb=100x100    200      7 KB   100x100     <- declared, so honoured
//   ?thumb=240x240f   200   1480 KB   3000x4000   <- not declared, original served whole
//   ?thumb=1600x1600f 200   1480 KB   3000x4000
//
// That silent fallback is the reason these are declared here rather than assumed. A page
// asking for thumbnails and receiving full-size photos looks exactly like a page that
// simply loads slowly, which is the bug this is meant to fix.
//
// `f` is fit-inside: the whole picture, shrunk. The plain `WxH` form CROPS to fill, which
// would quietly change what a parent framed — and framing here is the crop rectangle's
// job, not the thumbnailer's.
//
//   320x320f   the compose strip (76 CSS px) and the framing surface (320 CSS px), at 2x
//   1280x1280f a timeline card, which is at most 560 CSS px wide, at 2x
//
// The lightbox is deliberately absent: expanding a photo is the one place the whole thing
// is wanted, and it asks for the file itself.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const image = photos.fields.getByName('image');
    if (!image) throw new Error('photos.image is missing');

    const wanted = ['320x320f', '1280x1280f'];
    // Additive, and conditional on each size: a list someone extended by hand in the admin
    // UI is still their list, and overwriting it would throw their sizes away. The same
    // lesson as the username index — match on what is there, not on what this file would
    // have written.
    const existing = Array.isArray(image.thumbs) ? image.thumbs : [];
    image.thumbs = [...existing, ...wanted.filter((t) => !existing.includes(t))];
    app.save(photos);
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const image = photos.fields.getByName('image');
    if (!image) return;
    const added = ['320x320f', '1280x1280f'];
    image.thumbs = (image.thumbs || []).filter((t) => !added.includes(t));
    app.save(photos);
  },
);
