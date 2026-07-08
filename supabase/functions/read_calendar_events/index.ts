// Server-side read of a rep's work calendars for a day window. Loads ALL of the
// rep's active oauth_connections (Google and/or Microsoft), fetches a fresh
// access token per connection from Vault (refreshing + persisting when needed),
// lists events via the shared CalendarProvider abstraction, drops each
// connection's personal calendars, merges the union, classifies via the shared
// pure helper, geocodes located events, and returns clean waypoints/timeBlocks.
// Privacy: only rendered fields leave here; personal calendars are never
// surfaced. CALENDAR_MOCK=1 / MICROSOFT_CALENDAR_MOCK=1 short-circuit the network.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyEvent, type RawCalendarEvent } from "../_shared/calendarQualify.ts";
import type { TokenBundle } from "../_shared/googleToken.ts";
import { getProvider, type CalendarProviderId } from "../_shared/calendarProviders/index.ts";
import { applyPersonalFilter, mergeConnections, overallStatus } from "../_shared/mergeCalendarEvents.ts";
import { mockCalendarEvents, mockMicrosoftCalendarEvents } from "./fixtures.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const CALENDAR_MOCK = Deno.env.get("CALENDAR_MOCK") === "1";
const MICROSOFT_CALENDAR_MOCK = Deno.env.get("MICROSOFT_CALENDAR_MOCK") === "1";
const ANY_MOCK = CALENDAR_MOCK || MICROSOFT_CALENDAR_MOCK;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

interface ReadCalendarWaypoint { id: string; title: string; start: string; end: string; address: string; lat: number; lng: number; source: "calendar"; }
interface ReadCalendarTimeBlock { id: string; title: string; start: string; end: string; reason: "no_location" | "unmappable"; }

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  if (ANY_MOCK) return { lat: 35.66, lng: -97.46 };
  if (!GOOGLE_PLACES_API_KEY) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", GOOGLE_PLACES_API_KEY);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json() as { status: string; results?: Array<{ geometry: { location: { lat: number; lng: number } } }> };
  if (data.status !== "OK" || !data.results?.length) return null;
  return data.results[0].geometry.location;
}

interface CalendarConnection {
  id: string;
  provider: CalendarProviderId;
  status: string;
  config: { personalCalendarIds?: string[] } | null;
}

/**
 * Read one connection's events. Uses the service-role client to fetch a fresh
 * access token from Vault (refreshing + persisting when the provider rotated it),
 * then lists events in [windowStart, windowEnd] via the provider abstraction as
 * normalized RawCalendarEvent[]. The window range is passed straight through —
 * no UTC-date slicing. The caller applies the connection's personal filter.
 */
async function readConnection(
  svc: ReturnType<typeof createClient>,
  conn: CalendarConnection,
  windowStart: string,
  windowEnd: string,
): Promise<RawCalendarEvent[]> {
  const provider = getProvider(conn.provider);
  const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: conn.id });
  if (!bundleJson) throw new Error("no token bundle for connection");
  const bundle = bundleJson as TokenBundle;

  const fresh = await provider.refreshAccessToken(bundle, {
    clientId: Deno.env.get(provider.oauth.clientIdEnv) ?? "",
    clientSecret: Deno.env.get(provider.oauth.clientSecretEnv) ?? "",
  });
  if (fresh.refreshed) {
    await svc.rpc("oauth_token_set", { p_connection_id: conn.id, p_token: fresh.bundle });
    await svc
      .from("oauth_connections")
      .update({ last_refreshed_at: new Date().toISOString() })
      .eq("id", conn.id);
  }
  return provider.listEvents(fresh.accessToken, windowStart, windowEnd);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  const body = (await req.json().catch(() => null)) as { window_start?: string; window_end?: string } | null;
  const windowStart = typeof body?.window_start === "string" ? body.window_start : "";
  const windowEnd = typeof body?.window_end === "string" ? body.window_end : "";
  if (!windowStart || !windowEnd) return json({ error: "invalid_body", detail: "window_start/window_end required" }, 400);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  // Union of the rep's active calendar connections (Google and/or Microsoft).
  const { data: connsData } = await userClient
    .from("oauth_connections")
    .select("id, provider, status, config")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .in("provider", ["google", "microsoft"]);
  const connections = (connsData ?? []) as unknown as CalendarConnection[];

  if (!ANY_MOCK && connections.length === 0) {
    return json({ status: "not_connected", waypoints: [], timeBlocks: [], skippedCount: 0 });
  }

  // Personal-calendar ids across all active connections. Passed to classifyEvent
  // as belt-and-suspenders (the per-connection applyPersonalFilter already removed
  // them from the union) and to mirror the mock's personal-calendar exclusion.
  const personalCalendarIds: string[] = connections.flatMap((c) => c.config?.personalCalendarIds ?? []);

  let raw: RawCalendarEvent[];
  let status: "ok" | "needs_reconnect" | "not_connected";

  if (ANY_MOCK) {
    const perConnection: RawCalendarEvent[][] = [];
    if (CALENDAR_MOCK) perConnection.push(mockCalendarEvents(windowStart));
    if (MICROSOFT_CALENDAR_MOCK) perConnection.push(mockMicrosoftCalendarEvents(windowStart));
    raw = mergeConnections(perConnection);
    status = "ok";
  } else {
    // Service-role client is required to read the token bundle via the vault RPCs
    // (execute is service_role-only) and to persist a refreshed token.
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    // Non-blocking: a connection whose token refresh / list throws is dropped
    // (that provider needs reconnect) while the others still return their events.
    const perConnection = await Promise.all(
      connections.map(async (conn) => {
        try {
          const events = await readConnection(svc, conn, windowStart, windowEnd);
          return { ok: true, events: applyPersonalFilter(events, conn.config?.personalCalendarIds ?? []) };
        } catch {
          return { ok: false, events: [] as RawCalendarEvent[] };
        }
      }),
    );
    raw = mergeConnections(perConnection.map((r) => r.events));
    status = overallStatus(perConnection.map((r) => ({ ok: r.ok })));
  }

  // First pass: classify. Located events are collected for parallel geocoding;
  // time blocks and skips resolve immediately.
  const timeBlocks: ReadCalendarTimeBlock[] = [];
  let skipped = 0;
  const located: RawCalendarEvent[] = [];
  for (const ev of raw) {
    const cls = classifyEvent(ev, personalCalendarIds);
    if (cls === "excluded") { skipped++; continue; }
    const title = ev.summary ?? "(no title)";
    if (cls === "time_block") { timeBlocks.push({ id: ev.id, title, start: ev.start!, end: ev.end!, reason: "no_location" }); continue; }
    located.push(ev);
  }

  // Second pass: geocode all located events at once.
  const geos = await Promise.all(located.map((ev) => geocode(ev.location!.trim())));
  const waypoints: ReadCalendarWaypoint[] = [];
  located.forEach((ev, i) => {
    const title = ev.summary ?? "(no title)";
    const geo = geos[i];
    if (!geo) { timeBlocks.push({ id: ev.id, title, start: ev.start!, end: ev.end!, reason: "unmappable" }); return; }
    waypoints.push({ id: ev.id, title, start: ev.start!, end: ev.end!, address: ev.location!.trim(), lat: geo.lat, lng: geo.lng, source: "calendar" });
  });
  return json({ status, waypoints, timeBlocks, skippedCount: skipped });
});
