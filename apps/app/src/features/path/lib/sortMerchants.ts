/**
 * sortMerchants — the single place that orders a Path merchant list.
 *
 * Extracted from useMerchants so the same ordering powers the browse list
 * (Find near me) and Slice 2's route-preview sort tabs. Pure + stable: equal
 * keys keep input order, so callers that pass a distance-ordered list get
 * distance as the natural tiebreak.
 *
 *  - distance:    nearest first; unknown distance (Infinity) sinks to the bottom
 *  - popularity:  highest Google review count first (Find near me default)
 *  - opportunity: fewest reviews first — underseen/newly-opened win (Create default)
 */
import type { Merchant } from "../mockData";
import { opportunityScore } from "../hooks/useMerchants";

export type PathSortMode = "distance" | "opportunity" | "popularity";

export function sortMerchants<T extends Merchant & { distanceMeters?: number }>(
  list: T[],
  mode: PathSortMode,
): T[] {
  const copy = [...list];
  switch (mode) {
    case "distance":
      return copy.sort(
        (a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY),
      );
    case "popularity":
      return copy.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
    case "opportunity":
      return copy.sort((a, b) => opportunityScore(b) - opportunityScore(a));
    default:
      return copy;
  }
}
