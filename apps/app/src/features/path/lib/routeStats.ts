/**
 * routeStats — pure route math for the Path Create-flow preview and the
 * completion summary. All straight-line (haversine): we deliberately do NOT
 * call a routing API in MVP, so ETA is a labeled ESTIMATE, not a promise.
 *
 *  - stopCount:        number of stops
 *  - nearestMeters:    closest stop to the origin (null when no stops)
 *  - furthestMeters:   farthest stop from the origin (null when no stops)
 *  - totalRouteMeters: origin → stop[0] → stop[1] → … summed in the given order
 *  - etaMinutes:       drive time at AVG_SPEED_MPH + DWELL_MIN per stop, rounded
 */
import { haversineMeters, type LatLng } from "@/lib/distance";

/** Conservative urban/suburban field-rep driving average. */
const AVG_SPEED_MPH = 30;
/** Time spent per stop (walk in, pitch, log). */
const DWELL_MIN = 15;
const METERS_PER_MILE = 1609.344;

export interface RouteStats {
  stopCount: number;
  nearestMeters: number | null;
  furthestMeters: number | null;
  totalRouteMeters: number;
  etaMinutes: number;
}

export function routeStats(origin: LatLng, orderedStops: LatLng[]): RouteStats {
  if (orderedStops.length === 0) {
    return {
      stopCount: 0,
      nearestMeters: null,
      furthestMeters: null,
      totalRouteMeters: 0,
      etaMinutes: 0,
    };
  }

  const fromOrigin = orderedStops.map((s) => haversineMeters(origin, s));
  const nearestMeters = Math.min(...fromOrigin);
  const furthestMeters = Math.max(...fromOrigin);

  let totalRouteMeters = 0;
  let prev = origin;
  for (const s of orderedStops) {
    totalRouteMeters += haversineMeters(prev, s);
    prev = s;
  }

  const driveMinutes = (totalRouteMeters / METERS_PER_MILE / AVG_SPEED_MPH) * 60;
  const etaMinutes = Math.round(driveMinutes + DWELL_MIN * orderedStops.length);

  return {
    stopCount: orderedStops.length,
    nearestMeters,
    furthestMeters,
    totalRouteMeters,
    etaMinutes,
  };
}

/** "~3h 30m" / "~45m" — compact ETA label for the preview + summary. */
export function formatEta(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `~${m}m`;
  if (m === 0) return `~${h}h`;
  return `~${h}h ${m}m`;
}
