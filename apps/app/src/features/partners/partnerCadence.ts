/**
 * partnerCadence — pure follow-up-cadence logic for partners. No React /
 * Supabase imports so it stays trivially testable.
 *
 * "Due" = (last touch, or created-at if never touched) + cadence days,
 * compared to today in the rep's LOCAL day via the shared calendarDayDelta
 * (same day-math the bell uses, so the chip and the bell never disagree).
 */

import { calendarDayDelta, toDateOnly, dateOnlyToNoonUtcIso } from "@/lib/calendarDate";

export type CadenceState = "none" | "upcoming" | "due-today" | "overdue";

export interface CadenceStatus {
  /** A positive cadence is set. */
  hasCadence: boolean;
  /** ISO instant the follow-up is due (anchor + cadence), or null. */
  dueAt: string | null;
  state: CadenceState;
  /** Whole days past due; 0 unless overdue. */
  daysOverdue: number;
  /** Whole days until due; 0 unless upcoming (or due today). */
  daysUntilDue: number;
}

export interface CadenceInput {
  followupCadenceDays: number | null | undefined;
  lastTouch: string | null | undefined;
  createdAt: string | null | undefined;
}

export function computeCadenceStatus(input: CadenceInput, now: Date = new Date()): CadenceStatus {
  const cadence = input.followupCadenceDays ?? 0;
  const hasCadence = cadence > 0;
  const anchor = input.lastTouch ?? input.createdAt ?? null;

  if (!hasCadence || !anchor) {
    return { hasCadence, dueAt: null, state: "none", daysOverdue: 0, daysUntilDue: 0 };
  }

  // The anchor is a true instant (last_touch_at / created_at). Take its
  // rep-LOCAL calendar day, add cadence days as pure calendar days, and store
  // the due date at NOON UTC — the app's calendar-date convention. Adding days
  // to the raw instant and reading its UTC day would drift a day for evening
  // touches west of UTC (the whole US market).
  const anchorDay = toDateOnly(new Date(anchor)); // rep-local YYYY-MM-DD
  const dueDay = new Date(`${anchorDay}T00:00:00Z`);
  dueDay.setUTCDate(dueDay.getUTCDate() + cadence);
  const dueAt = dateOnlyToNoonUtcIso(dueDay.toISOString());

  const delta = calendarDayDelta(now, new Date(dueAt)); // >0 future, 0 today, <0 overdue
  const state: CadenceState = delta > 0 ? "upcoming" : delta === 0 ? "due-today" : "overdue";

  return {
    hasCadence: true,
    dueAt,
    state,
    daysOverdue: delta < 0 ? -delta : 0,
    daysUntilDue: delta > 0 ? delta : 0,
  };
}

/** "Every 30 days" — or "" when no cadence. */
export function formatCadence(days: number | null | undefined): string {
  return days && days > 0 ? `Every ${days} days` : "";
}

/** Chip text for the actionable states, null otherwise (list + detail chips). */
export function cadenceSignalLabel(status: Pick<CadenceStatus, "state" | "daysOverdue">): string | null {
  if (status.state === "due-today") return "Due today";
  if (status.state === "overdue") return `Overdue ${status.daysOverdue}d`;
  return null;
}
