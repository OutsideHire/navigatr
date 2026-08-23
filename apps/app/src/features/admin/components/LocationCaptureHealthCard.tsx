/**
 * LocationCaptureHealthCard — the operational capture-health readout on the
 * admin roster (PRD 6.12.A Bundle 5, FR-HIER-37). The location capture ships
 * with no rep-facing UI, so this is how an operator sees it is working during
 * beta. Admin-only: the RPC returns nothing to non-admins, so a rep sees the
 * empty state and the card can render harmlessly anywhere admin-scoped.
 */

import { Card } from "@/components/navigatr";
import { useLocationCaptureHealth } from "../hooks/useLocationCaptureHealth";
import { summarizeCaptureHealth } from "../lib/captureHealth";

const WINDOW_DAYS = 7;

export function LocationCaptureHealthCard() {
  const { data = [], isLoading } = useLocationCaptureHealth(WINDOW_DAYS);
  const summary = summarizeCaptureHealth(data);

  return (
    <Card padding="md">
      <div className="flex flex-col gap-1">
        <h3 className="text-body-strong text-text-default">Location capture health</h3>
        <p className="text-caption text-text-muted">
          Logged activities in the last {WINDOW_DAYS} days, by whether a location stamp was recorded.
        </p>
      </div>

      {isLoading ? (
        <p className="mt-4 text-body-sm text-text-muted">Loading…</p>
      ) : summary.total === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">No activities logged in this window yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-heading-lg tabular-nums text-text-default">{summary.pctCaptured}%</span>
            <span className="text-caption text-text-muted">
              captured ({summary.captured} of {summary.total})
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {summary.breakdown.map((b) => (
              <div key={b.status} className="flex items-center justify-between text-caption text-text-muted">
                <span>{b.label}</span>
                <span className="tabular-nums text-text-default">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
