/**
 * calendarDate — the app's single tz-stable convention for *calendar dates*.
 *
 * A "calendar date" (a follow-up day, a deal's expected-close day) is a day
 * with no meaningful time-of-day. The whole family of timezone off-by-one
 * bugs in this codebase came from mixing "calendar date" with "instant":
 * turning a date into a UTC-midnight instant and then rendering or comparing
 * it in local time. For anyone west of UTC (the entire US market) that reads
 * back as the previous day.
 *
 * The convention, applied everywhere a calendar date is stored/compared/shown:
 *
 *  1. When a calendar date must live in a timestamp column / ISO string, store
 *     it at NOON UTC of that day (`dateOnlyToNoonUtcIso`), and always READ it
 *     back by its UTC calendar day — slice it (`toUtcDateOnly`) or render it
 *     with `timeZone:'UTC'` (`formatCalendarDate`). Rendered in the viewer's
 *     LOCAL time the displayed day drifts (a day early west of UTC, a day late
 *     at +12); rendered in UTC it equals the stored calendar day for every
 *     viewer.
 *  2. When it is a plain DATE value, keep it as a `YYYY-MM-DD` string.
 *  3. When comparing "is this due today", compare calendar DAYS, not instants:
 *     the rep's LOCAL today (`toDateOnly(now)`) against the stored date's
 *     calendar day (`toUtcDateOnly` of its instant — its UTC y/m/d IS the
 *     intended date). `calendarDayDelta` does exactly this and is shared by
 *     the notification bell and the Activities list so they always agree.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * LOCAL calendar day of an instant, as "YYYY-MM-DD".
 * Use this for "today" — the rep's wall-clock day.
 */
export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * UTC calendar day of an instant, as "YYYY-MM-DD".
 * For a value stored at noon (or midnight) UTC of a calendar day, this returns
 * that calendar day in every timezone — the tz-stable way to read a stored
 * calendar date back out of its instant.
 */
export function toUtcDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Render a stored calendar date as short "Mon Day" (e.g. "Jul 9") on its UTC
 * calendar day, so every viewer sees the intended day regardless of their local
 * timezone. Use for calendar-date fields (follow-up day, expected-close day) —
 * NOT for true instants like `occurred_at`/`created_at`, where the viewer's
 * local time-of-day is the point. Robust to both DB representations of these
 * fields (midnight-UTC from the denorm trigger, noon-UTC from client writes):
 * both share the same UTC calendar day.
 */
export function formatCalendarDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "YYYY-MM-DD" (or any ISO string whose first 10 chars are the date) → an ISO
 * instant at NOON UTC of that calendar day, e.g. "2026-07-09T12:00:00.000Z".
 */
export function dateOnlyToNoonUtcIso(dateOnly: string): string {
  const day = dateOnly.slice(0, 10);
  if (!DATE_ONLY_RE.test(day)) {
    throw new Error(
      `dateOnlyToNoonUtcIso: expected a YYYY-MM-DD date, got "${dateOnly}"`,
    );
  }
  return `${day}T12:00:00.000Z`;
}

/** Whole-day difference (b - a) between two "YYYY-MM-DD" strings. tz-free. */
export function diffCalendarDays(a: string, b: string): number {
  return Math.round((epochUtcDay(b) - epochUtcDay(a)) / 86_400_000);
}

function epochUtcDay(dateOnly: string): number {
  const [y, m, d] = dateOnly.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole-day delta from the rep's local "today" to a stored calendar date:
 * negative = overdue, 0 = due today, positive = future.
 *
 * `now` is a live instant whose LOCAL day is "today"; `calendarInstant` is a
 * calendar date stored at noon/midnight UTC whose UTC day is the intended
 * date. Deliberately asymmetric: the "today" side is local (so the day flips
 * at the rep's midnight, not UTC's) and the stored-date side is read by its
 * UTC calendar day (so it never drifts when interpreted in a negative-UTC
 * timezone). Both the bell and the Activities list call this so a task lands
 * on the same day in both places.
 */
export function calendarDayDelta(now: Date, calendarInstant: Date): number {
  return diffCalendarDays(toDateOnly(now), toUtcDateOnly(calendarInstant));
}
