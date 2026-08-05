/**
 * OwedVisitsList (SP3 T5) — the "Owed visits" group at the top of Find-Near-Me.
 *
 * The drop-in follow-ups a rep owes today (open drop-in Tasks with coordinates),
 * surfaced ABOVE cold discovery so a due account outranks a stranger. This group
 * is filter-exempt (industry/radius chips don't apply to work you already owe)
 * but still honours the same next-meeting feasibility flag the cold list uses.
 *
 * Presentational only: the parent (PathPage) assembles + distance-annotates +
 * fit-flags the rows and decides what a tap does (open the deal to log the visit).
 */
import { ChevronRight, DoorOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, ListRow } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import type { BandPosition } from "../lib/classD";
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
  /** e.g. "won't fit before 12:00 PM" — shown on rows where `fits` is false. */
  unfitLabel?: string;
  onSelect: (v: OwedVisit) => void;
}

/** Band → short badge label + tone. not_yet_open never reaches this group
 *  (eligibility requires the window to have opened). */
const BAND_BADGE: Record<BandPosition, { label: string; className: string }> = {
  pinned: { label: "Promised", className: "bg-accent-violet-20 text-accent-violet" },
  aging: { label: "Aging", className: "bg-status-danger-bg text-status-danger" },
  past_ideal: { label: "Overdue", className: "bg-status-warning-bg text-status-warning" },
  in_window: { label: "Due", className: "bg-status-info-bg text-status-info" },
  not_yet_open: { label: "Upcoming", className: "bg-surface-sunken text-text-muted" },
};

/** "not_available" → "No answer" reads oddly; a plain de-snake is honest and
 *  robust across the whole disposition vocabulary. Null → generic label. */
function fromOutcomeLabel(outcome: string | null): string {
  if (!outcome) return "follow-up";
  return outcome.replace(/^appt_/, "").replace(/_/g, " ");
}

function BandBadge({ band }: { band: BandPosition }) {
  const b = BAND_BADGE[band];
  return (
    <span className={cn("inline-flex items-center rounded-radius-full px-2 py-0.5 text-caption font-medium", b.className)}>
      {b.label}
    </span>
  );
}

export function OwedVisitsList({ visits, unfitLabel, onSelect }: OwedVisitsListProps) {
  if (visits.length === 0) return null;
  return (
    <Card padding="sm" className="mt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-body-strong text-text-default">Owed visits</p>
        <span className="text-caption text-text-muted">{visits.length} nearby · call ahead, hours unknown</span>
      </div>
      {visits.map((v) => {
        const distance = Number.isFinite(v.distanceMeters) ? formatDistance(v.distanceMeters) : null;
        const subtitleParts = [`from ${fromOutcomeLabel(v.sourceOutcome)}`];
        if (distance) subtitleParts.push(distance);
        if (!v.fits && unfitLabel) subtitleParts.push(unfitLabel);
        return (
          <ListRow
            key={v.taskId}
            onClick={() => onSelect(v)}
            leading={
              <span className="flex h-9 w-9 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
                <DoorOpen className="h-4 w-4" aria-hidden />
              </span>
            }
            title={v.name}
            subtitle={
              <span className={cn(!v.fits && "text-status-warning")}>{subtitleParts.join(" · ")}</span>
            }
            trailing={
              <span className="flex items-center gap-2">
                <BandBadge band={v.bandPosition} />
                <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />
              </span>
            }
          />
        );
      })}
    </Card>
  );
}

export default OwedVisitsList;
