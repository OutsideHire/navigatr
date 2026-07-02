/**
 * Industry selection model — the single representation shared by path preferences,
 * the IndustryEditor, and (Phase B) the prospect sub-type filter. A category maps
 * to the sub-type (Google primary_type) keys selected within it; a category with
 * all its sub-types is fully selected, a subset is partial, absent is unselected.
 */
import { INDUSTRIES, RECOMMENDED_KEYS } from "../../../../../../supabase/functions/_shared/industryTaxonomy";
import type { MerchantCategory } from "../mockData";

export type IndustrySelection = Partial<Record<MerchantCategory, string[]>>;

/** Retired taxonomy keys → the merged key they now fold into. Lets a rep's saved
 *  selection auto-migrate after the retail / restaurants-bars-entertainment merge
 *  instead of being dropped as unknown. */
export const LEGACY_KEY_MAP: Record<string, MerchantCategory> = {
  grocery_food_retail: "retail",
  apparel_accessories: "retail",
  home_hardware: "retail",
  electronics_specialty: "retail",
  pharmacy_health_retail: "retail",
  general_merchandise: "retail",
  food_beverage: "restaurants_bars_entertainment",
  entertainment: "restaurants_bars_entertainment",
};

export function allSubtypes(category: MerchantCategory): string[] {
  return INDUSTRIES[category as keyof typeof INDUSTRIES]?.includedTypes ?? [];
}

/** Default pre-selection = the payments/merchant-services recommended buckets,
 *  each fully selected (all sub-types). */
export const RECOMMENDED_SELECTION: IndustrySelection = RECOMMENDED_KEYS.reduce<IndustrySelection>((acc, key) => {
  acc[key as MerchantCategory] = [...INDUSTRIES[key].includedTypes];
  return acc;
}, {});

/** True when `category` is a current taxonomy key (guards against stale keys
 *  left in saved preferences after a taxonomy migration). */
export function isKnownCategory(category: string): boolean {
  return INDUSTRIES[category as keyof typeof INDUSTRIES] != null;
}

export function selectedCategories(sel: IndustrySelection): MerchantCategory[] {
  return (Object.keys(sel) as MerchantCategory[]).filter((c) => (sel[c]?.length ?? 0) > 0 && isKnownCategory(c));
}

/** Normalize a saved selection: fold retired keys into their merged key (unioning
 *  the sub-type arrays, deduped) and drop keys that are neither a current taxonomy
 *  key nor a known legacy key. */
export function pruneToKnownCategories(sel: IndustrySelection): IndustrySelection {
  const out: IndustrySelection = {};
  const addSubtypes = (target: MerchantCategory, subs: string[] | undefined) => {
    const existing = out[target] ?? [];
    const merged = [...existing];
    for (const s of subs ?? []) if (!merged.includes(s)) merged.push(s);
    out[target] = merged;
  };
  for (const key of Object.keys(sel) as MerchantCategory[]) {
    const legacy = LEGACY_KEY_MAP[key];
    if (legacy) {
      addSubtypes(legacy, sel[key]);
    } else if (isKnownCategory(key)) {
      addSubtypes(key, sel[key]);
    }
  }
  return out;
}

export function subtypeCount(sel: IndustrySelection, category: MerchantCategory): { selected: number; total: number } {
  return { selected: sel[category]?.length ?? 0, total: allSubtypes(category).length };
}

export function isFullySelected(sel: IndustrySelection, category: MerchantCategory): boolean {
  const { selected, total } = subtypeCount(sel, category);
  return total > 0 && selected === total;
}

export function matchesSelection(
  primaryType: string | null,
  category: MerchantCategory,
  sel: IndustrySelection,
): boolean {
  // Fold pre-merge category labels into the merged key they now live under, so a
  // selection keyed on the merged category ("retail", "restaurants_bars_entertainment")
  // still matches rows stored under a legacy label (e.g. "food_beverage",
  // "apparel_accessories"). Without this the client-side pool filter drops every
  // legacy-labeled row and a retail/restaurants path returns almost nothing —
  // mirrors the server read's categoriesForIndustries expansion.
  const key = (LEGACY_KEY_MAP[category] ?? category) as MerchantCategory;
  const subs = sel[key];
  if (!subs || subs.length === 0) return false;
  if (primaryType == null) return true;
  if (isFullySelected(sel, key)) return true;
  return subs.includes(primaryType);
}

export function humanizeSubtype(type: string): string {
  const spaced = type.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
