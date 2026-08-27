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

/**
 * Where a post belongs among those already on screen, by memory date.
 *
 * The timeline runs newest first, so a post goes immediately before the first card OLDER
 * than it. Same-date cards count as neither older nor newer, so a new one joins the end of
 * its own day rather than the front — which is the order they were added in.
 *
 * Paging used to assume "a later page is always older, so append", and that holds right up
 * until something is inserted into the middle of the timeline. Then the next page can
 * contain posts NEWER than one already placed, and appending files them underneath it.
 *
 * @param {Array<string|null>} dates memory dates of the cards on screen, in display order
 * @param {string} memoryDate the post being placed
 * @returns {number} index to insert before; dates.length means "append"
 */
export function insertionIndex(dates, memoryDate) {
  const list = Array.isArray(dates) ? dates : [];
  const at = list.findIndex((d) => d && d < memoryDate);
  return at === -1 ? list.length : at;
}

/**
 * A page of posts, minus anything already on screen.
 *
 * Paging is by OFFSET, so it assumes the list underneath does not move. Inserting a
 * backdated post breaks that assumption outright: every row below it shifts down one, and
 * the next page hands back something already displayed. Left unfiltered it was appended a
 * second time, which is the duplicate — one copy where it was placed, one where paging
 * found it.
 *
 * Deliberately NOT `pickNewPosts`: that also refuses posts older than what is loaded,
 * which is right for a background poll and exactly wrong here, since reaching further back
 * is the whole purpose of turning a page.
 *
 * @param {object[]} items a page as fetched
 * @param {{has: (id: string) => boolean}} known posts already loaded
 * @returns {object[]} in the order given
 */
export function pickUnseen(items, known) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((post) => post?.id && !known?.has(post.id));
}
