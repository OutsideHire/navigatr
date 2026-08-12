/**
 * daySubhead (v2.2 A6). The one-line subhead under the "Your day" landing
 * header. Pure sentence-chooser: it picks one of four readings and gets the
 * plurality right (never "1 stops"). Clock strings are PREFORMATTED by the
 * caller (e.g. "9:15") — this helper never formats a time, it only slots one in.
 *
 * The four states:
 *   - Planned, not started:  "8 stops. Starts at 9:15."
 *   - One stop:              "1 stop. Starts at 9:15."
 *   - Day underway:          "8 stops. Next at 11:40."  (a start time is wrong
 *                            once underway; show the next arrival instead)
 *   - Nothing planned:       "No stops yet. Build one to get going."
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
}

export function daySubhead({ stopCount, startsAt, nextAt, started = false }: DaySubheadInput): string {
  if (stopCount <= 0) return "No stops yet. Build one to get going.";
  const stops = `${stopCount} ${stopCount === 1 ? "stop" : "stops"}`;
  if (started) {
    return nextAt ? `${stops}. Next at ${nextAt}.` : `${stops}.`;
  }
  return startsAt ? `${stops}. Starts at ${startsAt}.` : `${stops}.`;
}
