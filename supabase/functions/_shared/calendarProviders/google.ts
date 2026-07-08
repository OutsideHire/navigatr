import type { RawCalendarEvent } from "../calendarQualify.ts";
import { getFreshAccessToken } from "../googleToken.ts";
import type { CalendarProvider } from "./types.ts";

interface GoogleCalendarListItem { id: string }
interface GoogleEventItem {
  id: string; summary?: string; status?: string; visibility?: string; location?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: { navigatr_appointment_id?: string } };
}

export const googleProvider: CalendarProvider = {
  id: "google",
  oauth: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    clientIdEnv: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CALENDAR_CLIENT_SECRET",
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  async refreshAccessToken(bundle, deps) {
    // getFreshAccessToken already defaults to Google's token URL + grant.
    return getFreshAccessToken(bundle, deps);
  },
  async listEvents(accessToken, windowStart, windowEnd, options) {
    const excludeCalendarIds = options?.excludeCalendarIds ?? [];
    const authFetch = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const listRes = await authFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    if (!listRes.ok) throw new Error(`calendarList http ${listRes.status}`);
    const listData = (await listRes.json()) as { items?: GoogleCalendarListItem[] };
    // Drop the connection's personal calendars from the calendarList BEFORE issuing
    // any events.list request — exactly like the old readGoogle. This keeps a
    // personal/shared calendar's 403/404 from throwing and dropping the whole Google
    // read, and never fetches personal event bodies (privacy).
    const calendars = (listData.items ?? []).filter((cal) => !excludeCalendarIds.includes(cal.id));
    const perCal = await Promise.all(
      calendars.map(async (cal): Promise<RawCalendarEvent[]> => {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`);
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
            id: item.id, calendarId: cal.id, summary: item.summary ?? null,
            start: item.start?.dateTime ?? null, end: item.end?.dateTime ?? null,
            isAllDay: !!item.start?.date && !item.start?.dateTime,
            status: item.status ?? null, visibility: item.visibility ?? null,
            responseStatus: self?.responseStatus ?? null, location: item.location ?? null,
            navigatrAppointmentId: item.extendedProperties?.private?.navigatr_appointment_id ?? null,
          };
        });
      }),
    );
    return perCal.flat();
  },
};
