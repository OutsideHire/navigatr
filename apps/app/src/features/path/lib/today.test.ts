import { describe, it, expect } from "vitest";
import { todayISO, formatPathDate } from "./today";

describe("todayISO", () => {
  it("returns a yyyy-mm-dd string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatPathDate", () => {
  it("says 'yesterday' when the date is one day before today", () => {
    expect(formatPathDate("2026-06-07", "2026-06-08")).toBe("yesterday");
  });
  it("formats older dates as 'Wkdy, Mon D'", () => {
    // 2026-06-05 is a Friday.
    expect(formatPathDate("2026-06-05", "2026-06-08")).toBe("Fri, Jun 5");
  });
});
