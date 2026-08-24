import { describe, it, expect } from "vitest";
import { daySubhead } from "./daySubhead";

describe("daySubhead", () => {
  it("planned, not started: states the count and the configured workday window", () => {
    expect(
      daySubhead({ stopCount: 8, workdayStart: "8:00 AM", workdayEnd: "6:00 PM", started: false }),
    ).toBe("8 stops. Your day: 8:00 AM to 6:00 PM.");
  });

  it("uses the singular 'stop' for a one-stop day (never '1 stops')", () => {
    expect(
      daySubhead({ stopCount: 1, workdayStart: "8:00 AM", workdayEnd: "6:00 PM", started: false }),
    ).toBe("1 stop. Your day: 8:00 AM to 6:00 PM.");
  });

  it("shows the configured window regardless of the current time (no live clock)", () => {
    // The window is whatever the rep saved; a 9:30 start reads back verbatim,
    // never replaced by 'now' once the day is open.
    expect(
      daySubhead({ stopCount: 3, workdayStart: "9:30 AM", workdayEnd: "6:00 PM", started: false }),
    ).toBe("3 stops. Your day: 9:30 AM to 6:00 PM.");
  });

  it("day underway: shows the next arrival, not the window", () => {
    expect(
      daySubhead({ stopCount: 8, workdayStart: "8:00 AM", workdayEnd: "6:00 PM", nextAt: "11:40", started: true }),
    ).toBe("8 stops. Next at 11:40.");
  });

  it("nothing planned: prompts the rep to build a day", () => {
    expect(daySubhead({ stopCount: 0 })).toBe("Nothing scheduled yet.");
  });

  it("treats a negative count as nothing planned", () => {
    expect(daySubhead({ stopCount: -3 })).toBe("Nothing scheduled yet.");
  });

  it("falls back to the count alone when the window labels are missing", () => {
    expect(daySubhead({ stopCount: 8, workdayStart: null, workdayEnd: null, started: false })).toBe("8 stops.");
    expect(daySubhead({ stopCount: 8, workdayStart: "8:00 AM", workdayEnd: null, started: false })).toBe("8 stops.");
  });

  it("falls back to the count alone when underway with no next arrival", () => {
    expect(daySubhead({ stopCount: 1, started: true })).toBe("1 stop.");
  });
});
