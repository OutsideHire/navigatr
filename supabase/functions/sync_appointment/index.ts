// Two-way calendar sync, Milestone 1: push a booked appointment to the rep's
// PRIMARY calendar (Google OR Outlook). The client calls this after inserting/
// cancelling a row in `scheduled_appointments`; here we upsert (insert or patch)
// or delete the mirrored event and write the result back onto the appointment
// row (calendar_event_id / calendar_provider / calendar_sync_status /
// calendar_sync_error).
//
// Provider is resolved per rep (resolvePushToken): keep an existing mirror's
// provider, else prefer Google when both are connected. The event body + HTTP
// live behind the provider (upsertEvent/deleteEvent); Google's JSON is
// byte-identical to before. CALENDAR_MOCK=1 short-circuits all provider HTTP but
// still does the DB writes.
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

// Provider error/detail messages can be long; keep the persisted column bounded
// so a giant HTML error page never bloats the row.
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
  calendar_provider: string | null;
}

/**
 * Collect deduped attendee emails for a deal: the deal's primary contact_email
 * plus every deal_contacts.email. Read via the service-role client so the
 * lookup doesn't depend on the caller's per-row visibility (the caller already
 * proved ownership of the appointment). Only non-empty values containing "@".
 */
async function loadAttendeeEmails(
  // deno-lint-ignore no-explicit-any
  svc: any,
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
  const existingProvider = (appt.calendar_provider as CalendarProviderId | null) ?? null;

  // Service-role client for all calendar-column write-backs (RLS only lets the
  // owner update core fields) and the Vault token RPCs (service_role-only).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Resolve the rep's push target + a fresh token (mock skips this entirely, so
  // no connection is required). Under mock we keep any existing provider, else
  // default to google, purely so the stamped column is consistent.
  let provider: CalendarProviderId = existingProvider ?? "google";
  let accessToken = "";
  if (!CALENDAR_MOCK) {
    const token = await resolvePushToken(userClient, svc, userId, existingProvider);
    if (!token) {
      await svc
        .from("scheduled_appointments")
        .update({ calendar_sync_status: "error", calendar_sync_error: "needs_reconnect" })
        .eq("id", appointmentId);
      return json({ status: "needs_reconnect" });
    }
    provider = token.provider;
    accessToken = token.accessToken;
  }

  if (action === "delete") {
    if (appt.calendar_event_id) {
      if (!CALENDAR_MOCK) {
        try {
          await getProvider(provider).deleteEvent(accessToken, appt.calendar_event_id);
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

  let calendarEventId: string;
  if (CALENDAR_MOCK) {
    calendarEventId = appt.calendar_event_id ?? `mock-evt-${appt.id}`;
  } else {
    try {
      const { id } = await getProvider(provider).upsertEvent(accessToken, appt.calendar_event_id, {
        kind: "appointment",
        appt: {
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
        timeZone: "UTC",
      });
      calendarEventId = id || (appt.calendar_event_id ?? "");
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
      calendar_provider: provider,
      calendar_sync_status: "synced",
      calendar_sync_error: null,
    })
    .eq("id", appointmentId);
  return json({ status: "ok", calendar_event_id: calendarEventId });
});
