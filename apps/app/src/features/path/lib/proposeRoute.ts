/**
 * proposeRoute — the Create-path selection + ordering, as a pure function so the
 * wizard preview and the started queue agree. The sort mode picks WHICH leads
 * make the cut (opportunity = best leads, distance = closest); the route itself
 * is always nearest-neighbor ordered, matching how PathPage orders the live
 * queue (PathPage re-runs nearestNeighborOrder on the same stops + origin, so
 * preview order == queue order == map polyline order).
 */
import { nearestNeighborOrder, type LatLng } from "@/lib/distance";
import { sortMerchants, type PathSortMode } from "./sortMerchants";
import type { Merchant } from "../mockData";

export interface ProposeRouteOpts {
  origin: LatLng;
  /** "all" or a MerchantCategory value. */
  industry: string;
  sortMode: PathSortMode;
  stopCap: number;
}

export function proposeRoute<T extends Merchant & { distanceMeters?: number }>(
  merchants: T[],
  opts: ProposeRouteOpts,
): T[] {
  const geocoded = merchants.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  const byIndustry =
    opts.industry === "all" ? geocoded : geocoded.filter((m) => m.category === opts.industry);
  const topN = sortMerchants(byIndustry, opts.sortMode).slice(0, opts.stopCap);
  if (topN.length === 0) return [];
  const order = nearestNeighborOrder(opts.origin, topN.map((m) => ({ lat: m.lat, lng: m.lng })));
  return order.map((i) => topN[i]!);
}
