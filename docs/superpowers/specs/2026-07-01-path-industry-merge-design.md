# Path Industry Merge — Retail & Restaurants/Bars/Entertainment — Design

**Goal:** Consolidate the industry taxonomy so the Create Path picker offers a single **Retail**
industry and a single **Restaurants, Bars & Entertainment** industry, instead of many granular buckets.

**Supersedes** `2026-06-25-path-industry-umbrellas-design.md` — that shipped display-only umbrella
headers, which was the wrong interpretation. This merges the underlying category keys. The umbrella
code (INDUSTRY_GROUPS / industryDisplayNodes / IndustryEditor grouping) is reverted.

## Target taxonomy

Merge these keys into two new ones (union of their `includedTypes`, order preserved):
- **retail** ("Retail", order 8) ← grocery_food_retail + apparel_accessories + home_hardware +
  electronics_specialty + pharmacy_health_retail + general_merchandise (39 place-types)
- **restaurants_bars_entertainment** ("Restaurants, Bars & Entertainment", order 14) ← food_beverage +
  entertainment (~200 place-types)

Unchanged: manufacturing_wholesale, construction_trades, healthcare, veterinary_pet,
professional_services, automotive, convenience_fuel, hospitality, education, finance_banking,
fitness_wellness, personal_services, sports_recreation, transportation, non_profit, other.

Removed active keys (→ retired, display-relabeled): grocery_food_retail, apparel_accessories,
home_hardware, electronics_specialty, pharmacy_health_retail, general_merchandise, food_beverage,
entertainment.

## Data handling — relabel, no rewrite (per decision)

- **New discoveries** bucket into `retail` / `restaurants_bars_entertainment` automatically —
  `TYPE_TO_INDUSTRY` / `bucketForType` rebuild from the new `INDUSTRIES` (the place-type sets are
  disjoint, so the one-to-one invariant holds).
- **Existing merchant/path_stop rows** keep their old key strings; `RETIRED_CATEGORY_LABEL` maps each
  of the 8 old keys to its new label ("Retail" / "Restaurants, Bars & Entertainment") so
  `labelForCategory` displays them correctly. No DB migration.
- **Saved path selections** (`IndustrySelection`, keyed by category): `pruneToKnownCategories` gains a
  remap step — old keys fold into the new key, unioning their sub-type arrays — so a rep's saved
  default auto-migrates instead of being dropped.

## Files

- `supabase/functions/_shared/industryTaxonomy.ts`: update `IndustryKey`; replace the 8 entries in
  `INDUSTRIES` with `retail` + `restaurants_bars_entertainment` (combined `includedTypes`); update
  `RECOMMENDED_KEYS` (food_beverage→restaurants_bars_entertainment, grocery_food_retail→retail);
  **remove** `INDUSTRY_GROUPS` / `IndustryDisplayNode` / `industryDisplayNodes` (revert).
- `apps/app/src/features/path/mockData.ts`: update `MerchantCategory` union + `CATEGORY_LABEL`
  (drop the 8, add the 2); add the 8 old keys to `RETIRED_CATEGORY_LABEL`; update `MOCK_MERCHANTS`
  rows using removed keys (apparel/home/general → retail; food_beverage → restaurants_bars_entertainment).
- `apps/app/src/features/path/lib/industrySelection.ts`: add `LEGACY_KEY_MAP` + fold-in logic in
  `pruneToKnownCategories`.
- `apps/app/src/features/path/components/IndustryEditor.tsx`: revert to the flat addable list (remove
  the umbrella grouping added in the prior change).
- Edge `discover_prospects` / `chunk`: no logic change (generic over `IndustryKey`); update stale
  comments referencing food_beverage counts if convenient.

## Testing

- `industryTaxonomy.test.ts` (Deno) + `mockData.taxonomy.test.ts` (frontend): remove umbrella-group
  tests; assert `retail.includedTypes` contains a type from each former retail bucket (e.g.
  supermarket, clothing_store, hardware_store, electronics_store, pharmacy, department_store) and
  `restaurants_bars_entertainment` contains restaurant + movie_theater; the type→bucket map stays
  one-to-one; `bucketForType("clothing_store")` → retail, `bucketForType("movie_theater")` →
  restaurants_bars_entertainment.
- `industrySelection.test.ts`: `pruneToKnownCategories({ grocery_food_retail: [...], apparel_accessories:
  [...] })` folds into `{ retail: [union] }`; food_beverage/entertainment fold into
  restaurants_bars_entertainment.
- `labelForCategory("grocery_food_retail")` → "Retail"; `labelForCategory("food_beverage")` →
  "Restaurants, Bars & Entertainment".
- Update every test referencing a removed key (IndustryEditor, CreatePathWizard, PathSettings,
  usePathPreferences, PathPage, useMerchants, proposeRoute, sortMerchants, DropInSheet) to the new keys.
- `IndustryEditor.test.tsx`: revert the umbrella-header test; confirm "Retail" appears as a single
  selectable industry.

## Risks

- Broad key rename across ~16 files — the full test suite + typecheck are the safety net; run both to
  green before finishing. No DB migration (relabel-only), so prod data is untouched; the selection
  remap prevents rep defaults from resetting.
