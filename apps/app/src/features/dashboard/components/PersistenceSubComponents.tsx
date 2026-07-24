/**
 * PersistenceSubComponents: the "where your score comes from" breakdown for
 * the Persistence Index detail page. Three rows: Follow-Up Discipline and
 * Touch Cadence (real, with a peer-average tick), plus Response Velocity shown
 * as a labeled "coming soon" row (it needs the deferred inbound-capture system,
 * so it never contributes points today).
 */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { FOLLOWUP_MAX, CADENCE_MAX } from "../lib/persistenceIndex";

function Row({
  label, points, max, peerPct,
}: {
  label: string; points: number | null; max: number; peerPct: number | null;
}) {
  if (points == null) {
    return (
      <div>
        <div className="mb-1 flex justify-between text-body-sm">
          <span className="text-text-default">{label}</span>
        </div>
        <p className="text-caption text-text-subtle">Not enough data in this window yet.</p>
      </div>
    );
  }
  const pct = Math.round((points / max) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-body-sm">
        <span className="text-text-default">{label}</span>
        <span className="text-text-muted tabular-nums">{points} / {max} · {pct}%</span>
      </div>
      <div className="relative h-2 rounded-radius-full bg-surface-sunken">
        <div className="absolute inset-y-0 left-0 rounded-radius-full bg-brand-primary" style={{ width: `${pct}%` }} />
        {peerPct != null && (
          <div
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-muted"
            style={{ left: `${Math.min(100, Math.max(0, peerPct))}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export function PersistenceSubComponents({
  followUpPoints, cadencePoints, peerFollowUpPct, peerCadencePct,
}: {
  followUpPoints: number | null;
  cadencePoints: number | null;
  peerFollowUpPct: number | null;
  peerCadencePct: number | null;
}) {
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-4">
        <span className="text-body-sm font-medium text-text-default">Where your score comes from</span>
        <Row label="Follow-up discipline" points={followUpPoints} max={FOLLOWUP_MAX} peerPct={peerFollowUpPct} />
        <div className={cn("opacity-60")}>
          <div className="mb-1 flex items-center gap-2 text-body-sm">
            <span className="text-text-default">Response velocity</span>
            <span className="rounded-radius-full border border-border-subtle px-2 py-0.5 text-caption text-text-muted">Coming soon</span>
            <span className="text-caption text-text-muted">needs inbound capture</span>
          </div>
          <div className="h-2 rounded-radius-full bg-surface-sunken" aria-hidden />
        </div>
        <Row label="Touch cadence" points={cadencePoints} max={CADENCE_MAX} peerPct={peerCadencePct} />
        <p className="text-caption text-text-subtle">
          Score currently reflects the 2 components we can measure today; response velocity joins once inbound capture ships.
        </p>
      </div>
    </Card>
  );
}

export default PersistenceSubComponents;
