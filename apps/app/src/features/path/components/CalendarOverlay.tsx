/**
 * CalendarOverlay — Calendar-Aware Path (Slice 1) presentational overlay.
 *
 * Pure/dumb: PathPage owns the day window + the useCalendarEvents fetch and
 * hands us the derived waypoints, unmappable time-blocks, and free windows. We
 * render the day as a single chronological read so a rep planning a route sees
 * their meetings as fixed waypoints and the gaps they can fill with drop-ins.
 *
 * EPHEMERAL: nothing here persists or edits the running path — waypoints are
 * read-only ("edit the meeting to change it"). Calendar failures degrade to a
 * gentle (re)connect nudge, never a blocking error.
 *
 * Color: calendar waypoints wear the palette's purple (accent-violet) so they
 * read as calendar-owned, distinct from the blue route/merchant pins.
 */
import * as React from "react";
import { CalendarClock, CalendarOff, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  CalendarStatus,
  CalendarTimeBlock,
  CalendarWaypoint,
} from "../hooks/useCalendarEvents";
import type { Interval } from "../lib/freeWindows";

export interface CalendarOverlayProps {
  waypoints: CalendarWaypoint[];
  timeBlocks: CalendarTimeBlock[];
  freeWindows: Interval[];
  status: CalendarStatus;
  onRefresh: () => void;
}

/** Local-tz clock time, e.g. "10:00 AM". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Human duration for a free window, e.g. "4h 30m", "45m", "2h". */
function fmtDuration(startISO: string, endISO: string): string {
  const mins = Math.max(0, Math.round((Date.parse(endISO) - Date.parse(startISO)) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const SETTINGS_INTEGRATIONS = "/settings/integrations";

type Row =
  | { kind: "waypoint"; start: number; data: CalendarWaypoint }
  | { kind: "block"; start: number; data: CalendarTimeBlock }
  | { kind: "free"; start: number; data: Interval };

export function CalendarOverlay({
  waypoints,
  timeBlocks,
  freeWindows,
  status,
  onRefresh,
}: CalendarOverlayProps) {
  // Merge the three kinds into one chronological list so it reads as the day.
  const rows = React.useMemo<Row[]>(() => {
    const merged: Row[] = [
      ...waypoints.map((w): Row => ({ kind: "waypoint", start: Date.parse(w.start), data: w })),
      ...timeBlocks.map((b): Row => ({ kind: "block", start: Date.parse(b.start), data: b })),
      ...freeWindows.map((f): Row => ({ kind: "free", start: Date.parse(f.start), data: f })),
    ];
    return merged.sort((a, b) => a.start - b.start);
  }, [waypoints, timeBlocks, freeWindows]);

  // Not connected: a single subtle hint, nothing else.
  if (status === "not_connected") {
    return (
      <p className="text-caption text-text-muted">
        <a
          href={SETTINGS_INTEGRATIONS}
          className="font-medium text-brand-primary underline-offset-2 hover:underline"
        >
          Connect your calendar
        </a>{" "}
        to build around your meetings.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-radius-md border border-border-default bg-surface-sunken/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium text-text-muted">Your day</span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded-radius-sm px-2 py-1 text-caption font-medium text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh calendar
        </button>
      </div>

      {status === "needs_reconnect" && (
        <p className="text-caption text-text-muted">
          <a
            href={SETTINGS_INTEGRATIONS}
            className="font-medium text-status-warning underline-offset-2 hover:underline"
          >
            Reconnect your calendar
          </a>{" "}
          to keep meetings in view.
        </p>
      )}

      {rows.map((row) => {
        if (row.kind === "waypoint") return <WaypointCard key={`w-${row.data.id}`} w={row.data} />;
        if (row.kind === "block") return <TimeBlockCard key={`b-${row.data.id}`} b={row.data} />;
        return <FreeWindowRow key={`f-${row.data.start}`} f={row.data} />;
      })}
    </div>
  );
}

/** A mappable calendar appointment — read-only, purple, "From calendar". */
function WaypointCard({ w }: { w: CalendarWaypoint }) {
  return (
    <div
      title="This stop is on your calendar. To change it, edit the meeting."
      className="flex items-start gap-3 rounded-radius-md border border-accent-violet/40 bg-accent-violet-20 p-3"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
        <CalendarClock className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-md font-medium text-text-default">{w.title}</p>
          <span className="shrink-0 text-caption tabular-nums text-accent-violet">{fmtTime(w.start)}</span>
        </div>
        {w.address && <p className="truncate text-caption text-text-muted">{w.address}</p>}
        <span className="mt-1 inline-flex items-center rounded-radius-full bg-accent-violet-20 px-2 py-0.5 text-caption font-medium text-accent-violet">
          From calendar
        </span>
      </div>
    </div>
  );
}

/** A calendar event with no mappable location — faded, calendar-off styling. */
function TimeBlockCard({ b }: { b: CalendarTimeBlock }) {
  return (
    <div className="flex items-start gap-3 rounded-radius-md border border-dashed border-border-default bg-surface-sunken/60 p-3 opacity-70">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <CalendarOff className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-md text-text-default">{b.title}</p>
          <span className="shrink-0 text-caption tabular-nums text-text-muted">{fmtTime(b.start)}</span>
        </div>
        <p className="text-caption text-text-muted">Meeting (no location)</p>
      </div>
    </div>
  );
}

/** A gap between occupied spans the rep can fill with drop-ins. */
function FreeWindowRow({ f }: { f: Interval }) {
  return (
    <div className={cn("flex items-center gap-2 px-1 py-1.5 text-caption text-text-muted")}>
      <span className="h-px flex-1 bg-border-default" aria-hidden />
      <span className="shrink-0 tabular-nums">
        {fmtTime(f.start)}–{fmtTime(f.end)} · {fmtDuration(f.start, f.end)} free
      </span>
      <span className="h-px flex-1 bg-border-default" aria-hidden />
    </div>
  );
}

export default CalendarOverlay;
