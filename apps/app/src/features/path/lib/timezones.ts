/**
 * timezones — the IANA zones a US rep can pick, with plain-language labels.
 * IANA ids only (they carry DST rules); never an offset or abbreviation.
 * Phoenix and Honolulu are first-class, not edge cases: they do not observe
 * daylight saving, so only an IANA id represents them correctly year-round.
 */
export interface TimezoneOption {
  id: string;
  label: string;
}

export const US_TIMEZONES: readonly TimezoneOption[] = [
  { id: "America/New_York", label: "Eastern Time (America/New_York)" },
  { id: "America/Chicago", label: "Central Time (America/Chicago)" },
  { id: "America/Denver", label: "Mountain Time (America/Denver)" },
  { id: "America/Phoenix", label: "Mountain Time - no DST (America/Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific Time (America/Los_Angeles)" },
  { id: "America/Anchorage", label: "Alaska Time (America/Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii Time (Pacific/Honolulu)" },
] as const;

const BY_ID = new Map(US_TIMEZONES.map((z) => [z.id, z.label]));

/** Plain label for a stored zone; falls back to the bare id for zones outside
 *  the US list (a rep who travels/relocates keeps a valid but unlisted zone). */
export function timezoneLabel(id: string): string {
  return BY_ID.get(id) ?? id;
}

/** True when `id` is a resolvable IANA zone (validated via Intl, so any real
 *  zone the device reports passes, not only the US list). */
export function isKnownTimezone(id: string): boolean {
  if (!id) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id });
    return true;
  } catch {
    return false;
  }
}
