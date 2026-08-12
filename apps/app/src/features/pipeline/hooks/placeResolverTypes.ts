/**
 * Client mirror of the resolve_place edge function's normalized output shapes
 * (supabase/functions/_shared/placeResolve.ts). The edge function already
 * returns camelCase, so these match its JSON 1:1.
 */

/** One row in the business-search dropdown. */
export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

/** A fully resolved business, prefilled into the Add-Deal form. `industry` is a
 *  navigatr IndustryKey string; optional fields come back null when Google omits
 *  them so the form's Google-filled vs rep-supplied split stays explicit. */
export interface ResolvedPlace {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  primaryType: string | null;
  phone: string | null;
  industry: string;
}
