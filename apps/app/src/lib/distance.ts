/**
 * Distance utilities — Haversine great-circle on a WGS84 sphere.
 *
 * Accurate enough for "merchants near me" (sub-100m error at city scale).
 * If we ever need walking/driving distance instead of straight-line,
 * swap in a routing API (Mapbox Directions, OSRM) — but for sorting
 * pins by proximity, haversine is the right tool.
 *
 * All distances in **meters**. Convert at the call site for display.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000; // mean radius, WGS84

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Pretty distance string for the UI:
 *   <50 m         → "less than 0.1 mi"
 *   <1 mi         → "0.3 mi"
 *   >=1 mi        → "1.4 mi"
 *
 * Always miles for US sales reps. Sprint 2 can add locale-aware formatting.
 */
export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return "less than 0.1 mi";
  if (miles < 1) return `${miles.toFixed(1)} mi`;
  return `${miles.toFixed(1)} mi`;
}

/**
 * Nearest-neighbor route planning — given a start point and a set of
 * stops, return the stops in greedy proximity order. Good enough for
 * field-rep route planning; we're optimizing for "least surprising
 * order," not optimal TSP. Real-world drift between greedy and optimal
 * for ≤10 stops is usually <10%.
 *
 * Returns the input array's indices in visit order (not the points
 * themselves) so callers can reorder their own state.
 */
export function nearestNeighborOrder(start: LatLng, stops: LatLng[]): number[] {
  if (stops.length === 0) return [];

  const order: number[] = [];
  const visited = new Set<number>();
  let cursor = start;

  while (order.length < stops.length) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < stops.length; i++) {
      if (visited.has(i)) continue;
      const d = haversineMeters(cursor, stops[i]!);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break; // defensive — shouldn't happen
    order.push(bestIdx);
    visited.add(bestIdx);
    cursor = stops[bestIdx]!;
  }

  return order;
}
