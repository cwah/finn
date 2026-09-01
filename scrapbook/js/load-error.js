// What to say when the scrapbook will not open.
//
// There are two quite different failures behind one old message, and telling a parent the
// wrong one sends them looking in the wrong place:
//
//   the server ANSWERED with a status   something here is actually wrong
//   the request never got an answer     the server is down, restarting, or the phone is
//                                       on a dead connection — come back in a moment
//
// `fetch()` rejects with a TypeError when a request never reaches a server, so an error
// carrying no numeric `status` is the second kind. That is the whole test: PocketBase
// failures arrive as PbError with a status, and anything else did not get that far.
//
// This matters because the second kind is the COMMON one and it is transient. A redeploy
// takes the server away for a window, and every open scrapbook that reloads inside it
// reported "Could not load memories." — which sounds like the memories are gone.

/**
 * A request that never reached the server, as opposed to one that was refused.
 *
 * Tested by the flag pb.js sets when `fetch()` itself rejects, NOT by the absence of a
 * status code. The first version of this asked "is there no numeric status?", which is
 * true of every plain Error the app throws for its own reasons — so "No config record"
 * was shown to a parent as "check your connection", pointing at the one thing that was
 * fine. Absence of evidence read as evidence.
 */
export function isUnreachable(err) {
  return err?.offline === true;
}

/**
 * The sentence to show when startup fails.
 * @param {unknown} err whatever init() rejected with
 * @returns {string} something a parent can act on
 */
export function loadMessage(err) {
  return isUnreachable(err)
    ? 'Cannot reach the scrapbook. Check your connection, then try again.'
    : 'Could not load memories.';
}

/** Whether offering "Try again" is worth it — only when another go might work. */
export function canRetry(err) {
  return isUnreachable(err);
}
