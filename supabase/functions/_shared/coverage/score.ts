/**
 * SP1 coverage scoring (PRD §3.3.C.8/9). Pure functions over counts + config.
 */
import type { Band, ChannelKey, ConfidenceLevel, CoverageConfig } from "./config.ts";

export function callCoverage(matched: number, total: number): number | null {
  return total === 0 ? null : matched / total;
}

export interface ChannelStat {
  coverage: number | null;
  eventCount: number;
}

/** Volume-weighted mean across channels with a non-null coverage. Null if none. */
export function composite(channels: ChannelStat[]): number | null {
  const active = channels.filter((c) => c.coverage !== null && c.eventCount > 0);
  const totalEvents = active.reduce((s, c) => s + c.eventCount, 0);
  if (totalEvents === 0) return null;
  const weighted = active.reduce((s, c) => s + (c.coverage as number) * c.eventCount, 0);
  return weighted / totalEvents;
}

export interface ActiveChannel {
  channel: ChannelKey;
  eventCount: number;
}

/**
 * PRD §3.3.C.9. ≥3 active ⇒ high, 2 ⇒ medium, 1 ⇒ low; a channel below its
 * minimum event count demotes one level; no active channel (or all below
 * minimum) ⇒ insufficient.
 */
export function confidence(active: ActiveChannel[], config: CoverageConfig): ConfidenceLevel {
  if (active.length === 0) return "insufficient";
  const belowMin = active.filter((c) => c.eventCount < config.minimumEventCounts[c.channel]);
  if (belowMin.length === active.length) return "insufficient"; // every active channel too sparse
  let level: ConfidenceLevel = active.length >= 3 ? "high" : active.length === 2 ? "medium" : "low";
  if (belowMin.length > 0) {
    if (level === "high") level = "medium";
    else if (level === "medium") level = "low";
  }
  return level;
}

export function band(value: number, t: CoverageConfig["bandThresholds"]): Band {
  if (value >= t.excellent) return "excellent";
  if (value >= t.good) return "good";
  if (value >= t.adequate) return "adequate";
  if (value >= t.poor) return "poor";
  return "unreliable";
}
