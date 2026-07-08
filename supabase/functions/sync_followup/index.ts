// Two-way calendar sync, Milestone 2: mirror a deal's current follow-up
// (deals.next_followup_at) to an ALL-DAY event on the rep's PRIMARY Google
// Calendar. This is the reconcile engine: given a deal id, make the calendar
// match the deal's state — create, update, or delete the all-day event — and
// write the result back onto the deal (followup_calendar_event_id /
// followup_calendar_sync_status / followup_calendar_error).
//
// A follow-up event SHOULD exist iff the deal has a next_followup_at and is not
// in a terminal stage ('won' / 'lost'). Otherwise the mirrored event is removed.
//
// Token loading mirrors sync_appointment / read_calendar_events: resolve the
// rep's active google oauth_connection (user client, RLS-scoped), read the Vault
// token bundle via the service-role RPC oauth_token_get, then getFreshAccessToken
// (persisting a refreshed bundle). Calendar-column write-backs go through the
// service-role client because RLS only lets the owner touch core fields.
// CALENDAR_MOCK=1 short-circuits all Google HTTP but still does the DB writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildFollowupEvent } from "../_shared/googleEvent.ts";
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

// Terminal deal stages: no follow-up reminder should exist for a closed deal.
const TERMINAL_STAGES = new Set(["won", "lost"]);

interface FollowupDeal {
  id: string;
  company_name: string;
  owner_id: string;
  stage: string;
  next_followup_at: string | null;
  followup_calendar_event_id: string | null;
}

/**
 * Resolve a currently-valid access token for the caller's google connection.
 * Returns null (the "needs_reconnect" signal) when there's no active connection
 * or the refresh fails. Persists a refreshed bundle exactly as
 * sync_appointment / read_calendar_events do.
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

  const body = (await req.json().catch(() => null)) as { deal_id?: string } | null;
  const dealId = typeof body?.deal_id === "string" ? body.deal_id : "";
  if (!dealId) return json({ error: "invalid_body", detail: "deal_id required" }, 400);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // Load the deal via the USER client, scoped to owner_id. A 404 here means
  // either it doesn't exist or the caller doesn't own it — same signal.
  const { data: dealRow } = await userClient
    .from("deals")
    .select("id, company_name, owner_id, stage, next_followup_at, followup_calendar_event_id")
    .eq("id", dealId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!dealRow) return json({ error: "not_found" }, 404);
  const deal = dealRow as unknown as FollowupDeal;

  // Service-role client for all calendar-column write-backs (RLS only lets the
  // owner update core fields) and the Vault token RPCs (service_role-only).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Fresh token (mock skips Google entirely, so no connection is required).
  let accessToken = "";
  if (!CALENDAR_MOCK) {
    const token = await resolveAccessToken(userClient, svc, userId);
    if (!token) {
      await svc
        .from("deals")
        .update({ followup_calendar_sync_status: "error", followup_calendar_error: "needs_reconnect" })
        .eq("id", dealId);
      return json({ status: "needs_reconnect" });
    }
    accessToken = token;
  }

  const authFetch = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
    });

  // A follow-up event should exist iff the deal has a follow-up date and is not
  // closed. Everything else drives create/update vs delete.
  const shouldExist = !!deal.next_followup_at && !TERMINAL_STAGES.has(deal.stage);

  if (shouldExist) {
    const eventBody = buildFollowupEvent(
      { id: deal.id, companyName: deal.company_name },
      // next_followup_at is non-null here (guarded by shouldExist).
      deal.next_followup_at!,
    );

    let followupEventId: string;
    if (CALENDAR_MOCK) {
      followupEventId = deal.followup_calendar_event_id ?? `mock-fup-${deal.id}`;
    } else {
      const isInsert = !deal.followup_calendar_event_id;
      const url = isInsert
        ? "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        : `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(deal.followup_calendar_event_id!)}`;
      try {
        const res = await authFetch(url, {
          method: isInsert ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventBody),
        });
        if (!res.ok) {
          const detail = truncate(`events.${isInsert ? "insert" : "patch"} http ${res.status}: ${await res.text().catch(() => "")}`);
          await svc
            .from("deals")
            .update({ followup_calendar_sync_status: "error", followup_calendar_error: detail })
            .eq("id", dealId);
          return json({ status: "error", detail });
        }
        const evData = (await res.json()) as { id?: string };
        // On PATCH Google echoes the same id; fall back to the existing one.
        followupEventId = evData.id ?? deal.followup_calendar_event_id ?? "";
      } catch (err) {
        const detail = truncate(err instanceof Error ? err.message : String(err));
        await svc
          .from("deals")
          .update({ followup_calendar_sync_status: "error", followup_calendar_error: detail })
          .eq("id", dealId);
        return json({ status: "error", detail });
      }
    }

    await svc
      .from("deals")
      .update({
        followup_calendar_event_id: followupEventId,
        followup_calendar_sync_status: "synced",
        followup_calendar_error: null,
      })
      .eq("id", dealId);
    return json({ status: "ok", followup_calendar_event_id: followupEventId });
  }

  // shouldExist === false: remove the mirrored event if one exists, then clear
  // the deal's calendar columns back to a clean "no follow-up" state.
  if (deal.followup_calendar_event_id) {
    if (!CALENDAR_MOCK) {
      try {
        const res = await authFetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(deal.followup_calendar_event_id)}`,
          { method: "DELETE" },
        );
        // 404/410 = the event is already gone on Google's side; treat as success.
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          const detail = truncate(`events.delete http ${res.status}: ${await res.text().catch(() => "")}`);
          await svc
            .from("deals")
            .update({ followup_calendar_sync_status: "error", followup_calendar_error: detail })
            .eq("id", dealId);
          return json({ status: "error", detail });
        }
      } catch (err) {
        const detail = truncate(err instanceof Error ? err.message : String(err));
        await svc
          .from("deals")
          .update({ followup_calendar_sync_status: "error", followup_calendar_error: detail })
          .eq("id", dealId);
        return json({ status: "error", detail });
      }
    }
    await svc
      .from("deals")
      .update({
        followup_calendar_event_id: null,
        followup_calendar_sync_status: null,
        followup_calendar_error: null,
      })
      .eq("id", dealId);
  }

  return json({ status: "ok" });
});
