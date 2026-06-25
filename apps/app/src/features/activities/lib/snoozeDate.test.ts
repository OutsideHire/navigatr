import { describe, it, expect } from "vitest";
import { snoozeDate, SNOOZE_OPTIONS } from "./snoozeDate";

const now = new Date("2026-06-25T15:00:00.000Z");

describe("snoozeDate", () => {
  it("pushes the date forward by the option's days (UTC YYYY-MM-DD)", () => {
    expect(snoozeDate("tomorrow", now)).toBe("2026-06-26");
    expect(snoozeDate("3days", now)).toBe("2026-06-28");
    expect(snoozeDate("week", now)).toBe("2026-07-02");
  });
  it("rolls over a month-end boundary", () => {
    expect(snoozeDate("week", new Date("2026-06-28T00:00:00.000Z"))).toBe("2026-07-05");
  });
  it("exposes the three ordered options with labels", () => {
    expect(SNOOZE_OPTIONS.map((o) => o.value)).toEqual(["tomorrow", "3days", "week"]);
    expect(SNOOZE_OPTIONS.map((o) => o.label)).toEqual(["Tomorrow", "In 3 days", "Next week"]);
  });
});
