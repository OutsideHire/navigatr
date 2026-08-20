import { describe, it, expect } from "vitest";
import { daySubhead } from "./daySubhead";

describe("daySubhead", () => {
  it("planned, not started: states the count and the start time", () => {
    expect(daySubhead({ stopCount: 8, startsAt: "9:15", started: false })).toBe(
      "8 stops. Starts at 9:15.",
    );
  });

  it("uses the singular 'stop' for a one-stop day (never '1 stops')", () => {
    expect(daySubhead({ stopCount: 1, startsAt: "9:15", started: false })).toBe(
      "1 stop. Starts at 9:15.",
    );
  });

  it("before the workday opens: says 'Your day starts at' so it does not read as a frozen clock", () => {
    expect(
      daySubhead({ stopCount: 8, startsAt: "8:00 AM", started: false, notYetOpen: true }),
    ).toBe("8 stops. Your day starts at 8:00 AM.");
  });

  it("notYetOpen respects the singular 'stop'", () => {
    expect(
      daySubhead({ stopCount: 1, startsAt: "8:00 AM", started: false, notYetOpen: true }),
    ).toBe("1 stop. Your day starts at 8:00 AM.");
  });

  it("notYetOpen with no start time falls back to the count alone", () => {
    expect(daySubhead({ stopCount: 8, startsAt: null, notYetOpen: true })).toBe("8 stops.");
  });

  it("day underway: shows the next arrival, not a start time", () => {
    expect(daySubhead({ stopCount: 8, nextAt: "11:40", started: true })).toBe(
      "8 stops. Next at 11:40.",
    );
  });

  it("nothing planned: prompts the rep to build a day", () => {
    expect(daySubhead({ stopCount: 0 })).toBe("Nothing scheduled yet.");
  });

  it("treats a negative count as nothing planned", () => {
    expect(daySubhead({ stopCount: -3 })).toBe("Nothing scheduled yet.");
  });

  it("falls back to the count alone when the planned start time is missing", () => {
    expect(daySubhead({ stopCount: 8, startsAt: null, started: false })).toBe("8 stops.");
  });

  it("falls back to the count alone when underway with no next arrival", () => {
    expect(daySubhead({ stopCount: 1, started: true })).toBe("1 stop.");
  });
});
