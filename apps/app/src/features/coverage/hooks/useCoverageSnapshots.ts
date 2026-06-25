/**
 * useCoverageSnapshots — the current rep's Activity Logging Coverage snapshots
 * (SP2a). RLS scopes coverage_snapshot to the rep's own rows. Returns the latest
 * snapshot (headline) + the trailing series in chronological order (sparkline).
 * A query error is treated as no-data (the widget shows its instructional state).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

export interface CoverageSnapshot {
  snapshotDate: string;
  compositeCoverage: number;
  confidenceLevel: ConfidenceLevel;
  callCoverage: number | null;
  callEventCount: number;
  activeChannels: string[];
}

interface SnapshotRow {
  snapshot_date: string;
  composite_coverage: number;
  confidence_level: ConfidenceLevel;
  call_coverage: number | null;
  call_event_count: number;
  active_channels: string[] | null;
}

export const COVERAGE_SNAPSHOTS_QUERY_KEY = (userId: string | undefined) =>
  ["coverage", "snapshots", userId ?? "anon"] as const;

export function useCoverageSnapshots(): {
  latest: CoverageSnapshot | null;
  series: CoverageSnapshot[];
  isLoading: boolean;
} {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: COVERAGE_SNAPSHOTS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<CoverageSnapshot[]> => {
      const { data, error } = await supabase
        .from("coverage_snapshot")
        .select("snapshot_date, composite_coverage, confidence_level, call_coverage, call_event_count, active_channels")
        .order("snapshot_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return ((data ?? []) as unknown as SnapshotRow[]).map((r) => ({
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

  const rows = query.data ?? [];
  return {
    latest: rows[0] ?? null,
    series: [...rows].reverse(), // newest-first → chronological for the sparkline
    isLoading: query.isLoading,
  };
}
