/// <reference path="../../scrapbook/pb_data/types.d.ts" />

// A place for a phone to say what happened to a share.
//
// TEMPORARY, and here for one reason: sharing a photo into the app does nothing, and every
// attempt to work out why has been a guess. A service worker's console cannot be opened on
// a phone, the person sharing is not the person debugging, and four rounds of
// change-deploy-try have produced no information at all.
//
// So the worker and the page report what they saw to here, and it goes to stdout — which
// is the container log, which is readable. Whatever the next share does, it will leave a
// trace, INCLUDING doing nothing: no line at all proves the worker never ran, which is
// itself the answer and cannot be learned any other way.
//
// Carries no photo and no caption: counts, field names and content types only.
//
// DELETE THIS once the share works. It is a listening post, not a feature.

routerAdd('POST', '/share-debug', (e) => {
  try {
    const raw = readerToString(e.request.body);
    // Truncated hard. This is a log line, and a runaway body would push out the very
    // lines it was added to capture.
    console.log('[share-debug]', String(raw).slice(0, 900));
  } catch (err) {
    console.log('[share-debug] could not read the report:', err);
  }
  // Always 204, whatever happened. A diagnostic that can fail a share is worse than the
  // bug it is chasing.
  return e.noContent(204);
});
