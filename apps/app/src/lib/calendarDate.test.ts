// Runs in America/Los_Angeles (UTC-7/-8) so the assertions exercise the
// negative-UTC (Americas) case where a naive UTC-midnight instant reads back
// as the previous day. Node fixes the timezone at process/module start, so TZ
// is set before any import that touches Date.
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect } from "vitest";
import {
  toDateOnly,
  toUtcDateOnly,
  dateOnlyToNoonUtcIso,
  diffCalendarDays,
  calendarDayDelta,
} from "./calendarDate";

describe("toDateOnly (local calendar day)", () => {
  it("returns the LOCAL day of an instant", () => {
    // 2026-07-09T02:00Z is 2026-07-08 19:00 in Los Angeles.
    expect(toDateOnly(new Date("2026-07-09T02:00:00Z"))).toBe("2026-07-08");
  });
  it("returns the same day for a noon-UTC instant across the US", () => {
    expect(toDateOnly(new Date("2026-07-09T12:00:00Z"))).toBe("2026-07-09");
  });
  it("zero-pads month and day", () => {
    expect(toDateOnly(new Date("2026-03-05T18:00:00Z"))).toBe("2026-03-05");
  });
});

describe("toUtcDateOnly (stored calendar day)", () => {
  it("reads a noon-UTC instant back as its calendar day", () => {
    expect(toUtcDateOnly(new Date("2026-07-09T12:00:00Z"))).toBe("2026-07-09");
  });
  it("reads a midnight-UTC instant back as its calendar day (no local drift)", () => {
    // The pre-fix hydration stored midnight UTC; its UTC day is still correct.
    expect(toUtcDateOnly(new Date("2026-07-09T00:00:00Z"))).toBe("2026-07-09");
  });
});

describe("dateOnlyToNoonUtcIso", () => {
  it("maps a date to noon UTC of that day", () => {
    expect(dateOnlyToNoonUtcIso("2026-07-09")).toBe("2026-07-09T12:00:00.000Z");
  });
  it("tolerates a full ISO string by using its date prefix", () => {
    expect(dateOnlyToNoonUtcIso("2026-07-09T23:30:00.000Z")).toBe(
      "2026-07-09T12:00:00.000Z",
    );
  });
  it("noon UTC reads back as the same local day in Los Angeles", () => {
    // The core property: store noon UTC, render/slice in local tz, same day.
    const iso = dateOnlyToNoonUtcIso("2026-07-09");
    expect(toDateOnly(new Date(iso))).toBe("2026-07-09");
    expect(toUtcDateOnly(new Date(iso))).toBe("2026-07-09");
  });
  it("throws on a non-date input", () => {
    expect(() => dateOnlyToNoonUtcIso("not-a-date")).toThrow();
  });
});

describe("diffCalendarDays", () => {
  it("is 0 for the same day", () => {
    expect(diffCalendarDays("2026-07-09", "2026-07-09")).toBe(0);
  });
  it("counts forward days as positive", () => {
    expect(diffCalendarDays("2026-07-09", "2026-07-12")).toBe(3);
  });
  it("counts backward days as negative", () => {
    expect(diffCalendarDays("2026-07-09", "2026-07-06")).toBe(-3);
  });
  it("crosses a month boundary correctly", () => {
    expect(diffCalendarDays("2026-07-31", "2026-08-01")).toBe(1);
  });
});

describe("calendarDayDelta (bell + Activities-list shared comparison)", () => {
  it("is 0 when a noon-UTC follow-up is the rep's local today", () => {
    const now = new Date("2026-07-09T20:00:00Z"); // 1pm PDT, still Jul 9 local
    const due = new Date("2026-07-09T12:00:00Z");
    expect(calendarDayDelta(now, due)).toBe(0);
  });

  it("Americas off-by-one: a Jul-9 follow-up is NOT due on the evening of Jul 8", () => {
    // Rep at 2026-07-09T02:00Z = 2026-07-08 19:00 PDT. A follow-up stored for
    // Jul 9 (either noon- or midnight-UTC) must read as +1 (tomorrow), never 0.
    const now = new Date("2026-07-09T02:00:00Z");
    expect(calendarDayDelta(now, new Date("2026-07-09T12:00:00Z"))).toBe(1);
    expect(calendarDayDelta(now, new Date("2026-07-09T00:00:00Z"))).toBe(1);
  });

  it("reports overdue follow-ups as negative", () => {
    const now = new Date("2026-07-09T20:00:00Z");
    expect(calendarDayDelta(now, new Date("2026-07-06T12:00:00Z"))).toBe(-3);
  });
});
