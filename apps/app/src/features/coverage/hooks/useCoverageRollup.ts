/**
 * useCoverageRollup — manager/admin team coverage rollup (SP2b). Calls the
 * coverage_rollup RPC (per-rep latest snapshot, hierarchy + role scoped server-
 * side) and maps to CoverageRollupRow. An RPC error (incl. a non-manager hitting
 * it) is treated as no-data so the card shows its empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { CoverageRollupRow } from "../lib/teamCoverage";
import type { ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

interface RollupRpcRow {
  user_id: string;
  full_name: string | null;
  role: "rep" | "manager" | "admin";
  snapshot_date: string | null;
  composite_coverage: number | null;
  confidence_level: ConfidenceLevel | null;
  call_coverage: number | null;
  call_event_count: number | null;
  active_channels: string[] | null;
}

export const COVERAGE_ROLLUP_QUERY_KEY = (userId: string | undefined) =>
  ["coverage", "rollup", userId ?? "anon"] as const;

export function useCoverageRollup(): { rows: CoverageRollupRow[]; isLoading: boolean } {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: COVERAGE_ROLLUP_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<CoverageRollupRow[]> => {
      const { data, error } = await supabase.rpc("coverage_rollup");
      if (error) throw error;
      return ((data ?? []) as unknown as RollupRpcRow[]).map((r) => ({
        userId: r.user_id,
        fullName: r.full_name,
        role: r.role,
        snapshotDate: r.snapshot_date,
        compositeCoverage: r.composite_coverage,
        confidenceLevel: r.confidence_level,
        callCoverage: r.call_coverage,
        callEventCount: r.call_event_count,
        activeChannels: r.active_channels ?? [],
      }));
    },
    staleTime: 30_000,
  });
  return { rows: query.data ?? [], isLoading: query.isLoading };
}
