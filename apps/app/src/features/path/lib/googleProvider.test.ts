import { describe, it, expect, vi, afterEach } from "vitest";
import { googleProvider } from "../../../../../../supabase/functions/_shared/calendarProviders/google";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Mirrors the payloads Google Calendar returns: a calendarList page and one
// events.list page. The provider must map these to RawCalendarEvent[] exactly
// as the old readGoogle did.
const CALENDARS = { items: [{ id: "work@example.com" }] };
const EVENTS = {
  items: [
    {
      id: "e1",
      summary: "Client meeting",
      status: "confirmed",
      visibility: "default",
      location: "123 Main St, Oklahoma City, OK",
      start: { dateTime: "2026-07-15T10:00:00Z" },
      end: { dateTime: "2026-07-15T11:00:00Z" },
      attendees: [
        { self: false, responseStatus: "accepted" },
        { self: true, responseStatus: "tentative" },
      ],
      extendedProperties: { private: { navigatr_appointment_id: "appt-99" } },
    },
    {
      id: "e2",
      summary: "Company holiday",
      start: { date: "2026-07-16" },
      end: { date: "2026-07-17" },
    },
  ],
};

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/users/me/calendarList")) {
      return { ok: true, json: async () => CALENDARS } as unknown as Response;
    }
    if (url.includes("/calendars/") && url.includes("/events")) {
      return { ok: true, json: async () => EVENTS } as unknown as Response;
    }
    throw new Error(`unexpected url ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("googleProvider.oauth", () => {
  it("has the two calendar scopes", () => {
    expect(googleProvider.oauth.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  it("has Google's extra auth params + endpoints + env names", () => {
    expect(googleProvider.oauth.extraAuthParams).toEqual({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    expect(googleProvider.oauth.authUrl).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(googleProvider.oauth.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(googleProvider.oauth.revokeUrl).toBe("https://oauth2.googleapis.com/revoke");
    expect(googleProvider.oauth.clientIdEnv).toBe("GOOGLE_CALENDAR_CLIENT_ID");
    expect(googleProvider.oauth.clientSecretEnv).toBe("GOOGLE_CALENDAR_CLIENT_SECRET");
  });
});

describe("googleProvider.listEvents", () => {
  it("maps a calendarList + events page to RawCalendarEvent[] like readGoogle", async () => {
    stubFetch();
    const out = await googleProvider.listEvents(
      "test-token",
      "2026-07-15T00:00:00Z",
      "2026-07-16T00:00:00Z",
    );
    expect(out).toEqual([
      {
        id: "e1",
        calendarId: "work@example.com",
        summary: "Client meeting",
        start: "2026-07-15T10:00:00Z",
        end: "2026-07-15T11:00:00Z",
        isAllDay: false,
        status: "confirmed",
        visibility: "default",
        responseStatus: "tentative", // taken from the self attendee
        location: "123 Main St, Oklahoma City, OK",
        navigatrAppointmentId: "appt-99",
      },
      {
        id: "e2",
        calendarId: "work@example.com",
        summary: "Company holiday",
        start: null,
        end: null,
        isAllDay: true,
        status: null,
        visibility: null,
        responseStatus: null,
        location: null,
        navigatrAppointmentId: null,
      },
    ]);
  });

  it("sends the Bearer token and window + list params", async () => {
    const fetchMock = stubFetch();
    await googleProvider.listEvents(
      "abc",
      "2026-07-15T00:00:00Z",
      "2026-07-16T00:00:00Z",
    );
    // First call: calendarList with the auth header.
    const [listUrl, listInit] = fetchMock.mock.calls[0];
    expect(listUrl).toBe(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
    expect((listInit as RequestInit).headers).toEqual({
      Authorization: "Bearer abc",
    });
    // Second call: events.list with the window + fixed query params.
    const [evUrl, evInit] = fetchMock.mock.calls[1];
    const u = new URL(evUrl as string);
    expect(u.pathname).toContain(
      "/calendar/v3/calendars/work%40example.com/events",
    );
    expect(u.searchParams.get("timeMin")).toBe("2026-07-15T00:00:00Z");
    expect(u.searchParams.get("timeMax")).toBe("2026-07-16T00:00:00Z");
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(u.searchParams.get("orderBy")).toBe("startTime");
    expect(u.searchParams.get("maxResults")).toBe("250");
    expect((evInit as RequestInit).headers).toEqual({
      Authorization: "Bearer abc",
    });
  });

  it("never queries a calendar whose id is in excludeCalendarIds", async () => {
    // Two calendars in the list; one is the rep's personal calendar. The
    // provider must filter it out of the calendarList BEFORE issuing any
    // events.list request, so its event bodies are never fetched (privacy) and
    // a personal-cal 403/404 can't drop the whole Google read.
    const TWO_CALENDARS = {
      items: [{ id: "work@example.com" }, { id: "personal@example.com" }],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/users/me/calendarList")) {
        return { ok: true, json: async () => TWO_CALENDARS } as unknown as Response;
      }
      if (url.includes("/calendars/") && url.includes("/events")) {
        return { ok: true, json: async () => EVENTS } as unknown as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await googleProvider.listEvents(
      "abc",
      "2026-07-15T00:00:00Z",
      "2026-07-16T00:00:00Z",
      { excludeCalendarIds: ["personal@example.com"] },
    );

    const eventUrls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/events"));
    // The excluded personal calendar's events endpoint is NEVER hit.
    expect(eventUrls.some((u) => u.includes("personal%40example.com"))).toBe(false);
    // The work calendar's events ARE fetched.
    expect(eventUrls.some((u) => u.includes("work%40example.com"))).toBe(true);
  });

  it("throws when calendarList responds non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response),
    );
    await expect(
      googleProvider.listEvents("t", "a", "b"),
    ).rejects.toThrow(/calendarList http 403/);
  });

  it("throws when events.list responds non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/users/me/calendarList")) {
          return { ok: true, json: async () => CALENDARS } as unknown as Response;
        }
        return { ok: false, status: 500 } as unknown as Response;
      }),
    );
    await expect(
      googleProvider.listEvents("t", "a", "b"),
    ).rejects.toThrow(/events\.list http 500/);
  });
});
