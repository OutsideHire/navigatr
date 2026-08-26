/**
 * useRepFirstAction — rep-scoped first-run state for the field rep's
 * first-action nudge (onboarding A2 slice 2). Where the ISO-admin gets the
 * Get-Started checklist ("invite your team"), a brand-new Sales Professional
 * gets one nudge toward their actual loop: log a stop / add a deal.
 *
 * "Taken" means the rep already owns their first real work — >= 1 deal they
 * own (deals.owner_id) OR >= 1 activity they logged (activities.logged_by).
 * Once taken, the nudge retires itself (same self-retiring pattern as the
 * checklist), so there is no dismiss flag.
 *
 * The derivation is a pure function (unit-tested); the hook fetches two
 * RLS-scoped head counts filtered to the caller and feeds them in. It only
 * runs when `enabled` (the page passes true only for a Sales Professional) and
 * FAILS OPEN: unknown counts are treated as zero (not-yet-acted) so a read
 * blip never hides a new rep's only piece of guidance.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface RepActionCounts {
  ownDealCount: number;
  ownActivityCount: number;
}

export interface RepFirstAction {
  hasOwnDeals: boolean;
  hasOwnActivities: boolean;
  /** The rep has taken their first action (owns a deal OR logged an activity). */
  taken: boolean;
}

/** Pure: rep-scoped counts -> first-action state. */
export function deriveRepFirstAction(c: RepActionCounts): RepFirstAction {
  const hasOwnDeals = c.ownDealCount >= 1;
  const hasOwnActivities = c.ownActivityCount >= 1;
  return { hasOwnDeals, hasOwnActivities, taken: hasOwnDeals || hasOwnActivities };
}

const ZERO: RepActionCounts = { ownDealCount: 0, ownActivityCount: 0 };

/** RLS-scoped head count of `table` rows where `col` = the caller's id. */
async function ownHeadCount(table: string, col: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(col, userId);
  if (error) throw error;
  return count ?? 0;
}

export interface UseRepFirstActionResult extends RepFirstAction {
  isLoading: boolean;
}

export function useRepFirstAction(enabled: boolean): UseRepFirstActionResult {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: ["rep-first-action", userId ?? "anon"],
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<RepActionCounts> => {
      const [ownDealCount, ownActivityCount] = await Promise.all([
        ownHeadCount("deals", "owner_id", userId!),
        ownHeadCount("activities", "logged_by", userId!),
      ]);
      return { ownDealCount, ownActivityCount };
    },
    staleTime: 30_000,
  });

  // Fail toward SHOWING the nudge: unknown counts => zero => not-yet-acted.
  const derived = deriveRepFirstAction(query.data ?? ZERO);
  return { ...derived, isLoading: enabled && query.isLoading };
}
