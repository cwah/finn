// Picking up memories added somewhere else while the scrapbook is open.
//
// Posts no longer only come from this tab: the Telegram bot writes them, and so does the
// other parent's phone. Without this, a scrapbook left open shows a timeline that quietly
// went stale, and the only cure is a manual reload.
//
// PURE. The decision — which of a freshly fetched page belongs on screen right now — is
// the part with the sharp edges, so it lives here and is testable without a timeline.

/**
 * Which posts from a newly fetched page should be inserted into the open timeline.
 *
 * Two things disqualify a post:
 *
 * 1. **It is already here.** Whatever this tab created, or has paged in, is known — and
 *    a post made in this tab arrives back through the same fetch a moment later.
 *
 * 2. **It belongs below what has been paged in.** The timeline is paged newest-first, so
 *    a post older than the oldest card on screen sits in a page that has not been fetched
 *    yet. Inserting it now would place it ABOVE those older posts, and the next page
 *    would then load underneath it out of order. Paging will pick it up in its proper
 *    place when the reader gets there. Once everything is loaded (`hasMore` false) there
 *    is no such page and anything may be placed.
 *
 * @param {object[]} items a page of posts, newest memory first
 * @param {{known: {has: (id: string) => boolean}, oldestLoaded: string|null,
 *          hasMore: boolean}} state
 * @returns {object[]} in the order given
 */
export function pickNewPosts(items, { known, oldestLoaded, hasMore } = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((post) => {
    if (!post || !post.id) return false;
    if (known?.has(post.id)) return false;
    if (hasMore && oldestLoaded && post.memoryDate < oldestLoaded) return false;
    return true;
  });
}

/**
 * The oldest memory date currently on screen, or null when nothing is.
 * @param {Iterable<{memoryDate: string}>} posts
 */
export function oldestDate(posts) {
  let oldest = null;
  for (const post of posts || []) {
    const date = post?.memoryDate;
    if (date && (!oldest || date < oldest)) oldest = date;
  }
  return oldest;
}
