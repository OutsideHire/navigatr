# Path Industry Umbrellas — Design

**Goal:** Group the long flat industry list in the Create Path "Add industries" picker under parent
umbrellas (Retail; Restaurants, Bars & Entertainment), so it's shorter and clearer.

## Context

The industry taxonomy (`supabase/functions/_shared/industryTaxonomy.ts`, `INDUSTRIES`) already has the
correct labels and `includedTypes` for every group the user specified. The only gap: the picker
(`IndustryEditor`) shows all ~24 industries as a **flat list**. The user wants a parent-umbrella tier.
Content is correct; this is a **display-grouping** change only — no place-type remapping, no DB
migration (keys unchanged), and the Places-ingest Edge function is untouched (it never reads groups).

## Design

### 1. `industryTaxonomy.ts` (shared)
Add display-only grouping metadata + a helper:

```ts
export interface IndustryGroup { label: string; keys: IndustryKey[]; }

/** Parent umbrellas for the picker. Industries not listed here render standalone.
 *  Display-only: ingest / bucketing ignore this. */
export const INDUSTRY_GROUPS: IndustryGroup[] = [
  { label: "Retail", keys: ["grocery_food_retail", "apparel_accessories", "home_hardware",
      "electronics_specialty", "pharmacy_health_retail", "general_merchandise"] },
  { label: "Restaurants, Bars & Entertainment", keys: ["food_beverage", "entertainment"] },
];

export type IndustryDisplayNode =
  | { kind: "group"; label: string; keys: IndustryKey[]; order: number }
  | { kind: "industry"; key: IndustryKey; order: number };

/** Ordered mix of group nodes and standalone-industry nodes for the picker.
 *  A group's order = the min `order` of its children; children are sorted by order.
 *  Excludes 'other'. */
export function industryDisplayNodes(): IndustryDisplayNode[] { /* build + sort by order */ }
```

Order outcome: …Convenience & Fuel (7), **Retail** (8: Grocery & Food, Apparel, Home, Electronics,
Pharmacy, General Merchandise), **Restaurants, Bars & Entertainment** (14: Food & Beverage,
Entertainment), Hospitality (15) … Personal Services (19), Sports & Recreation (21), Transportation (22).

Label tweak: `grocery_food_retail.label` "Grocery & Food Retail" → **"Grocery & Food"** (parent carries
"Retail"). Key unchanged.

### 2. `mockData.ts`
`CATEGORY_LABEL.grocery_food_retail` "Grocery & Food Retail" → **"Grocery & Food"** (this is the label
the editor actually renders; kept in sync with the taxonomy).

### 3. `IndustryEditor.tsx` — the "Add industries" picker only
Render via `industryDisplayNodes()`:
- **group node** → a non-interactive section header (`label`) with its addable children (children not
  already chosen) as the existing add buttons, indented. If every child is already chosen, omit the
  header entirely.
- **industry node** → the existing add button inline (only if not already chosen).

Header is grouping only — no "add all" (per decision). The **chosen list stays flat** (unchanged).
Removing all of a group's children from `addable` should also drop the header (no empty sections).

### 4. Testing
- `industryTaxonomy` (frontend `mockData.taxonomy.test.ts` or a new taxonomy test): `INDUSTRY_GROUPS`
  keys are all valid `IndustryKey`s, no key appears in two groups, no grouped key is `other`;
  `industryDisplayNodes()` is sorted by order, includes each group once, and every fetchable non-grouped
  industry appears exactly once.
- `IndustryEditor.test.tsx`: opening "Add industries" shows a **"Retail"** header with its 6 industries
  nested; adding all six removes the header; standalone industries (e.g. Healthcare) still show inline.

## Risks
- Pure frontend display + taxonomy metadata. No key changes → saved selections, ingest, and
  `bucketForType` are unaffected. The label change is display-only.
