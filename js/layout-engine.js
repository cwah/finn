// The heart of the product: a PURE function that infers a layout from a post's
// content. No DOM, no fetch, no user input, no override. Unit-testable in isolation.
//
//   inferLayout(post) -> 'quote' | 'portrait' | 'landscape' | 'grid' | null
//
// null means the post carries nothing renderable (no photos AND no caption); the
// renderer skips it rather than emitting an empty card.
//
// Milestone is a separate, orthogonal treatment (see isMilestone) layered on top of
// whichever base layout is chosen — so it never changes the rules below.

/**
 * Decide the base layout for a post from its content alone.
 * Orientation is read from stored width/height — we never load an image to decide.
 * @param {object} post
 * @returns {'quote'|'portrait'|'landscape'|'grid'|null}
 */
export function inferLayout(post) {
  const photos = Array.isArray(post.photos) ? post.photos : [];
  const count = photos.length;

  // 1. No photos + has caption -> quote card. With neither, there is nothing to show.
  if (count === 0) return hasCaption(post) ? 'quote' : null;

  // 2 & 3. Single photo -> orientation from intrinsic dimensions.
  if (count === 1) {
    const { width, height } = photos[0];
    return height > width ? 'portrait' : 'landscape';
  }

  // 4. 2–4 photos -> grid. (Cap at 4; extras are ignored by the renderer.)
  return 'grid';
}

/** A caption counts only if it holds something other than whitespace. */
function hasCaption(post) {
  return typeof post.caption === 'string' && post.caption.trim() !== '';
}

/** Whether this post should receive the milestone highlight treatment. */
export function isMilestone(post) {
  return Boolean(post.milestone && post.milestone.isMilestone);
}
