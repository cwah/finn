/// <reference path="../pb_data/types.d.ts" />

// Record a drawing's age in months, not years.
//
// This is a child. Between four and five there are eleven other answers, and "age 4"
// throws away almost everything that makes a drawing from either end of that year
// different from the other — which is most of the reason anyone wants the age on the
// label at all. The placard renders it as "5 months", "1 year 1 month", "6 years 3
// months"; the stored value is just the total.
//
// ageYears is dropped rather than kept alongside. Two fields that must agree about the
// same fact eventually disagree, and there is nothing to preserve: the only record in
// the collection has ageYears = 0, which never meant "born this year" — it meant the
// birth date could not be read when it was saved. See 1756000000 and the note in
// data-pb.js.
//
// NO BACKFILL, and that is a decision rather than an oversight. A new number field
// reads back as 0 on every existing row — the trap 1755200000_viewer_accounts
// documented — but here 0 is exactly right: the one drawing that exists has an unknown
// age, and unknown is what 0 means on this field. Anything added later gets its months
// stamped by the studio at save time.

migrate(
  (app) => {
    const artworks = app.findCollectionByNameOrId('gallery_artworks');

    artworks.fields.add(new NumberField({
      name: 'ageMonths',
      min: 0,
      // Somebody's whole childhood, and then some. A value past this is a typo.
      max: 1200,
    }));

    const stale = artworks.fields.getByName('ageYears');
    if (stale) artworks.fields.removeById(stale.id);

    app.save(artworks);
  },
  (app) => {
    const artworks = app.findCollectionByNameOrId('gallery_artworks');

    artworks.fields.add(new NumberField({ name: 'ageYears', min: 0, max: 120 }));

    const added = artworks.fields.getByName('ageMonths');
    if (added) artworks.fields.removeById(added.id);

    app.save(artworks);
  },
);
