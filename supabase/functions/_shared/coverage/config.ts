/**
 * Activity Logging Coverage — shared config + types (SP1). Pure, dependency-free
 * so vitest runs it via the _shared include. CALL_GRACE_MS mirrors the
 * frontend's lib/unloggedDials.ts (the Deno runtime can't import from apps/app).
 */

/** PRD §3.3.C.4 call-grace window. */
export const CALL_GRACE_MS = 4 * 60 * 60 * 1000;

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";
export type Band = "excellent" | "good" | "adequate" | "poor" | "unreliable";
export type ChannelKey = "call" | "visit" | "meeting" | "email";

export interface CoverageConfig {
  enabledChannels: string[];
  bandThresholds: { excellent: number; good: number; adequate: number; poor: number };
  minimumEventCounts: Record<ChannelKey, number>;
}

export const DEFAULT_COVERAGE_CONFIG: CoverageConfig = {
  enabledChannels: ["phone"],
  bandThresholds: { excellent: 0.9, good: 0.75, adequate: 0.6, poor: 0.4 },
  minimumEventCounts: { call: 20, visit: 5, meeting: 5, email: 20 },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge an org's raw coverage_config jsonb over the code defaults. Never throws. */
export function resolveCoverageConfig(raw: unknown): CoverageConfig {
  if (!isObj(raw)) return DEFAULT_COVERAGE_CONFIG;
  const d = DEFAULT_COVERAGE_CONFIG;
  const bt = isObj(raw.bandThresholds) ? raw.bandThresholds : {};
  const me = isObj(raw.minimumEventCounts) ? raw.minimumEventCounts : {};
  // Reject non-finite numbers (NaN/Infinity) from org jsonb — fall back to the
  // default. Range/monotonicity of thresholds is the consuming step's concern.
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    enabledChannels: Array.isArray(raw.enabledChannels)
      ? raw.enabledChannels.filter((c): c is string => typeof c === "string")
      : d.enabledChannels,
    bandThresholds: {
      excellent: num(bt.excellent, d.bandThresholds.excellent),
      good: num(bt.good, d.bandThresholds.good),
      adequate: num(bt.adequate, d.bandThresholds.adequate),
      poor: num(bt.poor, d.bandThresholds.poor),
    },
    minimumEventCounts: {
      call: num(me.call, d.minimumEventCounts.call),
      visit: num(me.visit, d.minimumEventCounts.visit),
      meeting: num(me.meeting, d.minimumEventCounts.meeting),
      email: num(me.email, d.minimumEventCounts.email),
    },
  };
}
