/**
 * scheduleDate — pure local-tz-aware date helpers for the Plan-a-Path Schedule
 * step (SP3). Leaf module (no hook/React imports) so both the step component and
 * its tests can share the math without a cycle.
 *
 * All dates are handled as local calendar days (yyyy-mm-dd) parsed at local
 * midnight (append T00:00:00) so a UTC offset can never roll the day — same
 * convention as `today.ts`.
 */
import { todayISO } from "./today";

/** yyyy-mm-dd for the next Monday strictly after `fromIso` (never today, even if
 *  today is a Monday — "next week" always means the upcoming week). */
export function nextMondayISO(fromIso: string = todayISO()): string {
  const d = new Date(`${fromIso}T00:00:00`);
  const dow = d.getDay(); // 0 = Sun … 1 = Mon
  // Days until the *next* Monday: 1..7 (7 when today is Monday).
  const delta = ((8 - dow) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return isoOf(d);
}

/** Local yyyy-mm-dd of a Date. */
function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "Tue Jul 2"-style weekday label for a calendar day (local). */
export function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Default path name: "{originLabel} · {Weekday Mon D}". Falls back to a generic
 *  prefix when there's no origin label. */
export function defaultPathName(originLabel: string | null | undefined, iso: string): string {
  const prefix = originLabel && originLabel.trim() ? originLabel.trim() : "Planned path";
  return `${prefix} · ${weekdayLabel(iso)}`;
}

/** Compose a local calendar day + "HH:MM" wall-clock time into an ISO timestamp
 *  (with the machine's local offset baked in). Returns null when the time is blank. */
export function composeReminderAt(iso: string, time: string): string | null {
  if (!time) return null;
  const [h, min] = time.split(":").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  const d = new Date(`${iso}T00:00:00`); // local midnight
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

/** Is `iso` today or later (local calendar days)? Guards the Schedule Continue. */
export function isTodayOrFuture(iso: string, todayIso: string = todayISO()): boolean {
  if (!iso) return false;
  return iso >= todayIso; // yyyy-mm-dd sorts lexically === chronologically
}

/** Human "{date} · {time}" for the saved-step reminder line, e.g.
 *  "Tue Jul 2 · 8:30 AM". Returns null when there's no reminder. */
export function formatReminder(reminderAtIso: string | null): string | null {
  if (!reminderAtIso) return null;
  const d = new Date(reminderAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}
