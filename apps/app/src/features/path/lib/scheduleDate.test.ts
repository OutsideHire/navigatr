import { describe, it, expect } from "vitest";
import {
  nextMondayISO,
  weekdayLabel,
  defaultPathName,
  composeReminderAt,
  isTodayOrFuture,
  formatReminder,
} from "./scheduleDate";

describe("nextMondayISO", () => {
  it("returns the upcoming Monday from a mid-week day", () => {
    // 2026-07-01 is a Wednesday → next Monday is 2026-07-06.
    expect(nextMondayISO("2026-07-01")).toBe("2026-07-06");
  });
  it("returns the FOLLOWING Monday when today is Monday (never today)", () => {
    // 2026-07-06 is a Monday → next is 2026-07-13.
    expect(nextMondayISO("2026-07-06")).toBe("2026-07-13");
  });
  it("returns the next day when today is Sunday", () => {
    // 2026-07-05 is a Sunday → next Monday is 2026-07-06.
    expect(nextMondayISO("2026-07-05")).toBe("2026-07-06");
  });
});

describe("weekdayLabel", () => {
  it("formats a calendar day as 'Wed Jul 1'", () => {
    expect(weekdayLabel("2026-07-01")).toBe("Wed, Jul 1");
  });
});

describe("defaultPathName", () => {
  it("combines origin label + weekday", () => {
    expect(defaultPathName("Edmond, OK", "2026-07-01")).toBe("Edmond, OK · Wed, Jul 1");
  });
  it("falls back to a generic prefix with no origin", () => {
    expect(defaultPathName(null, "2026-07-01")).toBe("Planned path · Wed, Jul 1");
  });
});

describe("composeReminderAt", () => {
  it("composes date + time into a local-tz ISO timestamp", () => {
    const iso = composeReminderAt("2026-07-02", "08:30");
    expect(iso).toBeTruthy();
    const d = new Date(iso!);
    // Local wall-clock hour/minute round-trip.
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(30);
    expect(d.getFullYear()).toBe(2026);
  });
  it("returns null for a blank time", () => {
    expect(composeReminderAt("2026-07-02", "")).toBeNull();
  });
});

describe("isTodayOrFuture", () => {
  it("is true for today", () => {
    expect(isTodayOrFuture("2026-07-01", "2026-07-01")).toBe(true);
  });
  it("is true for a future day", () => {
    expect(isTodayOrFuture("2026-07-02", "2026-07-01")).toBe(true);
  });
  it("is false for a past day", () => {
    expect(isTodayOrFuture("2026-06-30", "2026-07-01")).toBe(false);
  });
  it("is false for an empty date", () => {
    expect(isTodayOrFuture("", "2026-07-01")).toBe(false);
  });
});

describe("formatReminder", () => {
  it("returns null when there is no reminder", () => {
    expect(formatReminder(null)).toBeNull();
  });
  it("formats a date · time label", () => {
    const label = formatReminder(composeReminderAt("2026-07-02", "08:30"));
    expect(label).toContain("Jul 2");
    expect(label).toMatch(/8:30/);
  });
});
