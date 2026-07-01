"use client";

// Client hook that exposes the current user's preferredUnit. Fetched
// once from /api/auth/me on first mount, cached module-globally so
// every component uses the same value without triggering re-fetches.
//
// Callers can also update the preference: setUnit("m") writes locally +
// PATCHes /api/profile so the change persists.

import { useEffect, useState, useSyncExternalStore } from "react";

type Unit = "ft" | "m";

// Module-level singleton state so re-renders across the tree all read
// from the same source of truth. Prevents each component fetching /me.
let currentUnit: Unit = "ft";
let loaded = false;
let inflight: Promise<Unit> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function loadOnce(): Promise<Unit> {
  if (loaded) return currentUnit;
  if (inflight) return inflight;
  inflight = fetch("/api/auth/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const u = d?.user?.preferredUnit as Unit | undefined;
      if (u === "ft" || u === "m") currentUnit = u;
      loaded = true;
      inflight = null;
      notify();
      return currentUnit;
    })
    .catch(() => {
      loaded = true;
      inflight = null;
      return currentUnit;
    });
  return inflight;
}

export function useUserUnit(): {
  unit: Unit;
  loaded: boolean;
  setUnit: (u: Unit) => Promise<void>;
} {
  // useSyncExternalStore keeps re-renders in sync across every consumer
  const [, setLoaded] = useState(loaded);
  const unit = useSyncExternalStore(
    subscribe,
    () => currentUnit,
    () => "ft" as Unit
  );

  useEffect(() => {
    if (!loaded) {
      loadOnce().then(() => setLoaded(true));
    }
  }, []);

  async function setUnit(u: Unit): Promise<void> {
    currentUnit = u;
    notify();
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredUnit: u }),
      credentials: "include",
    });
  }

  return { unit, loaded, setUnit };
}
