/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

self.addEventListener("push", ((event: PushEvent) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    (self as unknown as ServiceWorkerGlobalScope).clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const hasFocused = windowClients.some((c) => c.visibilityState === "visible");
        if (hasFocused && !data.force) return;
        return (self as unknown as ServiceWorkerGlobalScope).registration.showNotification(
          data.title ?? "Fitoverse",
          {
            body: data.body,
            icon: "/icon-192.png",
            badge: "/favicon.png",
            tag: data.tag,
            data: { url: data.url ?? "/inbox" },
          }
        );
      })
  );
}) as EventListener);

self.addEventListener("notificationclick", ((event: NotificationEvent) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/inbox";
  event.waitUntil(
    (self as unknown as ServiceWorkerGlobalScope).clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const match = windowClients.find(
          (c) => new URL(c.url).pathname === url && "focus" in c
        );
        if (match) return match.focus();
        return (self as unknown as ServiceWorkerGlobalScope).clients.openWindow(url);
      })
  );
}) as EventListener);

serwist.addEventListeners();
