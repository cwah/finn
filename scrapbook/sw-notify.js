// What a notification says, and where tapping it goes.
//
// Loaded by sw.js through importScripts and by the tests through createRequire — the same
// arrangement as deploy/pb_hooks/notify-rule.js, and for the same reason: what ships is
// what was tested. A service worker cannot import an ES module, and a second copy of these
// rules would drift, with the drift arriving as wrong words on a lock screen.
//
// The push itself carries NO BODY — a payload would have to be encrypted per RFC 8291 and
// would put a caption and a baby's name through a third-party push service. So the worker
// is told only that something happened, and fetches the detail itself.

/** How recently a post must have been announced to count as part of this push. */
const BATCH_MINUTES = 10;

/** PocketBase's "2026-09-01 05:10:30.118Z" -> ms, or NaN. */
function pbTime(value) {
  if (!value) return NaN;
  return new Date(String(value).trim().replace(' ', 'T')).getTime();
}

/**
 * Which posts this push is about.
 *
 * The worker cannot be told directly — there is no payload — so it asks the server what
 * was announced recently. `notifiedAt` is the server's own record of having sent
 * something, which makes it the honest answer to "what is this push for".
 *
 * A post with no notifiedAt is not counted: it has not been announced, so it is not what
 * anyone is being told about. If NOTHING qualifies, the newest post is used rather than
 * showing nothing — a push arrived, so something happened, and a browser that is shown no
 * notification eventually invents its own.
 */
function batchOf(posts, now) {
  const cutoff = now - BATCH_MINUTES * 60 * 1000;
  const announced = (posts || []).filter((p) => {
    const at = pbTime(p && p.notifiedAt);
    return Number.isFinite(at) && at >= cutoff && at <= now + 60 * 1000;
  });
  if (announced.length) return announced;
  const newest = (posts || [])[0];
  return newest ? [newest] : [];
}

/** The author's display name, if the record carried one. */
function authorName(post) {
  const a = post && post.expand && post.expand.author;
  if (!a) return null;
  const name = (a.name || '').trim() || (a.email || '').trim();
  return name || null;
}

/**
 * Which post tapping the notification should land on.
 *
 * By MEMORY DATE, not creation date, because that is where the card sits in the timeline —
 * the thing a person is being sent to look at. A post backdated to last month is the most
 * recent thing that happened and is also a long way down the page, which is exactly the
 * case where being dropped at the top is useless.
 */
function landingPost(batch) {
  let best = null;
  for (const post of batch) {
    if (!best) { best = post; continue; }
    const a = pbTime(post.memoryDate);
    const b = pbTime(best.memoryDate);
    if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) best = post;
    // A tie on the day goes to whichever was written last, so two memories from the same
    // afternoon land on the newer one.
    else if (a === b && pbTime(post.created) > pbTime(best.created)) best = post;
  }
  return best;
}

/**
 * The whole notification, from a page of posts.
 *
 * @param {object[]} posts newest-created first, with `expand.author`
 * @param {number} now epoch ms
 * @returns {{title: string, body: string, postId: string|null, count: number}}
 */
function notification(posts, now) {
  const batch = batchOf(posts, now);
  const target = landingPost(batch);

  // NOBODY IS NAMED when several arrived. Two people posting in the same evening is not
  // one person's news, and "Alex and 2 others" is both clumsy and a small privacy leak on
  // a lock screen anyone can read. One post is different: knowing who it was IS the news.
  if (batch.length > 1) {
    return {
      title: 'Finnbook',
      body: `${batch.length} new memories were added.`,
      postId: target ? target.id : null,
      count: batch.length,
    };
  }

  const who = batch.length === 1 ? authorName(batch[0]) : null;
  return {
    title: 'Finnbook',
    // The fallback is not a failure: an author can be missing because the expand was not
    // returned, and "A new memory was added." is true either way.
    body: who ? `${who} added a new memory.` : 'A new memory was added.',
    postId: target ? target.id : null,
    count: batch.length,
  };
}

/** Where tapping it should open. */
function landingUrl(postId) {
  return postId ? `/?post=${encodeURIComponent(postId)}` : '/';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { notification, batchOf, landingPost, authorName, landingUrl, BATCH_MINUTES };
}
