import type { RawCalendarEvent } from "../calendarQualify.ts";
import type { TokenBundle } from "../googleToken.ts";
import { isExpired } from "../googleToken.ts";
import type { CalendarProvider, RefreshDeps, RefreshResult } from "./types.ts";

const AUTHORITY = "https://login.microsoftonline.com/organizations/oauth2/v2.0";

interface GraphEvent {
  id: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean;
  sensitivity?: string;             // normal | personal | private | confidential
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  responseStatus?: { response?: string };  // none|organizer|tentativelyAccepted|accepted|declined|notResponded
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
    scopes: ["offline_access", "openid", "profile", "email", "User.Read", "Calendars.ReadWrite"],
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
      location: e.location?.displayName ?? null,
      navigatrAppointmentId: null,                 // no Outlook push yet (later slice)
    }));
  },
};
