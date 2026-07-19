/**
 * PersistenceIndexWidget — beta, individual scope.
 *
 * Renders the live Persistence Index for the signed-in rep: a composite
 * score out of 100 plus its two live sub-components (follow-up discipline,
 * touch cadence) as progress bars, and a dimmed "coming soon" row for
 * response velocity (needs inbound-email timestamps, not tracked yet).
 * Shows an honest empty state when neither sub-component has a sample.
 */

import { Card } from "@/components/navigatr";
import { usePersistenceIndex } from "../hooks/usePersistenceIndex";

function Bar({ label, points, max, pct }: { label: string; points: number; max: number; pct: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-body-sm">
        <span className="text-text-default">{label}</span>
        <span className="tabular-nums text-text-muted">{points}/{max}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
        <div className="h-full rounded-radius-full bg-brand-primary" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </div>
  );
}

export function PersistenceIndexWidget() {
  const pi = usePersistenceIndex();
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <span className="text-heading-sm text-text-default">Persistence index</span>
          <span className="text-caption text-text-muted">You · last 30 days</span>
        </div>
        {pi == null || pi.composite == null ? (
          <p className="text-body-sm text-text-muted">
            Not enough data yet. Log activity and set follow-ups to see your Persistence Index.
          </p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className="text-kpi-lg tabular-nums leading-none text-text-default">{pi.composite}</span>
              <span className="pb-1 text-caption text-text-muted">/ 100 · target {pi.targetScore}</span>
            </div>
            <div className="flex flex-col gap-3">
              <Bar label="Follow-up discipline" points={pi.followUp.points} max={pi.followUp.max} pct={pi.followUp.points / pi.followUp.max} />
              <Bar label="Touch cadence" points={pi.cadence.points} max={pi.cadence.max} pct={pi.cadence.points / pi.cadence.max} />
              <div className="flex items-center justify-between text-body-sm opacity-60">
                <span className="text-text-default">Response velocity</span>
                <span className="text-caption text-text-muted">Coming soon</span>
              </div>
            </div>
            <p className="text-caption text-text-subtle">
              {pi.followUp.completionRate != null ? `${Math.round(pi.followUp.completionRate * 100)}% follow-ups on time` : "No follow-ups due"}
              {" · "}
              {pi.cadence.medianTouchesPerWeek != null ? `${pi.cadence.medianTouchesPerWeek.toFixed(1)} touches/week across ${pi.cadence.activeDeals} active ${pi.cadence.activeDeals === 1 ? "deal" : "deals"}` : "no active deals"}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

export default PersistenceIndexWidget;
