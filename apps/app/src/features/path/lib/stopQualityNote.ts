/**
 * Path Data Quality Fix v1.2, R4. A commitment (an owed drop-in, a due visit,
 * an appointment) is never removed from the day because its business looks
 * closed or a teammate flagged it. It stays, with one plain line saying why.
 *
 * Exact copy is fixed by the spec.
 */

export const SUPPRESSED_NOTE = "Flagged by your team as out of business or home-based";
export const GOOGLE_CLOSED_NOTE = "Google lists this business as closed";

export interface StopQualityFlag {
  deal_id: string;
  google_closed: boolean;
  suppressed: boolean;
}

/** The line for one deal, or null when there is nothing to say. A teammate's
 *  first-hand report wins over Google when both apply: it is the more specific
 *  of the two, and the row has room for one line. */
export function stopQualityNote(flag: Pick<StopQualityFlag, "google_closed" | "suppressed"> | undefined): string | null {
  if (!flag) return null;
  if (flag.suppressed) return SUPPRESSED_NOTE;
  if (flag.google_closed) return GOOGLE_CLOSED_NOTE;
  return null;
}

/** deal id -> line, for the deals that have one. */
export function stopQualityNotes(flags: StopQualityFlag[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of flags) {
    const note = stopQualityNote(f);
    if (note) out.set(f.deal_id, note);
  }
  return out;
}
