/// <reference path="../../scrapbook/pb_data/types.d.ts" />

// Make the browser revalidate the app's own code.
//
// PocketBase serves pb_public with a Last-Modified header and no Cache-Control at all.
// Given only that, Chrome caches heuristically — it invents its own expiry from the
// file's age — and an ES module can then be served from cache without ever asking the
// server whether it changed.
//
// That is not a theoretical tidiness problem. It shipped: a deploy renamed the sign-in
// field from `signinEmail` to `signinUsername`, browsers picked up the new index.html but
// kept the old auth.js, which looked for an element that no longer existed, threw before
// it could attach the submit handler, and left the form to submit natively. The symptom
// was a sign-in page that "just reloads" — with nothing wrong on the server at all.
//
// There is no build step here and therefore no hashed filenames to make a stale copy
// impossible, so the fix is to say plainly: check with me first. `no-cache` does not mean
// "do not cache" — it means revalidate, so an unchanged file still costs only a 304.
//
// Scoped to code, deliberately — and the opposite instruction is given to /api/files/,
// which is where the bandwidth actually goes. A PocketBase file URL carries a filename
// generated at upload, so the bytes at a given URL never change: a browser that has one
// never needs to ask again. Without a Cache-Control header at all, Chrome falls back to
// heuristic caching and re-fetches far more than it needs to, and on a metered host that
// is paid for twice over.
//
// `private`, not `public`: these are a family's photographs, and a shared cache anywhere
// between here and the phone has no business holding them.

routerUse((e) => {
  const path = e.request.url.path;

  // A manifest served as text/plain works in practice, but the type is what tells a
  // browser this is an installable app rather than a file someone linked to.
  if (path.endsWith('.webmanifest')) {
    e.response.header().set('Content-Type', 'application/manifest+json');
  }

  // Photos and video. Immutable by construction, so a year is not optimistic.
  if (path.startsWith('/api/files/')) {
    e.response.header().set('Cache-Control', 'private, max-age=31536000, immutable');
    return e.next();
  }

  const isCode = /\.(js|css|html|json|webmanifest)$/.test(path);
  const isPage = path === '/' || path.endsWith('/');
  if (isCode || isPage) {
    e.response.header().set('Cache-Control', 'no-cache');
  }
  return e.next();
});
