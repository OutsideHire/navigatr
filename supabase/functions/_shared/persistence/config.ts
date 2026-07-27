/**
 * Persistence Index shared config + resolver (SP-B). Pure, dependency-free
 * so vitest runs it via the _shared include. Mirrors the Logging Coverage
 * config pattern (coverage/config.ts).
 */
import { DEFAULT_SCORE_PARAMS, type ScoreParams } from "./score.ts";

export interface PersistenceConfig extends ScoreParams {
  coverageCaveatPct: number; // SP-D consumes; stored now
  coverageSuppressPct: number;
  /** Whether email activity counts toward scoring. Defaults to false (Wave 1
   *  ships without email in scoring); an org can opt in via jsonb override. */
  emailInScoring: boolean;
}

export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  ...DEFAULT_SCORE_PARAMS,
  coverageCaveatPct: 0.75,
  coverageSuppressPct: 0.5,
  emailInScoring: false,
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge an org's raw persistence_index_config jsonb over the code defaults. Never throws. */
export function resolvePersistenceConfig(raw: unknown): PersistenceConfig {
  if (!isObj(raw)) return DEFAULT_PERSISTENCE_CONFIG;
  const d = DEFAULT_PERSISTENCE_CONFIG;
  // Reject non-finite numbers (NaN/Infinity) from org jsonb, falling back to the
  // default. Range/monotonicity of thresholds is the consuming step's concern.
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    silenceThresholdDays: num(raw.silence_threshold_days, d.silenceThresholdDays),
    fairnessWindowDays: num(raw.fairness_window_days, d.fairnessWindowDays),
    targetCadence: num(raw.target_cadence, d.targetCadence),
    windowDays: num(raw.window_days, d.windowDays),
    followupFloor: num(raw.followup_floor, d.followupFloor),
    formulaVersion: num(raw.formula_version, d.formulaVersion),
    followupMax: num(raw.followup_max, d.followupMax),
    cadenceMax: num(raw.cadence_max, d.cadenceMax),
    reengagementMax: num(raw.reengagement_max, d.reengagementMax),
    coverageCaveatPct: num(raw.coverage_caveat_pct, d.coverageCaveatPct),
    coverageSuppressPct: num(raw.coverage_suppress_pct, d.coverageSuppressPct),
    emailInScoring: bool(raw.email_in_scoring, d.emailInScoring),
  };
}
