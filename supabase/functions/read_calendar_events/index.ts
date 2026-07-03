// Server-side read of a rep's Google Calendar for a day window. Loads the rep's
// google oauth_connection + token from Vault, lists events per non-personal
// calendar, classifies via the shared pure helper, geocodes located events, and
// returns clean waypoints/timeBlocks. Privacy: only rendered fields leave here;
// personal calendars are never read. CALENDAR_MOCK=1 short-circuits Google.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyEvent, type RawCalendarEvent } from "../_shared/calendarQualify.ts";
import { mockCalendarEvents } from "./fixtures.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
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

// Real Google read — implemented in a later task; mock covers slice-1.
async function readGoogle(_accessToken: string, _windowStart: string, _windowEnd: string): Promise<RawCalendarEvent[]> {
  throw new Error("readGoogle not implemented under CALENDAR_MOCK=0 until the OAuth task");
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
    .select("status, config")
    .eq("provider", "google")
    .maybeSingle();

  if (!CALENDAR_MOCK && (!conn || conn.status !== "active")) {
    return json({ status: conn ? "needs_reconnect" : "not_connected", waypoints: [], timeBlocks: [], skippedCount: 0 });
  }
  const personalCalendarIds: string[] = (conn?.config?.personalCalendarIds as string[] | undefined) ?? [];

  let raw: RawCalendarEvent[];
  try {
    raw = CALENDAR_MOCK ? mockCalendarEvents(windowStart) : await readGoogle("<token-from-oauth-task>", windowStart, windowEnd);
  } catch {
    return json({ status: "needs_reconnect", waypoints: [], timeBlocks: [], skippedCount: 0 });
  }

  const waypoints: ReadCalendarWaypoint[] = [];
  const timeBlocks: ReadCalendarTimeBlock[] = [];
  let skipped = 0;
  for (const ev of raw) {
    const cls = classifyEvent(ev, personalCalendarIds);
    if (cls === "excluded") { skipped++; continue; }
    const title = ev.summary ?? "(no title)";
    if (cls === "time_block") { timeBlocks.push({ id: ev.id, title, start: ev.start!, end: ev.end!, reason: "no_location" }); continue; }
    const geo = await geocode(ev.location!.trim());
    if (!geo) { timeBlocks.push({ id: ev.id, title, start: ev.start!, end: ev.end!, reason: "unmappable" }); continue; }
    waypoints.push({ id: ev.id, title, start: ev.start!, end: ev.end!, address: ev.location!.trim(), lat: geo.lat, lng: geo.lng, source: "calendar" });
  }
  return json({ status: "ok", waypoints, timeBlocks, skippedCount: skipped });
});
