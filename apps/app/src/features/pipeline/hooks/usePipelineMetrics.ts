/**
 * usePipelineMetrics — server-side Pipeline KPI totals (PRD 6.12.A FR-HIER-03).
 *
 * The KPI strip was summed on the client from whatever the deals query loaded.
 * That query has no row limit, so PostgREST caps it at its default max rows
 * (1000). For a manager high in the hierarchy who can see thousands of deals,
 * the client-summed totals silently understate. This hook calls the
 * `pipeline_metrics` RPC, which sums in the database over EVERY deal the caller
 * can see (SECURITY INVOKER -> the same hierarchy RLS as the list), so the
 * headline numbers are correct no matter how many rows the client loaded.
 *
 * "Won this month" is defined exactly as the client's computeKpis does it: the
 * server gates on each deal's WON-transition timestamp (deal_stage_history),
 * falling back to updated_at. To keep "this month" meaning what the user sees
 * on their own clock, we compute the first instant of the current month in the
 * browser's local time and pass it to the RPC (no server-timezone drift).
 *
 * The page still loads the deal LIST for rendering and for client-side filters;
 * this hook only supplies the aggregate totals for the KPI strip + subhead when
 * no owner filter is active. When an owner filter is active the visible set is a
 * single agent's deals (bounded, already loaded), so the page keeps computing
 * those totals from the loaded rows.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { PipelineKpis } from "../pages/PipelinePage";

/** Shape the RPC returns (snake_case; bigint columns arrive as numbers). */
export interface PipelineMetricsRow {
  total_pipeline_cents: number;
  weighted_cents: number;
  active_deals: number;
  won_this_month_cents: number;
  won_deals_this_month: number;
  no_value_active_deals: number;
}

/** First instant of the current month in the browser's local time, as an ISO
 *  string. Mirrors computeKpis' `new Date(now.getFullYear(), now.getMonth(), 1)`
 *  so the server's "this month" boundary matches the user's screen. */
export function localMonthStartIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** Map the RPC row onto the PipelineKpis shape the KPI strip already consumes.
 *  int8 columns can arrive as strings from PostgREST, so coerce with Number. */
export function toPipelineKpis(row: PipelineMetricsRow): PipelineKpis {
  return {
    totalPipeline: Number(row.total_pipeline_cents),
    weighted: Number(row.weighted_cents),
    activeDeals: Number(row.active_deals),
    wonThisMonth: Number(row.won_this_month_cents),
    wonDealsThisMonth: Number(row.won_deals_this_month),
    noValueActiveDeals: Number(row.no_value_active_deals),
  };
}

export const PIPELINE_METRICS_QUERY_KEY = (userId: string | undefined) =>
  ["pipeline-metrics", userId ?? "anon"] as const;

export function usePipelineMetrics() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: PIPELINE_METRICS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<PipelineKpis> => {
      const { data, error } = await supabase.rpc("pipeline_metrics", {
        p_month_start: localMonthStartIso(),
      });
      if (error) throw error;
      // rpc returns a set (one row); supabase-js gives an array.
      const row = (Array.isArray(data) ? data[0] : data) as
        | PipelineMetricsRow
        | undefined;
      if (!row) {
        return { totalPipeline: 0, weighted: 0, activeDeals: 0, wonThisMonth: 0, wonDealsThisMonth: 0, noValueActiveDeals: 0 };
      }
      return toPipelineKpis(row);
    },
    staleTime: 30_000,
  });
}
