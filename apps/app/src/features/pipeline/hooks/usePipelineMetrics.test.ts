import { describe, it, expect } from "vitest";
import { localMonthStartIso, toPipelineKpis, type PipelineMetricsRow } from "./usePipelineMetrics";

describe("localMonthStartIso", () => {
  it("returns the first instant of the given month in local time", () => {
    // Mid-month date -> the 1st at local midnight, same year/month.
    const now = new Date(2026, 7, 23, 14, 30); // 23 Aug 2026 14:30 local
    const iso = localMonthStartIso(now);
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("is idempotent for a date already at month start", () => {
    const start = new Date(2026, 0, 1, 0, 0); // 1 Jan 2026 local midnight
    expect(localMonthStartIso(start)).toBe(start.toISOString());
  });
});

describe("toPipelineKpis", () => {
  it("maps snake_case RPC columns onto the PipelineKpis shape", () => {
    const row: PipelineMetricsRow = {
      total_pipeline_cents: 712345,
      weighted_cents: 244074,
      active_deals: 5,
      won_this_month_cents: 80000,
      won_deals_this_month: 2,
      no_value_active_deals: 1,
    };
    expect(toPipelineKpis(row)).toEqual({
      totalPipeline: 712345,
      weighted: 244074,
      activeDeals: 5,
      wonThisMonth: 80000,
      wonDealsThisMonth: 2,
      noValueActiveDeals: 1,
    });
  });

  it("coerces int8 columns that arrive as strings from PostgREST", () => {
    // supabase-js can surface bigint as a string; Number() must normalise it.
    const row = {
      total_pipeline_cents: "712345",
      weighted_cents: "244074",
      active_deals: "5",
      won_this_month_cents: "80000",
      won_deals_this_month: "2",
      no_value_active_deals: "1",
    } as unknown as PipelineMetricsRow;
    const k = toPipelineKpis(row);
    expect(k.totalPipeline).toBe(712345);
    expect(k.activeDeals).toBe(5);
    expect(k.wonThisMonth).toBe(80000);
    expect(typeof k.weighted).toBe("number");
  });
});
