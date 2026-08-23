// The URL for a piece, and the piece for a URL.
//
// PURE — no DOM, no fetch, no randomness. app.js owns history and location; this
// owns only the string handling, which is the half that can be wrong quietly.
//
// A query (?art=id) rather than a fragment (#id). A fragment competes with in-page
// anchors and with the browser's own scroll-to-element behaviour, and PocketBase
// record ids drop into a query string unchanged when the backend is swapped in.

/**
 * The artwork id a URL is asking for, or null for the bare landing page.
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function artIdFromUrl(search) {
  const text = String(search ?? '');
  if (!text) return null;
  try {
    const id = new URLSearchParams(text.startsWith('?') ? text.slice(1) : text).get('art');
    return id ? id : null;
  } catch {
    return null;
  }
}

/**
 * The URL a given position should be shown at.
 *
 * Index 0 is the newest piece and is the landing page, so it gets the bare './'
 * rather than '?art=<newest>'. Otherwise the front page would have two addresses
 * that both work, and the one people shared would rot the moment a new drawing
 * arrived and stopped being the newest.
 *
 * @param {Array<{id: string}>} list ordered, newest first
 * @param {number} index
 * @returns {string}
 */
export function urlForIndex(list, index) {
  if (!Array.isArray(list) || index <= 0) return './';
  const artwork = list[index];
  return artwork?.id ? `?art=${encodeURIComponent(artwork.id)}` : './';
}
