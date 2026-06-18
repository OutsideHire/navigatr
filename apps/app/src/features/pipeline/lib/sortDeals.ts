import type { Deal } from "../mockData";

export type DealSortKey = "last_activity" | "value" | "probability" | "followup";

export const DEAL_SORT_LABEL: Record<DealSortKey, string> = {
  last_activity: "Last activity",
  value: "Value",
  probability: "Probability",
  followup: "Next follow-up",
};

/** Returns a new, sorted array (input never mutated). */
export function sortDeals(deals: Deal[], key: DealSortKey): Deal[] {
  const arr = [...deals];
  switch (key) {
    case "value":
      return arr.sort((a, b) => b.valueCents - a.valueCents);
    case "probability":
      return arr.sort((a, b) => b.probability - a.probability);
    case "followup":
      return arr.sort((a, b) => {
        if (a.nextFollowup === b.nextFollowup) return 0;
        if (!a.nextFollowup) return 1;
        if (!b.nextFollowup) return -1;
        return a.nextFollowup < b.nextFollowup ? -1 : 1;
      });
    case "last_activity":
    default:
      return arr.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
  }
}
