/**
 * endOfDayControl (v2.2 Ticket B, B-EOD-UI).
 *
 * Pure conversions between the per-rep end-of-day preference (minutes from local
 * midnight, as stored on `path_preferences.end_of_day_minutes`) and the "HH:MM"
 * value an `<input type="time">` reads and writes. Kept separate from the React
 * control so the arithmetic is unit-testable and reused nowhere else invents it.
 */

/** Clamp helper: keep a minutes-from-midnight value inside a single day. */
function clampToDay(minutes: number): number {
  if (minutes < 0) return 0;
  if (minutes > 24 * 60 - 1) return 24 * 60 - 1;
  return minutes;
}

/**
 * Minutes-from-midnight to a 24h "HH:MM" string for `<input type="time">`.
 * 1020 -> "17:00", 0 -> "00:00", 570 -> "09:30". Out-of-range inputs clamp to
 * the day so the control never shows a blank or invalid value.
 */
export function minutesToTimeValue(minutes: number): string {
  const m = clampToDay(Math.round(minutes));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * A 24h "HH:MM" string back to minutes from midnight. Returns null for anything
 * that is not a well-formed time (empty, garbage, out-of-range parts) so the
 * caller can ignore a partial edit rather than persist a bad value.
 */
export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * A short human label for the effective end-of-day, e.g. "5:00 PM". Used for the
 * helper caption so the rep can read the current setting without decoding the
 * input. Local-tz clock formatting, matching the rest of the Path copy.
 */
export function endOfDayLabel(minutes: number): string {
  const m = clampToDay(Math.round(minutes));
  const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The workday must be at least this long (v1.4 Section 7: minimum one hour). */
export const MIN_WORKDAY_MINUTES = 60;

/**
 * Validate a proposed workday window (both minutes from local midnight). Returns
 * an error message when the end is not at least MIN_WORKDAY_MINUTES after the
 * start (which also rejects end <= start and any cross-midnight pair, since both
 * values live in a single day), or null when the window is valid. Shared by the
 * "Day starts at" and "Day ends at" controls so neither can be saved into an
 * invalid pair (v1.4 Section 7).
 */
export function workdayWindowError(startMinutes: number, endMinutes: number): string | null {
  if (endMinutes - startMinutes < MIN_WORKDAY_MINUTES) {
    return `Your day must end at least an hour after it starts (currently ${endOfDayLabel(startMinutes)} to ${endOfDayLabel(endMinutes)}).`;
  }
  return null;
}
