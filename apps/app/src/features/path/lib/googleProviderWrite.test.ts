import { describe, it, expect, vi, afterEach } from "vitest";
import { googleProvider } from "../../../../../../supabase/functions/_shared/calendarProviders/google";
import { buildGoogleEventPayload } from "../../../../../../supabase/functions/_shared/googleEvent";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const APPT = {
  id: "appt-1",
  title: "Demo",
  startAt: "2026-07-15T14:00:00.000Z",
  endAt: "2026-07-15T15:00:00.000Z",
  locationAddress: "123 Main St",
  notes: "notes",
};

describe("googleProvider.upsertEvent / deleteEvent", () => {
  it("POSTs the exact buildGoogleEventPayload body to the primary events endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ id: "g-new" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const res = await googleProvider.upsertEvent("tok", null, {
      kind: "appointment",
      appt: APPT,
      attendeeEmails: ["owner@acme.com"],
      timeZone: "UTC",
    });

    expect(res).toEqual({ id: "g-new" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect((init as RequestInit).method).toBe("POST");
    // The body is byte-identical to the shared builder (no behavior change).
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent).toEqual(buildGoogleEventPayload(APPT, ["owner@acme.com"], "UTC"));
  });

  it("PATCHes an existing event by id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ id: "g1" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const res = await googleProvider.upsertEvent("tok", "g1", {
      kind: "appointment",
      appt: APPT,
      attendeeEmails: [],
      timeZone: "UTC",
    });
    expect(res.id).toBe("g1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/g1");
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("treats a 410 delete as success (idempotent)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 410 }) as unknown as Response));
    await expect(googleProvider.deleteEvent("tok", "gone")).resolves.toBeUndefined();
  });

  it("throws on a real delete failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "err" }) as unknown as Response));
    await expect(googleProvider.deleteEvent("tok", "g1")).rejects.toThrow(/events.delete http 500/);
  });
});
