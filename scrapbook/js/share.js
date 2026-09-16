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
  // The worker's markers go with it. Read them BEFORE calling this — they are gone after,
  // so that a reload is an ordinary visit rather than a second attempt to consume files
  // that have already been claimed, or a repeat of an explanation already given.
  url.searchParams.delete('unreadable');
  url.searchParams.delete('sent');
  url.searchParams.delete('why');
  window.history.replaceState({}, '', url);
  return true;
}

/**
 * What the worker said about the share, read off the URL it redirected to.
 *
 * `sent` is how many files the sharing app actually handed over — none at all is a
 * different problem from files that cannot be read, and the two need different advice.
 * `-1` means the form could not be parsed at all.
 */
export function shareReport(search = globalThis.location?.search || '') {
  const q = new URLSearchParams(search);
  const num = (name, fallback) => {
    // `has` first: Number(null) is 0, so an ABSENT marker would otherwise read as "the
    // app sent zero files" — and a device still running an older worker sends no markers
    // at all. That would have answered an unknown outcome with confident, wrong advice.
    if (!q.has(name)) return fallback;
    const n = Number(q.get(name));
    return Number.isInteger(n) ? n : fallback;
  };
  return {
    sent: num('sent', null),
    unreadable: Math.max(0, num('unreadable', 0)),
    // Only present when the worker could not read the share at all. Short and technical
    // on purpose: it is meant to be read back to whoever is fixing it.
    why: q.get('why') || '',
  };
}

/**
 * What to say about a share, or null when it simply worked.
 *
 * A SHARE MUST NEVER BE SILENT. Someone who picked photos in another app and chose
 * Finnbook has already told us what they want; opening the timeline as though nothing
 * happened is the one outcome that reads as the feature being broken. Every way this can
 * fail gets a sentence, including the ones we do not expect — an unexplained failure is
 * still better reported than hidden.
 *
 * @param {{sent: number|null, unreadable: number}} report from the URL
 * @param {number} claimed how many files actually came through
 */
export function shareNotice({ sent = null, unreadable = 0, why = '' } = {}, claimed = 0) {
  if (claimed > 0 && unreadable === 0) return null;   // it worked

  const cloud = 'Google Photos does that when the original is still in the cloud — open it '
    + 'there and download it to the device first, then share again.';

  if (claimed > 0) {
    // Some came through, some did not. The ones that did are already in the sheet.
    const what = unreadable === 1 ? 'One of those' : `${unreadable} of those`;
    return `${what} could not be read from the share, so they are not here. ${cloud}`;
  }

  if (unreadable > 0) {
    const what = unreadable === 1 ? 'That photo or video' : `Those ${unreadable} photos and videos`;
    return `${what} could not be read from the share. ${cloud}`;
  }

  // `0` is no file parts; `-1` is a body that could not be parsed as a form at all — which
  // is what an empty multipart POST actually produces, confirmed in the container. Both
  // mean the same thing to a parent: the share carried no picture. Treating only 0 as that
  // case sent the commonest real failure to the vague fallback below.
  if (sent !== null && sent <= 0) {
    return 'That share arrived without the photo or video in it — some apps send a link '
      + 'instead of the file. Try sharing again and choosing the original, or add it from '
      + 'this screen instead.'
      // Appended only when the worker actually failed to read it. Nobody can open a
      // service worker's console on a phone, and without this the next step is guesswork.
      + (why ? ` (detail: ${why})` : '');
  }

  // Everything else: the share arrived and nothing came of it, for a reason we do not yet
  // know. Said plainly rather than swallowed.
  return 'Nothing came through from that share. Try adding the photo or video from this '
    + 'screen instead.' + (why ? ` (detail: ${why})` : '');
}
