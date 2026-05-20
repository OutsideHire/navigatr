/**
 * useStageHistory — org-wide stage transition log.
 *
 * Reads deal_stage_history rows for the user's org (RLS enforced).
 * Powers the dashboard's Conversion Funnel + future cycle-time
 * analytics. Append-only on the server side; the frontend never
 * writes here.
 *
 * staleTime is longer than the deals list (5 min) because history
 * doesn't change with anywhere near the cadence of deals.last_activity_at
 * — invalidation happens implicitly when reps mutate stages elsewhere
 * (via the deals_update path, which doesn't yet invalidate this key
 * — Sprint 2 follow-up if the funnel goes stale during heavy use).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { DealStage } from "../mockData";

export interface StageHistoryRow {
  id: string;
  dealId: string;
  fromStage: DealStage | null;
  toStage: DealStage;
  transitionedAt: string;
}

interface SupabaseRow {
  id: string;
  deal_id: string;
  from_stage: DealStage | null;
  to_stage: DealStage;
  transitioned_at: string;
}

function toRow(r: SupabaseRow): StageHistoryRow {
  return {
    id: r.id,
    dealId: r.deal_id,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    transitionedAt: r.transitioned_at,
  };
}

export const STAGE_HISTORY_QUERY_KEY = (userId: string | undefined) =>
  ["stage-history", "list", userId ?? "anon"] as const;

export function useStageHistory() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: STAGE_HISTORY_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<StageHistoryRow[]> => {
      const { data, error } = await supabase
        .from("deal_stage_history")
        .select("id, deal_id, from_stage, to_stage, transitioned_at")
        .order("transitioned_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => toRow(r as unknown as SupabaseRow));
    },
    staleTime: 5 * 60_000,
  });
}
