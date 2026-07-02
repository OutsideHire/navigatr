// Industry taxonomy — the single source of truth for Path prospect ingest +
// display (revised 23-bucket / 341-type mapping).
//
//   includedTypes (per industry) → the searchNearby `includedTypes` for that
//     industry's per-bucket pull (Gate 1, ingest targeting).
//   bucketForType(types, primaryType) → the industry we store + display
//     (Gate 2).
//
// The mapping is ONE-TO-ONE: every place type belongs to exactly one fetchable
// bucket (the one-to-one test guards this), so the reverse index is unambiguous
// and bucketForType is order-independent.
//
// Pure + Deno-free so vitest unit-tests it from the app config; the Edge imports
// it with the `.ts` extension. Table B unsupported types (general_contractor)
// are kept in their bucket for display but stripped by searchableTypes().

export type IndustryKey =
  | "manufacturing_wholesale"
  | "construction_trades"
  | "healthcare"
  | "veterinary_pet"
  | "professional_services"
  | "automotive"
  | "convenience_fuel"
  | "retail"
  | "restaurants_bars_entertainment"
  | "hospitality"
  | "education"
  | "finance_banking"
  | "fitness_wellness"
  | "personal_services"
  | "sports_recreation"
  | "transportation"
  | "non_profit"
  | "other";

export interface IndustrySpec {
  key: IndustryKey;
  label: string;
  /** Industry Filter Mapping includedTypes (request targeting). */
  includedTypes: string[];
  /** Stable display order. */
  order: number;
}

export const INDUSTRIES: Record<IndustryKey, IndustrySpec> = {
  manufacturing_wholesale: {
    key: "manufacturing_wholesale", label: "Manufacturing & Wholesale", order: 1,
    includedTypes: ["manufacturer", "supplier", "wholesaler"],
  },
  construction_trades: {
    key: "construction_trades", label: "Construction & Trades", order: 2,
    includedTypes: ["general_contractor", "electrician", "plumber", "painter", "roofing_contractor"],
  },
  healthcare: {
    key: "healthcare", label: "Healthcare", order: 3,
    includedTypes: ["dental_clinic", "medical_clinic", "medical_center", "hospital", "general_hospital", "doctor", "chiropractor", "physiotherapist", "dentist", "medical_lab"],
  },
  veterinary_pet: {
    key: "veterinary_pet", label: "Veterinary & Pet Services", order: 4,
    includedTypes: ["veterinary_care", "pet_boarding_service", "pet_care", "pet_store"],
  },
  professional_services: {
    key: "professional_services", label: "Professional Services", order: 5,
    includedTypes: ["lawyer", "consultant", "marketing_consultant", "real_estate_agency", "employment_agency", "travel_agency", "tour_agency"],
  },
  automotive: {
    key: "automotive", label: "Automotive", order: 6,
    includedTypes: ["car_dealer", "car_repair", "car_rental", "car_wash", "tire_shop", "truck_dealer", "auto_parts_store", "parking", "parking_garage", "parking_lot"],
  },
  convenience_fuel: {
    key: "convenience_fuel", label: "Convenience & Fuel", order: 7,
    includedTypes: ["gas_station", "convenience_store"],
  },
  retail: {
    key: "retail", label: "Retail", order: 8,
    includedTypes: ["supermarket", "grocery_store", "butcher_shop", "liquor_store", "health_food_store", "asian_grocery_store", "hypermarket", "discount_supermarket", "food_store", "market", "tea_store", "clothing_store", "womens_clothing_store", "shoe_store", "sportswear_store", "jewelry_store", "cosmetics_store", "furniture_store", "home_goods_store", "home_improvement_store", "hardware_store", "building_materials_store", "garden_center", "electronics_store", "cell_phone_store", "book_store", "toy_store", "bicycle_store", "sporting_goods_store", "gift_shop", "pharmacy", "drugstore", "department_store", "warehouse_store", "shopping_mall", "store", "general_store", "discount_store", "thrift_store"],
  },
  restaurants_bars_entertainment: {
    key: "restaurants_bars_entertainment", label: "Restaurants, Bars & Entertainment", order: 14,
    includedTypes: ["restaurant", "cafe", "bar", "brewery", "fast_food_restaurant", "fine_dining_restaurant", "acai_shop", "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant", "bagel_shop", "bakery", "bar_and_grill", "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "brunch_restaurant", "buffet_restaurant", "cafeteria", "candy_store", "cat_cafe", "chinese_restaurant", "chocolate_factory", "chocolate_shop", "coffee_shop", "confectionery", "deli", "dessert_restaurant", "dessert_shop", "diner", "dog_cafe", "donut_shop", "food_court", "french_restaurant", "greek_restaurant", "hamburger_restaurant", "ice_cream_shop", "indian_restaurant", "indonesian_restaurant", "italian_restaurant", "japanese_restaurant", "juice_shop", "korean_restaurant", "lebanese_restaurant", "meal_delivery", "meal_takeaway", "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "pizza_restaurant", "pub", "ramen_restaurant", "sandwich_shop", "seafood_restaurant", "spanish_restaurant", "steak_house", "sushi_restaurant", "tea_house", "thai_restaurant", "turkish_restaurant", "vegan_restaurant", "vegetarian_restaurant", "vietnamese_restaurant", "wine_bar", "argentinian_restaurant", "asian_fusion_restaurant", "australian_restaurant", "austrian_restaurant", "bangladeshi_restaurant", "basque_restaurant", "bavarian_restaurant", "beer_garden", "belgian_restaurant", "bistro", "brewpub", "british_restaurant", "burmese_restaurant", "burrito_restaurant", "cajun_restaurant", "cake_shop", "californian_restaurant", "cambodian_restaurant", "cantonese_restaurant", "caribbean_restaurant", "chicken_restaurant", "chicken_wings_restaurant", "chilean_restaurant", "chinese_noodle_restaurant", "cocktail_bar", "coffee_roastery", "coffee_stand", "colombian_restaurant", "croatian_restaurant", "cuban_restaurant", "czech_restaurant", "danish_restaurant", "dim_sum_restaurant", "dumpling_restaurant", "dutch_restaurant", "eastern_european_restaurant", "ethiopian_restaurant", "european_restaurant", "falafel_restaurant", "family_restaurant", "filipino_restaurant", "fish_and_chips_restaurant", "fondue_restaurant", "fusion_restaurant", "gastropub", "german_restaurant", "gyro_restaurant", "halal_restaurant", "hawaiian_restaurant", "hookah_bar", "hot_dog_restaurant", "hot_dog_stand", "hot_pot_restaurant", "hungarian_restaurant", "irish_pub", "irish_restaurant", "israeli_restaurant", "japanese_curry_restaurant", "japanese_izakaya_restaurant", "kebab_shop", "korean_barbecue_restaurant", "latin_american_restaurant", "lounge_bar", "malaysian_restaurant", "mongolian_barbecue_restaurant", "moroccan_restaurant", "noodle_shop", "north_indian_restaurant", "oyster_bar_restaurant", "pakistani_restaurant", "pastry_shop", "persian_restaurant", "peruvian_restaurant", "pizza_delivery", "polish_restaurant", "portuguese_restaurant", "romanian_restaurant", "russian_restaurant", "salad_shop", "scandinavian_restaurant", "shawarma_restaurant", "snack_bar", "soul_food_restaurant", "soup_restaurant", "south_american_restaurant", "south_indian_restaurant", "southwestern_us_restaurant", "sports_bar", "sri_lankan_restaurant", "swiss_restaurant", "taco_restaurant", "taiwanese_restaurant", "tapas_restaurant", "tex_mex_restaurant", "tibetan_restaurant", "tonkatsu_restaurant", "ukrainian_restaurant", "western_restaurant", "winery", "yakiniku_restaurant", "yakitori_restaurant", "vineyard", "movie_theater", "night_club", "comedy_club", "bowling_alley", "amusement_park", "amusement_center", "amphitheatre", "aquarium", "banquet_hall", "barbecue_area", "concert_hall", "convention_center", "cycling_park", "dance_hall", "event_venue", "ferris_wheel", "internet_cafe", "karaoke", "marina", "movie_rental", "opera_house", "philharmonic_hall", "planetarium", "roller_coaster", "video_arcade", "water_park", "wedding_venue", "zoo", "go_karting_venue", "live_music_venue", "miniature_golf_course", "paintball_center", "adventure_sports_center"],
  },
  hospitality: {
    key: "hospitality", label: "Hospitality", order: 15,
    includedTypes: ["hotel", "resort_hotel", "motel", "inn", "extended_stay_hotel", "bed_and_breakfast", "lodging", "budget_japanese_inn", "cottage", "japanese_inn"],
  },
  education: {
    key: "education", label: "Education", order: 16,
    includedTypes: ["university", "school", "primary_school", "secondary_school", "educational_institution", "library", "preschool"],
  },
  finance_banking: {
    key: "finance_banking", label: "Finance & Banking", order: 17,
    includedTypes: ["bank", "accounting", "insurance_agency"],
  },
  fitness_wellness: {
    key: "fitness_wellness", label: "Fitness & Wellness", order: 18,
    includedTypes: ["gym", "fitness_center", "yoga_studio", "spa", "wellness_center", "massage_spa", "massage", "sauna", "tanning_studio", "skin_care_clinic", "sports_club", "sports_school"],
  },
  personal_services: {
    key: "personal_services", label: "Personal Services", order: 19,
    includedTypes: ["barber_shop", "beauty_salon", "hair_salon", "nail_salon", "beautician", "makeup_artist", "hair_care", "foot_care", "body_art_service", "laundry", "locksmith", "funeral_home", "florist", "tailor", "storage", "moving_company", "catering_service", "service"],
  },
  sports_recreation: {
    key: "sports_recreation", label: "Sports & Recreation", order: 21,
    includedTypes: ["golf_course", "ice_skating_rink", "ski_resort", "indoor_golf_course", "race_course", "fishing_charter"],
  },
  transportation: {
    key: "transportation", label: "Transportation", order: 22,
    includedTypes: ["ferry_service", "taxi_service", "aircraft_rental_service", "chauffeur_service"],
  },
  non_profit: {
    key: "non_profit", label: "Non-Profit", order: 23,
    includedTypes: ["non_profit_organization", "association_or_organization"],
  },
  other: {
    key: "other", label: "Other", order: 99,
    includedTypes: [],
  },
};

export const INDUSTRY_KEYS = Object.keys(INDUSTRIES) as IndustryKey[];

/** Fetchable buckets in display order (everything except the 'other' fallback). */
export const ALL_FETCHABLE_KEYS: IndustryKey[] = INDUSTRY_KEYS
  .filter((k) => k !== "other")
  .sort((a, b) => INDUSTRIES[a].order - INDUSTRIES[b].order);

/** Default pre-selection (payments / merchant-services ICP). */
export const RECOMMENDED_KEYS: IndustryKey[] = [
  "restaurants_bars_entertainment", "retail", "convenience_fuel",
  "healthcare", "professional_services", "automotive", "personal_services",
];

/** Table B / unsupported searchNearby includedTypes — stripped before a pull
 *  (they 400 the request) but kept for display bucketing. */
export const SEARCH_UNSUPPORTED_TYPES = new Set<string>(["general_contractor"]);

export function searchableTypes(industry: IndustryKey): string[] {
  return INDUSTRIES[industry].includedTypes.filter((t) => !SEARCH_UNSUPPORTED_TYPES.has(t));
}

/** One-to-one reverse index { type → bucket }. The mapping is non-overlapping,
 *  so a plain build is unambiguous (the one-to-one test guards this). */
const TYPE_TO_INDUSTRY: Record<string, IndustryKey> = (() => {
  const m: Record<string, IndustryKey> = {};
  for (const k of ALL_FETCHABLE_KEYS) {
    for (const t of INDUSTRIES[k].includedTypes) m[t] = k;
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

/**
 * Pre-merge category keys that a merged industry absorbed. The Retail /
 * Restaurants-Bars-Entertainment merge relabels existing prospect rows lazily
 * (no rewrite), so a category filter must match both the merged key and the
 * legacy split keys still stored on older rows.
 */
const LEGACY_CATEGORY_MEMBERS: Partial<Record<IndustryKey, string[]>> = {
  retail: [
    "grocery_food_retail",
    "apparel_accessories",
    "home_hardware",
    "electronics_specialty",
    "pharmacy_health_retail",
    "general_merchandise",
  ],
  restaurants_bars_entertainment: ["food_beverage", "entertainment"],
};

/**
 * All `category` strings that count as "in" the given industries — each key
 * plus any legacy split keys it absorbed. Feeds prospects_nearby's p_categories
 * so the read filter matches both freshly-ingested (merged) and older (legacy)
 * rows. Returns [] for an empty input (caller should treat that as "no filter").
 */
export function categoriesForIndustries(keys: IndustryKey[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    out.add(k);
    for (const legacy of LEGACY_CATEGORY_MEMBERS[k] ?? []) out.add(legacy);
  }
  return [...out];
}
