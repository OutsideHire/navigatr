/**
 * AllocationBand: a single horizontal bar splitting all logged activity by deal
 * outcome (won/open/lost). Each segment is a control that sets the report scope
 * and doubles as the legend. Selecting the active segment returns to All.
 */
import { cn } from "@/lib/utils";
import type { OutcomeBand, ReportScope } from "../lib/unifiedActivityReport";

const SEGMENTS: { outcome: "won" | "open" | "lost"; label: string; bg: string }[] = [
  { outcome: "won", label: "Won", bg: "bg-accent-teal" },
  { outcome: "open", label: "Open", bg: "bg-accent-blue" },
  { outcome: "lost", label: "Lost", bg: "bg-accent-pink" },
];

export function AllocationBand({ band, scope, onScope }: { band: OutcomeBand; scope: ReportScope; onScope: (s: ReportScope) => void }) {
  const total = band.total;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-8 w-full overflow-hidden rounded-radius-md" role="group" aria-label="Activity by outcome">
        {total === 0 ? (
          <div className="flex w-full items-center justify-center bg-surface-sunken text-caption text-text-muted">No activity logged</div>
        ) : (
          SEGMENTS.map((s) => {
            const count = band[s.outcome];
            if (count === 0) return null;
            const width = (count / total) * 100;
            const active = scope === s.outcome;
            return (
              <button
                key={s.outcome}
                type="button"
                onClick={() => onScope(active ? "all" : s.outcome)}
                style={{ width: `${width}%` }}
                aria-pressed={active}
                className={cn(
                  "flex min-w-[52px] items-center justify-center gap-1 text-caption font-medium text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70",
                  s.bg,
                  scope !== "all" && !active && "opacity-50",
                )}
              >
                {s.label} · {count}
              </button>
            );
          })
        )}
      </div>
      {total > 0 && (
        <p className="text-caption text-text-muted">
          {total} {total === 1 ? "activity" : "activities"} logged this period. Click a segment to change scope.
        </p>
      )}
    </div>
  );
}

export default AllocationBand;
