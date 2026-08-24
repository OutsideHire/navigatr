import { describe, it, expect, vi, afterEach } from "vitest";
import { microsoftProvider } from "../../../../../../supabase/functions/_shared/calendarProviders/microsoft";
import { NAVIGATR_APPT_PROP_ID } from "../../../../../../supabase/functions/_shared/graphEvent";
import type { TokenBundle } from "../../../../../../supabase/functions/_shared/googleToken";

const APPT = {
  id: "appt-1",
  title: "Demo",
  startAt: "2026-07-15T14:00:00.000Z",
  endAt: "2026-07-15T15:00:00.000Z",
  locationAddress: "123 Main St",
  notes: "notes",
};

const NOW = Date.parse("2026-07-08T12:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A Microsoft Graph calendarView page. Prefer: outlook.timezone="UTC" returns
// dateTime with no `Z`, so the provider must normalize to real ISO.
const GRAPH = {
  value: [
    {
      id: "g1",
      subject: "Site visit",
      isAllDay: false,
      isCancelled: false,
      sensitivity: "normal",
      start: { dateTime: "2026-07-15T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-15T15:00:00.0000000", timeZone: "UTC" },
      location: { displayName: "456 Oak Ave, Edmond, OK" },
      responseStatus: { response: "accepted" },
    },
    {
      id: "g2",
      subject: "All-day conference",
      isAllDay: true,
      start: { dateTime: "2026-07-16T00:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-17T00:00:00.0000000", timeZone: "UTC" },
    },
    {
      id: "g3",
      subject: "Declined sync",
      isAllDay: false,
      start: { dateTime: "2026-07-15T09:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-15T09:30:00.0000000", timeZone: "UTC" },
      responseStatus: { response: "declined" },
    },
    {
      id: "g4",
      subject: "Private 1:1",
      isAllDay: false,
      sensitivity: "private",
      start: { dateTime: "2026-07-15T16:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-15T16:30:00.0000000", timeZone: "UTC" },
    },
    {
      id: "g5",
      subject: "Cancelled meeting",
      isAllDay: false,
      isCancelled: true,
      start: { dateTime: "2026-07-15T12:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-15T12:30:00.0000000", timeZone: "UTC" },
    },
  ],
};

describe("microsoftProvider.oauth", () => {
  it("uses the /organizations authority for the endpoints", () => {
    const base =
      "https://login.microsoftonline.com/organizations/oauth2/v2.0";
    expect(microsoftProvider.oauth.authUrl).toBe(`${base}/authorize`);
    expect(microsoftProvider.oauth.tokenUrl).toBe(`${base}/token`);
    expect(microsoftProvider.oauth.revokeUrl).toBeNull();
  });

  it("requests the 6 scopes incl. offline_access + Calendars.ReadWrite", () => {
    expect(microsoftProvider.oauth.scopes).toEqual([
      "offline_access",
      "openid",
      "profile",
      "email",
      "User.Read",
      "Calendars.ReadWrite",
    ]);
  });

  it("has the MS env-var names + response_mode + forces consent", () => {
    expect(microsoftProvider.oauth.clientIdEnv).toBe(
      "MICROSOFT_CALENDAR_CLIENT_ID",
    );
    expect(microsoftProvider.oauth.clientSecretEnv).toBe(
      "MICROSOFT_CALENDAR_CLIENT_SECRET",
    );
    // prompt=consent so a reconnect re-prompts for newly-added scopes
    // (e.g. Mail.ReadBasic when email capture is enabled).
    expect(microsoftProvider.oauth.extraAuthParams).toEqual({
      response_mode: "query",
      prompt: "consent",
    });
  });
});

describe("microsoftProvider.listEvents", () => {
  it("maps a Graph calendarView page to RawCalendarEvent[]", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => GRAPH }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await microsoftProvider.listEvents(
      "ms-token",
      "2026-07-15T00:00:00Z",
      "2026-07-17T00:00:00Z",
    );

    expect(out).toEqual([
      {
        id: "g1",
        calendarId: "microsoft-primary",
        summary: "Site visit",
        start: "2026-07-15T14:00:00.000Z",
        end: "2026-07-15T15:00:00.000Z",
        isAllDay: false,
        status: "confirmed",
        visibility: "normal",
        responseStatus: "accepted",
        location: "456 Oak Ave, Edmond, OK",
        navigatrAppointmentId: null,
      },
      {
        id: "g2",
        calendarId: "microsoft-primary",
        summary: "All-day conference",
        start: null,
        end: null,
        isAllDay: true,
        status: "confirmed",
        visibility: null,
        responseStatus: null,
        location: null,
        navigatrAppointmentId: null,
      },
      {
        id: "g3",
        calendarId: "microsoft-primary",
        summary: "Declined sync",
        start: "2026-07-15T09:00:00.000Z",
        end: "2026-07-15T09:30:00.000Z",
        isAllDay: false,
        status: "confirmed",
        visibility: null,
        responseStatus: "declined",
        location: null,
        navigatrAppointmentId: null,
      },
      {
        id: "g4",
        calendarId: "microsoft-primary",
        summary: "Private 1:1",
        start: "2026-07-15T16:00:00.000Z",
        end: "2026-07-15T16:30:00.000Z",
        isAllDay: false,
        status: "confirmed",
        visibility: "private",
        responseStatus: null,
        location: null,
        navigatrAppointmentId: null,
      },
      {
        id: "g5",
        calendarId: "microsoft-primary",
        summary: "Cancelled meeting",
        start: "2026-07-15T12:00:00.000Z",
        end: "2026-07-15T12:30:00.000Z",
        isAllDay: false,
        status: "cancelled",
        visibility: null,
        responseStatus: null,
        location: null,
        navigatrAppointmentId: null,
      },
    ]);
  });

  it("hits Graph calendarView with the window params + UTC Prefer header", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, json: async () => ({ value: [] }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await microsoftProvider.listEvents(
      "ms-token",
      "2026-07-15T00:00:00Z",
      "2026-07-17T00:00:00Z",
    );

    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe(
      "https://graph.microsoft.com/v1.0/me/calendarView",
    );
    expect(u.searchParams.get("startDateTime")).toBe("2026-07-15T00:00:00Z");
    expect(u.searchParams.get("endDateTime")).toBe("2026-07-17T00:00:00Z");
    expect(u.searchParams.get("$top")).toBe("250");
    expect(u.searchParams.get("$orderby")).toBe("start/dateTime");
    expect((init as RequestInit).headers).toEqual({
      Authorization: "Bearer ms-token",
      Prefer: 'outlook.timezone="UTC"',
    });
  });

  it("throws when Graph responds non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401 }) as unknown as Response),
    );
    await expect(
      microsoftProvider.listEvents("t", "a", "b"),
    ).rejects.toThrow(/graph calendarView http 401/);
  });

  it("maps our expanded navigatr tag onto navigatrAppointmentId (read-dedup)", async () => {
    const tagged = {
      value: [
        {
          id: "gp",
          subject: "Pushed appt",
          isAllDay: false,
          start: { dateTime: "2026-07-15T14:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-07-15T15:00:00.0000000", timeZone: "UTC" },
          singleValueExtendedProperties: [{ id: NAVIGATR_APPT_PROP_ID, value: "appt-9" }],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => tagged }) as unknown as Response));
    const out = await microsoftProvider.listEvents("t", "a", "b");
    expect(out[0].navigatrAppointmentId).toBe("appt-9");
  });

  it("requests the navigatr tag via \$expand", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ value: [] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    await microsoftProvider.listEvents("t", "2026-07-15T00:00:00Z", "2026-07-17T00:00:00Z");
    const u = new URL(fetchMock.mock.calls[0][0] as string);
    expect(u.searchParams.get("$expand")).toContain("singleValueExtendedProperties");
    expect(u.searchParams.get("$expand")).toContain(NAVIGATR_APPT_PROP_ID);
  });
});

describe("microsoftProvider.upsertEvent / deleteEvent", () => {
  it("POSTs a new tagged event to /me/events and returns the new id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ id: "new-evt" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const res = await microsoftProvider.upsertEvent("tok", null, {
      kind: "appointment",
      appt: APPT,
      attendeeEmails: [],
      timeZone: "UTC",
    });
    expect(res).toEqual({ id: "new-evt" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.subject).toBe("Demo");
    expect(body.singleValueExtendedProperties[0]).toEqual({ id: NAVIGATR_APPT_PROP_ID, value: "appt-1" });
  });

  it("PATCHes an existing event by id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ id: "e1" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const res = await microsoftProvider.upsertEvent("tok", "e1", {
      kind: "appointment",
      appt: APPT,
      attendeeEmails: [],
      timeZone: "UTC",
    });
    expect(res.id).toBe("e1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events/e1");
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("throws on a non-ok upsert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }) as unknown as Response));
    await expect(
      microsoftProvider.upsertEvent("tok", null, { kind: "path", path: { id: "p1", name: "N", pathDate: "2026-07-22" } }),
    ).rejects.toThrow(/graph events.insert http 500/);
  });

  it("treats a 404 delete as success (idempotent)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response));
    await expect(microsoftProvider.deleteEvent("tok", "gone")).resolves.toBeUndefined();
  });

  it("throws on a real delete failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "err" }) as unknown as Response));
    await expect(microsoftProvider.deleteEvent("tok", "e1")).rejects.toThrow(/graph events.delete http 500/);
  });
});

describe("microsoftProvider.refreshAccessToken", () => {
  const deps = {
    clientId: "ms-cid",
    clientSecret: "ms-sec",
    now: () => NOW,
  };

  it("returns the existing token unchanged when it is still fresh", async () => {
    const bundle: TokenBundle = {
      access_token: "cached",
      refresh_token: "r1",
      expiry: "2026-07-08T13:00:00.000Z", // future
    };
    const fetchImpl = vi.fn();
    const res = await microsoftProvider.refreshAccessToken(bundle, {
      ...deps,
      fetchImpl,
    });
    expect(res.refreshed).toBe(false);
    expect(res.accessToken).toBe("cached");
    expect(res.bundle).toBe(bundle);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the refresh grant when expired and maps expires_in", async () => {
    const bundle: TokenBundle = {
      access_token: "old",
      refresh_token: "r1",
      expiry: "2026-07-08T11:00:00.000Z", // past
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "fresh", expires_in: 3600 }),
    });
    const res = await microsoftProvider.refreshAccessToken(bundle, {
      ...deps,
      fetchImpl,
    });
    expect(res.refreshed).toBe(true);
    expect(res.accessToken).toBe("fresh");
    expect(res.bundle.access_token).toBe("fresh");
    expect(res.bundle.refresh_token).toBe("r1"); // kept — MS omitted a new one
    expect(res.bundle.expiry).toBe(new Date(NOW + 3600 * 1000).toISOString());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    );
    expect((init as RequestInit).method).toBe("POST");
    const body = String((init as RequestInit).body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=r1");
    expect(body).toContain("client_id=ms-cid");
    expect(body).toContain("client_secret=ms-sec");
    // Regression guard (email-capture): the refresh grant must NOT send `scope`.
    // Microsoft refreshes with whatever the connection originally consented to
    // when scope is omitted; sending oauth.scopes would over-request once the
    // EMAIL_CAPTURE_ENABLED flag adds Mail.ReadBasic and break refresh for
    // pre-existing calendar-only connections (AADSTS65001).
    const parsed = new URLSearchParams(body);
    expect(parsed.get("scope")).toBeNull();
  });

  it("adopts a rotated refresh_token when Microsoft returns one", async () => {
    const bundle: TokenBundle = {
      access_token: "old",
      refresh_token: "r1",
      expiry: "2026-07-08T11:00:00.000Z",
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "fresh",
        expires_in: 3600,
        refresh_token: "r2",
      }),
    });
    const res = await microsoftProvider.refreshAccessToken(bundle, {
      ...deps,
      fetchImpl,
    });
    expect(res.bundle.refresh_token).toBe("r2");
  });

  it("throws when the refresh request fails", async () => {
    const bundle: TokenBundle = {
      access_token: "old",
      refresh_token: "r1",
      expiry: "2026-07-08T11:00:00.000Z",
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(
      microsoftProvider.refreshAccessToken(bundle, { ...deps, fetchImpl }),
    ).rejects.toThrow(/microsoft token http 400/);
  });
});
