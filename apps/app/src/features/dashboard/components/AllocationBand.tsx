/**
 * AllocationBand ("Where the effort went"): a card with a single horizontal bar
 * splitting all logged activity by deal outcome (won/open/lost). Each segment is
 * a control that scopes the report and doubles as the legend below. Selecting the
 * active segment returns to All.
 */
import { cn } from "@/lib/utils";
import { Card } from "@/components/navigatr";
import type { OutcomeBand, ReportScope } from "../lib/unifiedActivityReport";

const SEGMENTS: { outcome: "won" | "open" | "lost"; label: string; bar: string }[] = [
  { outcome: "won", label: "Won", bar: "bg-accent-teal" },
  { outcome: "open", label: "Open", bar: "bg-accent-blue" },
  { outcome: "lost", label: "Lost", bar: "bg-accent-pink" },
];

export function AllocationBand({
  band,
  scope,
  onScope,
}: {
  band: OutcomeBand;
  scope: ReportScope;
  onScope: (s: ReportScope) => void;
}) {
  const total = band.total;
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-body-strong text-text-default">Where the effort went</h2>
          <p className="text-caption text-text-muted">
            Every logged activity in the period, allocated by deal outcome. Select a band to scope the report.
          </p>
        </div>
        <p className="text-caption text-text-subtle">{total} activities logged</p>
      </div>

      <div
        className="mt-4 flex h-11 w-full gap-0.5 overflow-hidden rounded-radius-md"
        role="group"
        aria-label="Scope report by deal outcome"
      >
        {total === 0 ? (
          <div className="flex w-full items-center justify-center rounded-radius-md bg-surface-sunken text-caption text-text-muted">
            No activity logged
          </div>
        ) : (
          SEGMENTS.map((s) => {
            const count = band[s.outcome];
            if (count === 0) return null;
            const active = scope === s.outcome || scope === "all";
            return (
              <button
                key={s.outcome}
                type="button"
                onClick={() => onScope(scope === s.outcome ? "all" : s.outcome)}
                style={{ flexGrow: count, flexBasis: 0 }}
                aria-pressed={scope === s.outcome}
                title={`${s.label}: ${count} activities`}
                className={cn(
                  "flex min-w-[28px] items-center justify-center text-caption font-medium text-white transition-[opacity,filter] first:rounded-l-radius-md last:rounded-r-radius-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70",
                  s.bar,
                  !active && "opacity-40",
                )}
              >
                {count}
              </button>
            );
          })
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {SEGMENTS.map((s) => {
            const count = band[s.outcome];
            if (count === 0) return null;
            return (
              <span key={s.outcome} className="flex items-center gap-2 text-caption text-text-muted">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", s.bar)} aria-hidden />
                {s.label} <b className="font-medium text-text-default">{count}</b>
                <span className="text-text-subtle">({Math.round((count / total) * 100)}%)</span>
              </span>
            );
          })}
          <span className="flex items-center gap-2 text-caption text-text-muted">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-text-subtle" aria-hidden />
            All activity <b className="font-medium text-text-default">{total}</b>
          </span>
        </div>
      )}
    </Card>
  );
}

export default AllocationBand;
