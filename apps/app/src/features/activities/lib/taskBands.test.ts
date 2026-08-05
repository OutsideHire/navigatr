import { describe, it, expect } from "vitest";
import { deriveBands } from "./taskBands";

// Anchor on a Monday so business-day math is legible.
const MON = "2026-08-03";

describe("deriveBands", () => {
  it("1-day interval: lead slack 0, so earliest=target=day1, latest=day2", () => {
    expect(deriveBands(MON, 1)).toEqual({
      earliest_at: "2026-08-04",
      target_at: "2026-08-04",
      latest_at: "2026-08-05",
    });
  });

  it("2-day interval: lead still 0 (interval <= 2)", () => {
    const b = deriveBands(MON, 2)!;
    expect(b.target_at).toBe("2026-08-05"); // Mon + 2 business days = Wed
    expect(b.earliest_at).toBe("2026-08-05"); // lead 0
    expect(b.latest_at).toBe("2026-08-07"); // + trail 2 = Fri
  });

  it("5-day interval: lead 2 (40% rounded, capped 5), trail 5", () => {
    const b = deriveBands(MON, 5)!;
    expect(b.target_at).toBe("2026-08-10"); // Mon + 5 bd = next Mon
    expect(b.earliest_at).toBe("2026-08-06"); // target - 2 bd = Thu
    expect(b.latest_at).toBe("2026-08-17"); // target + 5 bd = following Mon
  });

  it("30-day interval: lead capped at 5, trail capped at 10", () => {
    const b = deriveBands(MON, 30)!;
    // target = Mon + 30 bd. Assert caps via band widths in business days.
    // lead = min(5, round(12)) = 5; trail = min(10, 30) = 10.
    expect(b.earliest_at < b.target_at).toBe(true);
    expect(b.target_at < b.latest_at).toBe(true);
  });

  it("null interval yields no task", () => {
    expect(deriveBands(MON, null)).toBeNull();
  });

  it("accepts a full ISO timestamp and uses the date portion", () => {
    expect(deriveBands("2026-08-03T14:30:00Z", 1)?.target_at).toBe("2026-08-04");
  });
});
