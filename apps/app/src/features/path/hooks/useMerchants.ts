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

/** Default search radius (meters) when the caller doesn't specify one.
 *  ~3km ≈ a walkable/short-drive field day, and sits inside one geohash
 *  precision-5 cell so the cache stays effective. */
export const DEFAULT_RADIUS_M = 3000;

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
  distance_m: number;
}

interface DiscoverResponse {
  prospects?: ProspectRow[];
}

/**
 * Map a raw Google Places category string into our coarse 8-value
 * MerchantCategory. Google emits hundreds of specific types
 * ("barbecue_restaurant", "hair_salon", "car_repair", …); we bucket
 * them by keyword so the filter chips stay manageable. First match
 * wins; unmatched → "other".
 */
const CATEGORY_RULES: Array<{ test: (c: string) => boolean; category: MerchantCategory }> = [
  {
    category: "restaurant",
    test: (c) =>
      c.includes("restaurant") ||
      c.includes("cafe") ||
      c.includes("coffee") ||
      c.includes("bakery") ||
      c.includes("bar") ||
      c.includes("food") ||
      c.includes("meal_") ||
      c.includes("diner") ||
      c.includes("pub") ||
      c.includes("eatery"),
  },
  {
    category: "healthcare",
    test: (c) =>
      c.includes("dentist") ||
      c.includes("dental") ||
      c.includes("doctor") ||
      c.includes("clinic") ||
      c.includes("medical") ||
      c.includes("pharmacy") ||
      c.includes("physio") ||
      c.includes("chiropractor") ||
      c.includes("veterinary") ||
      c.includes("vet") ||
      c.includes("health"),
  },
  {
    category: "automotive",
    test: (c) =>
      c.includes("car_") ||
      c.includes("auto") ||
      c.includes("vehicle") ||
      c.includes("gas_station") ||
      c.includes("tire") ||
      c.includes("mechanic"),
  },
  {
    category: "personal_services",
    test: (c) =>
      c.includes("hair") ||
      c.includes("salon") ||
      c.includes("barber") ||
      c.includes("spa") ||
      c.includes("beauty") ||
      c.includes("nail") ||
      c.includes("gym") ||
      c.includes("fitness") ||
      c.includes("yoga") ||
      c.includes("massage") ||
      c.includes("laundry") ||
      c.includes("dry_cleaning"),
  },
  {
    category: "hospitality",
    test: (c) => c.includes("lodging") || c.includes("hotel") || c.includes("motel") || c.includes("resort"),
  },
  {
    category: "professional_services",
    test: (c) =>
      c.includes("lawyer") ||
      c.includes("legal") ||
      c.includes("accounting") ||
      c.includes("insurance") ||
      c.includes("real_estate") ||
      c.includes("finance") ||
      c.includes("consult") ||
      c.includes("agency") ||
      c.includes("plumb") ||
      c.includes("electrician") ||
      c.includes("contractor"),
  },
  {
    category: "retail",
    test: (c) =>
      c.includes("store") ||
      c.includes("shop") ||
      c.includes("retail") ||
      c.includes("market") ||
      c.includes("boutique") ||
      c.includes("supermarket") ||
      c.includes("grocery") ||
      c.includes("clothing") ||
      c.includes("florist") ||
      c.includes("furniture"),
  },
];

export function categoryFromPlaces(raw: string | null | undefined): MerchantCategory {
  const c = (raw ?? "").toLowerCase().trim();
  if (!c) return "other";
  for (const rule of CATEGORY_RULES) {
    if (rule.test(c)) return rule.category;
  }
  return "other";
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
  };
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
  const user = useAuth((s) => s.user);
  const profession = getProfession(user);

  const lat = origin ? roundCoord(origin.lat) : null;
  const lng = origin ? roundCoord(origin.lng) : null;

  const query = useQuery({
    queryKey: ["path", "prospects", lat, lng, radiusM, profession],
    enabled: origin != null,
    staleTime: 5 * 60_000, // 5 min — the server-side cache is the real TTL
    queryFn: async (): Promise<Merchant[]> => {
      const { data, error } = await supabase.functions.invoke<DiscoverResponse>(
        "discover_prospects",
        { body: { lat: origin!.lat, lng: origin!.lng, radius_m: radiusM, profession } },
      );
      if (error) throw error;
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
