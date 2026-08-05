/**
 * taskBands — derive a Task's three band dates from a follow-up interval.
 *
 * Only `target_at` is ever shown to the rep. `earliest_at`/`latest_at` exist so
 * the Path route optimizer (SP3) can place location-bound follow-ups
 * opportunistically; nothing reads them in SP1. All arithmetic is in business
 * days, matching the Create-task form and the disposition interval map.
 *
 *   Lead slack  = 40% of the interval, capped at 5 business days, 0 when interval <= 2.
 *   Trail slack = the interval, capped at 10 business days.
 */
import { addBusinessDays, format, parseISO } from "date-fns";

export interface Bands {
  earliest_at: string;
  target_at: string;
  latest_at: string;
}

/** Returns the three band dates, or null when the interval is null (no follow-up). */
export function deriveBands(startISO: string, intervalBusinessDays: number | null): Bands | null {
  if (intervalBusinessDays == null) return null;
  const start = parseISO(startISO.slice(0, 10));
  const lead = intervalBusinessDays <= 2 ? 0 : Math.min(5, Math.round(intervalBusinessDays * 0.4));
  const trail = Math.min(10, intervalBusinessDays);
  const target = addBusinessDays(start, intervalBusinessDays);
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  return {
    earliest_at: fmt(addBusinessDays(target, -lead)),
    target_at: fmt(target),
    latest_at: fmt(addBusinessDays(target, trail)),
  };
}
