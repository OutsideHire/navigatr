/**
 * Industry selection model — the single representation shared by path preferences,
 * the IndustryEditor, and (Phase B) the prospect sub-type filter. A category maps
 * to the sub-type (Google primary_type) keys selected within it; a category with
 * all its sub-types is fully selected, a subset is partial, absent is unselected.
 */
import { INDUSTRIES, RECOMMENDED_KEYS } from "../../../../../../supabase/functions/_shared/industryTaxonomy";
import type { MerchantCategory } from "../mockData";

export type IndustrySelection = Partial<Record<MerchantCategory, string[]>>;

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

/** Drop entries whose key is not a current taxonomy key — e.g. stale keys in a
 *  saved selection from before a taxonomy migration. */
export function pruneToKnownCategories(sel: IndustrySelection): IndustrySelection {
  const out: IndustrySelection = {};
  for (const key of Object.keys(sel) as MerchantCategory[]) {
    if (isKnownCategory(key)) out[key] = sel[key];
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
  const subs = sel[category];
  if (!subs || subs.length === 0) return false;
  if (primaryType == null) return true;
  if (isFullySelected(sel, category)) return true;
  return subs.includes(primaryType);
}

export function humanizeSubtype(type: string): string {
  const spaced = type.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
