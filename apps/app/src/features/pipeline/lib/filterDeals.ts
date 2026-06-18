import type { Deal } from "../mockData";

export interface DealFilters {
  minValueCents: number | null;
  minProbability: number | null;
  followUp: "any" | "has" | "none";
}

export const EMPTY_DEAL_FILTERS: DealFilters = {
  minValueCents: null,
  minProbability: null,
  followUp: "any",
};

export function applyDealFilters(deals: Deal[], f: DealFilters): Deal[] {
  return deals.filter((d) => {
    if (f.minValueCents != null && d.valueCents < f.minValueCents) return false;
    if (f.minProbability != null && d.probability < f.minProbability) return false;
    if (f.followUp === "has" && d.nextFollowup == null) return false;
    if (f.followUp === "none" && d.nextFollowup != null) return false;
    return true;
  });
}

export function activeFilterCount(f: DealFilters): number {
  return (f.minValueCents != null ? 1 : 0) + (f.minProbability != null ? 1 : 0) + (f.followUp !== "any" ? 1 : 0);
}
