import { describe, it, expect } from "vitest";
import type { RawCalendarEvent } from "../../../../../../supabase/functions/_shared/calendarQualify";
import {
  applyPersonalFilter,
  mergeConnections,
  overallStatus,
} from "../../../../../../supabase/functions/_shared/mergeCalendarEvents";

function ev(id: string, calendarId: string): RawCalendarEvent {
  return {
    id,
    calendarId,
    summary: id,
    start: "2026-07-15T10:00:00Z",
    end: "2026-07-15T11:00:00Z",
    isAllDay: false,
    status: "confirmed",
    visibility: "default",
    responseStatus: "accepted",
    location: null,
  };
}

describe("applyPersonalFilter", () => {
  it("drops events whose calendarId is in the personal list", () => {
    const events = [ev("a", "work"), ev("b", "personal"), ev("c", "work2")];
    expect(applyPersonalFilter(events, ["personal"]).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns everything unchanged when the personal list is empty", () => {
    const events = [ev("a", "work"), ev("b", "personal")];
    expect(applyPersonalFilter(events, [])).toEqual(events);
  });

  it("keeps everything when no calendarId matches a personal calendar", () => {
    const events = [ev("a", "work"), ev("b", "work2")];
    expect(applyPersonalFilter(events, ["nope"])).toEqual(events);
  });

  it("drops events from any of several personal calendars", () => {
    const events = [ev("a", "work"), ev("b", "p1"), ev("c", "p2")];
    expect(applyPersonalFilter(events, ["p1", "p2"]).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("mergeConnections", () => {
  it("flattens per-connection lists preserving connection + intra-connection order", () => {
    const google = [ev("g1", "work")];
    const microsoft = [ev("m1", "microsoft-primary"), ev("m2", "microsoft-primary")];
    expect(mergeConnections([google, microsoft]).map((e) => e.id)).toEqual(["g1", "m1", "m2"]);
  });

  it("returns an empty array when there are no connections", () => {
    expect(mergeConnections([])).toEqual([]);
  });

  it("handles connections that returned no events", () => {
    expect(mergeConnections([[], []])).toEqual([]);
  });
});

describe("overallStatus", () => {
  it("is not_connected when there are zero connections", () => {
    expect(overallStatus([])).toBe("not_connected");
  });

  it("is ok when the only connection succeeded", () => {
    expect(overallStatus([{ ok: true }])).toBe("ok");
  });

  it("is ok when at least one of several connections succeeded", () => {
    expect(overallStatus([{ ok: false }, { ok: true }])).toBe("ok");
  });

  it("is needs_reconnect when every connection failed", () => {
    expect(overallStatus([{ ok: false }, { ok: false }])).toBe("needs_reconnect");
  });
});
