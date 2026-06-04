/**
 * useMerchants — /path data source (Phase 2: real prospect discovery).
 *
 * Calls the `discover_prospects` Edge Function with the rep's current
 * location. The function:
 *   - serves a warm geohash cell straight from the shared `prospects`
 *     cache (instant, no Google spend), or
 *   - on a cold cell, calls Google Places once, classifies + dedupes
 *     via the ICP filter, stores the result, and returns it (~3s, then
 *     warm for 30 days for every rep).
 *
 * Everything it returns is already in-profile and non-chain (the ICP
 * filter ran at ingest), distance-sorted, and capped at ~30 stops. We
 * map each prospect into the `Merchant` shape the map/list/queue UI
 * already understands.
 *
 * Status: discovered prospects are cold leads with no deal history, so
 * they're all "untouched". Deal lifecycle (prospect/active/won/cooled)
 * arrives in Phase 3 when a Drop-In creates a deal.
 *
 * Replaces the Sprint-1 deals-derived hook that faked NaN coordinates.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth, getProfession } from "@/stores/auth";
import {
  CATEGORY_LABEL,
  type Merchant,
  type MerchantCategory,
} from "../mockData";
import {
  TIER_1_KEYS,
  type IndustryKey,
} from "../../../../../../supabase/functions/_shared/industryTaxonomy";

/** INGEST radius (meters) used when the caller doesn't pass one. The Path radius
 *  chip (5/10/15mi) passes an explicit radiusM, so the selected radius drives the
 *  Google ingest, not just a client filter — picking 15mi tiles + caches a 15mi
 *  area (MAX_CELLS in the Edge bounds the cold-fill cost). 8,047m == 5mi == the
 *  default/smallest chip. */
export const DEFAULT_RADIUS_M = 8_047;

/** One prospect row as returned by the discover_prospects Edge Function
 *  (mirrors the prospects_nearby RPC return shape). Nullable fields are
 *  nullable because Google Places doesn't always populate them. */
export interface ProspectRow {
  id: string;
  place_id: string;
  name: string;
  category: string;
  address: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  employee_count: number | null;
  rating_count: number | null;
  rating: number | null;
  /** Places primaryType (or types[0] fallback), set at ingest. Returned by
   *  prospects_nearby for more reliable downstream categorization. */
  primary_type: string | null;
  is_chain: boolean;
  chain_confidence: string | null;
  chain_brand_name: string | null;
  distance_m: number;
}

interface DiscoverResponse {
  prospects?: ProspectRow[];
}

/**
 * Validate the stored `category` against our MerchantCategory enum.
 *
 * As of Slice 4 the Edge Function buckets every prospect into one of the 13
 * industries at ingest (via the shared `industryTaxonomy` that also drives the
 * per-industry Google pulls), so the `category` we get back is ALREADY a
 * MerchantCategory string. This is now just a guard: known value → pass
 * through, anything else → "other".
 *
 * The old brittle substring rules lived here (and mis-bucketed `barber_shop`
 * → restaurant because "bar" is a substring); bucketing is one place now, on
 * the server, shared with ingest. Legacy rows written by Phase-1 ingest carry
 * fine-grained types (e.g. "dentist") and fall to "other" here until the cell's
 * per-bucket cache expires and re-pulls them with a coarse bucket — acceptable
 * self-healing, no migration needed.
 */
const MERCHANT_CATEGORIES = new Set<string>([
  "manufacturing",
  "construction_trades",
  "healthcare",
  "professional_services",
  "automotive",
  "retail",
  "food_beverage",
  "hospitality",
  "education",
  "finance_banking",
  "fitness_wellness",
  "non_profit",
  "other",
]);

export function categoryFromPlaces(raw: string | null | undefined): MerchantCategory {
  const c = (raw ?? "").toLowerCase().trim();
  return MERCHANT_CATEGORIES.has(c) ? (c as MerchantCategory) : "other";
}

/**
 * Convert one discovered prospect into a Merchant the UI can render.
 * Discovered prospects are always cold ("untouched"), have real coords,
 * and carry the Places stable id so the queue survives a cache refresh.
 */
export function prospectToMerchant(p: ProspectRow): Merchant {
  return {
    id: p.id,
    name: p.name,
    category: categoryFromPlaces(p.category),
    address: p.address ?? "Address unavailable",
    lat: p.lat,
    lng: p.lng,
    phone: p.phone ?? "",
    // Places gives no employee count; leave blank rather than invent a range.
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
    placeId: p.place_id,
    website: p.website ?? undefined,
    ratingCount: p.rating_count ?? undefined,
    rating: p.rating ?? undefined,
    isChain: p.is_chain,
    chainConfidence: (p.chain_confidence as Merchant["chainConfidence"]) ?? null,
    chainBrandName: p.chain_brand_name ?? undefined,
    primaryType: p.primary_type,
  };
}

/**
 * Opportunity score — the in-app re-rank that makes underseen businesses win.
 *
 * Phase A of the opportunity-ranking design (2026-05-31). A merchant-services
 * rep's edge is the under-pitched and newly-opened business; a high review count
 * means a competing processor almost certainly got there first. So review count
 * is anti-signal: fewer reviews → higher opportunity. A brand-new place with no
 * reviews yet (rating_count null/0) is the strongest signal, so it scores 1.
 *
 * 1/(1+reviews) gives a smooth, monotonic decay: 0→1.0, 30→0.032, 84→0.012,
 * 1200→0.0008. The exact curve is a placeholder pending a rep gut-check on real
 * lists (design open question), but the ordering it produces — underseen first —
 * is the agreed behavior. Distance is the tiebreak, handled by the caller
 * relying on a STABLE sort over distance-ordered input (see useMerchants).
 */
export function opportunityScore(m: Pick<Merchant, "ratingCount">): number {
  const reviews = m.ratingCount ?? 0;
  return 1 / (1 + reviews);
}

export interface UseMerchantsResult {
  merchants: Merchant[];
  isLoading: boolean;
  isError: boolean;
  /** Re-pull (used after a manual re-center). */
  refetch: () => void;
}

export interface UseMerchantsOptions {
  radiusM?: number;
  /** Industry buckets to ingest. Defaults to Tier 1 when omitted. */
  industries?: IndustryKey[];
  /** When true, the read includes chains (flagged via isChain) so browse can
   *  show + badge them. Create stays chain-free via proposeRoute. Default off. */
  includeChains?: boolean;
}

/** Round to ~110m so GPS jitter doesn't refire the query (and Google) on
 *  every sub-meter drift. The geohash cell is ~4.9km, so this is plenty
 *  stable while still re-pulling when the rep actually moves. */
function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param origin  the rep's lat/lng, or null while geolocation is settling.
 *                When null the query is disabled (no flicker, no premature
 *                Google call against a default location).
 */
export function useMerchants(
  origin: { lat: number; lng: number } | null,
  opts: UseMerchantsOptions = {},
): UseMerchantsResult {
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const industries = opts.industries && opts.industries.length > 0 ? opts.industries : TIER_1_KEYS;
  const includeChains = opts.includeChains ?? false;
  const user = useAuth((s) => s.user);
  const profession = getProfession(user);

  const lat = origin ? roundCoord(origin.lat) : null;
  const lng = origin ? roundCoord(origin.lng) : null;

  const query = useQuery({
    queryKey: ["path", "prospects", lat, lng, radiusM, profession, industries, includeChains],
    enabled: origin != null,
    staleTime: 5 * 60_000, // 5 min — the server-side cache is the real TTL
    queryFn: async (): Promise<Merchant[]> => {
      const { data, error } = await supabase.functions.invoke<DiscoverResponse>(
        "discover_prospects",
        { body: { lat: origin!.lat, lng: origin!.lng, radius_m: radiusM, profession, industries, include_chains: includeChains } },
      );
      if (error) throw error;
      // Returns the server's nearest-first order. Ordering for display lives in
      // the page via sortMerchants() (distance / opportunity / popularity), so
      // the hook stays a pure data source.
      return (data?.prospects ?? []).map(prospectToMerchant);
    },
  });

  return {
    merchants: query.data ?? [],
    isLoading: query.isLoading && query.fetchStatus !== "idle",
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

// Re-exported so consumers don't have to dig through mockData.ts.
export { CATEGORY_LABEL };
