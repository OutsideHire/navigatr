/**
 * useGeolocation — browser geolocation with an honest "no location" state.
 *
 * Requests the rep's position via navigator.geolocation on mount. Unlike the
 * old version, it NEVER fabricates a coordinate: when GPS is denied, times out,
 * or is unavailable, coords stays null and `status` says why. Callers decide
 * what to render (PathPage shows an empty state + manual search).
 *
 * State machine:
 *   loading      → request in flight (initial mount + retry); coords null
 *   ready        → GPS fix; coords set
 *   denied       → PERMISSION_DENIED (code 1); coords null
 *   unavailable  → no geolocation API, POSITION_UNAVAILABLE (2), or TIMEOUT (3)
 *
 * Browser geolocation prompts are session-scoped — the browser remembers the
 * allow/deny decision, so we don't re-prompt on remount.
 */

import * as React from "react";

export type GeoStatus = "loading" | "ready" | "denied" | "unavailable";

export interface GeolocationResult {
  /** Set only when status === "ready". Null in every other state. */
  coords: { lat: number; lng: number } | null;
  status: GeoStatus;
  /** Last error message from the API, for surfacing in the UI if helpful. */
  error: string | null;
  /** Re-attempt the geolocation request — used by a "use my location" CTA. */
  retry: () => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function useGeolocation(): GeolocationResult {
  const [state, setState] = React.useState<{
    coords: { lat: number; lng: number } | null;
    status: GeoStatus;
    error: string | null;
  }>({ coords: null, status: "loading", error: null });

  const requestRef = React.useRef(0);

  const request = React.useCallback(() => {
    const myRequest = ++requestRef.current;
    setState((s) => ({ ...s, status: "loading", error: null }));

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        coords: null,
        status: "unavailable",
        error: "Geolocation not supported in this browser",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (myRequest !== requestRef.current) return; // ignore stale resolves
        setState({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          status: "ready",
          error: null,
        });
      },
      (err) => {
        if (myRequest !== requestRef.current) return;
        // code 1 = PERMISSION_DENIED; 2 = POSITION_UNAVAILABLE; 3 = TIMEOUT
        setState({
          coords: null,
          status: err.code === 1 ? "denied" : "unavailable",
          error: err.message,
        });
      },
      { enableHighAccuracy: false, timeout: DEFAULT_TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, []);

  React.useEffect(() => {
    request();
  }, [request]);

  return { ...state, retry: request };
}
