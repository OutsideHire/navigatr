import { describe, it, expect } from "vitest";
import { todayISO, formatPathDate, addDaysISO } from "./today";

describe("todayISO", () => {
  it("returns a yyyy-mm-dd string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatPathDate", () => {
  it("says 'today' when the date is today", () => {
    expect(formatPathDate("2026-06-08", "2026-06-08")).toBe("today");
  });
  it("says 'yesterday' when the date is one day before today", () => {
    expect(formatPathDate("2026-06-07", "2026-06-08")).toBe("yesterday");
  });
  it("formats older dates as 'Wkdy, Mon D'", () => {
    // 2026-06-05 is a Friday.
    expect(formatPathDate("2026-06-05", "2026-06-08")).toBe("Fri, Jun 5");
  });
});

describe("addDaysISO", () => {
  it("adds a calendar day", () => {
    expect(addDaysISO("2026-06-12", 1)).toBe("2026-06-13");
  });
  it("rolls over month and year boundaries", () => {
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});
