import { describe, it, expect } from "vitest";
import { DEFAULT_PERSISTENCE_CONFIG, resolvePersistenceConfig } from "./config";

describe("resolvePersistenceConfig", () => {
  it("returns the defaults for empty / non-object input", () => {
    expect(resolvePersistenceConfig(null)).toEqual(DEFAULT_PERSISTENCE_CONFIG);
    expect(resolvePersistenceConfig(undefined)).toEqual(DEFAULT_PERSISTENCE_CONFIG);
    expect(resolvePersistenceConfig({})).toEqual(DEFAULT_PERSISTENCE_CONFIG);
    expect(resolvePersistenceConfig("nope")).toEqual(DEFAULT_PERSISTENCE_CONFIG);
    expect(resolvePersistenceConfig([1, 2, 3])).toEqual(DEFAULT_PERSISTENCE_CONFIG);
  });

  it("merges a partial snake_case override over the defaults", () => {
    const merged = resolvePersistenceConfig({ silence_threshold_days: 14 });
    expect(merged.silenceThresholdDays).toBe(14);
    expect(merged.fairnessWindowDays).toBe(DEFAULT_PERSISTENCE_CONFIG.fairnessWindowDays);
    expect(merged.targetCadence).toBe(DEFAULT_PERSISTENCE_CONFIG.targetCadence);
    expect(merged.windowDays).toBe(DEFAULT_PERSISTENCE_CONFIG.windowDays);
    expect(merged.followupFloor).toBe(DEFAULT_PERSISTENCE_CONFIG.followupFloor);
    expect(merged.formulaVersion).toBe(DEFAULT_PERSISTENCE_CONFIG.formulaVersion);
    expect(merged.followupMax).toBe(DEFAULT_PERSISTENCE_CONFIG.followupMax);
    expect(merged.cadenceMax).toBe(DEFAULT_PERSISTENCE_CONFIG.cadenceMax);
    expect(merged.reengagementMax).toBe(DEFAULT_PERSISTENCE_CONFIG.reengagementMax);
    expect(merged.coverageCaveatPct).toBe(DEFAULT_PERSISTENCE_CONFIG.coverageCaveatPct);
    expect(merged.coverageSuppressPct).toBe(DEFAULT_PERSISTENCE_CONFIG.coverageSuppressPct);
    expect(merged.emailInScoring).toBe(DEFAULT_PERSISTENCE_CONFIG.emailInScoring);
  });

  it("maps every snake_case key to its camelCase field", () => {
    const merged = resolvePersistenceConfig({
      silence_threshold_days: 25,
      fairness_window_days: 10,
      target_cadence: 4,
      window_days: 45,
      followup_floor: 5,
      formula_version: 3,
      followup_max: 50,
      cadence_max: 20,
      reengagement_max: 25,
      coverage_caveat_pct: 0.8,
      coverage_suppress_pct: 0.6,
      email_in_scoring: true,
    });
    expect(merged).toEqual({
      silenceThresholdDays: 25,
      fairnessWindowDays: 10,
      targetCadence: 4,
      windowDays: 45,
      followupFloor: 5,
      formulaVersion: 3,
      followupMax: 50,
      cadenceMax: 20,
      reengagementMax: 25,
      coverageCaveatPct: 0.8,
      coverageSuppressPct: 0.6,
      emailInScoring: true,
    });
  });

  it("rejects non-finite numbers (NaN via a string, Infinity) in favor of the default", () => {
    const merged = resolvePersistenceConfig({
      silence_threshold_days: "not-a-number",
      fairness_window_days: Infinity,
      target_cadence: NaN,
    });
    expect(merged.silenceThresholdDays).toBe(DEFAULT_PERSISTENCE_CONFIG.silenceThresholdDays);
    expect(merged.fairnessWindowDays).toBe(DEFAULT_PERSISTENCE_CONFIG.fairnessWindowDays);
    expect(merged.targetCadence).toBe(DEFAULT_PERSISTENCE_CONFIG.targetCadence);
  });

  it("ignores unknown keys rather than throwing", () => {
    expect(resolvePersistenceConfig({ some_unknown_key: 42 })).toEqual(DEFAULT_PERSISTENCE_CONFIG);
  });

  describe("emailInScoring", () => {
    it("defaults to false when absent", () => {
      expect(resolvePersistenceConfig({}).emailInScoring).toBe(false);
      expect(DEFAULT_PERSISTENCE_CONFIG.emailInScoring).toBe(false);
    });

    it("resolves true when the override is true", () => {
      expect(resolvePersistenceConfig({ email_in_scoring: true }).emailInScoring).toBe(true);
    });

    it("falls back to false for a non-boolean value", () => {
      expect(resolvePersistenceConfig({ email_in_scoring: "true" }).emailInScoring).toBe(false);
      expect(resolvePersistenceConfig({ email_in_scoring: 1 }).emailInScoring).toBe(false);
      expect(resolvePersistenceConfig({ email_in_scoring: null }).emailInScoring).toBe(false);
    });
  });
});
