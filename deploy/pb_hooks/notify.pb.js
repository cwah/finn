/// <reference path="../../scrapbook/pb_data/types.d.ts" />

// Tell people when a new memory arrives.
//
// A cron inside PocketBase rather than anywhere else, because PocketBase is the only piece
// of this that is always running. The Telegram bot lives on a laptop; the frontend is a
// page nobody may have open.
//
// DELIBERATELY ONE LINE OF WORK. A hook handler runs in a pooled runtime that does not
// share this file's top-level scope, so a handler calling a function defined below it
// throws "not defined" — which is precisely what this file did before. Everything the tick
// needs is required from inside the handler, where it is actually reachable.

cronAdd('notify-new-posts', '* * * * *', () => {
  try {
    require(`${__hooks}/notify-send.js`).run();
  } catch (err) {
    // A throw out of a cron handler kills the scheduled job for the life of the process,
    // and the symptom is silence — indistinguishable from "nobody posted anything".
    console.log('[notify] tick failed:', err);
  }
});
