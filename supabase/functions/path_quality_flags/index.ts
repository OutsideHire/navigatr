// Supabase Edge Function: path_quality_flags. Path Data Quality Fix v1.2, R4.
//
// For the deals behind the stops on a rep's day, says which ones Google lists
// as closed (from the cached prospect only) and which a teammate flagged as out
// of business or home-based. The day keeps every such stop (a commitment is
// never removed); this only lets it explain why the business is suspect.
//
//   POST { deal_ids: string[] } (Authorization: Bearer <user jwt>)
//     -> { enabled: boolean, flags: Array<{ deal_id, google_closed, suppressed }> }
//
// Lives behind the same PATH_QUALITY_FILTER switch as discover_prospects, which
// is why this is a function rather than a direct RPC call: the switch is a
// function setting the browser cannot read. Switched off -> { enabled: false,
// flags: [] } and the day shows no notes. Never calls Google.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { qualityFilterOn } from "../_shared/pathQuality.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// A day is a few dozen stops; this bounds a malformed request.
const MAX_DEAL_IDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Verify the caller is a real authenticated user (don't trust a raw header).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  if (!qualityFilterOn(Deno.env.get("PATH_QUALITY_FILTER"))) {
    return json({ enabled: false, flags: [] });
  }

  const body = (await req.json().catch(() => null)) as { deal_ids?: unknown } | null;
  const dealIds = Array.isArray(body?.deal_ids)
    ? [...new Set(body!.deal_ids.filter((d): d is string => typeof d === "string" && UUID_RE.test(d)))]
        .slice(0, MAX_DEAL_IDS)
    : [];
  if (dealIds.length === 0) {
    return json({ enabled: true, flags: [] });
  }

  // Through the caller's JWT: the function is security invoker, so deal RLS
  // decides which of these the caller may learn about.
  const { data, error } = await userClient.rpc("place_quality_flags", { p_deal_ids: dealIds });
  if (error) {
    return json({ error: "flags_query_failed", detail: error.message }, 500);
  }
  return json({ enabled: true, flags: data ?? [] });
});
