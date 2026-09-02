/**
 * useDealSearchBias — the location bias for the Add-Deal-via-Places search.
 *
 * Biases Google Places autocomplete to the rep's area so results are nearby
 * rather than nationwide (the resolve_place edge function draws a 50km circle
 * around this point). Resolution order:
 *   1. live GPS (useGeolocation) = the rep's current position; else
 *   2. the rep's active path origin (today's saved starting point); else
 *   3. undefined = no bias, search behaves as it did before.
 *
 * `open` gates the whole thing: the Add-Deal sheet is always mounted, so we
 * only request GPS (a browser prompt) and read the active path once the sheet
 * is actually opened.
 */
import { useGeolocation } from "@/features/path/hooks/useGeolocation";
import { useActivePath } from "@/features/path/hooks/useActivePath";
import { todayISO } from "@/features/path/lib/today";

export function useDealSearchBias(open: boolean): { lat: number; lng: number } | undefined {
  const geo = useGeolocation({ enabled: open });
  // useActivePath is disabled on an empty date, so this is inert until `open`
  // (and reuses the Path page's cached active-path read when present).
  const active = useActivePath(open ? todayISO() : "");

  if (geo.coords) return geo.coords;

  const path = active.data?.path;
  if (path && path.originLat != null && path.originLng != null) {
    return { lat: path.originLat, lng: path.originLng };
  }
  return undefined;
}
