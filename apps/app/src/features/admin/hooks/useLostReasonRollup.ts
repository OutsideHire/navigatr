/**
 * useLostReasonRollup — Monday-morning "why are we losing deals" query.
 *
 * Backed by the `lost_reason_rollup(p_window_days)` RPC. SECURITY DEFINER
 * scopes results to caller's org. Window is clamped server-side; the UI
 * just picks from 7 / 30 / 90 like the leaderboard does.
 *
 * Stale-time matches the leaderboard (60s) — lost-reason data doesn't
 * change minute-to-minute and we don't want to thrash a query if the
 * admin toggles between Team and Insights pages.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type LostReasonCategory =
  | "price"
  | "competitor"
  | "timing"
  | "no_decision"
  | "incumbent"
  | "unqualified"
  | "other";

export interface LostReasonRow {
  category: LostReasonCategory;
  deal_count: number;
  lost_value_cents: number;
}

export function useLostReasonRollup(windowDays: number) {
  return useQuery<LostReasonRow[]>({
    queryKey: ["lost-reason-rollup", windowDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lost_reason_rollup", {
        p_window_days: windowDays,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as LostReasonRow[];
    },
    staleTime: 60_000,
  });
}

/** Human-friendly labels. Kept here (not the DB) so we can A/B copy
 *  without a migration. */
export const LOST_REASON_LABELS: Record<LostReasonCategory, string> = {
  price: "Price / budget",
  competitor: "Lost to competitor",
  timing: "Bad timing",
  no_decision: "No decision",
  incumbent: "Staying with incumbent",
  unqualified: "Not a fit",
  other: "Other",
};
