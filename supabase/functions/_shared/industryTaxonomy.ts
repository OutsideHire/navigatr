// Industry taxonomy — the single source of truth for Path prospect ingest +
// display (Slice 4, from places_api_taxonomy_path_feature.xlsx).
//
//   includedTypes (per industry) → the searchNearby `includedTypes` for that
//     industry's per-bucket pull (Gate 1, ingest targeting).
//   bucketForType(types, primaryType) → the industry we store + display
//     (Gate 2). Overlaps resolve Tier-1-first then declared order.
//
// Replaces categoryTaxonomy.ts. Pure + Deno-free so vitest unit-tests it from
// the app config; the Edge imports it with the `.ts` extension.
//
// Reconciliation (workbook): industry includedTypes are the Industry Filter
// Mapping lists verbatim (explicit pick wins over Table A Exclude), minus
// Table-A Exclude types pre-removed from automotive and Table B unsupported
// types stripped by searchableTypes(). Food uses parent types only.

export type IndustryKey =
  | "manufacturing"
  | "construction_trades"
  | "healthcare"
  | "professional_services"
  | "automotive"
  | "retail"
  | "food_beverage"
  | "hospitality"
  | "education"
  | "finance_banking"
  | "fitness_wellness"
  | "non_profit"
  | "other";

export interface IndustrySpec {
  key: IndustryKey;
  label: string;
  /** B2B priority tier. null = display-only fallback ('other'), never fetched. */
  tier: 1 | 2 | null;
  /** Industry Filter Mapping includedTypes (request targeting). */
  includedTypes: string[];
  /** Stable display + overlap-precedence order (Tier 1 first). */
  order: number;
}

export const INDUSTRIES: Record<IndustryKey, IndustrySpec> = {
  manufacturing: {
    key: "manufacturing", label: "Manufacturing", tier: 1, order: 1,
    includedTypes: ["manufacturer", "supplier", "corporate_office"],
  },
  construction_trades: {
    key: "construction_trades", label: "Construction & Trades", tier: 1, order: 2,
    includedTypes: ["electrician", "plumber", "painter", "roofing_contractor", "building_materials_store", "hardware_store"],
  },
  healthcare: {
    key: "healthcare", label: "Healthcare", tier: 1, order: 3,
    includedTypes: ["dental_clinic", "medical_clinic", "medical_center", "hospital", "general_hospital", "doctor", "chiropractor", "physiotherapist", "pharmacy", "drugstore", "veterinary_care"],
  },
  professional_services: {
    key: "professional_services", label: "Professional Services", tier: 1, order: 4,
    includedTypes: ["lawyer", "accounting", "consultant", "marketing_consultant", "insurance_agency", "real_estate_agency", "employment_agency", "travel_agency", "tour_agency"],
  },
  automotive: {
    key: "automotive", label: "Automotive", tier: 1, order: 5,
    includedTypes: ["car_dealer", "car_repair", "car_wash", "tire_shop", "auto_parts_store", "gas_station"],
  },
  retail: {
    key: "retail", label: "Retail", tier: 2, order: 6,
    includedTypes: ["supermarket", "department_store", "clothing_store", "electronics_store", "furniture_store", "home_improvement_store", "hardware_store", "grocery_store", "jewelry_store", "sporting_goods_store", "shopping_mall", "warehouse_store"],
  },
  food_beverage: {
    key: "food_beverage", label: "Food & Beverage", tier: 2, order: 7,
    includedTypes: ["restaurant", "cafe", "bar", "brewery", "fast_food_restaurant", "fine_dining_restaurant"],
  },
  hospitality: {
    key: "hospitality", label: "Hospitality", tier: 2, order: 8,
    includedTypes: ["hotel", "resort_hotel", "motel", "inn", "extended_stay_hotel", "bed_and_breakfast", "lodging"],
  },
  education: {
    key: "education", label: "Education", tier: 2, order: 9,
    includedTypes: ["university", "school", "primary_school", "secondary_school", "educational_institution", "library"],
  },
  finance_banking: {
    key: "finance_banking", label: "Finance & Banking", tier: 2, order: 10,
    includedTypes: ["bank", "accounting", "insurance_agency"],
  },
  fitness_wellness: {
    key: "fitness_wellness", label: "Fitness & Wellness", tier: 2, order: 11,
    includedTypes: ["gym", "fitness_center", "yoga_studio", "spa", "wellness_center", "massage_spa"],
  },
  non_profit: {
    key: "non_profit", label: "Non-Profit", tier: 2, order: 12,
    includedTypes: ["non_profit_organization", "association_or_organization"],
  },
  other: {
    key: "other", label: "Other", tier: null, order: 99,
    includedTypes: [],
  },
};

export const INDUSTRY_KEYS = Object.keys(INDUSTRIES) as IndustryKey[];

/** Industries in display/precedence order (Tier 1 first), excluding 'other'. */
const FETCHABLE_SORTED = INDUSTRY_KEYS
  .filter((k) => INDUSTRIES[k].tier !== null)
  .sort((a, b) => INDUSTRIES[a].order - INDUSTRIES[b].order);

export const TIER_1_KEYS = FETCHABLE_SORTED.filter((k) => INDUSTRIES[k].tier === 1);
export const TIER_2_KEYS = FETCHABLE_SORTED.filter((k) => INDUSTRIES[k].tier === 2);
export const ALL_FETCHABLE_KEYS = [...TIER_1_KEYS, ...TIER_2_KEYS];

/** Table B / globally-unsupported searchNearby includedTypes — stripped before
 *  building a request filter (they 400 the pull) but kept for display bucketing. */
export const SEARCH_UNSUPPORTED_TYPES = new Set<string>(["general_contractor"]);

/** An industry's types safe to send as searchNearby includedTypes. */
export function searchableTypes(industry: IndustryKey): string[] {
  return INDUSTRIES[industry].includedTypes.filter((t) => !SEARCH_UNSUPPORTED_TYPES.has(t));
}

/** Reverse index { type → industry }, first-writer-wins in Tier-1-first order so
 *  a type in two industries resolves to the higher-priority one. */
const TYPE_TO_INDUSTRY: Record<string, IndustryKey> = (() => {
  const m: Record<string, IndustryKey> = {};
  for (const k of FETCHABLE_SORTED) {
    for (const t of INDUSTRIES[k].includedTypes) {
      if (!(t in m)) m[t] = k;
    }
  }
  return m;
})();

/** Display industry for a place: primaryType first, then its types, else 'other'. */
export function bucketForType(
  types: string[] | null | undefined,
  primaryType?: string | null,
): IndustryKey {
  const ordered = [primaryType, ...(types ?? [])];
  for (const raw of ordered) {
    if (!raw) continue;
    const t = raw.toString().trim().toLowerCase();
    const k = TYPE_TO_INDUSTRY[t];
    if (k) return k;
  }
  return "other";
}
