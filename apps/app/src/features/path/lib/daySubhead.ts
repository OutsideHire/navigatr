/**
 * daySubhead (v2.2 A6). The one-line subhead under the "Your day" landing
 * header. Pure sentence-chooser: it picks one of four readings and gets the
 * plurality right (never "1 stops"). Clock strings are PREFORMATTED by the
 * caller (e.g. "9:15") — this helper never formats a time, it only slots one in.
 *
 * The states:
 *   - Planned, not started:  "8 stops. Starts at 9:15."
 *   - Planned, before open:  "8 stops. Your day starts at 8:00 AM."  (the current
 *                            time is before the workday opens, so startsAt is the
 *                            scheduled opening; the fuller wording keeps it from
 *                            reading as a frozen current-time clock off-hours)
 *   - One stop:              "1 stop. Starts at 9:15."
 *   - Day underway:          "8 stops. Next at 11:40."  (a start time is wrong
 *                            once underway; show the next arrival instead)
 *   - Nothing planned:       "Nothing scheduled yet."
 *
 * Fallbacks keep it graceful: with a stop count but no clock string, it states
 * the count alone ("8 stops.") rather than an empty or malformed clause.
 */
export interface DaySubheadInput {
  /** How many stops are on the day. 0 (or less) is the "nothing planned" case. */
  stopCount: number;
  /** Preformatted clock for the planned "Starts at" clause, e.g. "9:15". */
  startsAt?: string | null;
  /** Preformatted clock for the underway "Next at" clause, e.g. "11:40". */
  nextAt?: string | null;
  /** True once the day is running: show "Next at", never "Starts at". */
  started?: boolean;
  /** True when the current time is before the workday opens, so `startsAt` is
   *  the scheduled opening (e.g. "8:00 AM"). Switches the planned clause to
   *  "Your day starts at …" so it does not read as a frozen current time. */
  notYetOpen?: boolean;
}

export function daySubhead({ stopCount, startsAt, nextAt, started = false, notYetOpen = false }: DaySubheadInput): string {
  if (stopCount <= 0) return "Nothing scheduled yet.";
  const stops = `${stopCount} ${stopCount === 1 ? "stop" : "stops"}`;
  if (started) {
    return nextAt ? `${stops}. Next at ${nextAt}.` : `${stops}.`;
  }
  if (!startsAt) return `${stops}.`;
  return notYetOpen
    ? `${stops}. Your day starts at ${startsAt}.`
    : `${stops}. Starts at ${startsAt}.`;
}
