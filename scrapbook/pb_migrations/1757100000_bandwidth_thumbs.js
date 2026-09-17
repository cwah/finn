/// <reference path="../pb_data/types.d.ts" />

// Sizes for the bandwidth a card actually needs.
//
// Every photo on the timeline was being served at 1280px regardless of the screen showing
// it. A phone card is around 390 CSS px wide; at 2x that is 780 device pixels, so 1280 is
// most of a megapixel of detail nobody can see, on the device least able to afford it.
// These let a browser pick with `srcset`.
//
//   640x640f    a narrow card at 1x, or a collage tile
//   960x960f    a phone card at 2x — the common case, and the one that saves the most
//   2048x2048f  the lightbox, which used to be handed the ORIGINAL
//
// The lightbox one matters twice over: an expanded photo was fetching the stored file,
// which is up to 2560px on anything uploaded since downscaling went in and larger than
// that on everything older. 2048 is past what a phone or a laptop can show, and a
// fraction of the bytes.
//
// `f` is fit-inside. The plain WxH form CROPS to fill, which would quietly reframe what a
// parent framed.
//
// AND THEY MUST BE DECLARED. PocketBase honours only the sizes named on the field: ask for
// anything else and it does not error, it silently serves the original at full size. That
// is measured behaviour, not caution — a page asking for thumbnails and getting full-size
// photos looks exactly like a page that is merely slow, which is the bug this is meant to
// fix.

migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const image = photos.fields.getByName('image');
    if (!image) throw new Error('photos.image is missing');

    const wanted = ['640x640f', '960x960f', '2048x2048f'];
    // Additive and conditional on each size: a list someone extended by hand in the admin
    // UI is still their list.
    const existing = Array.isArray(image.thumbs) ? image.thumbs : [];
    image.thumbs = [...existing, ...wanted.filter((t) => !existing.includes(t))];
    app.save(photos);
  },

  (app) => {
    const photos = app.findCollectionByNameOrId('photos');
    const image = photos.fields.getByName('image');
    if (!image) return;
    const added = ['640x640f', '960x960f', '2048x2048f'];
    image.thumbs = (image.thumbs || []).filter((t) => !added.includes(t));
    app.save(photos);
  },
);
