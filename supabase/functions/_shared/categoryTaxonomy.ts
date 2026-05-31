// Category taxonomy — the single source of truth that drives BOTH gates of
// Path prospect ingest (PATH_DESIGN.md §11).
//
//   Gate 1 (ingest):  CATEGORY_TYPES[bucket] becomes the `includedTypes` of a
//                     per-bucket Google Places searchNearby, so every category
//                     gets its own 20 result slots and low-prominence service
//                     businesses stop competing against prominent restaurants.
//   Gate 2 (display): bucketForType(types) maps a place's raw Google types into
//                     the coarse bucket we store + the UI filter chip we show.
//
// One map, both gates → ingest targeting and display labels can never drift
// apart, and the old brittle substring rules (which mis-bucketed `barber_shop`
// → restaurant because "bar" is a substring of "barber") are gone.
//
// DELIBERATELY pure and Deno-free (no network, no Deno globals, no .ts-extension
// imports) so vitest can unit-test it from the app config alongside icpFilter
// and geohash. The Edge Function imports it with the `.ts` extension; the test
// imports it without — same split the other _shared modules use.
//
// The 7 buckets match `MerchantCategory` (apps/app/.../mockData.ts) minus
// "other". Every type below must be a valid Google Places API (New) "Table A"
// type, or searchNearby 400s the whole pull. categoryTaxonomy.test.ts guards
// the shape (lowercase snake_case, no duplicates across buckets); validity vs
// Google's live table is verified at deploy time against a real key.

/** The 7 ICP buckets. Each maps 1:1 to a UI filter chip. */
export type CategoryBucket =
  | "restaurant"
  | "retail"
  | "automotive"
  | "healthcare"
  | "personal_services"
  | "professional_services"
  | "hospitality";

/**
 * { bucket → Google Places (New) Table A types }.
 *
 * A type appears in exactly ONE bucket (enforced by the test) so bucketForType
 * is deterministic regardless of which type Google lists first on a place.
 * Lists lean toward independent-SMB / B2B-relevant types; consumer-only and
 * institutional types (parks, schools, gov) are NOT pulled here — they're the
 * job of icpFilter's gates, not the ingest targeting.
 */
export const CATEGORY_TYPES: Record<CategoryBucket, string[]> = {
  restaurant: [
    "restaurant",
    "cafe",
    "coffee_shop",
    "bakery",
    "bar",
    "pub",
    "fast_food_restaurant",
    "meal_takeaway",
    "meal_delivery",
    "pizza_restaurant",
    "sandwich_shop",
    "ice_cream_shop",
    "breakfast_restaurant",
    "brunch_restaurant",
    "hamburger_restaurant",
    "seafood_restaurant",
    "steak_house",
    "sushi_restaurant",
    "mexican_restaurant",
    "chinese_restaurant",
    "italian_restaurant",
    "japanese_restaurant",
    "thai_restaurant",
    "indian_restaurant",
    "american_restaurant",
    "barbecue_restaurant",
    "food_court",
  ],
  retail: [
    "store",
    "clothing_store",
    "shoe_store",
    "jewelry_store",
    "grocery_store",
    "supermarket",
    "convenience_store",
    "department_store",
    "discount_store",
    "electronics_store",
    "furniture_store",
    "hardware_store",
    "home_goods_store",
    "home_improvement_store",
    "book_store",
    "pet_store",
    "florist",
    "gift_shop",
    "liquor_store",
    "shopping_mall",
    "sporting_goods_store",
    "bicycle_store",
    "cell_phone_store",
    "market",
    "wholesaler",
    "warehouse_store",
  ],
  automotive: [
    "car_dealer",
    "car_rental",
    "car_repair",
    "car_wash",
    "gas_station",
    "electric_vehicle_charging_station",
    "auto_parts_store",
  ],
  healthcare: [
    "dentist",
    "dental_clinic",
    "doctor",
    "hospital",
    "pharmacy",
    "drugstore",
    "physiotherapist",
    "chiropractor",
    "medical_lab",
    "skin_care_clinic",
    "veterinary_care",
    "wellness_center",
  ],
  personal_services: [
    "hair_salon",
    "barber_shop",
    "beauty_salon",
    "nail_salon",
    "hair_care",
    "spa",
    "massage",
    "sauna",
    "tanning_studio",
    "makeup_artist",
    "body_art_service",
    "gym",
    "fitness_center",
    "yoga_studio",
    "laundry",
    "tailor",
  ],
  professional_services: [
    "lawyer",
    "accounting",
    "insurance_agency",
    "real_estate_agency",
    "travel_agency",
    "consultant",
    "electrician",
    "plumber",
    "painter",
    "roofing_contractor",
    "general_contractor",
    "moving_company",
    "storage",
    "locksmith",
    "courier_service",
    "telecommunications_service_provider",
    "funeral_home",
  ],
  hospitality: [
    "lodging",
    "hotel",
    "motel",
    "resort_hotel",
    "extended_stay_hotel",
    "bed_and_breakfast",
    "guest_house",
    "hostel",
    "inn",
  ],
};

/** The 7 buckets, in a stable order. Handy for iterating the per-bucket pulls. */
export const CATEGORY_BUCKETS = Object.keys(CATEGORY_TYPES) as CategoryBucket[];

/**
 * Reverse index: { googleType → bucket }. Built once at module load. Because
 * each type lives in exactly one bucket, this is an unambiguous lookup.
 */
const TYPE_TO_BUCKET: Record<string, CategoryBucket> = (() => {
  const m: Record<string, CategoryBucket> = {};
  for (const bucket of CATEGORY_BUCKETS) {
    for (const t of CATEGORY_TYPES[bucket]) m[t] = bucket;
  }
  return m;
})();

/**
 * Map a place's raw Google types into a coarse bucket. Returns the first of the
 * place's types that we recognise (Google lists the most specific/primary type
 * first), or "other" when none match. Defensive about case/whitespace.
 *
 * This is the stored `category` AND the value categoryFromPlaces guards in the
 * app, so a place pulled under one bucket always displays under that same chip.
 */
export function bucketForType(types: string[] | null | undefined): CategoryBucket | "other" {
  for (const raw of types ?? []) {
    const t = (raw ?? "").toString().trim().toLowerCase();
    const bucket = TYPE_TO_BUCKET[t];
    if (bucket) return bucket;
  }
  return "other";
}
