import { describe, it, expect } from "vitest";
import {
  buildGraphAppointment,
  buildGraphFollowup,
  buildGraphPathBlock,
  NAVIGATR_APPT_PROP_ID,
} from "../../../../../../supabase/functions/_shared/graphEvent";

describe("buildGraphAppointment", () => {
  const appt = {
    id: "appt-1",
    title: "Demo with Acme",
    startAt: "2026-07-15T14:00:00.000Z",
    endAt: "2026-07-15T15:00:00.000Z",
    locationAddress: "123 Main St",
    notes: "bring samples",
  };

  it("builds a timed, tagged event with attendees, location, and notes", () => {
    const body = buildGraphAppointment(appt, ["owner@acme.com", "bad", "vp@acme.com"], "UTC");
    expect(body.subject).toBe("Demo with Acme");
    expect(body.start).toEqual({ dateTime: "2026-07-15T14:00:00", timeZone: "UTC" });
    expect(body.end).toEqual({ dateTime: "2026-07-15T15:00:00", timeZone: "UTC" });
    expect(body.location).toEqual({ displayName: "123 Main St" });
    expect(body.attendees).toEqual([
      { emailAddress: { address: "owner@acme.com" }, type: "required" },
      { emailAddress: { address: "vp@acme.com" }, type: "required" },
    ]);
    expect(body.body?.content).toContain("bring samples");
    expect(body.body?.content).toContain("Scheduled via navigatr");
    expect(body.singleValueExtendedProperties).toEqual([
      { id: NAVIGATR_APPT_PROP_ID, value: "appt-1" },
    ]);
  });

  it("omits location/attendees when absent", () => {
    const body = buildGraphAppointment({ ...appt, locationAddress: null, notes: null }, [], "UTC");
    expect(body.location).toBeUndefined();
    expect(body.attendees).toBeUndefined();
    // Still tagged so it dedups out of the Path read.
    expect(body.singleValueExtendedProperties?.[0].value).toBe("appt-1");
  });
});

describe("buildGraphFollowup", () => {
  it("builds an all-day event with an exclusive next-day end", () => {
    const body = buildGraphFollowup({ id: "d1", companyName: "Acme" }, "2026-07-20T12:00:00.000Z");
    expect(body.subject).toBe("Follow up: Acme");
    expect(body.isAllDay).toBe(true);
    expect(body.start).toEqual({ dateTime: "2026-07-20T00:00:00", timeZone: "UTC" });
    expect(body.end).toEqual({ dateTime: "2026-07-21T00:00:00", timeZone: "UTC" });
  });
});

describe("buildGraphPathBlock", () => {
  it("names the block from the path and uses an exclusive next-day end", () => {
    const body = buildGraphPathBlock({ id: "p1", name: "North loop", pathDate: "2026-07-22" });
    expect(body.subject).toBe("Prospecting: North loop");
    expect(body.isAllDay).toBe(true);
    expect(body.start.dateTime).toBe("2026-07-22T00:00:00");
    expect(body.end.dateTime).toBe("2026-07-23T00:00:00");
  });

  it("falls back to 'Prospecting' when the path has no name", () => {
    const body = buildGraphPathBlock({ id: "p1", name: "", pathDate: "2026-07-22" });
    expect(body.subject).toBe("Prospecting");
  });
});
