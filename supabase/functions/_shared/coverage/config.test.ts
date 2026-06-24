import { describe, it, expect } from "vitest";
import { DEFAULT_COVERAGE_CONFIG, CALL_GRACE_MS, resolveCoverageConfig } from "./config";

describe("resolveCoverageConfig", () => {
  it("returns the defaults for empty / non-object input", () => {
    expect(resolveCoverageConfig(null)).toEqual(DEFAULT_COVERAGE_CONFIG);
    expect(resolveCoverageConfig({})).toEqual(DEFAULT_COVERAGE_CONFIG);
  });

  it("deep-merges provided keys over the defaults", () => {
    const merged = resolveCoverageConfig({
      bandThresholds: { good: 0.8 },
      minimumEventCounts: { call: 10 },
      enabledChannels: ["phone", "email"],
    });
    expect(merged.bandThresholds).toEqual({ excellent: 0.9, good: 0.8, adequate: 0.6, poor: 0.4 });
    expect(merged.minimumEventCounts.call).toBe(10);
    expect(merged.minimumEventCounts.email).toBe(20); // default preserved
    expect(merged.enabledChannels).toEqual(["phone", "email"]);
  });

  it("ignores malformed keys rather than throwing", () => {
    expect(resolveCoverageConfig({ bandThresholds: "nope", minimumEventCounts: 5 })).toEqual(
      DEFAULT_COVERAGE_CONFIG,
    );
  });

  it("falls back to the default for a malformed inner value", () => {
    expect(resolveCoverageConfig({ bandThresholds: { good: "nope" } }).bandThresholds.good).toBe(
      DEFAULT_COVERAGE_CONFIG.bandThresholds.good,
    );
  });

  it("rejects non-finite numbers (NaN / Infinity) in favor of the default", () => {
    const merged = resolveCoverageConfig({
      bandThresholds: { good: NaN },
      minimumEventCounts: { call: Infinity },
    });
    expect(merged.bandThresholds.good).toBe(DEFAULT_COVERAGE_CONFIG.bandThresholds.good);
    expect(merged.minimumEventCounts.call).toBe(DEFAULT_COVERAGE_CONFIG.minimumEventCounts.call);
  });

  it("drops non-string entries from enabledChannels", () => {
    expect(resolveCoverageConfig({ enabledChannels: ["phone", 1, null, "email"] }).enabledChannels)
      .toEqual(["phone", "email"]);
  });

  it("exposes the 4h grace constant", () => {
    expect(CALL_GRACE_MS).toBe(4 * 60 * 60 * 1000);
  });
});
