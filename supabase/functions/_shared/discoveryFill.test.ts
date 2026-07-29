import { describe, it, expect } from "vitest";
import { buildRadiusLadder, hasFilled, isDiminishing } from "./discoveryFill";

describe("buildRadiusLadder", () => {
  it("grows geometrically then ends exactly at the cap", () => {
    // 3000 -> 4500 -> 6750 -> (cap) 40000, capped at 4 rungs.
    expect(buildRadiusLadder(3000, { maxRadiusM: 40000, factor: 1.5, maxSteps: 4 })).toEqual([
      3000, 4500, 6750, 40000,
    ]);
  });

  it("is strictly increasing", () => {
    const ladder = buildRadiusLadder(2000, { maxRadiusM: 40000, factor: 1.5, maxSteps: 4 });
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it("never exceeds the cap and always reaches it as the final rung", () => {
    const ladder = buildRadiusLadder(3000, { maxRadiusM: 40000, factor: 1.5, maxSteps: 4 });
    expect(Math.max(...ladder)).toBe(40000);
    expect(ladder[ladder.length - 1]).toBe(40000);
  });

  it("does not widen when the start radius is already at/above the cap", () => {
    expect(buildRadiusLadder(50000, { maxRadiusM: 40000 })).toEqual([50000]);
    expect(buildRadiusLadder(40000, { maxRadiusM: 40000 })).toEqual([40000]);
  });

  it("returns a single rung when only one step is allowed", () => {
    expect(buildRadiusLadder(3000, { maxRadiusM: 40000, maxSteps: 1 })).toEqual([3000]);
  });

  it("jumps straight to the cap as a second rung when maxSteps is 2", () => {
    expect(buildRadiusLadder(3000, { maxRadiusM: 40000, factor: 1.5, maxSteps: 2 })).toEqual([
      3000, 40000,
    ]);
  });

  it("floors a non-positive start to 1 meter", () => {
    const ladder = buildRadiusLadder(0, { maxRadiusM: 40000, maxSteps: 2 });
    expect(ladder[0]).toBe(1);
  });

  it("treats a factor <= 1 as a straight jump to the cap", () => {
    expect(buildRadiusLadder(3000, { maxRadiusM: 40000, factor: 1, maxSteps: 2 })).toEqual([
      3000, 40000,
    ]);
  });
});

describe("hasFilled", () => {
  it("is true at or above the target", () => {
    expect(hasFilled(25, 25)).toBe(true);
    expect(hasFilled(26, 25)).toBe(true);
  });
  it("is false below the target", () => {
    expect(hasFilled(20, 25)).toBe(false);
  });
});

describe("isDiminishing", () => {
  it("is true when widening added nothing", () => {
    expect(isDiminishing(20, 20)).toBe(true);
    expect(isDiminishing(20, 19)).toBe(true); // fewer (e.g. a re-classification) also stops
  });
  it("is false when widening added results", () => {
    expect(isDiminishing(20, 23)).toBe(false);
  });
});
