import { describe, it, expect } from "vitest";
import type { PersistencePoint } from "./persistenceIndex";
import { initialsCode, rangeReadout, formatReadoutDelta, formatRangeLabel } from "./persistencePresentation";

describe("initialsCode", () => {
  it("builds a ticker from first + last initials", () => {
    expect(initialsCode("Sarah Williams", "TEAM")).toBe("TEAM-SW");
    expect(initialsCode("Jamal Brooks", "PIX")).toBe("PIX-JB");
  });
  it("uses the single initial for a one-word name", () => {
    expect(initialsCode("Cher", "PIX")).toBe("PIX-C");
  });
  it("falls back to the prefix alone when there are no letters", () => {
    expect(initialsCode("   ", "TEAM")).toBe("TEAM");
  });
});

const pts = (vals: (number | null)[], startDay = 1): PersistencePoint[] =>
  vals.map((v, i) => ({ date: `2026-06-${String(startDay + i).padStart(2, "0")}`, composite: v, activityCount: 0 }));

describe("rangeReadout", () => {
  it("takes latest, delta, pct, and from/to labels from scored points only", () => {
    const r = rangeReadout(pts([null, 60, 62, 66]));
    expect(r.latest).toBe(66);
    expect(r.delta).toBe(6); // 66 - 60 (first scored)
    expect(r.pct).toBeCloseTo(10, 5); // 6/60
    expect(r.fromLabel).toBe("Jun 2"); // first scored is index 1 -> day 2
    expect(r.toLabel).toBe("Jun 4");
  });
  it("is all-null when nothing is scored", () => {
    expect(rangeReadout(pts([null, null]))).toEqual({ latest: null, delta: null, pct: null, fromLabel: null, toLabel: null });
  });
});

describe("formatReadoutDelta", () => {
  it("formats a signed delta with percent", () => {
    expect(formatReadoutDelta(rangeReadout(pts([60, 66])))).toBe("+6.0 (+10.0%)");
  });
  it("formats a negative delta", () => {
    const r = rangeReadout(pts([68, 58]));
    expect(formatReadoutDelta(r)).toBe("-10.0 (-14.7%)");
  });
  it("is empty when there is no delta", () => {
    expect(formatReadoutDelta(rangeReadout(pts([null])))).toBe("");
  });
});

describe("formatRangeLabel", () => {
  it("includes the date span when available", () => {
    expect(formatRangeLabel("3M", rangeReadout(pts([60, 66])))).toBe("3M range · Jun 1 to Jun 2");
  });
  it("degrades to just the range when dates are missing", () => {
    expect(formatRangeLabel("3M", { latest: 5, delta: 1, pct: 1, fromLabel: null, toLabel: null })).toBe("3M range");
  });
});
