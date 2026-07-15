/**
 * kpiBreakdown — per-owner split of a dashboard KPI, computed from the
 * already-hierarchy-scoped deals. Sums equal the KPI (same predicates, no
 * date-range filter — the 3 core KPIs are stock metrics). owner_id null → an
 * "unassigned" bucket.
 */
import type { Deal, DealStage } from "@/features/pipeline/mockData";

export type KpiMetric = "activeLeads" | "pipelineValue" | "won";

export interface OwnerBreakdownRow {
  ownerId: string | null;
  value: number; // count for activeLeads; cents for pipelineValue/won
}
export interface KpiBreakdown {
  rows: OwnerBreakdownRow[]; // sorted by value desc
  min: number;
  max: number;
  total: number;
}

const TERMINAL = new Set<DealStage>(["won", "lost"]);

export function breakdownByOwner(deals: Deal[], metric: KpiMetric): KpiBreakdown {
  const byOwner = new Map<string | null, number>();
  const add = (owner: string | null, v: number) =>
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + v);

  for (const d of deals) {
    if (metric === "won") {
      if (d.stage === "won") add(d.owner_id, d.valueCents);
    } else if (!TERMINAL.has(d.stage)) {
      add(d.owner_id, metric === "activeLeads" ? 1 : d.valueCents);
    }
  }

  const rows = [...byOwner.entries()]
    .map(([ownerId, value]) => ({ ownerId, value }))
    .sort((a, b) => b.value - a.value);
  const values = rows.map((r) => r.value);
  return {
    rows,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    total: values.reduce((s, v) => s + v, 0),
  };
}
