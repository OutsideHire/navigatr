import { describe, it, expect } from "vitest";
import {
  DEFAULT_END_OF_DAY_MINUTES,
  DWELL_DISCOVERY_MIN,
  DWELL_APPOINTMENT_MIN,
  dwellMinutesForKind,
} from "./pathCapacityDefaults";

describe("pathCapacityDefaults", () => {
  it("DEFAULT_END_OF_DAY_MINUTES is 6:00 PM in minutes from midnight", () => {
    expect(DEFAULT_END_OF_DAY_MINUTES).toBe(18 * 60);
    expect(DEFAULT_END_OF_DAY_MINUTES).toBe(1080);
  });

  it("names the per-kind dwell constants (15 flexible / 30 appointment)", () => {
    expect(DWELL_DISCOVERY_MIN).toBe(15);
    expect(DWELL_APPOINTMENT_MIN).toBe(30);
  });

  it("dwellMinutesForKind returns 30 for appointment and external", () => {
    expect(dwellMinutesForKind("appointment")).toBe(30);
    expect(dwellMinutesForKind("external")).toBe(30);
  });

  it("dwellMinutesForKind returns 15 for every flexible kind/tier", () => {
    for (const k of ["flexible", "owed", "nearby", "past_due", "due_today", "no_location"]) {
      expect(dwellMinutesForKind(k)).toBe(15);
    }
  });
});
