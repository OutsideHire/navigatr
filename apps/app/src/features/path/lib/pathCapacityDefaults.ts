/**
 * Path capacity defaults (v2.2 Ticket B, Section 4.3 + defaults 2/3).
 *
 * The two configurable INPUTS the capacity model needs, as NAMED values instead
 * of the flat literals that used to be scattered across the assembler. This
 * module holds only the constants + a per-kind dwell helper. It does NOT compute
 * the capacity readout (that is B-T2) and reads no per-rep column yet.
 *
 *  - `DEFAULT_END_OF_DAY_MINUTES`: the global end-of-day, 5:00 PM, expressed as
 *    minutes from local midnight. A per-rep override lives on
 *    `path_preferences.end_of_day_minutes` (null = use this default); B-T2 reads
 *    it. Nothing here depends on the column existing yet.
 *  - Per-kind dwell replaces the old flat 20: an appointment consumes 30 min, a
 *    flexible drop-in (discovery / owed / due-today / nearby) consumes 15.
 */

/** Global end-of-day default: 5:00 PM, in minutes from local midnight. */
export const DEFAULT_END_OF_DAY_MINUTES = 17 * 60;

/** Dwell for a flexible stop: discovery / drop-in / owed / due-today / nearby. */
export const DWELL_DISCOVERY_MIN = 15;

/** Dwell for a booked appointment (or external meeting). */
export const DWELL_APPOINTMENT_MIN = 30;

/**
 * Minutes to hold at a stop, by its kind OR tier. Appointments (kind
 * `appointment`/`external`, or tier `appointment`) hold 30; every flexible stop
 * (`flexible`, `owed`, `nearby`, `past_due`, `due_today`, `no_location`) holds 15.
 */
export function dwellMinutesForKind(kindOrTier: string): number {
  return kindOrTier === "appointment" || kindOrTier === "external"
    ? DWELL_APPOINTMENT_MIN
    : DWELL_DISCOVERY_MIN;
}
