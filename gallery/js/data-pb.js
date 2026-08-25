// The collection, read from PocketBase.
//
// This file is the ONLY place allowed to know what a PocketBase record looks like.
// Everything it returns is already in the JSON contract, which is what lets data.js
// swap sources without anything above it moving.
//
// Read-only, and unauthenticated: the gallery is public, and the collections carry
// `listRule: ''` to match. Adding a drawing happens in admin.html, which is a separate
// page with a separate module and its own session.

import { list, fileUrl, PbError } from './pb.js';

/** A gallery_artworks record -> an artwork in the contract. */
function toArtwork(record) {
  return {
    id: record.id,
    title: record.title,
    // PocketBase dates come back as 'YYYY-MM-DD HH:MM:SS.sssZ'; the contract is a plain
    // day, and every consumer — ordering, the year on the placard — wants only that.
    createdOn: String(record.createdOn ?? '').slice(0, 10),
    yearLabel: record.yearLabel || null,
    medium: record.medium || null,
    dimensions: record.dimensions || null,
    note: record.note || null,
    alt: record.alt || null,
    frame: record.frame || null,
    accession: record.accession || null,

    // Whole years old when it was drawn, stamped at save time. The static source has no
    // equivalent — there, placard.js derives it from config.birthDate. Both paths end up
    // at the same line on the label; see the note in placard.js.
    //
    // A zero is read as "not known", not as an age. PocketBase gives an unset number
    // field 0, so a drawing saved when the birth date could not be read is
    // indistinguishable from one by a newborn — and the first record uploaded through
    // the studio came back exactly like that. "Finn, age 0" is the worst kind of wrong:
    // plausible enough to ship. This gallery has no work by a nought-year-old, so
    // saying nothing is right, and the studio now shows the age before it saves.
    ageYears: Number(record.ageYears) > 0 ? Number(record.ageYears) : null,

    image: {
      // Absolute, built here. The frontend never joins a path, which is the single rule
      // that makes this source and the static one interchangeable.
      src: fileUrl(record, record.display),
      // The dimensions of the DISPLAY file, which is the cropped and deskewed one. The
      // clamp in artwork.css sizes the frame from these before the image loads, so they
      // have to describe the picture actually shown, not the phone photo behind it.
      width: Number(record.width) || 0,
      height: Number(record.height) || 0,
    },
  };
}

/** A gallery_config record -> the config in the contract. */
function toConfig(record) {
  if (!record) return {};
  return {
    artistName: record.artistName || null,
    galleryTitle: record.galleryTitle || null,
    galleryBlurb: record.galleryBlurb || null,
    creditLine: record.creditLine || null,
    showAge: record.showAge !== false,
    // birthDate is deliberately absent. It lives on the scrapbook's private config, and
    // the public API serves an age per artwork rather than a child's date of birth.
    // placard.js falls back to the stamped ageYears when there is no birthDate to work
    // from, which is exactly this case.
  };
}

/**
 * The gallery: its config and every artwork.
 *
 * Two requests rather than one — config is its own collection, and an earlier version of
 * this file read it off the artworks response, which is not a shape PocketBase ever
 * returns. They are fetched together rather than in sequence because neither needs the
 * other and the gallery cannot render without both.
 *
 * No paging. A child's collection is tens of drawings, and the arrows have to reach the
 * oldest one without a round trip.
 *
 * @returns {Promise<{config: object, artworks: Array}>}
 */
export async function getGallery() {
  const [artworks, config] = await Promise.all([
    list('gallery_artworks', { perPage: 500, sort: '-createdOn' }),
    list('gallery_config', { perPage: 1 }),
  ]);

  return {
    config: toConfig(config?.items?.[0]),
    // A drawing whose display file failed to attach would render as an empty frame, so
    // it is dropped rather than hung.
    artworks: (artworks?.items ?? []).map(toArtwork).filter((a) => a.image.src),
  };
}

export { PbError };
