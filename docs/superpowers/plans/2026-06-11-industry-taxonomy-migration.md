# Path Industry Taxonomy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Replace the 12-bucket / 77-type industry taxonomy with the revised 23-bucket / 341-type mapping (one-to-one), a payments-ICP default, an explicit "All industries" mode, request-chunking for oversized buckets, and backward-compatible labels for legacy stored categories.

**Architecture:** Config swap in `supabase/functions/_shared/industryTaxonomy.ts` (the shared source of truth) + its ripple: `MerchantCategory`/`CATEGORY_LABEL` + a `labelForCategory` fallback, `industrySelection.ts` recommended default, the Edge request protocol (All-flag, chunked `includedTypes`), and the multi-select editor. Keep the editor UX; defer Text Search supplements.

**Tech Stack:** TS (Deno-free `_shared` + vitest), Supabase Edge (Deno), React, Google Places Nearby Search.

---

## Conventions

- **Worktree/branch:** `feat/industry-taxonomy` off `main`. Do NOT work on `main`.
- Tests: `pnpm --filter app test <path>` from repo root (the `_shared` taxonomy is vitest-tested from the app). Typecheck: `cd <worktree>/apps/app && pnpm typecheck`. Full gate: `pnpm test`.
- Commit trailer: blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Git from the worktree root, one Bash call.
- Edge functions have no local typecheck (verify on deploy); keep `_shared` pure/Deno-free so vitest covers it.
- Spec: `docs/superpowers/specs/2026-06-11-industry-taxonomy-migration-design.md` (on disk).

## Canonical new mapping (transcribe verbatim — 23 buckets + `other` fallback)

These are the CSV's `includedTypes` per bucket. `general_contractor` stays in
`construction_trades.includedTypes` but is stripped by `SEARCH_UNSUPPORTED_TYPES`.

- **manufacturing_wholesale** (order 1): `manufacturer, supplier, wholesaler`
- **construction_trades** (2): `general_contractor, electrician, plumber, painter, roofing_contractor`
- **healthcare** (3): `dental_clinic, medical_clinic, medical_center, hospital, general_hospital, doctor, chiropractor, physiotherapist, dentist, medical_lab`
- **veterinary_pet** (4): `veterinary_care, pet_boarding_service, pet_care, pet_store`
- **professional_services** (5): `lawyer, consultant, marketing_consultant, real_estate_agency, employment_agency, travel_agency, tour_agency`
- **automotive** (6): `car_dealer, car_repair, car_rental, car_wash, tire_shop, truck_dealer, auto_parts_store, parking, parking_garage, parking_lot`
- **convenience_fuel** (7): `gas_station, convenience_store`
- **grocery_food_retail** (8): `supermarket, grocery_store, butcher_shop, liquor_store, health_food_store, asian_grocery_store, hypermarket, discount_supermarket, food_store, market, tea_store`
- **apparel_accessories** (9): `clothing_store, womens_clothing_store, shoe_store, sportswear_store, jewelry_store, cosmetics_store`
- **home_hardware** (10): `furniture_store, home_goods_store, home_improvement_store, hardware_store, building_materials_store, garden_center`
- **electronics_specialty** (11): `electronics_store, cell_phone_store, book_store, toy_store, bicycle_store, sporting_goods_store, gift_shop`
- **pharmacy_health_retail** (12): `pharmacy, drugstore`
- **general_merchandise** (13): `department_store, warehouse_store, shopping_mall, store, general_store, discount_store, thrift_store`
- **food_beverage** (14): the full 167-type list (verbatim): `restaurant, cafe, bar, brewery, fast_food_restaurant, fine_dining_restaurant, acai_shop, afghani_restaurant, african_restaurant, american_restaurant, asian_restaurant, bagel_shop, bakery, bar_and_grill, barbecue_restaurant, brazilian_restaurant, breakfast_restaurant, brunch_restaurant, buffet_restaurant, cafeteria, candy_store, cat_cafe, chinese_restaurant, chocolate_factory, chocolate_shop, coffee_shop, confectionery, deli, dessert_restaurant, dessert_shop, diner, dog_cafe, donut_shop, food_court, french_restaurant, greek_restaurant, hamburger_restaurant, ice_cream_shop, indian_restaurant, indonesian_restaurant, italian_restaurant, japanese_restaurant, juice_shop, korean_restaurant, lebanese_restaurant, meal_delivery, meal_takeaway, mediterranean_restaurant, mexican_restaurant, middle_eastern_restaurant, pizza_restaurant, pub, ramen_restaurant, sandwich_shop, seafood_restaurant, spanish_restaurant, steak_house, sushi_restaurant, tea_house, thai_restaurant, turkish_restaurant, vegan_restaurant, vegetarian_restaurant, vietnamese_restaurant, wine_bar, argentinian_restaurant, asian_fusion_restaurant, australian_restaurant, austrian_restaurant, bangladeshi_restaurant, basque_restaurant, bavarian_restaurant, beer_garden, belgian_restaurant, bistro, brewpub, british_restaurant, burmese_restaurant, burrito_restaurant, cajun_restaurant, cake_shop, californian_restaurant, cambodian_restaurant, cantonese_restaurant, caribbean_restaurant, chicken_restaurant, chicken_wings_restaurant, chilean_restaurant, chinese_noodle_restaurant, cocktail_bar, coffee_roastery, coffee_stand, colombian_restaurant, croatian_restaurant, cuban_restaurant, czech_restaurant, danish_restaurant, dim_sum_restaurant, dumpling_restaurant, dutch_restaurant, eastern_european_restaurant, ethiopian_restaurant, european_restaurant, falafel_restaurant, family_restaurant, filipino_restaurant, fish_and_chips_restaurant, fondue_restaurant, fusion_restaurant, gastropub, german_restaurant, gyro_restaurant, halal_restaurant, hawaiian_restaurant, hookah_bar, hot_dog_restaurant, hot_dog_stand, hot_pot_restaurant, hungarian_restaurant, irish_pub, irish_restaurant, israeli_restaurant, japanese_curry_restaurant, japanese_izakaya_restaurant, kebab_shop, korean_barbecue_restaurant, latin_american_restaurant, lounge_bar, malaysian_restaurant, mongolian_barbecue_restaurant, moroccan_restaurant, noodle_shop, north_indian_restaurant, oyster_bar_restaurant, pakistani_restaurant, pastry_shop, persian_restaurant, peruvian_restaurant, pizza_delivery, polish_restaurant, portuguese_restaurant, romanian_restaurant, russian_restaurant, salad_shop, scandinavian_restaurant, shawarma_restaurant, snack_bar, soul_food_restaurant, soup_restaurant, south_american_restaurant, south_indian_restaurant, southwestern_us_restaurant, sports_bar, sri_lankan_restaurant, swiss_restaurant, taco_restaurant, taiwanese_restaurant, tapas_restaurant, tex_mex_restaurant, tibetan_restaurant, tonkatsu_restaurant, ukrainian_restaurant, western_restaurant, winery, yakiniku_restaurant, yakitori_restaurant, vineyard`
- **hospitality** (15): `hotel, resort_hotel, motel, inn, extended_stay_hotel, bed_and_breakfast, lodging, budget_japanese_inn, cottage, japanese_inn`
- **education** (16): `university, school, primary_school, secondary_school, educational_institution, library, preschool`
- **finance_banking** (17): `bank, accounting, insurance_agency`
- **fitness_wellness** (18): `gym, fitness_center, yoga_studio, spa, wellness_center, massage_spa, massage, sauna, tanning_studio, skin_care_clinic, sports_club, sports_school`
- **personal_services** (19): `barber_shop, beauty_salon, hair_salon, nail_salon, beautician, makeup_artist, hair_care, foot_care, body_art_service, laundry, locksmith, funeral_home, florist, tailor, storage, moving_company, catering_service, service`
- **entertainment** (20): `movie_theater, night_club, comedy_club, bowling_alley, amusement_park, amusement_center, amphitheatre, aquarium, banquet_hall, barbecue_area, concert_hall, convention_center, cycling_park, dance_hall, event_venue, ferris_wheel, internet_cafe, karaoke, marina, movie_rental, opera_house, philharmonic_hall, planetarium, roller_coaster, video_arcade, water_park, wedding_venue, zoo, go_karting_venue, live_music_venue, miniature_golf_course, paintball_center, adventure_sports_center`
- **sports_recreation** (21): `golf_course, ice_skating_rink, ski_resort, indoor_golf_course, race_course, fishing_charter`
- **transportation** (22): `ferry_service, taxi_service, aircraft_rental_service, chauffeur_service`
- **non_profit** (23): `non_profit_organization, association_or_organization`
- **other** (order 99): `[]` — display-only fallback for `bucketForType`, never fetched, hidden from the editor.

`RECOMMENDED_KEYS = ["food_beverage","grocery_food_retail","convenience_fuel","healthcare","professional_services","automotive","personal_services"]`.

---

## Task 1: Taxonomy config swap (`_shared/industryTaxonomy.ts`)

**Files:** Modify `supabase/functions/_shared/industryTaxonomy.ts` + `industryTaxonomy.test.ts`.

- [ ] **Step 1: Rewrite the test** `industryTaxonomy.test.ts` to the new invariants:
```ts
import { describe, it, expect } from "vitest";
import {
  INDUSTRIES, INDUSTRY_KEYS, ALL_FETCHABLE_KEYS, RECOMMENDED_KEYS,
  SEARCH_UNSUPPORTED_TYPES, searchableTypes, bucketForType,
} from "./industryTaxonomy";

describe("industryTaxonomy (revised mapping)", () => {
  it("has 23 fetchable buckets + the 'other' fallback", () => {
    expect(INDUSTRY_KEYS).toContain("other");
    expect(ALL_FETCHABLE_KEYS).toHaveLength(23);
    expect(ALL_FETCHABLE_KEYS).not.toContain("other");
  });
  it("is one-to-one: no place type appears in more than one fetchable bucket", () => {
    const seen = new Map<string, string>();
    for (const k of ALL_FETCHABLE_KEYS) {
      for (const t of INDUSTRIES[k].includedTypes) {
        expect(seen.has(t), `${t} in both ${seen.get(t)} and ${k}`).toBe(false);
        seen.set(t, k);
      }
    }
  });
  it("RECOMMENDED_KEYS is exactly the 7 payments buckets", () => {
    expect([...RECOMMENDED_KEYS].sort()).toEqual(
      ["automotive","convenience_fuel","food_beverage","grocery_food_retail","healthcare","personal_services","professional_services"],
    );
  });
  it("buckets relocated types to their new home", () => {
    expect(bucketForType(["gas_station"])).toBe("convenience_fuel");
    expect(bucketForType(["accounting"])).toBe("finance_banking");
    expect(bucketForType(["veterinary_care"])).toBe("veterinary_pet");
    expect(bucketForType(["pharmacy"])).toBe("pharmacy_health_retail");
    expect(bucketForType(["hardware_store"])).toBe("home_hardware");
    expect(bucketForType(["wholesaler"])).toBe("manufacturing_wholesale");
    expect(bucketForType(["pizza_restaurant"])).toBe("food_beverage");
  });
  it("strips general_contractor from searchable types but keeps it for bucketing", () => {
    expect(SEARCH_UNSUPPORTED_TYPES.has("general_contractor")).toBe(true);
    expect(searchableTypes("construction_trades")).not.toContain("general_contractor");
    expect(bucketForType(["general_contractor"])).toBe("construction_trades");
  });
  it("unknown types fall back to 'other'", () => {
    expect(bucketForType(["something_unknown"])).toBe("other");
    expect(bucketForType([])).toBe("other");
  });
});
```
Run `pnpm --filter app test supabase/functions/_shared/industryTaxonomy.test.ts` → FAIL.

- [ ] **Step 2: Rewrite `industryTaxonomy.ts`.** Replace `IndustryKey`, `IndustrySpec` (drop `tier`, keep `key/label/includedTypes/order`), and `INDUSTRIES` with the 23 buckets above (each `includedTypes` transcribed verbatim from the canonical mapping / CSV) plus the `other` fallback. Then:
```ts
export const INDUSTRY_KEYS = Object.keys(INDUSTRIES) as IndustryKey[];

/** Fetchable buckets in display order (everything except the 'other' fallback). */
export const ALL_FETCHABLE_KEYS: IndustryKey[] = INDUSTRY_KEYS
  .filter((k) => k !== "other")
  .sort((a, b) => INDUSTRIES[a].order - INDUSTRIES[b].order);

/** Default pre-selection (payments / merchant-services ICP). */
export const RECOMMENDED_KEYS: IndustryKey[] = [
  "food_beverage", "grocery_food_retail", "convenience_fuel",
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
```
Keep `bucketForType` exactly as-is (it returns `"other"` on miss). Remove `TIER_1_KEYS`/`TIER_2_KEYS`/`FETCHABLE_SORTED` (replaced by `ALL_FETCHABLE_KEYS`). Update the file header comment (drop the Tier-1-first overlap note; note one-to-one).

- [ ] **Step 3: Run → PASS.** `pnpm --filter app test supabase/functions/_shared/industryTaxonomy.test.ts`.
- [ ] **Step 4: Commit**
```bash
git add supabase/functions/_shared/industryTaxonomy.ts supabase/functions/_shared/industryTaxonomy.test.ts
git commit -m "$(printf 'feat(path): revised 23-bucket industry taxonomy (one-to-one, recommended default)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `MerchantCategory` + `CATEGORY_LABEL` + `labelForCategory`

**Files:** Modify `apps/app/src/features/path/mockData.ts` + `mockData.taxonomy.test.ts`.

- [ ] **Step 1: Update `mockData.taxonomy.test.ts`** — it currently asserts `CATEGORY_LABEL` keys === `INDUSTRY_KEYS` and labels === `INDUSTRIES[k].label`. Keep those (they still hold for the 24 keys). Add a `labelForCategory` test:
```ts
import { labelForCategory } from "./mockData";
it("labelForCategory returns new labels and falls back for retired keys", () => {
  expect(labelForCategory("convenience_fuel")).toBe("Convenience & Fuel");
  expect(labelForCategory("retail")).toBe("Retail");        // retired key, still renders
  expect(labelForCategory("manufacturing")).toBe("Manufacturing"); // retired
  expect(labelForCategory("totally_unknown")).toBe("Other");
});
```
Run → FAIL.

- [ ] **Step 2: Edit `mockData.ts`.** Replace the `MerchantCategory` union with the 23 new keys + `"other"` (mirroring `IndustryKey`), and `CATEGORY_LABEL` with the 24 labels:
```ts
export type MerchantCategory =
  | "manufacturing_wholesale" | "construction_trades" | "healthcare" | "veterinary_pet"
  | "professional_services" | "automotive" | "convenience_fuel" | "grocery_food_retail"
  | "apparel_accessories" | "home_hardware" | "electronics_specialty" | "pharmacy_health_retail"
  | "general_merchandise" | "food_beverage" | "hospitality" | "education" | "finance_banking"
  | "fitness_wellness" | "personal_services" | "entertainment" | "sports_recreation"
  | "transportation" | "non_profit" | "other";

export const CATEGORY_LABEL: Record<MerchantCategory, string> = {
  manufacturing_wholesale: "Manufacturing & Wholesale",
  construction_trades: "Construction & Trades",
  healthcare: "Healthcare",
  veterinary_pet: "Veterinary & Pet Services",
  professional_services: "Professional Services",
  automotive: "Automotive",
  convenience_fuel: "Convenience & Fuel",
  grocery_food_retail: "Grocery & Food Retail",
  apparel_accessories: "Apparel & Accessories",
  home_hardware: "Home & Hardware",
  electronics_specialty: "Electronics & Specialty Retail",
  pharmacy_health_retail: "Pharmacy & Health Retail",
  general_merchandise: "General Merchandise",
  food_beverage: "Food & Beverage",
  hospitality: "Hospitality",
  education: "Education",
  finance_banking: "Finance & Banking",
  fitness_wellness: "Fitness & Wellness",
  personal_services: "Personal Services",
  entertainment: "Entertainment",
  sports_recreation: "Sports & Recreation",
  transportation: "Transportation",
  non_profit: "Non-Profit",
  other: "Other",
};

/** Labels for retired pre-migration category keys still present on old
 *  merchant/path_stop rows, so historical data renders a sensible name. */
const RETIRED_CATEGORY_LABEL: Record<string, string> = {
  manufacturing: "Manufacturing",
  retail: "Retail",
};

/** Display label for any stored category string — new key, retired key, or
 *  unknown. Always route category-label lookups through this. */
export function labelForCategory(key: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[key] ?? RETIRED_CATEGORY_LABEL[key] ?? "Other";
}
```
> Verify `mockData.taxonomy.test.ts`'s key-parity assertion: `CATEGORY_LABEL` keys must equal `INDUSTRY_KEYS` — both are the 23 + `other`, so it holds. If the test imports `INDUSTRY_KEYS`, no change needed beyond the new keys lining up.

- [ ] **Step 3: Run → PASS.** Typecheck WILL now fail at the 11 `CATEGORY_LABEL[...]` consumer sites that index with a possibly-legacy key — that's Task 3. (Run `pnpm --filter app test src/features/path/mockData.taxonomy.test.ts` green first.)
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/mockData.ts apps/app/src/features/path/mockData.taxonomy.test.ts
git commit -m "$(printf 'feat(path): expand MerchantCategory to 23 buckets + labelForCategory fallback\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Route category-label lookups through `labelForCategory`

**Files:** Modify the consumer sites (display): `useMerchants.ts` (re-export), `IndustryEditor.tsx`, `CreatePathWizard.tsx`, `SelectStops.tsx`, `MerchantList.tsx`, `ActivePathView.tsx`, `RunningPath.tsx`, `MerchantDetailSheet.tsx`, `PathPage.tsx`.

- [ ] **Step 1:** In `mockData.ts` the helper exists (Task 2). In `useMerchants.ts`, alongside `export { CATEGORY_LABEL };` add `export { labelForCategory } from "../mockData";` (and keep `CATEGORY_LABEL` export for the editor, which needs the typed record for iteration).
- [ ] **Step 2:** At each DISPLAY site that does `CATEGORY_LABEL[x] ?? x` or `CATEGORY_LABEL[x as MerchantCategory]` on a value that comes from a STORED category (a stop/merchant `category`), replace with `labelForCategory(x)`. Concretely:
  - `MerchantList.tsx:111`, `ActivePathView.tsx:228`, `RunningPath.tsx:103`, `MerchantDetailSheet.tsx:94`, `SelectStops.tsx:34/44`, `PathPage.tsx:72` → `labelForCategory(category)`.
  - `IndustryEditor.tsx` + `CreatePathWizard.tsx:265`: these iterate `CATEGORY_LABEL` keys / render selected NEW categories (not legacy), so `CATEGORY_LABEL[c]` is fine — leave as-is (the keys are always valid new keys there). (Only change if typecheck flags them.)
  Import `labelForCategory` from `../mockData` (or `../hooks/useMerchants` re-export) at each site.
- [ ] **Step 3:** `cd apps/app && pnpm typecheck` → clean (the union change + helper resolve the indexing errors). Run `pnpm test` for the touched components → green (their tests assert label text like "Healthcare"/"Automotive" which are unchanged; any test asserting a renamed label — e.g. "Manufacturing" → now "Manufacturing & Wholesale" only if that fixture uses the new key — update the expectation).
- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "$(printf 'refactor(path): route category labels through labelForCategory (legacy-safe)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Recommended default (`industrySelection.ts`)

**Files:** Modify `apps/app/src/features/path/lib/industrySelection.ts` + `industrySelection.test.ts`.

- [ ] **Step 1: Update `industrySelection.test.ts`** — the RECOMMENDED_SELECTION assertion changes from 5 Tier-1 to the 7 RECOMMENDED_KEYS:
```ts
import { RECOMMENDED_SELECTION } from "./industrySelection";
it("RECOMMENDED_SELECTION is the 7 payments buckets, each fully selected", () => {
  expect(Object.keys(RECOMMENDED_SELECTION).sort()).toEqual(
    ["automotive","convenience_fuel","food_beverage","grocery_food_retail","healthcare","personal_services","professional_services"],
  );
  // fully selected = all of each bucket's includedTypes
  expect(RECOMMENDED_SELECTION.convenience_fuel).toEqual(["gas_station","convenience_store"]);
});
```
(Keep the other tests — `allSubtypes`, `subtypeCount`, `matchesSelection`, `humanizeSubtype` — they're unaffected.) Run → FAIL.

- [ ] **Step 2: Edit `industrySelection.ts`.** Replace the tier-based `RECOMMENDED_SELECTION` with `RECOMMENDED_KEYS`:
```ts
import { INDUSTRIES, RECOMMENDED_KEYS } from "../../../../../../supabase/functions/_shared/industryTaxonomy";
// ...
export const RECOMMENDED_SELECTION: IndustrySelection = RECOMMENDED_KEYS.reduce<IndustrySelection>((acc, key) => {
  acc[key as MerchantCategory] = [...INDUSTRIES[key].includedTypes];
  return acc;
}, {});
```
(Remove the `INDUSTRY_KEYS`/`tier === 1` import/logic. Keep everything else.)
- [ ] **Step 3: Run → PASS.** Typecheck.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/lib/industrySelection.ts apps/app/src/features/path/lib/industrySelection.test.ts
git commit -m "$(printf 'feat(path): default industry selection = payments-ICP recommended set\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: "All industries" mode (UI → hook → Edge)

**Files:** Modify `IndustryEditor.tsx` (or `CreatePathWizard.tsx`), `useMerchants.ts`, `discover_prospects/index.ts`.

- [ ] **Step 1: Edge protocol + fallback.** In `discover_prospects/index.ts`:
  - Add `all_industries?: boolean` to `RequestBody` (line ~133-141).
  - Replace the `requested.length > 0 ? requested : [...TIER_1_KEYS]` fallback (lines ~284-287) with:
```ts
    const requested = Array.isArray(body?.industries)
      ? (body!.industries.filter((s) => (ALL_FETCHABLE_KEYS as string[]).includes(s)) as IndustryKey[])
      : [];
    const allIndustries = body?.all_industries === true || requested.length === 0;
    // allIndustries → fetch everything (omit includedTypes); else the requested buckets.
    const scopeIndustries: IndustryKey[] = allIndustries ? [] : requested;
```
  - Where the per-bucket pull builds `includedTypes`: when `allIndustries`, do ONE `searchNearby` pull with NO `includedTypes` (omit the param) instead of the per-bucket loop. Keep the existing per-bucket path for `scopeIndustries`. (Implement: `if (allIndustries) { pulls = [searchNearbyForTypes(lat,lng,radiusM, [])] with the "omit includedTypes when empty" branch ] } else { per bucket as today }`. Verify `searchNearbyForTypes` omits `includedTypes` when given an empty array — if it doesn't, add that branch.)
- [ ] **Step 2: Hook.** In `useMerchants.ts` request payload (lines ~206-209), thread the flag: accept an `allIndustries` option and send `all_industries: allIndustries` in the body. (Add it to the hook's options type + callers.)
- [ ] **Step 3: UI.** Add an "All industries" control at the top of the industry picker (in `IndustryEditor` or the wizard hero). When toggled on, it visually overrides the bucket list (disable/dim the per-bucket selection) and drives the request's `allIndustries: true`; toggled off → the multi-select buckets apply. Model: a boolean alongside the `IndustrySelection` (e.g., the wizard holds `allIndustries: boolean`; when true, send the flag and skip sending `industries`).
- [ ] **Step 4: Tests.** Add/extend:
  - A `useMerchants` test (it likely mocks `supabase.functions.invoke`) asserting `all_industries: true` is sent when the All option is on, and the selected bucket keys otherwise.
  - An IndustryEditor/wizard test: toggling "All industries" disables the bucket selection and flags all-mode.
  Run those → green.
- [ ] **Step 5: Typecheck + commit**
```bash
git add -A
git commit -m "$(printf 'feat(path): explicit All industries mode (omit includedTypes)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Chunk oversized `includedTypes` (Edge)

**Files:** Modify `discover_prospects/index.ts` (and/or wherever `searchNearbyForTypes` builds the Google request).

- [ ] **Step 1: Investigate.** Read `searchNearbyForTypes` (and its caller at index.ts ~235). Determine whether it already chunks or caps `includedTypes`. Google Nearby Search (New) accepts **at most 50** `includedTypes` per request; the new `food_beverage` bucket has 167, so a single call 400s (or silently truncates).
- [ ] **Step 2: Add chunking.** Where a bucket's `searchableTypes(bucket)` is passed to Google, split into batches of **≤50** and fire one `searchNearby` per batch (per geo cell), then **merge + dedupe by place id** before classification. Keep the existing per-cell / `MAX_CELLS` structure; chunking multiplies calls only for buckets >50 types (effectively just `food_beverage`). Pseudocode shape:
```ts
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
// per bucket: const batches = chunk(searchableTypes(bucket), 50);
// fire searchNearby per batch; concat places; dedupe by id.
```
- [ ] **Step 3: Test (if `_shared`-testable).** If the chunking helper lives in `_shared` (pure), add a vitest for `chunk` (e.g. 167 → batches of [50,50,50,17]) and the dedupe-by-id merge. If the logic is inline in the Deno Edge file (not unit-testable locally), extract the pure `chunk`/`dedupeById` helpers into `_shared` and test them there.
- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "$(printf 'fix(path): chunk searchNearby includedTypes to Google 50-type cap\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: `icpFilter.ts` cross-cut review

**Files:** Modify `supabase/functions/_shared/icpFilter.ts` (+ its test if present).

- [ ] **Step 1:** Review `consumerOnlyTypes`/`institutionalTypes` against the new types. Add clearly-consumer/non-B2B-viable new types so they're filtered downstream: append `parking_lot` (parking/parking_garage already present) to `consumerOnlyTypes`; the CSV flags `service` as a generic catch-all "consider excluding" — leave it in the bucket but note it. Don't over-prune — the min-employee filter is the main throttle.
- [ ] **Step 2:** If `icpFilter.test.ts` exists, add an assertion for any newly-added type; run it. Typecheck.
- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "$(printf 'chore(path): icp filter cross-cut review for new taxonomy types\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Ship

- [ ] **Step 1: Full gate** — `cd apps/app && pnpm typecheck && pnpm test` (all green). Fix any remaining label-assertion fallout from the renamed buckets.
- [ ] **Step 2: Manual smoke (after merge+push; HTTPS).** Create Path → industry step shows the 23 buckets in order + the "All industries" toggle; default has the 7 recommended pre-selected; pick Convenience & Fuel → a run returns gas stations/convenience stores; toggle All industries → broad results; Food & Beverage returns varied cuisines (chunking works, no 400 in the Edge logs). Old path-stops/merchants still show a category label (e.g. a legacy "retail" stop reads "Retail").
- [ ] **Step 3: Finish the branch** (superpowers:finishing-a-development-branch → merge + push). Note: Edge functions deploy with the app; verify the `discover_prospects` deploy picks up `_shared` changes.

---

## Self-Review

**Spec coverage:** 23-bucket/341-type config + one-to-one + recommended default + drop tiers → Task 1 ✅. `MerchantCategory`/`CATEGORY_LABEL` + legacy fallback → Tasks 2-3 ✅. Recommended pre-selection → Task 4 ✅. "All industries" = omit includedTypes → Task 5 ✅. Unsupported-type stripping → Task 1 (`SEARCH_UNSUPPORTED_TYPES`) ✅. 50-type cap (the F&B reality) → Task 6 ✅ (added beyond the spec — flagged at handoff). icpFilter review → Task 7 ✅. Multi-select editor unchanged (auto-renders new buckets) ✅. Defer Text Search ✅.

**Placeholder scan:** No TBD. The one transcription deferral — the 167-type `food_beverage` array — points to the exact CSV row + canonical-mapping section; every other bucket is enumerated inline. Task 5/6 give concrete code shapes; the "investigate `searchNearbyForTypes`" step is a real verification, not a placeholder (followed by exact chunking code).

**Type consistency:** `IndustryKey` (23 + `other`) == `MerchantCategory` (Task 1 ↔ Task 2). `RECOMMENDED_KEYS` defined in Task 1, consumed in Task 4. `labelForCategory(key: string): string` defined Task 2, used Task 3. `ALL_FETCHABLE_KEYS` (23) used in Task 1 reverse-index + Task 5 Edge validation. `all_industries` flag consistent across Task 5 (RequestBody ↔ useMerchants payload). `searchableTypes`/`bucketForType` signatures unchanged. Removed `TIER_1_KEYS`/`tier` — Task 4 drops the only app consumer; Task 1 drops the test references.
