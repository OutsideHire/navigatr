/**
 * PersistenceSubComponents: the "where your score comes from" breakdown for the
 * Persistence Index rep drill-down. One card per descriptor (Follow-Up
 * Discipline, Touch Cadence, Re-engagement After Silence) with its score,
 * weight, and a peer-average tick where available. Restyled to the prototype's
 * component-card grid (a3ffcd58); weights are the real engine maxima (they sum
 * to 100), so "Weight 40% of composite" reflects navigatr's actual scoring.
 */
import { Card } from "@/components/navigatr";

/** Eligible/recovered counts for the Re-engagement After Silence row (addendum):
 *  how many deals went quiet in the window vs. how many got a later touch. */
export interface ReEngagementCounts {
  silentCount: number;
  reEngagedCount: number;
}

function ComponentCard({
  label, points, max, peerPct, counts,
}: {
  label: string; points: number | null; max: number; peerPct: number | null; counts?: ReEngagementCounts | null;
}) {
  if (points == null) {
    return (
      <div className="flex flex-col gap-2 rounded-radius-md border border-border-subtle p-3">
        <span className="text-caption text-text-muted">{label}</span>
        <p className="text-caption text-text-subtle">Not enough data in this window yet.</p>
        <p className="mt-auto text-caption text-text-subtle">Weight {max}% of composite</p>
      </div>
    );
  }
  const pct = Math.round((points / max) * 100);
  return (
    <div className="flex flex-col gap-2 rounded-radius-md border border-border-subtle p-3">
      <span className="text-caption text-text-muted">{label}</span>
      <span className="text-body-sm tabular-nums text-text-default">{points} / {max} · {pct}%</span>
      <div className="relative h-1.5 rounded-radius-full bg-surface-sunken">
        <div className="absolute inset-y-0 left-0 rounded-radius-full bg-brand-primary" style={{ width: `${pct}%` }} />
        {peerPct != null && (
          <div
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-muted"
            style={{ left: `${Math.min(100, Math.max(0, peerPct))}%` }}
            aria-hidden
          />
        )}
      </div>
      <p className="text-caption text-text-subtle">Weight {max}% of composite</p>
      {counts && (
        <p className="text-caption text-text-subtle">
          {counts.silentCount} went quiet, {counts.reEngagedCount} brought back
        </p>
      )}
    </div>
  );
}

export function PersistenceSubComponents({
  rows, footnote,
}: {
  rows: {
    key: string;
    label: string;
    points: number | null;
    max: number;
    peerPct: number | null;
    counts?: ReEngagementCounts | null;
  }[];
  footnote?: string;
}) {
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-3">
        <span className="text-body-sm font-medium text-text-default">Where your score comes from</span>
        <div className="grid gap-3 sm:grid-cols-3">
          {rows.map((r) => (
            <ComponentCard key={r.key} label={r.label} points={r.points} max={r.max} peerPct={r.peerPct} counts={r.counts} />
          ))}
        </div>
        {footnote && <p className="text-caption text-text-subtle">{footnote}</p>}
      </div>
    </Card>
  );
}

export default PersistenceSubComponents;
