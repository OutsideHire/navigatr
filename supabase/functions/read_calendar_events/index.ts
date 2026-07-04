// Server-side read of a rep's Google Calendar for a day window. Loads the rep's
// google oauth_connection + token from Vault, lists events per non-personal
// calendar, classifies via the shared pure helper, geocodes located events, and
// returns clean waypoints/timeBlocks. Privacy: only rendered fields leave here;
// personal calendars are never read. CALENDAR_MOCK=1 short-circuits Google.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyEvent, type RawCalendarEvent } from "../_shared/calendarQualify.ts";
import { getFreshAccessToken, type TokenBundle } from "../_shared/googleToken.ts";
import { mockCalendarEvents } from "./fixtures.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
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

interface ReadCalendarWaypoint { id: string; title: string; start: string; end: string; address: string; lat: number; lng: number; source: "calendar"; }
interface ReadCalendarTimeBlock { id: string; title: string; start: string; end: string; reason: "no_location" | "unmappable"; }

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  if (CALENDAR_MOCK) return { lat: 35.66, lng: -97.46 };
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

interface GoogleCalendarListItem { id: string; summary?: string; primary?: boolean; }
interface GoogleEventItem {
  id: string;
  summary?: string;
  location?: string;
  status?: string;
  visibility?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

/**
 * Real Google Calendar read. Uses a service-role client to fetch a fresh access
 * token from Vault (refreshing + persisting when needed), lists the rep's
 * calendars, skips personal ones, then reads events in [windowStart, windowEnd]
 * per remaining calendar and maps them to RawCalendarEvent. The window range is
 * passed straight through as timeMin/timeMax (RFC3339) — no UTC-date slicing.
 */
async function readGoogle(
  svc: ReturnType<typeof createClient>,
  connectionId: string,
  personalCalendarIds: string[],
  windowStart: string,
  windowEnd: string,
): Promise<RawCalendarEvent[]> {
  const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: connectionId });
  if (!bundleJson) throw new Error("no token bundle for connection");
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
  const accessToken = fresh.accessToken;
  const authFetch = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  // 1. List calendars, skip the rep's personal ones.
  const listRes = await authFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  if (!listRes.ok) throw new Error(`calendarList http ${listRes.status}`);
  const listData = (await listRes.json()) as { items?: GoogleCalendarListItem[] };
  const calendars = (listData.items ?? []).filter((c) => !personalCalendarIds.includes(c.id));

  // 2. Read events per calendar over the window, in parallel.
  const perCalendar = await Promise.all(
    calendars.map(async (cal): Promise<RawCalendarEvent[]> => {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`,
      );
      url.searchParams.set("timeMin", windowStart);
      url.searchParams.set("timeMax", windowEnd);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "250");
      const evRes = await authFetch(url.toString());
      if (!evRes.ok) throw new Error(`events.list http ${evRes.status}`);
      const evData = (await evRes.json()) as { items?: GoogleEventItem[] };
      return (evData.items ?? []).map((item): RawCalendarEvent => {
        const self = item.attendees?.find((a) => a.self === true);
        return {
          id: item.id,
          calendarId: cal.id,
          summary: item.summary ?? null,
          start: item.start?.dateTime ?? null,
          end: item.end?.dateTime ?? null,
          isAllDay: !!item.start?.date && !item.start?.dateTime,
          status: item.status ?? null,
          visibility: item.visibility ?? null,
          responseStatus: self?.responseStatus ?? null,
          location: item.location ?? null,
        };
      });
    }),
  );
  return perCalendar.flat();
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

  const { data: conn } = await userClient
    .from("oauth_connections")
    .select("id, status, config")
    .eq("provider", "google")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!CALENDAR_MOCK && (!conn || conn.status !== "active")) {
    return json({ status: conn ? "needs_reconnect" : "not_connected", waypoints: [], timeBlocks: [], skippedCount: 0 });
  }
  const personalCalendarIds: string[] = (conn?.config?.personalCalendarIds as string[] | undefined) ?? [];

  let raw: RawCalendarEvent[];
  try {
    if (CALENDAR_MOCK) {
      raw = mockCalendarEvents(windowStart);
    } else {
      // Service-role client is required to read the token bundle via the vault
      // RPCs (execute is service_role-only) and to persist a refreshed token.
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      raw = await readGoogle(svc, conn!.id as string, personalCalendarIds, windowStart, windowEnd);
    }
  } catch {
    return json({ status: "needs_reconnect", waypoints: [], timeBlocks: [], skippedCount: 0 });
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
  return json({ status: "ok", waypoints, timeBlocks, skippedCount: skipped });
});
