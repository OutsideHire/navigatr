import { describe, it, expect } from "vitest";
import { isZeroMetric } from "./metricDisplay";

describe("isZeroMetric", () => {
  it("is true for exactly zero", () => {
    expect(isZeroMetric(0)).toBe(true);
  });
  it("is false for any positive value", () => {
    expect(isZeroMetric(1)).toBe(false);
    expect(isZeroMetric(30800000)).toBe(false);
  });
  it("is false for negative values (treat as real data)", () => {
    expect(isZeroMetric(-5)).toBe(false);
  });
});
