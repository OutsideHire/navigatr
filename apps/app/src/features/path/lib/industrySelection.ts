/**
 * Industry selection model — the single representation shared by path preferences,
 * the IndustryEditor, and (Phase B) the prospect sub-type filter. A category maps
 * to the sub-type (Google primary_type) keys selected within it; a category with
 * all its sub-types is fully selected, a subset is partial, absent is unselected.
 */
import { INDUSTRIES, INDUSTRY_KEYS } from "../../../../../../supabase/functions/_shared/industryTaxonomy";
import type { MerchantCategory } from "../mockData";

export type IndustrySelection = Partial<Record<MerchantCategory, string[]>>;

export function allSubtypes(category: MerchantCategory): string[] {
  return INDUSTRIES[category as keyof typeof INDUSTRIES]?.includedTypes ?? [];
}

export const RECOMMENDED_SELECTION: IndustrySelection = INDUSTRY_KEYS.reduce<IndustrySelection>((acc, key) => {
  if (INDUSTRIES[key].tier === 1) acc[key as MerchantCategory] = [...INDUSTRIES[key].includedTypes];
  return acc;
}, {});

export function selectedCategories(sel: IndustrySelection): MerchantCategory[] {
  return (Object.keys(sel) as MerchantCategory[]).filter((c) => (sel[c]?.length ?? 0) > 0);
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
