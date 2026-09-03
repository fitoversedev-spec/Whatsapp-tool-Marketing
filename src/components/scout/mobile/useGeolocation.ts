"use client";

import { useCallback, useRef, useState } from "react";

export interface FixedPosition {
  readonly lat: number;
  readonly lng: number;
  /** Metres. Google's accuracy circle; anything over ~50 m is a rough fix. */
  readonly accuracyM: number;
}

export type GeolocationStatus = "idle" | "locating" | "ready" | "denied" | "unavailable" | "timeout";

export interface GeolocationState {
  readonly status: GeolocationStatus;
  readonly position: FixedPosition | null;
  /** One sentence, already written for a person standing outdoors. */
  readonly message: string | null;
}

/**
 * "Use my current location", requested on the tap and never before.
 *
 * ## Why nothing here runs on mount
 *
 * A permission prompt the user did not ask for is the fastest way to a
 * permanent "Block" — and once blocked, the button that matters most on this
 * screen is dead for good, on a device the surveyor is standing in a field
 * with. So the request happens on the tap, after the button has said what it is
 * for. The brief makes this a guardrail; it is also simply the only version
 * that keeps working.
 *
 * ## Why the denial path is a path and not a dead end
 *
 * A denied permission still leaves two ways to set the pin: type an address, or
 * drag the pin on the map. `message` says so in those words, because "Location
 * permission denied" tells a salesperson nothing they can act on.
 */
export function useGeolocation(): GeolocationState & {
  request: () => void;
  clear: () => void;
} {
  const [state, setState] = useState<GeolocationState>({
    status: "idle",
    position: null,
    message: null,
  });
  const inFlight = useRef(false);

  const request = useCallback(() => {
    if (inFlight.current) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        status: "unavailable",
        position: null,
        message:
          "This browser cannot report a location. Type the address, or drag the pin onto the plot.",
      });
      return;
    }

    inFlight.current = true;
    setState({ status: "locating", position: null, message: null });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        inFlight.current = false;
        setState({
          status: "ready",
          position: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Math.round(pos.coords.accuracy),
          },
          message:
            pos.coords.accuracy > 60
              ? `Fix is accurate to about ${Math.round(pos.coords.accuracy)} m — drag the pin onto the exact plot.`
              : null,
        });
      },
      (error) => {
        inFlight.current = false;
        if (error.code === error.PERMISSION_DENIED) {
          setState({
            status: "denied",
            position: null,
            message:
              "Location is blocked for this site. Allow it in your browser's site settings, or " +
              "set the plot by typing the address or dragging the pin — both work just as well.",
          });
          return;
        }
        if (error.code === error.TIMEOUT) {
          setState({
            status: "timeout",
            position: null,
            message:
              "No GPS fix yet. Step into the open and tap again, or drag the pin onto the plot.",
          });
          return;
        }
        setState({
          status: "unavailable",
          position: null,
          message:
            "Your device could not report a position. Type the address, or drag the pin onto the plot.",
        });
      },
      {
        enableHighAccuracy: true,
        /**
         * 20 s. A cold GPS fix outdoors routinely takes 10–15 s, and the
         * browser default of "no timeout" is worse than a long one: it leaves
         * the button spinning with nothing to do about it.
         */
        timeout: 20_000,
        /** A fix from the last half minute is the same plot. */
        maximumAge: 30_000,
      },
    );
  }, []);

  const clear = useCallback(() => {
    setState({ status: "idle", position: null, message: null });
  }, []);

  return { ...state, request, clear };
}
