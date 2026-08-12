/**
 * FollowupChip: a small, explicitly-labeled "Follow up: {date}" indicator.
 *
 * A deal's follow-up day lives in `next_followup_at` (surfaced as
 * `deal.nextFollowup`). The `sync_followup` Edge fn mirrors it to an all-day
 * calendar event titled "Follow up: {company}", but until now the app never
 * used that language on screen: the card footer framed the date as the stage's
 * next-step verb and the detail hero labeled it "EXPECTED CLOSE". Reps set a
 * follow-up and looked in vain for a "Follow up:" indicator.
 *
 * This renders that indicator in one place, reused by the deal card and the
 * deal detail hero. Renders nothing when no follow-up date is set. Uses the
 * shared tz-stable `formatCalendarDate` so the day never drifts by timezone.
 */

import { Calendar } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@/lib/calendarDate";

export function FollowupChip({
  date,
  className,
}: {
  date: string | null | undefined;
  className?: string;
}) {
  if (!date) return null;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-muted",
        className,
      )}
    >
      <Calendar className="h-3 w-3 shrink-0" aria-hidden />
      Follow up: <span className="tabular-nums text-text-default">{formatCalendarDate(date)}</span>
    </span>
  );
}

export default FollowupChip;
