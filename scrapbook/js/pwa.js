// Register the service worker, if the browser will have one.
//
// Kept out of app.js because it is not part of the app: nothing above depends on it, and
// the scrapbook works exactly the same when registration is refused.
//
// `updateViaCache: 'none'` is not a default worth accepting. Without it the browser may
// serve the worker script itself from the HTTP cache, and a worker is precisely the thing
// that must not go stale — it decides what everything else is allowed to do.

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  // Registration only works over https or on localhost; anywhere else it throws, and a
  // failed registration is not something to interrupt a parent about.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url), { scope: '/', updateViaCache: 'none' })
      .catch((err) => console.warn('service worker not registered:', err.message));
  });
}
