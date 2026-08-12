// Pure normalizers for the Add-Deal-via-Places resolver (slice B).
//
// The resolver edge function does two things against Google Places (New):
//   1. autocomplete  — text -> ranked suggestions (placeId + label parts)
//   2. details       — placeId -> one resolved business (name/addr/coords/etc.)
//
// The HTTP + field-mask + session-token plumbing lives in resolve_place/index.ts
// (Deno-only). Everything here is a pure shape transform of Google's JSON into
// navigatr's own shapes, so it can be unit-tested without a key or a network.
//
// Industry is mapped through the SAME bucketForType taxonomy that Path's ingest
// uses (industryTaxonomy.ts), so a business resolved via search lands in the
// same ~13-bucket set a business discovered via GPS would. (D-10: only the
// mapping table is shared with Path, not the search call itself.)

import { bucketForType, type IndustryKey } from "./industryTaxonomy.ts";

/** Below this length we never call Google autocomplete — the client debounces
 *  and enforces this too, but the resolver guards it so a stray 1-char request
 *  can't run up billing. (FR-ADD-SRCH-02) */
export const MIN_AUTOCOMPLETE_CHARS = 3;

/** One row in the search dropdown. `primaryText` is the business name,
 *  `secondaryText` the address line; `fullText` is Google's single-line label
 *  used as an accessible fallback. */
export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

/** A fully resolved business, prefilled into the Add-Deal form. `industry` is a
 *  navigatr IndustryKey (never a raw Google type). Missing optional fields come
 *  back null rather than absent, so the form's "rep must supply" split is
 *  explicit. */
export interface ResolvedPlace {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  primaryType: string | null;
  phone: string | null;
  industry: IndustryKey;
}

// ---- Google Places (New) response shapes (only the fields we mask) ----------

/** places:autocomplete response. Non-place suggestions (query predictions)
 *  carry no `placePrediction` and are skipped. */
export interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

/** places/{placeId} (GET) response, limited to our field mask. */
export interface GooglePlaceDetails {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  nationalPhoneNumber?: string;
}

/** Map Google's autocomplete payload to our suggestion rows, dropping any entry
 *  without a placeId (query-only predictions) and any without display text. */
export function normalizeAutocomplete(raw: GoogleAutocompleteResponse): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  for (const s of raw.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const main = p.structuredFormat?.mainText?.text?.trim() ?? "";
    const secondary = p.structuredFormat?.secondaryText?.text?.trim() ?? "";
    const full = p.text?.text?.trim() ?? "";
    // Prefer the structured main text; fall back to the single-line label so a
    // suggestion is never blank.
    const primaryText = main || full;
    if (!primaryText) continue;
    out.push({
      placeId: p.placeId,
      primaryText,
      secondaryText: secondary,
      fullText: full || primaryText,
    });
  }
  return out;
}

/** Map Google's place-details payload to a ResolvedPlace, mapping primaryType +
 *  types through the shared taxonomy. Coordinates and address come back null
 *  when Google omits them so the form treats them as rep-supplied. */
export function normalizePlaceDetails(raw: GooglePlaceDetails): ResolvedPlace {
  const lat = typeof raw.location?.latitude === "number" ? raw.location.latitude : null;
  const lng = typeof raw.location?.longitude === "number" ? raw.location.longitude : null;
  return {
    placeId: raw.id ?? "",
    name: raw.displayName?.text?.trim() ?? "",
    formattedAddress: raw.formattedAddress?.trim() || null,
    lat,
    lng,
    primaryType: raw.primaryType ?? null,
    phone: raw.nationalPhoneNumber?.trim() || null,
    industry: bucketForType(raw.types ?? [], raw.primaryType ?? null),
  };
}
