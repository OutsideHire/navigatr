import { describe, it, expect } from "vitest";
import { classifyEvent, type RawCalendarEvent } from "../../../../../../supabase/functions/_shared/calendarQualify";

function ev(overrides: Partial<RawCalendarEvent> = {}): RawCalendarEvent {
  return {
    id: "e1", calendarId: "work@x.com", summary: "Meeting",
    start: "2026-07-03T15:00:00.000Z", end: "2026-07-03T16:00:00.000Z",
    isAllDay: false, status: "confirmed", visibility: "default",
    responseStatus: "accepted", location: "123 Main St, Edmond, OK",
    ...overrides,
  };
}

describe("classifyEvent", () => {
  it("located confirmed event → 'located'", () => {
    expect(classifyEvent(ev(), [])).toBe("located");
  });
  it("no location → 'time_block'", () => {
    expect(classifyEvent(ev({ location: "" }), [])).toBe("time_block");
    expect(classifyEvent(ev({ location: null }), [])).toBe("time_block");
  });
  it("excludes personal-calendar events", () => {
    expect(classifyEvent(ev(), ["work@x.com"])).toBe("excluded");
  });
  it("excludes all-day, cancelled, declined, private, confidential", () => {
    expect(classifyEvent(ev({ isAllDay: true }), [])).toBe("excluded");
    expect(classifyEvent(ev({ status: "cancelled" }), [])).toBe("excluded");
    expect(classifyEvent(ev({ responseStatus: "declined" }), [])).toBe("excluded");
    expect(classifyEvent(ev({ visibility: "private" }), [])).toBe("excluded");
    expect(classifyEvent(ev({ visibility: "confidential" }), [])).toBe("excluded");
  });
  it("excludes events missing start/end", () => {
    expect(classifyEvent(ev({ start: null }), [])).toBe("excluded");
  });
  it("keeps tentative events as candidates (Class A default)", () => {
    expect(classifyEvent(ev({ status: "tentative" }), [])).toBe("located");
  });
  it("excludes events navigatr itself pushed (tagged with an appointment id)", () => {
    expect(classifyEvent(ev({ navigatrAppointmentId: "ap1" }), [])).toBe("excluded");
  });
});
