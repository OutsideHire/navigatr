// Bug A regression — calculateFollowUpDate.
//
// Runs in America/Los_Angeles so we exercise the negative-UTC case. Before the
// fix, addBusinessDays() ran in local wall-clock but the result was floored
// with setUTCHours(0,0,0,0), which shoved a late-in-the-day local time across
// the UTC date line — producing the wrong calendar day and, worse, landing on
// a weekend. These assertions would FAIL on the pre-fix code.
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect } from "vitest";
import { calculateFollowUpDate } from "./followUpScheduling";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const utcDay = (iso: string) => iso.slice(0, 10);
const utcWeekday = (iso: string) => DOW[new Date(iso).getUTCDay()];

describe("calculateFollowUpDate — Americas (negative-UTC) evenings", () => {
  it("+1 business day from a Thursday evening is Friday, not Saturday", () => {
    // 2026-07-10T01:00Z = 2026-07-09 18:00 PDT (a Thursday evening).
    // Pre-fix produced 2026-07-11 (Saturday). Correct answer: 2026-07-10 (Fri).
    const iso = calculateFollowUpDate(
      "statement_secured",
      new Date("2026-07-10T01:00:00Z"),
    )!;
    expect(utcDay(iso)).toBe("2026-07-10");
    expect(utcWeekday(iso)).toBe("Fri");
  });

  it("+1 business day from a Friday evening skips the weekend to Monday, not Tuesday", () => {
    // 2026-07-11T01:00Z = 2026-07-10 18:00 PDT (a Friday evening).
    // Pre-fix produced 2026-07-14 (Tuesday). Correct answer: 2026-07-13 (Mon).
    const iso = calculateFollowUpDate(
      "statement_secured",
      new Date("2026-07-11T01:00:00Z"),
    )!;
    expect(utcDay(iso)).toBe("2026-07-13");
    expect(utcWeekday(iso)).toBe("Mon");
  });

  it("never returns a weekend day, even for evening logs", () => {
    // Sweep every disposition with an interval from a Thursday-evening log.
    const from = new Date("2026-07-10T01:00:00Z"); // Thu 18:00 PDT
    const interval = [
      "statement_secured",
      "positive_engagement",
      "connected_with_dm",
      "dm_unavailable",
      "future_potential",
      "low_probability",
    ] as const;
    for (const d of interval) {
      const iso = calculateFollowUpDate(d, from)!;
      expect(iso).not.toBeNull();
      expect(["Sat", "Sun"]).not.toContain(utcWeekday(iso));
    }
  });
});
