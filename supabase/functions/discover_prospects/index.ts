// Supabase Edge Function: discover_prospects — the Path prospect-ingest spine.
//
// Body: { lat, lng, radius_m?, profession?, industries?, force_refresh? }
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
// bucket's includedTypes, ranked by DISTANCE, in parallel. Every category
// gets its own 20 slots so plumbers/accountants/movers actually surface.
//
// OPPORTUNITY RANKING (Phase A, design 2026-05-31): rank is DISTANCE, not
// POPULARITY. A merchant-services rep's edge is finding under-saturated and
// newly-opened businesses — popular = a competing processor already got there.
// POPULARITY rank fetched the saturated top-20 and never surfaced the underseen
// places at all (anti-signal at the SOURCE). DISTANCE pulls complete local
// coverage; navigatr then re-sorts in-app by an opportunity score (low
// rating_count up, distance tiebreak). We also store `rating` (stars) now as a
// second weak signal alongside rating_count.
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
import { decodeGeohash, decodeGeohashBounds, cellsCovering } from "../_shared/geohash.ts";
import {
  TIER_1_KEYS,
  ALL_FETCHABLE_KEYS,
  bucketForType,
  searchableTypes,
  type IndustryKey,
} from "../_shared/industryTaxonomy.ts";
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

// ---- Tiling (wide-radius coverage) ----------------------------------------
// A single searchNearby is capped at 20 results and popularity-skewed, so it
// can't densely cover a driving territory. Instead we TILE: enumerate the
// geohash cells the rep's radius touches and ingest each from its own center.
// Each cell is independently cached (geo_cell, category), so a metro warms once
// and is shared across every rep — cost scales with NEW cold cells, not reps.
//
// MAX_CELLS is the hard cost guardrail + the coverage floor. A 15mi radius
// (24,140m) covers ~700 sq mi, which is ~88 precision-5 cells at ~30°N but more
// toward the poles: cell ground-width scales with cos(lat), so the same radius
// needs ~107 cells at 35°N (Oklahoma City) and ~115 near 49°N. We set the cap
// at 130 so a 15mi pull isn't silently truncated to a partial area anywhere in
// the continental US. Worst-case cold-fill = 130 cells × 7 buckets × ~$0.035 ≈
// ~$32 one-time per fresh 15mi territory, then warm/shared for 30 days across
// every rep. CELL_CONCURRENCY bounds how many cells we fetch at once so one
// Edge invocation doesn't open hundreds of sockets.
const MAX_CELLS = 130;
const CELL_CONCURRENCY = 6;

// Read-path cap (prospects_nearby maxes at 500 server-side; see migration
// 20260602000001). Merchant-services reps work dense territories where the
// nearest 100 within radius wasn't enough coverage.
const READ_LIMIT = 500;
// Margin on a cell's half-diagonal so the per-cell search circle fully covers
// the square cell (corners included) with a little slack.
const CELL_COVER_MARGIN = 1.1;

/** Radius (meters) a searchNearby centered on a cell needs to cover the whole
 *  cell — its half-diagonal plus a small margin, clamped to Places' 50km cap. */
function cellCoverRadiusM(cell: string): number {
  const b = decodeGeohashBounds(cell);
  const midLat = (b.latLo + b.latHi) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = Math.max(1, 111_320 * Math.cos((midLat * Math.PI) / 180));
  const hLat = ((b.latHi - b.latLo) * mPerDegLat) / 2;
  const hLng = ((b.lngHi - b.lngLo) * mPerDegLng) / 2;
  const halfDiag = Math.sqrt(hLat * hLat + hLng * hLng);
  return Math.min(50_000, Math.max(1, Math.round(halfDiag * CELL_COVER_MARGIN)));
}

/** Run `fn` over `items` with at most `limit` in flight. Preserves input order
 *  in the results array. Keeps a cold multi-cell ingest from firing every
 *  cell × bucket fetch simultaneously. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
  industries?: string[];
  force_refresh?: boolean;
  include_chains?: boolean;
}

/** One bucket's Places pull, kept paired with its bucket for per-bucket cache
 *  attribution after we dedup the union. */
interface BucketPull {
  bucket: IndustryKey;
  places: PlacesNewPlace[];
}

/** Outcome of firing all the per-bucket pulls: the ones that came back, and the
 *  ones that threw (bad includedTypes value, transient 5xx, …). Failed buckets
 *  are NOT cache-marked, so they stay cold and retry on the next request rather
 *  than poisoning the whole discovery call. */
interface BucketPullResult {
  fulfilled: BucketPull[];
  failed: Array<{ bucket: IndustryKey; error: string }>;
}

/**
 * One searchNearby scoped to a set of includedTypes, ranked by DISTANCE.
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
        "places.rating",
        "places.primaryType",
      ].join(","),
    },
    body: JSON.stringify({
      includedTypes,
      // DISTANCE (not POPULARITY): we want complete local coverage so the
      // underseen/newly-opened businesses — the rep's actual edge — get fetched
      // at all. POPULARITY returned the saturated top-20 and starved them at the
      // source. navigatr re-ranks in-app by an opportunity score (low review
      // count up). PATH_DESIGN.md §11 + opportunity-ranking design 2026-05-31.
      rankPreference: "DISTANCE",
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
 * Fire one searchNearby per cold bucket, in parallel (Promise.allSettled), so a
 * cold cell stays ~2-3s instead of 7× serial. Each pull is scoped to that
 * bucket's Table A includedTypes. allSettled (not all) so a single bucket that
 * 400s on a bad type or hits a transient error degrades to "that bucket stays
 * cold and retries" instead of failing the whole discovery call.
 */
async function fetchPlacesByCategory(
  lat: number,
  lng: number,
  radiusM: number,
  buckets: IndustryKey[],
): Promise<BucketPullResult> {
  const settled = await Promise.allSettled(
    buckets.map((bucket) =>
      searchNearbyForTypes(lat, lng, radiusM, searchableTypes(bucket)).then(
        (places): BucketPull => ({ bucket, places }),
      ),
    ),
  );
  const fulfilled: BucketPull[] = [];
  const failed: Array<{ bucket: IndustryKey; error: string }> = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      fulfilled.push(r.value);
    } else {
      failed.push({
        bucket: buckets[i],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });
  return { fulfilled, failed };
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
  // Find Near Me opts in to see chains (flagged in the UI); Create stays
  // chain-free client-side. Default false → prospects_nearby excludes chains.
  const includeChains = body?.include_chains === true;

  // Industries to cold-fill. Validate against the known fetchable set; unknown
  // values are dropped. Empty/absent → Tier 1 default (the highest-fit B2B core).
  const requested = Array.isArray(body?.industries)
    ? (body!.industries.filter((s) => (ALL_FETCHABLE_KEYS as string[]).includes(s)) as IndustryKey[])
    : [];
  const scopeIndustries: IndustryKey[] = requested.length > 0 ? requested : [...TIER_1_KEYS];

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

  // ---- Tiling: enumerate the cells the rep's radius touches ---------------
  // cellsCovering returns nearest-first, capped at MAX_CELLS. cells[0] is the
  // rep's own cell (== encodeGeohash(lat,lng)).
  const cells = cellsCovering(lat, lng, radiusM, GEO_PRECISION, MAX_CELLS);
  const originCell = cells[0];

  // ---- Cache decision (per cell, per bucket) ------------------------------
  // One read across every covered cell. A (cell, bucket) is cold if missing or
  // past TTL. force_refresh re-pulls all of them. Legacy "_all" Phase-1 rows
  // aren't in scopeIndustries, so they're ignored and self-heal on first hit
  // (PATH_DESIGN.md §11).
  const lastPulled = new Map<string, number>(); // key: `${cell}|${bucket}`
  if (!forceRefresh) {
    const { data: cacheRows } = await admin
      .from("geo_cell_cache")
      .select("geo_cell, category, last_pulled_at")
      .in("geo_cell", cells);
    for (const r of cacheRows ?? []) {
      const ts = r.last_pulled_at as string | null;
      if (ts) {
        lastPulled.set(`${r.geo_cell as string}|${r.category as string}`, new Date(ts).getTime());
      }
    }
  }
  const now = Date.now();

  // Per-cell cold work: which buckets that cell still needs, and where/how wide
  // to search it. Each tile is searched from its OWN center at the cell's
  // coverage radius — NOT the rep's radius — so tiles stay local and DISTANCE
  // rank densely covers each cell instead of re-skewing to whatever's biggest.
  interface CellWork {
    cell: string;
    center: { lat: number; lng: number };
    radiusM: number;
    coldBuckets: IndustryKey[];
  }
  const cellWork: CellWork[] = [];
  for (const c of cells) {
    const cold = scopeIndustries.filter((b) => {
      if (forceRefresh) return true;
      const t = lastPulled.get(`${c}|${b}`);
      return t == null || now - t >= TTL_MS;
    });
    if (cold.length === 0) continue;
    cellWork.push({
      cell: c,
      center: decodeGeohash(c),
      radiusM: cellCoverRadiusM(c),
      coldBuckets: cold,
    });
  }
  const warm = cellWork.length === 0;

  let rawCount = 0;
  let filteredCount = 0;
  let keptCount = 0;
  let coldCells = 0;

  // ---- Cold cells: pull Places per cell (bounded concurrency), classify ----
  let failedBuckets: Array<{ cell: string; bucket: IndustryKey; error: string }> = [];
  if (!warm) {
    coldCells = cellWork.length;
    interface CellPull {
      cell: string;
      pulls: BucketPull[];
      failed: Array<{ bucket: IndustryKey; error: string }>;
    }
    // Fetch cells with bounded concurrency (CELL_CONCURRENCY cells in flight,
    // each fanning out to its cold buckets in parallel) so a cold territory
    // doesn't open hundreds of sockets at once.
    const cellResults = await mapPool<CellWork, CellPull>(cellWork, CELL_CONCURRENCY, async (w) => {
      const { fulfilled, failed } = await fetchPlacesByCategory(
        w.center.lat,
        w.center.lng,
        w.radiusM,
        w.coldBuckets,
      );
      return { cell: w.cell, pulls: fulfilled, failed };
    });
    failedBuckets = cellResults.flatMap((cr) => cr.failed.map((f) => ({ cell: cr.cell, ...f })));

    const totalPulls = cellResults.reduce((n, cr) => n + cr.pulls.length, 0);
    // Every bucket of every cold cell failed → nothing to ingest; surface it.
    // (A partial failure falls through: ingest what we got, leave failed cold.)
    if (totalPulls === 0) {
      return json(
        {
          error: "places_fetch_failed",
          detail: failedBuckets
            .map((f) => `${f.cell}/${f.bucket}: ${f.error}`)
            .join("; ")
            .slice(0, 500),
        },
        502,
      );
    }

    // Dedup the union by place_id across ALL cells, assigning each business to
    // the FIRST (nearest) cell that returned it — cellResults follows the
    // nearest-first cell order — so a prospect's geo_cell is stable.
    const uniq = new Map<string, { place: PlacesNewPlace; cell: string }>();
    for (const cr of cellResults) {
      for (const { places } of cr.pulls) {
        for (const p of places) {
          if (!uniq.has(p.id)) uniq.set(p.id, { place: p, cell: cr.cell });
        }
      }
    }

    // Active exclusion seed patterns (curated chain list).
    const { data: seedRows } = await admin
      .from("exclusion_seed")
      .select("name_pattern, brand, brand_id")
      .eq("active", true);
    const seedPatterns = (seedRows ?? []).map((r) => ({
      pattern: r.name_pattern as string,
      brandId: (r.brand_id as string | null) ?? "",
      brand: r.brand as string,
    }));

    // Same-name density (FR-PATH-14): count across the WHOLE searched territory
    // (every covered cell) plus the new union. "Many same-name within radius"
    // spans cell boundaries, so territory-wide counting is more correct than
    // the old single-cell count.
    const nameCount = new Map<string, number>();
    const { data: existingNames } = await admin
      .from("prospects")
      .select("name")
      .in("geo_cell", cells);
    for (const row of existingNames ?? []) {
      const k = ((row.name as string) ?? "").toLowerCase();
      if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }
    for (const { place: p } of uniq.values()) {
      const k = (p.displayName?.text ?? "").toLowerCase();
      if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }

    // Classify each unique business ONCE. Store EVERY business (servable or not)
    // so the cache is complete; the read path filters to servable. `category`
    // is the COARSE bucket (bucketForType) — the same taxonomy that drove the
    // includedTypes pull, so ingest + display can't drift.
    const verdicts = new Map<string, IcpVerdict>();
    const rows = [...uniq.values()].map(({ place: p, cell: c }) => {
      const candidate: ProspectCandidate = {
        placeId: p.id,
        name: p.displayName?.text ?? "",
        types: p.types ?? [],
        employeeCount: null, // Places returns none; vendor-gated (PATH_DESIGN §6)
        primaryType: p.primaryType ?? null, // place-type tiebreak (Slice 5)
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
        category: bucketForType(p.types ?? [], p.primaryType ?? null),
        google_types: p.types ?? [],
        lat: p.location.latitude,
        lng: p.location.longitude,
        geo_cell: c,
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating_count: p.userRatingCount ?? null,
        rating: p.rating ?? null,
        // primaryType is the best-guess category; fall back to the first raw
        // type so a lead never loses its category (CSV: primary_type fallback).
        primary_type: p.primaryType ?? p.types?.[0] ?? null,
        is_chain: verdict.isChain,
        chain_reason: verdict.chainReason,
        chain_confidence: verdict.chainConfidence,
        chain_brand_id: verdict.chainBrandId,
        chain_brand_name: verdict.chainBrandName,
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

    // Observability + warm-mark each (cell, bucket) we actually pulled (FR-PATH-17).
    // Per-bucket counts are attributed from that bucket's own pull; failed
    // buckets are NOT marked, so they stay cold and retry next request.
    const pulledAt = new Date().toISOString();
    const cacheUpserts = cellResults.flatMap((cr) =>
      cr.pulls.map(({ bucket, places }) => {
        let kept = 0;
        let filtered = 0;
        for (const p of places) {
          const v = verdicts.get(p.id);
          if (v && !v.isChain && v.inProfile) kept++;
          else filtered++;
        }
        return {
          geo_cell: cr.cell,
          category: bucket,
          last_pulled_at: pulledAt,
          raw_count: places.length,
          filtered_count: filtered,
          kept_count: kept,
        };
      }),
    );
    if (cacheUpserts.length > 0) {
      const { error: cacheErr } = await admin
        .from("geo_cell_cache")
        .upsert(cacheUpserts, { onConflict: "geo_cell,category" });
      if (cacheErr) {
        return json({ error: "cache_update_failed", detail: cacheErr.message }, 500);
      }
    }
  }

  // ---- Read path: servable prospects, nearest first -----------------------
  // Goes through the user's JWT so the SECURITY DEFINER grant + RLS apply.
  // p_limit READ_LIMIT (500): a wide radius across many tiles can legitimately
  // surface far more than the old single-cell 30.
  const { data: nearby, error: rpcErr } = await userClient.rpc("prospects_nearby", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
    p_profession: profession,
    p_limit: READ_LIMIT,
    p_include_chains: includeChains,
  });
  if (rpcErr) {
    return json({ error: "nearby_query_failed", detail: rpcErr.message }, 500);
  }

  return json({
    cell: originCell,
    cells_searched: cells.length,
    cold_cells: coldCells,
    cache: warm ? "warm" : "cold",
    failed_buckets: failedBuckets,
    raw_count: rawCount,
    filtered_count: filteredCount,
    kept_count: keptCount,
    prospects: nearby ?? [],
  });
});
