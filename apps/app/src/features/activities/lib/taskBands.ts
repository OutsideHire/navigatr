/**
 * taskBands — derive a Task's three band dates.
 *
 * Only `target_at` is ever shown to the rep. `earliest_at`/`latest_at` exist so
 * the Path route optimizer (SP3) can place location-bound follow-ups
 * opportunistically; nothing reads them in SP1. All arithmetic is in business
 * days, matching the disposition interval map and the Create-task form.
 *
 *   Lead slack  = 40% of the interval, capped at 5 business days, 0 when interval <= 2.
 *   Trail slack = the interval, capped at 10 business days.
 *
 * `bandsFromTarget` is the core primitive: given the target date (e.g. the
 * follow-up date already stored on the activity) and the interval, it derives
 * the slack around it. This is what keeps a generated task's target byte-equal
 * to `activities.follow_up_date` (the score-stability contract). `deriveBands`
 * is the convenience form for when you have a start date + interval instead.
 */
import { addBusinessDays, format, parseISO } from "date-fns";

export interface Bands {
  earliest_at: string;
  target_at: string;
  latest_at: string;
}

function slack(intervalBusinessDays: number): { lead: number; trail: number } {
  const lead = intervalBusinessDays <= 2 ? 0 : Math.min(5, Math.round(intervalBusinessDays * 0.4));
  const trail = Math.min(10, intervalBusinessDays);
  return { lead, trail };
}

/** Bands around an explicit target date. Returns null when either input is missing. */
export function bandsFromTarget(targetISO: string | null, intervalBusinessDays: number | null): Bands | null {
  if (!targetISO || intervalBusinessDays == null) return null;
  const target = parseISO(targetISO.slice(0, 10));
  const { lead, trail } = slack(intervalBusinessDays);
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  return {
    earliest_at: fmt(addBusinessDays(target, -lead)),
    target_at: fmt(target),
    latest_at: fmt(addBusinessDays(target, trail)),
  };
}

/** Bands from a start date + interval: target = start + interval business days. */
export function deriveBands(startISO: string, intervalBusinessDays: number | null): Bands | null {
  if (intervalBusinessDays == null) return null;
  const target = addBusinessDays(parseISO(startISO.slice(0, 10)), intervalBusinessDays);
  return bandsFromTarget(format(target, "yyyy-MM-dd"), intervalBusinessDays);
}
