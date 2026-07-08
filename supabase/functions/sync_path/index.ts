// Two-way calendar sync, Milestone 3: mirror a planned, not-yet-started path
// (Plan a Path) to an ALL-DAY block on the rep's PRIMARY Google Calendar. This
// is the reconcile engine: given a path id, make the calendar match the path's
// state — create, update, or delete the all-day block — and write the result
// back onto the path (path_calendar_event_id / path_calendar_sync_status /
// path_calendar_error).
//
// A path block SHOULD exist iff the path is still 'planned' AND has not been
// started (started_at IS NULL). Once a rep begins running the route, or the path
// completes, the mirrored block is removed.
//
// Token loading mirrors sync_followup / sync_appointment / read_calendar_events:
// resolve the rep's active google oauth_connection (user client, RLS-scoped),
// read the Vault token bundle via the service-role RPC oauth_token_get, then
// getFreshAccessToken (persisting a refreshed bundle). Calendar-column
// write-backs go through the service-role client because RLS only lets the owner
// touch core fields. CALENDAR_MOCK=1 short-circuits all Google HTTP but still
// does the DB writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPathBlockEvent } from "../_shared/googleEvent.ts";
import { getFreshAccessToken, type TokenBundle } from "../_shared/googleToken.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "";
const CALENDAR_MOCK = Deno.env.get("CALENDAR_MOCK") === "1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// Google Calendar error/detail messages can be long; keep the persisted column
// bounded so a giant HTML error page never bloats the row.
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
}

/**
 * Resolve a currently-valid access token for the caller's google connection.
 * Returns null (the "needs_reconnect" signal) when there's no active connection
 * or the refresh fails. Persists a refreshed bundle exactly as
 * sync_followup / sync_appointment / read_calendar_events do.
 */
async function resolveAccessToken(
  userClient: ReturnType<typeof createClient>,
  svc: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data: conn } = await userClient
    .from("oauth_connections")
    .select("id, status")
    .eq("provider", "google")
    .eq("user_id", userId)
    .maybeSingle();

  if (!conn || (conn as { status?: string }).status !== "active") return null;
  const connectionId = (conn as { id: string }).id;

  try {
    const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: connectionId });
    if (!bundleJson) return null;
    const bundle = bundleJson as TokenBundle;

    const fresh = await getFreshAccessToken(bundle, {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    });
    if (fresh.refreshed) {
      await svc.rpc("oauth_token_set", { p_connection_id: connectionId, p_token: fresh.bundle });
      await svc
        .from("oauth_connections")
        .update({ last_refreshed_at: new Date().toISOString() })
        .eq("id", connectionId);
    }
    return fresh.accessToken;
  } catch {
    return null;
  }
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
    .select("id, name, path_date, status, started_at, path_calendar_event_id")
    .eq("id", pathId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!pathData) return json({ error: "not_found" }, 404);
  const path = pathData as unknown as PathRow;

  // Service-role client for all calendar-column write-backs (RLS only lets the
  // owner update core fields) and the Vault token RPCs (service_role-only).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Fresh token (mock skips Google entirely, so no connection is required).
  let accessToken = "";
  if (!CALENDAR_MOCK) {
    const token = await resolveAccessToken(userClient, svc, userId);
    if (!token) {
      await svc
        .from("paths")
        .update({ path_calendar_sync_status: "error", path_calendar_error: "needs_reconnect" })
        .eq("id", pathId);
      return json({ status: "needs_reconnect" });
    }
    accessToken = token;
  }

  const authFetch = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
    });

  // A path block should exist iff the path is still planned and hasn't been
  // started. Everything else (started, completed) drives delete.
  const shouldExist = path.status === "planned" && path.started_at == null;

  if (shouldExist) {
    const eventBody = buildPathBlockEvent({ id: path.id, name: path.name ?? "", pathDate: path.path_date });

    let pathEventId: string;
    if (CALENDAR_MOCK) {
      pathEventId = path.path_calendar_event_id ?? `mock-path-${path.id}`;
    } else {
      const isInsert = !path.path_calendar_event_id;
      const url = isInsert
        ? "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        : `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(path.path_calendar_event_id!)}`;
      try {
        const res = await authFetch(url, {
          method: isInsert ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventBody),
        });
        if (!res.ok) {
          const detail = truncate(`events.${isInsert ? "insert" : "patch"} http ${res.status}: ${await res.text().catch(() => "")}`);
          await svc
            .from("paths")
            .update({ path_calendar_sync_status: "error", path_calendar_error: detail })
            .eq("id", pathId);
          return json({ status: "error", detail });
        }
        const evData = (await res.json()) as { id?: string };
        // On PATCH Google echoes the same id; fall back to the existing one.
        pathEventId = evData.id ?? path.path_calendar_event_id ?? "";
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
        const res = await authFetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(path.path_calendar_event_id)}`,
          { method: "DELETE" },
        );
        // 404/410 = the event is already gone on Google's side; treat as success.
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          const detail = truncate(`events.delete http ${res.status}: ${await res.text().catch(() => "")}`);
          await svc
            .from("paths")
            .update({ path_calendar_sync_status: "error", path_calendar_error: detail })
            .eq("id", pathId);
          return json({ status: "error", detail });
        }
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
        path_calendar_sync_status: null,
        path_calendar_error: null,
      })
      .eq("id", pathId);
  }

  return json({ status: "ok" });
});
