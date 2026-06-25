import { describe, it, expect } from "vitest";
import { teamCoverage, type CoverageRollupRow } from "./teamCoverage";

const row = (over: Partial<CoverageRollupRow> = {}): CoverageRollupRow => ({
  userId: "u", fullName: "Rep", role: "rep", snapshotDate: "2026-06-25",
  compositeCoverage: 0.8, confidenceLevel: "low", callCoverage: 0.8, callEventCount: 10,
  activeChannels: ["phone"], ...over,
});

describe("teamCoverage", () => {
  it("volume-weights the composite across reps with gradeable data", () => {
    const t = teamCoverage([
      row({ userId: "a", compositeCoverage: 0.8, callEventCount: 200 }),
      row({ userId: "b", compositeCoverage: 0.3, callEventCount: 5 }),
    ]);
    expect(t.compositeCoverage).toBeCloseTo((0.8 * 200 + 0.3 * 5) / 205, 6);
    expect(t.repsWithData).toBe(2);
    expect(t.repsTotal).toBe(2);
    expect(t.band).toBe("good"); // ~0.79 → good (>=0.75)
  });

  it("excludes null and insufficient rows from the composite + repsWithData but counts them in repsTotal", () => {
    const t = teamCoverage([
      row({ userId: "a", compositeCoverage: 0.9, callEventCount: 10 }),
      row({ userId: "b", compositeCoverage: null, confidenceLevel: null, callEventCount: null }),
      row({ userId: "c", compositeCoverage: 0.2, confidenceLevel: "insufficient", callEventCount: 3 }),
    ]);
    expect(t.compositeCoverage).toBe(0.9);
    expect(t.repsWithData).toBe(1);
    expect(t.repsTotal).toBe(3);
  });

  it("returns a null headline when no rep has gradeable data", () => {
    const t = teamCoverage([
      row({ compositeCoverage: null, confidenceLevel: null, callEventCount: null }),
      row({ userId: "c", confidenceLevel: "insufficient" }),
    ]);
    expect(t.compositeCoverage).toBeNull();
    expect(t.band).toBeNull();
    expect(t.repsWithData).toBe(0);
    expect(t.repsTotal).toBe(2);
  });

  // Documented call-volume-weighting edge (unreachable in SP2b's single channel,
  // where a gradeable rep always has call_event_count > 0): a gradeable rep with
  // zero call volume still counts in repsWithData but contributes 0 weight to the
  // headline. Pins the decision so multi-channel work revisits the weight.
  it("counts a gradeable zero-call-volume rep in repsWithData but not the weighted number", () => {
    const t = teamCoverage([
      row({ userId: "a", compositeCoverage: 0.6, confidenceLevel: "low", callEventCount: 100 }),
      row({ userId: "b", compositeCoverage: 0.9, confidenceLevel: "low", callEventCount: 0 }),
    ]);
    expect(t.compositeCoverage).toBe(0.6); // b's 0.9 drops out (0 weight)
    expect(t.repsWithData).toBe(2);
  });
});
