// Register the service worker, if the browser will have one.
//
// The worker's URL and scope both come from APP_ROOT rather than from the document, for
// the reason paths.js exists: the gallery is mounted at a subpath, and a document-relative
// './sw.js' resolves against the PAGE. At `/gallery` without a trailing slash that becomes
// `/sw.js` — the scrapbook's worker, registered from the gallery, claiming the whole
// origin. Deriving it from import.meta.url cannot be wrong wherever the app is mounted.
//
// `updateViaCache: 'none'` because a worker is the one script that must never be served
// stale: it decides what everything else is allowed to do.

import { APP_ROOT } from './paths.js';

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('sw.js', APP_ROOT), { scope: APP_ROOT.pathname, updateViaCache: 'none' })
      .catch((err) => console.warn('service worker not registered:', err.message));
  });
}
