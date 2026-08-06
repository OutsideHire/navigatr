/**
 * OwedTimedStops (Screen Content Spec §6, item 2) — owed drop-in follow-ups as
 * TIMED stops on the Path/Stops view. Distinct from the Find-Near-Me group
 * (OwedVisitsList), which is distance-ranked: here each stop carries an
 * APPROXIMATE arrival ("around 11:20 AM", never an exact promise) computed by
 * the placement layer, plus band, generating outcome + age, and an
 * hours-unknown reminder. Spilled visits (couldn't fit today) get a one-tap
 * snooze. Presentational only.
 */
import { ChevronRight, DoorOpen } from "lucide-react";
import { Button, Card, ListRow } from "@/components/navigatr";
import { BandBadge } from "../lib/bandBadge";
import type { OwedVisit } from "../lib/owedVisits";

export interface OwedTimedRow {
  visit: OwedVisit;
  aroundIso: string;
}

export interface OwedTimedStopsProps {
  placed: OwedTimedRow[];
  spilled: OwedVisit[];
  /** Why the spilled visits didn't fit (e.g. "won't fit before 3:30 PM"). */
  spillReason?: string;
  onSelect: (v: OwedVisit) => void;
  onSnooze: (v: OwedVisit) => void;
}

function fromOutcomeLabel(outcome: string | null): string {
  if (!outcome) return "follow-up";
  return outcome.replace(/^appt_/, "").replace(/_/g, " ");
}

function ageLabel(iso: string): string {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return "1y+ ago";
}

/** Approximate arrival, never exact — the word carries the "computed slot, not a
 *  promise" distinction. */
function formatAround(iso: string): string {
  return `around ${new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function DropInIcon() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
      <DoorOpen className="h-4 w-4" aria-hidden />
    </span>
  );
}

export function OwedTimedStops({ placed, spilled, spillReason, onSelect, onSnooze }: OwedTimedStopsProps) {
  if (placed.length === 0 && spilled.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {placed.length > 0 && (
        <Card padding="sm" className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-body-strong text-text-default">Owed visits</p>
            <span className="text-caption text-text-muted">{placed.length} today · call ahead, hours unknown</span>
          </div>
          {placed.map(({ visit: v, aroundIso }) => (
            <ListRow
              key={v.taskId}
              onClick={() => onSelect(v)}
              leading={<DropInIcon />}
              title={
                <span className="tabular-nums">
                  <span className="text-text-muted">{formatAround(aroundIso)}</span> · {v.name}
                </span>
              }
              subtitle={`from ${fromOutcomeLabel(v.sourceOutcome)}, ${ageLabel(v.createdAt)}`}
              trailing={
                <span className="flex items-center gap-2">
                  <BandBadge band={v.bandPosition} />
                  <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />
                </span>
              }
            />
          ))}
        </Card>
      )}

      {spilled.length > 0 && (
        <Card padding="sm" className="flex flex-col gap-1 border-status-warning/30">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-body-strong text-text-default">Couldn&apos;t fit today</p>
            <span className="text-caption text-status-warning">{spillReason || `${spilled.length} owed`}</span>
          </div>
          {spilled.map((v) => (
            <div key={v.taskId} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ListRow
                  onClick={() => onSelect(v)}
                  leading={<DropInIcon />}
                  title={v.name}
                  subtitle={`from ${fromOutcomeLabel(v.sourceOutcome)}, ${ageLabel(v.createdAt)}`}
                  trailing={<BandBadge band={v.bandPosition} />}
                />
              </div>
              <Button variant="tertiary" size="sm" onClick={() => onSnooze(v)}>
                Snooze
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export default OwedTimedStops;
