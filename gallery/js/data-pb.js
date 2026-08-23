// The collection, read from PocketBase. Phase 2 — not reachable until data.js flips
// SOURCE to 'pocketbase'.
//
// This ships unused on purpose. A switchboard with one branch is a lie: the seam only
// stays honest if both sides exist and both are held to the same contract, and the
// cheapest way to find out that the frontend has quietly grown a dependency on the
// shape of a JSON file is to have somewhere else it is supposed to work.
//
// This file is the ONLY place allowed to know what a PocketBase record looks like.
// Everything it returns is already in the contract.

const BASE = location.protocol === 'https:' || location.port === '8090'
  ? '' : 'http://127.0.0.1:8090';

/** A PocketBase record -> an artwork in the contract. */
function toArtwork(record) {
  return {
    id: record.id,
    title: record.title,
    createdOn: String(record.createdOn ?? '').slice(0, 10),
    yearLabel: record.yearLabel || null,
    medium: record.medium || null,
    dimensions: record.dimensions || null,
    note: record.note || null,
    alt: record.alt || null,
    frame: record.frame || null,
    accession: record.accession || null,
    image: {
      // Built here, into an absolute URL, so the frontend never joins a path. This is
      // the single rule that makes swapping the backend free.
      src: `${BASE}/api/files/artworks/${record.id}/${record.image}`,
      width: Number(record.width) || 0,
      height: Number(record.height) || 0,
    },
  };
}

/** @returns {Promise<{config: object, artworks: Array}>} */
export async function getGallery() {
  const url = `${BASE}/api/collections/artworks/records?perPage=500&sort=-createdOn`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the collection (${response.status})`);
  const data = await response.json();

  return {
    // Gallery config is a single-row collection; the shape it returns is the contract's.
    config: data?.config ?? {},
    artworks: (data?.items ?? []).map(toArtwork),
  };
}
