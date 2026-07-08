/**
 * DiscoverMeetingBanner — calendar-aware header for the "find near me"
 * discover view.
 *
 * Pure/dumb presentational read: given the rep's next fixed meeting and the
 * current time, it renders a single accent-violet banner with the meeting
 * title, its local start time, and a minutes-until-start estimate. Tokens
 * mirror RunScheduleOverlay's next-meeting banner so the two calendar reads
 * match. No hooks, no network — the live wiring lands in a later task.
 */
import { CalendarClock } from "lucide-react";
import type { NextMeeting } from "../lib/discoverFit";

interface Props {
  meeting: NextMeeting | null;
  now: string;
}

/** Local-tz clock time, e.g. "1:00 PM". */
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function DiscoverMeetingBanner({ meeting, now }: Props) {
  if (!meeting) return null;
  const minsUntil = Math.max(0, Math.round((Date.parse(meeting.start) - Date.parse(now)) / 60000));
  return (
    <div className="flex items-center gap-2 rounded-radius-md border border-accent-violet/40 bg-accent-violet-20 px-3 py-2 text-body-sm text-accent-violet">
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
      <span>{`~${minsUntil} min until ${meeting.title} (${fmtTime(meeting.start)})`}</span>
    </div>
  );
}

export default DiscoverMeetingBanner;
