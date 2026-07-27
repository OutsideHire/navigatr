/**
 * PersistenceSubComponents: the "where your score comes from" breakdown for
 * the Persistence Index detail page. Renders one row per descriptor passed in
 * (Follow-Up Discipline, Touch Cadence, Re-engagement After Silence), each
 * with a peer-average tick when available.
 */
import { Card } from "@/components/navigatr";

/** Eligible/recovered counts for the Re-engagement After Silence row (addendum):
 *  how many deals went quiet in the window vs. how many got a later touch. */
export interface ReEngagementCounts {
  silentCount: number;
  reEngagedCount: number;
}

function Row({
  label, points, max, peerPct, counts,
}: {
  label: string; points: number | null; max: number; peerPct: number | null; counts?: ReEngagementCounts | null;
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
      {counts && (
        <p className="mt-1 text-caption text-text-subtle">
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
      <div className="flex flex-col gap-4">
        <span className="text-body-sm font-medium text-text-default">Where your score comes from</span>
        {rows.map((r) => (
          <Row key={r.key} label={r.label} points={r.points} max={r.max} peerPct={r.peerPct} counts={r.counts} />
        ))}
        {footnote && <p className="text-caption text-text-subtle">{footnote}</p>}
      </div>
    </Card>
  );
}

export default PersistenceSubComponents;
