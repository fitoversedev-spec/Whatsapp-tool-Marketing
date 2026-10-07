/// <reference lib="webworker" />

import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & typeof globalThis;
const sw = self as unknown as ServiceWorkerGlobalScope;

// Kept deliberately small. The worker exists for push notifications and
// "install app", not offline use:
// - The precache holds only the icons, the web manifest and the UI fonts
//   (globPublicPatterns / exclude in next.config.mjs).
// - Nothing is cached at runtime: pages, RSC payloads and /api always come
//   from the network, so a slow connection is never answered with stale data
//   and nothing private stays on a shared phone after sign-out.
// - Navigations go through NetworkOnly so the navigation-preload request
//   (sent while this worker starts up) is used instead of wasted.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: ({ request }) => request.mode === "navigate", handler: new NetworkOnly() },
  ],
});

// Delete every cache except the precache: the runtime caches an older version
// of this worker filled (pages, RSC, API responses, images…) and, on sign-out,
// anything else. Icons and fonts aren't private, so the precache stays.
async function dropRuntimeCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => !k.includes("precache")).map((k) => caches.delete(k)));
}

sw.addEventListener("activate", (event) => {
  event.waitUntil(dropRuntimeCaches());
});

// Posted on sign-out by every app's sidebar (and Scout field mode).
sw.addEventListener("message", (event) => {
  if (event.data === "CLEAR_CACHES") event.waitUntil(dropRuntimeCaches());
});

sw.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Open tabs refresh their badges straight away instead of waiting for
      // the next 30 s check.
      for (const c of windowClients) c.postMessage({ type: "push", tag: data.tag ?? null });
      const hasFocused = windowClients.some((c) => c.visibilityState === "visible");
      if (hasFocused && !data.force) return;
      return sw.registration.showNotification(data.title ?? "Fitoverse", {
        body: data.body,
        icon: "/icon-192.png",
        badge: "/favicon.png",
        tag: data.tag,
        data: { url: data.url ?? "/inbox" },
      });
    })
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/inbox", sw.location.origin);
  event.waitUntil(
    (async () => {
      const windowClients = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The exact page (path AND query, e.g. /inbox?conversation=…) is open → focus it.
      const exact = windowClients.find((c) => {
        const u = new URL(c.url);
        return u.pathname === target.pathname && u.search === target.search;
      });
      if (exact) {
        await exact.focus();
        return;
      }
      // The same page is open on something else (another chat) → reuse that tab.
      const samePage = windowClients.find((c) => new URL(c.url).pathname === target.pathname);
      if (samePage) {
        try {
          const focused = await samePage.focus();
          if (await focused.navigate(target.href)) return;
        } catch {
          // Tab not controlled by this worker — fall through to a new tab.
        }
      }
      await sw.clients.openWindow(target.href);
    })()
  );
});

serwist.addEventListeners();
