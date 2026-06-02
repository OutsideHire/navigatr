// geocode — city/ZIP → coordinates for the Path page's manual location search.
//
// Server-side so GOOGLE_PLACES_API_KEY is never shipped to the browser. Reuses
// the same key as discover_prospects (the Geocoding API must be enabled on the
// Google Cloud project — one-time toggle). GEOCODE_MOCK=1 returns a fixed coord
// so dev/CI never hit Google. Mirrors discover_prospects' CORS/auth/json shape.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const GEOCODE_MOCK = Deno.env.get("GEOCODE_MOCK") === "1";

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

interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

/** Google Geocoding API, US-biased. Returns the top match, or null on no match. */
async function geocodeQuery(query: string): Promise<GeocodeResult | null> {
  if (GEOCODE_MOCK) {
    return { lat: 30.2672, lng: -97.7431, label: "Austin, TX, USA" };
  }
  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY not set (and GEOCODE_MOCK != 1)");
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`geocode http ${res.status}`);
  const data = await res.json() as {
    status: string;
    results?: Array<{
      formatted_address?: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (data.status === "ZERO_RESULTS" || !data.results?.length) return null;
  if (data.status !== "OK") throw new Error(`geocode status ${data.status}`);

  const top = data.results[0];
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    label: top.formatted_address ?? query,
  };
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

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return json({ error: "invalid_body", detail: "query is required" }, 400);
  }

  // Authenticated users only — same gate as discover_prospects.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const result = await geocodeQuery(query);
    return json({ result });
  } catch (e) {
    return json({ error: "geocode_failed", detail: String((e as Error)?.message ?? e) }, 502);
  }
});
