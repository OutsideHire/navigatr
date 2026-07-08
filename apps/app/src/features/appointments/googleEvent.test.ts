import { describe, it, expect } from "vitest";
import { buildGoogleEventPayload, type AppointmentForEvent, buildFollowupEvent, buildPathBlockEvent } from "../../../../../supabase/functions/_shared/googleEvent";

const appt: AppointmentForEvent = {
  id: "ap1", title: "Appointment — Acme Co",
  startAt: "2026-07-10T15:00:00.000Z", endAt: "2026-07-10T15:30:00.000Z",
  locationAddress: "123 Main St, Edmond, OK", notes: "Bring collateral",
};

describe("buildGoogleEventPayload", () => {
  it("maps core fields + tags with navigatr_appointment_id", () => {
    const body = buildGoogleEventPayload(appt, ["a@x.com", "b@x.com"], "America/Chicago");
    expect(body.summary).toBe("Appointment — Acme Co");
    expect(body.start).toEqual({ dateTime: "2026-07-10T15:00:00.000Z", timeZone: "America/Chicago" });
    expect(body.end).toEqual({ dateTime: "2026-07-10T15:30:00.000Z", timeZone: "America/Chicago" });
    expect(body.location).toBe("123 Main St, Edmond, OK");
    expect(body.attendees).toEqual([{ email: "a@x.com" }, { email: "b@x.com" }]);
    expect(body.extendedProperties.private.navigatr_appointment_id).toBe("ap1");
    expect(body.description).toContain("Bring collateral");
  });
  it("omits attendees + location when absent", () => {
    const body = buildGoogleEventPayload({ ...appt, locationAddress: null, notes: null }, [], "UTC");
    expect(body.attendees).toBeUndefined();
    expect(body.location).toBeUndefined();
    expect(body.extendedProperties.private.navigatr_appointment_id).toBe("ap1");
  });
});

describe("buildFollowupEvent", () => {
  it("builds an all-day event with exclusive end (+1 day) + deal tag", () => {
    const e = buildFollowupEvent({ id: "d1", companyName: "Acme Co" }, "2026-07-12T00:00:00.000Z");
    expect(e.summary).toBe("Follow up: Acme Co");
    expect(e.start).toEqual({ date: "2026-07-12" });
    expect(e.end).toEqual({ date: "2026-07-13" });
    expect(e.extendedProperties.private.navigatr_followup_deal_id).toBe("d1");
  });
  it("rolls the exclusive end across a month boundary", () => {
    const e = buildFollowupEvent({ id: "d2", companyName: "X" }, "2026-07-31T12:00:00.000Z");
    expect(e.start).toEqual({ date: "2026-07-31" });
    expect(e.end).toEqual({ date: "2026-08-01" });
  });
  it("rolls across a year boundary", () => {
    const e = buildFollowupEvent({ id: "d3", companyName: "Y" }, "2026-12-31T00:00:00.000Z");
    expect(e.end).toEqual({ date: "2027-01-01" });
  });
});

describe("buildPathBlockEvent", () => {
  it("all-day block: start=date, exclusive end=+1 day, path tag", () => {
    const e = buildPathBlockEvent({ id: "p1", name: "Downtown Wed", pathDate: "2026-07-15" });
    expect(e.summary).toBe("Prospecting: Downtown Wed");
    expect(e.start).toEqual({ date: "2026-07-15" });
    expect(e.end).toEqual({ date: "2026-07-16" });
    expect(e.extendedProperties.private.navigatr_path_id).toBe("p1");
  });
  it("rolls exclusive end across month + year boundaries", () => {
    expect(buildPathBlockEvent({ id: "p2", name: "X", pathDate: "2026-07-31" }).end).toEqual({ date: "2026-08-01" });
    expect(buildPathBlockEvent({ id: "p3", name: "Y", pathDate: "2026-12-31" }).end).toEqual({ date: "2027-01-01" });
  });
  it("falls back to 'Prospecting' when name is empty", () => {
    expect(buildPathBlockEvent({ id: "p4", name: "", pathDate: "2026-07-15" }).summary).toBe("Prospecting");
  });
});
