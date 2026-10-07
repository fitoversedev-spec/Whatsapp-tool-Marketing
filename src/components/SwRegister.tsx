"use client";

// Registers the service worker (push notifications + "install app") and keeps
// this device's push subscription known to the server. Mounted only inside the
// signed-in layouts — not on /login or the customer-facing share pages.
//
// It never asks for notification permission by itself: that only happens when
// the user switches notifications ON in Profile (a deliberate click). And if
// they switched them OFF there, nothing here turns them back on.

import { useEffect } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Which user + subscription this device last reported, so the server is only
// told when something changed (plus a weekly re-confirm) — not on every load.
const SENT_KEY = "ccd_push_sub";
const RESEND_MS = 7 * 24 * 60 * 60 * 1000;

async function syncPushSubscription(reg: ServiceWorkerRegistration, userId: string) {
  if (Notification.permission !== "granted") return;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const keyRes = await fetch("/api/push-key").catch(() => null);
    if (!keyRes?.ok) return;
    const { publicKey } = await keyRes.json().catch(() => ({ publicKey: null }));
    if (!publicKey) return;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  try {
    const last = JSON.parse(localStorage.getItem(SENT_KEY) ?? "null");
    if (last?.userId === userId && last?.endpoint === sub.endpoint && Date.now() - last.at < RESEND_MS) return;
  } catch {
    // Storage blocked — just send.
  }

  const json = sub.toJSON();
  const res = await fetch("/api/push-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      deviceLabel: navigator.userAgent.slice(0, 100),
    }),
  }).catch(() => null);
  if (res?.ok) {
    try {
      localStorage.setItem(SENT_KEY, JSON.stringify({ userId, endpoint: sub.endpoint, at: Date.now() }));
    } catch {
      // ignore
    }
  }
}

export default function SwRegister({ userId, pushEnabled }: { userId: string; pushEnabled: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => (pushEnabled ? syncPushSubscription(reg, userId) : undefined))
      .catch(() => null);
  }, [userId, pushEnabled]);
  return null;
}
