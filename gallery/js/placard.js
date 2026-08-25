// The museum placard: an artwork plus the gallery config, turned into ordered lines.
//
// PURE — no DOM, no fetch, no randomness. Every field on a placard is optional and
// has to drop out cleanly when it is missing, which is fiddly enough, and quiet
// enough when it goes wrong, to be worth testing on its own.

/**
 * Whole years old on `on`, or null.
 *
 * Borrows a year when the date has not reached the birthday yet — the same rule as
 * scrapbook's age.js. Returns null rather than a negative for a date before birth,
 * because "Finn, age -1" is worse than no line at all, and a mistyped year in the
 * manifest is exactly how that happens.
 *
 * @param {string} birthDate ISO yyyy-mm-dd
 * @param {string} on ISO yyyy-mm-dd
 * @returns {number|null}
 */
export function ageAt(birthDate, on) {
  const b = parseIso(birthDate);
  const d = parseIso(on);
  if (!b || !d) return null;

  let years = d.year - b.year;
  // Not had this year's birthday yet: give the year back.
  if (d.month < b.month || (d.month === b.month && d.day < b.day)) years -= 1;
  return years < 0 ? null : years;
}

/** yyyy-mm-dd -> {year, month, day}, or null for anything else. */
function parseIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  return { year: +match[1], month: +match[2], day: +match[3] };
}

/**
 * The year shown on the placard: the manifest's label if it set one, otherwise the
 * year the piece was made. yearLabel exists for the rare "2025–2026" case.
 * @returns {string|null}
 */
export function yearOf(artwork) {
  if (artwork?.yearLabel) return String(artwork.yearLabel);
  const parsed = parseIso(artwork?.createdOn);
  return parsed ? String(parsed.year) : null;
}

/**
 * The artist line: "Finn, age 5", or just "Finn" when the age cannot be worked out
 * or the gallery has turned it off.
 * @returns {string|null}
 */
export function artistLine(artwork, config) {
  const name = config?.artistName;
  if (!name) return null;
  if (config?.showAge === false) return name;

  // Two sources, and which one is available says which backend is in use.
  //
  // The static manifest carries birthDate in config, so the age is derived and
  // correcting that one date corrects every label at once. PocketBase does not: the
  // gallery is public, birthDate is a child's, and it stays on the scrapbook's private
  // config — so the admin page stamps whole years onto each drawing as it saves, and
  // the public API serves "6" instead of a date of birth.
  //
  // Derivation wins where it is possible, because it cannot go stale.
  const derived = ageAt(config?.birthDate, artwork?.createdOn);
  const age = derived ?? (Number.isFinite(artwork?.ageYears) ? artwork.ageYears : null);
  return age == null ? name : `${name}, age ${age}`;
}

/**
 * An accession number, made up the way a museum would: the year, then where the
 * piece falls within that year's intake.
 *
 * Derived rather than stored so it stays right as pieces are added, and only for the
 * normal case — a manifest that states one always wins.
 *
 * @param {object} artwork
 * @param {Array} all every artwork, any order
 * @returns {string|null}
 */
export function accessionOf(artwork, all) {
  if (artwork?.accession) return String(artwork.accession);
  const year = yearOf(artwork);
  if (!year) return null;
  const sameYear = (all || [])
    .filter((a) => yearOf(a) === year)
    .sort((a, b) => String(a?.createdOn ?? '').localeCompare(String(b?.createdOn ?? '')));
  const at = sameYear.findIndex((a) => a?.id === artwork?.id);
  if (at < 0) return null;
  return `${year}.${String(at + 1).padStart(3, '0')}`;
}

/**
 * The placard, as the lines to render in order.
 *
 * Returns a flat object rather than an array of strings so placard.css can style the
 * title as a title and the note as a paragraph. Any value may be null, and render.js
 * omits those rather than emitting an empty element — an empty <dd> still takes up a
 * line's worth of margin, which is the bug this shape prevents.
 *
 * @returns {{title, artist, year, medium, dimensions, note, credit}}
 */
export function placardLines(artwork, config, all) {
  const year = yearOf(artwork);
  const accession = accessionOf(artwork, all);
  const creditParts = [config?.creditLine, year].filter(Boolean).join(', ');
  const credit = [creditParts || null, accession].filter(Boolean).join('  ·  ') || null;

  return {
    title: artwork?.title || 'Untitled',
    artist: artistLine(artwork, config),
    year,
    medium: artwork?.medium || null,
    dimensions: artwork?.dimensions || null,
    note: artwork?.note || null,
    credit,
  };
}
