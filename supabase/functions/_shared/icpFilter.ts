// ICP filter — the pure classification core of Path prospect ingest.
//
// FR-PATH-11→15. Given a raw Google Places candidate, decide:
//   - normalized category
//   - in_profile?  (passes the category gate — not consumer-only)
//   - is_chain?    (seed-list match, same-name density, or gov/utility/hospital)
//   - chain_reason (which rule fired)
//
// This module is DELIBERATELY pure and Deno-free: no network, no Supabase, no
// Deno globals. That's so it can be unit-tested in isolation (icpFilter.test.ts)
// and reused by any host. The Edge Function (index.ts) feeds it data it has
// already fetched (the candidate, the active seed patterns, and the count of
// same-name prospects already cached nearby) and stores the verdict.
//
// Thresholds + category lists live in DEFAULT_ICP_CONFIG. FR-PATH-16 will make
// these per-tenant/per-profession configurable; for Phase 1 they're sensible
// defaults that "work out of the box."

export interface IcpConfig {
  /** FR-PATH-14: same-name locations within radius → treat as a chain. */
  sameNameChainThreshold: number;
  /** FR-PATH-14: employee-count cutoff. Vendor-gated — off by default because
   *  Google Places doesn't return employee count (see PATH_DESIGN.md §6). */
  maxEmployeeCount: number | null;
  /** Google Places types that are consumer-only / never B2B prospects. */
  consumerOnlyTypes: string[];
  /** Government / military / utility / major-hospital types to exclude. */
  institutionalTypes: string[];
  /** FR-PATH-14: national/global enterprise brand fragments. POPULARITY ranking
   *  surfaces big-enterprise offices (Deloitte, McKinsey, Realtor.com) in the
   *  professional_services bucket — they're not the independent-SMB target, and
   *  Places gives us no employee count to filter them structurally, so we exclude
   *  the well-known ones by name, exactly like the chain seed list. Curated and
   *  deliberately conservative: locally-owned franchises (RE/MAX, Keller Williams)
   *  are NOT here because each office runs its own books = real ICP. */
  enterpriseBrands: string[];
}

export const DEFAULT_ICP_CONFIG: IcpConfig = {
  sameNameChainThreshold: 10, // ">10 same-name within radius" → 11th+ is a chain
  maxEmployeeCount: null, // vendor-gated; no employee data from Places
  consumerOnlyTypes: [
    // residential — NOT lodging. Hotels/motels/RV parks process large card
    // volume AND run payroll, so they're valid B2B prospects (PATH_DESIGN §6.1,
    // "include hotels" decision). Only true residential property stays out.
    "apartment_complex",
    "apartment_building",
    // tourist / civic attractions
    "tourist_attraction",
    "amusement_park",
    "aquarium",
    "zoo",
    "national_park",
    "park",
    "museum",
    // large venues / recreation — usually institutional or corporate-managed,
    // not the independent-SMB target. These leaked through in early testing
    // (arena, event venue, parking garage), so they're excluded explicitly.
    "stadium",
    "arena",
    "amphitheatre",
    "event_venue",
    "convention_center",
    "performing_arts_theater",
    "concert_hall",
    "parking",
    "parking_garage",
    // municipal recreation — city-run pools/rec centers. Google tags these
    // "swimming_pool" with no government type, so the institutional gate misses
    // them (e.g. Barton Springs Pool, austintexas.gov). A private swim school
    // is rare enough in the SMB target that blanket-excluding the type is the
    // right Phase-1 tradeoff (PATH_DESIGN §6.1).
    "swimming_pool",
    // worship
    "place_of_worship",
    "church",
    "mosque",
    "synagogue",
    "hindu_temple",
    // schools
    "school",
    "primary_school",
    "secondary_school",
    "preschool",
    "university",
  ],
  institutionalTypes: [
    "local_government_office",
    "city_hall",
    "courthouse",
    "embassy",
    "fire_station",
    "police",
    "post_office",
    "hospital",
    "military_base",
    "library", // public libraries are civic/government, not SMB prospects
  ],
  enterpriseBrands: [
    // Big-4 accounting / global consulting — national firms, not local SMBs.
    "deloitte",
    "kpmg",
    "pwc",
    "pricewaterhousecoopers",
    "ernst & young",
    "ernst and young",
    "accenture",
    // Strategy consultancies.
    "mckinsey",
    "bain & company",
    "boston consulting",
    // Real-estate / listing portals (national tech, not a local brokerage).
    "realtor.com",
    "zillow",
    "redfin",
    // Large-enterprise HQs that leaked through POPULARITY in early testing.
    "silicon labs",
    "silicon laboratories",
  ],
};

export type ChainReason =
  | "seed_list"
  | "same_name_density"
  | "category"
  | "gov"
  | "enterprise"
  | "employee_count";

export interface ProspectCandidate {
  placeId: string;
  name: string;
  /** Raw Google Places primary + secondary types, lowercased by the caller
   *  is fine but we lowercase defensively here too. */
  types: string[];
  employeeCount?: number | null;
}

export interface IcpVerdict {
  /** Normalized primary category we store and later filter on. */
  category: string;
  /** Passed the category gate — eligible to show to at least one profession. */
  inProfile: boolean;
  isChain: boolean;
  chainReason: ChainReason | null;
}

/** Lowercase + trim a list of types, dropping empties. */
function normTypes(types: string[]): string[] {
  return types
    .map((t) => (t ?? "").toString().trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Normalize a candidate's Google types into a single primary category string.
 * Keeps the first non-generic type; falls back to "other". Google emits noise
 * types like "point_of_interest" and "establishment" on almost everything —
 * we strip those so the stored category is meaningful.
 */
const GENERIC_TYPES = new Set(["point_of_interest", "establishment", "premise", "geocode"]);

export function normalizeCategory(types: string[]): string {
  const t = normTypes(types).filter((x) => !GENERIC_TYPES.has(x));
  return t[0] ?? "other";
}

/** FR-PATH-15: is this a consumer-only category we never prospect? */
export function isConsumerOnly(types: string[], config: IcpConfig = DEFAULT_ICP_CONFIG): boolean {
  const t = new Set(normTypes(types));
  return config.consumerOnlyTypes.some((c) => t.has(c));
}

/** FR-PATH-14: government / military / utility / major-hospital. */
export function isInstitutional(types: string[], config: IcpConfig = DEFAULT_ICP_CONFIG): boolean {
  const t = new Set(normTypes(types));
  return config.institutionalTypes.some((c) => t.has(c));
}

/**
 * FR-PATH-12: does the business name match a curated chain seed pattern?
 * Case-insensitive substring match. Returns the matched brand or null.
 * `seedPatterns` is [{ pattern, brand }] from the active exclusion_seed rows.
 */
export function matchesSeed(
  name: string,
  seedPatterns: Array<{ pattern: string; brand: string }>,
): string | null {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  for (const { pattern, brand } of seedPatterns) {
    const p = (pattern ?? "").toLowerCase().trim();
    if (p && n.includes(p)) return brand;
  }
  return null;
}

/**
 * FR-PATH-14: does the business name match a curated national-enterprise brand?
 * Case-insensitive substring match, same shape as matchesSeed. Returns the
 * matched fragment (truthy) or null. Kept separate from the seed list so the
 * verdict can carry an "enterprise" reason distinct from "seed_list".
 */
export function matchesEnterprise(name: string, config: IcpConfig = DEFAULT_ICP_CONFIG): string | null {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  for (const brand of config.enterpriseBrands) {
    const b = (brand ?? "").toLowerCase().trim();
    if (b && n.includes(b)) return b;
  }
  return null;
}

/**
 * The full verdict for one candidate.
 *
 * @param candidate        the raw Places business
 * @param seedPatterns     active exclusion_seed rows ({ pattern, brand })
 * @param sameNameNearby   how many prospects with this exact (lowercased) name
 *                         are ALREADY cached within the density radius. The
 *                         caller computes this; threshold compares against it.
 * @param config           thresholds + category lists (defaults provided)
 */
export function classifyProspect(
  candidate: ProspectCandidate,
  seedPatterns: Array<{ pattern: string; brand: string }>,
  sameNameNearby: number,
  config: IcpConfig = DEFAULT_ICP_CONFIG,
): IcpVerdict {
  const category = normalizeCategory(candidate.types);

  // 1. Category gate (FR-PATH-15). Consumer-only → not in profile at all.
  if (isConsumerOnly(candidate.types, config)) {
    return { category, inProfile: false, isChain: false, chainReason: null };
  }

  // 2. Institutional gate (FR-PATH-14). Gov/military/utility/hospital → chain-flagged
  //    so it's filtered out of the servable set, with a clear reason code.
  if (isInstitutional(candidate.types, config)) {
    return { category, inProfile: true, isChain: true, chainReason: "gov" };
  }

  // 3. Curated seed list (FR-PATH-12). Known national/regional chain.
  if (matchesSeed(candidate.name, seedPatterns)) {
    return { category, inProfile: true, isChain: true, chainReason: "seed_list" };
  }

  // 4. National-enterprise brand (FR-PATH-14). Big-4 / global consulting /
  //    listing portals that POPULARITY ranking floats to the top of
  //    professional_services. Not an independent SMB → filtered, reason
  //    "enterprise" (distinct from a restaurant/retail chain seed match).
  if (matchesEnterprise(candidate.name, config)) {
    return { category, inProfile: true, isChain: true, chainReason: "enterprise" };
  }

  // 5. Same-name density heuristic (FR-PATH-14). Catches UNKNOWN chains the
  //    seed list misses. ">10 same-name within radius" → the 11th is a chain.
  if (sameNameNearby > config.sameNameChainThreshold) {
    return { category, inProfile: true, isChain: true, chainReason: "same_name_density" };
  }

  // 6. Employee count (FR-PATH-14). Vendor-gated: only fires if we both have a
  //    count AND a configured cutoff. Off by default (Places has no count).
  if (
    config.maxEmployeeCount != null &&
    candidate.employeeCount != null &&
    candidate.employeeCount > config.maxEmployeeCount
  ) {
    return { category, inProfile: true, isChain: true, chainReason: "employee_count" };
  }

  // Survives all gates → a servable SMB/B2B prospect.
  return { category, inProfile: true, isChain: false, chainReason: null };
}
