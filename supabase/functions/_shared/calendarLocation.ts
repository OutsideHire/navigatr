// Pure, Deno-free helpers that pull a meeting's free-text location/address out of
// each calendar provider's raw event shape, so the normalized
// RawCalendarEvent.location field is populated consistently across providers.
// The read_calendar_events Edge function imports this with the .ts extension;
// vitest unit-tests it from the app (dependency-free TS).
//
// Google Calendar exposes a flat `location` string.
// Microsoft Graph exposes a structured `location` object: a `displayName` (what
// the user typed, or the picked venue name) plus an optional `address`
// sub-object (street / city / state / postalCode / countryOrRegion). When the
// displayName is blank we compose the address text from those sub-fields, so an
// Outlook meeting carries an address the same way a Google one does instead of
// silently collapsing to a no-location time block.

export interface GraphLocationAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryOrRegion?: string | null;
}

export interface GraphLocation {
  displayName?: string | null;
  address?: GraphLocationAddress | null;
}

/** Trimmed non-empty string, or null. */
function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Google Calendar's event location is already a flat free-text string. */
export function extractGoogleLocation(
  location: string | null | undefined,
): string | null {
  return cleanText(location);
}

/**
 * Microsoft Graph event location. Prefer the displayName (what the user typed
 * or the picked venue name); when it is blank, compose a comma-joined address
 * from the structured address sub-fields so an address still surfaces.
 */
export function extractMicrosoftLocation(
  location: GraphLocation | null | undefined,
): string | null {
  if (!location) return null;
  const displayName = cleanText(location.displayName);
  if (displayName) return displayName;
  const addr = location.address;
  if (!addr) return null;
  const parts = [
    addr.street,
    addr.city,
    addr.state,
    addr.postalCode,
    addr.countryOrRegion,
  ]
    .map((part) => cleanText(part))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}
