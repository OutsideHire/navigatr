/**
 * usePersistenceCompanySeries: the org's daily aggregate Persistence Index
 * series (SP-B), read from the `persistence_company_series` RPC over the
 * nightly snapshot tables. Ascending by date: { snapshot_date, composite_median,
 * composite_p90, rep_count }. Feeds the detail report's daily "Company average"
 * and "Top decile" reference lines once enough nightly snapshots have accrued;
 * an RPC error is treated as no-data so the caller can fall back to the
 * existing SP-A static client-side benchmark. Pass `enabled: false` (reps, who
 * never render peer benchmarks) to skip the round trip entirely.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CompanySeriesPoint {
  date: string;
  median: number | null;
  p90: number | null;
  repCount: number;
}

interface CompanySeriesRow {
  snapshot_date: string;
  composite_median: number | null;
  composite_p90: number | null;
  rep_count: number;
}

export function usePersistenceCompanySeries(rangeDays: number, enabled = true) {
  return useQuery({
    queryKey: ["persistence-company-series", rangeDays],
    enabled,
    queryFn: async (): Promise<CompanySeriesPoint[]> => {
      const { data, error } = await supabase.rpc("persistence_company_series", { p_range_days: rangeDays });
      if (error) return [];
      return ((data ?? []) as CompanySeriesRow[]).map((r) => ({
        date: r.snapshot_date,
        median: r.composite_median,
        p90: r.composite_p90,
        repCount: r.rep_count,
      }));
    },
    staleTime: 60_000,
  });
}
