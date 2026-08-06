// Two-way calendar sync, Milestone 2: mirror a deal's current follow-up
// (deals.next_followup_at) to an ALL-DAY event on the rep's PRIMARY calendar
// (Google OR Outlook). This is the reconcile engine: given a deal id, make the
// calendar match the deal's state — create, update, or delete the all-day event
// — and write the result back onto the deal (followup_calendar_event_id /
// followup_calendar_provider / followup_calendar_sync_status /
// followup_calendar_error).
//
// A follow-up event SHOULD exist iff the deal has a next_followup_at and is not
// in a terminal stage ('won' / 'lost'). Otherwise the mirrored event is removed.
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

// Terminal deal stages: no follow-up reminder should exist for a closed deal.
const TERMINAL_STAGES = new Set(["won", "lost"]);

interface FollowupDeal {
  id: string;
  company_name: string;
  owner_id: string;
  stage: string;
  next_followup_at: string | null;
  followup_calendar_event_id: string | null;
  followup_calendar_provider: string | null;
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
    .select("id, company_name, owner_id, stage, next_followup_at, followup_calendar_event_id, followup_calendar_provider")
    .eq("id", dealId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!dealRow) return json({ error: "not_found" }, 404);
  const deal = dealRow as unknown as FollowupDeal;
  const existingProvider = (deal.followup_calendar_provider as CalendarProviderId | null) ?? null;

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
        .from("deals")
        .update({ followup_calendar_sync_status: "error", followup_calendar_error: "needs_reconnect" })
        .eq("id", dealId);
      return json({ status: "needs_reconnect" });
    }
    provider = token.provider;
    accessToken = token.accessToken;
  }

  // A follow-up event should exist iff the deal has a follow-up date and is not
  // closed. Everything else drives create/update vs delete.
  const shouldExist = !!deal.next_followup_at && !TERMINAL_STAGES.has(deal.stage);

  if (shouldExist) {
    let followupEventId: string;
    if (CALENDAR_MOCK) {
      followupEventId = deal.followup_calendar_event_id ?? `mock-fup-${deal.id}`;
    } else {
      try {
        const { id } = await getProvider(provider).upsertEvent(accessToken, deal.followup_calendar_event_id, {
          kind: "followup",
          deal: { id: deal.id, companyName: deal.company_name },
          // next_followup_at is non-null here (guarded by shouldExist).
          followUpDateISO: deal.next_followup_at!,
        });
        followupEventId = id || (deal.followup_calendar_event_id ?? "");
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
        followup_calendar_provider: provider,
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
        await getProvider(provider).deleteEvent(accessToken, deal.followup_calendar_event_id);
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
        followup_calendar_provider: null,
        followup_calendar_sync_status: null,
        followup_calendar_error: null,
      })
      .eq("id", dealId);
  }

  return json({ status: "ok" });
});
