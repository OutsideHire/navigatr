/**
 * useMerchants — /path data source.
 *
 * Sprint 1: derived view over the rep's deals. Each deal becomes a
 * Merchant record; status maps from deal stage; lat/lng are null until
 * we add a geocoding step (next session). The list view works fully;
 * the map degrades gracefully when no merchants have coordinates.
 *
 * Why deals (not partners or a separate "prospects" table)?
 *   - Deals are the source of truth for "businesses the rep is working".
 *     /path is the field-rep view of that same data — different lens,
 *     same underlying records.
 *   - Partners are people (CPAs, bankers) the rep refers TO, not
 *     businesses they're selling to. They don't belong on the map.
 *   - There's no separate "prospects" table; if a rep wants a merchant
 *     to appear on /path, they add it as a deal (stage = "new").
 *
 * Sprint 2 will add: geocoding on deal create/update, a separate
 * "icp_prospects" table for cold leads that aren't deals yet, and the
 * Places.searchNearby fallback for discovery.
 */

import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import {
  CATEGORY_LABEL,
  type Merchant,
  type MerchantCategory,
  type MerchantStatus,
} from "../mockData";
import type { Deal, DealStage } from "@/features/pipeline/mockData";

/** Deal stage → /path merchant status. Stages collapse into the visual
 *  buckets the map markers + list pills already understand. */
const STAGE_TO_STATUS: Record<DealStage, MerchantStatus> = {
  new:       "untouched",
  contacted: "prospect",
  qualified: "active",
  proposal:  "active",
  won:       "won",
};

/** Convert one deal into a Merchant. Address-free deals still show in the
 *  list (the row just shows "Address not set" instead of a street). */
function dealToMerchant(d: Deal): Merchant {
  return {
    id: d.id,
    name: d.companyName,
    // We don't store category on deals (yet). "other" keeps the badge
    // visible without lying about a category we never asked the rep for.
    category: "other" as MerchantCategory,
    address: d.address ?? "Address not set",
    // lat/lng absent → map filters this out, list keeps it. NaN sentinel
    // is intentional: numeric type is preserved (no TS gymnastics) but
    // any haversine math returns NaN, which we can guard on cheaply.
    lat: Number.NaN,
    lng: Number.NaN,
    phone: d.phone,
    email: d.email || undefined,
    employeeCountRange: d.employeeCountRange,
    status: STAGE_TO_STATUS[d.stage],
    lastActivity: d.lastActivity,
    note: undefined,
  };
}

export interface UseMerchantsResult {
  merchants: Merchant[];
  isLoading: boolean;
  isError: boolean;
}

export function useMerchants(): UseMerchantsResult {
  const { data: deals = [], isLoading, isError } = useDeals();

  const merchants = React.useMemo<Merchant[]>(
    () => deals.map(dealToMerchant),
    [deals],
  );

  return { merchants, isLoading, isError };
}

// Keep the labels handy for any new consumers — re-exported so callers
// don't have to dig through mockData.ts.
export { CATEGORY_LABEL };
