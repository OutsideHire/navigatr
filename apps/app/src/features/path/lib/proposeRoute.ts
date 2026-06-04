/**
 * Create-path selection + ordering, as pure functions so the wizard's Select-stops
 * list and the started queue agree. candidatePool = the full filtered+sorted pool
 * (drives the list); orderStops = nearest-neighbor ordering of a chosen set (drives
 * Start + the live distance/ETA). proposeRoute composes them (top-N auto-route) and
 * is retained only while a caller needs it.
 */
import { nearestNeighborOrder, type LatLng } from "@/lib/distance";
import { sortMerchants, type PathSortMode } from "./sortMerchants";
import { matchesSelection, type IndustrySelection } from "./industrySelection";
import type { Merchant, MerchantCategory } from "../mockData";

export interface CandidatePoolOpts {
  /** Category buckets to include. EMPTY = all. Ignored when `selection` is set. */
  industries: MerchantCategory[];
  sortMode: PathSortMode;
  /** Category→sub-type refinement; supersedes `industries` (null primaryType kept). */
  selection?: IndustrySelection;
  /** Inclusive rating floor; unrated dropped when > 0. */
  minRating?: number;
}

/** The full filtered + sorted candidate pool (no top-N slice, no ordering). */
export function candidatePool<T extends Merchant & { distanceMeters?: number }>(
  merchants: T[],
  opts: CandidatePoolOpts,
): T[] {
  const geocoded = merchants.filter(
    (mch) => Number.isFinite(mch.lat) && Number.isFinite(mch.lng) && !mch.isChain,
  );
  const byRating =
    opts.minRating && opts.minRating > 0
      ? geocoded.filter((mch) => (mch.rating ?? 0) >= opts.minRating!)
      : geocoded;
  const byIndustry = opts.selection
    ? byRating.filter((mch) => matchesSelection(mch.primaryType ?? null, mch.category, opts.selection!))
    : opts.industries.length === 0
      ? byRating
      : byRating.filter((mch) => opts.industries.includes(mch.category));
  return sortMerchants(byIndustry, opts.sortMode);
}

/** Nearest-neighbor-order a chosen set from the origin. */
export function orderStops<T extends Merchant & { distanceMeters?: number }>(
  origin: LatLng,
  chosen: T[],
): T[] {
  if (chosen.length === 0) return [];
  const order = nearestNeighborOrder(origin, chosen.map((mch) => ({ lat: mch.lat, lng: mch.lng })));
  return order.map((i) => chosen[i]!);
}

export interface ProposeRouteOpts extends CandidatePoolOpts {
  origin: LatLng;
  stopCap: number;
}

/** The auto-built top-N route: pool → top-N → ordered. */
export function proposeRoute<T extends Merchant & { distanceMeters?: number }>(
  merchants: T[],
  opts: ProposeRouteOpts,
): T[] {
  return orderStops(opts.origin, candidatePool(merchants, opts).slice(0, opts.stopCap));
}
