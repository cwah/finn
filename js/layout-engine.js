// The heart of the product: a PURE function that infers a layout from a post's
// content. No DOM, no fetch, no user input, no override. Unit-testable in isolation.
//
//   inferLayout(post) -> 'quote' | 'portrait' | 'landscape' | 'grid' | 'carousel' | null
//
// null means the post carries nothing renderable (no photos AND no caption); the
// renderer skips it rather than emitting an empty card.
//
// Milestone is a separate, orthogonal treatment (see isMilestone) layered on top of
// whichever base layout is chosen — so it never changes the rules below.

/** Above this many photos a grid stops working and the set becomes a carousel. */
export const GRID_MAX = 4;

/**
 * Decide the base layout for a post from its content alone.
 * Orientation is read from stored width/height — we never load an image to decide.
 * @param {object} post
 * @returns {'quote'|'portrait'|'landscape'|'grid'|'carousel'|null}
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

  // 4. 2–4 photos -> grid.
  if (count <= GRID_MAX) return 'grid';

  // 5. More than that -> carousel. A five-cell grid has no arrangement that reads well,
  // and shrinking each photo further defeats the point of taking them.
  return 'carousel';
}

/** A caption counts only if it holds something other than whitespace. */
function hasCaption(post) {
  return typeof post.caption === 'string' && post.caption.trim() !== '';
}

/** Whether this post should receive the milestone highlight treatment. */
export function isMilestone(post) {
  return Boolean(post.milestone && post.milestone.isMilestone);
}
