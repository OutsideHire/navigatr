// Supabase Edge Function: refresh_place_ids — Google Place ID caching compliance.
//
// Google's Places terms let us store a place_id indefinitely ONLY if we refresh
// it on a cycle: a Place Details call with an ID-ONLY field mask is FREE and
// returns the current place_id (which Google can re-issue). Robert's ruling:
//   - place_id: permanent key on the deal, refreshed if older than 12 months
//   - the id-only refresh is free and is the ONLY ongoing Google obligation;
//     once the rep saves a deal, name/address/coords/phone are treated as
//     rep-entered CRM data (place_id is just the link back to Google)
//
// CRITICAL BILLING NOTE: this call is STANDALONE — it must NOT carry a session
// token. An id-only Place Details call that closes an Autocomplete session
// reprices that whole session to per-request billing. This job has no session;
// it is a bare, free id-only lookup. (The create-flow resolver, resolve_place,
// deliberately keeps its full field mask so its session closes correctly.)
//
// Run by pg_cron (migration 20260808000005) once a month. Batches stale rows so
// one invocation is bounded. PLACES_MOCK=1 short-circuits to a no-op refresh
// (returns the same id) so it is safe to schedule before live Places is on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const PLACES_MOCK = Deno.env.get("PLACES_MOCK") === "1";

// Refresh anything whose cached place_id is older than this (or never stamped).
const REFRESH_AFTER_DAYS = 365;
// Max rows to refresh per invocation, so a monthly run stays bounded. The
// id-only call is free, so this caps request VOLUME/time, not cost.
const BATCH_LIMIT = 500;
// How many id-only lookups to run at once.
const CONCURRENCY = 6;

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

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
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

/** Free id-only Place Details refresh. NO session token (see file header).
 *  Returns the current place_id, or null if Google can no longer resolve it. */
async function refreshPlaceId(placeId: string): Promise<string | null> {
  if (PLACES_MOCK) return placeId; // mock: id is unchanged, still bumps the stamp
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "id", // id-only -> free
    },
  });
  if (res.status === 404 || res.status === 400) return null; // place gone / bad id
  if (!res.ok) throw new Error(`Places id refresh ${res.status}`);
  const data = (await res.json()) as { id?: string };
  return data.id ?? placeId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!PLACES_MOCK && !GOOGLE_PLACES_API_KEY) {
    return json({ error: "places_unavailable", detail: "live Places is off (no key, PLACES_MOCK unset)" }, 503);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const cutoffIso = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Stale = has a place_id AND (never stamped OR stamped before the cutoff).
  const { data: rows, error: selErr } = await admin
    .from("deals")
    .select("id, place_id, place_synced_at")
    .not("place_id", "is", null)
    .or(`place_synced_at.is.null,place_synced_at.lt.${cutoffIso}`)
    .limit(BATCH_LIMIT);
  if (selErr) {
    return json({ error: "select_failed", detail: selErr.message }, 500);
  }
  const stale = (rows ?? []) as Array<{ id: string; place_id: string; place_synced_at: string | null }>;
  if (stale.length === 0) {
    return json({ scanned: 0, refreshed: 0, unresolved: 0, remaining: false });
  }

  const nowIso = new Date().toISOString();
  let refreshed = 0;
  let unresolved = 0;

  await mapPool(stale, CONCURRENCY, async (row) => {
    let currentId: string | null;
    try {
      currentId = await refreshPlaceId(row.place_id);
    } catch {
      // Transient error — leave the stamp untouched so the next run retries.
      return;
    }
    if (currentId === null) {
      // Google no longer resolves this id. Clear place_id so we stop trying to
      // refresh it (the deal keeps its rep-entered fields); it just loses the
      // Google link. Stamp so it drops out of the stale set.
      unresolved++;
      await admin.from("deals").update({ place_id: null, place_synced_at: nowIso }).eq("id", row.id);
      return;
    }
    refreshed++;
    const patch: Record<string, unknown> = { place_synced_at: nowIso };
    if (currentId !== row.place_id) patch.place_id = currentId;
    await admin.from("deals").update(patch).eq("id", row.id);
  });

  return json({
    scanned: stale.length,
    refreshed,
    unresolved,
    // A full batch means more may be stale; the next scheduled run continues.
    remaining: stale.length === BATCH_LIMIT,
  });
});
