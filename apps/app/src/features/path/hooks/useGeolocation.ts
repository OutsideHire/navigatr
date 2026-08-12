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
 *
 * Watch mode (opt-in): pass `{ watch: true }` and the hook subscribes to
 * `watchPosition` so `coords` STREAMS as the rep moves (the running map's live
 * rep marker, Path v2.2 3.3). The active watch is cleared on unmount and before
 * every re-request. The default (no options) stays a one-shot `getCurrentPosition`,
 * so the landing / usePathOrigin uses are unchanged.
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

export interface UseGeolocationOptions {
  /** When true, subscribe to continuous position updates via `watchPosition`
   *  (the running map's live rep marker). Default false = one-shot getter. */
  watch?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function useGeolocation({ watch = false }: UseGeolocationOptions = {}): GeolocationResult {
  const [state, setState] = React.useState<{
    coords: { lat: number; lng: number } | null;
    status: GeoStatus;
    error: string | null;
  }>({ coords: null, status: "loading", error: null });

  const requestRef = React.useRef(0);
  // Active watchPosition id (watch mode only), so we can clear it before a
  // re-request and on unmount.
  const watchIdRef = React.useRef<number | null>(null);

  const clearActiveWatch = React.useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined" && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

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

    // Tear down any prior watch before (re)subscribing so a retry / permission
    // change never leaves two live subscriptions running.
    clearActiveWatch();

    const onOk = (pos: GeolocationPosition) => {
      if (myRequest !== requestRef.current) return; // ignore stale resolves
      setState({
        coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        status: "ready",
        error: null,
      });
    };
    const onErr = (err: GeolocationPositionError) => {
      if (myRequest !== requestRef.current) return;
      // code 1 = PERMISSION_DENIED; 2 = POSITION_UNAVAILABLE; 3 = TIMEOUT
      setState({
        coords: null,
        status: err.code === 1 ? "denied" : "unavailable",
        error: err.message,
      });
    };
    // maximumAge: accept a cached fix up to 60 s old — cuts latency on
    // re-opens without a meaningfully stale position for a moving rep.
    const opts: PositionOptions = { enableHighAccuracy: false, timeout: DEFAULT_TIMEOUT_MS, maximumAge: 60_000 };

    if (watch) {
      watchIdRef.current = navigator.geolocation.watchPosition(onOk, onErr, opts);
    } else {
      navigator.geolocation.getCurrentPosition(onOk, onErr, opts);
    }
  }, [watch, clearActiveWatch]);

  React.useEffect(() => {
    request();
    return () => clearActiveWatch();
  }, [request, clearActiveWatch]);

  // Auto-recover when the user re-enables location in browser settings: watch the
  // geolocation permission and re-request on any change (granted → silent fix;
  // reset-to-ask → re-prompt; blocked → brief loading flash, then re-enters
  // denied). Best-effort — browsers without the geolocation Permissions API
  // (older Safari) skip this silently.
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => { if (!cancelled) request(); };
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        status.addEventListener("change", onChange);
      })
      .catch(() => {
        /* permission name unsupported — skip auto-recovery */
      });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, [request]);

  return { ...state, retry: request };
}
