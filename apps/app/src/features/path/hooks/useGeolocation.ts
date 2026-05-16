/**
 * useGeolocation — browser geolocation with graceful fallback.
 *
 * Asks for the rep's current position via navigator.geolocation. If
 * denied, unavailable, or it times out (10s default), falls back to
 * the configured default (downtown Austin) so the map still renders
 * with a sensible center.
 *
 * State machine:
 *   loading    →   first render, before getCurrentPosition resolves
 *   success    →   GPS returned a fix, source = "gps"
 *   fallback   →   GPS failed or denied, source = "default"
 *
 * The hook always returns a usable LatLng — callers never see null —
 * which simplifies the map component (no conditional rendering of the
 * map until coords arrive). The `source` flag lets the UI tell the
 * user whether they're looking at their real location or the default.
 *
 * Browser geolocation prompts are session-scoped — once the user
 * decides allow/deny, the browser remembers. We don't re-prompt on
 * remount.
 */

import * as React from "react";
import { AUSTIN_DOWNTOWN } from "../mockData";

export type GeolocationSource = "gps" | "default";

export interface GeolocationResult {
  lat: number;
  lng: number;
  source: GeolocationSource;
  loading: boolean;
  /** Last error message from the API, for surfacing in the UI if helpful. */
  error: string | null;
  /** Re-attempt the geolocation request — useful for a "use my location" CTA. */
  retry: () => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function useGeolocation(): GeolocationResult {
  const [state, setState] = React.useState<{
    lat: number;
    lng: number;
    source: GeolocationSource;
    loading: boolean;
    error: string | null;
  }>({
    lat: AUSTIN_DOWNTOWN.lat,
    lng: AUSTIN_DOWNTOWN.lng,
    source: "default",
    loading: true,
    error: null,
  });

  const requestRef = React.useRef(0);

  const request = React.useCallback(() => {
    const myRequest = ++requestRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        lat: AUSTIN_DOWNTOWN.lat,
        lng: AUSTIN_DOWNTOWN.lng,
        source: "default",
        loading: false,
        error: "Geolocation not supported in this browser",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Ignore stale resolves if a newer request was kicked off.
        if (myRequest !== requestRef.current) return;
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "gps",
          loading: false,
          error: null,
        });
      },
      (err) => {
        if (myRequest !== requestRef.current) return;
        setState({
          lat: AUSTIN_DOWNTOWN.lat,
          lng: AUSTIN_DOWNTOWN.lng,
          source: "default",
          loading: false,
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
