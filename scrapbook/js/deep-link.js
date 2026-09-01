// Landing on one particular memory.
//
// A notification is about a post, not about the page. Dropping someone at the top of the
// timeline and letting them find it is fine when it is the newest thing there — and
// useless the moment it is not. A memory backdated to June is the newest thing that
// HAPPENED and sits months down a page that loads five posts at a time.
//
// So the card has to be reached, which means paging until it exists. The timeline already
// loads in memory-date order, so the post is somewhere below; the only questions are how
// far, and when to give up.

/** The post id a URL is asking for, or null. */
export function wantedPost(url) {
  try {
    const value = new URL(String(url), 'https://x.invalid').searchParams.get('post');
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

/**
 * How many more pages to ask for before giving up.
 *
 * Bounded, because "keep loading until you find it" is a request to load the entire
 * scrapbook when the id is wrong, deleted, or from a post someone else can see and this
 * account cannot. Forty pages is far more than a notification ever needs — the post is
 * days old at most — and small enough that a bad id costs a moment rather than a phone's
 * data allowance.
 */
export const MAX_PAGES = 40;

/**
 * Walk the timeline until the post appears.
 *
 * Deliberately given its dependencies rather than reaching for the DOM: `has` and `more`
 * are what the caller knows, and that keeps the giving-up rule testable, which is the part
 * that can loop forever.
 *
 * @param {(id: string) => boolean} has whether the card is on the page yet
 * @param {() => Promise<void>} loadMore ask for the next page
 * @param {() => boolean} hasMore whether there is a next page at all
 * @param {string} id the post being looked for
 * @returns {Promise<boolean>} whether it was found
 */
export async function pageUntilFound(id, { has, loadMore, hasMore }) {
  if (!id) return false;
  if (has(id)) return true;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    // Asked BEFORE loading, so a timeline already at its end stops here rather than
    // spending a request to discover what it was already told.
    if (!hasMore()) return has(id);
    await loadMore();
    if (has(id)) return true;
  }
  return has(id);
}
