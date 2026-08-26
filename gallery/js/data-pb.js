// The collection, read from PocketBase.
//
// This file is the ONLY place allowed to know what a PocketBase record looks like.
// Everything it returns is already in the JSON contract, which is what lets data.js
// swap sources without anything above it moving.
//
// Read-only, and unauthenticated: the gallery is public, and the collections carry
// `listRule: ''` to match. Adding a drawing happens in admin.html, which is a separate
// page with a separate module and its own session.

import { list, fileUrl, requestFileToken, PbError } from './pb.js';

/**
 * A gallery_artworks record -> an artwork in the contract.
 * @param {string} fileToken appended to the image URL; see getGallery
 */
function toArtwork(record, fileToken) {
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
    // Who added it. The studio uses this to decide what may be deleted; the wall
    // never shows it.
    authorId: record.author || null,

    // Months old when it was drawn, stamped at save time. The static source has no
    // equivalent — there, placard.js derives it from config.birthDate. Both paths end up
    // at the same line on the label; see the note in placard.js.
    //
    // A zero is read as "not known", not as an age. PocketBase gives an unset number
    // field 0, so a drawing saved when the birth date could not be read is
    // indistinguishable from one made in the first month of life — and the first record
    // uploaded through the studio came back exactly like that. In months the ambiguity
    // is easier to accept than it was in years: nobody under one month old makes a
    // drawing, so 0 can only mean the age was never worked out.
    ageMonths: Number(record.ageMonths) > 0 ? Number(record.ageMonths) : null,

    image: {
      // Absolute, built here. The frontend never joins a path, which is the single rule
      // that makes this source and the static one interchangeable.
      src: fileToken
        ? `${fileUrl(record, record.display)}?token=${encodeURIComponent(fileToken)}`
        : fileUrl(record, record.display),
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
    // placard.js falls back to the stamped ageMonths when there is no birthDate to work
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
  // Three requests, all independent. The file token is the awkward one: now the
  // collections are private, /api/files/ is too, and an <img> cannot send an
  // Authorization header — so PocketBase hands out a short-lived token to put in the
  // query string instead. Without it every frame on the wall renders empty.
  const [artworks, config, fileToken] = await Promise.all([
    list('gallery_artworks', { perPage: 500, sort: '-createdOn' }),
    list('gallery_config', { perPage: 1 }),
    requestFileToken(),
  ]);

  return {
    config: toConfig(config?.items?.[0]),
    // A drawing whose display file failed to attach would render as an empty frame, so
    // it is dropped rather than hung.
    artworks: (artworks?.items ?? [])
      .map((record) => toArtwork(record, fileToken))
      .filter((a) => a.image.src),
  };
}

export { PbError };

/**
 * Re-sign an image URL with a fresh file token.
 *
 * PocketBase file tokens last about two minutes. The gallery asks for one when it
 * loads and stamps it into every image URL, which is fine for the drawing on screen
 * and quietly wrong for the next one: sit on the wall for three minutes, press the
 * arrow, and the frame comes up empty because the token in that URL went stale while
 * nobody was looking at it.
 *
 * So an image that fails to load asks for a new token and tries once more. Cheaper and
 * more honest than polling to keep a token warm that is usually not needed at all.
 *
 * @param {string} src
 * @returns {Promise<string>}
 */
export async function refreshImageUrl(src) {
  const token = await requestFileToken();
  if (!token) return src;
  const url = new URL(src, location.href);
  url.searchParams.set('token', token);
  return url.href;
}
