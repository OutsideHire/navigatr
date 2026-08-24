import type { RawCalendarEvent } from "../calendarQualify.ts";
import { extractMicrosoftLocation, type GraphLocation } from "../calendarLocation.ts";
import type { TokenBundle } from "../googleToken.ts";
import { isExpired } from "../googleToken.ts";
import type { CalendarEventInput, CalendarProvider, RefreshDeps, RefreshResult, UpsertResult } from "./types.ts";
import {
  buildGraphAppointment,
  buildGraphFollowup,
  buildGraphPathBlock,
  NAVIGATR_APPT_PROP_ID,
  type GraphEventBody,
} from "../graphEvent.ts";

const GRAPH_EVENTS = "https://graph.microsoft.com/v1.0/me/events";

function graphBodyFor(input: CalendarEventInput): GraphEventBody {
  switch (input.kind) {
    case "appointment":
      return buildGraphAppointment(input.appt, input.attendeeEmails, input.timeZone);
    case "followup":
      return buildGraphFollowup(input.deal, input.followUpDateISO);
    case "path":
      return buildGraphPathBlock(input.path);
  }
}

const AUTHORITY = "https://login.microsoftonline.com/organizations/oauth2/v2.0";

// Base delegated scopes: calendar read/write + sign-in. Unchanged from launch.
const MICROSOFT_BASE_SCOPES = [
  "offline_access", "openid", "profile", "email", "User.Read", "Calendars.ReadWrite",
] as const;

/**
 * The Microsoft delegated scope set. Auto email capture (PRD) adds the
 * read-only mail-metadata scope `Mail.ReadBasic` when enabled, so a single
 * Outlook connection can also poll Sent Items. Pure + unit-tested; the flag is
 * resolved from the environment by the provider below.
 */
export function buildMicrosoftScopes(emailCaptureEnabled: boolean): string[] {
  const scopes: string[] = [...MICROSOFT_BASE_SCOPES];
  if (emailCaptureEnabled) scopes.push("Mail.ReadBasic");
  return scopes;
}

// Read the email-capture flag without a bare `Deno` reference, so this file
// stays importable under both Deno (edge functions) and Node (vitest/tsc). The
// flag is OFF unless the EMAIL_CAPTURE_ENABLED edge secret is exactly "1", so
// production's calendar OAuth scopes are byte-identical until it is set.
function emailCaptureEnabledFromEnv(): boolean {
  const env = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("EMAIL_CAPTURE_ENABLED") === "1";
}

interface GraphEvent {
  id: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean;
  sensitivity?: string;             // normal | personal | private | confidential
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: GraphLocation;
  locations?: GraphLocation[]; // plural; carries the address when singular is blank
  responseStatus?: { response?: string };  // none|organizer|tentativelyAccepted|accepted|declined|notResponded
  singleValueExtendedProperties?: Array<{ id?: string; value?: string }>; // our navigatr tag, when expanded
}

// Graph UTC dateTime like "2026-07-15T10:00:00.0000000" (no Z). Normalize to ISO.
function graphToIso(dt: string | undefined): string | null {
  if (!dt) return null;
  const withZ = dt.endsWith("Z") ? dt : `${dt}Z`;
  const ms = Date.parse(withZ);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

async function msTokenPost(body: URLSearchParams, deps: RefreshDeps): Promise<TokenBundle> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ? deps.now() : Date.now();
  const res = await fetchImpl(`${AUTHORITY}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!res.ok) throw new Error(`microsoft token http ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? "",
    expiry: new Date(now + json.expires_in * 1000).toISOString(),
  };
}

export const microsoftProvider: CalendarProvider = {
  id: "microsoft",
  oauth: {
    authUrl: `${AUTHORITY}/authorize`,
    tokenUrl: `${AUTHORITY}/token`,
    revokeUrl: null, // Microsoft has no token-revoke endpoint; disconnect just drops our stored tokens.
    scopes: buildMicrosoftScopes(emailCaptureEnabledFromEnv()),
    clientIdEnv: "MICROSOFT_CALENDAR_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CALENDAR_CLIENT_SECRET",
    extraAuthParams: { response_mode: "query" },
  },
  async refreshAccessToken(bundle, deps): Promise<RefreshResult> {
    const now = deps.now ? deps.now() : Date.now();
    if (!isExpired(bundle.expiry, now)) {
      return { accessToken: bundle.access_token, bundle, refreshed: false };
    }
    const refreshed = await msTokenPost(
      new URLSearchParams({
        grant_type: "refresh_token", refresh_token: bundle.refresh_token,
        client_id: deps.clientId, client_secret: deps.clientSecret,
        scope: this.oauth.scopes.join(" "),
      }),
      deps,
    );
    // Microsoft may omit a new refresh_token; keep the existing one.
    const bundleOut: TokenBundle = { ...refreshed, refresh_token: refreshed.refresh_token || bundle.refresh_token };
    return { accessToken: bundleOut.access_token, bundle: bundleOut, refreshed: true };
  },
  // Graph's /me/calendarView reads the primary calendar directly — there is no
  // calendar-list to filter — so `_options.excludeCalendarIds` is accepted (to keep
  // the CalendarProvider signature uniform) but has nothing to act on here.
  async listEvents(accessToken, windowStart, windowEnd, _options) {
    const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
    url.searchParams.set("startDateTime", windowStart);
    url.searchParams.set("endDateTime", windowEnd);
    url.searchParams.set("$top", "250");
    url.searchParams.set("$orderby", "start/dateTime");
    // Expand our navigatr tag so a pushed appointment can be deduped out of the
    // Path read (classifyEvent excludes any event carrying navigatrAppointmentId).
    url.searchParams.set(
      "$expand",
      `singleValueExtendedProperties($filter=id eq '${NAVIGATR_APPT_PROP_ID}')`,
    );
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) throw new Error(`graph calendarView http ${res.status}`);
    const data = (await res.json()) as { value?: GraphEvent[] };
    return (data.value ?? []).map((e): RawCalendarEvent => ({
      id: e.id,
      calendarId: "microsoft-primary",
      summary: e.subject ?? null,
      start: e.isAllDay ? null : graphToIso(e.start?.dateTime),
      end: e.isAllDay ? null : graphToIso(e.end?.dateTime),
      isAllDay: !!e.isAllDay,
      status: e.isCancelled ? "cancelled" : "confirmed",
      visibility: e.sensitivity ?? null,          // 'private'/'confidential' → excluded by classifyEvent
      responseStatus: e.responseStatus?.response ?? null, // 'declined' → excluded
      location: extractMicrosoftLocation(e.location, e.locations),
      navigatrAppointmentId:
        e.singleValueExtendedProperties?.find((p) => p.id === NAVIGATR_APPT_PROP_ID)?.value ?? null,
    }));
  },
  async upsertEvent(accessToken, existingEventId, input): Promise<UpsertResult> {
    const body = graphBodyFor(input);
    const isInsert = !existingEventId;
    const url = isInsert ? GRAPH_EVENTS : `${GRAPH_EVENTS}/${encodeURIComponent(existingEventId!)}`;
    const res = await fetch(url, {
      method: isInsert ? "POST" : "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`graph events.${isInsert ? "insert" : "patch"} http ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const data = (await res.json()) as { id?: string };
    return { id: data.id ?? existingEventId ?? "" };
  },
  async deleteEvent(accessToken, eventId): Promise<void> {
    const res = await fetch(`${GRAPH_EVENTS}/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404/410 = already gone on Microsoft's side; treat as success.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`graph events.delete http ${res.status}: ${await res.text().catch(() => "")}`);
    }
  },
};
