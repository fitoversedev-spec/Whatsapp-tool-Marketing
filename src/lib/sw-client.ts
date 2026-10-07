// Browser-side helpers for talking to the service worker (src/app/sw.ts).

// Called on sign-out: tells the worker to drop everything it has cached
// except the icons/fonts precache, so nothing from this session stays on a
// shared device. Safe to call when no worker is registered.
export function clearOfflineCaches() {
  try {
    navigator.serviceWorker?.controller?.postMessage("CLEAR_CACHES");
  } catch {
    // ignore
  }
}
