/// <reference path="../pb_data/types.d.ts" />

// Finn's art gallery: the collections behind /gallery/.
//
// These live in the scrapbook's migrations directory because PocketBase takes exactly
// ONE, and both apps run on one instance. The `gallery_` prefix is the whole namespace —
// `config` was already taken by the scrapbook, and a collision would have been found the
// hard way. Anything added for the gallery later belongs under the same prefix.
//
// ── What is public, and what is not ──────────────────────────────────────────
// The scrapbook is private. The gallery is not: it is meant to be sent to grandparents,
// so its artworks and its config are world-readable. That asymmetry is the reason these
// are separate collections rather than fields on the existing ones.
//
// Writing is gated on `canPost`, the flag 1755200000_viewer_accounts added to `users`.
// One login covers both apps, and an account handed to a relative can read the gallery
// and the scrapbook without being able to add to either.
//
// birthDate is deliberately NOT here. It is already on the scrapbook's `config`, which
// only signed-in accounts can read, and one child has one birthday. The admin page reads
// it while signed in and stamps `ageYears` onto each artwork, so the public API never
// serves a date of birth — only "6".

migrate(
  (app) => {
    const PUBLIC = '';
    const CAN_POST = '@request.auth.id != "" && @request.auth.canPost = true';

    // ── gallery_config ────────────────────────────────────────────
    // One record. Everything the placard needs that is not about a particular drawing.
    const config = new Collection({
      type: 'base',
      name: 'gallery_config',
      listRule: PUBLIC,
      viewRule: PUBLIC,
      // Superuser only. These are the words on every label in the building; they should
      // not be a stray click away from being rewritten.
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'artistName', required: true, max: 80 },
        { type: 'text', name: 'galleryTitle', max: 120 },
        { type: 'text', name: 'galleryBlurb', max: 200 },
        { type: 'text', name: 'creditLine', max: 120 },
        { type: 'bool', name: 'showAge' },
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
    });
    app.save(config);

    // ── gallery_artworks ──────────────────────────────────────────
    const artworks = new Collection({
      type: 'base',
      name: 'gallery_artworks',
      listRule: PUBLIC,
      viewRule: PUBLIC,
      createRule: CAN_POST,
      updateRule: CAN_POST,
      deleteRule: CAN_POST,
      fields: [
        // ── the label ──
        { type: 'text', name: 'title', required: true, max: 160 },
        { type: 'date', name: 'createdOn', required: true },
        { type: 'text', name: 'yearLabel', max: 20 },
        { type: 'text', name: 'medium', max: 200 },
        { type: 'text', name: 'dimensions', max: 120 },
        { type: 'text', name: 'note', max: 4000 },
        { type: 'text', name: 'alt', max: 600 },
        { type: 'text', name: 'accession', max: 40 },
        { type: 'text', name: 'frame', max: 40 },

        // Whole years old when the drawing was made, stamped at save time from the
        // scrapbook's private config.birthDate. Stored rather than derived so that the
        // public API can serve an age without serving a date of birth.
        //
        // NOTE the backfill trap that 1755200000_viewer_accounts documents: a new number
        // field reads back as 0, and "age 0" is a plausible-looking wrong answer rather
        // than an obviously missing one. There are no rows yet, so there is nothing to
        // backfill here — but adding this field to a populated table would need one.
        { type: 'number', name: 'ageYears', min: 0, max: 120 },

        // ── the image ──
        // `display` is what the gallery shows: cropped, deskewed, brightness and
        // contrast applied, baked once at save time. `original` is the untouched
        // upload, kept forever so any of that can be redone.
        //
        // Framing is never destruction — the scrapbook's rule, and the reason both
        // files exist rather than just the corrected one.
        { type: 'file', name: 'display', required: true, maxSelect: 1, maxSize: 12000000,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
        { type: 'file', name: 'original', maxSelect: 1, maxSize: 40000000,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] },

        // Dimensions of `display`, not of `original`. The clamp in artwork.css sizes the
        // frame from these before the file loads, so they have to describe the picture
        // that is actually shown — a crop changes the aspect ratio.
        { type: 'number', name: 'width', required: true, min: 1 },
        { type: 'number', name: 'height', required: true, min: 1 },

        // The recipe that turned `original` into `display`: crop box, angle, brightness,
        // contrast. Kept so the editor can reopen a drawing with its adjustments intact
        // rather than starting from the corrected copy.
        { type: 'json', name: 'adjust', maxSize: 4000 },

        // 'human' or 'generated'. Worth recording: a note written by a language model
        // should be findable later, and should never be mistaken for something Finn or
        // his parents actually said.
        { type: 'text', name: 'noteSource', max: 20 },

        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      // The gallery is always ordered by createdOn, newest first, and every visitor
      // hits that ordering on the way in.
      indexes: [
        'CREATE INDEX `idx_gallery_artworks_createdOn` ON `gallery_artworks` (`createdOn` DESC)',
      ],
    });
    app.save(artworks);
  },
  (app) => {
    // Down in the reverse order of up: artworks first, then the config it referred to.
    for (const name of ['gallery_artworks', 'gallery_config']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // Already gone. A down migration that cannot be run twice is worse than useless.
      }
    }
  },
);
