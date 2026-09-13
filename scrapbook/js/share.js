// Receiving files from the system share sheet.
//
// A share target POSTs into the app, and there is no server here to receive it — the
// service worker catches the request instead, and the page has to get the files from
// somewhere afterwards. That handoff is what this file is.
//
// The Cache API is the drop box. It is the one place a worker can put a whole file that
// survives the redirect that follows: the POST is answered with a 303, the browser makes
// a fresh GET, and the page that loads is a new document with no memory of the request.
//
// DUPLICATED IN BOTH APPS ON PURPOSE. The scrapbook and the gallery share an origin and
// nothing else — no imports across the boundary, each with its own tests and its own
// dev server. Forty lines repeated is the cheaper half of that bargain.

export const SHARE_CACHE = 'share-inbox';

/** The flag the worker redirects with, so a page knows to go looking. */
export const SHARE_FLAG = 'shared';

/**
 * Take everything the share sheet handed over, and empty the drop box.
 *
 * Emptied on read, deliberately: a file left behind would reappear the next time the app
 * was opened, attached to a memory nobody was making.
 *
 * @returns {Promise<File[]>}
 */
export async function claimSharedFiles() {
  if (!('caches' in window)) return [];
  let cache;
  try {
    cache = await caches.open(SHARE_CACHE);
  } catch {
    return [];
  }

  const requests = await cache.keys();
  const files = [];
  for (const request of requests) {
    const response = await cache.match(request);
    if (!response) continue;
    const blob = await response.blob();
    // The name does not survive a Response on its own; the worker parks it in a header.
    const name = decodeURIComponent(response.headers.get('x-share-name') || 'shared');
    files.push(new File([blob], name, {
      type: response.headers.get('content-type') || blob.type,
      lastModified: Number(response.headers.get('x-share-modified')) || Date.now(),
    }));
  }
  await Promise.all(requests.map((r) => cache.delete(r)));
  return files;
}

/** Whether this page load came from a share, and tidy the URL if it did. */
export function cameFromShare() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARE_FLAG)) return false;
  // Take the flag out of the address bar so a reload is an ordinary visit rather than a
  // second attempt to consume files that have already been claimed.
  url.searchParams.delete(SHARE_FLAG);
  // The unreadable marker goes with it. Read it BEFORE calling this — it is gone after.
  url.searchParams.delete('unreadable');
  window.history.replaceState({}, '', url);
  return true;
}

/**
 * How many shared items arrived with no bytes behind them.
 *
 * Android hands over a file with a name and a type but nothing to read when it cannot
 * produce the content — routine for a Google Photos item that lives in the cloud and has
 * not been downloaded. Those cannot be stored, but they MUST be mentioned: dropping them
 * in silence is what made sharing look as though it did nothing at all.
 */
export function unreadableShareCount(search = globalThis.location?.search || '') {
  const n = Number(new URLSearchParams(search).get('unreadable'));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** What to say about them. Null when there is nothing to say. */
export function unreadableShareNotice(count) {
  if (!count) return null;
  const what = count === 1 ? 'That photo or video' : `${count} of those photos or videos`;
  const it = count === 1 ? 'it' : 'them';
  return `${what} could not be read from the share — Google Photos does that when the `
    + `original is still in the cloud. Open ${it} in Photos and download ${it} to the `
    + 'device first, then share again, or add from this screen instead.';
}
