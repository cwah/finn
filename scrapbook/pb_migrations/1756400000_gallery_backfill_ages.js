/// <reference path="../pb_data/types.d.ts" />

// Fill in the age of drawings that were hung before there was a birth date to work it
// out from.
//
// The studio stamps ageMonths at save time, from the scrapbook's private config. When
// the first drawing went up that record had no birthDate, so nothing was stored — and
// an unset PocketBase number reads back as 0, which the gallery correctly treats as
// "not known" and renders as no age at all. Now that the birth date exists, the ones
// already hanging can be told what they should have said.
//
// It only touches rows where the age is missing. A drawing whose months were stamped
// properly is left exactly as it is: this is filling a gap, not recomputing a fact, and
// the difference matters if anyone ever corrects a date by hand.
//
// If there is no birthDate to read, it does nothing and says so. A migration that
// stamps everyone as age 0 because it could not find a date would be worse than one
// that leaves the gap where it is.

migrate(
  (app) => {
    /** yyyy-mm-dd -> {year, month, day}, or null. */
    const parseIso = (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
      return match
        ? { year: +match[1], month: +match[2], day: +match[3] }
        : null;
    };

    /** Whole months between two dates, borrowing when the day has not come round. */
    const monthsBetween = (from, to) => {
      const b = parseIso(from);
      const d = parseIso(to);
      if (!b || !d) return null;
      let months = (d.year - b.year) * 12 + (d.month - b.month);
      if (d.day < b.day) months -= 1;
      return months < 0 ? null : months;
    };

    let birthDate = null;
    try {
      const config = app.findRecordsByFilter('config', '', '', 1, 0);
      if (config.length) birthDate = String(config[0].get('birthDate') ?? '').slice(0, 10);
    } catch {
      birthDate = null;
    }

    if (!parseIso(birthDate)) {
      console.log('gallery: no birthDate on the scrapbook config, so no ages were filled in.');
      return;
    }

    // Only the gaps. `ageMonths = 0` is exactly the "never worked out" case.
    const pending = app.findRecordsByFilter('gallery_artworks', 'ageMonths = 0', '', 500, 0);
    let filled = 0;
    for (const record of pending) {
      const createdOn = String(record.get('createdOn') ?? '').slice(0, 10);
      const months = monthsBetween(birthDate, createdOn);
      // A drawing dated before the birth date is a typo somewhere, not a negative age.
      // Leave it alone and let a human look at it.
      if (months == null || months <= 0) continue;
      record.set('ageMonths', months);
      app.save(record);
      filled += 1;
    }
    console.log(`gallery: filled in the age of ${filled} drawing(s).`);
  },

  (app) => {
    // There is no way to tell a filled-in age from one the studio stamped, so down
    // clears nothing rather than guessing and wiping a real value. Reverting the schema
    // is 1756200000's job; this migration only ever added information.
    console.log('gallery: ages left as they are; this migration only filled gaps.');
  },
);
