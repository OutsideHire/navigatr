// Two-way calendar sync, Milestone 1: push a booked appointment to the rep's
// PRIMARY Google Calendar. The client calls this after inserting/cancelling a
// row in `scheduled_appointments`; here we upsert (insert or patch) or delete
// the mirrored Google event and write the result back onto the appointment row
// (calendar_event_id / calendar_sync_status / calendar_sync_error).
//
// Token loading mirrors read_calendar_events: resolve the rep's active google
// oauth_connection (user client, RLS-scoped), read the Vault token bundle via
// the service-role RPC oauth_token_get, then getFreshAccessToken (persisting a
// refreshed bundle). Calendar-column write-backs go through the service-role
// client because RLS only lets the owner touch core fields.
// CALENDAR_MOCK=1 short-circuits all Google HTTP but still does the DB writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGoogleEventPayload } from "../_shared/googleEvent.ts";
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

interface ScheduledAppointment {
  id: string;
  deal_id: string;
  title: string;
  start_at: string;
  end_at: string;
  location_address: string | null;
  notes: string | null;
  calendar_event_id: string | null;
}

/**
 * Collect deduped attendee emails for a deal: the deal's primary contact_email
 * plus every deal_contacts.email. Read via the service-role client so the
 * lookup doesn't depend on the caller's per-row visibility (the caller already
 * proved ownership of the appointment). Only non-empty values containing "@".
 */
async function loadAttendeeEmails(
  svc: ReturnType<typeof createClient>,
  dealId: string,
): Promise<string[]> {
  const [{ data: deal }, { data: contacts }] = await Promise.all([
    svc.from("deals").select("contact_email").eq("id", dealId).maybeSingle(),
    svc.from("deal_contacts").select("email").eq("deal_id", dealId),
  ]);

  const raw: Array<string | null | undefined> = [
    (deal as { contact_email?: string | null } | null)?.contact_email,
    ...(((contacts as Array<{ email?: string | null }> | null) ?? []).map((c) => c.email)),
  ];

  const seen = new Set<string>();
  for (const value of raw) {
    const email = typeof value === "string" ? value.trim() : "";
    if (email && email.includes("@")) seen.add(email);
  }
  return [...seen];
}

/**
 * Resolve a currently-valid access token for the caller's google connection.
 * Returns null (the "needs_reconnect" signal) when there's no active connection
 * or the refresh fails. Persists a refreshed bundle exactly as
 * read_calendar_events does.
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

  const body = (await req.json().catch(() => null)) as { appointment_id?: string; action?: string } | null;
  const appointmentId = typeof body?.appointment_id === "string" ? body.appointment_id : "";
  const action = body?.action;
  if (!appointmentId) return json({ error: "invalid_body", detail: "appointment_id required" }, 400);
  if (action !== "upsert" && action !== "delete") {
    return json({ error: "invalid_body", detail: "action must be 'upsert' or 'delete'" }, 400);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // Load the appointment via the USER client, scoped to owner_id. A 404 here
  // means either it doesn't exist or the caller doesn't own it — same signal.
  const { data: apptRow } = await userClient
    .from("scheduled_appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!apptRow) return json({ error: "not_found" }, 404);
  const appt = apptRow as unknown as ScheduledAppointment;

  // Service-role client for all calendar-column write-backs (RLS only lets the
  // owner update core fields) and the Vault token RPCs (service_role-only).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Fresh token (mock skips Google entirely, so no connection is required).
  let accessToken = "";
  if (!CALENDAR_MOCK) {
    const token = await resolveAccessToken(userClient, svc, userId);
    if (!token) {
      await svc
        .from("scheduled_appointments")
        .update({ calendar_sync_status: "error", calendar_sync_error: "needs_reconnect" })
        .eq("id", appointmentId);
      return json({ status: "needs_reconnect" });
    }
    accessToken = token;
  }

  const authFetch = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
    });

  if (action === "delete") {
    if (appt.calendar_event_id) {
      if (!CALENDAR_MOCK) {
        try {
          const res = await authFetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(appt.calendar_event_id)}`,
            { method: "DELETE" },
          );
          // 404/410 = the event is already gone on Google's side; treat as success.
          if (!res.ok && res.status !== 404 && res.status !== 410) {
            const detail = truncate(`events.delete http ${res.status}: ${await res.text().catch(() => "")}`);
            await svc
              .from("scheduled_appointments")
              .update({ calendar_sync_status: "error", calendar_sync_error: detail })
              .eq("id", appointmentId);
            return json({ status: "error", detail });
          }
        } catch (err) {
          const detail = truncate(err instanceof Error ? err.message : String(err));
          await svc
            .from("scheduled_appointments")
            .update({ calendar_sync_status: "error", calendar_sync_error: detail })
            .eq("id", appointmentId);
          return json({ status: "error", detail });
        }
      }
      // Clear the mirror link. The row's status='cancelled' is set by the
      // caller — we deliberately don't touch it here.
      await svc
        .from("scheduled_appointments")
        .update({ calendar_event_id: null })
        .eq("id", appointmentId);
    }
    return json({ status: "ok" });
  }

  // action === "upsert"
  const attendeeEmails = await loadAttendeeEmails(svc, appt.deal_id);
  const eventBody = buildGoogleEventPayload(
    {
      id: appt.id,
      title: appt.title,
      startAt: appt.start_at,
      endAt: appt.end_at,
      locationAddress: appt.location_address,
      notes: appt.notes,
    },
    attendeeEmails,
    // start_at/end_at are absolute ISO instants; "UTC" places the correct
    // moment. Per-rep timezone refinement is a later milestone.
    "UTC",
  );

  let calendarEventId: string;
  if (CALENDAR_MOCK) {
    calendarEventId = appt.calendar_event_id ?? `mock-evt-${appt.id}`;
  } else {
    const isInsert = !appt.calendar_event_id;
    const url = isInsert
      ? "https://www.googleapis.com/calendar/v3/calendars/primary/events"
      : `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(appt.calendar_event_id!)}`;
    try {
      const res = await authFetch(url, {
        method: isInsert ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      if (!res.ok) {
        const detail = truncate(`events.${isInsert ? "insert" : "patch"} http ${res.status}: ${await res.text().catch(() => "")}`);
        await svc
          .from("scheduled_appointments")
          .update({ calendar_sync_status: "error", calendar_sync_error: detail })
          .eq("id", appointmentId);
        return json({ status: "error", detail });
      }
      const evData = (await res.json()) as { id?: string };
      // On PATCH Google echoes the same id; fall back to the existing one.
      calendarEventId = evData.id ?? appt.calendar_event_id ?? "";
    } catch (err) {
      const detail = truncate(err instanceof Error ? err.message : String(err));
      await svc
        .from("scheduled_appointments")
        .update({ calendar_sync_status: "error", calendar_sync_error: detail })
        .eq("id", appointmentId);
      return json({ status: "error", detail });
    }
  }

  await svc
    .from("scheduled_appointments")
    .update({
      calendar_event_id: calendarEventId,
      calendar_sync_status: "synced",
      calendar_sync_error: null,
    })
    .eq("id", appointmentId);
  return json({ status: "ok", calendar_event_id: calendarEventId });
});
