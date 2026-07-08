import { haversineMeters, type LatLng } from "@/lib/distance";

// Slice-1 drive-time heuristic: straight-line distance at an average speed.
// The single source for both routeStats and the day scheduler; a Directions
// API is a later precision upgrade. ETA is a labeled ESTIMATE, not a promise.
export const AVG_SPEED_MPH = 30;
const METERS_PER_MILE = 1609.344;

export function driveMinutesBetween(a: LatLng, b: LatLng): number {
  const meters = haversineMeters(a, b);
  return (meters / METERS_PER_MILE / AVG_SPEED_MPH) * 60;
}
