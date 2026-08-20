/**
 * dateInZone - the calendar day ("YYYY-MM-DD") of an instant, resolved in a
 * given IANA time zone. Replaces the UTC-only `toISOString().slice(0,10)` used
 * for day boundaries. Uses Intl.DateTimeFormat (present in the browser and in
 * Deno, no external library) with the 'en-CA' locale, which formats as
 * YYYY-MM-DD.
 *
 * A null/empty/unresolvable zone falls back to UTC, which is exactly the prior
 * behavior, so callers with no stored zone are unchanged.
 *
 * This logic is MIRRORED byte-for-byte in
 * supabase/functions/_shared/persistence/zonedDate.ts (the server scorer cannot
 * import from apps/app). A parity test in that file pins the two together.
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
