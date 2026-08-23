/// <reference path="../pb_data/types.d.ts" />

// Centre the focal point on photos that predate the focal-point feature.
//
// The previous migration assumed an absent focal point would read back as null. It does
// not: PocketBase backfills a new `number` field on existing rows with 0, so every photo
// uploaded before that migration ended up at (0, 0) — and the renderer dutifully crops
// them to `object-position: 0% 0%`, jamming the earliest memories into their top-left
// corner.
//
// Only (0, 0) is corrected. smart-crop clamps its output to 0.15–0.85 so it can never
// produce that pair, which makes an exact (0, 0) a reliable marker of a backfilled row.
// A parent could in principle drag the focus to the very corner by hand and land there
// deliberately — this runs once, before anyone has, and nothing resets it afterwards.

migrate(
  (app) => {
    app
      .db()
      .newQuery('UPDATE photos SET focalX = 0.5, focalY = 0.5 WHERE focalX = 0 AND focalY = 0')
      .execute();
  },

  // No down: once these are 0.5 there is no way to tell which rows this touched.
  (app) => {},
);
