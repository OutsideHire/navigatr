/**
 * PathTimeline — Route-around optimizer (Slice 1, plan RO3) presentational read.
 *
 * Pure/dumb: renders a `ScheduleResult` from `scheduleDay` as one chronological
 * day. `scheduleDay` already hands us names + labeled times on every entry, so
 * there's no name map, no hooks, no network — just formatting in the rep's
 * local timezone.
 *
 * Three row kinds, in `result.timeline` order:
 *   prospect  — a drop-in the optimizer packed in: arrive time, name, dwell.
 *   waypoint  — a fixed calendar meeting (mappable): purple (accent-violet),
 *               tagged "Meeting", mirroring CalendarOverlay's WaypointCard.
 *   timeblock — a calendar hold with no location: faded, "Meeting (no location)".
 *
 * Above the list, a warning banner surfaces feasibility conflicts (two fixed
 * meetings too close to drive between). Below it, a muted note counts the
 * prospects that couldn't fit the day. Fully empty result → render nothing.
 *
 * Every time here is a labeled ESTIMATE, not a promise (see scheduleDay).
 */
import { CalendarClock, CalendarOff, MapPin, TriangleAlert } from "lucide-react";

import type { ScheduleResult, TimelineEntry } from "../lib/scheduleDay";

export interface PathTimelineProps {
  result: ScheduleResult;
}

/** Local-tz clock time, e.g. "10:00 AM". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Whole-minute dwell between arrive and depart, e.g. "20 min". */
function fmtDwell(arriveIso: string, departIso: string): string {
  const mins = Math.round((Date.parse(departIso) - Date.parse(arriveIso)) / 60000);
  return `${mins} min`;
}

export function PathTimeline({ result }: PathTimelineProps) {
  const { timeline, conflicts, unscheduledProspectIds } = result;

  // Fully empty → render nothing intrusive.
  if (timeline.length === 0 && conflicts.length === 0 && unscheduledProspectIds.length === 0) {
    return null;
  }

  const unscheduledCount = unscheduledProspectIds.length;

  return (
    <div className="flex flex-col gap-2">
      {conflicts.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-radius-md border border-status-warning/40 bg-status-warning-bg p-3"
        >
          <span className="mt-0.5 shrink-0 text-status-warning">
            <TriangleAlert className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            {conflicts.map((c, i) => (
              <p key={i} className="text-caption text-text-default">
                <span className="font-medium">
                  {c.betweenTitles[0]} and {c.betweenTitles[1]}
                </span>{" "}
                are too close together — {c.detail}.
              </p>
            ))}
          </div>
        </div>
      )}

      {timeline.map((entry) => (
        <TimelineRow key={rowKey(entry)} entry={entry} />
      ))}

      {unscheduledCount > 0 && (
        <p className="text-caption text-text-muted">
          <span className="font-medium">
            {unscheduledCount} {unscheduledCount === 1 ? "prospect" : "prospects"}
          </span>{" "}
          couldn&apos;t fit today.
        </p>
      )}
    </div>
  );
}

function rowKey(entry: TimelineEntry): string {
  return `${entry.kind}-${entry.id}`;
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "prospect") return <ProspectRow entry={entry} />;
  if (entry.kind === "waypoint") return <WaypointRow entry={entry} />;
  return <TimeBlockRow entry={entry} />;
}

/** A drop-in the optimizer packed in: arrive time, name, and dwell estimate. */
function ProspectRow({ entry }: { entry: Extract<TimelineEntry, { kind: "prospect" }> }) {
  return (
    <div className="flex items-start gap-3 rounded-radius-md border border-border-default bg-surface-default p-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary/10 text-brand-primary">
        <MapPin className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-md font-medium text-text-default">{entry.name}</p>
          <span className="shrink-0 text-caption tabular-nums text-text-muted">
            {fmtTime(entry.arrive)}
          </span>
        </div>
        <p className="text-caption text-text-muted">{fmtDwell(entry.arrive, entry.depart)}</p>
      </div>
    </div>
  );
}

/** A fixed calendar meeting (mappable) — purple, tagged "Meeting". */
function WaypointRow({ entry }: { entry: Extract<TimelineEntry, { kind: "waypoint" }> }) {
  return (
    <div className="flex items-start gap-3 rounded-radius-md border border-accent-violet/40 bg-accent-violet-20 p-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
        <CalendarClock className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-md font-medium text-text-default">{entry.title}</p>
          <span className="shrink-0 text-caption tabular-nums text-accent-violet">
            {fmtTime(entry.start)}
          </span>
        </div>
        <span className="mt-1 inline-flex items-center rounded-radius-full bg-accent-violet-20 px-2 py-0.5 text-caption font-medium text-accent-violet">
          Meeting
        </span>
      </div>
    </div>
  );
}

/** A calendar hold with no location — faded, "Meeting (no location)". */
function TimeBlockRow({ entry }: { entry: Extract<TimelineEntry, { kind: "timeblock" }> }) {
  return (
    <div className="flex items-start gap-3 rounded-radius-md border border-dashed border-border-default bg-surface-sunken/60 p-3 opacity-70">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <CalendarOff className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-md text-text-default">{entry.title}</p>
          <span className="shrink-0 text-caption tabular-nums text-text-muted">
            {fmtTime(entry.start)}
          </span>
        </div>
        <p className="text-caption text-text-muted">Meeting (no location)</p>
      </div>
    </div>
  );
}

export default PathTimeline;
