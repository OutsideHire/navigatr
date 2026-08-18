/**
 * PathSummary — end-of-path completion view (Path v2, Slice 2). Rendered inside
 * RunningPath when the queue has no pending stops.
 *
 * MVP / Places-only: "stops visited", "miles", and "completion" are real (from
 * the queue + route math). "Deals created" and the disposition breakdown depend
 * on drop-in logging, which lands in Slice 3 — until then they show a zero-state
 * rather than fabricated numbers. No $ pipeline total (value is unknown in MVP).
 */
import * as React from "react";
import { Trophy, Route as RouteIcon, LayoutGrid } from "lucide-react";

import { Button } from "@/components/navigatr";
import { type Disposition } from "@/lib/followUpScheduling";
import { repOutcomeLabel } from "../lib/outcomeRepLabels";

export interface PathSummaryProps {
  visitedCount: number;
  skippedCount: number;
  totalStops: number;
  /** Straight-line route length actually walked/driven, meters. */
  routeMeters: number;
  /** Dispositions recorded on visited stops, for the breakdown. */
  dispositions: Disposition[];
  /** Deals actually created on this path (stops where createDeal succeeded). */
  dealsCreated: number;
  /** Navigate to the pipeline (deals) view. */
  onViewPipeline: () => void;
  /** Clear the queue + start a new path. */
  onNewPath: () => void;
}

export function PathSummary({
  visitedCount,
  skippedCount,
  totalStops,
  routeMeters,
  dispositions,
  dealsCreated,
  onViewPipeline,
  onNewPath,
}: PathSummaryProps) {
  const completionPct = totalStops === 0 ? 0 : Math.round((visitedCount / totalStops) * 100);
  const breakdown = React.useMemo(() => {
    const counts = new Map<Disposition, number>();
    for (const d of dispositions) counts.set(d, (counts.get(d) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [dispositions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-radius-md bg-status-success/10 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-full bg-status-success/20">
          <Trophy className="h-5 w-5 text-status-success" aria-hidden />
        </span>
        <div>
          <p className="text-heading-sm text-text-default">Path complete</p>
          <p className="text-caption text-text-muted">
            {visitedCount} of {totalStops} stops visited · {completionPct}% complete
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Visited" value={String(visitedCount)} />
        <Metric label="Skipped" value={String(skippedCount)} />
        <Metric label="Miles" value={(routeMeters / 1609.344).toFixed(1)} />
      </div>

      <div>
        <p className="mb-2 text-caption font-medium text-text-muted">Deals created</p>
        <p className="text-heading-sm tabular-nums text-text-default">{dealsCreated}</p>
      </div>

      {breakdown.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-medium text-text-muted">Disposition breakdown</p>
          {breakdown.map(([d, n]) => (
            <div key={d} className="flex items-center justify-between rounded-radius-md bg-surface-sunken px-3 py-2">
              <span className="text-body-sm text-text-default">{repOutcomeLabel(d)}</span>
              <span className="text-body-sm font-semibold tabular-nums text-text-default">{n}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-caption text-text-muted">No drop-ins logged on this path.</p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" leadingIcon={LayoutGrid} onClick={onViewPipeline} className="flex-1">
          View pipeline
        </Button>
        <Button variant="primary" leadingIcon={RouteIcon} onClick={onNewPath} className="flex-1">
          New path
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-radius-md bg-surface-sunken p-3">
      <p className="text-heading-sm tabular-nums text-text-default">{value}</p>
      <p className="text-caption text-text-muted">{label}</p>
    </div>
  );
}

export default PathSummary;
