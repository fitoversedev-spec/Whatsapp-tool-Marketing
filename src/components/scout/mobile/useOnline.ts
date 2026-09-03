"use client";

import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it has a network.
 *
 * `navigator.onLine` is famously optimistic — it reports "online" for a phone
 * associated with a wifi access point that has no route to the internet — so
 * nothing in Field mode *decides* anything from this alone. It only chooses
 * wording: a failed request already carries its own error. Used together, "the
 * request failed" plus "the OS says there is no network" produces the right
 * message; either alone does not.
 *
 * Starts `true` on the server and on first paint so the UI never flashes an
 * offline banner during hydration.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
