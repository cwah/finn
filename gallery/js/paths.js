// Where the app is mounted.
//
// Every URL in this app used to be resolved against the DOCUMENT, which is correct
// exactly as long as the app sits at the root of its origin. It is about to not:
// the gallery is going to be served from a subpath alongside the scrapbook, out of
// one PocketBase's public directory.
//
// Document-relative paths survive that fine at `/gallery/` — but not at `/gallery`
// without the trailing slash, where every one of them escapes the app by a level:
//
//     data/artworks.json  ->  /data/artworks.json      (the scrapbook's data)
//     art/long-cat.svg    ->  /art/long-cat.svg        (nothing)
//     ./                  ->  /                        (the scrapbook itself)
//
// That last one is the reason this file exists. It is the gallery's own "newest
// drawing" link, and pointing it at the root of a private family scrapbook is not a
// cosmetic bug. Whether a given server redirects `/gallery` to `/gallery/` is a
// property of that server, so rather than depend on it, nothing here is resolved
// against the document at all.
//
// `import.meta.url` is always the absolute URL of THIS module, whatever the page's
// address happens to be, so one step up from `js/` is the app root by construction.

/** The app's own root, wherever it has been mounted. */
export const APP_ROOT = new URL('../', import.meta.url);

/**
 * An app-relative path, resolved against the app root rather than the document.
 *
 * An absolute URL is returned unchanged, which is what keeps this safe to apply to
 * `image.src` from the manifest: the static source writes relative paths, `data-pb.js`
 * writes absolute `/api/files/...` ones, and neither has to know about the other.
 *
 * @param {string} path
 * @returns {string}
 */
export function fromRoot(path) {
  return new URL(String(path ?? ''), APP_ROOT).href;
}
