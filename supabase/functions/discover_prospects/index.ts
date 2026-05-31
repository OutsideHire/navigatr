// Supabase Edge Function: discover_prospects — the Path prospect-ingest spine.
//
// Body: { lat, lng, radius_m?, profession?, force_refresh? }
// Auth: requires an authenticated user JWT. We verify the caller, then do the
//       expensive work (Places fetch + classification + upsert) with the SERVICE
//       ROLE so the shared `prospects` cache can be written (it has no client
//       write policies). The read we return goes through the user's JWT so RLS
//       and the SECURITY DEFINER `prospects_nearby` grant apply normally.
//
// THE CACHE DECISION (PATH_DESIGN.md §2/§3, Approach B): we bucket the request
// into a geohash cell (precision 5, ~4.9km). geo_cell_cache tracks warmth PER
// CATEGORY BUCKET. We only call Google for the buckets that are cold/expired —
// that's the ~90% Places-spend cut, now at bucket granularity.
//
// CATEGORIZED INGEST (PATH_DESIGN.md §11): instead of one category-agnostic
// searchNearby (which Google ranks by prominence, starving low-profile service
// businesses), we fire ONE searchNearby per cold bucket, each scoped to that
// bucket's includedTypes, ranked by POPULARITY, in parallel. Every category
// gets its own 20 slots so plumbers/accountants/movers actually surface.
//
// PLACES_MOCK=1 swaps the live Places call for fixtures.ts so the whole pipeline
// (classify → store → query) runs with zero API cost and no key. Flip it off and
// set GOOGLE_PLACES_API_KEY to go live — the response shapes are identical.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyProspect,
  type IcpVerdict,
  type ProspectCandidate,
} from "../_shared/icpFilter.ts";
import { encodeGeohash } from "../_shared/geohash.ts";
import {
  CATEGORY_BUCKETS,
  CATEGORY_TYPES,
  bucketForType,
  type CategoryBucket,
} from "../_shared/categoryTaxonomy.ts";
import { mockSearchNearby, type PlacesNewPlace, type PlacesNewResponse } from "./fixtures.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const PLACES_MOCK = Deno.env.get("PLACES_MOCK") === "1";

// How long a (cell, bucket) stays "warm" before we re-pull Places. 30 days is a
// sane Phase 1 default; the Approach-C scheduled refresh (Phase 5) supersedes it.
const CELL_TTL_DAYS = 30;
// Geohash precision used to bucket cache cells. Must match the read radius
// bracketing reasoning in _shared/geohash.ts.
const GEO_PRECISION = 5;
const TTL_MS = CELL_TTL_DAYS * 24 * 60 * 60 * 1000;

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
  lat?: number;
  lng?: number;
  radius_m?: number;
  profession?: string | null;
  force_refresh?: boolean;
}

/** One bucket's Places pull, kept paired with its bucket for per-bucket cache
 *  attribution after we dedup the union. */
interface BucketPull {
  bucket: CategoryBucket;
  places: PlacesNewPlace[];
}

/**
 * One searchNearby scoped to a set of includedTypes, ranked by POPULARITY.
 * PLACES_MOCK short-circuits to fixtures (which ignore includedTypes — fine, the
 * caller dedups the union before counting). Otherwise hits Google Places (New).
 */
async function searchNearbyForTypes(
  lat: number,
  lng: number,
  radiusM: number,
  includedTypes: string[],
): Promise<PlacesNewPlace[]> {
  if (PLACES_MOCK) {
    return mockSearchNearby(lat, lng).places;
  }
  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY not set (and PLACES_MOCK != 1)");
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      // Only the fields we store — keeps the bill in the cheaper SKU tier.
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.types",
        "places.location",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.userRatingCount",
      ].join(","),
    },
    body: JSON.stringify({
      includedTypes,
      // POPULARITY pulls the most-established businesses per type; the read path
      // (prospects_nearby) re-sorts by distance, so the rep still sees nearest-
      // first, seeded from higher-quality prospects (PATH_DESIGN.md §11).
      rankPreference: "POPULARITY",
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          // Places caps the circle radius at 50km; our path radius is well under.
          radius: Math.min(Math.max(radiusM, 1), 50_000),
        },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Places searchNearby ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as PlacesNewResponse;
  return data.places ?? [];
}

/**
 * Fire one searchNearby per cold bucket, in parallel (Promise.all), so a cold
 * cell stays ~2-3s instead of 7× serial. Each pull is scoped to that bucket's
 * Table A includedTypes. Returns the pulls paired with their bucket.
 */
function fetchPlacesByCategory(
  lat: number,
  lng: number,
  radiusM: number,
  buckets: CategoryBucket[],
): Promise<BucketPull[]> {
  return Promise.all(
    buckets.map(async (bucket): Promise<BucketPull> => ({
      bucket,
      places: await searchNearbyForTypes(lat, lng, radiusM, CATEGORY_TYPES[bucket]),
    })),
  );
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
  const lat = body?.lat;
  const lng = body?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "invalid_body", detail: "lat and lng must be finite numbers" }, 400);
  }
  const radiusM = typeof body?.radius_m === "number" && body.radius_m > 0 ? body.radius_m : 3000;
  const profession = body?.profession ?? null;
  const forceRefresh = body?.force_refresh === true;

  // Verify the caller is a real authenticated user (don't trust a raw header).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // Service role for the shared-cache writes (prospects has no client write policy).
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const cell = encodeGeohash(lat, lng, GEO_PRECISION);

  // ---- Cache decision (per bucket) ----------------------------------------
  // Read every cache row for this cell, then keep only the buckets that are
  // missing or past TTL. force_refresh re-pulls all 7. Legacy "_all" Phase-1
  // rows simply aren't in CATEGORY_BUCKETS, so they're ignored and every bucket
  // reads cold on the first post-deploy hit — the cell self-heals to coarse
  // buckets with no migration (PATH_DESIGN.md §11).
  let coldBuckets: CategoryBucket[] = [...CATEGORY_BUCKETS];
  if (!forceRefresh) {
    const { data: cacheRows } = await admin
      .from("geo_cell_cache")
      .select("category, last_pulled_at")
      .eq("geo_cell", cell);
    const lastPulled = new Map<string, number>();
    for (const r of cacheRows ?? []) {
      const ts = r.last_pulled_at as string | null;
      if (ts) lastPulled.set(r.category as string, new Date(ts).getTime());
    }
    const now = Date.now();
    coldBuckets = CATEGORY_BUCKETS.filter((b) => {
      const t = lastPulled.get(b);
      return t == null || now - t >= TTL_MS;
    });
  }
  const warm = coldBuckets.length === 0;

  let rawCount = 0;
  let filteredCount = 0;
  let keptCount = 0;

  // ---- Cold buckets: pull Places (parallel), classify the union, upsert ----
  if (!warm) {
    let pulls: BucketPull[];
    try {
      pulls = await fetchPlacesByCategory(lat, lng, radiusM, coldBuckets);
    } catch (e) {
      return json({ error: "places_fetch_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
    }

    // Dedup the union by place_id (a business returned by two buckets collapses
    // to one row — and with the mock, all pulls return the same fixtures).
    const uniq = new Map<string, PlacesNewPlace>();
    for (const { places } of pulls) {
      for (const p of places) {
        if (!uniq.has(p.id)) uniq.set(p.id, p);
      }
    }

    // Active exclusion seed patterns (curated chain list).
    const { data: seedRows } = await admin
      .from("exclusion_seed")
      .select("name_pattern, brand")
      .eq("active", true);
    const seedPatterns = (seedRows ?? []).map((r) => ({
      pattern: r.name_pattern as string,
      brand: r.brand as string,
    }));

    // Same-name density (FR-PATH-14): seed the count map with names already
    // cached in this cell, then add the COMBINED union's occurrences (not
    // per-pull — a chain split across buckets must still trip the heuristic).
    const nameCount = new Map<string, number>();
    const { data: existingNames } = await admin
      .from("prospects")
      .select("name")
      .eq("geo_cell", cell);
    for (const row of existingNames ?? []) {
      const k = ((row.name as string) ?? "").toLowerCase();
      if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }
    for (const p of uniq.values()) {
      const k = (p.displayName?.text ?? "").toLowerCase();
      if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }

    // Classify each unique business ONCE. We store EVERY business (in-profile
    // and not) so the cache is complete; the read path filters to servable.
    // `category` is the COARSE bucket (bucketForType) — the same taxonomy that
    // drove the includedTypes pull, so ingest + display can't drift.
    const verdicts = new Map<string, IcpVerdict>();
    const rows = [...uniq.values()].map((p) => {
      const candidate: ProspectCandidate = {
        placeId: p.id,
        name: p.displayName?.text ?? "",
        types: p.types ?? [],
        employeeCount: null, // Places returns none; vendor-gated (PATH_DESIGN §6)
      };
      const nameKey = candidate.name.toLowerCase();
      // Exclude self from the density count (the row's own contribution).
      const sameNameNearby = Math.max(0, (nameCount.get(nameKey) ?? 1) - 1);
      const verdict = classifyProspect(candidate, seedPatterns, sameNameNearby);
      verdicts.set(p.id, verdict);
      if (verdict.isChain || !verdict.inProfile) filteredCount++;
      else keptCount++;
      return {
        place_id: p.id,
        name: candidate.name,
        category: bucketForType(p.types ?? []),
        google_types: p.types ?? [],
        lat: p.location.latitude,
        lng: p.location.longitude,
        geo_cell: cell,
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating_count: p.userRatingCount ?? null,
        is_chain: verdict.isChain,
        chain_reason: verdict.chainReason,
        in_profile: verdict.inProfile,
        source: "google_places",
        last_refreshed_at: new Date().toISOString(),
      };
    });
    rawCount = rows.length;

    if (rows.length > 0) {
      const { error: upErr } = await admin
        .from("prospects")
        .upsert(rows, { onConflict: "place_id" });
      if (upErr) {
        return json({ error: "upsert_failed", detail: upErr.message }, 500);
      }
    }

    // Observability + warm-mark EACH cold bucket (FR-PATH-17). Per-bucket counts
    // are attributed from that bucket's own pull (verdicts looked up from the
    // shared map), so a partial failure later re-pulls only the missing buckets.
    const pulledAt = new Date().toISOString();
    const cacheUpserts = pulls.map(({ bucket, places }) => {
      let kept = 0;
      let filtered = 0;
      for (const p of places) {
        const v = verdicts.get(p.id);
        if (v && !v.isChain && v.inProfile) kept++;
        else filtered++;
      }
      return {
        geo_cell: cell,
        category: bucket,
        last_pulled_at: pulledAt,
        raw_count: places.length,
        filtered_count: filtered,
        kept_count: kept,
      };
    });
    const { error: cacheErr } = await admin
      .from("geo_cell_cache")
      .upsert(cacheUpserts, { onConflict: "geo_cell,category" });
    if (cacheErr) {
      return json({ error: "cache_update_failed", detail: cacheErr.message }, 500);
    }
  }

  // ---- Read path: servable prospects, nearest first -----------------------
  // Goes through the user's JWT so the SECURITY DEFINER grant + RLS apply.
  const { data: nearby, error: rpcErr } = await userClient.rpc("prospects_nearby", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
    p_profession: profession,
    p_limit: 30,
  });
  if (rpcErr) {
    return json({ error: "nearby_query_failed", detail: rpcErr.message }, 500);
  }

  return json({
    cell,
    cache: warm ? "warm" : "cold",
    cold_buckets: coldBuckets,
    raw_count: rawCount,
    filtered_count: filteredCount,
    kept_count: keptCount,
    prospects: nearby ?? [],
  });
});
