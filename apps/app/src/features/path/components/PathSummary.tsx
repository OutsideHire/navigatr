/**
 * PathSummary — end-of-path completion view (Path v2, Slice 2). Rendered inside
 * PathPlanSheet when the queue has no pending stops.
 *
 * MVP / Places-only: "stops visited", "miles", and "completion" are real (from
 * the queue + route math). "Deals created" and the disposition breakdown depend
 * on drop-in logging, which lands in Slice 3 — until then they show a zero-state
 * rather than fabricated numbers. No $ pipeline total (value is unknown in MVP).
 */
import { Trophy, Route as RouteIcon, LayoutGrid } from "lucide-react";

import { Button } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";

export interface PathSummaryProps {
  visitedCount: number;
  skippedCount: number;
  totalStops: number;
  /** Straight-line route length actually walked/driven, meters. */
  routeMeters: number;
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
  onViewPipeline,
  onNewPath,
}: PathSummaryProps) {
  const completionPct = totalStops === 0 ? 0 : Math.round((visitedCount / totalStops) * 100);

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
        <Metric label="Miles" value={formatDistance(routeMeters).replace(" mi", "")} />
      </div>

      <div className="rounded-radius-md border border-dashed border-border-default p-4 text-center">
        <p className="text-caption text-text-muted">
          Deal and disposition tracking turns on with drop-in logging (coming next). For now,
          log visits as you work the route.
        </p>
      </div>

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
