/**
 * OwedVisitsList (SP3 T5 + Phase 2 P2.2) — the "Owed visits" group at the top of
 * Find-Near-Me.
 *
 * The drop-in follow-ups a rep owes today (open drop-in Tasks with coordinates),
 * surfaced ABOVE cold discovery so a due account outranks a stranger. Two groups:
 *   - "Owed visits": the ones a drop-in still fits before the next meeting.
 *   - "Couldn't fit today": the ones that won't, each with a one-tap Snooze so
 *     they don't just drop off silently.
 * Filter-exempt (industry/radius chips don't apply to work you already owe).
 *
 * Presentational only: the parent (PathPage) assembles + distance-annotates +
 * fit-flags the rows and decides what a tap / snooze does.
 */
import { ChevronRight, DoorOpen } from "lucide-react";
import { Button, Card, ListRow } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import { BandBadge } from "../lib/bandBadge";
import type { OwedVisit } from "../lib/owedVisits";

/** One owed visit as the list renders it: the assembled candidate + its distance
 *  from the rep and whether a drop-in still fits before the next fixed meeting. */
export interface OwedVisitRow extends OwedVisit {
  distanceMeters: number;
  /** false → a drop-in here wouldn't finish before the next meeting today. */
  fits: boolean;
}

export interface OwedVisitsListProps {
  visits: OwedVisitRow[];
  /** e.g. "won't fit before 12:00 PM" — the reason for the spill group. */
  unfitLabel?: string;
  onSelect: (v: OwedVisit) => void;
  /** Snooze a spilled visit forward (one tap). When omitted, no snooze button. */
  onSnooze?: (v: OwedVisit) => void;
}

/** "not_available" → "No answer" reads oddly; a plain de-snake is honest and
 *  robust across the whole disposition vocabulary. Null → generic label. */
function fromOutcomeLabel(outcome: string | null): string {
  if (!outcome) return "follow-up";
  return outcome.replace(/^appt_/, "").replace(/_/g, " ");
}

function OwedRow({
  v,
  onSelect,
  onSnooze,
}: {
  v: OwedVisitRow;
  onSelect: (v: OwedVisit) => void;
  onSnooze?: (v: OwedVisit) => void;
}) {
  const distance = Number.isFinite(v.distanceMeters) ? formatDistance(v.distanceMeters) : null;
  const subtitleParts = [`from ${fromOutcomeLabel(v.sourceOutcome)}`];
  if (distance) subtitleParts.push(distance);
  const row = (
    <ListRow
      onClick={() => onSelect(v)}
      leading={
        <span className="flex h-9 w-9 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
          <DoorOpen className="h-4 w-4" aria-hidden />
        </span>
      }
      title={v.name}
      subtitle={subtitleParts.join(" · ")}
      trailing={
        <span className="flex items-center gap-2">
          <BandBadge band={v.bandPosition} />
          {!onSnooze && <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />}
        </span>
      }
    />
  );
  // The Snooze control is a SIBLING of the row, never nested inside it (the row
  // is itself a button; a button-in-a-button is invalid DOM).
  if (!onSnooze) return row;
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      <Button variant="tertiary" size="sm" onClick={() => onSnooze(v)}>
        Snooze
      </Button>
    </div>
  );
}

export function OwedVisitsList({ visits, unfitLabel, onSelect, onSnooze }: OwedVisitsListProps) {
  const fitting = visits.filter((v) => v.fits);
  const spill = visits.filter((v) => !v.fits);
  if (fitting.length === 0 && spill.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {fitting.length > 0 && (
        <Card padding="sm" className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-body-strong text-text-default">Owed visits</p>
            <span className="text-caption text-text-muted">{fitting.length} nearby · call ahead, hours unknown</span>
          </div>
          {fitting.map((v) => (
            <OwedRow key={v.taskId} v={v} onSelect={onSelect} />
          ))}
        </Card>
      )}

      {spill.length > 0 && (
        <Card padding="sm" className="flex flex-col gap-1 border-status-warning/30">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-body-strong text-text-default">Couldn&apos;t fit today</p>
            <span className="text-caption text-status-warning">{unfitLabel || `${spill.length} owed`}</span>
          </div>
          {spill.map((v) => (
            <OwedRow key={v.taskId} v={v} onSelect={onSelect} onSnooze={onSnooze} />
          ))}
        </Card>
      )}
    </div>
  );
}

export default OwedVisitsList;
