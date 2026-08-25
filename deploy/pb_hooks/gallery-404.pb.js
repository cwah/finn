/// <reference path="../../scrapbook/pb_data/types.d.ts" />

// Stop a missing gallery file from being answered with the scrapbook.
//
// PocketBase serves pb_public with an index fallback: a path it cannot match is
// answered with the ROOT index.html and a 200. For a single-page app that is the
// behaviour you want. Here there are two apps in one public directory, and it means
// every wrong URL under /gallery/ returns the private scrapbook's sign-in card:
//
//     /gallery/admin.html             -> 200, <title>Scrapbook</title>
//     /gallery/there-is-no-such-file  -> 200, <title>Scrapbook</title>
//
// Nothing leaks — the scrapbook's own content is behind auth — but a public visitor
// who mistypes a gallery URL lands on the private app, and, worse, a file genuinely
// missing from the image reports success. That is not hypothetical: admin.html was
// left out of the Dockerfile, and this fallback is why it looked deployed.
//
// The gallery is not a single-page app. It moves between drawings with a query
// (?art=the-long-cat), never a path, so there is no such thing as a legitimate
// unmatched path under /gallery/ and a 404 is simply the true answer.
//
// ── Why this is written so defensively ───────────────────────────────────────
// It has to ask the filesystem whether a file exists, and the binding it uses could
// not be exercised before shipping — PocketBase will not run on the machine this was
// written on. So the rule is: only ever 404 on a definite "no such file". A missing
// binding, an unexpected error, anything at all ambiguous, falls through to the old
// behaviour. The failure mode of guessing wrong in the other direction is a 404 on
// every file in the gallery, which is a far worse thing to deploy than the confusion
// this is meant to fix.

// Matches --publicDir in the Dockerfile's CMD. Overridable so this is not a second
// place to remember if that ever moves.
const PUBLIC_DIR = ($os.getenv && $os.getenv('PB_PUBLIC_DIR')) || '/pb/pb_public';

routerUse((e) => {
  const path = e.request.url.path;

  // Only the gallery. The scrapbook IS a single-page app and wants the fallback.
  if (!path.startsWith('/gallery/')) return e.next();
  // The gallery's own front door, which the static handler resolves to index.html.
  if (path === '/gallery/') return e.next();
  // Never adjudicate the API or the admin UI.
  if (path.startsWith('/api/') || path.startsWith('/_/')) return e.next();

  // TEMPORARY, and the reason this file is being deployed a second time.
  //
  // The first version shipped inert: a missing gallery file still answered with the
  // scrapbook, which means the filesystem check never reached a definite verdict. The
  // catch below was swallowing the only evidence of why, and PocketBase's logs are not
  // readable from where this is written — so the verdict is reported as a response
  // header instead, where a plain curl can see it. Remove once the cause is known.
  let verdict = 'unknown';
  let missing = false;
  try {
    // Throws when there is nothing there. Any OTHER outcome — including these
    // bindings not existing at all — leaves `missing` false and changes nothing.
    $os.stat($filepath.join(PUBLIC_DIR, path));
    verdict = 'found';
  } catch (err) {
    const text = String(err);
    missing = /no such file|not exist|cannot find/i.test(text);
    verdict = missing ? 'missing' : `error:${text.slice(0, 90)}`;
  }
  e.response.header().set('X-Gallery-404-Hook', verdict);

  if (missing) throw new NotFoundError('No such page in the gallery.');
  return e.next();
});
