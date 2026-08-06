// Two-way calendar sync, Milestone 3: mirror a planned, not-yet-started path
// (Plan a Path) to an ALL-DAY block on the rep's PRIMARY calendar (Google OR
// Outlook). This is the reconcile engine: given a path id, make the calendar
// match the path's state — create, update, or delete the all-day block — and
// write the result back onto the path (path_calendar_event_id /
// path_calendar_provider / path_calendar_sync_status / path_calendar_error).
//
// A path block SHOULD exist iff the path is still 'planned' AND has not been
// started (started_at IS NULL). Once a rep begins running the route, or the path
// completes, the mirrored block is removed.
//
// Provider is resolved per rep (resolvePushToken): keep an existing mirror's
// provider, else prefer Google when both are connected. The all-day body + HTTP
// live behind the provider; Google's JSON is byte-identical to before.
// CALENDAR_MOCK=1 short-circuits all provider HTTP but still does the DB writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getProvider, type CalendarProviderId } from "../_shared/calendarProviders/index.ts";
import { resolvePushToken } from "../_shared/calendarPush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALENDAR_MOCK = Deno.env.get("CALENDAR_MOCK") === "1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// Provider error/detail messages can be long; keep the persisted column bounded.
function truncate(msg: string, max = 500): string {
  return msg.length > max ? msg.slice(0, max) : msg;
}

interface PathRow {
  id: string;
  name: string | null;
  path_date: string;
  status: string;
  started_at: string | null;
  path_calendar_event_id: string | null;
  path_calendar_provider: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  const body = (await req.json().catch(() => null)) as { path_id?: string } | null;
  const pathId = typeof body?.path_id === "string" ? body.path_id : "";
  if (!pathId) return json({ error: "invalid_body", detail: "path_id required" }, 400);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // Load the path via the USER client, scoped to user_id (⚠ paths use user_id,
  // NOT owner_id). A 404 here means either it doesn't exist or the caller doesn't
  // own it — same signal.
  const { data: pathData } = await userClient
    .from("paths")
    .select("id, name, path_date, status, started_at, path_calendar_event_id, path_calendar_provider")
    .eq("id", pathId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!pathData) return json({ error: "not_found" }, 404);
  const path = pathData as unknown as PathRow;
  const existingProvider = (path.path_calendar_provider as CalendarProviderId | null) ?? null;

  // Service-role client for all calendar-column write-backs (RLS only lets the
  // owner update core fields) and the Vault token RPCs (service_role-only).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Resolve push target + fresh token (mock skips this, so no connection needed).
  let provider: CalendarProviderId = existingProvider ?? "google";
  let accessToken = "";
  if (!CALENDAR_MOCK) {
    const token = await resolvePushToken(userClient, svc, userId, existingProvider);
    if (!token) {
      await svc
        .from("paths")
        .update({ path_calendar_sync_status: "error", path_calendar_error: "needs_reconnect" })
        .eq("id", pathId);
      return json({ status: "needs_reconnect" });
    }
    provider = token.provider;
    accessToken = token.accessToken;
  }

  // A path block should exist iff the path is still planned and hasn't been
  // started. Everything else (started, completed) drives delete.
  const shouldExist = path.status === "planned" && path.started_at == null;

  if (shouldExist) {
    let pathEventId: string;
    if (CALENDAR_MOCK) {
      pathEventId = path.path_calendar_event_id ?? `mock-path-${path.id}`;
    } else {
      try {
        const { id } = await getProvider(provider).upsertEvent(accessToken, path.path_calendar_event_id, {
          kind: "path",
          path: { id: path.id, name: path.name ?? "", pathDate: path.path_date },
        });
        pathEventId = id || (path.path_calendar_event_id ?? "");
      } catch (err) {
        const detail = truncate(err instanceof Error ? err.message : String(err));
        await svc
          .from("paths")
          .update({ path_calendar_sync_status: "error", path_calendar_error: detail })
          .eq("id", pathId);
        return json({ status: "error", detail });
      }
    }

    await svc
      .from("paths")
      .update({
        path_calendar_event_id: pathEventId,
        path_calendar_provider: provider,
        path_calendar_sync_status: "synced",
        path_calendar_error: null,
      })
      .eq("id", pathId);
    return json({ status: "ok", path_calendar_event_id: pathEventId });
  }

  // shouldExist === false: remove the mirrored block if one exists, then clear
  // the path's calendar columns back to a clean "no block" state.
  if (path.path_calendar_event_id) {
    if (!CALENDAR_MOCK) {
      try {
        await getProvider(provider).deleteEvent(accessToken, path.path_calendar_event_id);
      } catch (err) {
        const detail = truncate(err instanceof Error ? err.message : String(err));
        await svc
          .from("paths")
          .update({ path_calendar_sync_status: "error", path_calendar_error: detail })
          .eq("id", pathId);
        return json({ status: "error", detail });
      }
    }
    await svc
      .from("paths")
      .update({
        path_calendar_event_id: null,
        path_calendar_provider: null,
        path_calendar_sync_status: null,
        path_calendar_error: null,
      })
      .eq("id", pathId);
  }

  return json({ status: "ok" });
});
