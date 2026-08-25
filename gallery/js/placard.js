// The museum placard: an artwork plus the gallery config, turned into ordered lines.
//
// PURE — no DOM, no fetch, no randomness. Every field on a placard is optional and
// has to drop out cleanly when it is missing, which is fiddly enough, and quiet
// enough when it goes wrong, to be worth testing on its own.

/**
 * Whole months old on `on`, or null.
 *
 * Months rather than years because this is a child: between four and five there are
 * eleven other answers, and "age 4" throws away almost everything that makes the
 * drawings from either end of that year different from each other.
 *
 * Borrows a month when the date has not reached the day-of-month yet — the same rule
 * scrapbook's age.js uses for years. Returns null rather than a negative for a date
 * before birth, because "age -1" is worse than no line at all, and a mistyped year is
 * exactly how that happens.
 *
 * @param {string} birthDate ISO yyyy-mm-dd
 * @param {string} on ISO yyyy-mm-dd
 * @returns {number|null} total months
 */
export function monthsAt(birthDate, on) {
  const b = parseIso(birthDate);
  const d = parseIso(on);
  if (!b || !d) return null;

  let months = (d.year - b.year) * 12 + (d.month - b.month);
  // Not reached the day of the month yet: give the month back.
  if (d.day < b.day) months -= 1;
  return months < 0 ? null : months;
}

/**
 * Whole years old on `on`, or null. Derived from the months so the two can never
 * disagree about where a birthday falls.
 * @returns {number|null}
 */
export function ageAt(birthDate, on) {
  const months = monthsAt(birthDate, on);
  return months == null ? null : Math.floor(months / 12);
}

/**
 * Total months as a museum label reads it: "5 months", "1 year 1 month",
 * "6 years 3 months", "4 years".
 *
 * A whole number of years drops the months rather than saying "0 months", and under a
 * year there is no years part at all. Singular and plural are handled per unit, because
 * "1 years 1 months" is the sort of thing that makes a careful label look careless.
 *
 * @param {number|null} months
 * @returns {string|null}
 */
export function ageLabel(months) {
  if (!Number.isFinite(months) || months < 0) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;

  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  // The months part is dropped on an exact birthday, but kept when there are no years
  // at all — otherwise a two-month-old would have no age rather than a small one.
  if (rest > 0 || years === 0) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
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
  // config — so the admin page stamps the months onto each drawing as it saves, and the
  // public API serves "75" instead of a date of birth.
  //
  // Derivation wins where it is possible, because it cannot go stale.
  const derived = monthsAt(config?.birthDate, artwork?.createdOn);
  const months = derived ?? (Number.isFinite(artwork?.ageMonths) ? artwork.ageMonths : null);
  const label = ageLabel(months);
  return label ? `${name}, age ${label}` : name;
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
