// The collection, read from data/artworks.json.
//
// The whole gallery is one small file, so it is fetched once and cached. There is no
// paging: a child's collection is tens of drawings, not thousands, and the arrows
// have to be able to reach the oldest one without a round trip.

import { fromRoot } from './paths.js';

let _cache = null;

/**
 * The gallery: its config and every artwork, in whatever order the file lists them.
 * Ordering is collection.js's job, not the source's.
 *
 * @returns {Promise<{config: object, artworks: Array}>}
 */
export async function getGallery() {
  if (_cache) return _cache;

  // Resolved against the app root, not the document — see js/paths.js.
  const response = await fetch(fromRoot('data/artworks.json'), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the collection (${response.status})`);

  const data = await response.json();
  _cache = {
    config: data?.config ?? {},
    artworks: Array.isArray(data?.artworks) ? data.artworks : [],
  };
  return _cache;
}
