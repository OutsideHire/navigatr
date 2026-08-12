// Supabase Edge Function: resolve_place — the Add-Deal-via-Places resolver.
//
// Two actions against Google Places (New), both scoped by a per-sheet SESSION
// TOKEN so a whole "type -> pick -> details" flow bills as one Autocomplete
// session instead of per-keystroke:
//
//   { action: "autocomplete", input, session_token, bias? }
//     -> { suggestions: [{ placeId, primaryText, secondaryText, fullText }] }
//
//   { action: "details", place_id, session_token }
//     -> { place: { placeId, name, formattedAddress, lat, lng, primaryType,
//                    phone, industry } }  (industry = navigatr IndustryKey)
//
// Auth: requires an authenticated user JWT (verified like discover_prospects).
// No DB writes happen here — this only resolves a business; the create/dedupe
// happens client-side (slice D) against find_active_duplicate_deal (slice C).
//
// COST POSTURE (matches Path): PLACES_MOCK=1 swaps the live calls for
// fixtures.ts so the flow runs with zero API cost and no key. Autocomplete is
// higher-volume than Path's cached Nearby Search, so we keep it OFF in prod
// until deliberately switched on. Live path needs GOOGLE_PLACES_API_KEY set and
// PLACES_MOCK unset. The details field mask is the minimal set the form uses
// (id, displayName, formattedAddress, location, primaryType, types,
// nationalPhoneNumber) — website/hours are intentionally excluded (FR-ADD-PLC).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MIN_AUTOCOMPLETE_CHARS,
  normalizeAutocomplete,
  normalizePlaceDetails,
  type GoogleAutocompleteResponse,
  type GooglePlaceDetails,
} from "../_shared/placeResolve.ts";
import { mockAutocomplete, mockPlaceDetails } from "./fixtures.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const PLACES_MOCK = Deno.env.get("PLACES_MOCK") === "1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  action?: "autocomplete" | "details";
  input?: string;
  place_id?: string;
  session_token?: string;
  /** Optional location bias for autocomplete (rep's current position). */
  bias?: { lat?: number; lng?: number };
}

/** Live Places (New) autocomplete. Session token collapses the keystroke-level
 *  billing into one session that the subsequent details call closes. */
async function liveAutocomplete(
  input: string,
  sessionToken: string,
  bias: { lat?: number; lng?: number } | undefined,
): Promise<GoogleAutocompleteResponse> {
  const body: Record<string, unknown> = {
    input,
    sessionToken,
    // Establishments only — the Add-Deal flow resolves businesses, not streets.
    includedPrimaryTypes: ["establishment"],
  };
  if (typeof bias?.lat === "number" && typeof bias?.lng === "number") {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50_000 },
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Places autocomplete ${res.status}: ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as GoogleAutocompleteResponse;
}

/** Live Places (New) place-details GET. The session token is passed as a query
 *  param to close the autocomplete session and bill it as one unit. */
async function livePlaceDetails(placeId: string, sessionToken: string): Promise<GooglePlaceDetails> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      // Minimal field mask: exactly what the Add-Deal form prefills. Keeping it
      // tight holds the details call in the cheaper SKU tier.
      "X-Goog-FieldMask": [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "primaryType",
        "types",
        "nationalPhoneNumber",
      ].join(","),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Places details ${res.status}: ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as GooglePlaceDetails;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "missing_authorization" }, 401);
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  const action = body?.action;
  const sessionToken = (body?.session_token ?? "").trim();
  if (action !== "autocomplete" && action !== "details") {
    return json({ error: "invalid_body", detail: "action must be 'autocomplete' or 'details'" }, 400);
  }
  if (!sessionToken) {
    return json({ error: "invalid_body", detail: "session_token is required" }, 400);
  }

  // Verify the caller is a real authenticated user (don't trust a raw header).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  if (!PLACES_MOCK && !GOOGLE_PLACES_API_KEY) {
    return json({ error: "places_unavailable", detail: "live Places is off (no key, PLACES_MOCK unset)" }, 503);
  }

  try {
    if (action === "autocomplete") {
      const input = (body?.input ?? "").trim();
      // Guard the billable call below the search floor (client also enforces).
      if (input.length < MIN_AUTOCOMPLETE_CHARS) {
        return json({ suggestions: [] });
      }
      const raw = PLACES_MOCK
        ? mockAutocomplete(input)
        : await liveAutocomplete(input, sessionToken, body?.bias);
      return json({ suggestions: normalizeAutocomplete(raw) });
    }

    // action === "details"
    const placeId = (body?.place_id ?? "").trim();
    if (!placeId) {
      return json({ error: "invalid_body", detail: "place_id is required for details" }, 400);
    }
    const raw = PLACES_MOCK ? mockPlaceDetails(placeId) : await livePlaceDetails(placeId, sessionToken);
    const place = normalizePlaceDetails(raw);
    if (!place.placeId || !place.name) {
      return json({ error: "place_not_found", detail: "no resolvable business for that place_id" }, 404);
    }
    return json({ place });
  } catch (e) {
    return json({ error: "places_request_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});
