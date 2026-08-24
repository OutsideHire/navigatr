/**
 * daySubhead (v2.2 A6, revised 2026-08-24). The one-line subhead under the
 * "Your day" landing header. Pure sentence-chooser: it picks one reading and
 * gets the plurality right (never "1 stops"). Clock/label strings are
 * PREFORMATTED by the caller (e.g. "8:00 AM") — this helper never formats a
 * time, it only slots one in.
 *
 * The states:
 *   - Planned, not started:  "8 stops. Your day: 8:00 AM to 6:00 PM."
 *       Shows the rep's CONFIGURED workday window, not a live clock. Earlier this
 *       showed "Starts at {now}" once the day was open, which read as if the
 *       rep's start setting had been ignored (it hadn't — the window still drives
 *       planning). Showing the configured window always reflects the setting.
 *   - Day underway:          "8 stops. Next at 11:40."  (a start time is wrong
 *                            once underway; show the next arrival instead)
 *   - Nothing planned:       "Nothing scheduled yet."
 *
 * Fallbacks keep it graceful: with a stop count but no window labels, it states
 * the count alone ("8 stops.") rather than an empty or malformed clause.
 */
export interface DaySubheadInput {
  /** How many stops are on the day. 0 (or less) is the "nothing planned" case. */
  stopCount: number;
  /** Preformatted label for the configured workday start, e.g. "8:00 AM". */
  workdayStart?: string | null;
  /** Preformatted label for the configured workday end, e.g. "6:00 PM". */
  workdayEnd?: string | null;
  /** Preformatted clock for the underway "Next at" clause, e.g. "11:40". */
  nextAt?: string | null;
  /** True once the day is running: show "Next at", never the window. */
  started?: boolean;
}

export function daySubhead({ stopCount, workdayStart, workdayEnd, nextAt, started = false }: DaySubheadInput): string {
  if (stopCount <= 0) return "Nothing scheduled yet.";
  const stops = `${stopCount} ${stopCount === 1 ? "stop" : "stops"}`;
  if (started) {
    return nextAt ? `${stops}. Next at ${nextAt}.` : `${stops}.`;
  }
  if (workdayStart && workdayEnd) {
    return `${stops}. Your day: ${workdayStart} to ${workdayEnd}.`;
  }
  return `${stops}.`;
}
