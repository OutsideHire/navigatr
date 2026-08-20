/**
 * dateInZone (server mirror) - the calendar day ("YYYY-MM-DD") of an instant,
 * resolved in a given IANA time zone. Byte-identical to the client copy at
 * apps/app/src/lib/zonedDate.ts (the edge scorer cannot import from apps/app).
 * The parity test pins the two together. Uses Intl.DateTimeFormat, which Deno
 * supports natively; a null/unresolvable zone falls back to UTC (prior behavior).
 */
export function dateInZone(instant: string | number | Date, tz: string | null | undefined): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (!tz) return utcDate(d);
  try {
    // 'en-CA' formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return utcDate(d);
  }
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
