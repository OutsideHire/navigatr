import { describe, it, expect } from "vitest";
import { buildGoogleEventPayload, type AppointmentForEvent } from "../../../../../supabase/functions/_shared/googleEvent";

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
