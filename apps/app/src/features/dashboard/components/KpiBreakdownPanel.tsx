/**
 * KpiBreakdownPanel — per-rep breakdown of one KPI, shown inline under the KPI
 * row when a manager/admin expands it. Rows sorted desc, a "range across reps"
 * band, and each real-owner row taps through to that rep's detail page.
 */
import { Card } from "@/components/navigatr";
import { formatMoney, type Deal } from "@/features/pipeline/mockData";
import { breakdownByOwner, type KpiMetric } from "../lib/kpiBreakdown";

function fmt(metric: KpiMetric, value: number): string {
  return metric === "activeLeads" ? String(value) : formatMoney(value);
}

export interface KpiBreakdownPanelProps {
  title: string;
  metric: KpiMetric;
  deals: Deal[];
  memberNames: Map<string, string>;
  onSelectRep: (ownerId: string) => void;
}

export function KpiBreakdownPanel({
  title, metric, deals, memberNames, onSelectRep,
}: KpiBreakdownPanelProps) {
  const { rows } = breakdownByOwner(deals, metric);
  // The "across reps" band spans only real owners — the Unassigned bucket
  // (owner_id null) isn't a rep, so it must not set the min/max.
  const repValues = rows.filter((r) => r.ownerId !== null).map((r) => r.value);
  return (
    <Card padding="md" shadow="sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-body-strong text-text-default">{title}</h3>
        {repValues.length > 1 && (
          <span className="text-caption text-text-muted">
            Range across reps: {fmt(metric, Math.min(...repValues))}–{fmt(metric, Math.max(...repValues))}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-body-md text-text-muted">No data for this metric yet.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => {
            const name = r.ownerId ? (memberNames.get(r.ownerId) ?? "Teammate") : "Unassigned";
            const inner = (
              <>
                <span className="truncate text-body-md text-text-default">{name}</span>
                <span className="shrink-0 tabular-nums text-body-strong text-text-default">
                  {fmt(metric, r.value)}
                </span>
              </>
            );
            return r.ownerId ? (
              <button
                key={r.ownerId}
                type="button"
                onClick={() => onSelectRep(r.ownerId as string)}
                className="flex items-center justify-between gap-3 rounded-radius-sm px-2 py-2 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                {inner}
              </button>
            ) : (
              <div key="unassigned" className="flex items-center justify-between gap-3 px-2 py-2">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default KpiBreakdownPanel;
