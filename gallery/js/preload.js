// Warming the images either side of the one on screen.
//
// Not pure — it makes requests. Deliberately small: only the immediate neighbours,
// because these are full-resolution photographs of paper and a child's collection is
// small enough that one click either way covers every realistic move. Warming the
// whole collection on load would spend a phone's data on drawings nobody asked for.

const _seen = new Set();

/**
 * @param {Array<{image?: {src?: string}}>} list ordered collection
 * @param {number[]} indices from collection.js's neighbourIndices
 */
export function preloadNeighbours(list, indices) {
  for (const i of indices) {
    const src = list?.[i]?.image?.src;
    if (!src || _seen.has(src)) continue;
    _seen.add(src);

    const image = new Image();
    // Low priority and async decoding: this must never compete with the artwork the
    // visitor is actually looking at.
    image.fetchPriority = 'low';
    image.decoding = 'async';
    image.src = src;
  }
}
