/**
 * usePathOrigin — resolves the Path page's working location.
 *
 * Composes the GPS layer (useGeolocation) with a session-only manual override
 * entered via city/ZIP search. Manual selection wins when present; otherwise we
 * use the GPS fix once it's ready; otherwise origin is null and the page shows
 * its empty/loading state. Manual selection lives only in React state — a reload
 * reverts to GPS by design.
 */

import * as React from "react";
import { supabase } from "@/lib/supabase";
import { useGeolocation, type GeoStatus } from "./useGeolocation";

interface GeocodeResponse {
  result: { lat: number; lng: number; label: string } | null;
}

export interface PathOrigin {
  /** The coordinate to discover prospects around, or null if we have none. */
  origin: { lat: number; lng: number } | null;
  originSource: "gps" | "manual" | null;
  /** Human label for the active origin ("Current location" or the city). */
  originLabel: string | null;
  geoStatus: GeoStatus;
  searching: boolean;
  searchError: string | null;
  /** Geocode a city/ZIP and set it as the manual origin. */
  searchLocation: (query: string) => Promise<void>;
  /** Drop the manual override and re-request GPS. */
  useMyLocation: () => void;
}

export function usePathOrigin(): PathOrigin {
  const geo = useGeolocation();
  const { retry } = geo;
  const [manual, setManual] = React.useState<
    { coords: { lat: number; lng: number }; label: string } | null
  >(null);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);

  const searchLocation = React.useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const { data, error } = await supabase.functions.invoke<GeocodeResponse>(
        "geocode",
        { body: { query: q } },
      );
      if (error) throw error;
      if (!data?.result) {
        setSearchError("No match — try a city or ZIP");
        return;
      }
      setManual({
        coords: { lat: data.result.lat, lng: data.result.lng },
        label: data.result.label,
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[usePathOrigin] geocode failed", err);
      setSearchError("Couldn't search that location. Try again.");
    } finally {
      setSearching(false);
    }
  }, []);

  const useMyLocation = React.useCallback(() => {
    setManual(null);
    setSearchError(null);
    retry();
  }, [retry]);

  // coords is guaranteed non-null by useGeolocation when status === "ready".
  const gpsReady = geo.status === "ready" && geo.coords !== null;
  const origin = manual?.coords ?? (gpsReady ? geo.coords : null);
  const originSource: "gps" | "manual" | null = manual ? "manual" : gpsReady ? "gps" : null;
  const originLabel = manual ? manual.label : gpsReady ? "Current location" : null;

  return {
    origin,
    originSource,
    originLabel,
    geoStatus: geo.status,
    searching,
    searchError,
    searchLocation,
    useMyLocation,
  };
}
