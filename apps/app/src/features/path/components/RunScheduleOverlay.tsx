/**
 * RunScheduleOverlay — Route-around optimizer (Slice 2) presentational read.
 *
 * Pure/dumb: renders the current-stop schedule annotation produced by
 * `annotateRunSchedule` (S1) for the Run tab — an arrival-ETA line, a purple
 * next-meeting banner, and a warning when the current stop won't fit before the
 * next fixed meeting. No hooks, no network — just formatting in the rep's local
 * timezone. Tokens mirror PathTimeline's calendar (accent-violet) and warning
 * (status-warning) rows so the two reads match.
 *
 * Every time here is a labeled ESTIMATE, not a promise (see annotateRunSchedule).
 */
import { CalendarClock, TriangleAlert } from "lucide-react";

interface NextMeeting {
  title: string;
  start: string;
  located: boolean;
}

interface Props {
  arrive: string | null;
  dwellMin: number;
  currentStopName: string;
  nextMeeting: NextMeeting | null;
  stopsUntilNextMeeting: number;
  fits: boolean;
}

/** Local-tz clock time, e.g. "10:00 AM". */
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function RunScheduleOverlay({
  arrive,
  dwellMin,
  currentStopName,
  nextMeeting,
  stopsUntilNextMeeting,
  fits,
}: Props) {
  // Nothing to say → render nothing intrusive.
  if (!arrive && !nextMeeting) return null;

  return (
    <div className="flex flex-col gap-2">
      {arrive && (
        <p className="text-caption text-text-muted">
          arrive ~{fmtTime(arrive)} · {dwellMin} min
        </p>
      )}

      {nextMeeting && (
        <div className="flex items-center gap-2 rounded-radius-md border border-accent-violet/40 bg-accent-violet-20 px-3 py-2 text-body-sm text-accent-violet">
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {`${nextMeeting.title} · ${fmtTime(nextMeeting.start)}`}
            {nextMeeting.located ? "" : " (no location)"}
            {stopsUntilNextMeeting > 0
              ? ` — ${stopsUntilNextMeeting} stop${stopsUntilNextMeeting === 1 ? "" : "s"} to go`
              : ""}
          </span>
        </div>
      )}

      {nextMeeting && !fits && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-radius-md border border-status-warning/40 bg-status-warning-bg px-3 py-2 text-caption text-text-default"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
          <span>
            {`${currentStopName} won't fit before your ${nextMeeting.title} at ${fmtTime(nextMeeting.start)}.`}
          </span>
        </div>
      )}
    </div>
  );
}

export default RunScheduleOverlay;
